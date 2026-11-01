import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, money, withTx, ensureOwned, badRequest, conflict, num, round2, range } from "../lib/http.js";

/*
 * Cashier shifts (cash sessions). A cashier opens a shift with the cash in the drawer; everything the cashier's
 * work moves through money accounts during the shift (cash_transactions with their user id: sales and invoice
 * payments, refunds, expenses, other income, supplier payments…) is summed by kind of account:
 *   cash drawer   = the cash accounts of the business's cash payment methods (and "Main cash")
 *   mobile money  = the accounts of mobile-money methods        bank = bank accounts
 * Closing: expected cash = opening + cash in − cash out; the cashier counts the drawer, the difference is a
 * shortage (−) or overage (+) and needs an explanation; a manager (cash.edit) reviews and approves the closing.
 * Mobile money and bank are shown on their own (reconciled with their statements, not the drawer).
 * business_settings.require_shift: sales need an open shift (lib/http conflict "shiftNotOpen" from createSale).
 */
const router = Router();
router.use(requireAuth);

const canWork = (req, res, next) => (["sales.create", "invoices.create", "payments.receive"].some((p) => can(req.user, p)) ? next() : res.status(403).json({ code: "forbidden" }));

/* the business's money accounts by kind */
async function accountKinds(db, businessId) {
  const [methods] = await db.query("SELECT kind, cash_account_id FROM payment_methods WHERE business_id = ? AND cash_account_id IS NOT NULL", [businessId]);
  const [accounts] = await db.query("SELECT id, name FROM cash_accounts WHERE business_id = ?", [businessId]);
  const mobile = new Set(methods.filter((m) => m.kind === "mobile_money").map((m) => m.cash_account_id));
  for (const a of accounts) if (a.name === "Mobile money") mobile.add(a.id);
  const cash = new Set(accounts.map((a) => a.id).filter((x) => !mobile.has(x)));
  return { cash, mobile };
}

/** What moved during a shift (live while open). */
export async function shiftTotals(db, businessId, s) {
  const kinds = await accountKinds(db, businessId);
  const [rows] = await db.query(
    `SELECT cash_account_id, bank_account_id, direction, ref_type, SUM(amount) amount, COUNT(*) n FROM cash_transactions
      WHERE business_id = ? AND user_id = ? AND occurred_at >= ? AND occurred_at <= COALESCE(?, UTC_TIMESTAMP())
      GROUP BY cash_account_id, bank_account_id, direction, ref_type`, [businessId, s.user_id, s.opened_at, s.closed_at]);
  const out = { cashIn: 0, cashOut: 0, mobileIn: 0, mobileOut: 0, bankIn: 0, bankOut: 0, cashBy: {} };
  for (const r of rows) {
    const amt = num(r.amount);
    const where = r.bank_account_id ? "bank" : kinds.mobile.has(r.cash_account_id) ? "mobile" : "cash";
    out[`${where}${r.direction === "in" ? "In" : "Out"}`] += amt;
    if (where === "cash") out.cashBy[`${r.direction}:${r.ref_type}`] = round2((out.cashBy[`${r.direction}:${r.ref_type}`] || 0) + amt);
  }
  for (const k of ["cashIn", "cashOut", "mobileIn", "mobileOut", "bankIn", "bankOut"]) out[k] = round2(out[k]);
  const [[sales]] = await db.query(
    `SELECT COUNT(*) n, COALESCE(SUM(total), 0) total FROM sales WHERE business_id = ? AND user_id = ? AND status = 'completed' AND sold_at >= ? AND sold_at <= COALESCE(?, UTC_TIMESTAMP())`,
    [businessId, s.user_id, s.opened_at, s.closed_at]);
  out.sales = { count: Number(sales.n), total: num(sales.total) };
  out.expectedCash = round2(num(s.opening_cash) + out.cashIn - out.cashOut);
  return out;
}

