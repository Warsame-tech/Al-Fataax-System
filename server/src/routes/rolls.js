import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, withTx, badRequest, conflict, num, round2, range } from "../lib/http.js";
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
  status: r.status, source: r.source, receivedAt: r.received_at, updatedAt: r.updated_at,
  dyeLot: r.dye_lot || null, priceOverride: r.price_override === null || r.price_override === undefined ? null : num(r.price_override),
  reserved: num(r.reserved || 0), reservedFor: r.reserved_ref || null, available: round4(num(r.remaining) - num(r.reserved || 0)),
  remnant: r.status === "available" && r.remnant_length !== null && r.remnant_length !== undefined && num(r.remaining) > 0 && num(r.remaining) < num(r.remnant_length),
  parentRoll: r.parent_code || null
});
const round4 = (v) => Math.round(Number(v) * 10000) / 10000;
const FROM = `FROM fabric_rolls r JOIN products p ON p.id = r.product_id AND p.business_id = r.business_id
  LEFT JOIN stock_locations l ON l.id = r.location_id LEFT JOIN suppliers s ON s.id = r.supplier_id AND s.business_id = r.business_id
  LEFT JOIN purchases pu ON pu.id = r.purchase_id AND pu.business_id = r.business_id LEFT JOIN fabric_rolls pr ON pr.id = r.parent_roll_id`;
const COLS = `r.*, ${NAME} product_name, p.sku, p.selling_price, p.remnant_length, l.name location_name, s.name supplier_name, pu.purchase_no, pr.roll_code parent_code`;

