import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, money, quantity, withTx, ensureOwned, badRequest, conflict, num, round2, METHODS, text, range } from "../lib/http.js";
import { nextNumber, lockProducts, moveStock } from "../lib/ledger.js";
import { paySupplier, readPayment } from "./parties.js";
import { readBatch } from "../lib/batches.js";
import { unitsPer } from "../lib/packaging.js";

const router = Router();
router.use(requireAuth);

/* What is owed on a purchase: nothing until the goods are received (purchase orders), nothing once cancelled. */
const owed = (p) => (p.status === "received" ? round2(num(p.total) - num(p.amount_paid)) : 0);

/*
 * Records a purchase. body: { supplierId, receive?, items:[{productId, qty, unitCost, unit?, batchNo?, expiryDate?}], amountPaid?, method?, bankAccountId?, reference? }
 *   unit: a pack of the product (e.g. "Carton", lib/packaging.js) — qty and unitCost are then per pack; stock and the
 *         product cost are kept per base unit (2 cartons of 6,000 tablets = 12,000 tablets).
 *   receive: false → a purchase order ("ordered"): nothing is added to stock and nothing is owed until the goods
 *         are received (POST /:id/receive). Otherwise the goods are received now: stock in, product cost updated
 *         to the latest purchase cost, optional payment now (only users allowed to pay suppliers), outstanding = payable.
 */
