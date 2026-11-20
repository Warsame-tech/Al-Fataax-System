import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool, checkDatabase } from "../config/db.js";
import { env } from "../config/env.js";
import { audit } from "../middleware/auth.js";
import { ah, id, text, optText, num, badRequest, conflict } from "../lib/http.js";
import { ADMIN_ROLES, adminCan, requireAdminPerm, adminAudit, totpValid, newTotpSecret, totpUrl, planOf } from "../lib/platform.js";
import { platformRoutes } from "./adminPlatform.js";
import { withTenant, forEachDatabase, registryOf, mirrorToTenant } from "../lib/tenancy.js";
import { tenancyRoutes } from "./adminTenancy.js";

/*
 * Super Admin (platform owner). Completely separate from business users:
 * own table (platform_admins), own cookie, own routes. Business owners never get access.
 * Admins see business summaries and account status — not detailed financial records.
 * Each super admin has a role (lib/platform.js ADMIN_ROLES: owner, admin, technical, billing, support) that decides what they may do;
 * two-step sign-in (authenticator app code) can be switched on per admin in My account.
 */
const router = Router();
const ADMIN_COOKIE = "faatix_admin";

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, handler: (req, res) => res.status(429).json({ code: "tooManyAttempts" }) });
const DUMMY = bcrypt.hashSync("not-a-real-password", 12);

router.post("/sign-in", limiter, ah(async (req, res) => {
  const username = text(req.body?.username, 60).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const [[a]] = await pool.query("SELECT id, password_hash, status, totp_enabled, totp_secret FROM platform_admins WHERE username = ? OR email = ?", [username, username]);
  const ok = await bcrypt.compare(password, a ? a.password_hash : DUMMY);
  if (!a || !ok || a.status !== "active") {
    await pool.query("INSERT INTO audit_logs (platform_admin_id, action, meta, ip) VALUES (?, 'admin.login_failed', ?, ?)", [a?.id || null, JSON.stringify({ username }), req.ip]);
    return res.status(401).json({ code: "invalidCredentials" });
  }
  // two-step sign-in: the password was right, now the 6-digit code from the authenticator app
  if (a.totp_enabled) {
    if (!req.body?.code) return res.status(401).json({ code: "twoFactorRequired" });
    if (!totpValid(a.totp_secret, req.body.code)) return res.status(401).json({ code: "twoFactorWrong" });
  }
  await pool.query("UPDATE platform_admins SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [a.id]);
  await pool.query("INSERT INTO audit_logs (platform_admin_id, action, ip) VALUES (?, 'admin.login', ?)", [a.id, req.ip]);
  const token = jwt.sign({ aid: a.id, scope: "platform" }, env.jwtSecret, { expiresIn: "8h" });
  res.cookie(ADMIN_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: env.isProd, maxAge: 8 * 3600 * 1000, path: "/" });
  res.json({ code: "signedIn" });
}));

router.post("/sign-out", (req, res) => { res.clearCookie(ADMIN_COOKIE, { path: "/" }); res.json({ code: "signedOut" }); });

/* Everything below requires a platform admin session. */
router.use(ah(async (req, res, next) => {
  try {
    const p = jwt.verify(req.cookies?.[ADMIN_COOKIE] || "", env.jwtSecret);
    if (p.scope !== "platform") throw new Error();
    const [[a]] = await pool.query("SELECT id, username, email, status, role, totp_enabled FROM platform_admins WHERE id = ?", [p.aid]);
    if (!a || a.status !== "active") throw new Error();
    req.admin = a;
    next();
  } catch {
    res.status(401).json({ code: "unauthenticated" });
  }
}));

router.get("/me", (req, res) => res.json({ admin: { id: req.admin.id, username: req.admin.username, email: req.admin.email, role: req.admin.role,
  permissions: ADMIN_ROLES[req.admin.role] || [], twoFactor: Boolean(req.admin.totp_enabled) } }));
router.use(requireAdminPerm("view"));   // every page below needs at least "view"

