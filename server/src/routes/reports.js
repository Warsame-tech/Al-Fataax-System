import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, num, round2, range } from "../lib/http.js";

const router = Router();
router.use(requireAuth, requirePerm("reports.view"));

/*
 * GET /api/reports/:type?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns { columns, rows, summary } so one screen can render and export any report.
 * Formulas:
 *   Net sales      = sales + invoices (excluding cancelled) after discounts
 *   COGS           = Σ qty × unit cost captured at the time of sale
 *   Gross profit   = Net sales − COGS
 *   Net profit     = Gross profit − expenses + other income
 *   Received       = customer payments (refunds are negative payments)
 *   Receivables    = what customers still owe; Payables = what we still owe suppliers
 */
const REPORTS = {
  async sales(bid, r) {
    const [rows] = await pool.query(
      `SELECT d, SUM(n) n, SUM(total) total, SUM(discount) discount, SUM(vat) vat FROM (
         SELECT DATE(sold_at) d, 1 n, total, discount, vat_amount vat FROM sales WHERE business_id = ? AND status <> 'cancelled' AND sold_at BETWEEN ? AND ?
         UNION ALL SELECT issue_date, 1, total, discount, vat_amount FROM invoices WHERE business_id = ? AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN ? AND ?
       ) x GROUP BY d ORDER BY d`, [bid, r.start, r.end, bid, r.from, r.to]);
    const [[rec]] = await pool.query("SELECT COALESCE(SUM(amount),0) v FROM customer_payments WHERE business_id = ? AND paid_at BETWEEN ? AND ?", [bid, r.start, r.end]);
    const total = rows.reduce((s, x) => s + num(x.total), 0);
    return {
      columns: [["date", "date"], ["count", "number"], ["discount", "money"], ["vat", "money"], ["total", "money"]],
      rows: rows.map((x) => ({ date: x.d, count: num(x.n), discount: num(x.discount), vat: num(x.vat), total: num(x.total) })),
      summary: { salesTotal: round2(total), vat: round2(rows.reduce((s, x) => s + num(x.vat), 0)), documents: rows.reduce((s, x) => s + num(x.n), 0), received: num(rec.v) }
    };
  },

  async profit(bid, r) {
    const [[s]] = await pool.query(
      `SELECT COALESCE(SUM(si.line_total),0) rev, COALESCE(SUM(si.qty*si.unit_cost),0) cogs FROM sale_items si JOIN sales x ON x.id = si.sale_id
        WHERE si.business_id = ? AND x.status <> 'cancelled' AND x.sold_at BETWEEN ? AND ?`, [bid, r.start, r.end]);
    const [[i]] = await pool.query(
      `SELECT COALESCE(SUM(ii.line_total),0) rev, COALESCE(SUM(ii.qty*ii.unit_cost),0) cogs FROM invoice_items ii JOIN invoices x ON x.id = ii.invoice_id
        WHERE ii.business_id = ? AND x.status NOT IN ('draft','cancelled') AND x.issue_date BETWEEN ? AND ?`, [bid, r.from, r.to]);
    const [[disc]] = await pool.query(
      `SELECT (SELECT COALESCE(SUM(discount),0) FROM sales WHERE business_id = ? AND status <> 'cancelled' AND sold_at BETWEEN ? AND ?)
            + (SELECT COALESCE(SUM(discount),0) FROM invoices WHERE business_id = ? AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN ? AND ?) v`,
      [bid, r.start, r.end, bid, r.from, r.to]);
    const [[exp]] = await pool.query("SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE business_id = ? AND expense_date BETWEEN ? AND ?", [bid, r.from, r.to]);
    const [[inc]] = await pool.query("SELECT COALESCE(SUM(amount),0) v FROM other_income WHERE business_id = ? AND income_date BETWEEN ? AND ?", [bid, r.from, r.to]);
    const gross = num(s.rev) + num(i.rev);
    const netSales = round2(gross - num(disc.v));
    const cogs = round2(num(s.cogs) + num(i.cogs));
    const grossProfit = round2(netSales - cogs);
    const netProfit = round2(grossProfit - num(exp.v) + num(inc.v));
    const line = (label, amount) => ({ label, amount });
    return {
      columns: [["label", "label"], ["amount", "money"]],
      rows: [line("grossSales", round2(gross)), line("discounts", -num(disc.v)), line("netSales", netSales), line("cogs", -cogs),
        line("grossProfit", grossProfit), line("expenses", -num(exp.v)), line("otherIncome", num(inc.v)), line("netProfit", netProfit)],
      summary: { netSales, grossProfit, netProfit, margin: netSales ? round2((grossProfit / netSales) * 100) : 0 }
    };
  },

  async inventory(bid) {
    const [rows] = await pool.query(
      `SELECT CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.fragrance, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, '')) name, p.sku, c.name category, p.stock_qty, p.unit, p.cost_price, p.selling_price FROM products p
         LEFT JOIN categories c ON c.id = p.category_id WHERE p.business_id = ? AND p.is_active = 1 ORDER BY p.name`, [bid]);
    const list = rows.map((p) => ({ name: p.name, sku: p.sku, category: p.category, stock: num(p.stock_qty), unit: p.unit,
      costValue: round2(num(p.stock_qty) * num(p.cost_price)), retailValue: round2(num(p.stock_qty) * num(p.selling_price)) }));
    return {
      columns: [["name", "text"], ["sku", "text"], ["category", "text"], ["stock", "qty"], ["costValue", "money"], ["retailValue", "money"]],
      rows: list,
      summary: { products: list.length, costValue: round2(list.reduce((s, x) => s + x.costValue, 0)), retailValue: round2(list.reduce((s, x) => s + x.retailValue, 0)) }
    };
  },

  async lowStock(bid) {
    const [rows] = await pool.query(
      `SELECT CONCAT_WS(' ', name, NULLIF(size, '')) name, sku, stock_qty, min_stock, unit FROM products WHERE business_id = ? AND is_active = 1 AND stock_qty <= min_stock
        ORDER BY (stock_qty <= 0) DESC, stock_qty`, [bid]);
    return {
      columns: [["name", "text"], ["sku", "text"], ["stock", "qty"], ["minStock", "qty"], ["status", "status"]],
      rows: rows.map((p) => ({ name: p.name, sku: p.sku, stock: num(p.stock_qty), minStock: num(p.min_stock), status: num(p.stock_qty) <= 0 ? "outOfStock" : "lowStock" })),
      summary: { outOfStock: rows.filter((p) => num(p.stock_qty) <= 0).length, lowStock: rows.length }
    };
  },

  async receivables(bid) {
    const [rows] = await pool.query(
      `SELECT c.name, c.phone,
         (SELECT COALESCE(SUM(total - amount_paid),0) FROM invoices i WHERE i.business_id = c.business_id AND i.customer_id = c.id AND i.status IN ('unpaid','partially_paid'))
       + (SELECT COALESCE(SUM(total - amount_paid),0) FROM sales s WHERE s.business_id = c.business_id AND s.customer_id = c.id AND s.status = 'completed') balance,
         (SELECT COALESCE(SUM(total - amount_paid),0) FROM invoices i WHERE i.business_id = c.business_id AND i.customer_id = c.id AND i.status IN ('unpaid','partially_paid') AND i.due_date < UTC_DATE()) overdue,
         (SELECT MIN(due_date) FROM invoices i WHERE i.business_id = c.business_id AND i.customer_id = c.id AND i.status IN ('unpaid','partially_paid')) next_due
         FROM customers c WHERE c.business_id = ? HAVING balance > 0 ORDER BY balance DESC`, [bid]);
    return {
      columns: [["name", "text"], ["phone", "text"], ["nextDue", "date"], ["overdue", "money"], ["balance", "money"]],
      rows: rows.map((x) => ({ name: x.name, phone: x.phone, nextDue: x.next_due, overdue: num(x.overdue), balance: num(x.balance) })),
      summary: { customers: rows.length, total: round2(rows.reduce((s, x) => s + num(x.balance), 0)), overdue: round2(rows.reduce((s, x) => s + num(x.overdue), 0)) }
    };
  },

  async payables(bid) {
    const [rows] = await pool.query(
      `SELECT s.name, s.phone, (SELECT COALESCE(SUM(total - amount_paid),0) FROM purchases p WHERE p.business_id = s.business_id AND p.supplier_id = s.id AND p.status IN ('received', 'partial')) balance
         FROM suppliers s WHERE s.business_id = ? HAVING balance > 0 ORDER BY balance DESC`, [bid]);
    return {
      columns: [["name", "text"], ["phone", "text"], ["balance", "money"]],
      rows: rows.map((x) => ({ name: x.name, phone: x.phone, balance: num(x.balance) })),
      summary: { suppliers: rows.length, total: round2(rows.reduce((s, x) => s + num(x.balance), 0)) }
    };
  },

  async purchases(bid, r) {
    const [rows] = await pool.query(
      `SELECT p.purchase_no, DATE(p.purchased_at) d, s.name supplier, p.total, p.amount_paid FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.business_id = ? AND p.status IN ('received', 'partial') AND p.purchased_at BETWEEN ? AND ? ORDER BY p.purchased_at`, [bid, r.start, r.end]);
    return {
      columns: [["number", "text"], ["date", "date"], ["supplier", "text"], ["total", "money"], ["paid", "money"], ["balance", "money"]],
      rows: rows.map((x) => ({ number: x.purchase_no, date: x.d, supplier: x.supplier, total: num(x.total), paid: num(x.amount_paid), balance: round2(num(x.total) - num(x.amount_paid)) })),
      summary: { total: round2(rows.reduce((s, x) => s + num(x.total), 0)), paid: round2(rows.reduce((s, x) => s + num(x.amount_paid), 0)) }
    };
  },

  async expenses(bid, r) {
    const [rows] = await pool.query("SELECT category, COUNT(*) n, SUM(amount) total FROM expenses WHERE business_id = ? AND expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC", [bid, r.from, r.to]);
    const [inc] = await pool.query("SELECT COALESCE(SUM(amount),0) v FROM other_income WHERE business_id = ? AND income_date BETWEEN ? AND ?", [bid, r.from, r.to]);
    return {
      columns: [["category", "category"], ["count", "number"], ["total", "money"]],
      rows: rows.map((x) => ({ category: x.category, count: num(x.n), total: num(x.total) })),
      summary: { expenses: round2(rows.reduce((s, x) => s + num(x.total), 0)), otherIncome: num(inc[0].v) }
    };
  },

  async cashflow(bid, r) {
    const [rows] = await pool.query(
      `SELECT DATE(occurred_at) d, SUM(IF(direction='in', amount, 0)) money_in, SUM(IF(direction='out', amount, 0)) money_out
         FROM cash_transactions WHERE business_id = ? AND occurred_at BETWEEN ? AND ? AND ref_type <> 'transfer' GROUP BY d ORDER BY d`, [bid, r.start, r.end]);
    const [[opening]] = await pool.query("SELECT COALESCE(SUM(IF(direction='in', amount, -amount)),0) v FROM cash_transactions WHERE business_id = ? AND occurred_at < ?", [bid, r.start]);
    let bal = num(opening.v);
    const list = rows.map((x) => { bal = round2(bal + num(x.money_in) - num(x.money_out)); return { date: x.d, moneyIn: num(x.money_in), moneyOut: num(x.money_out), net: round2(num(x.money_in) - num(x.money_out)), balance: bal }; });
    return {
      columns: [["date", "date"], ["moneyIn", "money"], ["moneyOut", "money"], ["net", "money"], ["balance", "money"]],
      rows: list,
      summary: { opening: num(opening.v), moneyIn: round2(list.reduce((s, x) => s + x.moneyIn, 0)), moneyOut: round2(list.reduce((s, x) => s + x.moneyOut, 0)), closing: bal }
    };
  },

  async bestSellers(bid, r) {
    const [rows] = await pool.query(
      `SELECT CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.fragrance, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, '')) name, p.sku, SUM(x.qty) qty, SUM(x.line_total) revenue, SUM(x.line_total - x.qty * x.unit_cost) profit FROM (
         SELECT si.product_id, si.qty, si.line_total, si.unit_cost FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE si.business_id = ? AND s.status <> 'cancelled' AND s.sold_at BETWEEN ? AND ?
         UNION ALL SELECT ii.product_id, ii.qty, ii.line_total, ii.unit_cost FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
          WHERE ii.business_id = ? AND i.status NOT IN ('draft','cancelled') AND i.issue_date BETWEEN ? AND ?
       ) x JOIN products p ON p.id = x.product_id AND p.business_id = ? GROUP BY p.id ORDER BY qty DESC LIMIT 50`,
      [bid, r.start, r.end, bid, r.from, r.to, bid]);
    return {
      columns: [["name", "text"], ["sku", "text"], ["qty", "qty"], ["revenue", "money"], ["profit", "money"]],
      rows: rows.map((x) => ({ name: x.name, sku: x.sku, qty: num(x.qty), revenue: num(x.revenue), profit: num(x.profit) })),
      summary: { products: rows.length, revenue: round2(rows.reduce((s, x) => s + num(x.revenue), 0)) }
    };
  }
};

export const REPORT_TYPES = Object.keys(REPORTS);

router.get("/:type", ah(async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) return res.status(404).json({ code: "notFound" });
  const r = range(req.query, 30);
  const data = await fn(req.business.id, r);
  res.json({ type: req.params.type, range: { from: r.from, to: r.to }, currency: req.business.currency, ...data });
}));

export default router;
