import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, money, quantity, withTx, ensureOwned, badRequest, conflict, num, round2, METHODS, text, optText, range, isDate, HttpError } from "../lib/http.js";
import { nextNumber, lockProducts, moveStock } from "../lib/ledger.js";
import { paySupplier, readPayment } from "./parties.js";
import { readBatch } from "../lib/batches.js";
import { unitsPer } from "../lib/packaging.js";
import { defaultLocationId } from "../lib/stock.js";
import { isTracked, readNewDevices, addDevices, pickDevices, updateDevices, deviceLabel } from "../lib/devices.js";

const router = Router();
router.use(requireAuth);

/*
 * Purchase lifecycle:
 *   draft     → being prepared; no stock, nothing owed                    (POST /:id/confirm → ordered)
 *   ordered   → purchase order sent to the supplier; no stock, nothing owed
 *   partial   → some goods received (goods receipt), the rest outstanding (backorder); owed for what arrived
 *   received  → everything received, or the order closed short; owed for what arrived
 *   cancelled / returned
 * Stock goes up only on a goods receipt (POST /:id/receive, or "receive now" when recording the purchase).
 * total = what is owed: value of the goods received (less what was returned) − discount + additional costs.
 */
const PAYABLE = ["received", "partial"];
const owed = (p) => (PAYABLE.includes(p.status) ? round2(num(p.total) - num(p.amount_paid)) : 0);
const q3 = (v) => Math.round(Number(v) * 1000) / 1000;
/* base units in one unit of the line (a pack, e.g. carton = 6,000 tablets, or 1) */
const perOfItem = (i) => (i.buy_unit && num(i.buy_qty) > 0 ? q3(num(i.qty) / num(i.buy_qty)) : 1);
/* cost of base units of a line, in the line's own pricing (exact for packs) */
const valueOf = (i, baseQty) => (i.buy_unit ? round2((baseQty / perOfItem(i)) * num(i.buy_cost)) : round2(baseQty * num(i.unit_cost)));

/*
 * Records a purchase. body: { supplierId, mode?: "receive" | "order" | "draft" (or receive: false = order),
 *   items:[{ productId, qty, unitCost, unit?, batchNo?, expiryDate?, devices?: [{ serial, imei1, imei2 }] }],
 *   discount?, extraCosts?, expectedDate?, paymentTerms?, notes?, locationId?, amountPaid?, method?, bankAccountId?, reference? }
 *   unit: a pack of the product (e.g. "Carton", lib/packaging.js) — qty and unitCost are then per pack; stock and the
 *         product cost are kept per base unit (2 cartons of 6,000 tablets = 12,000 tablets).
 *   devices: serial numbers / IMEIs of tracked products (one per unit) when receiving now.
 */
