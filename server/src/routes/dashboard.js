import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../lib/permissions.js";

const router = Router();
router.use(requireAuth);

/*
 * GET /api/dashboard?period=today|week|month|year|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Every figure comes from the database and is filtered by the signed-in
 * business. Definitions (kept deliberately explicit):
 *   salesTotal    = POS sales (completed) + invoices (not draft/cancelled) issued in the period
 *   received      = customer payments received in the period (real money in)
 *   grossProfit   = net sales − cost of goods sold (unit_cost captured at time of sale)
 *   netProfit     = grossProfit − expenses + other income (period)   ← estimate
 *   cash / bank   = all-time money in − money out per account type (from cash_transactions)
 *   receivables   = invoice + credit-sale amounts still owed by customers (all-time, open)
 *   payables      = purchase amounts still owed to suppliers (all-time, open)
 * Cash received is never presented as profit; credit sales are never counted as collected.
 */
function periodRange(q) {
  const now = new Date();
  const d = (x) => x.toISOString().slice(0, 10);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from = today;
  switch (q.period) {
    case "week": {
      const dow = (today.getUTCDay() + 6) % 7; // Monday = start of week
      from = new Date(today); from.setUTCDate(today.getUTCDate() - dow); break;
    }
    case "month": from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); break;
    case "year": from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)); break;
    case "custom": {
      const ok = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (ok(q.from) && ok(q.to) && q.from <= q.to) return { period: "custom", from: q.from, to: q.to };
      return null;
    }
    default: break; // today
  }
  return { period: ["week", "month", "year"].includes(q.period) ? q.period : "today", from: d(from), to: d(today) };
}

const num = (v) => Number(v || 0);
const r2 = (n) => Math.round(n * 100) / 100;

