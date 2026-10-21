import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, money, quantity, withTx, ensureOwned, badRequest, conflict, num, round2, METHODS, text, optText, range } from "../lib/http.js";
import { nextNumber, lockProducts, moveStock, moneyMove } from "../lib/ledger.js";

const router = Router();
router.use(requireAuth);

/** Validates and prices cart lines against locked products. Shared by POS and invoices. */
export function priceLines(items, products, { allowCustomPrice, priceList = "retail" }) {
  const lines = [];
  const errors = {};
  items.forEach((it, i) => {
    const p = products.get(it.productId);
    const qty = quantity(it.qty);
    if (!p || !p.is_active) { errors[`items.${i}.productId`] = "required"; return; }
    if (Number.isNaN(qty)) { errors[`items.${i}.qty`] = "invalidAmount"; return; }
    const listPrice = priceList === "wholesale" && p.wholesale_price !== null ? num(p.wholesale_price) : num(p.selling_price);
    let unitPrice = listPrice;
    if (it.unitPrice !== undefined && it.unitPrice !== null && it.unitPrice !== "" && Number(it.unitPrice) !== listPrice) {
      if (!allowCustomPrice) { errors[`items.${i}.unitPrice`] = "forbidden"; return; }
      unitPrice = money(it.unitPrice);
      if (Number.isNaN(unitPrice)) { errors[`items.${i}.unitPrice`] = "invalidAmount"; return; }
    }
    lines.push({ product: p, qty, unitPrice, unitCost: num(p.cost_price), lineTotal: round2(qty * unitPrice) });
  });
  if (Object.keys(errors).length) throw badRequest(errors);
  return lines;
}

function readItems(body) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 200).map((x) => ({ productId: id(x?.productId), qty: x?.qty, unitPrice: x?.unitPrice })) : [];
  if (!items.length) throw badRequest({ items: "required" });
  return items;
}

/*
 * Creates a POS sale in one transaction: number, lines, stock out, payment, money in, audit.
 * body: { items:[{productId, qty, unitPrice?}], customerId?, discount?, paymentMethod: cash|mobile_money|bank|credit,
 *         amountReceived?, paidMethod? (for credit), bankAccountId? }
 */
export async function createSale(conn, ctx, body) {
  const { businessId, userId, role } = ctx;
  const items = readItems(body);
  const method = body.paymentMethod;
  if (![...METHODS, "credit"].includes(method)) throw badRequest({ paymentMethod: "required" });
  const discount = body.discount ? money(body.discount) : 0;
  if (Number.isNaN(discount)) throw badRequest({ discount: "invalidAmount" });
  if (discount > 0 && !can(role, "sales.discount")) throw badRequest({ discount: "forbidden" });

  let customerId = id(body.customerId);
  if (customerId) await ensureOwned(conn, "customers", customerId, businessId);
  if (method === "credit" && !customerId) throw badRequest({ customerId: "requiredForCredit" });

  const products = await lockProducts(conn, businessId, items.map((i) => i.productId).filter(Boolean));
  const lines = priceLines(items, products, { allowCustomPrice: can(role, "sales.discount") });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  if (discount > subtotal) throw badRequest({ discount: "tooLarge" });
  const total = round2(subtotal - discount);

  // Money actually collected now.
  let paid; let paidMethod; let change = 0;
  if (method === "credit") {
    paid = body.amountReceived ? money(body.amountReceived) : 0;
    if (Number.isNaN(paid) || paid > total) throw badRequest({ amountReceived: "invalidAmount" });
    paidMethod = METHODS.includes(body.paidMethod) ? body.paidMethod : "cash";
  } else {
    const received = body.amountReceived === undefined || body.amountReceived === "" ? total : money(body.amountReceived);
    if (Number.isNaN(received) || received < total) throw badRequest({ amountReceived: "notEnough" });
    paid = total;
    change = round2(received - total);
    paidMethod = method;
  }

  const receiptNo = await nextNumber(conn, businessId, "receipt");
  const [s] = await conn.query(
    `INSERT INTO sales (business_id, receipt_no, customer_id, user_id, subtotal, discount, total, amount_paid, payment_method, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
    [businessId, receiptNo, customerId, userId, subtotal, discount, total, paid, method, ctx.at || null]
  );
  const saleId = s.insertId;
  for (const l of lines) {
    await conn.query(
      `INSERT INTO sale_items (business_id, sale_id, product_id, qty, unit_price, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [businessId, saleId, l.product.id, l.qty, l.unitPrice, l.unitCost, l.lineTotal]
    );
    await moveStock(conn, { businessId, userId, product: l.product, qtyChange: -l.qty, type: "sale", refType: "sale", refId: saleId });
  }
  if (paid > 0) {
    const [p] = await conn.query(
      `INSERT INTO customer_payments (business_id, customer_id, sale_id, amount, method, paid_at, user_id) VALUES (?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), ?)`,
      [businessId, customerId, saleId, paid, paidMethod, ctx.at || null, userId]
    );
    await moneyMove(conn, { businessId, userId, direction: "in", method: paidMethod, bankAccountId: id(body.bankAccountId), amount: paid, refType: "customer_payment", refId: p.insertId, description: receiptNo, at: ctx.at || null });
  }
  await audit(conn, { businessId, userId, action: "sale.created", entity: "sale", entityId: saleId, meta: { total, method } });
  return { id: saleId, receiptNo, total, paid, change };
}

