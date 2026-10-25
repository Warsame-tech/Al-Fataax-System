import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, money, withTx, ensureOwned, badRequest, conflict, num, round2, METHODS, text, optText, isDate, today, range } from "../lib/http.js";
import { nextNumber, lockProducts, moveStock } from "../lib/ledger.js";
import { priceLines } from "./sales.js";
import { receiveCustomerPayment, readPayment } from "./parties.js";

const router = Router();
router.use(requireAuth);

/** Overdue is derived: unpaid / partially paid with a due date in the past. */
const STATUS_SQL = `CASE WHEN i.status IN ('unpaid','partially_paid') AND i.due_date IS NOT NULL AND i.due_date < UTC_DATE() THEN 'overdue' ELSE i.status END`;

/*
 * Discount (optional): an amount ("5", "5.50") or a percentage of the subtotal ("10%").
 * Returns { amount } or { error } — empty means no discount.
 */
export function readDiscount(value, subtotal) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return { amount: 0 };
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(raw);
  if (pct) {
    const p = Number(pct[1]);
    if (!(p >= 0 && p <= 100)) return { error: "invalidAmount" };
    return { amount: round2((subtotal * p) / 100), percent: p };
  }
  const amount = money(raw);
  return Number.isNaN(amount) ? { error: "invalidDiscount" } : { amount };
}

/*
 * Creates a wholesale invoice in one transaction.
 * body: { customerId, billPhone?, billAddress?, items:[{productId, qty, unitPrice?}], priceList: retail|wholesale,
 *         discount? ("5" or "10%"), discountLabel?, issueDate?, dueDate?, notes?, amountPaid?, method?, bankAccountId? }
 */
