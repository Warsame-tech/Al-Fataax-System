import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, withTx, ensureOwned, badRequest, conflict, num, round2, range, isDate, today } from "../lib/http.js";
import { lockProducts, moveStock } from "../lib/ledger.js";
import { productName } from "../lib/productName.js";
import { activeLocation, defaultLocationId } from "../lib/stock.js";
import { viaRecipe, convert, unitsFor, consumeForSale, recipeCost } from "../lib/food.js";

/*
 * Food waste and spoilage (food businesses): burnt food, expired or spilled ingredients, wrong orders, unsold
 * prepared food, damaged packaging… Each record has the item, quantity and unit, estimated cost, reason, date and the
 * responsible employee. Staff who may adjust stock (stock.adjust) record approved waste directly; others record it as
 * pending until a manager approves (or rejects) it. Approved waste leaves stock as movement type "waste" — never
 * mixed with the recipe consumption of sales. A wasted dish (a burnt burger) uses up its recipe's ingredients.
 */
const router = Router();
router.use(requireAuth);
router.use((req, res, next) => (req.business.profile.food ? next() : res.status(404).json({ code: "notFound" })));

export const WASTE_REASONS = ["burnt", "expired", "spilled", "wrong_order", "unsold", "damaged_packaging", "other"];
const q4 = (v) => Math.round(Number(v) * 10000) / 10000;
const canRecord = (req, res, next) => (["stock.adjust", "kitchen.update", "stock.add"].some((p) => can(req.user, p)) ? next() : res.status(403).json({ code: "forbidden" }));

/* Takes approved waste out of stock (or the dish's ingredients). Returns the cost actually used. */
async function applyWaste(conn, req, w) {
  const products = await lockProducts(conn, req.business.id, [w.product_id]);
  const p = products.get(w.product_id);
  const note = `${w.reason}${w.note ? ` · ${w.note}` : ""}`.slice(0, 255);
  if (viaRecipe(p)) {
    const used = await consumeForSale(conn, { businessId: req.business.id, userId: req.user.id, product: p, qty: num(w.base_qty), locationId: w.location_id,
      refType: "waste", refId: w.id, note, type: "waste", reason: "waste" });
    return round2(used.detail.recipeCost || num(w.base_qty) * num(p.cost_price));
  }
  await moveStock(conn, { businessId: req.business.id, userId: req.user.id, product: p, qtyChange: -num(w.base_qty), type: "waste", refType: "waste", refId: w.id,
    locationId: w.location_id, reason: "waste", note, devices: true });
  return round2(num(w.base_qty) * num(p.cost_price));
}

/** POST /api/waste { productId, qty, unit?, reason, note?, responsible?, date?, locationId? } */
router.post("/", canRecord, ah(async (req, res) => {
  const b = req.body || {};
  const qty = Number(b.qty);
  const e = {};
  if (!id(b.productId)) e.productId = "required";
  if (!Number.isFinite(qty) || qty <= 0) e.qty = "invalidAmount";
  if (!WASTE_REASONS.includes(b.reason)) e.reason = "required";
  if (b.date && (!isDate(b.date) || b.date > today())) e.date = "future";
  if (Object.keys(e).length) throw badRequest(e);
  const r = await withTx(async (conn) => {
    const p = await ensureOwned(conn, "products", id(b.productId), req.business.id);
    const unit = typeof b.unit === "string" && b.unit ? b.unit.slice(0, 20) : p.unit;
    const base = convert(qty, unit, p.unit);
    if (base === null) throw badRequest({ unit: "unitMismatch" });
    const loc = b.locationId ? await activeLocation(conn, req.business.id, id(b.locationId)) : { id: req.branch.locationId || await defaultLocationId(conn, req.business.id) };
    if (!loc) throw badRequest({ locationId: "required" });
    // estimated cost now: the dish's recipe cost, or the item's cost price
    const per = viaRecipe(p) ? (await recipeCost(conn, req.business.id, p.id)) ?? num(p.cost_price) : num(p.cost_price);
    const estimate = round2(q4(base) * per);
    const approved = can(req.user, "stock.adjust");
    const [x] = await conn.query(
      `INSERT INTO waste_records (business_id, product_id, qty, unit, base_qty, est_cost, reason, note, responsible, waste_date, location_id, status, user_id, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${approved ? "UTC_TIMESTAMP()" : "NULL"})`,
      [req.business.id, p.id, q4(qty), unit, q4(base), estimate, b.reason, optText(b.note, 255), optText(b.responsible, 120) || req.user.fullName || null,
        b.date || today(), loc.id, approved ? "approved" : "pending", req.user.id, approved ? req.user.id : null]);
    await conn.query("UPDATE waste_records SET branch_id = ? WHERE id = ?", [req.branch.id, x.insertId]);
    const w = { id: x.insertId, product_id: p.id, base_qty: q4(base), reason: b.reason, note: optText(b.note, 255), location_id: loc.id };
    if (approved) {
      const cost = await applyWaste(conn, req, w);
      await conn.query("UPDATE waste_records SET actual_cost = ? WHERE id = ?", [cost, w.id]);
    }
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "waste.recorded", entity: "waste", entityId: w.id,
      meta: { product: productName(p), qty, unit, reason: b.reason, estimate, status: approved ? "approved" : "pending" }, ip: req.ip });
    return { id: w.id, status: approved ? "approved" : "pending", estimatedCost: estimate };
  });
  res.status(201).json(r);
}));

