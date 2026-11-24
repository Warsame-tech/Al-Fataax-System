/*
 * Accounting (lib/accounting.js keeps the books). Every request first brings the books up to date (at most every 15 s).
 *   GET  /api/accounting/meta                    mode (simple | advanced), method (accrual | cash), what the user may do
 *   GET  /api/accounting/dashboard?from&to       cards (with the previous period), chart, money accounts, debts, recent entries
 *   GET  /api/accounting/receivables[?customer]  customer debts: open invoices and credit sales, aging; the books' balance beside it
 *   GET  /api/accounting/payables[?supplier]     supplier debts: open purchases, aging
 *   GET  /api/accounting/reports/:type?from&to   pnl, income, expenses, cash, transactions — and in Advanced mode trial, ledger, balance
 *   GET  /api/accounting/entries/:id             one journal entry with its lines and source
 *   GET  /api/accounting/chart · PATCH /chart/:id   chart of accounts (Advanced; renaming needs accounting.manage)
 *   GET  /api/accounting/settings · PUT          cash or accrual basis, first month of the financial year (accounting.manage)
 * Income, expenses and money accounts are recorded through the existing endpoints (/api/money, /api/accounts),
 * customer and supplier payments through /api/customers/:id/payments and /api/suppliers/:id/payments.
 */
import { Router } from "express";
import { pool, corePool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm, can } from "../lib/permissions.js";
import { ah, id, text, num, badRequest } from "../lib/http.js";
import { syncBooks, normalBalance, forgetSync } from "../lib/accounting.js";

const router = Router();
router.use(requireAuth, requirePerm("accounting.view"));

const iso = (d) => d.toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
function rangeOf(req) {
  const today = new Date();
  const from = DATE.test(req.query.from || "") ? req.query.from : iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const to = DATE.test(req.query.to || "") ? req.query.to : iso(today);
  return from <= to ? { from, to } : { from: to, to: from };
}
/* the period before: as many days, ending the day before `from` */
function previousOf({ from, to }) {
  const f = new Date(`${from}T00:00:00Z`), t = new Date(`${to}T00:00:00Z`);
  const days = Math.round((t - f) / 86400000) + 1;
  const pt = new Date(f.getTime() - 86400000), pf = new Date(pt.getTime() - (days - 1) * 86400000);
  return { from: iso(pf), to: iso(pt) };
}
const branchOf = (req) => (req.branch?.filterId ? Number(req.branch.filterId) : null);

export async function accountingMode(bid) {
  const [[r]] = await corePool.query("SELECT enabled FROM business_modules WHERE business_id = ? AND module = 'accounting_advanced'", [bid]);
  return r?.enabled ? "advanced" : "simple";
}
async function settingsOf(bid) {
  const [[s]] = await pool.query("SELECT method, fy_start_month FROM acc_settings WHERE business_id = ?", [bid]);
  return { method: s?.method === "cash" ? "cash" : "accrual", fyStartMonth: Number(s?.fy_start_month) || 1 };
}
const requireAdvanced = ah(async (req, res, next) => ((await accountingMode(req.business.id)) === "advanced" ? next() : res.status(403).json({ code: "advancedAccounting" })));

// the books are brought up to date before anything is read
router.use(ah(async (req, res, next) => { await syncBooks(pool, req.business.id); next(); }));

/* ---------- shared reads ---------- */
async function balances(bid, { from = null, to, branch = null }) {
  const params = [];
  let on = "l.account_id = a.id";
  if (from) { on += " AND l.entry_date >= ?"; params.push(from); }
  on += " AND l.entry_date <= ?"; params.push(to);
  if (branch) { on += " AND l.branch_id = ?"; params.push(branch); }
  const [rows] = await pool.query(
    `SELECT a.id, a.code, a.name, a.type, a.system_key, a.money_kind, a.is_system, a.is_active, COALESCE(SUM(l.debit), 0) d, COALESCE(SUM(l.credit), 0) c
       FROM acc_accounts a LEFT JOIN acc_lines l ON ${on} WHERE a.business_id = ? GROUP BY a.id ORDER BY a.code`, [...params, bid]);
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, key: r.system_key, money: r.money_kind, system: Boolean(r.is_system), active: Boolean(r.is_active),
    debit: r2(r.d), credit: r2(r.c), balance: r2(normalBalance(r.type, num(r.d), num(r.c))) }));
}
const sumType = (rows, ...types) => r2(rows.filter((r) => types.includes(r.type)).reduce((s, r) => s + r.balance, 0));