router.get("/", canSee, ah(async (req, res) => {
  const bid = req.business.id;
  const where = ["r.business_id = ?"];
  const params = [bid];
  if (id(req.query.productId)) { where.push("r.product_id = ?"); params.push(id(req.query.productId)); }
  if (req.query.sellable === "1") {
    // the rolls this branch sells from (lib/branches.js), with length not held for an order
    where.push("r.status = 'available' AND r.remaining > r.reserved AND r.location_id = ?");
    params.push(req.branch?.locationId || await defaultLocationId(pool, bid));
  } else if (STATUSES.includes(req.query.status)) { where.push("r.status = ?"); params.push(req.query.status); }
  else if (req.query.status === "in_stock") where.push("r.status IN ('available', 'pending_inspection')");
  if (id(req.query.locationId)) { where.push("r.location_id = ?"); params.push(id(req.query.locationId)); }
  if (req.query.remnant === "1") where.push("r.status = 'available' AND p.remnant_length IS NOT NULL AND r.remaining > 0 AND r.remaining < p.remnant_length");
  if (req.query.reserved === "1") where.push("r.reserved > 0");
  if (req.query.short === "1") where.push("r.declared_length > r.verified_length");
  if (text(req.query.dyeLot, 40)) { where.push("r.dye_lot = ?"); params.push(text(req.query.dyeLot, 40)); }
  const q = text(req.query.q, 60);
  if (q) { where.push(`(r.roll_code LIKE ? OR ${NAME} LIKE ? OR p.sku = ?)`); params.push(`%${q}%`, `%${q}%`, q); }
  const [rows] = await pool.query(`SELECT ${COLS} ${FROM} WHERE ${where.join(" AND ")} ORDER BY FIELD(r.status, 'pending_inspection', 'available', 'finished') DESC, r.status, p.name, ${req.query.sellable === "1" ? "r.remaining, " : ""}r.id LIMIT 1000`, params);
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

router.get("/:id(\\d+)", canSee, ah(async (req, res) => {
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

/*
 * GET /api/rolls/report?from&to — fabric report: profit by roll and by supplier (receipts and invoices, line totals before
 * receipt-level discounts; cost = each roll's own cost), and shortages against the supplier's declared length.
 */
router.get("/report", requirePerm("reports.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const r = range(req.query, 30);
  const [lines] = await pool.query(
    `SELECT x.roll_id, ro.roll_code, ${NAME} product_name, s.id supplier_id, s.name supplier_name, x.qty, x.revenue, x.cost FROM (
        SELECT e.roll_id, si.qty, si.line_total revenue, si.qty * si.unit_cost cost FROM roll_events e JOIN sale_items si ON si.id = e.item_id JOIN sales sa ON sa.id = si.sale_id
         WHERE e.event = 'sold' AND e.ref_type = 'sale' AND sa.business_id = ? AND sa.status <> 'cancelled' AND sa.sold_at BETWEEN ? AND ?
        UNION ALL
        SELECT e.roll_id, ii.qty, ii.line_total, ii.qty * ii.unit_cost FROM roll_events e JOIN invoice_items ii ON ii.id = e.item_id JOIN invoices iv ON iv.id = ii.invoice_id
         WHERE e.event = 'sold' AND e.ref_type = 'invoice' AND iv.business_id = ? AND iv.status NOT IN ('draft', 'cancelled') AND iv.issue_date BETWEEN ? AND ?
      ) x JOIN fabric_rolls ro ON ro.id = x.roll_id JOIN products p ON p.id = ro.product_id LEFT JOIN suppliers s ON s.id = ro.supplier_id`,
    [bid, r.start, r.end, bid, r.from, r.to]);
  const group = (key, label) => {
    const m = new Map();
    for (const l of lines) {
      const k = key(l);
      const g = m.get(k) || { ...label(l), meters: 0, revenue: 0, cost: 0 };
      g.meters = round4(g.meters + num(l.qty)); g.revenue = round2(g.revenue + num(l.revenue)); g.cost = round2(g.cost + num(l.cost));
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, profit: round2(g.revenue - g.cost), margin: g.revenue > 0 ? Math.round(((g.revenue - g.cost) / g.revenue) * 1000) / 10 : null })).sort((a, b) => b.profit - a.profit);
  };
  const [short] = await pool.query(
    `SELECT s.id, s.name, COUNT(*) rolls, SUM(r.declared_length) declared, SUM(r.verified_length) verified,
            -- at the price the supplier billed per meter (the purchase line), not the roll's cost (which spreads the bill over the verified length)
            SUM((r.declared_length - r.verified_length) * COALESCE((SELECT MAX(pi.unit_cost) FROM purchase_items pi WHERE pi.purchase_id = r.purchase_id AND pi.product_id = r.product_id), r.cost_per_meter, 0)) value
       FROM fabric_rolls r LEFT JOIN suppliers s ON s.id = r.supplier_id
      WHERE r.business_id = ? AND r.source = 'purchase' AND r.declared_length > r.verified_length AND r.received_at BETWEEN ? AND ?
      GROUP BY s.id, s.name ORDER BY value DESC`, [bid, r.start, r.end]);
  res.json({
    range: r,
    byRoll: group((l) => l.roll_id, (l) => ({ rollId: l.roll_id, roll: l.roll_code, product: l.product_name, supplier: l.supplier_name || null })).slice(0, 200),
    bySupplier: group((l) => l.supplier_id || 0, (l) => ({ supplierId: l.supplier_id || null, supplier: l.supplier_name || null })),
    shortages: short.map((x) => ({ supplierId: x.id, supplier: x.name || null, rolls: Number(x.rolls), declared: num(x.declared), verified: num(x.verified),
      shortage: round4(num(x.declared) - num(x.verified)), value: round2(num(x.value)) }))
  });
}));

/* PUT /api/rolls/:id/details { dyeLot?, priceOverride? } — dye lot (stock.adjust); a roll's own price per meter, e.g. a remnant (products.edit) */
router.put("/:id/details", ah(async (req, res) => {
  const b = req.body || {};
  const priceGiven = b.priceOverride !== undefined;
  if (priceGiven && !can(req.user, "products.edit")) return res.status(403).json({ code: "forbidden" });
  if (b.dyeLot !== undefined && !can(req.user, "stock.adjust")) return res.status(403).json({ code: "forbidden" });
  const price = !priceGiven || b.priceOverride === "" || b.priceOverride === null ? null : Number(b.priceOverride);
  if (price !== null && (!Number.isFinite(price) || price < 0)) throw badRequest({ priceOverride: "invalidAmount" });
  await withTx(async (conn) => {
    const [[r]] = await conn.query("SELECT * FROM fabric_rolls WHERE id = ? AND business_id = ? FOR UPDATE", [id(req.params.id), req.business.id]);
    if (!r) throw badRequest({ rollId: "rollNotFound" });
    const dyeLot = b.dyeLot === undefined ? r.dye_lot : optText(b.dyeLot, 40);
    const override = priceGiven ? (price === null ? null : round4(price)) : r.price_override;
    await conn.query("UPDATE fabric_rolls SET dye_lot = ?, price_override = ? WHERE id = ?", [dyeLot, override, r.id]);
    await rollEvent(conn, r.id, { event: "details", remaining: num(r.remaining), refType: "stock", locationId: r.location_id, userId: req.user.id,
      note: [dyeLot !== r.dye_lot ? `dye lot ${dyeLot || "—"}` : null, priceGiven ? `price ${override === null ? "product price" : override} / m` : null].filter(Boolean).join(" · ") || null });
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "roll.details", entity: "roll", entityId: r.id,
      meta: { roll: r.roll_code, dyeLot: { from: r.dye_lot, to: dyeLot }, price: { from: r.price_override === null ? null : num(r.price_override), to: override } }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/*
 * POST /api/rolls/:id/reserve { length, lengthUnit, for } — hold a length for an order (tailoring, a customer's deposit):
 * it stays on the roll but can't be sold to anyone else. POST /api/rolls/:id/release — the hold ends (to cut it, release and sell).
 */
const canHold = (req, res, next) => (["stock.adjust", "sales.create"].some((p) => can(req.user, p)) ? next() : res.status(403).json({ code: "forbidden" }));
router.post("/:id/reserve", canHold, ah(async (req, res) => {
  const b = req.body || {};
  const length = Number(b.length);
  const holder = text(b.for, 80);
  const e = {};
  if (!Number.isFinite(length) || length <= 0) e.length = "invalidAmount";
  if (!holder) e.for = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const meters = toMeters(length, b.lengthUnit === "yard" ? "yard" : "meter");
  const r = await withTx(async (conn) => {
    const roll = await lockRoll(conn, { businessId: req.business.id, product: null, rollId: id(req.params.id) });
    const held = units(roll.reserved || 0) + units(meters);
    if (held > units(roll.remaining)) throw conflict("rollTooShort", { roll: roll.roll_code, available: toNumber(units(roll.remaining) - units(roll.reserved || 0)) });
    const reserved = toNumber(held);
    const ref = num(roll.reserved || 0) > 0 && roll.reserved_ref ? `${roll.reserved_ref}; ${holder}`.slice(0, 80) : holder;
    await conn.query("UPDATE fabric_rolls SET reserved = ?, reserved_ref = ? WHERE id = ?", [reserved, ref, roll.id]);
    await rollEvent(conn, roll.id, { event: "reserved", remaining: num(roll.remaining), refType: "stock", locationId: roll.location_id, userId: req.user.id, note: `${meters} m for ${holder}` });
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "roll.reserved", entity: "roll", entityId: roll.id, meta: { roll: roll.roll_code, meters, for: holder }, ip: req.ip });
    return { reserved, available: toNumber(units(roll.remaining) - held) };
  });
  res.status(201).json(r);
}));
router.post("/:id/release", canHold, ah(async (req, res) => {
  await withTx(async (conn) => {
    const roll = await lockRoll(conn, { businessId: req.business.id, product: null, rollId: id(req.params.id), statuses: ["available", "pending_inspection"] });
    if (!(num(roll.reserved) > 0)) throw conflict("notReserved");
    await conn.query("UPDATE fabric_rolls SET reserved = 0, reserved_ref = NULL WHERE id = ?", [roll.id]);
    await rollEvent(conn, roll.id, { event: "released", remaining: num(roll.remaining), refType: "stock", locationId: roll.location_id, userId: req.user.id, note: `${num(roll.reserved)} m (${roll.reserved_ref || ""})` });
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "roll.released", entity: "roll", entityId: roll.id, meta: { roll: roll.roll_code, meters: num(roll.reserved) }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/*
 * POST /api/rolls/count { locationId, counts: [{ rollId, length }], lengthUnit, notes? } — stocktaking a location: each roll's
 * measured length; differences are recorded as count corrections (rolls not listed are left as they are).
 */
router.post("/count", requirePerm("stock.adjust"), ah(async (req, res) => {
  const b = req.body || {};
  const counts = (Array.isArray(b.counts) ? b.counts : []).slice(0, 500).filter((c) => c && c.length !== "" && c.length !== null && c.length !== undefined);
  if (!counts.length) throw badRequest({ counts: "required" });
  const unit = b.lengthUnit === "yard" ? "yard" : "meter";
  counts.forEach((c, i) => { if (!Number.isFinite(Number(c.length)) || Number(c.length) < 0) throw badRequest({ [`counts.${i}.length`]: "invalidAmount" }); });
  const result = await withTx(async (conn) => {
    let changed = 0;
    let difference = 0n;
    for (const [i, c] of counts.entries()) {
      const [[row]] = await conn.query("SELECT product_id FROM fabric_rolls WHERE id = ? AND business_id = ?", [id(c.rollId), req.business.id]);
      if (!row) throw badRequest({ [`counts.${i}.rollId`]: "rollNotFound" });
      const product = (await lockProducts(conn, req.business.id, [row.product_id])).get(row.product_id);
      const r = await lockRoll(conn, { businessId: req.business.id, product, rollId: id(c.rollId), locationId: id(b.locationId) || null, statuses: ["available", "finished"], field: `counts.${i}.rollId` });
      const after = units(toMeters(Number(c.length), unit));
      const change = toNumber(after - units(r.remaining));
      if (change === 0) continue;
      if (after < units(r.reserved || 0)) throw badRequest({ [`counts.${i}.length`]: "belowReserved" });
      const remaining = toNumber(after);
      await changeRoll(conn, req, r, product, { change, remaining, status: remaining === 0 ? "finished" : "available", event: "measured", type: "count", reason: "stocktake", note: optText(b.notes, 200) });
      changed++;
      difference += after - units(r.remaining);
    }
    return { changed, difference: toNumber(difference) };
  });
  res.status(201).json(result);
}));

export default router;
