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
    if (job) {
      await corePool.query("UPDATE database_registry SET status = 'failed', last_error = ? WHERE business_id = ?", [msg, job.business_id]).catch(() => {});
      forgetTenant(job.business_id);
      await adminAudit(corePool, { adminId: job.admin_id, businessId: job.business_id, action: "admin.provisioning_failed", meta: { step: cur?.key, error: msg } }).catch(() => {});
    }
  } finally {
    running.delete(jobId);
  }
}

/** Jobs left "running" by a restart become "failed" (so they can be retried). */
export async function recoverJobs() {
  await corePool.query("UPDATE provisioning_jobs SET status = 'failed', error = 'Interrupted (server restarted)' WHERE status = 'running'");
}