router.get("/", async (req, res, next) => {
  try {
    const range = periodRange(req.query);
    if (!range) return res.status(400).json({ code: "invalidRange" });
    const bid = req.business.id;
    const start = `${range.from} 00:00:00`;
    const end = `${range.to} 23:59:59`;

    const one = async (sql, params) => (await pool.query(sql, params))[0][0] || {};
    const many = async (sql, params) => (await pool.query(sql, params))[0];

    const [posSales, invSales, received, posCogs, invCogs, expenses, income, money, recv, pay, lowStock, recent, best, counts] = await Promise.all([
      one(`SELECT COALESCE(SUM(total),0) v, COUNT(*) n, COALESCE(SUM(discount),0) disc FROM sales
            WHERE business_id = ? AND status <> 'cancelled' AND sold_at BETWEEN ? AND ?`, [bid, start, end]),
      one(`SELECT COALESCE(SUM(total),0) v, COUNT(*) n, COALESCE(SUM(discount),0) disc FROM invoices
            WHERE business_id = ? AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN ? AND ?`, [bid, range.from, range.to]),
      one(`SELECT COALESCE(SUM(amount),0) v FROM customer_payments
            WHERE business_id = ? AND paid_at BETWEEN ? AND ?`, [bid, start, end]),
      one(`SELECT COALESCE(SUM(si.line_total),0) rev, COALESCE(SUM(si.qty * si.unit_cost),0) cogs
             FROM sale_items si JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
            WHERE si.business_id = ? AND s.status <> 'cancelled' AND s.sold_at BETWEEN ? AND ?`, [bid, start, end]),
      one(`SELECT COALESCE(SUM(ii.line_total),0) rev, COALESCE(SUM(ii.qty * ii.unit_cost),0) cogs
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id AND i.business_id = ii.business_id
            WHERE ii.business_id = ? AND i.status NOT IN ('draft','cancelled') AND i.issue_date BETWEEN ? AND ?`, [bid, range.from, range.to]),
      one(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE business_id = ? AND expense_date BETWEEN ? AND ?`, [bid, range.from, range.to]),
      one(`SELECT COALESCE(SUM(amount),0) v FROM other_income WHERE business_id = ? AND income_date BETWEEN ? AND ?`, [bid, range.from, range.to]),
      one(`SELECT
             COALESCE(SUM(CASE WHEN cash_account_id IS NOT NULL THEN IF(direction='in', amount, -amount) END),0) cash,
             COALESCE(SUM(CASE WHEN bank_account_id IS NOT NULL THEN IF(direction='in', amount, -amount) END),0) bank
             FROM cash_transactions WHERE business_id = ?`, [bid]),
      one(`SELECT
             (SELECT COALESCE(SUM(total - amount_paid),0) FROM invoices
               WHERE business_id = ? AND status IN ('unpaid','partially_paid','overdue')) +
             (SELECT COALESCE(SUM(total - amount_paid),0) FROM sales
               WHERE business_id = ? AND status = 'completed' AND total > amount_paid) v`, [bid, bid]),
      one(`SELECT COALESCE(SUM(total - amount_paid),0) v FROM purchases
            WHERE business_id = ? AND status = 'received' AND total > amount_paid`, [bid]),
      many(`SELECT id, name, stock_qty, min_stock, unit FROM products
             WHERE business_id = ? AND is_active = 1 AND stock_qty <= min_stock
             ORDER BY (stock_qty <= 0) DESC, stock_qty ASC LIMIT 8`, [bid]),
      many(`(SELECT 'sale' kind, receipt_no ref, total amount, sold_at at FROM sales WHERE business_id = ?)
            UNION ALL (SELECT 'invoice', invoice_no, total, CAST(issue_date AS DATETIME) FROM invoices WHERE business_id = ? AND status <> 'draft')
            UNION ALL (SELECT 'purchase', purchase_no, total, purchased_at FROM purchases WHERE business_id = ?)
            UNION ALL (SELECT 'expense', category, amount, CAST(expense_date AS DATETIME) FROM expenses WHERE business_id = ?)
            UNION ALL (SELECT 'payment', COALESCE(reference, ''), amount, paid_at FROM customer_payments WHERE business_id = ?)
            ORDER BY at DESC LIMIT 8`, [bid, bid, bid, bid, bid]),
      many(`SELECT p.id, p.name, SUM(x.qty) qty, SUM(x.line_total) revenue FROM (
              SELECT si.product_id, si.qty, si.line_total FROM sale_items si
                JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
               WHERE si.business_id = ? AND s.status <> 'cancelled' AND s.sold_at BETWEEN ? AND ?
              UNION ALL
              SELECT ii.product_id, ii.qty, ii.line_total FROM invoice_items ii
                JOIN invoices i ON i.id = ii.invoice_id AND i.business_id = ii.business_id
               WHERE ii.business_id = ? AND i.status NOT IN ('draft','cancelled') AND i.issue_date BETWEEN ? AND ?
            ) x JOIN products p ON p.id = x.product_id AND p.business_id = ?
            GROUP BY p.id, p.name ORDER BY qty DESC LIMIT 5`, [bid, start, end, bid, range.from, range.to, bid]),
      one(`SELECT (SELECT COUNT(*) FROM products WHERE business_id = ?) products,
                  (SELECT COUNT(*) FROM customers WHERE business_id = ?) customers`, [bid, bid])
    ]);

    const netSales = num(posCogs.rev) + num(invCogs.rev) - num(posSales.disc) - num(invSales.disc);
    const cogs = num(posCogs.cogs) + num(invCogs.cogs);
    const grossProfit = netSales - cogs;

    const finance = can(req.user.role, "dashboard.finance");
    res.json({
      range,
      finance,
      currency: req.business.currency,
      kpis: !finance ? null : {
        salesTotal: r2(num(posSales.v) + num(invSales.v)),
        salesCount: num(posSales.n) + num(invSales.n),
        received: r2(num(received.v)),
        grossProfit: r2(grossProfit),
        netProfit: r2(grossProfit - num(expenses.v) + num(income.v)),
        expenses: r2(num(expenses.v)),
        cash: r2(num(money.cash)),
        bank: r2(num(money.bank)),
        receivables: r2(num(recv.v)),
        payables: r2(num(pay.v))
      },
      lowStock: lowStock.map((p) => ({ id: p.id, name: p.name, qty: num(p.stock_qty), min: num(p.min_stock), unit: p.unit })),
      recent: !finance ? [] : recent.map((r) => ({ kind: r.kind, ref: r.ref, amount: num(r.amount), at: r.at })),
      bestSellers: best.map((b) => ({ id: b.id, name: b.name, qty: num(b.qty), revenue: num(b.revenue) })),
      counts: { products: num(counts.products), customers: num(counts.customers) }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
