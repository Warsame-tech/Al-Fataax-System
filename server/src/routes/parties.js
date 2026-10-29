import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, text, optText, id, money, withTx, ensureOwned, badRequest, num, round2, METHODS, today } from "../lib/http.js";
import { moneyMove } from "../lib/ledger.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readParty(body) {
  const d = { name: text(body.name, 150), phone: optText(body.phone, 30), email: optText(body.email, 190), address: optText(body.address, 255), notes: optText(body.notes, 255) };
  const e = {};
  if (!d.name) e.name = "required";
  if (d.email && !EMAIL.test(d.email)) e.email = "invalidEmail";
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}

/* ---------- open balances ---------- */
const SUPPLIER_OPEN = `
  SELECT 'purchase' kind, p.id, p.purchase_no ref, DATE(p.purchased_at) d, p.total, p.amount_paid
    FROM purchases p WHERE p.business_id = ? AND p.supplier_id = ? AND p.status IN ('received', 'partial') AND p.total > p.amount_paid
  ORDER BY d, id`;

/** Applies a payment to the oldest open documents first (or one specific document). */
export async function receiveCustomerPayment(conn, { businessId, userId, customerId, amount, method, bankAccountId, reference, invoiceId = null, saleId = null, at = null }) {
  let docs;
  if (invoiceId) {
    const [r] = await conn.query("SELECT 'invoice' kind, id, invoice_no ref, total, amount_paid FROM invoices WHERE id = ? AND business_id = ? AND status IN ('unpaid','partially_paid') FOR UPDATE", [invoiceId, businessId]);
    docs = r;
  } else if (saleId) {
    const [r] = await conn.query("SELECT 'sale' kind, id, receipt_no ref, total, amount_paid FROM sales WHERE id = ? AND business_id = ? AND status = 'completed' FOR UPDATE", [saleId, businessId]);
    docs = r;
  } else {
    // Lock each table separately (row locks cannot be taken on a UNION), then order oldest first.
    const [inv] = await conn.query(
      `SELECT 'invoice' kind, id, invoice_no ref, issue_date d, total, amount_paid FROM invoices
        WHERE business_id = ? AND customer_id = ? AND status IN ('unpaid','partially_paid') AND total > amount_paid FOR UPDATE`, [businessId, customerId]);
    const [sal] = await conn.query(
      `SELECT 'sale' kind, id, receipt_no ref, DATE(sold_at) d, total, amount_paid FROM sales
        WHERE business_id = ? AND customer_id = ? AND status = 'completed' AND total > amount_paid FOR UPDATE`, [businessId, customerId]);
    docs = [...inv, ...sal].sort((a, b) => String(a.d).localeCompare(String(b.d)) || a.id - b.id);
  }
  const open = round2(docs.reduce((s, d) => s + num(d.total) - num(d.amount_paid), 0));
  if (amount > open + 0.001) throw badRequest({ amount: "exceedsBalance" }, "validation");

  let left = amount;
  for (const d of docs) {
    if (left <= 0) break;
    const pay = round2(Math.min(left, num(d.total) - num(d.amount_paid)));
    if (pay <= 0) continue;
    const [p] = await conn.query(
      `INSERT INTO customer_payments (business_id, customer_id, invoice_id, sale_id, amount, method, reference, paid_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), ?)`,
      [businessId, customerId, d.kind === "invoice" ? d.id : null, d.kind === "sale" ? d.id : null, pay, method, reference, at, userId]
    );
    await moneyMove(conn, { businessId, userId, direction: "in", method, bankAccountId, amount: pay, refType: "customer_payment", refId: p.insertId, description: d.ref, at });
    const paid = round2(num(d.amount_paid) + pay);
    if (d.kind === "invoice") {
      await conn.query("UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ? AND business_id = ?",
        [paid, paid >= num(d.total) ? "paid" : "partially_paid", d.id, businessId]);
    } else {
      await conn.query("UPDATE sales SET amount_paid = ? WHERE id = ? AND business_id = ?", [paid, d.id, businessId]);
    }
    left = round2(left - pay);
  }
}

