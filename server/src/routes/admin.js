import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool, checkDatabase } from "../config/db.js";
import { env } from "../config/env.js";
import { audit } from "../middleware/auth.js";
import { ah, id, text, num, badRequest } from "../lib/http.js";

/*
 * Super Admin (platform owner). Completely separate from business users:
 * own table (platform_admins), own cookie, own routes. Business owners never get access.
 * Admins see business summaries and account status — not detailed financial records.
 */
const router = Router();
const ADMIN_COOKIE = "faatix_admin";

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, handler: (req, res) => res.status(429).json({ code: "tooManyAttempts" }) });
const DUMMY = bcrypt.hashSync("not-a-real-password", 12);

router.post("/sign-in", limiter, ah(async (req, res) => {
  const username = text(req.body?.username, 60).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const [[a]] = await pool.query("SELECT id, password_hash, status FROM platform_admins WHERE username = ? OR email = ?", [username, username]);
  const ok = await bcrypt.compare(password, a ? a.password_hash : DUMMY);
  if (!a || !ok || a.status !== "active") return res.status(401).json({ code: "invalidCredentials" });
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
    const [[a]] = await pool.query("SELECT id, username, status FROM platform_admins WHERE id = ?", [p.aid]);
    if (!a || a.status !== "active") throw new Error();
    req.admin = a;
    next();
  } catch {
    res.status(401).json({ code: "unauthenticated" });
  }
}));

router.get("/me", (req, res) => res.json({ admin: { id: req.admin.id, username: req.admin.username } }));

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
  const [[size]] = await pool.query("SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) mb FROM information_schema.tables WHERE table_schema = DATABASE()");
  res.json({ counts: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, num(v)])), health: { database: db.ok ? "connected" : "down", sizeMb: num(size.mb), uptimeSec: Math.round(process.uptime()), node: process.version } });
}));

/* GET /api/admin/businesses?q=&status= */
router.get("/businesses", ah(async (req, res) => {
  const where = ["1=1"];
  const params = [];
  const q = text(req.query.q, 80);
  if (q) { where.push("(b.name LIKE ? OR b.phone LIKE ? OR b.owner_name LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (["active", "suspended", "deactivated"].includes(req.query.status)) { where.push("b.status = ?"); params.push(req.query.status); }
  const [rows] = await pool.query(
    `SELECT b.id, b.name, b.owner_name, b.phone, b.email, b.business_type, b.logo_path, b.status, b.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.business_id = b.id) users,
            (SELECT COUNT(*) FROM sales s WHERE s.business_id = b.id) + (SELECT COUNT(*) FROM invoices i WHERE i.business_id = b.id) transactions,
            (SELECT MAX(created_at) FROM audit_logs a WHERE a.business_id = b.id) last_activity,
            (SELECT CONCAT(status, '|', end_date) FROM trial_records t WHERE t.business_id = b.id ORDER BY t.id DESC LIMIT 1) trial
       FROM businesses b WHERE ${where.join(" AND ")} ORDER BY b.created_at DESC LIMIT 500`, params);
  res.json({ businesses: rows.map((b) => {
    const [tStatus, tEnd] = String(b.trial || "|").split("|");
    return { id: b.id, name: b.name, owner: b.owner_name, phone: b.phone, email: b.email, type: b.business_type, logoPath: b.logo_path, status: b.status,
      createdAt: b.created_at, users: num(b.users), transactions: num(b.transactions), lastActivity: b.last_activity, trial: tStatus ? { status: tStatus, endDate: tEnd } : null };
  }) });
}));

/* GET /api/admin/businesses/:id — users, roles and usage summary (no line-level financial records) */
router.get("/businesses/:id", ah(async (req, res) => {
  const bid = id(req.params.id);
  const [[b]] = await pool.query("SELECT * FROM businesses WHERE id = ?", [bid || 0]);
  if (!b) return res.status(404).json({ code: "notFound" });
  const [users] = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.status, u.last_login_at, r.role FROM users u JOIN business_user_roles r ON r.user_id = u.id
      WHERE u.business_id = ? ORDER BY FIELD(r.role,'owner','manager','cashier','stockkeeper')`, [bid]);
  const [[usage]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM products WHERE business_id = ?) products, (SELECT COUNT(*) FROM customers WHERE business_id = ?) customers,
            (SELECT COUNT(*) FROM sales WHERE business_id = ?) sales, (SELECT COUNT(*) FROM invoices WHERE business_id = ?) invoices,
            (SELECT COUNT(*) FROM purchases WHERE business_id = ?) purchases,
            (SELECT COUNT(*) FROM sales WHERE business_id = ? AND sold_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) sales30`,
    [bid, bid, bid, bid, bid, bid]);
  const [[trial]] = await pool.query("SELECT start_date, end_date, status FROM trial_records WHERE business_id = ? ORDER BY id DESC LIMIT 1", [bid]);
  const [logs] = await pool.query("SELECT a.action, a.created_at, u.full_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.business_id = ? ORDER BY a.id DESC LIMIT 25", [bid]);
  await pool.query("INSERT INTO audit_logs (platform_admin_id, business_id, action, ip) VALUES (?, ?, 'admin.viewed_business', ?)", [req.admin.id, bid, req.ip]);
  res.json({
    business: { id: b.id, name: b.name, owner: b.owner_name, phone: b.phone, email: b.email, type: b.business_type, address: b.address, logoPath: b.logo_path, status: b.status, createdAt: b.created_at },
    users: users.map((u) => ({ id: u.id, fullName: u.full_name, username: u.username, status: u.status, role: u.role, lastLoginAt: u.last_login_at })),
    usage: Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, num(v)])),
    trial: trial || null,
    activity: logs.map((l) => ({ action: l.action, at: l.created_at, user: l.full_name }))
  });
}));

/* PATCH /api/admin/businesses/:id { status: active|suspended|deactivated, reason } */
router.patch("/businesses/:id", ah(async (req, res) => {
  const bid = id(req.params.id);
  const status = req.body?.status;
  const reason = text(req.body?.reason, 200);
  if (!["active", "suspended", "deactivated"].includes(status)) throw badRequest({ status: "required" });
  if (status !== "active" && !reason) throw badRequest({ reason: "required" });
  const [r] = await pool.query("UPDATE businesses SET status = ? WHERE id = ?", [status, bid || 0]);
  if (!r.affectedRows) return res.status(404).json({ code: "notFound" });
  await pool.query("INSERT INTO audit_logs (platform_admin_id, business_id, action, meta, ip) VALUES (?, ?, 'admin.business_status', ?, ?)",
    [req.admin.id, bid, JSON.stringify({ status, reason }), req.ip]);
  res.json({ code: "saved" });
}));

/* GET /api/admin/audit — platform-wide audit log */
router.get("/audit", ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.action, a.entity, a.entity_id, a.ip, a.created_at, b.name business, u.full_name user_name, pa.username admin_name
       FROM audit_logs a LEFT JOIN businesses b ON b.id = a.business_id LEFT JOIN users u ON u.id = a.user_id LEFT JOIN platform_admins pa ON pa.id = a.platform_admin_id
      ORDER BY a.id DESC LIMIT 300`);
  res.json({ logs: rows.map((a) => ({ action: a.action, entity: a.entity, entityId: a.entity_id, ip: a.ip, at: a.created_at, business: a.business, user: a.user_name || (a.admin_name ? `admin:${a.admin_name}` : null) })) });
}));

export default router;
export { audit };