/* cash basis: money actually received / paid in the period (cash_transactions) */
const CASH_IN = ["sale", "invoice", "customer_payment", "other_income", "warranty", "reservation", "tailoring"];
const CASH_OUT = ["expense", "purchase", "supplier_payment", "gold_buy"];
async function cashBasis(bid, { from, to }) {
  const [rows] = await pool.query(
    `SELECT ref_type, direction, SUM(amount) a FROM cash_transactions WHERE business_id = ? AND DATE(occurred_at) BETWEEN ? AND ? GROUP BY ref_type, direction`, [bid, from, to]);
  const get = (types, dir) => r2(rows.filter((r) => types.includes(r.ref_type) && r.direction === dir).reduce((s, r) => s + num(r.a), 0));
  const refunds = get(["refund"], "out");
  const income = r2(get(CASH_IN, "in") - refunds);
  const expenses = get(CASH_OUT, "out");
  return { income, expenses, profit: r2(income - expenses), lines: rows.map((r) => ({ kind: r.ref_type, direction: r.direction, amount: r2(r.a) })) };
}

async function totals(bid, method, range, branch) {
  if (method === "cash") return cashBasis(bid, range);
  const rows = await balances(bid, { ...range, branch });
  const income = sumType(rows, "revenue");
  const expenses = sumType(rows, "expense", "cogs");
  return { income, expenses, profit: r2(income - expenses) };
}