/* GET /api/admin/overview — platform totals and health */
router.get("/overview", ah(async (req, res) => {
  const db = await checkDatabase();
  const [[c]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM businesses) businesses,
            (SELECT COUNT(*) FROM businesses WHERE status = 'active') active,
            (SELECT COUNT(*) FROM businesses WHERE status = 'suspended') suspended,
            (SELECT COUNT(*) FROM users) users,
            (SELECT COUNT(*) FROM businesses WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) new30,
            (SELECT COUNT(*) FROM sales) sales, (SELECT COUNT(*) FROM invoices) invoices,
            (SELECT COUNT(*) FROM trial_records WHERE status = 'active' AND end_date >= UTC_DATE()) trials`);
  // users, sales and invoices of businesses with their own database are counted there
  const extra = await forEachDatabase(async (p, { businessId }) => {
    if (!businessId) return null;
    const [[x]] = await p.query("SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM sales) sales, (SELECT COUNT(*) FROM invoices) invoices");
    return x;
  });
  for (const x of extra.filter(Boolean)) for (const k of ["users", "sales", "invoices"]) c[k] = num(c[k]) + num(x[k]);
  const [[size]] = await pool.query("SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) mb FROM information_schema.tables WHERE table_schema = DATABASE()");
  res.json({ counts: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, num(v)])), health: { database: db.ok ? "connected" : "down", sizeMb: num(size.mb), uptimeSec: Math.round(process.uptime()), node: process.version } });
}));

/* GET /api/admin/businesses?q=&status=&since=<days>&type= (the sidebar's Businesses sub-menus) */
router.get("/businesses", ah(async (req, res) => {
  const where = ["1=1"];
  const params = [];
  const q = text(req.query.q, 80);
  if (q) { where.push("(b.name LIKE ? OR b.phone LIKE ? OR b.owner_name LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (BUSINESS_STATUSES.includes(req.query.status)) { where.push("b.status = ?"); params.push(req.query.status); }
  const since = Number(req.query.since);
  if (since > 0 && since <= 3650) { where.push("b.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)"); params.push(since); }
  const type = text(req.query.type, 60);
  if (type) { where.push("b.business_type = ?"); params.push(type); }
  const [rows] = await pool.query(
    `SELECT b.id, b.name, b.slug, b.owner_name, b.phone, b.email, b.business_type, b.logo_path, b.status, b.created_at, dr.mode db_mode,
            (SELECT COUNT(*) FROM users u WHERE u.business_id = b.id) users,
            (SELECT COUNT(*) FROM sales s WHERE s.business_id = b.id) + (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) transactions,
            (SELECT MAX(created_at) FROM audit_logs a WHERE a.business_id = b.id) last_activity,
            (SELECT CONCAT(status, '|', end_date) FROM trial_records t WHERE t.business_id = b.id ORDER BY t.id DESC LIMIT 1) trial
       FROM businesses b LEFT JOIN database_registry dr ON dr.business_id = b.id WHERE ${where.join(" AND ")} ORDER BY b.created_at DESC LIMIT 500`, params);
  for (const b of rows.filter((x) => x.db_mode === "dedicated" && x.status !== "pending" && x.status !== "provisioning")) {
    try {
      const [[x]] = await withTenant(b.id, (p) => p.query(
        `SELECT (SELECT COUNT(*) FROM users WHERE business_id = ?) users, (SELECT COUNT(*) FROM sales WHERE business_id = ?) + (SELECT COUNT(*) FROM invoices WHERE business_id = ?) transactions,
                (SELECT MAX(created_at) FROM audit_logs WHERE business_id = ?) last_activity`, [b.id, b.id, b.id, b.id]));
      Object.assign(b, x);
    } catch { /* database not reachable: shown as 0 */ }
  }
  res.json({ businesses: rows.map((b) => {
    const [tStatus, tEnd] = String(b.trial || "|").split("|");
    return { id: b.id, name: b.name, slug: b.slug, database: b.db_mode || "shared", owner: b.owner_name, phone: b.phone, email: b.email, type: b.business_type, logoPath: b.logo_path, status: b.status,
      createdAt: b.created_at, users: num(b.users), transactions: num(b.transactions), lastActivity: b.last_activity, trial: tStatus ? { status: tStatus, endDate: tEnd } : null };
  }) });
}));

/* GET /api/admin/businesses/:id — users, roles and usage summary (no line-level financial records) */
router.get("/businesses/:id", ah(async (req, res) => {
  const bid = id(req.params.id);
  const [[b]] = await pool.query("SELECT * FROM businesses WHERE id = ?", [bid || 0]);
  if (!b) return res.status(404).json({ code: "notFound" });
  const ready = !["pending", "provisioning"].includes(b.status);
  const t = ready ? await withTenant(bid, async (tp) => {
  const [users] = await tp.query(
    `SELECT u.id, u.full_name, u.username, u.status, u.last_login_at, r.role, ro.name role_name FROM users u JOIN business_user_roles r ON r.user_id = u.id
       LEFT JOIN roles ro ON ro.id = r.role_id AND ro.business_id = u.business_id
      WHERE u.business_id = ? ORDER BY r.role = 'owner' DESC, ro.name, u.full_name`, [bid]);
  const [[usage]] = await tp.query(
    `SELECT (SELECT COUNT(*) FROM products WHERE business_id = ?) products, (SELECT COUNT(*) FROM customers WHERE business_id = ?) customers,
            (SELECT COUNT(*) FROM sales WHERE business_id = ?) sales, (SELECT COUNT(*) FROM invoices WHERE business_id = ?) invoices,
            (SELECT COUNT(*) FROM purchases WHERE business_id = ?) purchases,
            (SELECT COUNT(*) FROM sales WHERE business_id = ? AND sold_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) sales30`,
    [bid, bid, bid, bid, bid, bid]);
  const [logs] = await tp.query("SELECT a.action, a.created_at, u.full_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.business_id = ? ORDER BY a.id DESC LIMIT 25", [bid]);
  const [[owner]] = await tp.query("SELECT u.id, u.username FROM users u JOIN business_user_roles r ON r.user_id = u.id AND r.role = 'owner' WHERE u.business_id = ? LIMIT 1", [bid]);
  return { users, usage, logs, owner };
  }).catch(() => null) : null;
  const { users = [], usage = {}, logs = [], owner = null } = t || {};
  const [[trial]] = await pool.query("SELECT start_date, end_date, status FROM trial_records WHERE business_id = ? ORDER BY id DESC LIMIT 1", [bid]);
  const r = await registryOf(bid);
  const [[job]] = await pool.query("SELECT status, step, error FROM provisioning_jobs WHERE business_id = ? ORDER BY id DESC LIMIT 1", [bid]);
  // platform side: plan and payments, internal notes, support tickets
  const plan = await planOf(pool, bid);
  const [payments] = await pool.query(
    `SELECT sp.id, sp.amount, sp.method, sp.reference, sp.period_start, sp.period_end, sp.paid_at, sp.notes, p.name plan, pa.username admin FROM subscription_payments sp
       LEFT JOIN plans p ON p.id = sp.plan_id LEFT JOIN platform_admins pa ON pa.id = sp.admin_id WHERE sp.business_id = ? ORDER BY sp.paid_at DESC LIMIT 50`, [bid]);
  const [notes] = await pool.query("SELECT n.id, n.note, n.created_at, pa.username admin FROM business_notes n LEFT JOIN platform_admins pa ON pa.id = n.admin_id WHERE n.business_id = ? ORDER BY n.id DESC", [bid]);
  const [tickets] = await pool.query("SELECT id, subject, status, priority, updated_at FROM support_tickets WHERE business_id = ? ORDER BY updated_at DESC LIMIT 20", [bid]);
  await pool.query("INSERT INTO audit_logs (platform_admin_id, business_id, action, ip) VALUES (?, ?, 'admin.viewed_business', ?)", [req.admin.id, bid, req.ip]);
  res.json({
    business: { id: b.id, name: b.name, slug: b.slug, owner: b.owner_name, phone: b.phone, email: b.email, type: b.business_type, address: b.address, logoPath: b.logo_path, status: b.status, createdAt: b.created_at,
      maxBranches: b.max_branches, url: env.baseDomain && b.slug ? `https://${b.slug}.${env.baseDomain}` : null, link: b.slug ? `/b/${b.slug}` : null },
    database: r ? { mode: r.mode, name: r.mode === "dedicated" ? r.db_name : null, status: r.status, schemaVersion: r.schema_version, lastBackupAt: r.last_backup_at } : null,
    provisioning: job ? { status: job.status, step: job.step, error: job.error } : null,
    reachable: Boolean(t),
    users: users.map((u) => ({ id: u.id, fullName: u.full_name, username: u.username, status: u.status, role: u.role === 'owner' ? 'owner' : 'staff', roleName: u.role_name || null, lastLoginAt: u.last_login_at })),
    usage: Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, num(v)])),
    trial: trial || null,
    activity: logs.map((l) => ({ action: l.action, at: l.created_at, user: l.full_name })),
    subscription: plan ? { planId: plan.id, plan: plan.name, cycle: plan.cycle, status: plan.status, periodEnd: plan.current_period_end,
      price: num(plan.cycle === "yearly" ? plan.price_yearly : plan.price_monthly) } : null,
    payments: payments.map((x) => ({ id: x.id, amount: num(x.amount), method: x.method, reference: x.reference, periodStart: x.period_start, periodEnd: x.period_end,
      paidAt: x.paid_at, notes: x.notes, plan: x.plan, admin: x.admin })),
    notes: notes.map((n) => ({ id: n.id, note: n.note, at: n.created_at, admin: n.admin })),
    tickets: tickets.map((x) => ({ id: x.id, subject: x.subject, status: x.status, priority: x.priority, updatedAt: x.updated_at })),
    owner: owner ? { id: owner.id, username: owner.username } : null
  });
}));

