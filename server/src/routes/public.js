import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../config/db.js";
import { audit } from "../middleware/auth.js";
import { ah, text, optText, withTx, badRequest, conflict, num, round2 } from "../lib/http.js";
import { profileFor } from "../lib/businessProfiles.js";
import { optionsOf } from "../lib/food.js";
import { resolveBranch } from "../lib/branches.js";
import { onlineSettings, readLines, insertLines, nextOrderNo } from "./food.js";

/*
 * Online ordering (no sign-in): a food business shares its menu link /order/<code> (Tables & orders → Online ordering).
 *   GET  /api/public/menu/:code              business name, ordering options and the available menu
 *   POST /api/public/orders/:code            { service, name, phone, address?, notes?, payment, items } → order number + tracking code
 *   GET  /api/public/orders/:code/:tracking  the order's status for the customer
 * Online orders land in the same order list as the POS (source "online", status received); staff accept them (to the
 * kitchen) or reject them. Prices always come from the menu here, never from the customer.
 */
const router = Router();
const orderLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { code: "tooManyAttempts" } });
const NAME = "CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, ''))";

/* the business behind a menu code, only while online ordering is on */
async function shopOf(db, code) {
  const c = text(code, 20);
  if (!/^[0-9a-f]{12}$/.test(c)) return null;
  const [[b]] = await db.query(
    `SELECT b.id, b.name, b.phone, b.address, b.logo_path, b.business_type, b.status, s.currency FROM business_settings s JOIN businesses b ON b.id = s.business_id
      WHERE s.online_settings LIKE ?`, [`%"code":"${c}"%`]);
  if (!b || b.status !== "active" || !profileFor(b.business_type).food) return null;
  const settings = await onlineSettings(db, b.id);
  return settings.enabled && settings.code === c ? { ...b, settings } : null;
}

router.get("/menu/:code", ah(async (req, res) => {
  const shop = await shopOf(pool, req.params.code);
  if (!shop) return res.status(404).json({ code: "menuClosed" });
  const [rows] = await pool.query(
    `SELECT p.*, ${NAME} full_name, c.name category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
      WHERE p.business_id = ? AND p.is_active = 1 AND p.item_kind IN ('menu', 'modifier', 'goods') ORDER BY c.name, p.name`, [shop.id]);
  const [optional] = await pool.query(
    `SELECT r.product_id, l.id line_id, ${NAME} name FROM recipes r JOIN recipe_lines l ON l.recipe_id = r.id JOIN products p ON p.id = l.ingredient_id
      WHERE r.business_id = ? AND r.is_current = 1 AND l.optional = 1 ORDER BY l.sort, l.id`, [shop.id]);
  const byId = new Map(rows.map((p) => [p.id, p]));
  const items = rows.filter((p) => p.item_kind !== "modifier" && (p.item_kind !== "goods" || num(p.stock_qty) > 0)).map((p) => {
    const o = optionsOf(p);
    return { id: p.id, name: p.full_name, category: p.category_name || null, description: p.description || "", price: num(p.selling_price), imagePath: p.image_path || null, available: Boolean(p.available),
      sizes: o.sizes.map((s) => ({ name: s.name, price: num(s.price) })),
      extras: o.extras.map((x) => byId.get(x)).filter((x) => x && x.item_kind === "modifier" && x.available).map((x) => ({ id: x.id, name: x.full_name, price: num(x.selling_price) })),
      optional: optional.filter((x) => x.product_id === p.id).map((x) => ({ lineId: x.line_id, name: x.name })) };
  });
  const s = shop.settings;
  res.json({ business: { name: shop.name, phone: shop.phone, address: shop.address, logoPath: shop.logo_path, currency: shop.currency || "USD" },
    settings: { services: s.services, deliveryFee: s.deliveryFee, minOrder: s.minOrder, payments: s.payments, message: s.message }, items });
}));

router.post("/orders/:code", orderLimit, ah(async (req, res) => {
  const b = req.body || {};
  const r = await withTx(async (conn) => {
    const shop = await shopOf(conn, req.params.code);
    if (!shop) throw conflict("menuClosed");
    const s = shop.settings;
    const e = {};
    if (!s.services.includes(b.service)) e.service = "required";
    if (!text(b.name, 150)) e.name = "required";
    if (!/^\+?[0-9\s-]{7,20}$/.test(text(b.phone, 30))) e.phone = "invalidPhone";
    if (b.service === "delivery" && !text(b.address, 255)) e.address = "required";
    if (!s.payments.includes(b.payment)) e.payment = "required";
    if (Object.keys(e).length) throw badRequest(e);
    const lines = await readLines(conn, shop.id, b.items);
    const subtotal = round2(lines.reduce((a, l) => a + l.lineTotal, 0));
    if (subtotal < s.minOrder) throw conflict("belowMinOrder", { min: s.minOrder });
    const fee = b.service === "delivery" ? s.deliveryFee : 0;
    const number = await nextOrderNo(conn, shop.id);
    const tracking = crypto.randomBytes(5).toString("hex");
    const [x] = await conn.query(
      `INSERT INTO food_orders (business_id, order_no, service_type, source, payment_pref, tracking_code, customer_name, customer_phone, delivery_address, delivery_fee, notes, status)
       VALUES (?, ?, ?, 'online', ?, ?, ?, ?, ?, ?, ?, 'received')`,
      [shop.id, number, b.service, b.payment, tracking, text(b.name, 150), text(b.phone, 30), b.service === "delivery" ? text(b.address, 255) : null, fee, optText(b.notes, 500)]);
    const main = await resolveBranch(conn, shop.id, null, null);   // online orders go to the main branch
    await conn.query("UPDATE food_orders SET branch_id = ? WHERE id = ?", [main.id, x.insertId]);
    await insertLines(conn, { businessId: shop.id, orderId: x.insertId, lines, send: false, userId: null });
    await audit(conn, { businessId: shop.id, action: "food.online", entity: "food_order", entityId: x.insertId, meta: { number, total: round2(subtotal + fee) }, ip: req.ip });
    return { number, tracking, subtotal, deliveryFee: fee, total: round2(subtotal + fee) };
  });
  res.status(201).json(r);
}));

router.get("/orders/:code/:tracking", ah(async (req, res) => {
  const shop = await shopOf(pool, req.params.code);
  if (!shop) return res.status(404).json({ code: "menuClosed" });
  const [[o]] = await pool.query("SELECT * FROM food_orders WHERE business_id = ? AND tracking_code = ?", [shop.id, text(req.params.tracking, 16)]);
  if (!o) return res.status(404).json({ code: "notFound" });
  const [items] = await pool.query(`SELECT i.qty, i.size, i.extras, i.unit_price, i.line_total, i.status, ${NAME} name FROM food_order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id`, [o.id]);
  res.json({ business: { name: shop.name, phone: shop.phone, currency: shop.currency || "USD" },
    order: { number: o.order_no, service: o.service_type, status: o.status, cancelReason: o.status === "cancelled" ? o.cancel_reason || "" : "", createdAt: o.created_at,
      readyAt: o.ready_at, dispatchedAt: o.dispatched_at, deliveredAt: o.delivered_at, deliveryFee: num(o.delivery_fee), paid: Boolean(o.sale_id),
      items: items.filter((i) => i.status !== "cancelled" || o.status === "cancelled").map((i) => ({ name: i.name, qty: num(i.qty), size: i.size, extras: JSON.parse(i.extras || "[]"), total: num(i.line_total) })),
      total: round2(items.filter((i) => i.status !== "cancelled").reduce((a, i) => a + num(i.line_total), 0) + num(o.delivery_fee)) } });
}));

export default router;