async function openDocs(bid, kind) {
  if (kind === "customer") {
    const [rows] = await pool.query(
      `SELECT 'invoice' kind, i.id, i.invoice_no ref, i.customer_id party_id, c.name party, i.issue_date d, COALESCE(i.due_date, i.issue_date) due, i.total, i.amount_paid
         FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.business_id = ? AND i.status IN ('unpaid','partially_paid','overdue') AND i.total > i.amount_paid + 0.004
       UNION ALL
       SELECT 'sale', s.id, s.receipt_no, s.customer_id, c.name, DATE(s.sold_at), DATE(s.sold_at), s.total, s.amount_paid
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.business_id = ? AND s.status = 'completed' AND s.customer_id IS NOT NULL AND s.total > s.amount_paid + 0.004`, [bid, bid]);
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT 'purchase' kind, p.id, p.purchase_no ref, p.supplier_id party_id, s.name party, DATE(p.purchased_at) d, DATE(p.purchased_at) due, p.total, p.amount_paid
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.business_id = ? AND p.status IN ('received','partial') AND p.total > p.amount_paid + 0.004`, [bid]);
  return rows;
}
const todayIso = () => iso(new Date());
const ageOf = (due) => Math.floor((new Date(`${todayIso()}T00:00:00Z`) - new Date(`${String(due).slice(0, 10)}T00:00:00Z`)) / 86400000);
const bucketOf = (days) => (days <= 0 ? "current" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "d90plus");
function shapeDocs(rows) {
  return rows.map((r) => {
    const balance = r2(num(r.total) - num(r.amount_paid));
    const days = ageOf(r.due);
    return { kind: r.kind, id: r.id, ref: r.ref, partyId: r.party_id, party: r.party || "—", date: String(r.d).slice(0, 10), due: String(r.due).slice(0, 10),
      total: r2(r.total), paid: r2(r.amount_paid), balance, status: days > 0 && r.kind === "invoice" ? "overdue" : num(r.amount_paid) > 0 ? "partially_paid" : "unpaid", daysLate: Math.max(0, days), bucket: bucketOf(days) };
  });
}
function byParty(docs) {
  const m = new Map();
  for (const d of docs) {
    const p = m.get(d.partyId) || { id: d.partyId, name: d.party, documents: 0, total: 0, paid: 0, balance: 0, overdue: 0, oldest: d.date };
    p.documents++; p.total = r2(p.total + d.total); p.paid = r2(p.paid + d.paid); p.balance = r2(p.balance + d.balance);
    if (d.status === "overdue") p.overdue = r2(p.overdue + d.balance);
    if (d.date < p.oldest) p.oldest = d.date;
    m.set(d.partyId, p);
  }
  return [...m.values()].sort((a, b) => b.balance - a.balance);
}
const aging = (docs) => ["current", "d30", "d60", "d90", "d90plus"].map((b) => ({ bucket: b, amount: r2(docs.filter((d) => d.bucket === b).reduce((s, d) => s + d.balance, 0)) }));

/* ---------- meta ---------- */
router.get("/meta", ah(async (req, res) => {
  const s = await settingsOf(req.business.id);
  res.json({ mode: await accountingMode(req.business.id), ...s, canManage: can(req.user, "accounting.manage"), currency: req.business.currency,
    branches: req.branch?.list || [], branch: branchOf(req) });
}));

/* ---------- dashboard ---------- */
router.get("/dashboard", ah(async (req, res) => {
  const bid = req.business.id;
  const range = rangeOf(req);
  const prev = previousOf(range);
  const branch = branchOf(req);
  const { method } = await settingsOf(bid);
  const [now, before] = [await totals(bid, method, range, branch), await totals(bid, method, prev, branch)];
  // money accounts: their balance today (all money movements)
  const [money] = await pool.query(
    `SELECT a.id, a.name, a.money_kind kind, COALESCE(SUM(l.debit - l.credit), 0) bal FROM acc_accounts a LEFT JOIN acc_lines l ON l.account_id = a.id
      WHERE a.business_id = ? AND a.money_kind IS NOT NULL GROUP BY a.id ORDER BY a.money_kind, a.name`, [bid]);
  const customers = shapeDocs(await openDocs(bid, "customer"));
  const suppliers = shapeDocs(await openDocs(bid, "supplier"));
  // chart: by day (up to two months) or by month
  const days = Math.round((new Date(`${range.to}T00:00:00Z`) - new Date(`${range.from}T00:00:00Z`)) / 86400000) + 1;
  const fmt = days <= 62 ? "%Y-%m-%d" : "%Y-%m";
  const [chart] = await pool.query(
    `SELECT DATE_FORMAT(l.entry_date, ?) k, SUM(CASE WHEN a.type = 'revenue' THEN l.credit - l.debit ELSE 0 END) income,
            SUM(CASE WHEN a.type IN ('expense','cogs') THEN l.debit - l.credit ELSE 0 END) expenses
       FROM acc_lines l JOIN acc_accounts a ON a.id = l.account_id
      WHERE l.business_id = ? AND l.entry_date BETWEEN ? AND ?${branch ? " AND l.branch_id = ?" : ""} GROUP BY k ORDER BY k`,
    branch ? [fmt, bid, range.from, range.to, branch] : [fmt, bid, range.from, range.to]);
  const [recent] = await pool.query(
    `SELECT e.id, e.entry_date, e.reference, e.description, e.source_type, e.kind, (SELECT SUM(debit) FROM acc_lines WHERE entry_id = e.id) amount
       FROM acc_entries e WHERE e.business_id = ?${branch ? " AND e.branch_id = ?" : ""} ORDER BY e.entry_date DESC, e.id DESC LIMIT 12`, branch ? [bid, branch] : [bid]);
  const cashTotal = r2(money.reduce((s, m) => s + num(m.bal), 0));
  res.json({
    range, previous: prev, method,
    cards: {
      income: { now: now.income, before: before.income }, expenses: { now: now.expenses, before: before.expenses }, profit: { now: now.profit, before: before.profit },
      cash: { now: cashTotal }, customers: { now: r2(customers.reduce((s, d) => s + d.balance, 0)), overdue: r2(customers.filter((d) => d.status === "overdue").reduce((s, d) => s + d.balance, 0)) },
      suppliers: { now: r2(suppliers.reduce((s, d) => s + d.balance, 0)), overdue: r2(suppliers.filter((d) => d.daysLate > 30).reduce((s, d) => s + d.balance, 0)) }
    },
    chart: chart.map((c) => ({ key: c.k, income: r2(c.income), expenses: r2(c.expenses), profit: r2(num(c.income) - num(c.expenses)) })),
    accounts: money.map((m) => ({ id: m.id, name: m.name, kind: m.kind, balance: r2(m.bal) })),
    recent: recent.map((e) => ({ id: e.id, date: String(e.entry_date).slice(0, 10), ref: e.reference, description: e.description, type: e.source_type, kind: e.kind, amount: r2(e.amount) }))
  });
}));

/* ---------- customer / supplier debts ---------- */
for (const [path, kind, accKey] of [["/receivables", "customer", "receivable"], ["/payables", "supplier", "payable"]]) {
  router.get(path, ah(async (req, res) => {
    const bid = req.business.id;
    let docs = shapeDocs(await openDocs(bid, kind));
    const partyId = id(req.query[kind]);
    if (partyId) docs = docs.filter((d) => d.partyId === partyId);
    const [[books]] = await pool.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) b FROM acc_lines l JOIN acc_accounts a ON a.id = l.account_id WHERE l.business_id = ? AND a.system_key = ?`, [bid, accKey]);
    res.json({ total: r2(docs.reduce((s, d) => s + d.balance, 0)), overdue: r2(docs.filter((d) => d.status === "overdue").reduce((s, d) => s + d.balance, 0)),
      parties: byParty(docs), documents: docs.sort((a, b) => a.due.localeCompare(b.due)), aging: aging(docs),
      // the books' balance of Customer / Supplier debts (walk-in credit sales without a customer are in the books only)
      books: r2(kind === "customer" ? num(books.b) : -num(books.b)) });
  }));
}