const shape = (s, totals = null) => ({
  id: s.id, userId: s.user_id, user: s.user_name || null, status: s.status, openedAt: s.opened_at, closedAt: s.closed_at,
  openingCash: num(s.opening_cash), openingNote: s.opening_note || "", countedCash: s.counted_cash === null ? null : num(s.counted_cash),
  expectedCash: s.expected_cash === null ? totals?.expectedCash ?? null : num(s.expected_cash),
  difference: s.difference === null ? null : num(s.difference), explanation: s.explanation || "",
  approvedBy: s.approver_name || null, approvedAt: s.approved_at, reviewNote: s.review_note || "",
  totals: totals || (s.totals ? JSON.parse(s.totals) : null)
});
const SELECT = `SELECT s.*, u.full_name user_name, a.full_name approver_name FROM cash_sessions s
  LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users a ON a.id = s.approved_by`;

/** GET /api/shifts/current — my open shift with live totals (or null) */
router.get("/current", canWork, ah(async (req, res) => {
  const [[s]] = await pool.query(`${SELECT} WHERE s.business_id = ? AND s.user_id = ? AND s.status = 'open'`, [req.business.id, req.user.id]);
  const [[set]] = await pool.query("SELECT require_shift FROM business_settings WHERE business_id = ?", [req.business.id]);
  res.json({ shift: s ? shape(s, await shiftTotals(pool, req.business.id, s)) : null, requireShift: Boolean(set?.require_shift) });
}));

/** POST /api/shifts/open { openingCash, note } */
router.post("/open", canWork, ah(async (req, res) => {
  const opening = money(req.body?.openingCash);
  if (Number.isNaN(opening) || opening < 0) throw badRequest({ openingCash: "invalidAmount" });
  const r = await withTx(async (conn) => {
    const [[open]] = await conn.query("SELECT id FROM cash_sessions WHERE business_id = ? AND user_id = ? AND status = 'open' FOR UPDATE", [req.business.id, req.user.id]);
    if (open) throw conflict("shiftAlreadyOpen");
    const [x] = await conn.query("INSERT INTO cash_sessions (business_id, user_id, opening_cash, opening_note, status, opened_at) VALUES (?, ?, ?, ?, 'open', UTC_TIMESTAMP())",
      [req.business.id, req.user.id, opening, optText(req.body?.note, 255)]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "shift.opened", entity: "cash_session", entityId: x.insertId, meta: { openingCash: opening }, ip: req.ip });
    return { id: x.insertId };
  });
  res.status(201).json(r);
}));

/** POST /api/shifts/:id/close { countedCash, explanation } — the cashier's own shift (or a manager closing it) */
router.post("/:id/close", canWork, ah(async (req, res) => {
  const counted = money(req.body?.countedCash);
  if (req.body?.countedCash === "" || req.body?.countedCash == null || Number.isNaN(counted) || counted < 0) throw badRequest({ countedCash: "invalidAmount" });
  const r = await withTx(async (conn) => {
    const s = await ensureOwned(conn, "cash_sessions", id(req.params.id), req.business.id, true);
    if (s.status !== "open") throw conflict("shiftClosed");
    if (s.user_id !== req.user.id && !can(req.user, "cash.edit")) throw conflict("forbidden");
    const [[now]] = await conn.query("SELECT UTC_TIMESTAMP() t");
    const totals = await shiftTotals(conn, req.business.id, { ...s, closed_at: now.t });
    const difference = round2(counted - totals.expectedCash);
    const explanation = text(req.body?.explanation, 500);
    if (difference !== 0 && !explanation) throw badRequest({ explanation: "explainDifference" });
    await conn.query(
      `UPDATE cash_sessions SET status = 'closed', closed_at = ?, closed_by = ?, counted_cash = ?, expected_cash = ?, difference = ?, explanation = ?, totals = ? WHERE id = ?`,
      [now.t, req.user.id, counted, totals.expectedCash, difference, explanation || null, JSON.stringify(totals), s.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "shift.closed", entity: "cash_session", entityId: s.id,
      meta: { expected: totals.expectedCash, counted, difference, explanation }, ip: req.ip });
    return { expectedCash: totals.expectedCash, countedCash: counted, difference };
  });
  res.json(r);
}));

