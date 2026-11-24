import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, text, optText, id, money, withTx, ensureOwned, badRequest, num, round2, METHODS, today } from "../lib/http.js";
import { moneyMove } from "../lib/ledger.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readParty(body) {
  const d = { name: text(body.name, 150), phone: optText(body.phone, 30), email: optText(body.email, 190), address: optText(body.address, 255), notes: optText(body.notes, 255),
    // customers: retail or wholesale prices on their sales and invoices (lib/pricing.js)
    priceTier: body.priceTier === "wholesale" ? "wholesale" : "retail" };
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

/**
 * A customer's or supplier's statement: every document and payment with the running balance; with a period, what came
 * before it is the opening balance. Used by GET /:id/statement and the PDF reports (routes/pdfReports.js).
 */
export async function partyStatement(pool, bid, isCustomer, party, range = {}) {
  const [rows] = isCustomer
    ? await pool.query(
      `SELECT * FROM (
         SELECT 'invoice' kind, invoice_no ref, CAST(issue_date AS DATETIME) at, total debit, 0 credit, status, id, due_date, NULL amount, 'invoice' doc_kind, id doc_id
           FROM invoices WHERE business_id = ? AND customer_id = ? AND status NOT IN ('draft','cancelled')
         UNION ALL SELECT 'sale', receipt_no, sold_at, total, 0, status, id, NULL, NULL, 'sale', id FROM sales WHERE business_id = ? AND customer_id = ? AND status = 'completed'
         UNION ALL SELECT IF(cp.amount < 0, 'refund', 'payment'),
                COALESCE(NULLIF(cp.reference, 'REFUND'), (SELECT s.receipt_no FROM sales s WHERE s.id = cp.sale_id), (SELECT i.invoice_no FROM invoices i WHERE i.id = cp.invoice_id), ''),
                cp.paid_at, IF(cp.amount < 0, -cp.amount, 0), IF(cp.amount < 0, 0, cp.amount), cp.method, cp.id, NULL, NULL,
                IF(cp.sale_id IS NOT NULL, 'sale', IF(cp.invoice_id IS NOT NULL, 'invoice', NULL)), COALESCE(cp.sale_id, cp.invoice_id)
           FROM customer_payments cp WHERE cp.business_id = ? AND cp.customer_id = ?
         UNION ALL SELECT 'cancelled', receipt_no, sold_at, 0, 0, status, id, NULL, total, 'sale', id FROM sales WHERE business_id = ? AND customer_id = ? AND status = 'cancelled'
         UNION ALL SELECT 'return', s.receipt_no, r.returned_at, 0, 0, 'returned', r.id, NULL, r.total, 'sale', s.id FROM returns r JOIN sales s ON s.id = r.sale_id
                    WHERE r.business_id = ? AND r.type = 'sale' AND s.customer_id = ? AND s.status <> 'cancelled'
       ) t ORDER BY at, FIELD(kind, 'invoice', 'sale', 'cancelled', 'return', 'payment', 'refund'), id`, [bid, party.id, bid, party.id, bid, party.id, bid, party.id, bid, party.id])
    : await pool.query(
      `SELECT * FROM (
         SELECT 'purchase' kind, purchase_no ref, purchased_at at, total debit, 0 credit, status, id, NULL due_date FROM purchases WHERE business_id = ? AND supplier_id = ? AND status IN ('received', 'partial')
         UNION ALL SELECT 'payment', COALESCE(reference, ''), paid_at, 0, amount, method, id, NULL FROM supplier_payments WHERE business_id = ? AND supplier_id = ?
       ) t ORDER BY at, kind DESC, id`, [bid, party.id, bid, party.id]);
  let bal = 0;
  const all = rows.map((r) => {
    bal = round2(bal + num(r.debit) - num(r.credit));
    return { kind: r.kind, ref: r.ref, at: r.at, debit: num(r.debit), credit: num(r.credit), status: r.status, id: r.id, dueDate: r.due_date, balance: bal,
      ...(r.amount !== undefined && r.amount !== null ? { amount: num(r.amount) } : {}), ...(r.doc_kind ? { docKind: r.doc_kind, docId: r.doc_id } : {}) };
  });
  // a period: what came before it is the opening balance
  const day = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(range.from || "") ? range.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(range.to || "") ? range.to : null;
  const before = from ? all.filter((l) => day(l.at) < from) : [];
  const opening = before.length ? before[before.length - 1].balance : 0;
  const lines = all.filter((l) => (!from || day(l.at) >= from) && (!to || day(l.at) <= to));
  const sum = (k) => round2(lines.reduce((s, l) => s + l[k], 0));
  return { party: { id: party.id, name: party.name, phone: party.phone, email: party.email, address: party.address }, lines, balance: bal,
    period: { from, to, opening, debit: sum("debit"), credit: sum("credit"), closing: lines.length ? lines[lines.length - 1].balance : opening } };
}

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
    res.json({ [kind]: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address, notes: r.notes ?? null,
      ...(isCustomer ? { priceTier: r.price_tier || "retail" } : {}), balance: num(r.balance), overdue: num(r.overdue) })) });
  }));

  router.post("/", requirePerm(`${perm}.edit`), ah(async (req, res) => {
    const d = readParty(req.body || {});
    // wholesale prices for a customer is a price decision (prices.edit), not just customer details
    if (isCustomer && d.priceTier !== "retail" && !can(req.user, "prices.edit")) throw badRequest({ priceTier: "priceLocked" });
    const cols = isCustomer ? "(business_id, name, phone, email, address, notes, price_tier) VALUES (?, ?, ?, ?, ?, ?, ?)" : "(business_id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)";
    const vals = isCustomer ? [req.business.id, d.name, d.phone, d.email, d.address, d.notes, d.priceTier] : [req.business.id, d.name, d.phone, d.email, d.address];
    const [r] = await pool.query(`INSERT INTO ${table} ${cols}`, vals);
    await audit(null, { businessId: req.business.id, userId: req.user.id, action: `${kind.slice(0, -1)}.created`, entity: kind.slice(0, -1), entityId: r.insertId,
      meta: isCustomer ? { priceTier: d.priceTier } : null, ip: req.ip });
    res.status(201).json({ id: r.insertId });
  }));

  router.put("/:id", requirePerm(`${perm}.edit`), ah(async (req, res) => {
    const d = readParty(req.body || {});
    const row = await ensureOwned(pool, table, id(req.params.id), req.business.id);
    if (isCustomer && req.body?.priceTier === undefined) d.priceTier = row.price_tier || "retail";   // not sent: kept
    if (isCustomer && (row.price_tier || "retail") !== d.priceTier && !can(req.user, "prices.edit")) throw badRequest({ priceTier: "priceLocked" });
    const set = isCustomer ? "name = ?, phone = ?, email = ?, address = ?, notes = ?, price_tier = ?" : "name = ?, phone = ?, email = ?, address = ?";
    const vals = isCustomer ? [d.name, d.phone, d.email, d.address, d.notes, d.priceTier] : [d.name, d.phone, d.email, d.address];
    await pool.query(`UPDATE ${table} SET ${set} WHERE id = ? AND business_id = ?`, [...vals, row.id, req.business.id]);
    // a customer moved to another price list changes what they pay: kept in the activity log
    if (isCustomer && (row.price_tier || "retail") !== d.priceTier) {
      await audit(null, { businessId: req.business.id, userId: req.user.id, action: "customer.priceTier", entity: "customer", entityId: row.id, meta: { from: row.price_tier || "retail", to: d.priceTier }, ip: req.ip });
    }
    res.json({ code: "saved" });
  }));

  /*
   * GET /api/customers/:id/history?from&to&q&branchId&type&status — the customer's transactions (POS sales and invoices),
   * each with its branch, retail / wholesale type, total, paid, balance, payment status, payments and returns / refunds,
   * linked to the original document. summary: totals over all their transactions (not the filters).
   * Staff tied to one branch see only that branch's transactions.
   */
  if (isCustomer) router.get("/:id/history", requirePerm("customers.view"), ah(async (req, res) => {
    const bid = req.business.id;
    const c = await ensureOwned(pool, "customers", id(req.params.id), bid);
    const forced = req.branch?.fixed ? req.branch.filterId : null;
    const [docs] = await pool.query(
      `SELECT 'sale' kind, s.id, s.receipt_no ref, s.sold_at at, NULL due_date, s.total, s.amount_paid, s.status, s.price_list, s.branch_id, b.name branch
         FROM sales s LEFT JOIN branches b ON b.id = s.branch_id WHERE s.business_id = ? AND s.customer_id = ?${forced ? " AND s.branch_id = ?" : ""}
       UNION ALL
       SELECT 'invoice', i.id, i.invoice_no, CAST(i.issue_date AS DATETIME), i.due_date, i.total, i.amount_paid,
              CASE WHEN i.status IN ('unpaid','partially_paid') AND i.due_date IS NOT NULL AND i.due_date < UTC_DATE() THEN 'overdue' ELSE i.status END,
              i.price_list, i.branch_id, b.name
         FROM invoices i LEFT JOIN branches b ON b.id = i.branch_id WHERE i.business_id = ? AND i.customer_id = ? AND i.status <> 'draft'${forced ? " AND i.branch_id = ?" : ""}
       ORDER BY at DESC, id DESC LIMIT 3000`, forced ? [bid, c.id, forced, bid, c.id, forced] : [bid, c.id, bid, c.id]);
    const saleIds = docs.filter((d) => d.kind === "sale").map((d) => d.id);
    const invIds = docs.filter((d) => d.kind === "invoice").map((d) => d.id);
    const [pays] = saleIds.length || invIds.length ? await pool.query(
      `SELECT cp.id, cp.sale_id, cp.invoice_id, cp.amount, cp.method, cp.reference, cp.paid_at, pm.name pm_name, u.full_name user_name
         FROM customer_payments cp LEFT JOIN payment_methods pm ON pm.id = cp.payment_method_id AND pm.business_id = cp.business_id LEFT JOIN users u ON u.id = cp.user_id
        WHERE cp.business_id = ? AND (cp.sale_id IN (?) OR cp.invoice_id IN (?)) ORDER BY cp.paid_at, cp.id`, [bid, saleIds.concat(0), invIds.concat(0)]) : [[]];
    const [rets] = saleIds.length ? await pool.query(
      "SELECT r.id, r.sale_id, r.total, r.refund_amount, r.reason, r.returned_at, u.full_name user_name FROM returns r LEFT JOIN users u ON u.id = r.user_id WHERE r.business_id = ? AND r.type = 'sale' AND r.sale_id IN (?) ORDER BY r.returned_at",
      [bid, saleIds]) : [[]];
    const list = docs.map((d) => {
      const mine = (x) => (d.kind === "sale" ? x.sale_id === d.id : x.invoice_id === d.id);
      const cancelled = d.status === "cancelled";
      const total = num(d.total);
      const paid = num(d.amount_paid);
      const balance = cancelled ? 0 : Math.max(0, round2(total - paid));
      // payment status: invoices keep theirs (overdue included); a POS sale's comes from what was paid
      const status = cancelled ? "cancelled" : d.kind === "invoice" ? d.status : balance <= 0 ? "paid" : paid > 0 ? "partially_paid" : "unpaid";
      const returns = rets.filter(mine).map((r) => ({ id: r.id, at: r.returned_at, amount: num(r.total), refund: num(r.refund_amount), reason: r.reason || "", user: r.user_name }));
      return {
        kind: d.kind, id: d.id, number: d.ref, at: d.at, dueDate: d.due_date, type: d.price_list === "wholesale" ? "wholesale" : "retail", branchId: d.branch_id, branch: d.branch || null,
        total, paid, balance, status, cancelled,
        payments: pays.filter(mine).map((p) => ({ id: p.id, at: p.paid_at, amount: num(p.amount), method: p.method, label: p.pm_name || null, reference: p.reference || "", refund: num(p.amount) < 0, user: p.user_name })),
        returns, returned: round2(returns.reduce((s, r) => s + r.amount, 0)), refunded: round2(returns.reduce((s, r) => s + r.refund, 0))
      };
    });
    const live = list.filter((x) => !x.cancelled);
    const summary = {
      totalPurchases: round2(live.reduce((s, x) => s + x.total, 0)), totalPaid: round2(live.reduce((s, x) => s + x.paid, 0)),
      outstanding: round2(live.reduce((s, x) => s + x.balance, 0)), transactions: live.length,
      lastPurchase: live.length ? live.reduce((a, x) => (String(x.at) > String(a) ? x.at : a), live[0].at) : null,
      returned: round2(list.reduce((s, x) => s + x.returned, 0)), refunded: round2(list.reduce((s, x) => s + x.refunded, 0)),
      retail: live.filter((x) => x.type === "retail").length, wholesale: live.filter((x) => x.type === "wholesale").length
    };
    // filters (after the summary, which covers everything)
    const q = text(req.query.q, 60).toLowerCase();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : null;
    const day = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
    const branchId = id(req.query.branchId);
    const shown = list.filter((x) => (!from || day(x.at) >= from) && (!to || day(x.at) <= to) && (!q || x.number.toLowerCase().includes(q))
      && (!branchId || x.branchId === branchId) && (!["retail", "wholesale"].includes(req.query.type) || x.type === req.query.type)
      && (!req.query.status || x.status === req.query.status || (req.query.status === "returned" && x.returns.length > 0)));
    res.json({ customer: { id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, priceTier: c.price_tier || "retail" }, summary, transactions: shown });
  }));

  /*
   * GET /:id/statement?from&to — documents, payments and running balance. Customers: refunds (money given back), returns
   * and cancelled sales are shown too (returns / cancellations don't move the balance: the sale's total already changed);
   * with from, the lines before it make the opening balance.
   */
  router.get("/:id/statement", requirePerm(`${perm}.view`), ah(async (req, res) => {
    const party = await ensureOwned(pool, table, id(req.params.id), req.business.id);
    res.json(await partyStatement(pool, req.business.id, isCustomer, party, { from: req.query.from, to: req.query.to }));
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
