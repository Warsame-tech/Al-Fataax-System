import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm, ALL_PERMISSIONS, permissionsFor } from "../lib/permissions.js";
import { parsePermissions } from "../lib/roles.js";
import { ah, id, text, money, withTx, ensureOwned, badRequest, num, round2, range } from "../lib/http.js";
import { PROMO_KINDS, activePromotions, applyPromotions, discountRules, signApproval } from "../lib/promotions.js";

/*
 * Promotions (lib/promotions.js) and discount controls:
 *   GET/POST/PUT /api/promotions          promotions (promotions.manage)
 *   GET/PUT      /api/promotions/rules    { maxPct, approvalPct } manual discount limits (owner)
 *   POST /api/promotions/preview          what the active promotions take off a cart (the POS shows it before paying)
 *   POST /api/promotions/approval         { username, password } a manager approves one discount → short-lived approval
 *   GET  /api/promotions/discounts        discount history: who gave it, who approved, which promotions
 */
const router = Router();
router.use(requireAuth);
const json = (v) => { try { return JSON.parse(v || "[]"); } catch { return []; } };
const shape = (p) => ({ id: p.id, name: p.name, kind: p.kind, value: num(p.value), buyQty: p.buy_qty, getQty: p.get_qty, minTotal: num(p.min_total),
  productIds: json(p.product_ids), categoryIds: json(p.category_ids), days: json(p.days_json), startsAt: p.starts_at, endsAt: p.ends_at, isActive: Boolean(p.is_active), createdAt: p.created_at });

router.get("/", requirePerm("promotions.manage"), ah(async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM promotions WHERE business_id = ? ORDER BY is_active DESC, id DESC", [req.business.id]);
  const active = new Set((await activePromotions(pool, req.business.id)).map((p) => p.id));
  res.json({ promotions: rows.map((p) => ({ ...shape(p), runningNow: active.has(p.id) })), kinds: PROMO_KINDS });
}));

function readPromo(b) {
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Boolean))].slice(0, 200);
  const dt = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(v) ? v.replace("T", " ").slice(0, 16) : null);
  const d = { name: text(b.name, 120), kind: PROMO_KINDS.includes(b.kind) ? b.kind : null, value: b.value === "" || b.value == null ? 0 : money(b.value),
    buyQty: b.kind === "bogo" ? Number(b.buyQty) : null, getQty: b.kind === "bogo" ? Number(b.getQty) : null, minTotal: b.minTotal ? money(b.minTotal) : 0,
    productIds: ids(b.productIds), categoryIds: ids(b.categoryIds), days: ids(b.days).filter((x) => x >= 1 && x <= 7), startsAt: dt(b.startsAt), endsAt: dt(b.endsAt) };
  const e = {};
  if (!d.name) e.name = "required";
  if (!d.kind) e.kind = "required";
  if (Number.isNaN(d.value) || d.value < 0 || (["percent", "order_percent"].includes(d.kind) && d.value > 100)) e.value = "invalidAmount";
  if (d.kind && d.kind !== "bogo" && !(d.value > 0) && d.kind !== "price") e.value = "invalidAmount";
  if (d.kind === "bogo" && (!Number.isInteger(d.buyQty) || d.buyQty < 1 || !Number.isInteger(d.getQty) || d.getQty < 1)) e.buyQty = "invalidAmount";
  if (Number.isNaN(d.minTotal)) e.minTotal = "invalidAmount";
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) e.endsAt = "beforeIssue";
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}
const cols = (d) => [d.name, d.kind, d.value, d.buyQty, d.getQty, d.minTotal, JSON.stringify(d.productIds), JSON.stringify(d.categoryIds), JSON.stringify(d.days), d.startsAt, d.endsAt];