/* PATCH /api/admin/businesses/:id { status: active|suspended|deactivated, reason } */
router.patch("/businesses/:id", requireAdminPerm("businesses"), ah(async (req, res) => {
  const bid = id(req.params.id);
  const status = req.body?.status;
  const reason = text(req.body?.reason, 200);
  if (!["active", "suspended", "expired", "archived", "deactivated"].includes(status)) throw badRequest({ status: "required" });
  if (status !== "active" && !reason) throw badRequest({ reason: "required" });
  const r0 = await registryOf(bid || 0);
  if (status === "active" && r0 && r0.status !== "ready") throw conflict("notProvisioned");
  const [r] = await pool.query("UPDATE businesses SET status = ? WHERE id = ?", [status, bid || 0]);
  if (!r.affectedRows) return res.status(404).json({ code: "notFound" });
  await mirrorToTenant(bid);
  await pool.query("INSERT INTO audit_logs (platform_admin_id, business_id, action, meta, ip) VALUES (?, ?, 'admin.business_status', ?, ?)",
    [req.admin.id, bid, JSON.stringify({ status, reason }), req.ip]);
  res.json({ code: "saved" });
}));

/* PATCH /api/admin/businesses/:id/trial { days } — extend the business's trial by 1–90 days (from its end, or from today if it ended) */
router.patch("/businesses/:id/trial", requireAdminPerm("businesses"), ah(async (req, res) => {
  const bid = id(req.params.id);
  const days = Number(req.body?.days);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw badRequest({ days: "invalidAmount" });
  const [[t]] = await pool.query("SELECT id, end_date FROM trial_records WHERE business_id = ? ORDER BY id DESC LIMIT 1", [bid || 0]);
  if (!t) return res.status(404).json({ code: "notFound" });
  await pool.query("UPDATE trial_records SET end_date = DATE_ADD(GREATEST(end_date, UTC_DATE()), INTERVAL ? DAY), status = 'active' WHERE id = ?", [days, t.id]);
  await pool.query("INSERT INTO audit_logs (platform_admin_id, business_id, action, meta, ip) VALUES (?, ?, 'admin.trial_extended', ?, ?)", [req.admin.id, bid, JSON.stringify({ days }), req.ip]);
  res.json({ code: "saved" });
}));