export async function createInvoice(conn, ctx, body) {
  const { businessId, userId, role } = ctx;
  const customerId = id(body.customerId);
  if (!customerId) throw badRequest({ customerId: "required" });
  await ensureOwned(conn, "customers", customerId, businessId);
  const items = Array.isArray(body.items) ? body.items.slice(0, 200).map((x) => ({ productId: id(x?.productId), qty: x?.qty, unitPrice: x?.unitPrice })) : [];
  if (!items.length) throw badRequest({ items: "required" });

  const issueDate = isDate(body.issueDate) ? body.issueDate : today();
  const dueDate = isDate(body.dueDate) ? body.dueDate : null;
  if (dueDate && dueDate < issueDate) throw badRequest({ dueDate: "beforeIssue" });

  const products = await lockProducts(conn, businessId, items.map((i) => i.productId).filter(Boolean));
  const lines = priceLines(items, products, { allowCustomPrice: can(role, "sales.discount"), priceList: body.priceList === "wholesale" ? "wholesale" : "retail" });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const disc = readDiscount(body.discount, subtotal);
  if (disc.error) throw badRequest({ discount: disc.error });
  const discount = disc.amount;
  if (discount > 0 && !can(role, "sales.discount")) throw badRequest({ discount: "forbidden" });
  if (discount > subtotal) throw badRequest({ discount: "tooLarge" });
  const total = round2(subtotal - discount);
  const discountLabel = discount > 0 ? optText(body.discountLabel, 80) || (disc.percent !== undefined ? `${disc.percent}%` : null) : null;

  const amountPaid = body.amountPaid ? money(body.amountPaid) : 0;
  if (Number.isNaN(amountPaid) || amountPaid > total) throw badRequest({ amountPaid: "invalidAmount" });
  if (amountPaid > 0 && !METHODS.includes(body.method)) throw badRequest({ method: "required" });

  const number = await nextNumber(conn, businessId, "invoice");
  const [r] = await conn.query(
    `INSERT INTO invoices (business_id, invoice_no, customer_id, bill_phone, bill_address, user_id, issue_date, due_date, subtotal, discount, discount_label, total, amount_paid, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unpaid', ?)`,
    [businessId, number, customerId, optText(body.billPhone, 30), optText(body.billAddress, 255), userId, issueDate, dueDate, subtotal, discount, discountLabel, total, optText(body.notes, 255)]
  );
  for (const l of lines) {
    await conn.query(
      `INSERT INTO invoice_items (business_id, invoice_id, product_id, qty, unit_price, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [businessId, r.insertId, l.product.id, l.qty, l.unitPrice, l.unitCost, l.lineTotal]
    );
    await moveStock(conn, { businessId, userId, product: l.product, qtyChange: -l.qty, type: "invoice", refType: "invoice", refId: r.insertId });
  }
  if (amountPaid > 0) {
    await receiveCustomerPayment(conn, { businessId, userId, customerId, amount: amountPaid, method: body.method, bankAccountId: id(body.bankAccountId), reference: number, invoiceId: r.insertId, at: ctx.at || null });
  }
  await audit(conn, { businessId, userId, action: "invoice.created", entity: "invoice", entityId: r.insertId, meta: { total, amountPaid } });
  return { id: r.insertId, number, total };
}

router.post("/", requirePerm("invoices.create"), ah(async (req, res) => {
  const result = await withTx((conn) => createInvoice(conn, { businessId: req.business.id, userId: req.user.id, role: req.user }, req.body || {}));
  res.status(201).json(result);
}));

/* GET /api/invoices?status=&q=&from=&to= */
router.get("/", requirePerm("invoices.view"), ah(async (req, res) => {
  const r = range(req.query, 365);
  const where = ["i.business_id = ?", "i.issue_date BETWEEN ? AND ?"];
  const params = [req.business.id, r.from, r.to];
  const q = text(req.query.q, 60);
  if (q) { where.push("(i.invoice_no LIKE ? OR c.name LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const status = req.query.status;
  if (["unpaid", "partially_paid", "paid", "cancelled", "overdue"].includes(status)) { where.push(`${STATUS_SQL} = ?`); params.push(status); }
  if (id(req.query.customerId)) { where.push("i.customer_id = ?"); params.push(id(req.query.customerId)); }
  const [rows] = await pool.query(
    `SELECT i.id, i.invoice_no, i.issue_date, i.due_date, i.total, i.amount_paid, ${STATUS_SQL} status, c.name customer
       FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      WHERE ${where.join(" AND ")} ORDER BY i.issue_date DESC, i.id DESC LIMIT 500`, params);
  res.json({ range: r, invoices: rows.map((i) => ({ id: i.id, number: i.invoice_no, issueDate: i.issue_date, dueDate: i.due_date, total: num(i.total), paid: num(i.amount_paid), balance: round2(num(i.total) - num(i.amount_paid)), status: i.status, customer: i.customer })) });
}));

/* GET /api/invoices/:id — printable invoice */
router.get("/:id", requirePerm("invoices.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const invId = id(req.params.id);
  if (!invId) return res.status(404).json({ code: "notFound" });
  const [[inv]] = await pool.query(
    `SELECT i.*, ${STATUS_SQL} computed_status, c.name customer_name, c.phone customer_phone, c.email customer_email, c.address customer_address
       FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      WHERE i.id = ? AND i.business_id = ?`, [invId, bid]);
  if (!inv) return res.status(404).json({ code: "notFound" });
  const [items] = await pool.query(
    `SELECT ii.qty, ii.unit_price, ii.discount, ii.line_total, COALESCE(ii.description, CONCAT_WS(' ', p.name, NULLIF(p.size, ''))) name, p.sku, p.barcode
       FROM invoice_items ii JOIN products p ON p.id = ii.product_id AND p.business_id = ii.business_id
      WHERE ii.invoice_id = ? AND ii.business_id = ? ORDER BY ii.id`, [invId, bid]);
  const [payments] = await pool.query("SELECT amount, method, paid_at, reference FROM customer_payments WHERE invoice_id = ? AND business_id = ? ORDER BY paid_at, id", [invId, bid]);
  res.json({
    business: req.business,
    invoice: {
      id: inv.id, number: inv.invoice_no, issueDate: inv.issue_date, dueDate: inv.due_date, status: inv.computed_status,
      subtotal: num(inv.subtotal), discount: num(inv.discount), discountLabel: inv.discount_label || null, total: num(inv.total), paid: num(inv.amount_paid),
      balance: round2(num(inv.total) - num(inv.amount_paid)), notes: inv.notes, customerId: inv.customer_id,
      customer: { name: inv.customer_name, phone: inv.bill_phone || inv.customer_phone, email: inv.customer_email, address: inv.bill_address || inv.customer_address }
    },
    items: items.map((i) => ({ name: i.name, sku: i.sku, barcode: i.barcode || null, qty: num(i.qty), unitPrice: num(i.unit_price), discount: num(i.discount), total: num(i.line_total) })),
    payments: payments.map((p) => ({ amount: num(p.amount), method: p.method, at: p.paid_at, reference: p.reference }))
  });
}));

/* POST /api/invoices/:id/payments { amount, method, bankAccountId?, reference? } */
router.post("/:id/payments", requirePerm("payments.receive"), ah(async (req, res) => {
  const p = readPayment(req.body || {});
  const bid = req.business.id;
  await withTx(async (conn) => {
    const inv = await ensureOwned(conn, "invoices", id(req.params.id), bid, true);
    if (!["unpaid", "partially_paid"].includes(inv.status)) throw conflict("notPayable");
    await receiveCustomerPayment(conn, { businessId: bid, userId: req.user.id, customerId: inv.customer_id, invoiceId: inv.id, ...p, reference: p.reference || inv.invoice_no });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "payment.received", entity: "invoice", entityId: inv.id, meta: { amount: p.amount, method: p.method }, ip: req.ip });
  });
  res.status(201).json({ code: "saved" });
}));

/* POST /api/invoices/:id/cancel { reason } — only invoices with no payments; restores stock */
router.post("/:id/cancel", requirePerm("invoices.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const bid = req.business.id;
  await withTx(async (conn) => {
    const inv = await ensureOwned(conn, "invoices", id(req.params.id), bid, true);
    if (inv.status === "cancelled") throw conflict("alreadyCancelled");
    if (num(inv.amount_paid) > 0) throw conflict("hasPayments");
    const [items] = await conn.query("SELECT product_id, qty FROM invoice_items WHERE invoice_id = ? AND business_id = ?", [inv.id, bid]);
    const products = await lockProducts(conn, bid, items.map((i) => i.product_id));
    for (const i of items) {
      await moveStock(conn, { businessId: bid, userId: req.user.id, product: products.get(i.product_id), qtyChange: num(i.qty), type: "return_in", refType: "invoice", refId: inv.id, note: reason });
    }
    await conn.query("UPDATE invoices SET status = 'cancelled', notes = CONCAT(COALESCE(notes,''), ?) WHERE id = ? AND business_id = ?", [` [Cancelled: ${reason}]`, inv.id, bid]);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "invoice.cancelled", entity: "invoice", entityId: inv.id, meta: { reason }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