router.post("/", requirePerm("promotions.manage"), ah(async (req, res) => {
  const d = readPromo(req.body || {});
  const [r] = await pool.query(
    `INSERT INTO promotions (name, kind, value, buy_qty, get_qty, min_total, product_ids, category_ids, days_json, starts_at, ends_at, business_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...cols(d), req.business.id, req.user.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "promotion.created", entity: "promotion", entityId: r.insertId, meta: d, ip: req.ip });
  res.status(201).json({ id: r.insertId });
}));
router.put("/:id(\\d+)", requirePerm("promotions.manage"), ah(async (req, res) => {
  const d = readPromo(req.body || {});
  const p = await ensureOwned(pool, "promotions", id(req.params.id), req.business.id);
  await pool.query(`UPDATE promotions SET name = ?, kind = ?, value = ?, buy_qty = ?, get_qty = ?, min_total = ?, product_ids = ?, category_ids = ?, days_json = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ?`,
    [...cols(d), req.body?.isActive === false ? 0 : 1, p.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "promotion.changed", entity: "promotion", entityId: p.id, meta: { ...d, isActive: req.body?.isActive !== false }, ip: req.ip });
  res.json({ code: "saved" });
}));

/* ---------- discount rules ---------- */
router.get("/rules", ah(async (req, res) => res.json(await discountRules(pool, req.business.id))));
router.put("/rules", requirePerm("settings.edit"), ah(async (req, res) => {
  const maxPct = Number(req.body?.maxPct);
  const approvalPct = Number(req.body?.approvalPct);
  const e = {};
  if (!Number.isFinite(maxPct) || maxPct < 0 || maxPct > 100) e.maxPct = "invalidAmount";
  if (!Number.isFinite(approvalPct) || approvalPct < 0 || approvalPct > 100) e.approvalPct = "invalidAmount";
  if (Object.keys(e).length) throw badRequest(e);
  await pool.query("UPDATE business_settings SET discount_rules = ? WHERE business_id = ?", [JSON.stringify({ maxPct, approvalPct }), req.business.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "discount.rules", entity: "business", entityId: req.business.id, meta: { maxPct, approvalPct }, ip: req.ip });
  res.json({ code: "saved" });
}));

/** POST /api/promotions/preview { items: [{ productId, qty, lineTotal }] } → { lines: [{ discount, promo }], order, total } */
router.post("/preview", requirePerm("sales.create"), ah(async (req, res) => {
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 300).map((x) => ({ productId: id(x?.productId), qty: Number(x?.qty) || 0, lineTotal: money(x?.lineTotal) || 0 }));
  const promos = await activePromotions(pool, req.business.id);
  if (!promos.length || !items.length) return res.json({ lines: items.map(() => ({ discount: 0, promo: null })), order: { discount: 0, promo: null }, total: 0 });
  const ids = [...new Set(items.map((x) => x.productId).filter(Boolean))];
  const [rows] = ids.length ? await pool.query("SELECT id, category_id FROM products WHERE business_id = ? AND id IN (?)", [req.business.id, ids]) : [[]];
  const cat = new Map(rows.map((p) => [p.id, p.category_id]));
  const r = applyPromotions(promos, items.map((x) => ({ ...x, categoryId: cat.get(x.productId), unitPrice: x.qty ? x.lineTotal / x.qty : 0 })));
  res.json({ ...r, total: round2(r.lines.reduce((s, l) => s + l.discount, 0) + r.order.discount) });
}));

/* A manager approves one discount: their username + password (rate limited), never their session. */
const approvalLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { code: "tooManyAttempts" } });
router.post("/approval", approvalLimit, requirePerm("sales.create"), ah(async (req, res) => {
  const username = text(req.body?.username, 30).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const [[u]] = await pool.query(
    `SELECT u.id, u.full_name, u.password_hash, u.status, r.role, r.role_id, ro.name role_name, ro.permissions role_permissions FROM users u
       JOIN business_user_roles r ON r.user_id = u.id AND r.business_id = u.business_id LEFT JOIN roles ro ON ro.id = r.role_id AND ro.business_id = u.business_id
      WHERE u.business_id = ? AND u.username = ?`, [req.business.id, username]);
  const ok = u && u.status === "active" && (await bcrypt.compare(password, u.password_hash));
  if (!ok) throw badRequest({ password: "wrongPassword" });
  const perms = u.role === "owner" ? ALL_PERMISSIONS : u.role_id ? (u.role_name ? parsePermissions(u.role_permissions) : []) : permissionsFor(u.role);
  if (!perms.includes("discounts.approve")) throw badRequest({ username: "cannotApprove" });
  await audit(null, { businessId: req.business.id, userId: u.id, action: "discount.approval", entity: "user", entityId: req.user.id, meta: { for: req.user.fullName }, ip: req.ip });
  res.json({ token: signApproval(req.business.id, u.id), approver: u.full_name });
}));

/** GET /api/promotions/discounts?from&to — sales with a discount or a promotion */
router.get("/discounts", (req, res, next) => (can(req.user, "promotions.manage") || can(req.user, "reports.view") ? next() : res.status(403).json({ code: "forbidden" })), ah(async (req, res) => {
  const r = range(req.query, 30);
  const [rows] = await pool.query(
    `SELECT s.id, s.receipt_no, s.sold_at, s.subtotal, s.discount, s.promo_detail, s.total, s.status, u.full_name user_name, a.full_name approver_name FROM sales s
       JOIN users u ON u.id = s.user_id LEFT JOIN users a ON a.id = s.discount_approved_by
      WHERE s.business_id = ? AND s.sold_at BETWEEN ? AND ? AND (s.discount > 0 OR s.promo_detail IS NOT NULL) ORDER BY s.sold_at DESC LIMIT 500`, [req.business.id, r.start, r.end]);
  const list = rows.map((s) => {
    const p = s.promo_detail ? JSON.parse(s.promo_detail) : null;
    return { id: s.id, number: s.receipt_no, at: s.sold_at, status: s.status, subtotal: num(s.subtotal), discount: num(s.discount), total: num(s.total), user: s.user_name, approvedBy: s.approver_name || null,
      promoItems: p?.items || 0, promoOrder: p?.order || null, manual: p ? p.manual : num(s.discount) };
  });
  res.json({ range: r, discounts: list, summary: { manual: round2(list.filter((x) => x.status === "completed").reduce((a, x) => a + x.manual, 0)),
    promotions: round2(list.filter((x) => x.status === "completed").reduce((a, x) => a + x.promoItems + (x.promoOrder?.amount || 0), 0)), approved: list.filter((x) => x.approvedBy).length } });
}));

export default router;