const BUSINESS_STATUSES = ["pending", "provisioning", "active", "suspended", "expired", "archived", "deactivated"];
const TYPES = ["supermarket", "cosmetics", "fashion", "pharmacy", "electronics", "jewelry", "fabric", "restaurant", "cafe", "fast_food", "bakery", "juice_bar", "food_truck", "takeaway", "food_other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tempPassword = () => `${crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x")}${crypto.randomInt(10, 99)}`;

/* PUT /api/admin/businesses/:id { name, ownerName, phone, email, address, type } — correct a business's details */
router.put("/businesses/:id", requireAdminPerm("businesses"), ah(async (req, res) => {
  const bid = id(req.params.id);
  const b = req.body || {};
  const d = { name: text(b.name, 150), owner: text(b.ownerName, 150), phone: text(b.phone, 30), email: optText(b.email, 190), address: optText(b.address, 255), type: text(b.type, 60) };
  const e = {};
  if (!d.name) e.name = "required";
  if (!d.owner) e.ownerName = "required";
  if (!d.phone) e.phone = "required";
  if (d.email && !EMAIL.test(d.email)) e.email = "invalidEmail";
  if (!TYPES.includes(d.type)) e.type = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const [[old]] = await pool.query("SELECT name, owner_name, phone, email, address, business_type FROM businesses WHERE id = ?", [bid || 0]);
  if (!old) return res.status(404).json({ code: "notFound" });
  await pool.query("UPDATE businesses SET name = ?, owner_name = ?, phone = ?, email = ?, address = ?, business_type = ? WHERE id = ?", [d.name, d.owner, d.phone, d.email, d.address, d.type, bid]);
  await mirrorToTenant(bid);
  await adminAudit(pool, { adminId: req.admin.id, businessId: bid, action: "admin.business_edited", meta: { before: old, after: d }, ip: req.ip });
  res.json({ code: "saved" });
}));

/* POST /api/admin/businesses/:id/reset-owner-password — a new password for the owner, shown once (they should change it) */
router.post("/businesses/:id/reset-owner-password", requireAdminPerm("businesses"), ah(async (req, res) => {
  const bid = id(req.params.id);
  const password = tempPassword();
  const hash = await bcrypt.hash(password, 12);
  const o = await withTenant(bid || 0, async (tp) => {
    const [[u]] = await tp.query("SELECT u.id, u.username FROM users u JOIN business_user_roles r ON r.user_id = u.id AND r.role = 'owner' WHERE u.business_id = ? LIMIT 1", [bid || 0]);
    if (u) await tp.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, u.id]);
    return u;
  });
  if (!o) return res.status(404).json({ code: "notFound" });
  await adminAudit(pool, { adminId: req.admin.id, businessId: bid, action: "admin.owner_password_reset", entity: "user", entityId: o.id, ip: req.ip });
  res.json({ username: o.username, password });
}));

/* POST /api/admin/businesses/:id/sign-out-all — every user of the business is signed out now */
router.post("/businesses/:id/sign-out-all", requireAdminPerm("security"), ah(async (req, res) => {
  const bid = id(req.params.id);
  const [r] = await pool.query("UPDATE businesses SET sessions_valid_after = UTC_TIMESTAMP() WHERE id = ?", [bid || 0]);
  if (!r.affectedRows) return res.status(404).json({ code: "notFound" });
  await adminAudit(pool, { adminId: req.admin.id, businessId: bid, action: "admin.signed_out_all", ip: req.ip });
  res.json({ code: "saved" });
}));

/* notes about a business, seen only by super admins */
router.post("/businesses/:id/notes", requireAdminPerm("notes"), ah(async (req, res) => {
  const bid = id(req.params.id);
  const note = text(req.body?.note, 2000);
  if (!note) throw badRequest({ note: "required" });
  const [[b]] = await pool.query("SELECT id FROM businesses WHERE id = ?", [bid || 0]);
  if (!b) return res.status(404).json({ code: "notFound" });
  await pool.query("INSERT INTO business_notes (business_id, admin_id, note) VALUES (?, ?, ?)", [bid, req.admin.id, note]);
  res.status(201).json({ code: "saved" });
}));
router.delete("/businesses/:id/notes/:noteId", requireAdminPerm("notes"), ah(async (req, res) => {
  await pool.query("DELETE FROM business_notes WHERE id = ? AND business_id = ?", [id(req.params.noteId) || 0, id(req.params.id) || 0]);
  res.json({ code: "saved" });
}));

/* GET /api/admin/business-types — how many businesses of each type (and how many are active) */
router.get("/business-types", ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT business_type type, COUNT(*) n, SUM(status = 'active') active, MAX(created_at) latest FROM businesses GROUP BY business_type ORDER BY n DESC`);
  res.json({ types: rows.map((r) => ({ type: r.type, count: num(r.n), active: num(r.active), latest: r.latest })) });
}));