export async function paySupplier(conn, { businessId, userId, supplierId, amount, method, bankAccountId, reference, purchaseId = null, at = null }) {
  const [docs] = purchaseId
    ? await conn.query("SELECT 'purchase' kind, id, purchase_no ref, total, amount_paid FROM purchases WHERE id = ? AND business_id = ? AND status IN ('received', 'partial') FOR UPDATE", [purchaseId, businessId])
    : await conn.query(SUPPLIER_OPEN + " FOR UPDATE", [businessId, supplierId]);
  const open = round2(docs.reduce((s, d) => s + num(d.total) - num(d.amount_paid), 0));
  if (amount > open + 0.001) throw badRequest({ amount: "exceedsBalance" });
  let left = amount;
  for (const d of docs) {
    if (left <= 0) break;
    const pay = round2(Math.min(left, num(d.total) - num(d.amount_paid)));
    if (pay <= 0) continue;
    const [p] = await conn.query(
      `INSERT INTO supplier_payments (business_id, supplier_id, purchase_id, amount, method, reference, paid_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), ?)`,
      [businessId, supplierId, d.id, pay, method, reference, at, userId]
    );
    await moneyMove(conn, { businessId, userId, direction: "out", method, bankAccountId, amount: pay, refType: "supplier_payment", refId: p.insertId, description: d.ref, at });
    await conn.query("UPDATE purchases SET amount_paid = ? WHERE id = ? AND business_id = ?", [round2(num(d.amount_paid) + pay), d.id, businessId]);
    left = round2(left - pay);
  }
}

function readPayment(body) {
  const d = { amount: money(body.amount, { allowZero: false }), method: body.method, bankAccountId: id(body.bankAccountId), reference: optText(body.reference, 80) };
  const e = {};
  if (Number.isNaN(d.amount)) e.amount = "invalidAmount";
  if (!METHODS.includes(d.method)) e.method = "required";
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}
export { readPayment };

