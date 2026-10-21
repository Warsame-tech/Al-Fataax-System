import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, id, money, withTx, ensureOwned, badRequest, conflict, num, METHODS, text, optText, isDate, today, range } from "../lib/http.js";
import { moneyMove, resolveAccount } from "../lib/ledger.js";

export const EXPENSE_CATEGORIES = ["rent", "salaries", "electricity", "internet", "transport", "repairs", "marketing", "water", "taxes", "other"];
export const INCOME_CATEGORIES = ["service", "commission", "rental", "interest", "other"];

/* ===================== Expenses & other income ===================== */
export const expensesRouter = Router();
expensesRouter.use(requireAuth);

function readEntry(body, categories) {
  const d = {
    category: body.category, amount: money(body.amount, { allowZero: false }),
    date: isDate(body.date) ? body.date : today(), method: body.method,
    bankAccountId: id(body.bankAccountId), description: optText(body.description, 255)
  };
  const e = {};
  if (!categories.includes(d.category)) e.category = "required";
  if (Number.isNaN(d.amount)) e.amount = "invalidAmount";
  if (!METHODS.includes(d.method)) e.method = "required";
  if (d.date > today()) e.date = "future";
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}

/** Records an expense (money out) or other income (money in). Never touches inventory. */
export async function recordEntry(conn, ctx, kind, body) {
  const isExpense = kind === "expense";
  const d = readEntry(body, isExpense ? EXPENSE_CATEGORIES : INCOME_CATEGORIES);
  const acc = await resolveAccount(conn, ctx.businessId, d.method, d.bankAccountId);
  const [r] = await conn.query(
    `INSERT INTO ${isExpense ? "expenses" : "other_income"} (business_id, category, amount, ${isExpense ? "expense_date" : "income_date"}, method, cash_account_id, bank_account_id, description, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ctx.businessId, d.category, d.amount, d.date, d.method, acc.cash_account_id, acc.bank_account_id, d.description, ctx.userId]
  );
  await moneyMove(conn, { businessId: ctx.businessId, userId: ctx.userId, direction: isExpense ? "out" : "in", account: acc, amount: d.amount,
    refType: isExpense ? "expense" : "other_income", refId: r.insertId, description: d.description || d.category, at: `${d.date} 12:00:00` });
  await audit(conn, { businessId: ctx.businessId, userId: ctx.userId, action: `${kind}.created`, entity: kind, entityId: r.insertId, meta: { amount: d.amount } });
  return r.insertId;
}

for (const kind of ["expense", "income"]) {
  const table = kind === "expense" ? "expenses" : "other_income";
  const dateCol = kind === "expense" ? "expense_date" : "income_date";
  const path = kind === "expense" ? "/expenses" : "/income";

  expensesRouter.get(path, requirePerm("expenses.view"), ah(async (req, res) => {
    const r = range(req.query, 30);
    const where = ["e.business_id = ?", `e.${dateCol} BETWEEN ? AND ?`];
    const params = [req.business.id, r.from, r.to];
    if (req.query.category) { where.push("e.category = ?"); params.push(text(req.query.category, 60)); }
    const q = text(req.query.q, 60);
    if (q) { where.push("e.description LIKE ?"); params.push(`%${q}%`); }
    const [rows] = await pool.query(
      `SELECT e.id, e.category, e.amount, e.${dateCol} d, e.method, e.description, u.full_name user_name
         FROM ${table} e LEFT JOIN users u ON u.id = e.user_id WHERE ${where.join(" AND ")} ORDER BY e.${dateCol} DESC, e.id DESC LIMIT 500`, params);
    const [byCat] = await pool.query(
      `SELECT category, SUM(amount) total FROM ${table} e WHERE ${where.join(" AND ")} GROUP BY category ORDER BY total DESC`, params);
    res.json({
      range: r,
      entries: rows.map((x) => ({ id: x.id, category: x.category, amount: num(x.amount), date: x.d, method: x.method, description: x.description, user: x.user_name })),
      byCategory: byCat.map((c) => ({ category: c.category, total: num(c.total) })),
      total: byCat.reduce((s, c) => s + num(c.total), 0)
    });
  }));

  expensesRouter.post(path, requirePerm("expenses.create"), ah(async (req, res) => {
    const newId = await withTx((conn) => recordEntry(conn, { businessId: req.business.id, userId: req.user.id }, kind, req.body || {}));
    res.status(201).json({ id: newId });
  }));

  /* DELETE — owner only; reverses the money movement and keeps an audit record */
  expensesRouter.delete(`${path}/:id`, requirePerm("expenses.delete"), ah(async (req, res) => {
    const bid = req.business.id;
    await withTx(async (conn) => {
      const e = await ensureOwned(conn, table, id(req.params.id), bid, true);
      await conn.query("DELETE FROM cash_transactions WHERE business_id = ? AND ref_type = ? AND ref_id = ?", [bid, kind === "expense" ? "expense" : "other_income", e.id]);
      await conn.query(`DELETE FROM ${table} WHERE id = ? AND business_id = ?`, [e.id, bid]);
      await audit(conn, { businessId: bid, userId: req.user.id, action: `${kind}.deleted`, entity: kind, entityId: e.id, meta: { amount: num(e.amount), category: e.category }, ip: req.ip });
    });
    res.json({ code: "saved" });
  }));
}

/* ===================== Cash & bank accounts ===================== */
export const accountsRouter = Router();
accountsRouter.use(requireAuth);

const BAL = `COALESCE(SUM(IF(t.direction = 'in', t.amount, -t.amount)), 0)`;

/* GET /api/accounts — every account with its balance (derived from transactions) */
accountsRouter.get("/", requirePerm("cash.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const [cash] = await pool.query(`SELECT a.id, a.name, a.is_default, ${BAL} balance FROM cash_accounts a LEFT JOIN cash_transactions t ON t.cash_account_id = a.id AND t.business_id = a.business_id WHERE a.business_id = ? GROUP BY a.id ORDER BY a.is_default DESC, a.name`, [bid]);
  const [bank] = await pool.query(`SELECT a.id, a.bank_name, a.account_name, a.account_number, ${BAL} balance FROM bank_accounts a LEFT JOIN cash_transactions t ON t.bank_account_id = a.id AND t.business_id = a.business_id WHERE a.business_id = ? GROUP BY a.id ORDER BY a.bank_name`, [bid]);
  res.json({
    cash: cash.map((a) => ({ id: a.id, name: a.name, isDefault: Boolean(a.is_default), balance: num(a.balance) })),
    bank: bank.map((a) => ({ id: a.id, bankName: a.bank_name, accountName: a.account_name, accountNumber: a.account_number, balance: num(a.balance) }))
  });
}));

/* GET /api/accounts/banks — for payment forms (anyone who can take payments) */
accountsRouter.get("/banks", ah(async (req, res) => {
  const [bank] = await pool.query("SELECT id, bank_name, account_name FROM bank_accounts WHERE business_id = ? ORDER BY bank_name", [req.business.id]);
  res.json({ banks: bank.map((b) => ({ id: b.id, name: `${b.bank_name} · ${b.account_name}` })) });
}));

accountsRouter.post("/bank", requirePerm("cash.edit"), ah(async (req, res) => {
  const d = { bankName: text(req.body?.bankName, 120), accountName: text(req.body?.accountName, 120), accountNumber: optText(req.body?.accountNumber, 60) };
  const e = {};
  if (!d.bankName) e.bankName = "required";
  if (!d.accountName) e.accountName = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const [r] = await pool.query("INSERT INTO bank_accounts (business_id, bank_name, account_name, account_number) VALUES (?, ?, ?, ?)", [req.business.id, d.bankName, d.accountName, d.accountNumber]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "bank_account.created", entity: "bank_account", entityId: r.insertId, ip: req.ip });
  res.status(201).json({ id: r.insertId });
}));

async function accountRef(conn, bid, ref) {
  // ref: "cash:ID" or "bank:ID"
  const [type, raw] = String(ref || "").split(":");
  const accId = id(raw);
  if (type === "cash") { await ensureOwned(conn, "cash_accounts", accId, bid); return { cash_account_id: accId, bank_account_id: null }; }
  if (type === "bank") { await ensureOwned(conn, "bank_accounts", accId, bid); return { cash_account_id: null, bank_account_id: accId }; }
  throw badRequest({ account: "required" });
}

/* POST /api/accounts/entry { account: "cash:1", direction: in|out, amount, description } — opening balances, owner deposits, withdrawals */
accountsRouter.post("/entry", requirePerm("cash.edit"), ah(async (req, res) => {
  const amount = money(req.body?.amount, { allowZero: false });
  const direction = req.body?.direction;
  const description = text(req.body?.description, 200);
  const e = {};
  if (Number.isNaN(amount)) e.amount = "invalidAmount";
  if (!["in", "out"].includes(direction)) e.direction = "required";
  if (!description) e.description = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const bid = req.business.id;
  await withTx(async (conn) => {
    const acc = await accountRef(conn, bid, req.body?.account);
    await moneyMove(conn, { businessId: bid, userId: req.user.id, direction, account: acc, amount, refType: "adjustment", description });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "cash.adjusted", meta: { amount, direction, description }, ip: req.ip });
  });
  res.status(201).json({ code: "saved" });
}));

/* POST /api/accounts/transfer { from: "cash:1", to: "bank:2", amount, description? } */
accountsRouter.post("/transfer", requirePerm("cash.edit"), ah(async (req, res) => {
  const amount = money(req.body?.amount, { allowZero: false });
  if (Number.isNaN(amount)) throw badRequest({ amount: "invalidAmount" });
  if (req.body?.from === req.body?.to) throw badRequest({ to: "sameAccount" });
  const bid = req.business.id;
  const description = text(req.body?.description, 200) || "Transfer";
  await withTx(async (conn) => {
    const from = await accountRef(conn, bid, req.body?.from);
    const to = await accountRef(conn, bid, req.body?.to);
    await moneyMove(conn, { businessId: bid, userId: req.user.id, direction: "out", account: from, amount, refType: "transfer", description });
    await moneyMove(conn, { businessId: bid, userId: req.user.id, direction: "in", account: to, amount, refType: "transfer", description });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "cash.transfer", meta: { amount }, ip: req.ip });
  });
  res.status(201).json({ code: "saved" });
}));

/* GET /api/accounts/transactions?from=&to=&account=cash:1 */
accountsRouter.get("/transactions", requirePerm("cash.view"), ah(async (req, res) => {
  const r = range(req.query, 30);
  const bid = req.business.id;
  const where = ["t.business_id = ?", "t.occurred_at BETWEEN ? AND ?"];
  const params = [bid, r.start, r.end];
  const [type, raw] = String(req.query.account || "").split(":");
  if (type === "cash" && id(raw)) { where.push("t.cash_account_id = ?"); params.push(id(raw)); }
  if (type === "bank" && id(raw)) { where.push("t.bank_account_id = ?"); params.push(id(raw)); }
  const [rows] = await pool.query(
    `SELECT t.id, t.direction, t.amount, t.ref_type, t.description, t.occurred_at, ca.name cash_name, CONCAT(ba.bank_name, ' · ', ba.account_name) bank_name, u.full_name user_name
       FROM cash_transactions t
       LEFT JOIN cash_accounts ca ON ca.id = t.cash_account_id LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id LEFT JOIN users u ON u.id = t.user_id
      WHERE ${where.join(" AND ")} ORDER BY t.occurred_at DESC, t.id DESC LIMIT 500`, params);
  res.json({ range: r, transactions: rows.map((t) => ({ id: t.id, direction: t.direction, amount: num(t.amount), type: t.ref_type, description: t.description, at: t.occurred_at, account: t.cash_name || t.bank_name, user: t.user_name })) });
}));

export { conflict };
