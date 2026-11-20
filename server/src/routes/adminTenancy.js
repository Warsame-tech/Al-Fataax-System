/*
 * Super admin — architecture update (mounted on /api/admin by routes/admin.js, after sign-in and "view"):
 *
 *   GET    /setup                               what the registration form needs (types, plans, domain, database mode)
 *   GET    /slug-check?slug=                    is this subdomain free?
 *   POST   /businesses                          register a business → provisioning job (perm provision)
 *   GET    /businesses/:id/provisioning         the job's steps and the database registry entry
 *   POST   /businesses/:id/provisioning/retry   run a failed job again (perm provision)
 *   GET    /hosting                             every business's address, subdomain and custom domains
 *   PATCH  /businesses/:id/slug                 change a subdomain (perm hosting)
 *   POST   /businesses/:id/domains              add a custom domain (perm hosting)
 *   POST   /domains/:id/verify                  check its DNS TXT record (perm hosting)
 *   PATCH  /domains/:id                         make primary (perm hosting) · DELETE /domains/:id
 *   GET    /databases                           the database registry with sizes and schema versions (perm databases)
 *   POST   /databases/:businessId/test          connect to a business database (perm databases)
 *   POST   /databases/:businessId/migrate       bring one database to the current schema (perm databases)
 *   POST   /databases/migrate-all               every own database (perm databases)
 *   GET    /backups · POST /backups · GET /backups/:id/download · DELETE /backups/:id   (perm backups)
 *   GET    /branches-overview                   every business's branches, users and sales (30 days), limits
 *   PATCH  /businesses/:id/branch-limit         a branch limit for one business (perm businesses)
 */
import fs from "node:fs";
import dns from "node:dns";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { corePool } from "../config/db.js";
import { env } from "../config/env.js";
import { SCHEMA_VERSION } from "../config/migrate.js";
import { ah, id, text, optText, num, badRequest, conflict } from "../lib/http.js";
import { requireAdminPerm, adminAudit, platformSettings } from "../lib/platform.js";
import { withTenant, registryOf, forgetSlugs, mirrorToTenant, forgetTenant } from "../lib/tenancy.js";
import { slugify, slugProblem, freeSlug } from "../lib/slugs.js";
import { runJob, dbNameFor, migrateBusinessDb, migrateAllBusinessDbs } from "../lib/provisioning.js";
import { makeBackup, backupPath, BACKUP_DIR } from "../lib/backups.js";