/* GET /api/admin/trials?filter=active|ending|expired — trials (ending: active and ending within 7 days) */
router.get("/trials", ah(async (req, res) => {
  const f = req.query.filter;
  const where = f === "ending" ? "t.status = 'active' AND t.end_date BETWEEN UTC_DATE() AND DATE_ADD(UTC_DATE(), INTERVAL 7 DAY)"
    : f === "expired" ? "(t.status = 'expired' OR (t.status = 'active' AND t.end_date < UTC_DATE()))"
    : "t.status = 'active' AND t.end_date >= UTC_DATE()";
  const [rows] = await pool.query(
    `SELECT t.business_id, t.start_date, t.end_date, t.status, DATEDIFF(t.end_date, UTC_DATE()) days_left, b.name, b.owner_name, b.phone, b.status business_status
       FROM trial_records t JOIN businesses b ON b.id = t.business_id
      WHERE t.id = (SELECT MAX(t2.id) FROM trial_records t2 WHERE t2.business_id = t.business_id) AND ${where}
      ORDER BY t.end_date LIMIT 500`);
  res.json({ trials: rows.map((r) => ({ businessId: r.business_id, name: r.name, owner: r.owner_name, phone: r.phone, businessStatus: r.business_status,
    start: r.start_date, end: r.end_date, status: r.status, daysLeft: num(r.days_left) })) });
}));

