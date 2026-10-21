import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import multer from "multer";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm, can } from "../lib/permissions.js";
import { ah, id, text, optText, withTx, ensureOwned, badRequest, conflict, forbidden, num } from "../lib/http.js";
import { UPLOAD_DIR, BUSINESS_TYPES } from "./auth.js";

const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9\s-]{7,20}$/;
const ROLES = ["manager", "cashier", "stockkeeper"]; // the owner role is never assigned here
const strongPassword = (p) => typeof p === "string" && p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);

/* ===================== Staff (owner only) ===================== */
export const staffRouter = Router();
staffRouter.use(requireAuth, requirePerm("staff.manage"));

staffRouter.get("/", ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.email, u.phone, u.status, u.last_login_at, u.created_at, r.role
       FROM users u JOIN business_user_roles r ON r.user_id = u.id AND r.business_id = u.business_id
      WHERE u.business_id = ? ORDER BY FIELD(r.role,'owner','manager','cashier','stockkeeper'), u.full_name`, [req.business.id]);
  res.json({ users: rows.map((u) => ({ id: u.id, fullName: u.full_name, username: u.username, email: u.email, phone: u.phone, status: u.status, role: u.role, lastLoginAt: u.last_login_at, isMe: u.id === req.user.id })) });
}));

staffRouter.post("/", ah(async (req, res) => {
  const b = req.body || {};
  const d = { fullName: text(b.fullName, 150), username: text(b.username, 30).toLowerCase(), email: optText(b.email, 190), phone: optText(b.phone, 30), role: b.role, password: b.password };
  const e = {};
  if (d.fullName.length < 2) e.fullName = "required";
  if (!USERNAME.test(d.username)) e.username = "invalidUsername";
  if (d.email && !EMAIL.test(d.email)) e.email = "invalidEmail";
  if (d.phone && !PHONE.test(d.phone)) e.phone = "invalidPhone";
  if (!ROLES.includes(d.role)) e.role = "required";
  if (!strongPassword(d.password)) e.password = "weakPassword";
  if (Object.keys(e).length) throw badRequest(e);
  const hash = await bcrypt.hash(d.password, 12);
  try {
    const newId = await withTx(async (conn) => {
      const [u] = await conn.query("INSERT INTO users (business_id, full_name, username, email, phone, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
        [req.business.id, d.fullName, d.username, d.email, d.phone, hash]);
      await conn.query("INSERT INTO business_user_roles (business_id, user_id, role) VALUES (?, ?, ?)", [req.business.id, u.insertId, d.role]);
      await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "user.created", entity: "user", entityId: u.insertId, meta: { role: d.role }, ip: req.ip });
      return u.insertId;
    });
    res.status(201).json({ id: newId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw badRequest({ username: "usernameTaken" });
    throw err;
  }
}));

/* PATCH /api/staff/:id { role?, status?, password? } — cannot change the owner or yourself */
staffRouter.patch("/:id", ah(async (req, res) => {
  const bid = req.business.id;
  const userId = id(req.params.id);
  await withTx(async (conn) => {
    const u = await ensureOwned(conn, "users", userId, bid, true);
    const [[r]] = await conn.query("SELECT role FROM business_user_roles WHERE user_id = ? AND business_id = ?", [u.id, bid]);
    if (u.id === req.user.id || r.role === "owner") throw forbidden();
    const b = req.body || {};
    const changes = {};
    if (b.role !== undefined) {
      if (!ROLES.includes(b.role)) throw badRequest({ role: "required" });
      await conn.query("UPDATE business_user_roles SET role = ? WHERE user_id = ? AND business_id = ?", [b.role, u.id, bid]);
      changes.role = b.role;
    }
    if (b.status !== undefined) {
      if (!["active", "disabled"].includes(b.status)) throw badRequest({ status: "required" });
      await conn.query("UPDATE users SET status = ? WHERE id = ? AND business_id = ?", [b.status, u.id, bid]);
      changes.status = b.status;
    }
    if (b.password !== undefined) {
      if (!strongPassword(b.password)) throw badRequest({ password: "weakPassword" });
      await conn.query("UPDATE users SET password_hash = ? WHERE id = ? AND business_id = ?", [await bcrypt.hash(b.password, 12), u.id, bid]);
      changes.password = "reset";
    }
    await audit(conn, { businessId: bid, userId: req.user.id, action: "user.updated", entity: "user", entityId: u.id, meta: changes, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/* ===================== Business info & settings ===================== */
export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const LOGO_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (req, f, cb) => cb(null, `logo-${Date.now()}-${Math.round(Math.random() * 1e9)}${LOGO_TYPES[f.mimetype]}`) }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, f, cb) => cb(null, Boolean(LOGO_TYPES[f.mimetype]))
});
function isRealImage(file) {
  const b = fs.readFileSync(file.path).subarray(0, 12);
  return (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8) || (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP");
}

settingsRouter.get("/", ah(async (req, res) => {
  const bid = req.business.id;
  const [[b]] = await pool.query("SELECT name, owner_name, email, phone, business_type, address, logo_path, created_at FROM businesses WHERE id = ?", [bid]);
  const [[s]] = await pool.query("SELECT currency, default_language, invoice_prefix, receipt_prefix, purchase_prefix, invoice_footer, timezone FROM business_settings WHERE business_id = ?", [bid]);
  const [[t]] = await pool.query("SELECT start_date, end_date, status FROM trial_records WHERE business_id = ? ORDER BY id DESC LIMIT 1", [bid]);
  res.json({
    business: { name: b.name, ownerName: b.owner_name, email: b.email, phone: b.phone, type: b.business_type, address: b.address, logoPath: b.logo_path, createdAt: b.created_at },
    settings: { currency: s.currency, defaultLanguage: s.default_language, invoicePrefix: s.invoice_prefix, receiptPrefix: s.receipt_prefix, purchasePrefix: s.purchase_prefix, invoiceFooter: s.invoice_footer, timezone: s.timezone },
    trial: t || null,
    canEdit: can(req.user.role, "business.edit")
  });
}));

/* PUT /api/settings/business (multipart: name, ownerName, email, phone, businessType, address, logo?, removeLogo?) */
settingsRouter.put("/business", requirePerm("business.edit"), upload.single("logo"), ah(async (req, res) => {
  const b = req.body || {};
  const file = req.file;
  const d = { name: text(b.name, 150), ownerName: text(b.ownerName, 150), email: optText(b.email, 190), phone: text(b.phone, 30), type: b.businessType, address: optText(b.address, 255) };
  const e = {};
  if (d.name.length < 2) e.name = "required";
  if (d.ownerName.length < 2) e.ownerName = "required";
  if (d.email && !EMAIL.test(d.email)) e.email = "invalidEmail";
  if (!PHONE.test(d.phone)) e.phone = "invalidPhone";
  if (!BUSINESS_TYPES.includes(d.type)) e.businessType = "required";
  if (file && !isRealImage(file)) e.logo = "invalidLogo";
  if (Object.keys(e).length) { if (file) fs.promises.unlink(file.path).catch(() => {}); throw badRequest(e); }

  const bid = req.business.id;
  const [[cur]] = await pool.query("SELECT logo_path FROM businesses WHERE id = ?", [bid]);
  let logo = cur.logo_path;
  if (file) logo = `/uploads/logos/${file.filename}`;
  else if (b.removeLogo === "true") logo = null;
  await pool.query("UPDATE businesses SET name = ?, owner_name = ?, email = ?, phone = ?, business_type = ?, address = ?, logo_path = ? WHERE id = ?",
    [d.name, d.ownerName, d.email, d.phone, d.type, d.address, logo, bid]);
  if (cur.logo_path && cur.logo_path !== logo) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(cur.logo_path))).catch(() => {});
  await audit(null, { businessId: bid, userId: req.user.id, action: "business.updated", ip: req.ip });
  res.json({ code: "saved" });
}));

const CURRENCIES = ["USD", "SOS", "KES", "ETB", "DJF", "EUR", "GBP", "AED"];
settingsRouter.put("/preferences", requirePerm("settings.edit"), ah(async (req, res) => {
  const b = req.body || {};
  const prefix = (v) => text(v, 10).replace(/[^A-Za-z0-9\-_/]/g, "");
  const d = { currency: b.currency, lang: b.defaultLanguage, inv: prefix(b.invoicePrefix), rec: prefix(b.receiptPrefix), pur: prefix(b.purchasePrefix), footer: optText(b.invoiceFooter, 255) };
  const e = {};
  if (!CURRENCIES.includes(d.currency)) e.currency = "required";
  if (!["en", "so"].includes(d.lang)) e.defaultLanguage = "required";
  if (!d.inv) e.invoicePrefix = "required";
  if (!d.rec) e.receiptPrefix = "required";
  if (!d.pur) e.purchasePrefix = "required";
  if (Object.keys(e).length) throw badRequest(e);
  await pool.query("UPDATE business_settings SET currency = ?, default_language = ?, invoice_prefix = ?, receipt_prefix = ?, purchase_prefix = ?, invoice_footer = ? WHERE business_id = ?",
    [d.currency, d.lang, d.inv, d.rec, d.pur, d.footer, req.business.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "settings.updated", ip: req.ip });
  res.json({ code: "saved" });
}));

/* ===================== My profile ===================== */
export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/", ah(async (req, res) => {
  const [[u]] = await pool.query("SELECT full_name, username, email, phone, language, last_login_at, created_at FROM users WHERE id = ? AND business_id = ?", [req.user.id, req.business.id]);
  res.json({ profile: { fullName: u.full_name, username: u.username, email: u.email, phone: u.phone, language: u.language, role: req.user.role, lastLoginAt: u.last_login_at, createdAt: u.created_at } });
}));

profileRouter.put("/", ah(async (req, res) => {
  const b = req.body || {};
  const d = { fullName: text(b.fullName, 150), email: optText(b.email, 190), phone: optText(b.phone, 30) };
  const e = {};
  if (d.fullName.length < 2) e.fullName = "required";
  if (d.email && !EMAIL.test(d.email)) e.email = "invalidEmail";
  if (d.phone && !PHONE.test(d.phone)) e.phone = "invalidPhone";
  if (Object.keys(e).length) throw badRequest(e);
  await pool.query("UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ? AND business_id = ?", [d.fullName, d.email, d.phone, req.user.id, req.business.id]);
  res.json({ code: "saved" });
}));

profileRouter.put("/password", ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!strongPassword(newPassword)) throw badRequest({ newPassword: "weakPassword" });
  const [[u]] = await pool.query("SELECT password_hash FROM users WHERE id = ? AND business_id = ?", [req.user.id, req.business.id]);
  if (!(await bcrypt.compare(String(currentPassword || ""), u.password_hash))) throw badRequest({ currentPassword: "wrongPassword" });
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [await bcrypt.hash(newPassword, 12), req.user.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "user.password_changed", ip: req.ip });
  res.json({ code: "saved" });
}));

/* ===================== Notifications (computed from live data, by permission) ===================== */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", ah(async (req, res) => {
  const bid = req.business.id;
  const role = req.user.role;
  const items = [];
  if (can(role, "products.view")) {
    const [stock] = await pool.query("SELECT id, name, stock_qty, min_stock FROM products WHERE business_id = ? AND is_active = 1 AND stock_qty <= min_stock ORDER BY stock_qty LIMIT 20", [bid]);
    stock.forEach((p) => items.push({ type: num(p.stock_qty) <= 0 ? "outOfStock" : "lowStock", ref: p.name, link: "/app/m/products", amount: num(p.stock_qty) }));
  }
  if (can(role, "invoices.view")) {
    const [inv] = await pool.query(
      `SELECT i.id, i.invoice_no, i.due_date, i.total - i.amount_paid bal, c.name FROM invoices i JOIN customers c ON c.id = i.customer_id
        WHERE i.business_id = ? AND i.status IN ('unpaid','partially_paid') AND i.due_date IS NOT NULL AND i.due_date <= DATE_ADD(UTC_DATE(), INTERVAL 3 DAY)
        ORDER BY i.due_date LIMIT 20`, [bid]);
    const todayStr = new Date().toISOString().slice(0, 10);
    inv.forEach((i) => items.push({ type: String(i.due_date) < todayStr ? "invoiceOverdue" : "invoiceDue", ref: `${i.invoice_no} · ${i.name}`, link: `/app/invoices/${i.id}`, amount: num(i.bal), date: i.due_date }));
  }
  if (can(role, "purchases.pay")) {
    const [pay] = await pool.query(
      `SELECT s.id, s.name, SUM(p.total - p.amount_paid) bal FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.business_id = ? AND p.status = 'received' AND p.total > p.amount_paid GROUP BY s.id, s.name ORDER BY bal DESC LIMIT 10`, [bid]);
    pay.forEach((s) => items.push({ type: "supplierDue", ref: s.name, link: "/app/m/suppliers", amount: num(s.bal) }));
  }
  res.json({ notifications: items });
}));

/* ===================== Audit trail ===================== */
export const auditRouter = Router();
auditRouter.use(requireAuth, requirePerm("audit.view"));

auditRouter.get("/", ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.action, a.entity, a.entity_id, a.meta, a.ip, a.created_at, u.full_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.business_id = ? ORDER BY a.id DESC LIMIT 300`, [req.business.id]);
  res.json({ logs: rows.map((a) => ({ action: a.action, entity: a.entity, entityId: a.entity_id, meta: typeof a.meta === "string" ? safeJson(a.meta) : a.meta, ip: a.ip, at: a.created_at, user: a.full_name })) });
}));
const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

export { conflict };
