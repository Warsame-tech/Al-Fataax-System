import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, withTx, badRequest, conflict, num, round2 } from "../lib/http.js";
import { lockProducts, moveStock } from "../lib/ledger.js";
import { defaultLocationId } from "../lib/stock.js";
import { toMeters, toYards, lockRoll, rollEvent } from "../lib/rolls.js";
import { units, toNumber } from "../lib/jewelry.js";

/*
 * Fabric rolls (lib/rolls.js): the rolls of the business, each with its history.
 *   GET  /api/rolls                 ?productId= &status= &locationId= &q= &sellable=1 (available at the POS location)
 *   GET  /api/rolls/code/:code      a scanned roll ID / barcode
 *   GET  /api/rolls/:id             the roll and every event (received, sold, returned, inspected, waste…; who and when)
 *   POST /api/rolls/:id/adjust      { kind: damaged | waste | measured | found, length, lengthUnit, reason, notes? }
 *                                   damaged / waste take a length off; measured sets the length found when re-measuring
 *                                   (stocktaking: the difference is a discrepancy); found adds length back
 *   POST /api/rolls/:id/inspect     { result: approve | damaged, notes? } a returned piece: back on sale, or written off
 * Every change moves the product's stock by the same meters (stock = what is left on its rolls) and is audited.
 */
const router = Router();
router.use(requireAuth);

const STATUSES = ["available", "finished", "pending_inspection", "damaged", "returned_supplier", "removed"];
const KINDS = { damaged: "damaged", waste: "adjustment", measured: "count", found: "adjustment" };
const canSee = (req, res, next) => (["stock.view", "products.view", "sales.create", "invoices.create"].some((p) => can(req.user, p)) ? next() : res.status(403).json({ code: "forbidden" }));
const NAME = "CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.fragrance, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, ''))";

const shape = (r) => ({
  id: r.id, code: r.roll_code, productId: r.product_id, product: r.product_name, sku: r.sku || null, sellingPrice: r.selling_price === undefined ? undefined : num(r.selling_price),
  declared: r.declared_length === null ? null : num(r.declared_length), verified: num(r.verified_length), remaining: num(r.remaining),
  remainingYards: toYards(num(r.remaining)), shortage: r.declared_length === null ? 0 : round4(num(r.declared_length) - num(r.verified_length)),
  costPerMeter: r.cost_per_meter === null ? null : num(r.cost_per_meter), value: r.cost_per_meter === null ? null : round2(num(r.remaining) * num(r.cost_per_meter)),
  locationId: r.location_id, location: r.location_name || null, supplier: r.supplier_name || null, purchaseId: r.purchase_id, purchaseNo: r.purchase_no || null,
  status: r.status, source: r.source, receivedAt: r.received_at, updatedAt: r.updated_at
});
const round4 = (v) => Math.round(Number(v) * 10000) / 10000;
const FROM = `FROM fabric_rolls r JOIN products p ON p.id = r.product_id AND p.business_id = r.business_id
  LEFT JOIN stock_locations l ON l.id = r.location_id LEFT JOIN suppliers s ON s.id = r.supplier_id AND s.business_id = r.business_id
  LEFT JOIN purchases pu ON pu.id = r.purchase_id AND pu.business_id = r.business_id`;
const COLS = `r.*, ${NAME} product_name, p.sku, p.selling_price, l.name location_name, s.name supplier_name, pu.purchase_no`;

router.get("/", canSee, ah(async (req, res) => {
  const bid = req.business.id;
  const where = ["r.business_id = ?"];
  const params = [bid];
  if (id(req.query.productId)) { where.push("r.product_id = ?"); params.push(id(req.query.productId)); }
  if (req.query.sellable === "1") {
    where.push("r.status = 'available' AND r.remaining > 0 AND r.location_id = ?");
    params.push(await defaultLocationId(pool, bid));
  } else if (STATUSES.includes(req.query.status)) { where.push("r.status = ?"); params.push(req.query.status); }
  else if (req.query.status === "in_stock") where.push("r.status IN ('available', 'pending_inspection')");
  if (id(req.query.locationId)) { where.push("r.location_id = ?"); params.push(id(req.query.locationId)); }
  const q = text(req.query.q, 60);
  if (q) { where.push(`(r.roll_code LIKE ? OR ${NAME} LIKE ? OR p.sku = ?)`); params.push(`%${q}%`, `%${q}%`, q); }
  const [rows] = await pool.query(`SELECT ${COLS} ${FROM} WHERE ${where.join(" AND ")} ORDER BY FIELD(r.status, 'pending_inspection', 'available', 'finished') DESC, r.status, p.name, r.id LIMIT 1000`, params);
  // per product: rolls in stock and the meters on them
  const [totals] = await pool.query(
    `SELECT r.product_id, ${NAME} product_name, p.unit, p.stock_qty, COUNT(*) rolls, SUM(r.remaining) meters,
            SUM(CASE WHEN r.status = 'pending_inspection' THEN r.remaining ELSE 0 END) pending
       FROM fabric_rolls r JOIN products p ON p.id = r.product_id
      WHERE r.business_id = ? AND r.status IN ('available', 'pending_inspection') GROUP BY r.product_id ORDER BY product_name`, [bid]);
  res.json({
    rolls: rows.map(shape),
    products: totals.map((t) => ({ productId: t.product_id, product: t.product_name, rolls: Number(t.rolls), meters: num(t.meters), yards: toYards(num(t.meters)),
      pending: num(t.pending), stock: num(t.stock_qty) }))
  });
}));

router.get("/code/:code", canSee, ah(async (req, res) => {
  const [[r]] = await pool.query(`SELECT ${COLS} ${FROM} WHERE r.business_id = ? AND r.roll_code = ?`, [req.business.id, text(req.params.code, 40)]);
  if (!r) return res.status(404).json({ code: "rollNotFound" });
  res.json({ roll: shape(r) });
}));