/* GET /api/admin/users?q=&status= — every business user (name, username, business, role, last sign-in) — no passwords */
router.get("/users", ah(async (req, res) => {
  const where = ["1=1"];
  const params = [];
  const q = text(req.query.q, 80);
  if (q) { where.push("(u.full_name LIKE ? OR u.username LIKE ? OR u.phone LIKE ? OR b.name LIKE ?)"); params.push(...Array(4).fill(`%${q}%`)); }
  if (["active", "disabled"].includes(req.query.status)) { where.push("u.status = ?"); params.push(req.query.status); }
  // every database: the central one (shared businesses) and each business's own
  const parts = await forEachDatabase(async (p, { businessId }) => {
    const [x] = await p.query(
      `SELECT u.id, u.full_name, u.username, u.phone, u.status, u.last_login_at, u.created_at, r.role, ro.name role_name, b.id business_id, b.name business
         FROM users u JOIN businesses b ON b.id = u.business_id LEFT JOIN business_user_roles r ON r.user_id = u.id AND r.business_id = u.business_id
         LEFT JOIN roles ro ON ro.id = r.role_id AND ro.business_id = u.business_id
        WHERE ${where.join(" AND ")}${businessId ? " AND u.business_id = " + Number(businessId) : ""} ORDER BY u.last_login_at IS NULL, u.last_login_at DESC LIMIT 500`, params);
    return x;
  });
  const rows = parts.flat().sort((a, z) => String(z.last_login_at || "").localeCompare(String(a.last_login_at || ""))).slice(0, 500);
  res.json({ users: rows.map((u) => ({ id: u.id, name: u.full_name, username: u.username, phone: u.phone, status: u.status, lastLoginAt: u.last_login_at, createdAt: u.created_at,
    role: u.role === "owner" ? "owner" : u.role_name || u.role, businessId: u.business_id, business: u.business })) });
}));

