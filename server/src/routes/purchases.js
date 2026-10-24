import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, money, quantity, withTx, ensureOwned, badRequest, conflict, num, round2, METHODS, text, range } from "../lib/http.js";
import { nextNumber, lockProducts, moveStock } from "../lib/ledger.js";
import { paySupplier, readPayment } from "./parties.js";

const router = Router();
router.use(requireAuth);

/*
 * Records a received purchase: stock in, product cost updated to the latest purchase cost,
 * optional payment now (only users allowed to pay suppliers), outstanding = payable.
 * body: { supplierId, items:[{productId, qty, unitCost}], amountPaid?, method?, bankAccountId?, reference? }
 */
export async function createPurchase(conn, ctx, body) {
  const { businessId, userId, role } = ctx;
  const supplierId = id(body.supplierId);
  if (!supplierId) throw badRequest({ supplierId: "required" });
  await ensureOwned(conn, "suppliers", supplierId, businessId);
  const items = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
  if (!items.length) throw badRequest({ items: "required" });

  const products = await lockProducts(conn, businessId, items.map((i) => id(i?.productId)).filter(Boolean));
  const errors = {};
  const lines = items.map((it, i) => {
    const p = products.get(id(it?.productId));
    const qty = quantity(it?.qty);
    const unitCost = money(it?.unitCost);
    if (!p) errors[`items.${i}.productId`] = "required";
    if (Number.isNaN(qty)) errors[`items.${i}.qty`] = "invalidAmount";
    if (Number.isNaN(unitCost)) errors[`items.${i}.unitCost`] = "invalidAmount";
    return { product: p, qty, unitCost, lineTotal: round2(qty * unitCost) };
  });
  if (Object.keys(errors).length) throw badRequest(errors);
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));

  const amountPaid = body.amountPaid ? money(body.amountPaid) : 0;
  if (Number.isNaN(amountPaid) || amountPaid > total) throw badRequest({ amountPaid: "invalidAmount" });
  if (amountPaid > 0 && !can(role, "purchases.pay")) throw badRequest({ amountPaid: "forbidden" });
  if (amountPaid > 0 && !METHODS.includes(body.method)) throw badRequest({ method: "required" });

  const number = await nextNumber(conn, businessId, "purchase");
  const [r] = await conn.query(
    `INSERT INTO purchases (business_id, purchase_no, supplier_id, user_id, total, amount_paid, status, purchased_at)
     VALUES (?, ?, ?, ?, ?, 0, 'received', COALESCE(?, UTC_TIMESTAMP()))`,
    [businessId, number, supplierId, userId, total, ctx.at || null]
  );
  for (const l of lines) {
    await conn.query("INSERT INTO purchase_items (business_id, purchase_id, product_id, qty, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?)",
      [businessId, r.insertId, l.product.id, l.qty, l.unitCost, l.lineTotal]);
    await moveStock(conn, { businessId, userId, product: l.product, qtyChange: l.qty, type: "purchase", refType: "purchase", refId: r.insertId });
    await conn.query("UPDATE products SET cost_price = ? WHERE id = ? AND business_id = ?", [l.unitCost, l.product.id, businessId]);
  }
  if (amountPaid > 0) {
    await paySupplier(conn, { businessId, userId, supplierId, purchaseId: r.insertId, amount: amountPaid, method: body.method, bankAccountId: id(body.bankAccountId), reference: text(body.reference, 80) || number, at: ctx.at || null });
  }
  await audit(conn, { businessId, userId, action: "purchase.created", entity: "purchase", entityId: r.insertId, meta: { total, amountPaid } });
  return { id: r.insertId, number, total };
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
  res.json({ range: r, purchases: rows.map((p) => ({ id: p.id, number: p.purchase_no, total: num(p.total), paid: num(p.amount_paid), balance: round2(num(p.total) - num(p.amount_paid)), status: p.status, at: p.purchased_at, supplier: p.supplier })) });
}));

router.get("/:id", requirePerm("purchases.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const p = await ensureOwned(pool, "purchases", id(req.params.id), bid);
  const [items] = await pool.query(
    `SELECT pi.qty, pi.unit_cost, pi.line_total, pr.name, pr.sku FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id AND pr.business_id = pi.business_id
      WHERE pi.purchase_id = ? AND pi.business_id = ? ORDER BY pi.id`, [p.id, bid]);
  const [[s]] = await pool.query("SELECT name, phone FROM suppliers WHERE id = ? AND business_id = ?", [p.supplier_id, bid]);
  const [payments] = await pool.query("SELECT amount, method, paid_at, reference FROM supplier_payments WHERE purchase_id = ? AND business_id = ? ORDER BY id", [p.id, bid]);
  res.json({
    purchase: { id: p.id, number: p.purchase_no, at: p.purchased_at, status: p.status, total: num(p.total), paid: num(p.amount_paid), balance: round2(num(p.total) - num(p.amount_paid)), supplierId: p.supplier_id, supplier: s },
    items: items.map((i) => ({ name: i.name, sku: i.sku, qty: num(i.qty), unitCost: num(i.unit_cost), total: num(i.line_total) })),
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

/* POST /api/purchases/:id/cancel { reason } — unpaid purchases only; removes the stock again */
router.post("/:id/cancel", requirePerm("purchases.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const bid = req.business.id;
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "purchases", id(req.params.id), bid, true);
    if (p.status !== "received") throw conflict("alreadyCancelled");
    if (num(p.amount_paid) > 0) throw conflict("hasPayments");
    const [items] = await conn.query("SELECT product_id, qty FROM purchase_items WHERE purchase_id = ? AND business_id = ?", [p.id, bid]);
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
