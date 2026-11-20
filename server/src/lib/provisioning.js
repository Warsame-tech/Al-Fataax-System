/*
 * Business provisioning (Super admin → Businesses → Register a business).
 *
 *   1. registerBusiness()  central database, one transaction: business (status "pending", slug), trial or plan,
 *                          database_registry row, provisioning job (the owner's password is stored only as a bcrypt hash).
 *   2. runJob()            the steps, each safe to run again (retry after a failure):
 *        database  CREATE DATABASE faatix_<slug>_db                                   (dedicated only)
 *        user      a MySQL user with rights on that database only; password encrypted (dedicated + TENANT_DB_USERS)
 *        schema    every table (database/schema.sql) and every upgrade (config/migrate.js), schema version recorded
 *        data      the business row (same id as in the core), owner, roles, settings, cash accounts, stock location,
 *                  the first branch
 *        activate  business "active", registry "ready" — only now can anyone sign in
 *      A failure stops the job: the business stays "provisioning" (never active), the error is kept, and it can be retried.
 */
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { corePool, runWithPool } from "../config/db.js";
import { env } from "../config/env.js";
import { migrate, SCHEMA_VERSION } from "../config/migrate.js";
import { encryptSecret, forgetTenant, forgetSlugs, registryOf, mirrorToTenant } from "./tenancy.js";
import { ensureDefaultRoles } from "./roles.js";
import { defaultLocationId } from "./stock.js";
import { adminAudit } from "./platform.js";