/* GET /api/admin/admins — the platform's super admins */
router.get("/admins", ah(async (req, res) => {
  const [rows] = await pool.query("SELECT id, username, email, role, status, totp_enabled, last_login_at, created_at FROM platform_admins ORDER BY id");
  res.json({ roles: Object.keys(ADMIN_ROLES), admins: rows.map((a) => ({ id: a.id, username: a.username, email: a.email, role: a.role, status: a.status, twoFactor: Boolean(a.totp_enabled),
    lastLoginAt: a.last_login_at, createdAt: a.created_at, me: a.id === req.admin.id })) });
}));

/* owners manage super admins: add one (a password is made and shown once), change role / status, reset a password */
const activeOwners = async () => Number((await pool.query("SELECT COUNT(*) n FROM platform_admins WHERE role = 'owner' AND status = 'active'"))[0][0].n);
router.post("/admins", requireAdminPerm("admins"), ah(async (req, res) => {
  const username = text(req.body?.username, 60).toLowerCase();
  const email = optText(req.body?.email, 190);
  const role = req.body?.role;
  const e = {};
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) e.username = "invalidUsername";
  if (email && !EMAIL.test(email)) e.email = "invalidEmail";
  if (!ADMIN_ROLES[role]) e.role = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const [[taken]] = await pool.query("SELECT id FROM platform_admins WHERE username = ? OR (email IS NOT NULL AND email = ?)", [username, email || ""]);
  if (taken) throw badRequest({ username: "usernameTaken" });
  const password = tempPassword();
  const [r] = await pool.query("INSERT INTO platform_admins (username, email, role, password_hash) VALUES (?, ?, ?, ?)", [username, email, role, await bcrypt.hash(password, 12)]);
  await adminAudit(pool, { adminId: req.admin.id, action: "admin.admin_created", entity: "platform_admin", entityId: r.insertId, meta: { username, role }, ip: req.ip });
  res.status(201).json({ id: r.insertId, username, password });
}));
router.patch("/admins/:id", requireAdminPerm("admins"), ah(async (req, res) => {
  const aid = id(req.params.id);
  const [[a]] = await pool.query("SELECT id, role, status FROM platform_admins WHERE id = ?", [aid || 0]);
  if (!a) return res.status(404).json({ code: "notFound" });
  const role = req.body?.role === undefined ? a.role : req.body.role;
  const status = req.body?.status === undefined ? a.status : req.body.status;
  if (!ADMIN_ROLES[role] || !["active", "disabled"].includes(status)) throw badRequest({ role: "required" });
  if (a.id === req.admin.id && (role !== a.role || status !== "active")) throw conflict("notYourself");   // no locking yourself out
  if (a.role === "owner" && a.status === "active" && (role !== "owner" || status !== "active") && (await activeOwners()) <= 1) throw conflict("lastOwner");
  await pool.query("UPDATE platform_admins SET role = ?, status = ? WHERE id = ?", [role, status, a.id]);
  await adminAudit(pool, { adminId: req.admin.id, action: "admin.admin_changed", entity: "platform_admin", entityId: a.id, meta: { role, status }, ip: req.ip });
  res.json({ code: "saved" });
}));
router.post("/admins/:id/reset-password", requireAdminPerm("admins"), ah(async (req, res) => {
  const aid = id(req.params.id);
  const [[a]] = await pool.query("SELECT id, username FROM platform_admins WHERE id = ?", [aid || 0]);
  if (!a) return res.status(404).json({ code: "notFound" });
  const password = tempPassword();
  // a reset also turns two-step sign-in off, so a lost phone can be recovered
  await pool.query("UPDATE platform_admins SET password_hash = ?, totp_enabled = 0, totp_secret = NULL WHERE id = ?", [await bcrypt.hash(password, 12), a.id]);
  await adminAudit(pool, { adminId: req.admin.id, action: "admin.admin_password_reset", entity: "platform_admin", entityId: a.id, ip: req.ip });
  res.json({ username: a.username, password });
}));