router.post("/", requirePerm("sales.create"), ah(async (req, res) => {
  const result = await withTx((conn) => createSale(conn, { businessId: req.business.id, userId: req.user.id, role: req.user.role }, req.body || {}));
  res.status(201).json(result);
}));

/* GET /api/sales?from=&to=&q= */
router.get("/", requirePerm("sales.view"), ah(async (req, res) => {
  const r = range(req.query, 7);
  const q = text(req.query.q, 60);
  const [rows] = await pool.query(
    `SELECT s.id, s.receipt_no, s.total, s.amount_paid, s.payment_method, s.status, s.sold_at, c.name customer, u.full_name cashier,
            (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) lines_count
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.user_id
      WHERE s.business_id = ? AND s.sold_at BETWEEN ? AND ? ${q ? "AND (s.receipt_no LIKE ? OR c.name LIKE ?)" : ""}
      ORDER BY s.sold_at DESC, s.id DESC LIMIT 500`,
    q ? [req.business.id, r.start, r.end, `%${q}%`, `%${q}%`] : [req.business.id, r.start, r.end]
  );
  res.json({ range: r, sales: rows.map((s) => ({ id: s.id, number: s.receipt_no, total: num(s.total), paid: num(s.amount_paid), method: s.payment_method, status: s.status, at: s.sold_at, customer: s.customer, cashier: s.cashier, lines: num(s.lines_count) })) });
}));

/* GET /api/sales/:id — receipt */
router.get("/:id", requirePerm("sales.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const s = await ensureOwned(pool, "sales", id(req.params.id), bid);
  const [items] = await pool.query(
    `SELECT si.qty, si.unit_price, si.line_total, p.name, p.sku FROM sale_items si JOIN products p ON p.id = si.product_id AND p.business_id = si.business_id
      WHERE si.sale_id = ? AND si.business_id = ? ORDER BY si.id`, [s.id, bid]);
  const [[cust]] = s.customer_id ? await pool.query("SELECT name, phone FROM customers WHERE id = ? AND business_id = ?", [s.customer_id, bid]) : [[null]];
  const [[cashier]] = await pool.query("SELECT full_name FROM users WHERE id = ? AND business_id = ?", [s.user_id, bid]);
  const [payments] = await pool.query("SELECT amount, method, paid_at FROM customer_payments WHERE sale_id = ? AND business_id = ? ORDER BY id", [s.id, bid]);
  res.json({
    business: req.business,
    sale: { id: s.id, number: s.receipt_no, at: s.sold_at, status: s.status, method: s.payment_method, subtotal: num(s.subtotal), discount: num(s.discount), total: num(s.total), paid: num(s.amount_paid), balance: round2(num(s.total) - num(s.amount_paid)), customer: cust, cashier: cashier?.full_name },
    items: items.map((i) => ({ name: i.name, sku: i.sku, qty: num(i.qty), unitPrice: num(i.unit_price), total: num(i.line_total) })),
    payments: payments.map((p) => ({ amount: num(p.amount), method: p.method, at: p.paid_at }))
  });
}));