export async function createPurchase(conn, ctx, body) {
  const { businessId, userId, role } = ctx;
  const supplierId = id(body.supplierId);
  if (!supplierId) throw badRequest({ supplierId: "required" });
  await ensureOwned(conn, "suppliers", supplierId, businessId);
  const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
  if (!items.length) throw badRequest({ items: "required" });
  const receive = body.receive !== false && body.receive !== "false";

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
    const baseQty = Math.round(qty * (per || 1) * 1000) / 1000;
    const batch = readBatch(it, baseQty)[0] || null;
    return { product: p, qty: baseQty, unitCost: unit ? round2(cost / per) : cost, lineTotal: round2(qty * cost),
      buy: unit ? { unit, qty, cost } : null, batchNo: batch?.batchNo || null, expiryDate: batch?.expiryDate || null };
  });
  if (Object.keys(errors).length) throw badRequest(errors);
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

  const amountPaid = body.amountPaid ? money(body.amountPaid) : 0;
  if (Number.isNaN(amountPaid) || amountPaid > total) throw badRequest({ amountPaid: "invalidAmount" });
  if (amountPaid > 0 && !receive) throw badRequest({ amountPaid: "notReceivedYet" });
  if (amountPaid > 0 && !can(role, "purchases.pay")) throw badRequest({ amountPaid: "forbidden" });
  if (amountPaid > 0 && !METHODS.includes(body.method)) throw badRequest({ method: "required" });

  const number = await nextNumber(conn, businessId, "purchase");
  const [r] = await conn.query(
    `INSERT INTO purchases (business_id, purchase_no, supplier_id, user_id, total, amount_paid, status, purchased_at, received_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, COALESCE(?, UTC_TIMESTAMP()), ${receive ? "COALESCE(?, UTC_TIMESTAMP())" : "?"})`,
    [businessId, number, supplierId, userId, total, receive ? "received" : "ordered", ctx.at || null, receive ? ctx.at || null : null]
  );
  for (const l of lines) {
    await conn.query(
      `INSERT INTO purchase_items (business_id, purchase_id, product_id, qty, unit_cost, line_total, buy_unit, buy_qty, buy_cost, batch_no, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [businessId, r.insertId, l.product.id, l.qty, l.unitCost, l.lineTotal, l.buy?.unit || null, l.buy?.qty ?? null, l.buy?.cost ?? null, l.batchNo, l.expiryDate]);
    if (receive) await receiveLine(conn, { businessId, userId, purchaseId: r.insertId, number }, l);
  }
  if (amountPaid > 0) {
    await paySupplier(conn, { businessId, userId, supplierId, purchaseId: r.insertId, amount: amountPaid, method: body.method, bankAccountId: id(body.bankAccountId), reference: text(body.reference, 80) || number, at: ctx.at || null });
  }
  await audit(conn, { businessId, userId, action: receive ? "purchase.created" : "purchase.ordered", entity: "purchase", entityId: r.insertId, meta: { total, amountPaid } });
  return { id: r.insertId, number, total, status: receive ? "received" : "ordered" };
}

/* Goods received for one line: stock in (base units, with its batch / expiry) and the product cost updated. */
async function receiveLine(conn, { businessId, userId, purchaseId, number }, l) {
  const batches = l.batchNo || l.expiryDate ? [{ batchNo: l.batchNo || "", expiryDate: l.expiryDate || null, qty: l.qty }] : [];
  await moveStock(conn, { businessId, userId, product: l.product, qtyChange: l.qty, type: "purchase", refType: "purchase", refId: purchaseId, batches });
  if (num(l.product.cost_price) !== l.unitCost) {
    // purchase cost changes are part of the product's change history
    await audit(conn, { businessId, userId, action: "product.changed", entity: "product", entityId: l.product.id,
      meta: { changes: [{ field: "costPrice", from: num(l.product.cost_price), to: l.unitCost }], source: number } });
    l.product.cost_price = l.unitCost;
  }
  await conn.query("UPDATE products SET cost_price = ? WHERE id = ? AND business_id = ?", [l.unitCost, l.product.id, businessId]);
}

router.post("/", requirePerm("purchases.create"), ah(async (req, res) => {
  const result = await withTx((conn) => createPurchase(conn, { businessId: req.business.id, userId: req.user.id, role: req.user }, req.body || {}));
  res.status(201).json(result);
}));

router.get("/", requirePerm("purchases.view"), ah(async (req, res) => {
  const r = range(req.query, 90);
  const q = text(req.query.q, 60);
  const [rows] = await pool.query(
    `SELECT p.id, p.purchase_no, p.total, p.amount_paid, p.status, p.purchased_at, s.name supplier
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id AND s.business_id = p.business_id
      WHERE p.business_id = ? AND p.purchased_at BETWEEN ? AND ? ${q ? "AND (p.purchase_no LIKE ? OR s.name LIKE ?)" : ""}
      ORDER BY p.purchased_at DESC, p.id DESC LIMIT 500`,
    q ? [req.business.id, r.start, r.end, `%${q}%`, `%${q}%`] : [req.business.id, r.start, r.end]);
  res.json({ range: r, purchases: rows.map((p) => ({ id: p.id, number: p.purchase_no, total: num(p.total), paid: num(p.amount_paid), balance: owed(p), status: p.status, at: p.purchased_at, supplier: p.supplier })) });
}));

router.get("/:id", requirePerm("purchases.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const p = await ensureOwned(pool, "purchases", id(req.params.id), bid);
  const [items] = await pool.query(
    `SELECT pi.id, pi.qty, pi.unit_cost, pi.line_total, pi.buy_unit, pi.buy_qty, pi.buy_cost, pi.batch_no, pi.expiry_date, pr.unit base_unit, pr.track_batches, CONCAT_WS(' ', pr.name, NULLIF(pr.size, ''), NULLIF(pr.shade, ''), NULLIF(pr.fragrance, ''), NULLIF(pr.formula, ''), NULLIF(pr.pack_size, '')) name, pr.sku FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id AND pr.business_id = pi.business_id
      WHERE pi.purchase_id = ? AND pi.business_id = ? ORDER BY pi.id`, [p.id, bid]);
  const [[s]] = await pool.query("SELECT name, phone FROM suppliers WHERE id = ? AND business_id = ?", [p.supplier_id, bid]);
  const [payments] = await pool.query("SELECT amount, method, paid_at, reference FROM supplier_payments WHERE purchase_id = ? AND business_id = ? ORDER BY id", [p.id, bid]);
  res.json({
    purchase: { id: p.id, number: p.purchase_no, at: p.purchased_at, receivedAt: p.received_at || null, status: p.status, total: num(p.total), paid: num(p.amount_paid), balance: owed(p), supplierId: p.supplier_id, supplier: s },
    // bought in a pack: qty / unitCost per pack (e.g. 2 Carton × 30.00); baseQty is the stock it brings in
    items: items.map((i) => ({ id: i.id, name: i.name, sku: i.sku, qty: i.buy_unit ? num(i.buy_qty) : num(i.qty), unitCost: i.buy_unit ? num(i.buy_cost) : num(i.unit_cost),
      unit: i.buy_unit || null, baseQty: num(i.qty), baseUnit: i.base_unit, total: num(i.line_total),
      batchNo: i.batch_no || "", expiryDate: i.expiry_date || null, trackBatches: Boolean(i.track_batches) })),
    payments: payments.map((x) => ({ amount: num(x.amount), method: x.method, at: x.paid_at, reference: x.reference }))
  });
}));

router.post("/:id/payments", requirePerm("purchases.pay"), ah(async (req, res) => {
  const pay = readPayment(req.body || {});
  const bid = req.business.id;
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (p.status !== "received") throw conflict("notPayable");
    await paySupplier(conn, { businessId: bid, userId: req.user.id, supplierId: p.supplier_id, purchaseId: p.id, ...pay, reference: pay.reference || p.purchase_no });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "supplier.paid", entity: "purchase", entityId: p.id, meta: { amount: pay.amount }, ip: req.ip });
  });
  res.status(201).json({ code: "saved" });
}));

/*
 * POST /api/purchases/:id/receive { items?: [{ id, batchNo?, expiryDate? }] } — goods receipt of a purchase order:
 * the ordered quantities are added to stock (with their batch / expiry), costs updated, the purchase becomes payable.
 */
router.post("/:id/receive", requirePerm("purchases.create"), ah(async (req, res) => {
  const bid = req.business.id;
  const given = new Map((Array.isArray(req.body?.items) ? req.body.items : []).map((x) => [id(x?.id), x]));
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (p.status !== "ordered") throw conflict("notOrdered");
    const [items] = await conn.query("SELECT * FROM purchase_items WHERE purchase_id = ? AND business_id = ? ORDER BY id", [p.id, bid]);
    const products = await lockProducts(conn, bid, items.map((i) => i.product_id));
    for (const i of items) {
      const g = given.get(i.id);
      const batch = g ? readBatch(g, num(i.qty))[0] || null : null;
      const batchNo = g ? batch?.batchNo || null : i.batch_no;
      const expiryDate = g ? batch?.expiryDate || null : i.expiry_date;
      if (g) await conn.query("UPDATE purchase_items SET batch_no = ?, expiry_date = ? WHERE id = ?", [batchNo, expiryDate, i.id]);
      await receiveLine(conn, { businessId: bid, userId: req.user.id, purchaseId: p.id, number: p.purchase_no },
        { product: products.get(i.product_id), qty: num(i.qty), unitCost: num(i.unit_cost), batchNo, expiryDate });
    }
    await conn.query("UPDATE purchases SET status = 'received', received_at = UTC_TIMESTAMP() WHERE id = ? AND business_id = ?", [p.id, bid]);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "purchase.received", entity: "purchase", entityId: p.id, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/* POST /api/purchases/:id/cancel { reason } — unpaid purchases (or purchase orders) only; removes the stock again */
router.post("/:id/cancel", requirePerm("purchases.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const bid = req.business.id;
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (p.status !== "received" && p.status !== "ordered") throw conflict("alreadyCancelled");
    if (num(p.amount_paid) > 0) throw conflict("hasPayments");
    const [items] = p.status === "ordered" ? [[]]          // purchase order: no stock was added
      : await conn.query("SELECT product_id, qty FROM purchase_items WHERE purchase_id = ? AND business_id = ?", [p.id, bid]);
    const products = await lockProducts(conn, bid, items.map((i) => i.product_id));
    for (const i of items) {
      await moveStock(conn, { businessId: bid, userId: req.user.id, product: products.get(i.product_id), qtyChange: -num(i.qty), type: "purchase_return", refType: "purchase", refId: p.id, note: reason });
    }
    await conn.query("UPDATE purchases SET status = 'cancelled' WHERE id = ? AND business_id = ?", [p.id, bid]);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "purchase.cancelled", entity: "purchase", entityId: p.id, meta: { reason }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