router.get("/:id", canSee, ah(async (req, res) => {
  const bid = req.business.id;
  const [[r]] = await pool.query(`SELECT ${COLS} ${FROM} WHERE r.business_id = ? AND r.id = ?`, [bid, id(req.params.id)]);
  if (!r) return res.status(404).json({ code: "notFound" });
  const [events] = await pool.query(
    `SELECT e.*, u.full_name user_name, l.name location_name,
            CASE e.ref_type WHEN 'sale' THEN (SELECT receipt_no FROM sales WHERE id = e.ref_id AND business_id = ?)
                            WHEN 'invoice' THEN (SELECT invoice_no FROM invoices WHERE id = e.ref_id AND business_id = ?)
                            WHEN 'purchase' THEN (SELECT purchase_no FROM purchases WHERE id = e.ref_id AND business_id = ?) END ref_no
       FROM roll_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN stock_locations l ON l.id = e.location_id
      WHERE e.roll_id = ? ORDER BY e.id`, [bid, bid, bid, r.id]);
  res.json({
    roll: shape(r),
    events: events.map((e) => ({ id: e.id, event: e.event, change: num(e.length_change), remaining: num(e.remaining_after), refType: e.ref_type, refId: e.ref_id,
      refNo: e.ref_no || null, location: e.location_name || null, note: e.note || "", user: e.user_name || null, at: e.created_at }))
  });
}));

/* A roll's length changes outside a sale: the product's stock follows by the same meters. */
async function changeRoll(conn, req, r, product, { change, remaining, status, event, type, reason, note }) {
  if (change !== 0) {
    await moveStock(conn, { businessId: req.business.id, userId: req.user.id, product, qtyChange: change, type, refType: "stock",
      locationId: r.location_id, reason, note: [r.roll_code, note].filter(Boolean).join(" · ").slice(0, 255), devices: true });
  }
  await conn.query("UPDATE fabric_rolls SET remaining = ?, status = ? WHERE id = ?", [remaining, status, r.id]);
  await rollEvent(conn, r.id, { event, change, remaining, refType: "stock", locationId: r.location_id, note: [reason, note].filter(Boolean).join(" · ").slice(0, 255), userId: req.user.id });
  await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "roll.changed", entity: "roll", entityId: r.id,
    meta: { roll: r.roll_code, event, before: num(r.remaining), change, after: remaining, reason }, ip: req.ip });
}

router.post("/:id/adjust", requirePerm("stock.adjust"), ah(async (req, res) => {
  const b = req.body || {};
  const kind = Object.keys(KINDS).includes(b.kind) ? b.kind : null;
  const reason = text(b.reason, 120);
  const length = Number(b.length);
  const e = {};
  if (!kind) e.kind = "required";
  if (!reason) e.reason = "required";
  if (b.length === "" || b.length == null || !Number.isFinite(length) || length < 0 || (kind !== "measured" && length === 0)) e.length = "invalidAmount";
  if (Object.keys(e).length) throw badRequest(e);
  const meters = toMeters(length, b.lengthUnit === "yard" ? "yard" : "meter");
  const result = await withTx(async (conn) => {
    const [[row]] = await conn.query("SELECT product_id FROM fabric_rolls WHERE id = ? AND business_id = ?", [id(req.params.id), req.business.id]);
    if (!row) throw badRequest({ rollId: "rollNotFound" });
    const product = (await lockProducts(conn, req.business.id, [row.product_id])).get(row.product_id);
    const r = await lockRoll(conn, { businessId: req.business.id, product, rollId: id(req.params.id), statuses: kind === "found" || kind === "measured" ? ["available", "finished"] : ["available"] });
    const before = units(r.remaining);
    let after;
    if (kind === "measured") after = units(meters);
    else if (kind === "found") after = before + units(meters);
    else after = before - units(meters);
    if (after < 0n) throw conflict("rollTooShort", { roll: r.roll_code, available: num(r.remaining) });
    const change = toNumber(after - before);
    if (change === 0) throw badRequest({ length: "noChange" });
    const remaining = toNumber(after);
    const status = remaining === 0 ? (kind === "damaged" ? "damaged" : "finished") : "available";
    await changeRoll(conn, req, r, product, { change, remaining, status, event: kind, type: KINDS[kind], reason, note: optText(b.notes, 200) });
    return { before: num(r.remaining), change, after: remaining, status };
  });
  res.status(201).json(result);
}));

router.post("/:id/inspect", requirePerm("stock.adjust"), ah(async (req, res) => {
  const b = req.body || {};
  if (!["approve", "damaged"].includes(b.result)) throw badRequest({ result: "required" });
  const result = await withTx(async (conn) => {
    const [[row]] = await conn.query("SELECT product_id FROM fabric_rolls WHERE id = ? AND business_id = ?", [id(req.params.id), req.business.id]);
    if (!row) throw badRequest({ rollId: "rollNotFound" });
    const product = (await lockProducts(conn, req.business.id, [row.product_id])).get(row.product_id);
    const r = await lockRoll(conn, { businessId: req.business.id, product, rollId: id(req.params.id), statuses: ["pending_inspection"] });
    const note = optText(b.notes, 200);
    if (b.result === "approve") {
      await changeRoll(conn, req, r, product, { change: 0, remaining: num(r.remaining), status: "available", event: "inspected", type: "adjustment", reason: "approved", note });
      return { status: "available" };
    }
    await changeRoll(conn, req, r, product, { change: -num(r.remaining), remaining: 0, status: "damaged", event: "damaged", type: "damaged", reason: "failed inspection", note });
    return { status: "damaged" };
  });
  res.json(result);
}));

export default router;