/* ---------- reports ---------- */
const ADVANCED_REPORTS = new Set(["trial", "ledger", "balance"]);
router.get("/reports/:type", ah(async (req, res) => {
  const bid = req.business.id;
  const type = req.params.type;
  const range = rangeOf(req);
  const branch = branchOf(req);
  if (ADVANCED_REPORTS.has(type) && (await accountingMode(bid)) !== "advanced") return res.status(403).json({ code: "advancedAccounting" });
  const { method } = await settingsOf(bid);

  if (type === "pnl") {
    if (method === "cash") return res.json({ type, method, range, ...(await cashBasis(bid, range)) });
    const rows = (await balances(bid, { ...range, branch })).filter((r) => ["revenue", "cogs", "expense"].includes(r.type) && Math.abs(r.balance) > 0.004);
    const revenue = sumType(rows, "revenue"), cogs = sumType(rows, "cogs"), expenses = sumType(rows, "expense");
    return res.json({ type, method, range, revenue: rows.filter((r) => r.type === "revenue"), cogs: rows.filter((r) => r.type === "cogs"), expenses: rows.filter((r) => r.type === "expense"),
      totals: { revenue, cogs, gross: r2(revenue - cogs), expenses, net: r2(revenue - cogs - expenses) } });
  }
  if (type === "income" || type === "expenses") {
    const isExp = type === "expenses";
    const rows = (await balances(bid, { ...range, branch })).filter((r) => (isExp ? ["expense", "cogs"] : ["revenue"]).includes(r.type) && Math.abs(r.balance) > 0.004);
    const [items] = await pool.query(
      `SELECT id, category, amount, ${isExp ? "expense_date" : "income_date"} d, method, description FROM ${isExp ? "expenses" : "other_income"}
        WHERE business_id = ? AND ${isExp ? "expense_date" : "income_date"} BETWEEN ? AND ?${branch ? " AND branch_id = ?" : ""} ORDER BY d DESC LIMIT 500`,
      branch ? [bid, range.from, range.to, branch] : [bid, range.from, range.to]);
    return res.json({ type, range, accounts: rows, total: r2(rows.reduce((s, r) => s + r.balance, 0)),
      items: items.map((x) => ({ id: x.id, category: x.category, amount: r2(x.amount), date: String(x.d).slice(0, 10), method: x.method, description: x.description })) });
  }
  if (type === "cash") {
    const [rows] = await pool.query(
      `SELECT a.id, a.name, a.money_kind kind,
              COALESCE(SUM(CASE WHEN l.entry_date < ? THEN l.debit - l.credit ELSE 0 END), 0) opening,
              COALESCE(SUM(CASE WHEN l.entry_date BETWEEN ? AND ? THEN l.debit ELSE 0 END), 0) i,
              COALESCE(SUM(CASE WHEN l.entry_date BETWEEN ? AND ? THEN l.credit ELSE 0 END), 0) o
         FROM acc_accounts a LEFT JOIN acc_lines l ON l.account_id = a.id AND l.entry_date <= ?
        WHERE a.business_id = ? AND a.money_kind IS NOT NULL GROUP BY a.id ORDER BY a.money_kind, a.name`,
      [range.from, range.from, range.to, range.from, range.to, range.to, bid]);
    return res.json({ type, range, accounts: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, opening: r2(r.opening), in: r2(r.i), out: r2(r.o), closing: r2(num(r.opening) + num(r.i) - num(r.o)) })) });
  }
  if (type === "transactions") {
    const q = text(req.query.q, 80);
    const params = [bid, range.from, range.to];
    let where = "e.business_id = ? AND e.entry_date BETWEEN ? AND ?";
    if (branch) { where += " AND e.branch_id = ?"; params.push(branch); }
    if (q) { where += " AND (e.reference LIKE ? OR e.description LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
    const [rows] = await pool.query(
      `SELECT e.id, e.entry_date, e.reference, e.description, e.source_type, e.source_id, e.kind, e.revision, (SELECT SUM(debit) FROM acc_lines WHERE entry_id = e.id) amount
         FROM acc_entries e WHERE ${where} ORDER BY e.entry_date DESC, e.id DESC LIMIT 1000`, params);
    return res.json({ type, range, entries: rows.map((e) => ({ id: e.id, date: String(e.entry_date).slice(0, 10), ref: e.reference, description: e.description, source: e.source_type,
      kind: e.kind, revision: e.revision, amount: r2(e.amount) })) });
  }
  if (type === "trial") {
    const rows = (await balances(bid, { to: range.to, branch })).filter((r) => Math.abs(r.debit) > 0.004 || Math.abs(r.credit) > 0.004);
    const shaped = rows.map((r) => { const net = r2(r.debit - r.credit); return { ...r, debitBalance: net > 0 ? net : 0, creditBalance: net < 0 ? -net : 0 }; });
    return res.json({ type, asAt: range.to, accounts: shaped, totals: { debit: r2(shaped.reduce((s, r) => s + r.debitBalance, 0)), credit: r2(shaped.reduce((s, r) => s + r.creditBalance, 0)) } });
  }
  if (type === "balance") {
    const rows = await balances(bid, { to: range.to, branch });
    const pick = (t) => rows.filter((r) => r.type === t && Math.abs(r.balance) > 0.004);
    const profit = r2(sumType(rows, "revenue") - sumType(rows, "cogs", "expense"));
    const assets = sumType(rows, "asset"), liabilities = sumType(rows, "liability"), equity = r2(sumType(rows, "equity") + profit);
    return res.json({ type, asAt: range.to, assets: pick("asset"), liabilities: pick("liability"), equity: pick("equity"), profitToDate: profit,
      totals: { assets, liabilities, equity, liabilitiesAndEquity: r2(liabilities + equity), balanced: Math.abs(assets - liabilities - equity) < 0.01 } });
  }
  if (type === "ledger") {
    const accountId = id(req.query.account);
    const [[acc]] = await pool.query("SELECT id, code, name, type FROM acc_accounts WHERE id = ? AND business_id = ?", [accountId || 0, bid]);
    if (!acc) return res.json({ type, range, account: null, lines: [] });
    const [[op]] = await pool.query("SELECT COALESCE(SUM(debit), 0) d, COALESCE(SUM(credit), 0) c FROM acc_lines WHERE account_id = ? AND entry_date < ?", [acc.id, range.from]);
    const [lines] = await pool.query(
      `SELECT l.debit, l.credit, l.entry_date, e.id entry_id, e.reference, e.description, e.source_type FROM acc_lines l JOIN acc_entries e ON e.id = l.entry_id
        WHERE l.account_id = ? AND l.entry_date BETWEEN ? AND ? ORDER BY l.entry_date, l.id LIMIT 2000`, [acc.id, range.from, range.to]);
    let running = normalBalance(acc.type, num(op.d), num(op.c));
    return res.json({ type, range, account: { id: acc.id, code: acc.code, name: acc.name, type: acc.type }, opening: r2(running),
      lines: lines.map((l) => { running += normalBalance(acc.type, num(l.debit), num(l.credit)); return { date: String(l.entry_date).slice(0, 10), entryId: l.entry_id, ref: l.reference, description: l.description, source: l.source_type, debit: r2(l.debit), credit: r2(l.credit), balance: r2(running) }; }),
      closing: r2(running) });
  }
  throw badRequest({ type: "required" });
}));