/* POST /api/sales/:id/cancel  { reason } — restores stock, refunds money received, keeps an audit record */
router.post("/:id/cancel", requirePerm("sales.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const bid = req.business.id;
  const uid = req.user.id;
  await withTx(async (conn) => {
    const s = await ensureOwned(conn, "sales", id(req.params.id), bid, true);
    if (s.status !== "completed") throw conflict("alreadyCancelled");
    const [items] = await conn.query("SELECT product_id, qty, unit_price, unit_cost, line_total FROM sale_items WHERE sale_id = ? AND business_id = ?", [s.id, bid]);
    const products = await lockProducts(conn, bid, items.map((i) => i.product_id));
    const [ret] = await conn.query(
      "INSERT INTO returns (business_id, type, sale_id, total, refund_amount, reason, user_id, approved_by, returned_at) VALUES (?, 'sale', ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())",
      [bid, s.id, s.total, s.amount_paid, reason, uid, uid]
    );
    for (const i of items) {
      await conn.query("INSERT INTO return_items (business_id, return_id, product_id, qty, unit_price, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [bid, ret.insertId, i.product_id, i.qty, i.unit_price, i.unit_cost, i.line_total]);
      await moveStock(conn, { businessId: bid, userId: uid, product: products.get(i.product_id), qtyChange: num(i.qty), type: "return_in", refType: "sale", refId: s.id, note: reason });
    }
    // Refund each payment through the same method (negative payment keeps "money received" accurate).
    const [payments] = await conn.query("SELECT method, SUM(amount) amount FROM customer_payments WHERE sale_id = ? AND business_id = ? GROUP BY method", [s.id, bid]);
    for (const p of payments) {
      const amount = round2(num(p.amount));
      if (amount <= 0) continue;
      await conn.query("INSERT INTO customer_payments (business_id, customer_id, sale_id, amount, method, reference, paid_at, user_id) VALUES (?, ?, ?, ?, ?, 'REFUND', UTC_TIMESTAMP(), ?)",
        [bid, s.customer_id, s.id, -amount, p.method, uid]);
      await moneyMove(conn, { businessId: bid, userId: uid, direction: "out", method: p.method, bankAccountId: null, amount, refType: "refund", refId: ret.insertId, description: `${s.receipt_no} refund` }).catch(async (err) => {
        // bank refunds need the original bank account
        if (p.method !== "bank") throw err;
        const [[acc]] = await conn.query("SELECT bank_account_id FROM cash_transactions WHERE business_id = ? AND ref_type = 'customer_payment' AND description = ? AND bank_account_id IS NOT NULL LIMIT 1", [bid, s.receipt_no]);
        await moneyMove(conn, { businessId: bid, userId: uid, direction: "out", method: "bank", bankAccountId: acc?.bank_account_id, amount, refType: "refund", refId: ret.insertId, description: `${s.receipt_no} refund` });
      });
    }
    await conn.query("UPDATE sales SET status = 'cancelled', amount_paid = 0 WHERE id = ? AND business_id = ?", [s.id, bid]);
    await audit(conn, { businessId: bid, userId: uid, action: "sale.cancelled", entity: "sale", entityId: s.id, meta: { reason, refunded: num(s.amount_paid) }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