export async function createPurchase(conn, ctx, body) {
  const { businessId, userId, role } = ctx;
  const supplierId = id(body.supplierId);
  if (!supplierId) throw badRequest({ supplierId: "required" });
  await ensureOwned(conn, "suppliers", supplierId, businessId);
  const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
  if (!items.length) throw badRequest({ items: "required" });
  const mode = ["receive", "order", "draft"].includes(body.mode) ? body.mode : body.receive === false || body.receive === "false" ? "order" : "receive";
  const receive = mode === "receive";

  const products = await lockProducts(conn, businessId, items.map((i) => id(i?.productId)).filter(Boolean));
  const errors = {};
  const lines = items.map((it, i) => {
    const p = products.get(id(it?.productId));
    const qty = quantity(it?.qty);
    const cost = money(it?.unitCost);
    if (!p) { errors[`items.${i}.productId`] = "required"; return null; }
    if (Number.isNaN(qty)) errors[`items.${i}.qty`] = "invalidAmount";
    if (Number.isNaN(cost)) errors[`items.${i}.unitCost`] = "invalidAmount";
    const unit = typeof it?.unit === "string" && it.unit && it.unit !== p.unit ? it.unit : null;
    const per = unit ? unitsPer(p, unit) : 1;
    if (!per) errors[`items.${i}.unit`] = "required";
    const baseQty = q3(qty * (per || 1));
    if (isTracked(p) && !Number.isInteger(baseQty)) errors[`items.${i}.qty`] = "wholeUnits";
    const batch = readBatch(it, baseQty)[0] || null;
    return { product: p, qty: baseQty, unitCost: unit ? round2(cost / per) : cost, lineTotal: round2(qty * cost),
      buy: unit ? { unit, qty, cost } : null, batchNo: batch?.batchNo || null, expiryDate: batch?.expiryDate || null, devices: it?.devices };
  });
  if (Object.keys(errors).length) throw badRequest(errors);
  const ordered = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const discount = body.discount ? money(body.discount) : 0;
  const extra = body.extraCosts ? money(body.extraCosts) : 0;
  if (Number.isNaN(discount) || discount > ordered) throw badRequest({ discount: "invalidAmount" });
  if (Number.isNaN(extra)) throw badRequest({ extraCosts: "invalidAmount" });
  const total = round2(ordered - discount + extra);

  const amountPaid = body.amountPaid ? money(body.amountPaid) : 0;
  if (Number.isNaN(amountPaid) || amountPaid > total) throw badRequest({ amountPaid: "invalidAmount" });
  if (amountPaid > 0 && !receive) throw badRequest({ amountPaid: "notReceivedYet" });
  if (amountPaid > 0 && !can(role, "purchases.pay")) throw badRequest({ amountPaid: "forbidden" });
  if (amountPaid > 0 && !METHODS.includes(body.method)) throw badRequest({ method: "required" });
  const locationId = id(body.locationId) || (await defaultLocationId(conn, businessId));
  const [[loc]] = await conn.query("SELECT id FROM stock_locations WHERE id = ? AND business_id = ? AND is_active = 1", [locationId, businessId]);
  if (!loc) throw badRequest({ locationId: "required" });

  const number = await nextNumber(conn, businessId, "purchase");
  const [r] = await conn.query(
    `INSERT INTO purchases (business_id, purchase_no, supplier_id, user_id, total, discount, extra_costs, ordered_total, amount_paid, status,
                            purchased_at, received_at, expected_date, payment_terms, notes, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, COALESCE(?, UTC_TIMESTAMP()), ${receive ? "COALESCE(?, UTC_TIMESTAMP())" : "?"}, ?, ?, ?, ?)`,
    [businessId, number, supplierId, userId, total, discount, extra, total, receive ? "received" : mode === "draft" ? "draft" : "ordered",
      ctx.at || null, receive ? ctx.at || null : null, isDate(body.expectedDate) ? body.expectedDate : null, optText(body.paymentTerms, 80),
      optText(body.notes, 255), locationId]
  );
  for (const [i, l] of lines.entries()) {
    const [it] = await conn.query(
      `INSERT INTO purchase_items (business_id, purchase_id, product_id, qty, received_qty, unit_cost, line_total, buy_unit, buy_qty, buy_cost, batch_no, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [businessId, r.insertId, l.product.id, l.qty, receive ? l.qty : 0, l.unitCost, l.lineTotal, l.buy?.unit || null, l.buy?.qty ?? null, l.buy?.cost ?? null, l.batchNo, l.expiryDate]);
    if (receive) {
      const devices = isTracked(l.product) ? readNewDevices(l.product, l.devices, l.qty, `items.${i}.devices`) : null;
      await receiveLine(conn, { businessId, userId, purchaseId: r.insertId, number, supplierId, locationId }, { ...l, itemId: it.insertId, devices });
    }
  }
  if (amountPaid > 0) {
    await paySupplier(conn, { businessId, userId, supplierId, purchaseId: r.insertId, amount: amountPaid, method: body.method, bankAccountId: id(body.bankAccountId), reference: text(body.reference, 80) || number, at: ctx.at || null });
  }
  await audit(conn, { businessId, userId, action: receive ? "purchase.created" : mode === "draft" ? "purchase.drafted" : "purchase.ordered", entity: "purchase", entityId: r.insertId, meta: { total, amountPaid } });
  return { id: r.insertId, number, total, status: receive ? "received" : mode === "draft" ? "draft" : "ordered" };
}

/* Goods received for one line: stock in (base units, with batch / expiry and devices), the product cost updated. */
async function receiveLine(conn, { businessId, userId, purchaseId, number, supplierId, locationId }, l) {
  const batches = l.batchNo || l.expiryDate ? [{ batchNo: l.batchNo || "", expiryDate: l.expiryDate || null, qty: l.qty }] : [];
  const m = await moveStock(conn, { businessId, userId, product: l.product, qtyChange: l.qty, type: "purchase", refType: "purchase", refId: purchaseId,
    locationId, supplierId, batches, devices: true });
  if (l.devices) {
    await addDevices(conn, { businessId, product: l.product, locationId, devices: l.devices, purchaseId, supplierId, cost: l.unitCost, userId,
      event: "received", refType: "purchase", refId: purchaseId });
  }
  if (num(l.product.cost_price) !== l.unitCost) {
    // purchase cost changes are part of the product's change history
    await audit(conn, { businessId, userId, action: "product.changed", entity: "product", entityId: l.product.id,
      meta: { changes: [{ field: "costPrice", from: num(l.product.cost_price), to: l.unitCost }], source: number } });
    l.product.cost_price = l.unitCost;
  }
  await conn.query("UPDATE products SET cost_price = ? WHERE id = ? AND business_id = ?", [l.unitCost, l.product.id, businessId]);
  return m;
}

/* After a receipt / return: what is owed and the status (partial while anything is outstanding). */
async function settle(conn, p) {
  const [items] = await conn.query("SELECT * FROM purchase_items WHERE purchase_id = ? AND business_id = ?", [p.id, p.business_id]);
  const received = round2(items.reduce((s, i) => s + valueOf(i, num(i.received_qty) - num(i.returned_qty)), 0));
  const anyIn = items.some((i) => num(i.received_qty) > 0);
  const outstanding = items.some((i) => q3(num(i.qty) - num(i.received_qty) - num(i.damaged_qty)) > 0);
  const allBack = anyIn && items.every((i) => q3(num(i.received_qty) - num(i.returned_qty)) <= 0);
  const status = p.closed ? "received" : allBack && !outstanding ? "returned" : !anyIn ? p.status : outstanding ? "partial" : "received";
  const total = anyIn ? Math.max(0, round2(received - num(p.discount) + num(p.extra_costs))) : num(p.total);
  if (num(p.amount_paid) > total + 0.001) throw conflict("paidMoreThanTotal", { paid: num(p.amount_paid), total });
  await conn.query("UPDATE purchases SET status = ?, total = ? WHERE id = ? AND business_id = ?", [status, total, p.id, p.business_id]);
  return { status, total };
}

router.post("/", requirePerm("purchases.create"), ah(async (req, res) => {
  const result = await withTx((conn) => createPurchase(conn, { businessId: req.business.id, userId: req.user.id, role: req.user }, req.body || {}));
  res.status(201).json(result);
}));

router.get("/", requirePerm("purchases.view"), ah(async (req, res) => {
  const r = range(req.query, 90);
  const q = text(req.query.q, 60);
  const [rows] = await pool.query(
    `SELECT p.id, p.purchase_no, p.total, p.ordered_total, p.amount_paid, p.status, p.purchased_at, p.expected_date, s.name supplier
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
      WHERE p.business_id = ? AND p.purchased_at BETWEEN ? AND ? ${q ? "AND (p.purchase_no LIKE ? OR s.name LIKE ?)" : ""}
      ORDER BY p.purchased_at DESC, p.id DESC LIMIT 500`,
    q ? [req.business.id, r.start, r.end, `%${q}%`, `%${q}%`] : [req.business.id, r.start, r.end]);
  res.json({ range: r, purchases: rows.map((p) => ({ id: p.id, number: p.purchase_no, total: num(p.total), orderedTotal: num(p.ordered_total ?? p.total), paid: num(p.amount_paid),
    balance: owed(p), status: p.status, at: p.purchased_at, expectedDate: p.expected_date || null, supplier: p.supplier })) });
}));

router.get("/:id", requirePerm("purchases.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const p = await ensureOwned(pool, "purchases", id(req.params.id), bid);
  const [items] = await pool.query(
    `SELECT pi.*, pr.unit base_unit, pr.track_batches, pr.tracking, CONCAT_WS(' ', pr.name, NULLIF(pr.size, ''), NULLIF(pr.shade, ''), NULLIF(pr.fragrance, ''), NULLIF(pr.formula, ''), NULLIF(pr.pack_size, '')) name, pr.sku
       FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id AND pr.business_id = pi.business_id
      WHERE pi.purchase_id = ? AND pi.business_id = ? ORDER BY pi.id`, [p.id, bid]);
  const [devices] = await pool.query("SELECT id, product_id, serial_no, imei1, imei2, status FROM devices WHERE business_id = ? AND purchase_id = ? ORDER BY id", [bid, p.id]);
  const [[s]] = await pool.query("SELECT name, phone FROM suppliers WHERE id = ? AND business_id = ?", [p.supplier_id, bid]);
  const [[loc]] = p.location_id ? await pool.query("SELECT name FROM stock_locations WHERE id = ?", [p.location_id]) : [[null]];
  const [payments] = await pool.query("SELECT amount, method, paid_at, reference FROM supplier_payments WHERE purchase_id = ? AND business_id = ? ORDER BY id", [p.id, bid]);
  const inUnit = (i, base) => q3(num(base) / perOfItem(i));
  res.json({
    purchase: { id: p.id, number: p.purchase_no, at: p.purchased_at, receivedAt: p.received_at || null, status: p.status, total: num(p.total),
      orderedTotal: num(p.ordered_total ?? p.total), discount: num(p.discount), extraCosts: num(p.extra_costs), paid: num(p.amount_paid), balance: owed(p),
      expectedDate: p.expected_date || null, paymentTerms: p.payment_terms || "", notes: p.notes || "", location: loc?.name || null, locationId: p.location_id,
      supplierId: p.supplier_id, supplier: s },
    // quantities are in the line's unit (a pack such as Carton, or the base unit); baseQty is the stock the line brings in
    items: items.map((i) => ({ id: i.id, productId: i.product_id, name: i.name, sku: i.sku, qty: i.buy_unit ? num(i.buy_qty) : num(i.qty),
      unitCost: i.buy_unit ? num(i.buy_cost) : num(i.unit_cost), unit: i.buy_unit || null, baseQty: num(i.qty), baseUnit: i.base_unit, total: num(i.line_total),
      received: inUnit(i, i.received_qty), damaged: inUnit(i, i.damaged_qty), returned: inUnit(i, i.returned_qty),
      outstanding: inUnit(i, Math.max(0, num(i.qty) - num(i.received_qty) - num(i.damaged_qty))),
      batchNo: i.batch_no || "", expiryDate: i.expiry_date || null, trackBatches: Boolean(i.track_batches), tracking: i.tracking || "qty",
      devices: devices.filter((d) => d.product_id === i.product_id).map((d) => ({ id: d.id, label: deviceLabel(d), status: d.status })) })),
    payments: payments.map((x) => ({ amount: num(x.amount), method: x.method, at: x.paid_at, reference: x.reference }))
  });
}));

router.post("/:id/payments", requirePerm("purchases.pay"), ah(async (req, res) => {
  const pay = readPayment(req.body || {});
  const bid = req.business.id;
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (!PAYABLE.includes(p.status)) throw conflict("notPayable");
    await paySupplier(conn, { businessId: bid, userId: req.user.id, supplierId: p.supplier_id, purchaseId: p.id, ...pay, reference: pay.reference || p.purchase_no });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "supplier.paid", entity: "purchase", entityId: p.id, meta: { amount: pay.amount }, ip: req.ip });
  });
  res.status(201).json({ code: "saved" });
}));

/* POST /api/purchases/:id/confirm — a draft becomes a purchase order (still no stock) */
router.post("/:id/confirm", requirePerm("purchases.create"), ah(async (req, res) => {
  const bid = req.business.id;
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (p.status !== "draft") throw conflict("notDraft");
    await conn.query("UPDATE purchases SET status = 'ordered' WHERE id = ?", [p.id]);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "purchase.ordered", entity: "purchase", entityId: p.id, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/*
 * POST /api/purchases/:id/receive — goods receipt of a purchase order (complete or partial).
 * { locationId?, note?, items?: [{ id, qty?, damaged?, unitCost?, batchNo?, expiryDate?, devices? }] }
 *   qty / damaged / unitCost are in the line's unit (pack or base unit); qty left out = everything outstanding.
 *   damaged goods are recorded on the line but not added to stock. devices: serial numbers / IMEIs, one per unit.
 * Stock goes up by what is received; whatever is still outstanding stays on order (backorder, status partial).
 */
router.post("/:id/receive", requirePerm("purchases.create"), ah(async (req, res) => {
  const bid = req.business.id;
  const given = new Map((Array.isArray(req.body?.items) ? req.body.items : []).map((x) => [id(x?.id), x]));
  const result = await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (!["ordered", "partial"].includes(p.status)) throw conflict("notOrdered");
    const locationId = id(req.body?.locationId) || p.location_id || (await defaultLocationId(conn, bid));
    const [[loc]] = await conn.query("SELECT id FROM stock_locations WHERE id = ? AND business_id = ? AND is_active = 1", [locationId, bid]);
    if (!loc) throw badRequest({ locationId: "required" });
    const [items] = await conn.query("SELECT * FROM purchase_items WHERE purchase_id = ? AND business_id = ? ORDER BY id FOR UPDATE", [p.id, bid]);
    const products = await lockProducts(conn, bid, items.map((i) => i.product_id));
    let units = 0;
    for (const [k, i] of items.entries()) {
      const g = given.get(i.id) || (given.size ? null : {});
      if (!g) continue;
      const per = perOfItem(i);
      const outstanding = q3(num(i.qty) - num(i.received_qty) - num(i.damaged_qty));
      if (outstanding <= 0) continue;
      const qty = g.qty === undefined || g.qty === null || g.qty === "" ? outstanding : q3(Number(g.qty) * per);
      const damaged = g.damaged ? q3(Number(g.damaged) * per) : 0;
      if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(damaged) || damaged < 0 || qty + damaged > outstanding + 0.0005) {
        throw new HttpError(400, "validation", { [`items.${k}.qty`]: "moreThanOutstanding" }, { outstanding: q3(outstanding / per) });
      }
      const product = products.get(i.product_id);
      if (isTracked(product) && !Number.isInteger(qty)) throw badRequest({ [`items.${k}.qty`]: "wholeUnits" });
      // actual cost (per the line's unit) when it differs from the order
      if (g.unitCost !== undefined && g.unitCost !== null && g.unitCost !== "") {
        const cost = money(g.unitCost);
        if (Number.isNaN(cost)) throw badRequest({ [`items.${k}.unitCost`]: "invalidAmount" });
        if (i.buy_unit) await conn.query("UPDATE purchase_items SET buy_cost = ?, unit_cost = ?, line_total = ? WHERE id = ?", [cost, round2(cost / per), round2(num(i.buy_qty) * cost), i.id]);
        else await conn.query("UPDATE purchase_items SET unit_cost = ?, line_total = ? WHERE id = ?", [cost, round2(num(i.qty) * cost), i.id]);
        i.unit_cost = i.buy_unit ? round2(cost / per) : cost;
      }
      const batch = g.batchNo !== undefined || g.expiryDate !== undefined ? readBatch(g, qty)[0] || null : null;
      const batchNo = batch ? batch.batchNo || null : g.batchNo !== undefined ? null : i.batch_no;
      const expiryDate = batch ? batch.expiryDate || null : g.expiryDate !== undefined ? null : i.expiry_date;
      if (qty > 0) {
        const devices = isTracked(product) ? readNewDevices(product, g.devices, qty, `items.${k}.devices`) : null;
        await receiveLine(conn, { businessId: bid, userId: req.user.id, purchaseId: p.id, number: p.purchase_no, supplierId: p.supplier_id, locationId },
          { product, qty, unitCost: num(i.unit_cost), batchNo, expiryDate, devices });
      }
      await conn.query("UPDATE purchase_items SET received_qty = received_qty + ?, damaged_qty = damaged_qty + ?, batch_no = ?, expiry_date = ? WHERE id = ?",
        [qty, damaged, batchNo, expiryDate, i.id]);
      units += qty + damaged;
    }
    if (units <= 0) throw badRequest({ items: "nothingReceived" });
    await conn.query("UPDATE purchases SET received_at = UTC_TIMESTAMP(), location_id = ? WHERE id = ?", [locationId, p.id]);
    const r = await settle(conn, p);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "purchase.received", entity: "purchase", entityId: p.id,
      meta: { status: r.status, note: optText(req.body?.note, 255) }, ip: req.ip });
    return r;
  });
  res.json({ code: "saved", ...result });
}));

/* POST /api/purchases/:id/close { reason } — stop waiting for the outstanding quantities (backorder dropped) */
router.post("/:id/close", requirePerm("purchases.create"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const bid = req.business.id;
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (p.status !== "partial") throw conflict("notPartial");
    await settle(conn, { ...p, closed: true });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "purchase.closed", entity: "purchase", entityId: p.id, meta: { reason }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/*
 * POST /api/purchases/:id/return { reason, items: [{ id, qty, deviceIds? }] } — supplier return of received goods.
 * qty in the line's unit; serial / IMEI products return the exact devices (from this purchase, still in stock).
 */
router.post("/:id/return", requirePerm("purchases.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const bid = req.business.id;
  const given = Array.isArray(req.body?.items) ? req.body.items : [];
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (!PAYABLE.includes(p.status)) throw conflict("notReturnable");
    const [items] = await conn.query("SELECT * FROM purchase_items WHERE purchase_id = ? AND business_id = ? FOR UPDATE", [p.id, bid]);
    const products = await lockProducts(conn, bid, items.map((i) => i.product_id));
    const locationId = p.location_id || (await defaultLocationId(conn, bid));
    let units = 0;
    for (const [k, g] of given.entries()) {
      const i = items.find((x) => x.id === id(g?.id));
      if (!i) throw badRequest({ [`items.${k}.id`]: "required" });
      const per = perOfItem(i);
      const qty = q3(Number(g.qty) * per);
      const left = q3(num(i.received_qty) - num(i.returned_qty));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (qty > left + 0.0005) throw new HttpError(400, "validation", { [`items.${k}.qty`]: "moreThanReceived" }, { left: q3(left / per) });
      const product = products.get(i.product_id);
      let devices = null;
      if (isTracked(product)) {
        devices = await pickDevices(conn, { businessId: bid, product, locationId: null, deviceIds: g.deviceIds, qty, field: `items.${k}.deviceIds` });
        if (devices.some((d) => d.purchase_id !== p.id)) throw badRequest({ [`items.${k}.deviceIds`]: "deviceNotFound" });
      }
      // devices go back from wherever they are; plain stock from the purchase's location
      const from = devices ? devices[0].location_id : locationId;
      const m = await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: -qty, type: "purchase_return", refType: "purchase", refId: p.id, locationId: from, note: reason, devices: true });
      if (devices) await updateDevices(conn, devices, { status: "returned_supplier", locationId: null, event: "returned_supplier", refType: "purchase", refId: p.id, note: reason, userId: req.user.id });
      await conn.query("UPDATE purchase_items SET returned_qty = returned_qty + ? WHERE id = ?", [qty, i.id]);
      units += qty;
      void m;
    }
    if (units <= 0) throw badRequest({ items: "required" });
    await settle(conn, p);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "purchase.returned", entity: "purchase", entityId: p.id, meta: { reason }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/* POST /api/purchases/:id/cancel { reason } — drafts / orders (no stock), or unpaid purchases: removes the received stock again */
router.post("/:id/cancel", requirePerm("purchases.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const bid = req.business.id;
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (!["draft", "ordered", "partial", "received"].includes(p.status)) throw conflict("alreadyCancelled");
    if (num(p.amount_paid) > 0) throw conflict("hasPayments");
    const [items] = await conn.query("SELECT * FROM purchase_items WHERE purchase_id = ? AND business_id = ?", [p.id, bid]);
    const products = await lockProducts(conn, bid, items.map((i) => i.product_id));
    const locationId = p.location_id || (await defaultLocationId(conn, bid));
    for (const i of items) {
      const qty = q3(num(i.received_qty) - num(i.returned_qty));
      if (qty <= 0) continue;
      const product = products.get(i.product_id);
      if (isTracked(product)) {
        const [devs] = await conn.query("SELECT * FROM devices WHERE business_id = ? AND purchase_id = ? AND product_id = ? AND status = 'available' FOR UPDATE", [bid, p.id, product.id]);
        if (devs.length < qty) throw conflict("devicesSold");
        for (const d of devs) {
          await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: -1, type: "purchase_return", refType: "purchase", refId: p.id, locationId: d.location_id, note: reason, devices: true });
        }
        await updateDevices(conn, devs, { status: "returned_supplier", locationId: null, event: "returned_supplier", refType: "purchase", refId: p.id, note: reason, userId: req.user.id });
      } else {
        await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: -qty, type: "purchase_return", refType: "purchase", refId: p.id, locationId, note: reason, devices: true });
      }
    }
    await conn.query("UPDATE purchases SET status = 'cancelled' WHERE id = ? AND business_id = ?", [p.id, bid]);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "purchase.cancelled", entity: "purchase", entityId: p.id, meta: { reason }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