/* ---------- one entry ---------- */
router.get("/entries/:id", ah(async (req, res) => {
  const [[e]] = await pool.query("SELECT * FROM acc_entries WHERE id = ? AND business_id = ?", [id(req.params.id) || 0, req.business.id]);
  if (!e) return res.status(404).json({ code: "notFound" });
  const [lines] = await pool.query("SELECT l.debit, l.credit, a.code, a.name FROM acc_lines l JOIN acc_accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.debit DESC, l.id", [e.id]);
  res.json({ entry: { id: e.id, date: String(e.entry_date).slice(0, 10), ref: e.reference, description: e.description, source: e.source_type, sourceId: e.source_id, kind: e.kind,
    revision: e.revision, current: Boolean(e.is_current), reverses: e.reverses_id, createdAt: e.created_at },
  lines: lines.map((l) => ({ code: l.code, account: l.name, debit: r2(l.debit), credit: r2(l.credit) })) });
}));

/* ---------- chart of accounts (Advanced) ---------- */
router.get("/chart", requireAdvanced, ah(async (req, res) => {
  const rows = await balances(req.business.id, { to: iso(new Date()) });
  res.json({ accounts: rows });
}));
router.patch("/chart/:id", requireAdvanced, requirePerm("accounting.manage"), ah(async (req, res) => {
  const [[a]] = await pool.query("SELECT * FROM acc_accounts WHERE id = ? AND business_id = ?", [id(req.params.id) || 0, req.business.id]);
  if (!a) return res.status(404).json({ code: "notFound" });
  const name = text(req.body?.name, 120);
  if (!name) throw badRequest({ name: "required" });
  // the account's code, type and the records posted to it never change; only its name
  await pool.query("UPDATE acc_accounts SET name = ? WHERE id = ?", [name, a.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "accounting.account_renamed", entity: "acc_account", entityId: a.id, meta: { from: a.name, to: name }, ip: req.ip });
  res.json({ code: "saved" });
}));