/** POST /api/waste/:id/approve | /reject { reason } — managers (stock.adjust) */
router.post("/:id/approve", requirePerm("stock.adjust"), ah(async (req, res) => {
  const r = await withTx(async (conn) => {
    const w = await ensureOwned(conn, "waste_records", id(req.params.id), req.business.id, true);
    if (w.status !== "pending") throw conflict("wasteDecided");
    const cost = await applyWaste(conn, req, w);
    await conn.query("UPDATE waste_records SET status = 'approved', approved_by = ?, approved_at = UTC_TIMESTAMP(), actual_cost = ? WHERE id = ?", [req.user.id, cost, w.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "waste.approved", entity: "waste", entityId: w.id, meta: { cost }, ip: req.ip });
    return { cost };
  });
  res.json(r);
}));
router.post("/:id/reject", requirePerm("stock.adjust"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  await withTx(async (conn) => {
    const w = await ensureOwned(conn, "waste_records", id(req.params.id), req.business.id, true);
    if (w.status !== "pending") throw conflict("wasteDecided");
    await conn.query("UPDATE waste_records SET status = 'rejected', approved_by = ?, approved_at = UTC_TIMESTAMP(), reject_reason = ? WHERE id = ?", [req.user.id, reason, w.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "waste.rejected", entity: "waste", entityId: w.id, meta: { reason }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/** GET /api/waste?status=&reason=&productId=&from=&to= — records + totals by reason and by item (approved waste) */
router.get("/", canRecord, ah(async (req, res) => {
  const bid = req.business.id;
  const r = range(req.query, 30);
  const where = ["w.business_id = ?", "w.waste_date BETWEEN ? AND ?"];
  const params = [bid, r.from, r.to];
  if (["pending", "approved", "rejected"].includes(req.query.status)) { where.push("w.status = ?"); params.push(req.query.status); }
  if (WASTE_REASONS.includes(req.query.reason)) { where.push("w.reason = ?"); params.push(req.query.reason); }
  if (id(req.query.productId)) { where.push("w.product_id = ?"); params.push(id(req.query.productId)); }
  if (req.branch.filterId) { where.push("w.branch_id = ?"); params.push(req.branch.filterId); }
  const NAME = "CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, ''))";
  const [rows] = await pool.query(
    `SELECT w.*, ${NAME} product_name, p.item_kind, u.full_name user_name, a.full_name approver_name, l.name location_name FROM waste_records w
       JOIN products p ON p.id = w.product_id LEFT JOIN users u ON u.id = w.user_id LEFT JOIN users a ON a.id = w.approved_by LEFT JOIN stock_locations l ON l.id = w.location_id
      WHERE ${where.join(" AND ")} ORDER BY w.waste_date DESC, w.id DESC LIMIT 500`, params);
  const ok = rows.filter((w) => w.status === "approved");
  const cost = (w) => num(w.actual_cost ?? w.est_cost);
  const byReason = WASTE_REASONS.map((x) => ({ reason: x, count: ok.filter((w) => w.reason === x).length, cost: round2(ok.filter((w) => w.reason === x).reduce((s, w) => s + cost(w), 0)) })).filter((x) => x.count);
  const items = new Map();
  for (const w of ok) { const it = items.get(w.product_id) || { name: w.product_name, qty: 0, unit: w.unit, cost: 0, count: 0 }; it.qty = q4(it.qty + num(w.qty)); it.cost = round2(it.cost + cost(w)); it.count++; items.set(w.product_id, it); }
  res.json({
    range: r, reasons: WASTE_REASONS,
    records: rows.map((w) => ({ id: w.id, productId: w.product_id, product: w.product_name, kind: w.item_kind, qty: num(w.qty), unit: w.unit, estimatedCost: num(w.est_cost),
      cost: w.actual_cost === null ? null : num(w.actual_cost), reason: w.reason, note: w.note || "", responsible: w.responsible || "", date: w.waste_date, location: w.location_name,
      status: w.status, user: w.user_name, approvedBy: w.approver_name, approvedAt: w.approved_at, rejectReason: w.reject_reason || "", at: w.created_at })),
    summary: { total: round2(ok.reduce((s, w) => s + cost(w), 0)), count: ok.length, pending: rows.filter((w) => w.status === "pending").length, byReason,
      byItem: [...items.values()].sort((a, b) => b.cost - a.cost).slice(0, 20) }
  });
}));

/** Items that can be wasted, with the units they may be counted in. */
router.get("/items", canRecord, ah(async (req, res) => {
  const [rows] = await pool.query("SELECT id, name, size, unit, item_kind, cost_price FROM products WHERE business_id = ? AND is_active = 1 AND item_kind <> 'modifier' ORDER BY FIELD(item_kind, 'ingredient', 'prepared', 'menu', 'goods', 'packaging'), name", [req.business.id]);
  res.json({ items: rows.map((p) => ({ id: p.id, name: productName(p), unit: p.unit, kind: p.item_kind, units: unitsFor(p.unit) })) });
}));

export default router;