export const dbNameFor = (slug, id) => `faatix_${String(slug).replace(/-/g, "_")}_db`.slice(0, 60) || `faatix_b${id}_db`;
const dbUserFor = (slug, id) => `fx${id}_${String(slug).replace(/-/g, "")}`.slice(0, 32);
const q = (name) => "`" + String(name).replace(/`/g, "") + "`";

const STEPS = { dedicated: ["database", "user", "schema", "data", "activate"], shared: ["data", "activate"] };
const running = new Set();

async function setStep(jobId, steps, key, status, error = null) {
  const s = steps.find((x) => x.key === key);
  Object.assign(s, { status, at: new Date().toISOString(), error });
  await corePool.query("UPDATE provisioning_jobs SET step = ?, steps = ? WHERE id = ?", [key, JSON.stringify(steps), jobId]);
}

/** A temporary pool on the business database with the platform's own (more privileged) MySQL user: schema work. */
const adminPoolFor = (dbName) => mysql.createPool({ ...env.db, database: dbName, connectionLimit: 2, charset: "utf8mb4", dateStrings: true });

/** Creates the tables and brings a business database to the current schema version. */
export async function migrateBusinessDb(businessId) {
  const reg = await registryOf(businessId);
  if (!reg || reg.mode !== "dedicated" || !reg.db_name) return { skipped: true };
  const p = adminPoolFor(reg.db_name);
  try {
    await runWithPool({ pool: p, businessId, dedicated: true }, () => migrate({ db: { ...env.db, database: reg.db_name }, core: false }));
    await corePool.query("UPDATE database_registry SET schema_version = ?, last_migrated_at = UTC_TIMESTAMP(), last_error = NULL WHERE business_id = ?", [SCHEMA_VERSION, businessId]);
    return { ok: true, version: SCHEMA_VERSION };
  } catch (err) {
    await corePool.query("UPDATE database_registry SET last_error = ? WHERE business_id = ?", [safeError(err), businessId]);
    throw err;
  } finally {
    await p.end().catch(() => {});
    forgetTenant(businessId);
  }
}

/** Every ready business database (server start, Super admin → Databases → Run migrations on all). */
export async function migrateAllBusinessDbs() {
  const [rows] = await corePool.query("SELECT business_id FROM database_registry WHERE mode = 'dedicated' AND status = 'ready'");
  const out = [];
  for (const r of rows) {
    try { out.push({ businessId: r.business_id, ...(await migrateBusinessDb(r.business_id)) }); }
    catch (err) { out.push({ businessId: r.business_id, ok: false, error: safeError(err) }); console.error(`Business ${r.business_id} database upgrade failed:`, safeError(err)); }
  }
  return out;
}

/* never pass passwords or SQL with secrets to the log / the screen */
const safeError = (err) => String(err?.sqlMessage || err?.code || err?.message || err).replace(/IDENTIFIED BY\s+'[^']*'/gi, "IDENTIFIED BY '***'").slice(0, 480);

/** The business records in its database (dedicated) or in the central database (shared). Safe to repeat. */
async function createBusinessData(conn, biz, payload) {
  const bid = biz.id;
  const [[exists]] = await conn.query("SELECT id FROM businesses WHERE id = ?", [bid]);
  if (!exists) {
    await conn.query(
      `INSERT INTO businesses (id, name, slug, owner_name, email, phone, business_type, address, logo_path, status, terms_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP())`,
      [bid, biz.name, biz.slug, biz.owner_name, biz.email, biz.phone, biz.business_type, biz.address, biz.logo_path]);
  }
  const o = payload.owner;
  let [[owner]] = await conn.query("SELECT u.id FROM users u JOIN business_user_roles r ON r.user_id = u.id AND r.role = 'owner' WHERE u.business_id = ? LIMIT 1", [bid]);
  if (!owner) {
    const [u] = await conn.query("INSERT INTO users (business_id, full_name, username, email, phone, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
      [bid, o.name, o.username, o.email || null, o.phone || null, o.passwordHash]);
    owner = { id: u.insertId };
    await conn.query("INSERT INTO business_user_roles (business_id, user_id, role) VALUES (?, ?, 'owner')", [bid, owner.id]);
  }
  await conn.query("INSERT IGNORE INTO business_settings (business_id) VALUES (?)", [bid]);
  const [[cash]] = await conn.query("SELECT COUNT(*) n FROM cash_accounts WHERE business_id = ?", [bid]);
  if (!cash.n) await conn.query("INSERT INTO cash_accounts (business_id, name, is_default) VALUES (?, 'Main cash', 1), (?, 'Mobile money', 0)", [bid, bid]);
  await ensureDefaultRoles(bid, conn);
  const loc = await defaultLocationId(conn, bid);
  const [[br]] = await conn.query("SELECT id FROM branches WHERE business_id = ? LIMIT 1", [bid]);
  if (!br) await conn.query("INSERT INTO branches (business_id, name, code, address, phone, sell_location_id, is_main) VALUES (?, ?, 'MAIN', ?, ?, ?, 1)",
    [bid, payload.branchName || "Main branch", biz.address, biz.phone, loc]);
  await conn.query("INSERT INTO audit_logs (business_id, user_id, action, entity, entity_id) VALUES (?, ?, 'business.registered', 'business', ?)", [bid, owner.id, bid]);
}

/** Runs (or re-runs) a provisioning job. Never throws; the outcome is in provisioning_jobs. */
export async function runJob(jobId) {
  if (running.has(jobId)) return;
  running.add(jobId);
  let steps = [];
  let job;
  try {
    const [lock] = await corePool.query("UPDATE provisioning_jobs SET status = 'running', attempts = attempts + 1, started_at = UTC_TIMESTAMP(), error = NULL WHERE id = ? AND status IN ('pending','failed')", [jobId]);
    if (!lock.affectedRows) return;
    [[job]] = await corePool.query("SELECT * FROM provisioning_jobs WHERE id = ?", [jobId]);
    const payload = JSON.parse(job.payload || "{}");
    if (payload.kind === "move") {   // a move always starts again from the beginning (a failure undid everything)
      steps = MOVE_STEPS.map((key) => ({ key, status: "waiting" }));
      await corePool.query("UPDATE provisioning_jobs SET steps = ? WHERE id = ?", [JSON.stringify(steps), jobId]);
      await runMoveJob(job, steps);
      return;
    }
    const [[biz]] = await corePool.query("SELECT * FROM businesses WHERE id = ?", [job.business_id]);
    const reg = await registryOf(biz.id);
    const mode = reg?.mode === "dedicated" ? "dedicated" : "shared";
    const prev = (() => { try { return JSON.parse(job.steps || "[]"); } catch { return []; } })();
    steps = STEPS[mode].map((key) => prev.find((s) => s.key === key && s.status === "done") || { key, status: "waiting" });
    await corePool.query("UPDATE businesses SET status = 'provisioning' WHERE id = ? AND status IN ('pending','provisioning')", [biz.id]);
    await corePool.query("UPDATE database_registry SET status = 'provisioning', last_error = NULL WHERE business_id = ?", [biz.id]);
    forgetTenant(biz.id);
    const dbName = reg?.db_name || dbNameFor(biz.slug, biz.id);

    for (const s of steps) {
      if (s.status === "done" && s.key !== "activate") continue;
      await setStep(jobId, steps, s.key, "running");
      if (s.key === "database") {
        await corePool.query(`CREATE DATABASE IF NOT EXISTS ${q(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await corePool.query("UPDATE database_registry SET db_name = ?, db_host = NULL, db_port = NULL WHERE business_id = ?", [dbName, biz.id]);
      } else if (s.key === "user") {
        if (env.tenantDbUsers) {
          const user = dbUserFor(biz.slug, biz.id);
          const password = crypto.randomBytes(24).toString("base64url");
          const host = env.tenantDbUserHost;
          await corePool.query("CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?", [user, host, password]);
          await corePool.query("ALTER USER ?@? IDENTIFIED BY ?", [user, host, password]);   // a retry gets a fresh password
          await corePool.query(`GRANT ALL PRIVILEGES ON ${q(dbName)}.* TO ?@?`, [user, host]);
          await corePool.query("UPDATE database_registry SET db_user = ?, db_password_enc = ? WHERE business_id = ?", [user, encryptSecret(password), biz.id]);
        } else {
          await corePool.query("UPDATE database_registry SET db_user = NULL, db_password_enc = NULL WHERE business_id = ?", [biz.id]);
        }
      } else if (s.key === "schema") {
        const p = adminPoolFor(dbName);
        try {
          await runWithPool({ pool: p, businessId: biz.id, dedicated: true }, () => migrate({ db: { ...env.db, database: dbName }, core: false }));
        } finally { await p.end().catch(() => {}); }
        await corePool.query("UPDATE database_registry SET schema_version = ?, last_migrated_at = UTC_TIMESTAMP() WHERE business_id = ?", [SCHEMA_VERSION, biz.id]);
      } else if (s.key === "data") {
        const p = mode === "dedicated" ? adminPoolFor(dbName) : corePool;
        const conn = await p.getConnection();
        try {
          await conn.beginTransaction();
          await createBusinessData(conn, biz, payload);
          await conn.commit();
        } catch (err) { await conn.rollback().catch(() => {}); throw err; }
        finally { conn.release(); if (mode === "dedicated") await p.end().catch(() => {}); }
      } else if (s.key === "activate") {
        await corePool.query("UPDATE database_registry SET status = 'ready', last_error = NULL WHERE business_id = ?", [biz.id]);
        await corePool.query("UPDATE businesses SET status = 'active', provisioned_at = UTC_TIMESTAMP() WHERE id = ?", [biz.id]);
        forgetTenant(biz.id);
        forgetSlugs();
        if (mode === "dedicated") await mirrorToTenant(biz.id);
      }
      await setStep(jobId, steps, s.key, "done");
    }
    // the owner's password hash is not needed any more
    await corePool.query("UPDATE provisioning_jobs SET status = 'succeeded', finished_at = UTC_TIMESTAMP(), payload = NULL WHERE id = ?", [jobId]);
    await adminAudit(corePool, { adminId: job.admin_id, businessId: biz.id, action: "admin.business_provisioned", meta: { mode, database: mode === "dedicated" ? dbName : null } });
  } catch (err) {
    const msg = safeError(err);
    console.error(`Provisioning job ${jobId} failed:`, msg);
    const cur = steps.find((s) => s.status === "running");
    if (cur) Object.assign(cur, { status: "failed", error: msg, at: new Date().toISOString() });
    await corePool.query("UPDATE provisioning_jobs SET status = 'failed', error = ?, steps = ?, finished_at = UTC_TIMESTAMP() WHERE id = ?", [msg, JSON.stringify(steps), jobId]).catch(() => {});
    const isMove = (() => { try { return JSON.parse(job?.payload || "{}").kind === "move"; } catch { return false; } })();
    if (job) {
      if (!isMove) await corePool.query("UPDATE database_registry SET status = 'failed', last_error = ? WHERE business_id = ?", [msg, job.business_id]).catch(() => {});
      forgetTenant(job.business_id);
      await adminAudit(corePool, { adminId: job.admin_id, businessId: job.business_id, action: "admin.provisioning_failed", meta: { step: cur?.key, error: msg } }).catch(() => {});
    }
  } finally {
    running.delete(jobId);
  }
}

/* =====================================================================================================
 * Moving a shared business into its own database (Super admin → Databases → Move to own database).
 * The business is paused (status "provisioning": its users see "being set up"), backed up, copied row by row into
 * faatix_<slug>_db, the row counts are compared, then the registry switches to the new database and the old rows are
 * removed from the central database (images are kept there too). Any failure: the new database is dropped, the business
 * gets its old status back and keeps working from the central database.
 * ===================================================================================================== */
// platform tables: they stay in the central database and are never copied or removed
const PLATFORM_TABLES = new Set(["plans", "subscriptions", "subscription_payments", "business_notes", "contact_messages", "support_tickets", "support_messages",
  "announcements", "blocked_ips", "platform_settings", "trial_records", "business_domains", "database_registry", "provisioning_jobs", "business_modules", "backups",
  "business_types", "platform_admins", "platform_roles", "platform_permissions", "app_migrations", "schema_versions", "businesses"]);
// rows without a business_id: copied with their parent row
const CHILD_TABLES = { device_events: ["device_id", "devices"], gold_buy_events: ["gold_buy_id", "gold_buys"], payroll_lines: ["run_id", "payroll_runs"],
  recipe_lines: ["recipe_id", "recipes"], roll_events: ["roll_id", "fabric_rolls"], stock_movement_batches: ["movement_id", "stock_movements"],
  tailoring_events: ["order_id", "tailoring_orders"], warranty_events: ["warranty_id", "warranties"] };
const KEEP_IN_CORE = new Set(["stored_files"]);   // old image links (/files/<key>) keep working

const MOVE_STEPS = ["pause", "backup", "database", "user", "schema", "copy", "verify", "switch"];

async function tablesToMove(conn, coreDb) {
  const [rows] = await conn.query(
    `SELECT t.TABLE_NAME n, EXISTS (SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME AND c.COLUMN_NAME = 'business_id') has_bid
       FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE' ORDER BY t.TABLE_NAME`, [coreDb]);
  return rows.filter((r) => !PLATFORM_TABLES.has(r.n) && (Number(r.has_bid) || CHILD_TABLES[r.n])).map((r) => r.n);
}
async function commonColumns(conn, a, b, table) {
  const [rows] = await conn.query(
    `SELECT c1.COLUMN_NAME n FROM information_schema.COLUMNS c1 JOIN information_schema.COLUMNS c2 ON c2.TABLE_SCHEMA = ? AND c2.TABLE_NAME = c1.TABLE_NAME AND c2.COLUMN_NAME = c1.COLUMN_NAME
      WHERE c1.TABLE_SCHEMA = ? AND c1.TABLE_NAME = ? ORDER BY c1.ORDINAL_POSITION`, [b, a, table]);
  return rows.map((r) => r.n);
}
const whereOf = (table, alias = "x") => (CHILD_TABLES[table]
  ? { join: ` JOIN ${q(CHILD_TABLES[table][1])} p ON p.id = ${alias}.${q(CHILD_TABLES[table][0])}`, cond: "p.business_id = ?" }
  : { join: "", cond: `${alias}.business_id = ?` });
async function countIn(conn, dbName, table, bid) {
  const w = whereOf(table);
  const [[c]] = await conn.query(`SELECT COUNT(*) n FROM ${q(dbName)}.${q(table)} x${w.join.replace(/JOIN `/, `JOIN ${q(dbName)}.\``)} WHERE ${w.cond}`, [bid]);
  return Number(c.n);
}

async function runMoveJob(job, steps) {
  const payload = JSON.parse(job.payload || "{}");
  const bid = job.business_id;
  const coreDb = env.db.database;
  const [[biz]] = await corePool.query("SELECT * FROM businesses WHERE id = ?", [bid]);
  const dbName = dbNameFor(biz.slug, bid);
  const conn = await corePool.getConnection();
  try {
    for (const s of steps) {
      await setStep(job.id, steps, s.key, "running");
      if (s.key === "pause") {
        await corePool.query("UPDATE businesses SET status = 'provisioning' WHERE id = ?", [bid]);
        await corePool.query("UPDATE database_registry SET status = 'migrating', last_error = NULL WHERE business_id = ?", [bid]);
        forgetTenant(bid);
      } else if (s.key === "backup") {
        const { makeBackup } = await import("./backups.js");
        const b = await makeBackup({ scope: "business", businessId: bid, adminId: job.admin_id });
        if (b.status !== "done") throw new Error(`Backup failed: ${b.error || "unknown"}`);
      } else if (s.key === "database") {
        await conn.query(`DROP DATABASE IF EXISTS ${q(dbName)}`);   // a half-made copy from an earlier attempt (never in use: the registry still says shared)
        await conn.query(`CREATE DATABASE ${q(dbName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      } else if (s.key === "user") {
        if (env.tenantDbUsers) {
          const user = dbUserFor(biz.slug, bid);
          const password = crypto.randomBytes(24).toString("base64url");
          await conn.query("CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?", [user, env.tenantDbUserHost, password]);
          await conn.query("ALTER USER ?@? IDENTIFIED BY ?", [user, env.tenantDbUserHost, password]);
          await conn.query(`GRANT ALL PRIVILEGES ON ${q(dbName)}.* TO ?@?`, [user, env.tenantDbUserHost]);
          payload.db = { user, password: encryptSecret(password) };
        } else payload.db = { user: null, password: null };
        await corePool.query("UPDATE provisioning_jobs SET payload = ? WHERE id = ?", [JSON.stringify(payload), job.id]);
      } else if (s.key === "schema") {
        const p = adminPoolFor(dbName);
        try { await runWithPool({ pool: p, businessId: bid, dedicated: true }, () => migrate({ db: { ...env.db, database: dbName }, core: false })); }
        finally { await p.end().catch(() => {}); }
      } else if (s.key === "copy") {
        const tables = await tablesToMove(conn, coreDb);
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        await conn.beginTransaction();
        // the business row, then every table: only the columns both databases have
        const bcols = (await commonColumns(conn, coreDb, dbName, "businesses")).map(q).join(", ");
        await conn.query(`INSERT INTO ${q(dbName)}.businesses (${bcols}) SELECT ${bcols} FROM ${q(coreDb)}.businesses WHERE id = ?`, [bid]);
        for (const t of tables) {
          const cols = await commonColumns(conn, coreDb, dbName, t);
          if (!cols.length) continue;
          const w = whereOf(t);
          await conn.query(`INSERT INTO ${q(dbName)}.${q(t)} (${cols.map(q).join(", ")}) SELECT ${cols.map((c) => `x.${q(c)}`).join(", ")}
            FROM ${q(coreDb)}.${q(t)} x${w.join.replace(/JOIN `/, `JOIN ${q(coreDb)}.\``)} WHERE ${w.cond}`, [bid]);
        }
        await conn.commit();
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
        payload.tables = tables;
      } else if (s.key === "verify") {
        const bad = [];
        for (const t of payload.tables || []) {
          const [a, b] = [await countIn(conn, coreDb, t, bid), await countIn(conn, dbName, t, bid)];
          if (a !== b) bad.push(`${t}: ${a} → ${b}`);
        }
        if (bad.length) throw new Error(`Row counts differ (${bad.slice(0, 5).join("; ")})`);
      } else if (s.key === "switch") {
        await corePool.query(
          `UPDATE database_registry SET mode = 'dedicated', db_name = ?, db_host = NULL, db_port = NULL, db_user = ?, db_password_enc = ?, status = 'ready',
                  schema_version = ?, last_migrated_at = UTC_TIMESTAMP(), last_error = NULL WHERE business_id = ?`,
          [dbName, payload.db?.user || null, payload.db?.password || null, SCHEMA_VERSION, bid]);
        await corePool.query("UPDATE businesses SET status = ? WHERE id = ?", [payload.prevStatus || "active", bid]);
        forgetTenant(bid);
        await mirrorToTenant(bid);
        // the old rows leave the central database (they are in the new database and in the backup)
        await conn.query("SET FOREIGN_KEY_CHECKS = 0");
        await conn.beginTransaction();
        for (const t of [...(payload.tables || [])].sort((a, b) => Number(Boolean(CHILD_TABLES[b])) - Number(Boolean(CHILD_TABLES[a])))) {
          if (KEEP_IN_CORE.has(t)) continue;
          if (CHILD_TABLES[t]) {
            const [fk, parent] = CHILD_TABLES[t];
            await conn.query(`DELETE x FROM ${q(t)} x JOIN ${q(parent)} p ON p.id = x.${q(fk)} WHERE p.business_id = ?`, [bid]);
          } else if (t === "audit_logs") {
            await conn.query("DELETE FROM audit_logs WHERE business_id = ? AND platform_admin_id IS NULL", [bid]);   // super admin actions stay central
          } else {
            await conn.query(`DELETE FROM ${q(t)} WHERE business_id = ?`, [bid]);
          }
        }
        await conn.commit();
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
      }
      await setStep(job.id, steps, s.key, "done");
    }
    await corePool.query("UPDATE provisioning_jobs SET status = 'succeeded', finished_at = UTC_TIMESTAMP(), payload = NULL WHERE id = ?", [job.id]);
    await adminAudit(corePool, { adminId: job.admin_id, businessId: bid, action: "admin.business_moved", meta: { database: dbName, tables: (payload.tables || []).length } });
  } catch (err) {
    await conn.rollback().catch(() => {});
    await conn.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    // back to how it was: shared database, old status; the half-made copy is removed
    const [[reg]] = await corePool.query("SELECT mode FROM database_registry WHERE business_id = ?", [bid]);
    if (reg?.mode !== "dedicated") {
      await conn.query(`DROP DATABASE IF EXISTS ${q(dbName)}`).catch(() => {});
      await corePool.query("UPDATE database_registry SET status = 'ready', last_error = ? WHERE business_id = ?", [safeError(err), bid]);
      await corePool.query("UPDATE businesses SET status = ? WHERE id = ? AND status = 'provisioning'", [payload.prevStatus || "active", bid]);
    }
    forgetTenant(bid);
    throw err;
  } finally {
    conn.release();
  }
}

/** Starts moving a shared business into its own database; returns the job id. */
export async function startMove(businessId, adminId) {
  const reg = await registryOf(businessId);
  const [[biz]] = await corePool.query("SELECT id, status FROM businesses WHERE id = ?", [businessId]);
  if (!biz || !reg) return { error: "notFound" };
  if (reg.mode !== "shared" || reg.status !== "ready") return { error: "notShared" };
  if (["pending", "provisioning"].includes(biz.status)) return { error: "notReady" };
  const [j] = await corePool.query("INSERT INTO provisioning_jobs (business_id, status, payload, admin_id) VALUES (?, 'pending', ?, ?)",
    [businessId, JSON.stringify({ kind: "move", prevStatus: biz.status }), adminId]);
  runJob(j.insertId);
  return { jobId: j.insertId };
}

/** Jobs left "running" by a restart become "failed" (so they can be retried). */
export async function recoverJobs() {
  await corePool.query("UPDATE provisioning_jobs SET status = 'failed', error = 'Interrupted (server restarted)' WHERE status = 'running'");
}