/* ---------- settings ---------- */
router.get("/settings", ah(async (req, res) => res.json(await settingsOf(req.business.id))));
router.put("/settings", requirePerm("accounting.manage"), ah(async (req, res) => {
  const method = req.body?.method === "cash" ? "cash" : req.body?.method === "accrual" ? "accrual" : null;
  const fy = Number(req.body?.fyStartMonth);
  const e = {};
  if (!method) e.method = "required";
  if (!Number.isInteger(fy) || fy < 1 || fy > 12) e.fyStartMonth = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const before = await settingsOf(req.business.id);
  await pool.query(`INSERT INTO acc_settings (business_id, method, fy_start_month, updated_by) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE method = VALUES(method), fy_start_month = VALUES(fy_start_month), updated_by = VALUES(updated_by)`, [req.business.id, method, fy, req.user.id]);
  // the books themselves don't change: the method only decides how profit is reported
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "accounting.settings", meta: { before, after: { method, fyStartMonth: fy } }, ip: req.ip });
  res.json(await settingsOf(req.business.id));
}));
router.post("/sync", requirePerm("accounting.manage"), ah(async (req, res) => {
  forgetSync(req.business.id);
  res.json(await syncBooks(pool, req.business.id, { force: true }));
}));

export default router;

/* shared with the PDF reports (routes/pdfReports.js): the same books, no second calculation */
export { balances, cashBasis, openDocs, shapeDocs, byParty, aging, settingsOf, sumType };