/* my two-step sign-in: setup gives a new secret (QR / key for the authenticator app), enable checks a code from it, disable needs the password */
router.post("/me/2fa/setup", ah(async (req, res) => {
  const secret = newTotpSecret();
  await pool.query("UPDATE platform_admins SET totp_secret = ?, totp_enabled = 0 WHERE id = ?", [secret, req.admin.id]);
  res.json({ secret, url: totpUrl(secret, req.admin.username) });
}));
router.post("/me/2fa/enable", limiter, ah(async (req, res) => {
  const [[a]] = await pool.query("SELECT totp_secret FROM platform_admins WHERE id = ?", [req.admin.id]);
  if (!a?.totp_secret || !totpValid(a.totp_secret, req.body?.code)) throw badRequest({ code: "twoFactorWrong" });
  await pool.query("UPDATE platform_admins SET totp_enabled = 1 WHERE id = ?", [req.admin.id]);
  await adminAudit(pool, { adminId: req.admin.id, action: "admin.2fa_enabled", ip: req.ip });
  res.json({ code: "saved" });
}));
router.post("/me/2fa/disable", limiter, ah(async (req, res) => {
  const [[a]] = await pool.query("SELECT password_hash FROM platform_admins WHERE id = ?", [req.admin.id]);
  if (!(await bcrypt.compare(String(req.body?.password || ""), a.password_hash))) throw badRequest({ password: "wrongPassword" });
  await pool.query("UPDATE platform_admins SET totp_enabled = 0, totp_secret = NULL WHERE id = ?", [req.admin.id]);
  await adminAudit(pool, { adminId: req.admin.id, action: "admin.2fa_disabled", ip: req.ip });
  res.json({ code: "saved" });
}));

/* POST /api/admin/me/password { current, next } — the signed-in super admin changes their own password */
router.post("/me/password", limiter, ah(async (req, res) => {
  const current = typeof req.body?.current === "string" ? req.body.current : "";
  const next = typeof req.body?.next === "string" ? req.body.next : "";
  const [[a]] = await pool.query("SELECT password_hash FROM platform_admins WHERE id = ?", [req.admin.id]);
  if (!(await bcrypt.compare(current, a.password_hash))) throw badRequest({ current: "wrongPassword" });
  if (next.length < 10 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) throw badRequest({ next: "adminPasswordWeak" });
  await pool.query("UPDATE platform_admins SET password_hash = ? WHERE id = ?", [await bcrypt.hash(next, 12), req.admin.id]);
  await pool.query("INSERT INTO audit_logs (platform_admin_id, action, ip) VALUES (?, 'admin.password_changed', ?)", [req.admin.id, req.ip]);
  res.json({ code: "saved" });
}));

/* GET /api/admin/audit?kind=admin|logins — platform-wide audit log (admin: super admin actions; logins: sign-ins) */
router.get("/audit", ah(async (req, res) => {
  const where = req.query.kind === "admin" ? "WHERE a.platform_admin_id IS NOT NULL" : req.query.kind === "logins" ? "WHERE a.action IN ('auth.login', 'auth.login_failed', 'admin.login')" : "";
  const [rows] = await pool.query(
    `SELECT a.action, a.entity, a.entity_id, a.ip, a.created_at, b.name business, u.full_name user_name, pa.username admin_name
       FROM audit_logs a LEFT JOIN businesses b ON b.id = a.business_id LEFT JOIN users u ON u.id = a.user_id LEFT JOIN platform_admins pa ON pa.id = a.platform_admin_id
      ${where} ORDER BY a.id DESC LIMIT 300`);
  res.json({ logs: rows.map((a) => ({ action: a.action, entity: a.entity, entityId: a.entity_id, ip: a.ip, at: a.created_at, business: a.business, user: a.user_name || (a.admin_name ? `admin:${a.admin_name}` : null) })) });
}));

platformRoutes(router);   // billing, support, announcements, reports, security, settings, export (routes/adminPlatform.js)
tenancyRoutes(router);    // register & provision businesses, hosting & domains, databases, backups, branches (routes/adminTenancy.js)

export default router;
export { audit };