/** POST /api/shifts/:id/approve { note } — a manager reviews and accepts the closing (not their own shift, unless owner) */
router.post("/:id/approve", requirePerm("cash.edit"), ah(async (req, res) => {
  await withTx(async (conn) => {
    const s = await ensureOwned(conn, "cash_sessions", id(req.params.id), req.business.id, true);
    if (s.status !== "closed") throw conflict("shiftNotClosed");
    if (s.user_id === req.user.id && req.user.role !== "owner") throw conflict("approveOwnShift");
    await conn.query("UPDATE cash_sessions SET status = 'approved', approved_by = ?, approved_at = UTC_TIMESTAMP(), review_note = ? WHERE id = ?", [req.user.id, optText(req.body?.note, 255), s.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "shift.approved", entity: "cash_session", entityId: s.id, meta: { difference: num(s.difference), note: optText(req.body?.note, 255) }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/** GET /api/shifts?status=&userId=&from=&to= — managers see everyone's, cashiers their own */
router.get("/", canWork, ah(async (req, res) => {
  const all = can(req.user, "cash.view");
  const where = ["s.business_id = ?"];
  const params = [req.business.id];
  if (!all) { where.push("s.user_id = ?"); params.push(req.user.id); }
  else if (id(req.query.userId)) { where.push("s.user_id = ?"); params.push(id(req.query.userId)); }
  if (["open", "closed", "approved"].includes(req.query.status)) { where.push("s.status = ?"); params.push(req.query.status); }
  const r = range(req.query, 30);
  where.push("s.opened_at BETWEEN ? AND ?"); params.push(r.start, r.end);
  const [rows] = await pool.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY s.status = 'open' DESC, s.status = 'closed' DESC, s.id DESC LIMIT 300`, params);
  const list = [];
  for (const s of rows) list.push(shape(s, s.status === "open" ? await shiftTotals(pool, req.business.id, s) : null));
  const closed = list.filter((s) => s.difference !== null);
  res.json({ range: r, shifts: list, summary: { shortages: round2(closed.filter((s) => s.difference < 0).reduce((a, s) => a + s.difference, 0)),
    overages: round2(closed.filter((s) => s.difference > 0).reduce((a, s) => a + s.difference, 0)), awaiting: list.filter((s) => s.status === "closed").length } });
}));

router.get("/:id", canWork, ah(async (req, res) => {
  const [[s]] = await pool.query(`${SELECT} WHERE s.id = ? AND s.business_id = ?`, [id(req.params.id), req.business.id]);
  if (!s || (s.user_id !== req.user.id && !can(req.user, "cash.view"))) return res.status(404).json({ code: "notFound" });
  const totals = s.status === "open" ? await shiftTotals(pool, req.business.id, s) : JSON.parse(s.totals || "null");
  const [moves] = await pool.query(
    `SELECT t.direction, t.amount, t.ref_type, t.description, t.occurred_at, ca.name cash_name, b.bank_name FROM cash_transactions t
       LEFT JOIN cash_accounts ca ON ca.id = t.cash_account_id LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
      WHERE t.business_id = ? AND t.user_id = ? AND t.occurred_at >= ? AND t.occurred_at <= COALESCE(?, UTC_TIMESTAMP()) ORDER BY t.id`,
    [req.business.id, s.user_id, s.opened_at, s.closed_at]);
  res.json({ shift: shape(s, totals), moves: moves.map((m) => ({ direction: m.direction, amount: num(m.amount), type: m.ref_type, description: m.description || "", at: m.occurred_at, account: m.cash_name || m.bank_name })) });
}));

/** PUT /api/shifts/settings { requireShift } (owner) */
router.put("/settings", requirePerm("settings.edit"), ah(async (req, res) => {
  await pool.query("UPDATE business_settings SET require_shift = ? WHERE business_id = ?", [req.body?.requireShift ? 1 : 0, req.business.id]);
  res.json({ code: "saved" });
}));

export default router;