const db = corePool;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9\s-]{7,20}$/;
const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;
const DOMAIN = /^(?=.{4,190}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const tempPassword = () => `${crypto.randomBytes(7).toString("base64url").replace(/[-_]/g, "x")}${crypto.randomInt(10, 99)}`;
const urlOf = (slug) => (env.baseDomain ? `https://${slug}.${env.baseDomain}` : null);
const linkOf = (slug) => `/b/${slug}`;
const job = (j) => j && ({ id: j.id, status: j.status, step: j.step, error: j.error, attempts: j.attempts, createdAt: j.created_at, finishedAt: j.finished_at,
  steps: (() => { try { return JSON.parse(j.steps || "[]"); } catch { return []; } })() });
const reg = (r) => r && ({ mode: r.mode, database: r.mode === "dedicated" ? r.db_name : null, user: r.db_user || null, status: r.status,
  schemaVersion: r.schema_version, lastMigratedAt: r.last_migrated_at, lastBackupAt: r.last_backup_at, lastError: r.last_error });

export function tenancyRoutes(router) {
  /* ===================== registration ===================== */
  router.get("/setup", ah(async (req, res) => {
    const [types] = await db.query("SELECT code, name, is_active FROM business_types ORDER BY sort_order, name");
    const [plans] = await db.query("SELECT id, name, price_monthly, price_yearly, max_users, max_branches, max_products FROM plans WHERE is_active = 1 ORDER BY sort_order, id");
    const s = await platformSettings();
    res.json({ types: types.map((t) => ({ code: t.code, name: t.name, active: Boolean(t.is_active) && !s.disabledTypes.includes(t.code) })),
      plans: plans.map((p) => ({ id: p.id, name: p.name, monthly: num(p.price_monthly), yearly: num(p.price_yearly), maxUsers: p.max_users, maxBranches: p.max_branches, maxProducts: p.max_products })),
      trialDays: s.trialDays, baseDomain: env.baseDomain || null, dbMode: env.tenantDbMode, dbUsers: env.tenantDbUsers, keySet: Boolean(env.tenantDbKey), production: env.isProd });
  }));

  router.get("/slug-check", ah(async (req, res) => {
    const s = String(req.query.slug || "").toLowerCase().trim();
    const problem = slugProblem(s);
    if (problem) return res.json({ ok: false, reason: problem, suggestion: await freeSlug(db, slugify(s || req.query.name || "business")) });
    const [[t]] = await db.query("SELECT id FROM businesses WHERE slug = ?", [s]);
    res.json(t ? { ok: false, reason: "slugTaken", suggestion: await freeSlug(db, s) } : { ok: true, url: urlOf(s), link: linkOf(s) });
  }));

  router.post("/businesses", requireAdminPerm("provision"), ah(async (req, res) => {
    const b = req.body || {};
    const s = await platformSettings();
    const d = {
      name: text(b.name, 150), slug: String(b.slug || "").toLowerCase().trim(), type: text(b.type, 40), phone: text(b.phone, 30), email: optText(b.email, 190)?.toLowerCase() || null,
      address: optText(b.address, 255), ownerName: text(b.ownerName, 150), username: text(b.username, 30).toLowerCase(), ownerEmail: optText(b.ownerEmail, 190)?.toLowerCase() || null,
      ownerPhone: optText(b.ownerPhone, 30), password: typeof b.password === "string" ? b.password : "", branchName: text(b.branchName, 100) || "Main branch",
      planId: id(b.planId), cycle: b.cycle === "yearly" ? "yearly" : "monthly", trialDays: b.trialDays === "" || b.trialDays === undefined || b.trialDays === null ? Number(s.trialDays) : Number(b.trialDays),
      maxBranches: b.maxBranches === "" || b.maxBranches === undefined || b.maxBranches === null ? null : Number(b.maxBranches),
      dbMode: b.dbMode === "shared" || b.dbMode === "dedicated" ? b.dbMode : env.tenantDbMode
    };
    const e = {};
    if (d.name.length < 2) e.name = "required";
    const sp = slugProblem(d.slug);
    if (sp) e.slug = sp;
    const [[type]] = await db.query("SELECT code FROM business_types WHERE code = ? AND is_active = 1", [d.type]);
    if (!type) e.type = "required";
    if (!PHONE.test(d.phone)) e.phone = "invalidPhone";
    if (d.email && !EMAIL.test(d.email)) e.email = "invalidEmail";
    if (d.ownerName.length < 2) e.ownerName = "required";
    if (!USERNAME.test(d.username)) e.username = "invalidUsername";
    if (d.ownerEmail && !EMAIL.test(d.ownerEmail)) e.ownerEmail = "invalidEmail";
    if (d.password && (d.password.length < 8 || d.password.length > 200)) e.password = "passwordWeak";
    if (!Number.isInteger(d.trialDays) || d.trialDays < 0 || d.trialDays > 365) e.trialDays = "invalidAmount";
    if (d.maxBranches !== null && (!Number.isInteger(d.maxBranches) || d.maxBranches < 1 || d.maxBranches > 500)) e.maxBranches = "invalidAmount";
    if (d.planId) { const [[p]] = await db.query("SELECT id FROM plans WHERE id = ? AND is_active = 1", [d.planId]); if (!p) e.planId = "required"; }
    if (!sp) { const [[t]] = await db.query("SELECT id FROM businesses WHERE slug = ?", [d.slug]); if (t) e.slug = "slugTaken"; }
    // shared businesses share the users table: usernames must be free there
    if (!e.username && d.dbMode === "shared") { const [[u]] = await db.query("SELECT id FROM users WHERE username = ?", [d.username]); if (u) e.username = "usernameTaken"; }
    if (Object.keys(e).length) throw badRequest(e);
    if (d.dbMode === "dedicated" && env.isProd && !env.tenantDbKey) throw conflict("tenantKeyMissing");

    const generated = !d.password;
    const password = d.password || tempPassword();
    const passwordHash = await bcrypt.hash(password, 12);
    const conn = await db.getConnection();
    let businessId;
    let jobId;
    try {
      await conn.beginTransaction();
      const [biz] = await conn.query(
        `INSERT INTO businesses (name, slug, owner_name, email, phone, business_type, address, status, max_branches, terms_accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, UTC_TIMESTAMP())`, [d.name, d.slug, d.ownerName, d.email, d.phone, d.type, d.address, d.maxBranches]);
      businessId = biz.insertId;
      await conn.query("INSERT INTO trial_records (business_id, start_date, end_date) VALUES (?, UTC_DATE(), DATE_ADD(UTC_DATE(), INTERVAL ? DAY))", [businessId, d.trialDays]);
      if (d.planId) {
        await conn.query(`INSERT INTO subscriptions (business_id, plan_id, cycle, status, current_period_start, current_period_end)
          VALUES (?, ?, ?, 'active', UTC_DATE(), DATE_ADD(UTC_DATE(), INTERVAL ${d.cycle === "yearly" ? "1 YEAR" : "1 MONTH"}))`, [businessId, d.planId, d.cycle]);
      }
      await conn.query("INSERT INTO database_registry (business_id, mode, db_name, status) VALUES (?, ?, ?, 'pending')",
        [businessId, d.dbMode, d.dbMode === "dedicated" ? dbNameFor(d.slug, businessId) : null]);
      const [j] = await conn.query("INSERT INTO provisioning_jobs (business_id, status, payload, admin_id) VALUES (?, 'pending', ?, ?)", [businessId, JSON.stringify({
        owner: { name: d.ownerName, username: d.username, email: d.ownerEmail, phone: d.ownerPhone || d.phone, passwordHash }, branchName: d.branchName }), req.admin.id]);
      jobId = j.insertId;
      await conn.commit();
    } catch (err) {
      await conn.rollback().catch(() => {});
      if (err.code === "ER_DUP_ENTRY") throw badRequest({ slug: "slugTaken" });
      throw err;
    } finally { conn.release(); }
    await adminAudit(db, { adminId: req.admin.id, businessId, action: "admin.business_registered", meta: { name: d.name, slug: d.slug, mode: d.dbMode, plan: d.planId }, ip: req.ip });
    forgetSlugs();
    runJob(jobId);   // in the background; the page follows GET /businesses/:id/provisioning
    res.status(201).json({ businessId, jobId, owner: { username: d.username, password: generated ? password : null }, url: urlOf(d.slug), link: linkOf(d.slug) });
  }));

  router.get("/businesses/:id/provisioning", ah(async (req, res) => {
    const bid = id(req.params.id) || 0;
    const [[b]] = await db.query("SELECT id, name, slug, status FROM businesses WHERE id = ?", [bid]);
    if (!b) return res.status(404).json({ code: "notFound" });
    const [[j]] = await db.query("SELECT * FROM provisioning_jobs WHERE business_id = ? ORDER BY id DESC LIMIT 1", [bid]);
    res.json({ business: { id: b.id, name: b.name, slug: b.slug, status: b.status, url: urlOf(b.slug), link: linkOf(b.slug) }, job: job(j), database: reg(await registryOf(bid)) });
  }));

  router.post("/businesses/:id/provisioning/retry", requireAdminPerm("provision"), ah(async (req, res) => {
    const bid = id(req.params.id) || 0;
    const [[j]] = await db.query("SELECT * FROM provisioning_jobs WHERE business_id = ? ORDER BY id DESC LIMIT 1", [bid]);
    if (!j) return res.status(404).json({ code: "notFound" });
    if (j.status !== "failed") throw conflict("notFailed");
    if (!j.payload) throw conflict("jobExpired");
    forgetTenant(bid);
    // "pending" at once, so the setup page (and anyone polling) sees the retry before the job has started
    await db.query("UPDATE provisioning_jobs SET status = 'pending', error = NULL WHERE id = ? AND status = 'failed'", [j.id]);
    await adminAudit(db, { adminId: req.admin.id, businessId: bid, action: "admin.provisioning_retry", entity: "job", entityId: j.id, ip: req.ip });
    runJob(j.id);
    res.json({ code: "started" });
  }));

  /* ===================== hosting & domains ===================== */
  router.get("/hosting", ah(async (req, res) => {
    const [rows] = await db.query("SELECT id, name, slug, status, business_type FROM businesses ORDER BY name LIMIT 1000");
    const [domains] = await db.query("SELECT * FROM business_domains ORDER BY business_id, is_primary DESC, domain");
    res.json({
      baseDomain: env.baseDomain || null, appOrigin: env.clientOrigin,
      businesses: rows.map((b) => ({ id: b.id, name: b.name, slug: b.slug, status: b.status, type: b.business_type, url: urlOf(b.slug), link: linkOf(b.slug),
        domains: domains.filter((x) => x.business_id === b.id).map((x) => ({ id: x.id, domain: x.domain, status: x.status, primary: Boolean(x.is_primary),
          token: x.verify_token, checkedAt: x.checked_at, note: x.check_note })) }))
    });
  }));

  router.patch("/businesses/:id/slug", requireAdminPerm("hosting"), ah(async (req, res) => {
    const bid = id(req.params.id) || 0;
    const slug = String(req.body?.slug || "").toLowerCase().trim();
    const p = slugProblem(slug);
    if (p) throw badRequest({ slug: p });
    const [[t]] = await db.query("SELECT id FROM businesses WHERE slug = ? AND id <> ?", [slug, bid]);
    if (t) throw badRequest({ slug: "slugTaken" });
    const [[old]] = await db.query("SELECT slug FROM businesses WHERE id = ?", [bid]);
    if (!old) return res.status(404).json({ code: "notFound" });
    await db.query("UPDATE businesses SET slug = ? WHERE id = ?", [slug, bid]);
    await mirrorToTenant(bid);
    forgetSlugs();
    await adminAudit(db, { adminId: req.admin.id, businessId: bid, action: "admin.slug_changed", meta: { from: old.slug, to: slug }, ip: req.ip });
    res.json({ code: "saved", url: urlOf(slug), link: linkOf(slug) });
  }));

  router.post("/businesses/:id/domains", requireAdminPerm("hosting"), ah(async (req, res) => {
    const bid = id(req.params.id) || 0;
    const domain = String(req.body?.domain || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!DOMAIN.test(domain)) throw badRequest({ domain: "invalidDomain" });
    if (env.baseDomain && (domain === env.baseDomain || domain.endsWith(`.${env.baseDomain}`))) throw badRequest({ domain: "useSubdomain" });
    const [[b]] = await db.query("SELECT id FROM businesses WHERE id = ?", [bid]);
    if (!b) return res.status(404).json({ code: "notFound" });
    const token = crypto.randomBytes(12).toString("hex");
    try {
      await db.query("INSERT INTO business_domains (business_id, domain, verify_token) VALUES (?, ?, ?)", [bid, domain, token]);
    } catch (err) { if (err.code === "ER_DUP_ENTRY") throw badRequest({ domain: "domainTaken" }); throw err; }
    await adminAudit(db, { adminId: req.admin.id, businessId: bid, action: "admin.domain_added", meta: { domain }, ip: req.ip });
    res.status(201).json({ code: "saved", txtName: `_faatix-verify.${domain}`, txtValue: token });
  }));

  router.post("/domains/:id/verify", requireAdminPerm("hosting"), ah(async (req, res) => {
    const [[d]] = await db.query("SELECT * FROM business_domains WHERE id = ?", [id(req.params.id) || 0]);
    if (!d) return res.status(404).json({ code: "notFound" });
    let ok = false;
    let note;
    try {
      const txt = (await dns.promises.resolveTxt(`_faatix-verify.${d.domain}`)).map((r) => r.join(""));
      ok = txt.includes(d.verify_token);
      note = ok ? "TXT record found" : `TXT record has another value (${txt.slice(0, 2).join(", ").slice(0, 120)})`;
    } catch (err) { note = `No TXT record yet (${err.code || "lookup failed"})`; }
    await db.query("UPDATE business_domains SET status = ?, checked_at = UTC_TIMESTAMP(), check_note = ? WHERE id = ?", [ok ? "verified" : "pending", note, d.id]);
    if (ok) await adminAudit(db, { adminId: req.admin.id, businessId: d.business_id, action: "admin.domain_verified", meta: { domain: d.domain }, ip: req.ip });
    res.json({ verified: ok, note });
  }));

  router.patch("/domains/:id", requireAdminPerm("hosting"), ah(async (req, res) => {
    const [[d]] = await db.query("SELECT * FROM business_domains WHERE id = ?", [id(req.params.id) || 0]);
    if (!d) return res.status(404).json({ code: "notFound" });
    await db.query("UPDATE business_domains SET is_primary = (id = ?) WHERE business_id = ?", [d.id, d.business_id]);
    res.json({ code: "saved" });
  }));

  router.delete("/domains/:id", requireAdminPerm("hosting"), ah(async (req, res) => {
    const [[d]] = await db.query("SELECT * FROM business_domains WHERE id = ?", [id(req.params.id) || 0]);
    if (!d) return res.status(404).json({ code: "notFound" });
    await db.query("DELETE FROM business_domains WHERE id = ?", [d.id]);
    await adminAudit(db, { adminId: req.admin.id, businessId: d.business_id, action: "admin.domain_removed", meta: { domain: d.domain }, ip: req.ip });
    res.json({ code: "saved" });
  }));

  /* ===================== databases ===================== */
  router.get("/databases", requireAdminPerm("databases"), ah(async (req, res) => {
    const [rows] = await db.query(
      `SELECT r.*, b.name, b.slug, b.status business_status FROM database_registry r JOIN businesses b ON b.id = r.business_id ORDER BY r.mode = 'dedicated' DESC, b.name LIMIT 2000`);
    const names = [...new Set([env.db.database, ...rows.filter((r) => r.mode === "dedicated" && r.db_name).map((r) => r.db_name)])];
    const [sizes] = await db.query(
      `SELECT table_schema s, ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) mb, COUNT(*) tables FROM information_schema.tables WHERE table_schema IN (?) GROUP BY table_schema`, [names]);
    const size = Object.fromEntries(sizes.map((x) => [x.s, { mb: num(x.mb), tables: num(x.tables) }]));
    const [[coreVer]] = await db.query("SELECT MAX(version) v FROM schema_versions");
    const [[lastCore]] = await db.query("SELECT MAX(created_at) at FROM backups WHERE scope = 'core' AND status = 'done'");
    res.json({
      schemaVersion: SCHEMA_VERSION,
      core: { database: env.db.database, ...(size[env.db.database] || {}), schemaVersion: num(coreVer.v), shared: rows.filter((r) => r.mode === "shared").length, lastBackupAt: lastCore.at },
      databases: rows.map((r) => ({ businessId: r.business_id, name: r.name, slug: r.slug, businessStatus: r.business_status, ...reg(r),
        size: r.mode === "dedicated" ? size[r.db_name] || null : null, upToDate: num(r.schema_version) >= SCHEMA_VERSION }))
    });
  }));

  router.post("/databases/:businessId/test", requireAdminPerm("databases"), ah(async (req, res) => {
    const bid = id(req.params.businessId) || 0;
    const r = await registryOf(bid);
    if (!r) return res.status(404).json({ code: "notFound" });
    const t0 = Date.now();
    try {
      const out = await withTenant(bid, async (p) => {
        const [[x]] = await p.query("SELECT DATABASE() db, CURRENT_USER() user, (SELECT MAX(version) FROM schema_versions) v, (SELECT COUNT(*) FROM users WHERE business_id = ?) users", [bid]);
        return x;
      });
      res.json({ ok: true, ms: Date.now() - t0, database: out.db, user: String(out.user).replace(/@.*/, ""), schemaVersion: num(out.v), users: num(out.users) });
    } catch (err) {
      res.json({ ok: false, ms: Date.now() - t0, error: err.code || "failed" });
    }
  }));

  router.post("/databases/:businessId/migrate", requireAdminPerm("databases"), ah(async (req, res) => {
    const bid = id(req.params.businessId) || 0;
    const r = await registryOf(bid);
    if (!r) return res.status(404).json({ code: "notFound" });
    if (r.mode !== "dedicated") throw conflict("sharedDatabase");
    if (r.status !== "ready") throw conflict("notReady");
    try {
      const out = await migrateBusinessDb(bid);
      await adminAudit(db, { adminId: req.admin.id, businessId: bid, action: "admin.database_migrated", meta: out, ip: req.ip });
      res.json(out);
    } catch (err) { throw conflict("migrationFailed", { error: String(err.code || err.message).slice(0, 200) }); }
  }));

  router.post("/databases/migrate-all", requireAdminPerm("databases"), ah(async (req, res) => {
    const out = await migrateAllBusinessDbs();
    await adminAudit(db, { adminId: req.admin.id, action: "admin.database_migrated_all", meta: { count: out.length, failed: out.filter((x) => x.ok === false).length }, ip: req.ip });
    res.json({ results: out });
  }));

  /* ===================== backups ===================== */
  router.get("/backups", requireAdminPerm("backups"), ah(async (req, res) => {
    const [rows] = await db.query(
      `SELECT k.*, b.name business, pa.username admin FROM backups k LEFT JOIN businesses b ON b.id = k.business_id LEFT JOIN platform_admins pa ON pa.id = k.admin_id
        ORDER BY k.created_at DESC LIMIT 300`);
    const s = await platformSettings();
    res.json({ folder: BACKUP_DIR, daily: Boolean(s.dailyBackups), keep: s.keepBackups,
      backups: rows.map((k) => ({ id: k.id, scope: k.scope, businessId: k.business_id, business: k.business, file: k.file_name, size: num(k.size_bytes), tables: k.tables_count,
        rows: num(k.rows_count), status: k.status, error: k.error, admin: k.admin, at: k.created_at, exists: Boolean(backupPath(k.file_name) && fs.existsSync(backupPath(k.file_name))) })) });
  }));

  router.post("/backups", requireAdminPerm("backups"), ah(async (req, res) => {
    const scope = req.body?.scope === "business" ? "business" : "core";
    const bid = scope === "business" ? id(req.body?.businessId) : null;
    if (scope === "business") { const r = bid ? await registryOf(bid) : null; if (!r) throw badRequest({ businessId: "required" }); }
    const row = await makeBackup({ scope, businessId: bid, adminId: req.admin.id });
    await adminAudit(db, { adminId: req.admin.id, businessId: bid, action: "admin.backup", meta: { scope, file: row.file_name, status: row.status }, ip: req.ip });
    if (row.status !== "done") throw conflict("backupFailed", { error: row.error });
    res.status(201).json({ id: row.id, file: row.file_name, size: num(row.size_bytes) });
  }));

  router.get("/backups/:id/download", requireAdminPerm("backups"), ah(async (req, res) => {
    const [[k]] = await db.query("SELECT * FROM backups WHERE id = ?", [id(req.params.id) || 0]);
    const p = k && backupPath(k.file_name);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ code: "notFound" });
    await adminAudit(db, { adminId: req.admin.id, businessId: k.business_id, action: "admin.backup_downloaded", meta: { file: k.file_name }, ip: req.ip });
    res.download(p, k.file_name);
  }));

  router.delete("/backups/:id", requireAdminPerm("backups"), ah(async (req, res) => {
    const [[k]] = await db.query("SELECT * FROM backups WHERE id = ?", [id(req.params.id) || 0]);
    if (!k) return res.status(404).json({ code: "notFound" });
    const p = backupPath(k.file_name);
    if (p) await fs.promises.unlink(p).catch(() => {});
    await db.query("DELETE FROM backups WHERE id = ?", [k.id]);
    await adminAudit(db, { adminId: req.admin.id, businessId: k.business_id, action: "admin.backup_deleted", meta: { file: k.file_name }, ip: req.ip });
    res.json({ code: "saved" });
  }));

  /* ===================== branch overview ===================== */
  router.get("/branches-overview", ah(async (req, res) => {
    const [biz] = await db.query(
      `SELECT b.id, b.name, b.slug, b.status, b.max_branches, p.name plan, p.max_branches plan_max FROM businesses b
         LEFT JOIN subscriptions s ON s.business_id = b.id LEFT JOIN plans p ON p.id = s.plan_id
        WHERE b.status IN ('active','suspended','expired') ORDER BY b.name LIMIT 300`);
    const out = [];
    for (const b of biz) {
      let branches = [];
      try {
        branches = await withTenant(b.id, async (p) => {
          const [rows] = await p.query(
            `SELECT br.id, br.name, br.code, br.is_main, br.is_active, br.address, br.phone, mu.full_name manager,
                    (SELECT COUNT(DISTINCT x.user_id) FROM (SELECT user_id, branch_id FROM business_user_roles WHERE business_id = ? UNION SELECT user_id, branch_id FROM user_branch_access WHERE business_id = ?) x WHERE x.branch_id = br.id) users,
                    (SELECT COUNT(*) FROM sales s WHERE s.business_id = br.business_id AND s.branch_id = br.id AND s.sold_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) sales30
               FROM branches br LEFT JOIN users mu ON mu.id = br.manager_user_id WHERE br.business_id = ? ORDER BY br.is_main DESC, br.name`, [b.id, b.id, b.id]);
          return rows;
        });
      } catch (err) { branches = null; }
      const limit = b.max_branches ?? b.plan_max ?? null;
      out.push({ id: b.id, name: b.name, slug: b.slug, status: b.status, plan: b.plan, limit, limitFrom: b.max_branches !== null ? "business" : b.plan_max !== null ? "plan" : null,
        branches: branches && branches.map((x) => ({ id: x.id, name: x.name, code: x.code, main: Boolean(x.is_main), active: Boolean(x.is_active), address: x.address, phone: x.phone,
          manager: x.manager, users: num(x.users), sales30: num(x.sales30) })), unreachable: branches === null });
    }
    res.json({ businesses: out, totals: { businesses: out.length, branches: out.reduce((a, b) => a + (b.branches?.filter((x) => x.active).length || 0), 0) } });
  }));

  router.patch("/businesses/:id/branch-limit", requireAdminPerm("businesses"), ah(async (req, res) => {
    const bid = id(req.params.id) || 0;
    const v = req.body?.maxBranches;
    const limit = v === null || v === "" || v === undefined ? null : Number(v);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 500)) throw badRequest({ maxBranches: "invalidAmount" });
    const [r] = await db.query("UPDATE businesses SET max_branches = ? WHERE id = ?", [limit, bid]);
    if (!r.affectedRows) return res.status(404).json({ code: "notFound" });
    await adminAudit(db, { adminId: req.admin.id, businessId: bid, action: "admin.branch_limit", meta: { maxBranches: limit }, ip: req.ip });
    res.json({ code: "saved" });
  }));
}