/* ---------- router factory (customers & suppliers share the same shape) ---------- */
function partyRouter(kind) {
  const isCustomer = kind === "customers";
  const table = kind;
  const perm = isCustomer ? "customers" : "suppliers";
  const router = Router();
  router.use(requireAuth);

  const balanceSql = isCustomer
    ? `(SELECT COALESCE(SUM(i.total - i.amount_paid),0) FROM invoices i WHERE i.business_id = x.business_id AND i.customer_id = x.id AND i.status IN ('unpaid','partially_paid'))
       + (SELECT COALESCE(SUM(s.total - s.amount_paid),0) FROM sales s WHERE s.business_id = x.business_id AND s.customer_id = x.id AND s.status = 'completed')`
    : `(SELECT COALESCE(SUM(p.total - p.amount_paid),0) FROM purchases p WHERE p.business_id = x.business_id AND p.supplier_id = x.id AND p.status IN ('received', 'partial'))`;
  const overdueSql = isCustomer
    ? `(SELECT COUNT(*) FROM invoices i WHERE i.business_id = x.business_id AND i.customer_id = x.id AND i.status IN ('unpaid','partially_paid') AND i.due_date < UTC_DATE())`
    : "0";

  router.get("/", requirePerm(`${perm}.view`), ah(async (req, res) => {
    const q = text(req.query.q, 80);
    const [rows] = await pool.query(
      `SELECT x.*, ${balanceSql} AS balance, ${overdueSql} AS overdue FROM ${table} x
        WHERE x.business_id = ? ${q ? "AND (x.name LIKE ? OR x.phone LIKE ?)" : ""} ORDER BY x.name LIMIT 500`,
      q ? [req.business.id, `%${q}%`, `%${q}%`] : [req.business.id]
    );
    res.json({ [kind]: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address, notes: r.notes ?? null, balance: num(r.balance), overdue: num(r.overdue) })) });
  }));

  router.post("/", requirePerm(`${perm}.edit`), ah(async (req, res) => {
    const d = readParty(req.body || {});
    const cols = isCustomer ? "(business_id, name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)" : "(business_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)";
    const vals = isCustomer ? [req.business.id, d.name, d.phone, d.email, d.address, d.notes] : [req.business.id, d.name, d.phone, d.email, d.address];
    const [r] = await pool.query(`INSERT INTO ${table} ${cols}`, vals);
    await audit(null, { businessId: req.business.id, userId: req.user.id, action: `${kind.slice(0, -1)}.created`, entity: kind.slice(0, -1), entityId: r.insertId, ip: req.ip });
    res.status(201).json({ id: r.insertId });
  }));

  router.put("/:id", requirePerm(`${perm}.edit`), ah(async (req, res) => {
    const d = readParty(req.body || {});
    const row = await ensureOwned(pool, table, id(req.params.id), req.business.id);
    const set = isCustomer ? "name = ?, phone = ?, email = ?, address = ?, notes = ?" : "name = ?, phone = ?, email = ?, address = ?";
    const vals = isCustomer ? [d.name, d.phone, d.email, d.address, d.notes] : [d.name, d.phone, d.email, d.address];
    await pool.query(`UPDATE ${table} SET ${set} WHERE id = ? AND business_id = ?`, [...vals, row.id, req.business.id]);
    res.json({ code: "saved" });
  }));

  /* GET /:id/statement — documents, payments and running balance */
  router.get("/:id/statement", requirePerm(`${perm}.view`), ah(async (req, res) => {
    const bid = req.business.id;
    const party = await ensureOwned(pool, table, id(req.params.id), bid);
    const [rows] = isCustomer
      ? await pool.query(
        `SELECT * FROM (
           SELECT 'invoice' kind, invoice_no ref, CAST(issue_date AS DATETIME) at, total debit, 0 credit, status, id, due_date FROM invoices WHERE business_id = ? AND customer_id = ? AND status NOT IN ('draft','cancelled')
           UNION ALL SELECT 'sale', receipt_no, sold_at, total, 0, status, id, NULL FROM sales WHERE business_id = ? AND customer_id = ? AND status = 'completed'
           UNION ALL SELECT 'payment', COALESCE(reference, ''), paid_at, 0, amount, method, id, NULL FROM customer_payments WHERE business_id = ? AND customer_id = ?
         ) t ORDER BY at, kind DESC, id`, [bid, party.id, bid, party.id, bid, party.id])
      : await pool.query(
        `SELECT * FROM (
           SELECT 'purchase' kind, purchase_no ref, purchased_at at, total debit, 0 credit, status, id, NULL due_date FROM purchases WHERE business_id = ? AND supplier_id = ? AND status IN ('received', 'partial')
           UNION ALL SELECT 'payment', COALESCE(reference, ''), paid_at, 0, amount, method, id, NULL FROM supplier_payments WHERE business_id = ? AND supplier_id = ?
         ) t ORDER BY at, kind DESC, id`, [bid, party.id, bid, party.id]);
    let bal = 0;
    const lines = rows.map((r) => {
      bal = round2(bal + num(r.debit) - num(r.credit));
      return { kind: r.kind, ref: r.ref, at: r.at, debit: num(r.debit), credit: num(r.credit), status: r.status, id: r.id, dueDate: r.due_date, balance: bal };
    });
    res.json({ party: { id: party.id, name: party.name, phone: party.phone, email: party.email, address: party.address }, lines, balance: bal });
  }));

  /* POST /:id/payments — customer pays us / we pay supplier (oldest first) */
  router.post("/:id/payments", requirePerm(isCustomer ? "payments.receive" : "purchases.pay"), ah(async (req, res) => {
    const p = readPayment(req.body || {});
    const bid = req.business.id;
    await withTx(async (conn) => {
      const party = await ensureOwned(conn, table, id(req.params.id), bid, true);
      if (isCustomer) await receiveCustomerPayment(conn, { businessId: bid, userId: req.user.id, customerId: party.id, ...p });
      else await paySupplier(conn, { businessId: bid, userId: req.user.id, supplierId: party.id, ...p });
      await audit(conn, { businessId: bid, userId: req.user.id, action: isCustomer ? "payment.received" : "supplier.paid", entity: kind.slice(0, -1), entityId: party.id, meta: { amount: p.amount, method: p.method }, ip: req.ip });
    });
    res.status(201).json({ code: "saved", date: today() });
  }));

  return router;
}

export const customersRouter = partyRouter("customers");
export const suppliersRouter = partyRouter("suppliers");
