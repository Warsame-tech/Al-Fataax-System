import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, money, quantity, withTx, ensureOwned, badRequest, conflict, num, round2, METHODS, text, optText, range } from "../lib/http.js";
import { nextNumber, lockProducts, moveStock, moneyMove } from "../lib/ledger.js";
import { methodForPayment } from "./paymentMethods.js";

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
 * Split payments (POS payment screen): payments = [{ paymentMethodId, amount }]
 * (a business's own methods, e.g. "E-Dahab (136227)") or [{ method: cash|mobile_money|bank, bankAccountId?, amount }].
 * - More than the total is allowed only when cash covers the change (change is given in cash).
 * - Less than the total leaves the rest on credit, which needs a customer.
 * Returns the money actually kept per payment, the change, and the sale-level method.
 */
async function readSplitPayments(conn, businessId, list, total, customerId) {
  const payments = [];
  for (const [i, x] of list.slice(0, 10).entries()) {
    const amount = money(x?.amount);
    if (Number.isNaN(amount) || amount <= 0) throw badRequest({ [`payments.${i}.amount`]: "invalidAmount" });
    if (x?.paymentMethodId !== undefined && x?.paymentMethodId !== null) {
      const pm = await methodForPayment(conn, businessId, id(x.paymentMethodId));
      if (!pm) throw badRequest({ [`payments.${i}.paymentMethodId`]: "required" });
      payments.push({ method: pm.kind, paymentMethodId: pm.id, account: pm.account, amount });
      continue;
    }
    const method = x?.method;
    if (!METHODS.includes(method)) throw badRequest({ [`payments.${i}.method`]: "required" });
    if (method === "bank" && !id(x?.bankAccountId)) throw badRequest({ [`payments.${i}.bankAccountId`]: "required" });
    payments.push({ method, bankAccountId: id(x?.bankAccountId), amount });
  }
  const sum = round2(payments.reduce((t, x) => t + x.amount, 0));
  let change = 0;
  if (sum > total) {
    change = round2(sum - total);
    const cash = round2(payments.filter((x) => x.method === "cash").reduce((t, x) => t + x.amount, 0));
    if (cash < change) throw badRequest({ payments: "changeNeedsCash" });
    // keep only what is owed: take the change out of the cash payments
    let left = change;
    for (const x of payments) {
      if (x.method !== "cash" || left <= 0) continue;
      const cut = Math.min(x.amount, left);
      x.amount = round2(x.amount - cut);
      left = round2(left - cut);
    }
  }
  const kept = payments.filter((x) => x.amount > 0);
  const paid = round2(kept.reduce((t, x) => t + x.amount, 0));
  if (paid < total && !customerId) throw badRequest({ customerId: "requiredForCredit" });
  const biggest = kept.slice().sort((a, b) => b.amount - a.amount)[0];
  const method = paid < total || !biggest ? "credit" : biggest.method;
  return { kept, paid, change, method };
}

/*
 * Creates a POS sale in one transaction: number, lines, stock out, payment(s), money in, audit.
 * body: { items:[{productId, qty, unitPrice?}], customerId?, discount?,
 *         payments?: [{method, bankAccountId?, amount}]                          (split payments, POS payment screen)
 *         or paymentMethod: cash|mobile_money|bank|credit, amountReceived?, paidMethod? (for credit), bankAccountId? }
 */
export async function createSale(conn, ctx, body) {
  const { businessId, userId, role } = ctx;
  const items = readItems(body);
  const split = Array.isArray(body.payments);
  let method = split ? null : body.paymentMethod;
  if (!split && ![...METHODS, "credit"].includes(method)) throw badRequest({ paymentMethod: "required" });
  const discount = body.discount ? money(body.discount) : 0;
  if (Number.isNaN(discount)) throw badRequest({ discount: "invalidAmount" });
  if (discount > 0 && !can(role, "sales.discount")) throw badRequest({ discount: "forbidden" });

  let customerId = id(body.customerId);
  if (customerId) await ensureOwned(conn, "customers", customerId, businessId);
  if (!split && method === "credit" && !customerId) throw badRequest({ customerId: "requiredForCredit" });

  const products = await lockProducts(conn, businessId, items.map((i) => i.productId).filter(Boolean));
  const lines = priceLines(items, products, { allowCustomPrice: can(role, "sales.discount") });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  if (discount > subtotal) throw badRequest({ discount: "tooLarge" });
  const total = round2(subtotal - discount);

  // Money actually collected now (one entry per payment method).
  let paid; let paidMethod; let change = 0;
  let collected = [];
  if (split) {
    const r = await readSplitPayments(conn, businessId, body.payments, total, customerId);
    ({ paid, change, method } = r);
    collected = r.kept;
  } else if (method === "credit") {
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
  if (!split && paid > 0) collected = [{ method: paidMethod, bankAccountId: id(body.bankAccountId), amount: paid }];

  const receiptNo = await nextNumber(conn, businessId, "receipt");
  const [s] = await conn.query(
    `INSERT INTO sales (business_id, receipt_no, customer_id, user_id, subtotal, discount, total, amount_paid, change_amount, payment_method, sold_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
    [businessId, receiptNo, customerId, userId, subtotal, discount, total, paid, change, method, ctx.at || null]
  );
  const saleId = s.insertId;
  for (const l of lines) {
    await conn.query(
      `INSERT INTO sale_items (business_id, sale_id, product_id, qty, unit_price, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [businessId, saleId, l.product.id, l.qty, l.unitPrice, l.unitCost, l.lineTotal]
    );
    await moveStock(conn, { businessId, userId, product: l.product, qtyChange: -l.qty, type: "sale", refType: "sale", refId: saleId });
  }
  for (const pay of collected) {
    const [p] = await conn.query(
      `INSERT INTO customer_payments (business_id, customer_id, sale_id, amount, method, payment_method_id, paid_at, user_id) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), ?)`,
      [businessId, customerId, saleId, pay.amount, pay.method, pay.paymentMethodId || null, ctx.at || null, userId]
    );
    await moneyMove(conn, { businessId, userId, direction: "in", method: pay.method, bankAccountId: pay.bankAccountId, account: pay.account, amount: pay.amount, refType: "customer_payment", refId: p.insertId, description: receiptNo, at: ctx.at || null });
  }
  await audit(conn, { businessId, userId, action: "sale.created", entity: "sale", entityId: saleId, meta: { total, method } });
  return { id: saleId, receiptNo, total, paid, change };
}

router.post("/", requirePerm("sales.create"), ah(async (req, res) => {
  const result = await withTx((conn) => createSale(conn, { businessId: req.business.id, userId: req.user.id, role: req.user }, req.body || {}));
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
  const [payments] = await pool.query(
    `SELECT cp.amount, cp.method, cp.paid_at, pm.name pm_name, pm.number pm_number
       FROM customer_payments cp LEFT JOIN payment_methods pm ON pm.id = cp.payment_method_id AND pm.business_id = cp.business_id
      WHERE cp.sale_id = ? AND cp.business_id = ? ORDER BY cp.id`, [s.id, bid]);
  res.json({
    business: req.business,
    sale: { id: s.id, number: s.receipt_no, at: s.sold_at, status: s.status, method: s.payment_method, subtotal: num(s.subtotal), discount: num(s.discount), total: num(s.total), paid: num(s.amount_paid), change: num(s.change_amount || 0), balance: round2(num(s.total) - num(s.amount_paid)), customer: cust, cashier: cashier?.full_name },
    items: items.map((i) => ({ name: i.name, sku: i.sku, qty: num(i.qty), unitPrice: num(i.unit_price), total: num(i.line_total) })),
    payments: payments.map((p) => ({ amount: num(p.amount), method: p.method, label: p.pm_name ? (p.pm_number ? `${p.pm_name} (${p.pm_number})` : p.pm_name) : null, at: p.paid_at }))
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
    // Refund each payment through the same method and account (negative payment keeps "money received" accurate).
    const [payments] = await conn.query("SELECT id, method, payment_method_id, amount FROM customer_payments WHERE sale_id = ? AND business_id = ? AND amount > 0 ORDER BY id", [s.id, bid]);
    for (const p of payments) {
      const amount = round2(num(p.amount));
      await conn.query("INSERT INTO customer_payments (business_id, customer_id, sale_id, amount, method, payment_method_id, reference, paid_at, user_id) VALUES (?, ?, ?, ?, ?, ?, 'REFUND', UTC_TIMESTAMP(), ?)",
        [bid, s.customer_id, s.id, -amount, p.method, p.payment_method_id, uid]);
      const [[orig]] = await conn.query("SELECT cash_account_id, bank_account_id FROM cash_transactions WHERE business_id = ? AND ref_type = 'customer_payment' AND ref_id = ? LIMIT 1", [bid, p.id]);
      await moneyMove(conn, { businessId: bid, userId: uid, direction: "out", method: p.method, account: orig || undefined, amount, refType: "refund", refId: ret.insertId, description: `${s.receipt_no} refund` });
    }
    await conn.query("UPDATE sales SET status = 'cancelled', amount_paid = 0 WHERE id = ? AND business_id = ?", [s.id, bid]);
    await audit(conn, { businessId: bid, userId: uid, action: "sale.cancelled", entity: "sale", entityId: s.id, meta: { reason, refunded: num(s.amount_paid) }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
