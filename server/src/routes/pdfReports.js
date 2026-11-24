/*
 * PDF reports (client: app/PdfReports.jsx builds the PDF; this file only reads the business's own records).
 *   GET /api/pdf-reports                 the reports this user may run: [{ key, category, group, filters }]
 *   GET /api/pdf-reports/options?kind=&q= pickers: customer, supplier, product, category, branch, invoice, purchase, account
 *   GET /api/pdf-reports/:key?filters     one report: { key, period, subject, stats, sections: [{ title, columns, rows, totals }] }
 * Two categories: "individual" (one customer, supplier, product, document, branch…) and "summary" (overviews).
 * Every query is limited to req.business.id (and its own database); branch-bound users only see their branches;
 * cost and profit columns need costs.view; finance reports need the accounting module (and Advanced mode for the books).
 * Column types: text, money, qty, int, date, pct — the client formats them in the business's currency and language.
 */
import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../lib/permissions.js";
import { ah, id, text, num, badRequest, ensureOwned } from "../lib/http.js";
import { partyStatement } from "./parties.js";
import { balances, openDocs, shapeDocs, byParty, aging, sumType, accountingMode } from "./accounting.js";
import { syncBooks } from "../lib/accounting.js";

const router = Router();
router.use(requireAuth);

const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const r4 = (v) => Math.round(Number(v || 0) * 10000) / 10000;
const iso = (d) => d.toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (v instanceof Date ? v.toISOString() : String(v || "")).slice(0, 10);
const col = (key, type = "text", extra = {}) => ({ key, type, ...extra });
const sumBy = (rows, k) => r2(rows.reduce((s, r) => s + num(r[k]), 0));

/* ---------- filters ---------- */
function filtersOf(req) {
  const q = req.query;
  const today = new Date();
  const from = DATE.test(q.from || "") ? q.from : iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const to = DATE.test(q.to || "") ? q.to : iso(today);
  // a branch: one the user may see; staff tied to branches stay in theirs
  const allowed = (req.branch?.list || []).map((b) => b.id);
  const wanted = id(q.branch);
  const branch = wanted && allowed.includes(wanted) && !req.branch.fixed ? wanted : req.branch?.filterId ? Number(req.branch.filterId) : null;
  return {
    from: from <= to ? from : to, to: from <= to ? to : from, branch,
    customer: id(q.customer), supplier: id(q.supplier), product: id(q.product), category: id(q.category), invoice: id(q.invoice), purchase: id(q.purchase),
    account: id(q.account), method: ["cash", "mobile_money", "bank"].includes(q.method) ? q.method : null, status: text(q.status, 20) || null,
    stockStatus: ["in", "low", "out"].includes(q.stockStatus) ? q.stockStatus : null, granularity: ["day", "week", "month", "year"].includes(q.granularity) ? q.granularity : "day",
    limit: Math.min(100, Math.max(5, Number(q.limit) || 20))
  };
}
const bsql = (f, alias) => (f.branch ? ` AND ${alias}.branch_id = ${Number(f.branch)}` : "");
const between = (expr) => ` AND DATE(${expr}) BETWEEN ? AND ?`;

/* revenue and cost of each sale / invoice (VAT is not revenue) */
const SALE_COST = "(SELECT COALESCE(SUM(si.qty * COALESCE(si.unit_cost, 0)), 0) FROM sale_items si WHERE si.sale_id = s.id)";
const INV_COST = "(SELECT COALESCE(SUM(ii.qty * COALESCE(ii.unit_cost, 0)), 0) FROM invoice_items ii WHERE ii.invoice_id = i.id)";

async function party(req, kind, pid) {
  if (!pid) throw badRequest({ [kind]: "required" });
  return ensureOwned(pool, kind === "customer" ? "customers" : "suppliers", pid, req.business.id);
}
async function productOf(req, pid) {
  if (!pid) throw badRequest({ product: "required" });
  const [[p]] = await pool.query(
    `SELECT p.*, c.name category, b.name brand, sp.name supplier FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
       LEFT JOIN suppliers sp ON sp.id = p.supplier_id WHERE p.id = ? AND p.business_id = ?`, [pid, req.business.id]);
  if (!p) throw badRequest({ product: "required" });
  return p;
}

/* ---------- the catalogue ----------
 * perm: what the user needs; filters: what the report asks for (the client shows these pickers); run(req, f) → report. */
const R = {};
const add = (key, category, group, perm, filters, run, extra = {}) => { R[key] = { key, category, group, perm, filters, run, ...extra }; };
const RANGE = ["from", "to"];

/* ===================== INDIVIDUAL: customers ===================== */
add("customer_profile", "individual", "customers", "customers.view", ["customer"], async (req, f) => {
  const c = await party(req, "customer", f.customer);
  const st = await partyStatement(pool, req.business.id, true, c, {});
  const docs = st.lines.filter((l) => ["invoice", "sale"].includes(l.kind));
  const pays = st.lines.filter((l) => l.kind === "payment");
  return {
    subject: c.name,
    details: [["name", c.name], ["phone", c.phone], ["email", c.email], ["address", c.address], ["priceTier", c.price_tier], ["since", day(c.created_at)]],
    stats: [{ key: "documents", value: docs.length, type: "int" }, { key: "totalBought", value: sumBy(docs, "debit"), type: "money" },
      { key: "totalPaid", value: sumBy(pays, "credit"), type: "money" }, { key: "outstanding", value: st.balance, type: "money" },
      { key: "firstPurchase", value: docs[0] ? day(docs[0].at) : null, type: "date" }, { key: "lastPurchase", value: docs.length ? day(docs[docs.length - 1].at) : null, type: "date" }],
    sections: [{ title: "recentDocuments", columns: [col("date", "date"), col("reference"), col("type"), col("amount", "money"), col("status")],
      rows: docs.slice(-25).reverse().map((d) => ({ date: day(d.at), reference: d.ref, type: d.kind, amount: d.debit, status: d.status })) }]
  };
});
for (const kind of ["customer", "supplier"]) {
  const isC = kind === "customer";
  add(`${kind}_statement`, "individual", `${kind}s`, `${kind}s.view`, [kind, ...RANGE], async (req, f) => {
    const p = await party(req, kind, f[kind]);
    const st = await partyStatement(pool, req.business.id, isC, p, { from: f.from, to: f.to });
    return {
      subject: p.name, period: { from: f.from, to: f.to },
      stats: [{ key: "opening", value: st.period.opening, type: "money" }, { key: isC ? "charged" : "purchased", value: st.period.debit, type: "money" },
        { key: "paid", value: st.period.credit, type: "money" }, { key: "closing", value: st.period.closing, type: "money" }],
      sections: [{ columns: [col("date", "date"), col("type"), col("reference"), col("debit", "money"), col("credit", "money"), col("balance", "money")],
        rows: [{ date: f.from, type: "opening", reference: "", debit: null, credit: null, balance: st.period.opening, _muted: true },
          ...st.lines.map((l) => ({ date: day(l.at), type: l.kind, reference: l.ref, debit: l.debit || null, credit: l.credit || null, balance: l.balance }))],
        totals: { debit: st.period.debit, credit: st.period.credit, balance: st.period.closing } }]
    };
  });
  add(`${kind}_outstanding`, "individual", `${kind}s`, `${kind}s.view`, [kind], async (req, f) => {
    const p = await party(req, kind, f[kind]);
    const docs = shapeDocs(await openDocs(req.business.id, kind)).filter((d) => d.partyId === p.id);
    return {
      subject: p.name,
      stats: [{ key: "openDocuments", value: docs.length, type: "int" }, { key: "outstanding", value: sumBy(docs, "balance"), type: "money" },
        { key: "overdue", value: r2(docs.filter((d) => d.status === "overdue").reduce((s, d) => s + d.balance, 0)), type: "money" }],
      sections: [{ columns: [col("reference"), col("date", "date"), ...(isC ? [col("due", "date")] : []), col("original", "money"), col("paid", "money"), col("remaining", "money"), col("status"), col("daysLate", "int")],
        rows: docs.map((d) => ({ reference: d.ref, date: d.date, due: d.due, original: d.total, paid: d.paid, remaining: d.balance, status: d.status, daysLate: d.daysLate || null })),
        totals: { original: sumBy(docs, "total"), paid: sumBy(docs, "paid"), remaining: sumBy(docs, "balance") } },
      { title: "aging", columns: [col("bucket"), col("amount", "money")], rows: aging(docs).map((a) => ({ bucket: a.bucket, amount: a.amount })) }]
    };
  });
  add(`${kind}_payments`, "individual", `${kind}s`, `${kind}s.view`, [kind, ...RANGE], async (req, f) => {
    const p = await party(req, kind, f[kind]);
    const [rows] = isC
      ? await pool.query(`SELECT cp.paid_at, cp.amount, cp.method, cp.reference, COALESCE(i.invoice_no, s.receipt_no) doc FROM customer_payments cp
          LEFT JOIN invoices i ON i.id = cp.invoice_id LEFT JOIN sales s ON s.id = cp.sale_id
          WHERE cp.business_id = ? AND cp.customer_id = ?${between("cp.paid_at")} ORDER BY cp.paid_at`, [req.business.id, p.id, f.from, f.to])
      : await pool.query(`SELECT sp.paid_at, sp.amount, sp.method, sp.reference, pu.purchase_no doc FROM supplier_payments sp LEFT JOIN purchases pu ON pu.id = sp.purchase_id
          WHERE sp.business_id = ? AND sp.supplier_id = ?${between("sp.paid_at")} ORDER BY sp.paid_at`, [req.business.id, p.id, f.from, f.to]);
    const shaped = rows.map((r) => ({ date: day(r.paid_at), document: r.doc || "—", method: r.method, reference: r.reference || "", amount: r2(r.amount) }));
    return { subject: p.name, period: { from: f.from, to: f.to }, stats: [{ key: "payments", value: shaped.length, type: "int" }, { key: "total", value: sumBy(shaped, "amount"), type: "money" }],
      sections: [{ columns: [col("date", "date"), col("document"), col("method"), col("reference"), col("amount", "money")], rows: shaped, totals: { amount: sumBy(shaped, "amount") } }] };
  });
}
add("customer_history", "individual", "customers", "customers.view", ["customer", ...RANGE], async (req, f) => {
  const c = await party(req, "customer", f.customer);
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT 'sale' type, s.receipt_no ref, s.sold_at at, s.total, s.amount_paid, s.status, (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) items FROM sales s
        WHERE s.business_id = ? AND s.customer_id = ?${between("s.sold_at")}${bsql(f, "s")}
       UNION ALL SELECT 'invoice', i.invoice_no, i.issue_date, i.total, i.amount_paid, i.status, (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = i.id) FROM invoices i
        WHERE i.business_id = ? AND i.customer_id = ? AND i.status <> 'draft'${between("i.issue_date")}${bsql(f, "i")}) x ORDER BY at`,
    [req.business.id, c.id, f.from, f.to, req.business.id, c.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.at), type: r.type, reference: r.ref, items: Number(r.items), total: r2(r.total), paid: r2(r.amount_paid), balance: r2(num(r.total) - num(r.amount_paid)), status: r.status }));
  const live = shaped.filter((x) => x.status !== "cancelled");
  return { subject: c.name, period: { from: f.from, to: f.to },
    stats: [{ key: "documents", value: live.length, type: "int" }, { key: "total", value: sumBy(live, "total"), type: "money" }, { key: "totalPaid", value: sumBy(live, "paid"), type: "money" }],
    sections: [{ columns: [col("date", "date"), col("type"), col("reference"), col("items", "int"), col("total", "money"), col("paid", "money"), col("balance", "money"), col("status")],
      rows: shaped, totals: { total: sumBy(live, "total"), paid: sumBy(live, "paid"), balance: sumBy(live, "balance") } }] };
});

/* ===================== INDIVIDUAL: suppliers ===================== */
add("supplier_profile", "individual", "suppliers", "suppliers.view", ["supplier"], async (req, f) => {
  const s = await party(req, "supplier", f.supplier);
  const st = await partyStatement(pool, req.business.id, false, s, {});
  const docs = st.lines.filter((l) => l.kind === "purchase");
  const [[prods]] = await pool.query("SELECT COUNT(*) n FROM products WHERE business_id = ? AND supplier_id = ?", [req.business.id, s.id]);
  return { subject: s.name, details: [["name", s.name], ["phone", s.phone], ["email", s.email], ["address", s.address], ["since", day(s.created_at)]],
    stats: [{ key: "purchases", value: docs.length, type: "int" }, { key: "totalPurchased", value: sumBy(docs, "debit"), type: "money" }, { key: "totalPaid", value: sumBy(st.lines.filter((l) => l.kind === "payment"), "credit"), type: "money" },
      { key: "outstanding", value: st.balance, type: "money" }, { key: "productsSupplied", value: Number(prods.n), type: "int" }],
    sections: [{ title: "recentDocuments", columns: [col("date", "date"), col("reference"), col("amount", "money"), col("status")],
      rows: docs.slice(-25).reverse().map((d) => ({ date: day(d.at), reference: d.ref, amount: d.debit, status: d.status })) }] };
});
add("supplier_purchases", "individual", "suppliers", "suppliers.view", ["supplier", ...RANGE], async (req, f) => {
  const s = await party(req, "supplier", f.supplier);
  const [rows] = await pool.query(
    `SELECT p.purchase_no, p.purchased_at, p.status, p.total, p.amount_paid, (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) items FROM purchases p
      WHERE p.business_id = ? AND p.supplier_id = ?${between("p.purchased_at")}${bsql(f, "p")} ORDER BY p.purchased_at`, [req.business.id, s.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.purchased_at), reference: r.purchase_no, items: Number(r.items), total: r2(r.total), paid: r2(r.amount_paid), balance: r2(num(r.total) - num(r.amount_paid)), status: r.status }));
  const live = shaped.filter((x) => !["cancelled", "draft"].includes(x.status));
  return { subject: s.name, period: { from: f.from, to: f.to }, stats: [{ key: "purchases", value: live.length, type: "int" }, { key: "total", value: sumBy(live, "total"), type: "money" }],
    sections: [{ columns: [col("date", "date"), col("reference"), col("items", "int"), col("total", "money"), col("paid", "money"), col("balance", "money"), col("status")],
      rows: shaped, totals: { total: sumBy(live, "total"), paid: sumBy(live, "paid"), balance: sumBy(live, "balance") } }] };
});

/* ===================== INDIVIDUAL: products ===================== */
add("product_details", "individual", "products", "products.view", ["product"], async (req, f) => {
  const p = await productOf(req, f.product);
  const costs = can(req.user, "costs.view");
  const [stock] = await pool.query(
    `SELECT l.name location, ps.qty FROM product_stock ps JOIN stock_locations l ON l.id = ps.location_id WHERE ps.business_id = ? AND ps.product_id = ?${f.branch ? ` AND l.branch_id = ${Number(f.branch)}` : ""} ORDER BY l.is_default DESC, l.name`, [req.business.id, p.id]);
  const [variants] = await pool.query(
    "SELECT name, sku, size, shade, selling_price, stock_qty FROM products WHERE business_id = ? AND id <> ? AND ((variant_of = ?) OR (? IS NOT NULL AND (variant_of = ? OR id = ?))) ORDER BY name",
    [req.business.id, p.id, p.id, p.variant_of, p.variant_of, p.variant_of]);
  const [[open]] = await pool.query("SELECT COALESCE(SUM(qty_change), 0) q FROM stock_movements WHERE business_id = ? AND product_id = ? AND type = 'opening'", [req.business.id, p.id]);
  const details = [["name", p.name], ["sku", p.sku], ["barcode", p.barcode], ["category", p.category], ["subcategory", p.subcategory], ["brand", p.brand], ["supplier", p.supplier],
    ["unit", p.unit], ["size", p.size], ["shade", p.shade], ["sellingPrice", r2(p.selling_price), "money"], ["wholesalePrice", p.wholesale_price === null ? null : r2(p.wholesale_price), "money"],
    ["minPrice", p.min_price === null ? null : r2(p.min_price), "money"], ...(costs ? [["costPrice", r2(p.cost_price), "money"], ["margin", num(p.selling_price) ? r2(((num(p.selling_price) - num(p.cost_price)) / num(p.selling_price)) * 100) : null, "pct"]] : []),
    ["openingStock", r4(open.q), "qty"], ["currentStock", r4(p.stock_qty), "qty"], ["lowStockAlert", r4(p.min_stock), "qty"], ["status", p.is_active ? "active" : "archived"], ["description", p.description]]
    .filter(([, v]) => v !== null && v !== undefined && v !== "");
  return { subject: p.name, details,
    sections: [{ title: "stockByLocation", columns: [col("location"), col("qty", "qty")], rows: stock.map((s) => ({ location: s.location, qty: r4(s.qty) })), totals: { qty: r4(stock.reduce((s, x) => s + num(x.qty), 0)) } },
      ...(variants.length ? [{ title: "variants", columns: [col("name"), col("sku"), col("size"), col("price", "money"), col("stock", "qty")],
        rows: variants.map((v) => ({ name: v.name, sku: v.sku, size: [v.size, v.shade].filter(Boolean).join(" · "), price: r2(v.selling_price), stock: r4(v.stock_qty) })) }] : [])] };
});
add("product_stock_history", "individual", "products", "stock.view", ["product", ...RANGE], async (req, f) => {
  const p = await productOf(req, f.product);
  const [rows] = await pool.query(
    `SELECT m.created_at, m.type, m.qty_change, m.balance_after, m.reference, m.reason, m.ref_type, l.name location, u.full_name user FROM stock_movements m
       LEFT JOIN stock_locations l ON l.id = m.location_id LEFT JOIN users u ON u.id = m.user_id
      WHERE m.business_id = ? AND m.product_id = ?${between("m.created_at")}${f.branch ? ` AND l.branch_id = ${Number(f.branch)}` : ""} ORDER BY m.created_at, m.id`, [req.business.id, p.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.created_at), type: r.type, location: r.location || "—", in: num(r.qty_change) > 0 ? r4(r.qty_change) : null, out: num(r.qty_change) < 0 ? r4(-r.qty_change) : null,
    balance: r.balance_after === null ? null : r4(r.balance_after), reference: r.reference || r.ref_type || "", by: r.user || "" }));
  return { subject: p.name, period: { from: f.from, to: f.to },
    stats: [{ key: "movements", value: shaped.length, type: "int" }, { key: "qtyIn", value: r4(shaped.reduce((s, x) => s + (x.in || 0), 0)), type: "qty" }, { key: "qtyOut", value: r4(shaped.reduce((s, x) => s + (x.out || 0), 0)), type: "qty" }, { key: "currentStock", value: r4(p.stock_qty), type: "qty" }],
    sections: [{ columns: [col("date", "date"), col("type"), col("location"), col("in", "qty"), col("out", "qty"), col("balance", "qty"), col("reference"), col("by")], rows: shaped,
      totals: { in: r4(shaped.reduce((s, x) => s + (x.in || 0), 0)), out: r4(shaped.reduce((s, x) => s + (x.out || 0), 0)) } }] };
});
add("product_sales", "individual", "products", "sales.view", ["product", ...RANGE], async (req, f) => {
  const p = await productOf(req, f.product);
  const costs = can(req.user, "costs.view");
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT s.sold_at at, s.receipt_no ref, 'sale' type, COALESCE(c.name, s.walkin_name, '') customer, si.qty, si.unit_price, si.line_total, si.unit_cost FROM sale_items si
         JOIN sales s ON s.id = si.sale_id LEFT JOIN customers c ON c.id = s.customer_id
        WHERE si.business_id = ? AND si.product_id = ? AND s.status <> 'cancelled'${between("s.sold_at")}${bsql(f, "s")}
       UNION ALL SELECT i.issue_date, i.invoice_no, 'invoice', COALESCE(c.name, ''), ii.qty, ii.unit_price, ii.line_total, ii.unit_cost FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id LEFT JOIN customers c ON c.id = i.customer_id
        WHERE ii.business_id = ? AND ii.product_id = ? AND i.status NOT IN ('draft','cancelled')${between("i.issue_date")}${bsql(f, "i")}) x ORDER BY at`,
    [req.business.id, p.id, f.from, f.to, req.business.id, p.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.at), type: r.type, reference: r.ref, customer: r.customer || "—", qty: r4(r.qty), price: r2(r.unit_price), total: r2(r.line_total),
    ...(costs ? { cost: r2(num(r.qty) * num(r.unit_cost)), profit: r2(num(r.line_total) - num(r.qty) * num(r.unit_cost)) } : {}) }));
  const totals = { qty: r4(shaped.reduce((s, x) => s + x.qty, 0)), total: sumBy(shaped, "total"), ...(costs ? { cost: sumBy(shaped, "cost"), profit: sumBy(shaped, "profit") } : {}) };
  return { subject: p.name, period: { from: f.from, to: f.to },
    stats: [{ key: "qtySold", value: totals.qty, type: "qty" }, { key: "revenue", value: totals.total, type: "money" }, ...(costs ? [{ key: "profit", value: totals.profit, type: "money" }] : [])],
    sections: [{ columns: [col("date", "date"), col("type"), col("reference"), col("customer"), col("qty", "qty"), col("price", "money"), col("total", "money"), ...(costs ? [col("cost", "money"), col("profit", "money")] : [])], rows: shaped, totals }] };
});
add("product_purchases", "individual", "products", "purchases.view", ["product", ...RANGE], async (req, f) => {
  const p = await productOf(req, f.product);
  const [rows] = await pool.query(
    `SELECT pu.purchased_at, pu.purchase_no, pu.status, sp.name supplier, pi.qty, pi.unit_cost, pi.line_total, pi.received_qty, pi.returned_qty FROM purchase_items pi
       JOIN purchases pu ON pu.id = pi.purchase_id LEFT JOIN suppliers sp ON sp.id = pu.supplier_id
      WHERE pi.business_id = ? AND pi.product_id = ? AND pu.status NOT IN ('cancelled')${between("pu.purchased_at")}${bsql(f, "pu")} ORDER BY pu.purchased_at`, [req.business.id, p.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.purchased_at), reference: r.purchase_no, supplier: r.supplier || "—", qty: r4(r.qty), received: r4(r.received_qty ?? r.qty), returned: r.returned_qty ? r4(r.returned_qty) : null,
    unitCost: r2(r.unit_cost), total: r2(r.line_total), status: r.status }));
  return { subject: p.name, period: { from: f.from, to: f.to },
    stats: [{ key: "purchases", value: shaped.length, type: "int" }, { key: "qtyBought", value: r4(shaped.reduce((s, x) => s + x.qty, 0)), type: "qty" }, { key: "total", value: sumBy(shaped, "total"), type: "money" }],
    sections: [{ columns: [col("date", "date"), col("reference"), col("supplier"), col("qty", "qty"), col("received", "qty"), col("returned", "qty"), col("unitCost", "money"), col("total", "money"), col("status")],
      rows: shaped, totals: { qty: r4(shaped.reduce((s, x) => s + x.qty, 0)), total: sumBy(shaped, "total") } }] };
}, { costs: true });
add("product_profitability", "individual", "products", "costs.view", ["product", ...RANGE], async (req, f) => {
  const p = await productOf(req, f.product);
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(at, '%Y-%m') m, SUM(qty) qty, SUM(rev) rev, SUM(cost) cost FROM (
       SELECT s.sold_at at, si.qty, si.line_total rev, si.qty * COALESCE(si.unit_cost, 0) cost FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE si.business_id = ? AND si.product_id = ? AND s.status <> 'cancelled'${between("s.sold_at")}${bsql(f, "s")}
       UNION ALL SELECT i.issue_date, ii.qty, ii.line_total, ii.qty * COALESCE(ii.unit_cost, 0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.business_id = ? AND ii.product_id = ? AND i.status NOT IN ('draft','cancelled')${between("i.issue_date")}${bsql(f, "i")}) x GROUP BY m ORDER BY m`,
    [req.business.id, p.id, f.from, f.to, req.business.id, p.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ month: r.m, qty: r4(r.qty), revenue: r2(r.rev), cost: r2(r.cost), profit: r2(num(r.rev) - num(r.cost)), margin: num(r.rev) ? r2(((num(r.rev) - num(r.cost)) / num(r.rev)) * 100) : null }));
  const rev = sumBy(shaped, "revenue"), cost = sumBy(shaped, "cost");
  return { subject: p.name, period: { from: f.from, to: f.to },
    stats: [{ key: "revenue", value: rev, type: "money" }, { key: "cost", value: cost, type: "money" }, { key: "profit", value: r2(rev - cost), type: "money" }, { key: "margin", value: rev ? r2(((rev - cost) / rev) * 100) : null, type: "pct" }],
    sections: [{ columns: [col("month"), col("qty", "qty"), col("revenue", "money"), col("cost", "money"), col("profit", "money"), col("margin", "pct")], rows: shaped,
      totals: { qty: r4(shaped.reduce((s, x) => s + x.qty, 0)), revenue: rev, cost, profit: r2(rev - cost), margin: rev ? r2(((rev - cost) / rev) * 100) : null } }] };
});

/* ===================== INDIVIDUAL: documents, payments, branch ===================== */
add("invoice_report", "individual", "documents", "invoices.view", ["invoice"], async (req, f) => {
  if (!f.invoice) throw badRequest({ invoice: "required" });
  const [[i]] = await pool.query("SELECT i.*, c.name customer FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ? AND i.business_id = ?", [f.invoice, req.business.id]);
  if (!i) throw badRequest({ invoice: "required" });
  const [lines] = await pool.query("SELECT ii.*, p.name product FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ? ORDER BY ii.id", [i.id]);
  const [pays] = await pool.query("SELECT paid_at, amount, method, reference FROM customer_payments WHERE invoice_id = ? AND business_id = ? ORDER BY paid_at", [i.id, req.business.id]);
  return { subject: `${i.invoice_no} · ${i.customer || "—"}`,
    details: [["reference", i.invoice_no], ["customer", i.customer], ["issueDate", day(i.issue_date), "date"], ["dueDate", i.due_date ? day(i.due_date) : null, "date"], ["status", i.status], ["notes", i.notes]].filter(([, v]) => v),
    stats: [{ key: "subtotal", value: r2(i.subtotal), type: "money" }, { key: "discount", value: r2(i.discount), type: "money" }, { key: "vat", value: r2(i.vat_amount), type: "money" },
      { key: "total", value: r2(i.total), type: "money" }, { key: "paid", value: r2(i.amount_paid), type: "money" }, { key: "balance", value: r2(num(i.total) - num(i.amount_paid)), type: "money" }],
    sections: [{ title: "items", columns: [col("product"), col("qty", "qty"), col("price", "money"), col("discount", "money"), col("total", "money")],
      rows: lines.map((l) => ({ product: l.product || l.description, qty: r4(l.sell_qty ?? l.qty), price: r2(l.sell_price ?? l.unit_price), discount: num(l.discount) ? r2(l.discount) : null, total: r2(l.line_total) })), totals: { total: sumBy(lines, "line_total") } },
      ...(pays.length ? [{ title: "payments", columns: [col("date", "date"), col("method"), col("reference"), col("amount", "money")],
        rows: pays.map((x) => ({ date: day(x.paid_at), method: x.method, reference: x.reference || "", amount: r2(x.amount) })), totals: { amount: sumBy(pays, "amount") } }] : [])] };
});
add("purchase_report", "individual", "documents", "purchases.view", ["purchase"], async (req, f) => {
  if (!f.purchase) throw badRequest({ purchase: "required" });
  const [[p]] = await pool.query("SELECT p.*, s.name supplier FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ? AND p.business_id = ?", [f.purchase, req.business.id]);
  if (!p) throw badRequest({ purchase: "required" });
  const [lines] = await pool.query("SELECT pi.*, pr.name product FROM purchase_items pi LEFT JOIN products pr ON pr.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id", [p.id]);
  const [pays] = await pool.query("SELECT paid_at, amount, method, reference FROM supplier_payments WHERE purchase_id = ? AND business_id = ? ORDER BY paid_at", [p.id, req.business.id]);
  return { subject: `${p.purchase_no} · ${p.supplier || "—"}`,
    details: [["reference", p.purchase_no], ["supplier", p.supplier], ["date", day(p.purchased_at), "date"], ["received", p.received_at ? day(p.received_at) : null, "date"], ["status", p.status], ["notes", p.notes]].filter(([, v]) => v),
    stats: [{ key: "total", value: r2(p.total), type: "money" }, { key: "paid", value: r2(p.amount_paid), type: "money" }, { key: "balance", value: r2(num(p.total) - num(p.amount_paid)), type: "money" }],
    sections: [{ title: "items", columns: [col("product"), col("qty", "qty"), col("received", "qty"), col("returned", "qty"), col("unitCost", "money"), col("total", "money")],
      rows: lines.map((l) => ({ product: l.product, qty: r4(l.buy_qty ?? l.qty), received: r4(l.received_qty ?? l.qty), returned: l.returned_qty ? r4(l.returned_qty) : null, unitCost: r2(l.buy_cost ?? l.unit_cost), total: r2(l.line_total) })),
      totals: { total: sumBy(lines, "line_total") } },
      ...(pays.length ? [{ title: "payments", columns: [col("date", "date"), col("method"), col("reference"), col("amount", "money")],
        rows: pays.map((x) => ({ date: day(x.paid_at), method: x.method, reference: x.reference || "", amount: r2(x.amount) })), totals: { amount: sumBy(pays, "amount") } }] : [])] };
});
add("expense_details", "individual", "documents", "expenses.view", [...RANGE, "branch"], async (req, f) => {
  const [rows] = await pool.query(
    `SELECT e.expense_date, e.category, e.amount, e.method, e.description, u.full_name user FROM expenses e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.business_id = ? AND e.expense_date BETWEEN ? AND ?${bsql(f, "e")} ORDER BY e.expense_date, e.id`, [req.business.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.expense_date), category: r.category, description: r.description || "", method: r.method, by: r.user || "", amount: r2(r.amount) }));
  return { period: { from: f.from, to: f.to }, stats: [{ key: "expenses", value: shaped.length, type: "int" }, { key: "total", value: sumBy(shaped, "amount"), type: "money" }],
    sections: [{ columns: [col("date", "date"), col("category"), col("description"), col("method"), col("by"), col("amount", "money")], rows: shaped, totals: { amount: sumBy(shaped, "amount") } }] };
});
add("payment_records", "individual", "documents", "reports.view", [...RANGE, "method"], async (req, f) => {
  const m = f.method ? " AND method = ?" : "";
  const [rows] = await pool.query(
    `SELECT * FROM (SELECT cp.paid_at at, 'in' direction, c.name party, cp.method, cp.reference, cp.amount FROM customer_payments cp LEFT JOIN customers c ON c.id = cp.customer_id
        WHERE cp.business_id = ?${between("cp.paid_at")}${m.replace("method", "cp.method")}
      UNION ALL SELECT sp.paid_at, 'out', s.name, sp.method, sp.reference, sp.amount FROM supplier_payments sp LEFT JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.business_id = ?${between("sp.paid_at")}${m.replace("method", "sp.method")}) x ORDER BY at`,
    [req.business.id, f.from, f.to, ...(f.method ? [f.method] : []), req.business.id, f.from, f.to, ...(f.method ? [f.method] : [])]);
  const shaped = rows.map((r) => ({ date: day(r.at), direction: r.direction, party: r.party || "—", method: r.method, reference: r.reference || "", in: r.direction === "in" ? r2(r.amount) : null, out: r.direction === "out" ? r2(r.amount) : null }));
  const tin = r2(shaped.reduce((s, x) => s + (x.in || 0), 0)), tout = r2(shaped.reduce((s, x) => s + (x.out || 0), 0));
  return { period: { from: f.from, to: f.to }, stats: [{ key: "received", value: tin, type: "money" }, { key: "paidOut", value: tout, type: "money" }, { key: "net", value: r2(tin - tout), type: "money" }],
    sections: [{ columns: [col("date", "date"), col("party"), col("method"), col("reference"), col("in", "money"), col("out", "money")], rows: shaped, totals: { in: tin, out: tout } }] };
});
add("branch_report", "individual", "branches", "reports.view", ["branch", ...RANGE], async (req, f) => {
  if (!f.branch) throw badRequest({ branch: "required" });
  const b = (req.branch.list || []).find((x) => x.id === f.branch);
  const fig = await figures(req, { ...f });
  const [top] = await pool.query(
    `SELECT p.name, SUM(si.qty) qty, SUM(si.line_total) rev FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
      WHERE si.business_id = ? AND s.status <> 'cancelled'${between("s.sold_at")}${bsql(f, "s")} GROUP BY p.id ORDER BY rev DESC LIMIT 15`, [req.business.id, f.from, f.to]);
  return { subject: b?.name, period: { from: f.from, to: f.to }, stats: figureStats(req, fig),
    sections: [{ title: "topProducts", columns: [col("product"), col("qty", "qty"), col("revenue", "money")], rows: top.map((x) => ({ product: x.name, qty: r4(x.qty), revenue: r2(x.rev) })), totals: { revenue: sumBy(top, "rev") } }] };
});

/* ---------- shared figures (sales, invoices, purchases, expenses, gross / net) for a period and branch ---------- */
async function figures(req, f) {
  const bid = req.business.id;
  const [[s]] = await pool.query(`SELECT COUNT(*) n, COALESCE(SUM(s.total - s.vat_amount), 0) rev, COALESCE(SUM(${SALE_COST}), 0) cost FROM sales s WHERE s.business_id = ? AND s.status <> 'cancelled'${between("s.sold_at")}${bsql(f, "s")}`, [bid, f.from, f.to]);
  const [[i]] = await pool.query(`SELECT COUNT(*) n, COALESCE(SUM(i.total - i.vat_amount), 0) rev, COALESCE(SUM(${INV_COST}), 0) cost FROM invoices i WHERE i.business_id = ? AND i.status NOT IN ('draft','cancelled')${between("i.issue_date")}${bsql(f, "i")}`, [bid, f.from, f.to]);
  const [[p]] = await pool.query(`SELECT COUNT(*) n, COALESCE(SUM(p.total), 0) t FROM purchases p WHERE p.business_id = ? AND p.status IN ('received','partial','returned')${between("COALESCE(p.received_at, p.purchased_at)")}${bsql(f, "p")}`, [bid, f.from, f.to]);
  const [[e]] = await pool.query(`SELECT COALESCE(SUM(e.amount), 0) t FROM expenses e WHERE e.business_id = ? AND e.expense_date BETWEEN ? AND ?${bsql(f, "e")}`, [bid, f.from, f.to]);
  const [[o]] = await pool.query(`SELECT COALESCE(SUM(o.amount), 0) t FROM other_income o WHERE o.business_id = ? AND o.income_date BETWEEN ? AND ?${bsql(f, "o")}`, [bid, f.from, f.to]);
  const [[r]] = await pool.query(`SELECT COALESCE(SUM(r.total), 0) t, COALESCE(SUM((SELECT COALESCE(SUM(ri.qty * COALESCE(ri.unit_cost, 0)), 0) FROM return_items ri WHERE ri.return_id = r.id)), 0) c
    FROM returns r WHERE r.business_id = ? AND r.type IN ('sale','invoice')${between("r.returned_at")}`, [bid, f.from, f.to]);
  const revenue = r2(num(s.rev) + num(i.rev) - num(r.t)), cost = r2(num(s.cost) + num(i.cost) - num(r.c));
  return { sales: Number(s.n), salesRevenue: r2(s.rev), invoices: Number(i.n), invoiceRevenue: r2(i.rev), returns: r2(r.t), revenue, cost, gross: r2(revenue - cost),
    purchases: Number(p.n), purchased: r2(p.t), expenses: r2(e.t), otherIncome: r2(o.t), net: r2(revenue - cost - num(e.t) + num(o.t)) };
}
const figureStats = (req, x) => [{ key: "salesCount", value: x.sales, type: "int" }, { key: "revenue", value: x.revenue, type: "money" },
  ...(can(req.user, "costs.view") ? [{ key: "grossProfit", value: x.gross, type: "money" }] : []), { key: "expenses", value: x.expenses, type: "money" },
  { key: "purchased", value: x.purchased, type: "money" }, ...(can(req.user, "costs.view") ? [{ key: "netProfit", value: x.net, type: "money" }] : [])];

/* ===================== SUMMARY: business ===================== */
const PERIOD_SQL = { day: "%Y-%m-%d", week: "%x-W%v", month: "%Y-%m", year: "%Y" };
add("business_summary", "summary", "business", "reports.view", [...RANGE, "granularity", "branch"], async (req, f) => {
  const bid = req.business.id;
  const fmt = PERIOD_SQL[f.granularity];
  const costs = can(req.user, "costs.view");
  const q = async (sql, params) => { const [rows] = await pool.query(sql, params); return new Map(rows.map((x) => [x.k, x])); };
  const sales = await q(`SELECT DATE_FORMAT(s.sold_at, '${fmt}') k, COUNT(*) n, SUM(s.total - s.vat_amount) rev, SUM(${SALE_COST}) cost FROM sales s WHERE s.business_id = ? AND s.status <> 'cancelled'${between("s.sold_at")}${bsql(f, "s")} GROUP BY k`, [bid, f.from, f.to]);
  const invs = await q(`SELECT DATE_FORMAT(i.issue_date, '${fmt}') k, COUNT(*) n, SUM(i.total - i.vat_amount) rev, SUM(${INV_COST}) cost FROM invoices i WHERE i.business_id = ? AND i.status NOT IN ('draft','cancelled')${between("i.issue_date")}${bsql(f, "i")} GROUP BY k`, [bid, f.from, f.to]);
  const purch = await q(`SELECT DATE_FORMAT(COALESCE(p.received_at, p.purchased_at), '${fmt}') k, SUM(p.total) t FROM purchases p WHERE p.business_id = ? AND p.status IN ('received','partial','returned')${between("COALESCE(p.received_at, p.purchased_at)")}${bsql(f, "p")} GROUP BY k`, [bid, f.from, f.to]);
  const exp = await q(`SELECT DATE_FORMAT(e.expense_date, '${fmt}') k, SUM(e.amount) t FROM expenses e WHERE e.business_id = ? AND e.expense_date BETWEEN ? AND ?${bsql(f, "e")} GROUP BY k`, [bid, f.from, f.to]);
  const other = await q(`SELECT DATE_FORMAT(o.income_date, '${fmt}') k, SUM(o.amount) t FROM other_income o WHERE o.business_id = ? AND o.income_date BETWEEN ? AND ?${bsql(f, "o")} GROUP BY k`, [bid, f.from, f.to]);
  const keys = [...new Set([...sales.keys(), ...invs.keys(), ...purch.keys(), ...exp.keys(), ...other.keys()])].sort();
  const rows = keys.map((k) => {
    const s = sales.get(k) || {}, i = invs.get(k) || {};
    const revenue = r2(num(s.rev) + num(i.rev)), cost = r2(num(s.cost) + num(i.cost)), expenses = r2(exp.get(k)?.t), otherIncome = r2(other.get(k)?.t);
    // the same formula as the figures above the table: revenue - cost of goods - expenses + other income
    return { period: k, sales: Number(s.n || 0), invoices: Number(i.n || 0), revenue, ...(costs ? { cost, gross: r2(revenue - cost) } : {}), purchases: r2(purch.get(k)?.t), expenses, otherIncome, ...(costs ? { net: r2(revenue - cost - expenses + otherIncome) } : {}) };
  });
  const fig = await figures(req, f);
  return { period: { from: f.from, to: f.to }, stats: figureStats(req, fig),
    sections: [{ columns: [col("period"), col("sales", "int"), col("invoices", "int"), col("revenue", "money"), ...(costs ? [col("cost", "money"), col("gross", "money")] : []), col("purchases", "money"), col("expenses", "money"), col("otherIncome", "money"), ...(costs ? [col("net", "money")] : [])],
      rows, totals: { sales: rows.reduce((s, x) => s + x.sales, 0), invoices: rows.reduce((s, x) => s + x.invoices, 0), revenue: sumBy(rows, "revenue"), ...(costs ? { cost: sumBy(rows, "cost"), gross: sumBy(rows, "gross"), net: sumBy(rows, "net") } : {}), purchases: sumBy(rows, "purchases"), expenses: sumBy(rows, "expenses"), otherIncome: sumBy(rows, "otherIncome") } }] };
});
add("profit_loss", "summary", "business", "reports.view", [...RANGE, "branch"], async (req, f) => {
  const fig = await figures(req, f);
  const [cats] = await pool.query(`SELECT e.category, SUM(e.amount) t FROM expenses e WHERE e.business_id = ? AND e.expense_date BETWEEN ? AND ?${bsql(f, "e")} GROUP BY e.category ORDER BY t DESC`, [req.business.id, f.from, f.to]);
  const rows = [
    { line: "salesRevenue", amount: fig.salesRevenue }, { line: "invoiceRevenue", amount: fig.invoiceRevenue }, { line: "returns", amount: fig.returns ? -fig.returns : null },
    { line: "totalRevenue", amount: fig.revenue, _strong: true }, { line: "costOfGoods", amount: -fig.cost }, { line: "grossProfit", amount: fig.gross, _strong: true },
    ...cats.map((c) => ({ line: `expense:${c.category}`, amount: -r2(c.t) })), { line: "otherIncome", amount: fig.otherIncome || null },
    { line: "netProfit", amount: fig.net, _strong: true }];
  return { period: { from: f.from, to: f.to }, stats: figureStats(req, fig),
    sections: [{ columns: [col("line"), col("amount", "money")], rows: rows.filter((x) => x.amount !== null) }] };
}, { costs: true });

/* ===================== SUMMARY: customers & suppliers ===================== */
for (const kind of ["customer", "supplier"]) {
  const isC = kind === "customer";
  add(`${kind}_directory`, "summary", `${kind}s`, `${kind}s.view`, [], async (req) => {
    const bid = req.business.id;
    const [rows] = isC
      ? await pool.query(`SELECT c.name, c.phone, c.email, c.address,
          (SELECT COALESCE(SUM(total), 0) FROM sales WHERE business_id = c.business_id AND customer_id = c.id AND status = 'completed') + (SELECT COALESCE(SUM(total), 0) FROM invoices WHERE business_id = c.business_id AND customer_id = c.id AND status NOT IN ('draft','cancelled')) bought
          FROM customers c WHERE c.business_id = ? ORDER BY c.name`, [bid])
      : await pool.query(`SELECT s.name, s.phone, s.email, s.address, (SELECT COALESCE(SUM(total), 0) FROM purchases WHERE business_id = s.business_id AND supplier_id = s.id AND status IN ('received','partial','returned')) bought
          FROM suppliers s WHERE s.business_id = ? ORDER BY s.name`, [bid]);
    const open = byParty(shapeDocs(await openDocs(bid, kind)));
    const bal = new Map(open.map((p) => [p.name, p.balance]));
    const shaped = rows.map((r) => ({ name: r.name, phone: r.phone || "", email: r.email || "", address: r.address || "", [isC ? "bought" : "purchased"]: r2(r.bought), balance: bal.get(r.name) || null }));
    return { stats: [{ key: isC ? "customers" : "suppliers", value: shaped.length, type: "int" }, { key: "outstanding", value: sumBy(open, "balance"), type: "money" }],
      sections: [{ columns: [col("name"), col("phone"), col("email"), col("address"), col(isC ? "bought" : "purchased", "money"), col("balance", "money")], rows: shaped,
        totals: { [isC ? "bought" : "purchased"]: sumBy(shaped, isC ? "bought" : "purchased"), balance: sumBy(open, "balance") } }] };
  });
  add(`${kind}_balances`, "summary", `${kind}s`, `${kind}s.view`, [], async (req) => {
    const docs = shapeDocs(await openDocs(req.business.id, kind));
    const parties = byParty(docs);
    return { stats: [{ key: "outstanding", value: sumBy(parties, "balance"), type: "money" }, { key: "overdue", value: sumBy(parties, "overdue"), type: "money" }, { key: isC ? "customers" : "suppliers", value: parties.length, type: "int" }],
      sections: [{ columns: [col("name"), col("documents", "int"), col("original", "money"), col("paid", "money"), col("remaining", "money"), col("overdue", "money"), col("oldest", "date")],
        rows: parties.map((p) => ({ name: p.name, documents: p.documents, original: p.total, paid: p.paid, remaining: p.balance, overdue: p.overdue || null, oldest: p.oldest })),
        totals: { original: sumBy(parties, "total"), paid: sumBy(parties, "paid"), remaining: sumBy(parties, "balance"), overdue: sumBy(parties, "overdue") } },
      { title: "aging", columns: [col("bucket"), col("amount", "money")], rows: aging(docs) }] };
  });
}
add("customer_performance", "summary", "customers", "customers.view", [...RANGE, "branch"], async (req, f) => {
  const [rows] = await pool.query(
    `SELECT c.name, COUNT(*) docs, SUM(x.total) total, SUM(x.paid) paid, MAX(x.at) last FROM (
       SELECT s.customer_id cid, s.total, s.amount_paid paid, s.sold_at at FROM sales s WHERE s.business_id = ? AND s.status = 'completed' AND s.customer_id IS NOT NULL${between("s.sold_at")}${bsql(f, "s")}
       UNION ALL SELECT i.customer_id, i.total, i.amount_paid, i.issue_date FROM invoices i WHERE i.business_id = ? AND i.status NOT IN ('draft','cancelled') AND i.customer_id IS NOT NULL${between("i.issue_date")}${bsql(f, "i")}
     ) x JOIN customers c ON c.id = x.cid GROUP BY c.id ORDER BY total DESC`, [req.business.id, f.from, f.to, req.business.id, f.from, f.to]);
  const all = sumBy(rows, "total");
  const shaped = rows.map((r, n) => ({ rank: n + 1, name: r.name, documents: Number(r.docs), total: r2(r.total), average: r2(num(r.total) / Number(r.docs)), paid: r2(r.paid), share: all ? r2((num(r.total) / all) * 100) : null, last: day(r.last) }));
  return { period: { from: f.from, to: f.to }, stats: [{ key: "customers", value: shaped.length, type: "int" }, { key: "total", value: all, type: "money" }],
    sections: [{ columns: [col("rank", "int"), col("name"), col("documents", "int"), col("total", "money"), col("average", "money"), col("paid", "money"), col("share", "pct"), col("last", "date")], rows: shaped, totals: { total: all, paid: sumBy(shaped, "paid") } }] };
});
add("supplier_performance", "summary", "suppliers", "suppliers.view", [...RANGE, "branch"], async (req, f) => {
  const [rows] = await pool.query(
    `SELECT s.name, COUNT(*) n, SUM(p.total) total, SUM(p.amount_paid) paid, MAX(p.purchased_at) last,
            (SELECT COALESCE(SUM(r.total), 0) FROM returns r JOIN purchases p2 ON p2.id = r.purchase_id WHERE r.business_id = s.business_id AND p2.supplier_id = s.id${between("r.returned_at")}) returned
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.business_id = ? AND p.status IN ('received','partial','returned')${between("p.purchased_at")}${bsql(f, "p")} GROUP BY s.id ORDER BY total DESC`,
    [f.from, f.to, req.business.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ name: r.name, purchases: Number(r.n), total: r2(r.total), paid: r2(r.paid), returned: num(r.returned) ? r2(r.returned) : null, last: day(r.last) }));
  return { period: { from: f.from, to: f.to }, stats: [{ key: "suppliers", value: shaped.length, type: "int" }, { key: "total", value: sumBy(shaped, "total"), type: "money" }],
    sections: [{ columns: [col("name"), col("purchases", "int"), col("total", "money"), col("paid", "money"), col("returned", "money"), col("last", "date")], rows: shaped, totals: { total: sumBy(shaped, "total"), paid: sumBy(shaped, "paid") } }] };
});

/* ===================== SUMMARY: products & inventory ===================== */
const STOCK_STATUS = "CASE WHEN p.stock_qty <= 0 THEN 'out' WHEN p.stock_qty <= p.min_stock THEN 'low' ELSE 'in' END";
async function productRows(req, f, extraWhere = "") {
  const cat = f.category ? ` AND p.category_id = ${Number(f.category)}` : "";
  const st = f.stockStatus ? ` AND ${STOCK_STATUS} = '${f.stockStatus}'` : "";
  // a branch: its own stock (its locations); otherwise all locations
  const qty = f.branch ? `(SELECT COALESCE(SUM(ps.qty), 0) FROM product_stock ps JOIN stock_locations l ON l.id = ps.location_id WHERE ps.product_id = p.id AND l.branch_id = ${Number(f.branch)})` : "p.stock_qty";
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.sku, p.unit, p.selling_price, p.wholesale_price, p.cost_price, ${qty} stock, p.min_stock, c.name category, b.name brand, ${STOCK_STATUS} status
       FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.business_id = ? AND p.is_active = 1${cat}${st}${extraWhere} ORDER BY c.name, p.name`, [req.business.id]);
  return rows;
}
add("product_catalog", "summary", "products", "products.view", ["category"], async (req, f) => {
  const costs = can(req.user, "costs.view");
  const rows = await productRows(req, f);
  return { stats: [{ key: "products", value: rows.length, type: "int" }],
    sections: [{ columns: [col("name"), col("sku"), col("category"), col("brand"), col("unit"), col("price", "money"), col("wholesale", "money"), ...(costs ? [col("cost", "money")] : []), col("stock", "qty")],
      rows: rows.map((p) => ({ name: p.name, sku: p.sku || "", category: p.category || "—", brand: p.brand || "", unit: p.unit, price: r2(p.selling_price), wholesale: p.wholesale_price === null ? null : r2(p.wholesale_price), ...(costs ? { cost: r2(p.cost_price) } : {}), stock: r4(p.stock) })) }] };
});
add("inventory_valuation", "summary", "products", "costs.view", ["category", "branch"], async (req, f) => {
  const rows = (await productRows(req, f)).map((p) => ({ name: p.name, category: p.category || "—", stock: r4(p.stock), cost: r2(p.cost_price), value: r2(num(p.stock) * num(p.cost_price)), price: r2(p.selling_price), retail: r2(num(p.stock) * num(p.selling_price)) }));
  const cats = new Map();
  for (const r of rows) { const c = cats.get(r.category) || { category: r.category, products: 0, units: 0, value: 0, retail: 0 }; c.products++; c.units = r4(c.units + r.stock); c.value = r2(c.value + r.value); c.retail = r2(c.retail + r.retail); cats.set(r.category, c); }
  const value = sumBy(rows, "value"), retail = sumBy(rows, "retail");
  return { stats: [{ key: "products", value: rows.length, type: "int" }, { key: "units", value: r4(rows.reduce((s, x) => s + x.stock, 0)), type: "qty" }, { key: "stockValue", value, type: "money" }, { key: "retailValue", value: retail, type: "money" }, { key: "potentialProfit", value: r2(retail - value), type: "money" }],
    sections: [{ title: "byCategory", columns: [col("category"), col("products", "int"), col("units", "qty"), col("value", "money"), col("retail", "money")], rows: [...cats.values()], totals: { value, retail } },
      { title: "byProduct", columns: [col("name"), col("category"), col("stock", "qty"), col("cost", "money"), col("value", "money"), col("price", "money"), col("retail", "money")], rows, totals: { value, retail } }] };
});
for (const [key, status] of [["stock_summary", null], ["low_stock", "lowOut"]]) {
  add(key, "summary", "products", "stock.view", status ? ["category", "branch"] : ["category", "stockStatus", "branch"], async (req, f) => {
    const rows = (await productRows(req, f, status ? ` AND ${STOCK_STATUS} IN ('low','out')` : "")).map((p) => ({ name: p.name, sku: p.sku || "", category: p.category || "—", stock: r4(p.stock), minStock: r4(p.min_stock),
      toOrder: num(p.stock) < num(p.min_stock) ? r4(num(p.min_stock) - num(p.stock)) : null, unit: p.unit, status: p.status }));
    const count = (s) => rows.filter((r) => r.status === s).length;
    return { stats: [{ key: "products", value: rows.length, type: "int" }, { key: "inStock", value: count("in"), type: "int" }, { key: "lowStock", value: count("low"), type: "int" }, { key: "outOfStock", value: count("out"), type: "int" }],
      sections: [{ columns: [col("name"), col("sku"), col("category"), col("stock", "qty"), col("minStock", "qty"), ...(status ? [col("toOrder", "qty")] : []), col("unit"), col("status")], rows }] };
  });
}
async function productSales(req, f) {
  const [rows] = await pool.query(
    `SELECT p.id, p.name, c.name category, COALESCE(SUM(x.qty), 0) qty, COALESCE(SUM(x.rev), 0) rev, COALESCE(SUM(x.cost), 0) cost FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN (
         SELECT si.product_id pid, si.qty, si.line_total rev, si.qty * COALESCE(si.unit_cost, 0) cost FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE si.business_id = ? AND s.status <> 'cancelled'${between("s.sold_at")}${bsql(f, "s")}
         UNION ALL SELECT ii.product_id, ii.qty, ii.line_total, ii.qty * COALESCE(ii.unit_cost, 0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
          WHERE ii.business_id = ? AND i.status NOT IN ('draft','cancelled')${between("i.issue_date")}${bsql(f, "i")}
       ) x ON x.pid = p.id
      WHERE p.business_id = ? AND p.is_active = 1${f.category ? ` AND p.category_id = ${Number(f.category)}` : ""} GROUP BY p.id`,
    [req.business.id, f.from, f.to, req.business.id, f.from, f.to, req.business.id]);
  return rows.map((r) => ({ name: r.name, category: r.category || "—", qty: r4(r.qty), revenue: r2(r.rev), cost: r2(r.cost), profit: r2(num(r.rev) - num(r.cost)), margin: num(r.rev) ? r2(((num(r.rev) - num(r.cost)) / num(r.rev)) * 100) : null }));
}
add("best_selling", "summary", "products", "sales.view", [...RANGE, "category", "branch", "limit"], async (req, f) => {
  const all = await productSales(req, f);
  const best = [...all].filter((x) => x.qty > 0).sort((a, b) => b.revenue - a.revenue).slice(0, f.limit);
  const least = [...all].sort((a, b) => a.qty - b.qty || a.revenue - b.revenue).slice(0, f.limit);
  const cols = [col("rank", "int"), col("name"), col("category"), col("qty", "qty"), col("revenue", "money")];
  return { period: { from: f.from, to: f.to }, stats: [{ key: "productsSold", value: all.filter((x) => x.qty > 0).length, type: "int" }, { key: "notSold", value: all.filter((x) => x.qty === 0).length, type: "int" }, { key: "revenue", value: sumBy(all, "revenue"), type: "money" }],
    sections: [{ title: "bestSelling", columns: cols, rows: best.map((x, n) => ({ ...x, rank: n + 1 })) }, { title: "leastSelling", columns: cols, rows: least.map((x, n) => ({ ...x, rank: n + 1 })) }] };
});
add("product_profit_comparison", "summary", "products", "costs.view", [...RANGE, "category", "branch"], async (req, f) => {
  const rows = (await productSales(req, f)).filter((x) => x.qty > 0).sort((a, b) => b.profit - a.profit);
  const rev = sumBy(rows, "revenue"), cost = sumBy(rows, "cost");
  return { period: { from: f.from, to: f.to }, stats: [{ key: "revenue", value: rev, type: "money" }, { key: "cost", value: cost, type: "money" }, { key: "profit", value: r2(rev - cost), type: "money" }, { key: "margin", value: rev ? r2(((rev - cost) / rev) * 100) : null, type: "pct" }],
    sections: [{ columns: [col("name"), col("category"), col("qty", "qty"), col("revenue", "money"), col("cost", "money"), col("profit", "money"), col("margin", "pct")], rows, totals: { revenue: rev, cost, profit: r2(rev - cost), margin: rev ? r2(((rev - cost) / rev) * 100) : null } }] };
});
add("stock_movement_summary", "summary", "products", "stock.view", [...RANGE, "category", "branch"], async (req, f) => {
  const [rows] = await pool.query(
    `SELECT p.name, c.name category, m.type, SUM(m.qty_change) q FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock_locations l ON l.id = m.location_id
      WHERE m.business_id = ?${between("m.created_at")}${f.category ? ` AND p.category_id = ${Number(f.category)}` : ""}${f.branch ? ` AND l.branch_id = ${Number(f.branch)}` : ""} GROUP BY p.id, m.type ORDER BY p.name`,
    [req.business.id, f.from, f.to]);
  const by = new Map();
  for (const r of rows) {
    const x = by.get(r.name) || { name: r.name, category: r.category || "—", in: 0, out: 0, sold: 0, adjusted: 0 };
    const q = num(r.q);
    if (["sale", "invoice", "consumption"].includes(r.type)) x.sold = r4(x.sold - q);
    else if (["adjustment", "count", "damaged", "reversal"].includes(r.type)) x.adjusted = r4(x.adjusted + q);
    else if (q > 0) x.in = r4(x.in + q); else x.out = r4(x.out - q);
    by.set(r.name, x);
  }
  const list = [...by.values()].map((x) => ({ ...x, net: r4(x.in - x.out - x.sold + x.adjusted) }));
  return { period: { from: f.from, to: f.to }, stats: [{ key: "products", value: list.length, type: "int" }],
    sections: [{ columns: [col("name"), col("category"), col("in", "qty"), col("sold", "qty"), col("out", "qty"), col("adjusted", "qty"), col("net", "qty")], rows: list }] };
});

/* ===================== SUMMARY: sales & purchasing ===================== */
add("sales_summary", "summary", "sales", "sales.view", [...RANGE, "branch", "status"], async (req, f) => {
  const st = f.status === "cancelled" ? " AND s.status = 'cancelled'" : " AND s.status <> 'cancelled'";
  const [rows] = await pool.query(
    `SELECT DATE(s.sold_at) d, COUNT(*) n, SUM(s.subtotal) sub, SUM(s.discount) disc, SUM(s.vat_amount) vat, SUM(s.total) total, SUM(s.amount_paid) paid
       FROM sales s WHERE s.business_id = ?${st}${between("s.sold_at")}${bsql(f, "s")} GROUP BY d ORDER BY d`, [req.business.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.d), receipts: Number(r.n), subtotal: r2(r.sub), discount: r2(r.disc), vat: r2(r.vat), total: r2(r.total), paid: r2(r.paid), credit: r2(num(r.total) - num(r.paid)) }));
  const [[inv]] = await pool.query(`SELECT COUNT(*) n, COALESCE(SUM(i.total), 0) t FROM invoices i WHERE i.business_id = ? AND i.status NOT IN ('draft','cancelled')${between("i.issue_date")}${bsql(f, "i")}`, [req.business.id, f.from, f.to]);
  return { period: { from: f.from, to: f.to }, stats: [{ key: "receipts", value: shaped.reduce((s, x) => s + x.receipts, 0), type: "int" }, { key: "salesTotal", value: sumBy(shaped, "total"), type: "money" },
    { key: "invoices", value: Number(inv.n), type: "int" }, { key: "invoiceTotal", value: r2(inv.t), type: "money" }],
  sections: [{ columns: [col("date", "date"), col("receipts", "int"), col("subtotal", "money"), col("discount", "money"), col("vat", "money"), col("total", "money"), col("paid", "money"), col("credit", "money")], rows: shaped,
    totals: { receipts: shaped.reduce((s, x) => s + x.receipts, 0), subtotal: sumBy(shaped, "subtotal"), discount: sumBy(shaped, "discount"), vat: sumBy(shaped, "vat"), total: sumBy(shaped, "total"), paid: sumBy(shaped, "paid"), credit: sumBy(shaped, "credit") } }] };
});
add("sales_by_branch", "summary", "sales", "reports.view", RANGE, async (req, f) => {
  const [rows] = await pool.query(
    `SELECT b.name, (SELECT COUNT(*) FROM sales s WHERE s.business_id = b.business_id AND s.branch_id = b.id AND s.status <> 'cancelled'${between("s.sold_at")}) n,
            (SELECT COALESCE(SUM(total), 0) FROM sales s WHERE s.business_id = b.business_id AND s.branch_id = b.id AND s.status <> 'cancelled'${between("s.sold_at")}) st,
            (SELECT COALESCE(SUM(total), 0) FROM invoices i WHERE i.business_id = b.business_id AND i.branch_id = b.id AND i.status NOT IN ('draft','cancelled')${between("i.issue_date")}) it
       FROM branches b WHERE b.business_id = ?${req.branch?.filterId ? ` AND b.id = ${Number(req.branch.filterId)}` : ""} ORDER BY b.is_main DESC, b.name`, [f.from, f.to, f.from, f.to, f.from, f.to, req.business.id]);
  const all = rows.reduce((s, r) => s + num(r.st) + num(r.it), 0);
  const shaped = rows.map((r) => ({ branch: r.name, receipts: Number(r.n), salesTotal: r2(r.st), invoiceTotal: r2(r.it), total: r2(num(r.st) + num(r.it)), share: all ? r2(((num(r.st) + num(r.it)) / all) * 100) : null }));
  return { period: { from: f.from, to: f.to }, stats: [{ key: "total", value: r2(all), type: "money" }],
    sections: [{ columns: [col("branch"), col("receipts", "int"), col("salesTotal", "money"), col("invoiceTotal", "money"), col("total", "money"), col("share", "pct")], rows: shaped, totals: { salesTotal: sumBy(shaped, "salesTotal"), invoiceTotal: sumBy(shaped, "invoiceTotal"), total: r2(all) } }] };
});
add("sales_by_payment_method", "summary", "sales", "reports.view", RANGE, async (req, f) => {
  const [rows] = await pool.query(
    `SELECT cp.method, COUNT(*) n, SUM(cp.amount) t FROM customer_payments cp WHERE cp.business_id = ? AND cp.amount > 0${between("cp.paid_at")} GROUP BY cp.method ORDER BY t DESC`, [req.business.id, f.from, f.to]);
  const all = sumBy(rows, "t");
  return { period: { from: f.from, to: f.to }, stats: [{ key: "received", value: all, type: "money" }],
    sections: [{ columns: [col("method"), col("payments", "int"), col("amount", "money"), col("share", "pct")], rows: rows.map((r) => ({ method: r.method, payments: Number(r.n), amount: r2(r.t), share: all ? r2((num(r.t) / all) * 100) : null })), totals: { amount: all } }] };
});
add("purchasing_summary", "summary", "purchasing", "purchases.view", [...RANGE, "branch", "status"], async (req, f) => {
  const st = f.status ? " AND p.status = ?" : " AND p.status NOT IN ('cancelled','draft')";
  const [rows] = await pool.query(
    `SELECT p.purchase_no, p.purchased_at, s.name supplier, p.status, p.total, p.amount_paid FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.business_id = ?${st}${between("p.purchased_at")}${bsql(f, "p")} ORDER BY p.purchased_at`, [req.business.id, ...(f.status ? [f.status] : []), f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.purchased_at), reference: r.purchase_no, supplier: r.supplier || "—", status: r.status, total: r2(r.total), paid: r2(r.amount_paid), balance: r2(num(r.total) - num(r.amount_paid)) }));
  return { period: { from: f.from, to: f.to }, stats: [{ key: "purchases", value: shaped.length, type: "int" }, { key: "total", value: sumBy(shaped, "total"), type: "money" }, { key: "balance", value: sumBy(shaped, "balance"), type: "money" }],
    sections: [{ columns: [col("date", "date"), col("reference"), col("supplier"), col("status"), col("total", "money"), col("paid", "money"), col("balance", "money")], rows: shaped, totals: { total: sumBy(shaped, "total"), paid: sumBy(shaped, "paid"), balance: sumBy(shaped, "balance") } }] };
});
add("purchase_returns", "summary", "purchasing", "purchases.view", RANGE, async (req, f) => {
  const [rows] = await pool.query(
    `SELECT r.returned_at, r.total, r.reason, p.purchase_no, s.name supplier FROM returns r LEFT JOIN purchases p ON p.id = r.purchase_id LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE r.business_id = ? AND r.type IN ('purchase','purchase_return')${between("r.returned_at")} ORDER BY r.returned_at`, [req.business.id, f.from, f.to]);
  const shaped = rows.map((r) => ({ date: day(r.returned_at), reference: r.purchase_no || "—", supplier: r.supplier || "—", reason: r.reason || "", total: r2(r.total) }));
  return { period: { from: f.from, to: f.to }, stats: [{ key: "returns", value: shaped.length, type: "int" }, { key: "total", value: sumBy(shaped, "total"), type: "money" }],
    sections: [{ columns: [col("date", "date"), col("reference"), col("supplier"), col("reason"), col("total", "money")], rows: shaped, totals: { total: sumBy(shaped, "total") } }] };
});

/* ===================== SUMMARY: accounting & finance (the books) ===================== */
const acc = (key, filters, run, advanced = false) => add(key, "summary", "finance", "accounting.view", filters, run, { accounting: true, advanced });
const accountRows = (rows) => rows.filter((r) => Math.abs(r.balance) > 0.004).map((r) => ({ code: r.code, account: r.name, amount: r.balance }));
acc("income_statement", [...RANGE, "branch"], async (req, f) => {
  const rows = await balances(req.business.id, { from: f.from, to: f.to, branch: f.branch });
  const rev = sumType(rows, "revenue"), cogs = sumType(rows, "cogs"), exp = sumType(rows, "expense");
  const cols = [col("code"), col("account"), col("amount", "money")];
  return { period: { from: f.from, to: f.to }, stats: [{ key: "revenue", value: rev, type: "money" }, { key: "grossProfit", value: r2(rev - cogs), type: "money" }, { key: "expenses", value: exp, type: "money" }, { key: "netProfit", value: r2(rev - cogs - exp), type: "money" }],
    sections: [{ title: "revenue", columns: cols, rows: accountRows(rows.filter((r) => r.type === "revenue")), totals: { amount: rev } },
      { title: "costOfGoods", columns: cols, rows: accountRows(rows.filter((r) => r.type === "cogs")), totals: { amount: cogs } },
      { title: "expenses", columns: cols, rows: accountRows(rows.filter((r) => r.type === "expense")), totals: { amount: exp } }] };
});
acc("balance_sheet", ["to"], async (req, f) => {
  const rows = await balances(req.business.id, { to: f.to });
  const profit = r2(sumType(rows, "revenue") - sumType(rows, "cogs", "expense"));
  const cols = [col("code"), col("account"), col("amount", "money")];
  const a = sumType(rows, "asset"), l = sumType(rows, "liability"), e = r2(sumType(rows, "equity") + profit);
  return { asAt: f.to, stats: [{ key: "assets", value: a, type: "money" }, { key: "liabilities", value: l, type: "money" }, { key: "equity", value: e, type: "money" }, { key: "balanced", value: Math.abs(a - l - e) < 0.01 ? "yes" : "no" }],
    sections: [{ title: "assets", columns: cols, rows: accountRows(rows.filter((r) => r.type === "asset")), totals: { amount: a } },
      { title: "liabilities", columns: cols, rows: accountRows(rows.filter((r) => r.type === "liability")), totals: { amount: l } },
      { title: "equity", columns: cols, rows: [...accountRows(rows.filter((r) => r.type === "equity")), { code: "", account: "profitToDate", amount: profit }], totals: { amount: e } }] };
}, true);
acc("trial_balance", ["to"], async (req, f) => {
  const rows = (await balances(req.business.id, { to: f.to })).filter((r) => Math.abs(r.debit) > 0.004 || Math.abs(r.credit) > 0.004)
    .map((r) => { const net = r2(r.debit - r.credit); return { code: r.code, account: r.name, debit: net > 0 ? net : null, credit: net < 0 ? -net : null }; });
  return { asAt: f.to, sections: [{ columns: [col("code"), col("account"), col("debit", "money"), col("credit", "money")], rows, totals: { debit: sumBy(rows, "debit"), credit: sumBy(rows, "credit") } }] };
}, true);
acc("general_ledger", ["account", ...RANGE], async (req, f) => {
  if (!f.account) throw badRequest({ account: "required" });
  const [[a]] = await pool.query("SELECT id, code, name, type FROM acc_accounts WHERE id = ? AND business_id = ?", [f.account, req.business.id]);
  if (!a) throw badRequest({ account: "required" });
  const debitNormal = ["asset", "cogs", "expense"].includes(a.type);
  const [[op]] = await pool.query("SELECT COALESCE(SUM(debit - credit), 0) b FROM acc_lines WHERE account_id = ? AND entry_date < ?", [a.id, f.from]);
  const [lines] = await pool.query(`SELECT l.entry_date, l.debit, l.credit, e.reference, e.description FROM acc_lines l JOIN acc_entries e ON e.id = l.entry_id WHERE l.account_id = ? AND l.entry_date BETWEEN ? AND ? ORDER BY l.entry_date, l.id`, [a.id, f.from, f.to]);
  let bal = debitNormal ? num(op.b) : -num(op.b);
  const rows = lines.map((l) => { bal += debitNormal ? num(l.debit) - num(l.credit) : num(l.credit) - num(l.debit); return { date: day(l.entry_date), reference: l.reference || "", description: l.description || "", debit: num(l.debit) ? r2(l.debit) : null, credit: num(l.credit) ? r2(l.credit) : null, balance: r2(bal) }; });
  return { subject: `${a.code} · ${a.name}`, period: { from: f.from, to: f.to }, stats: [{ key: "opening", value: r2(debitNormal ? op.b : -op.b), type: "money" }, { key: "closing", value: r2(bal), type: "money" }],
    sections: [{ columns: [col("date", "date"), col("reference"), col("description"), col("debit", "money"), col("credit", "money"), col("balance", "money")], rows, totals: { debit: sumBy(rows, "debit"), credit: sumBy(rows, "credit"), balance: r2(bal) } }] };
}, true);
acc("cash_flow", RANGE, async (req, f) => {
  const [rows] = await pool.query(`SELECT ref_type, direction, SUM(amount) a FROM cash_transactions WHERE business_id = ? AND DATE(occurred_at) BETWEEN ? AND ? AND ref_type <> 'transfer' GROUP BY ref_type, direction`, [req.business.id, f.from, f.to]);
  const [[open]] = await pool.query(`SELECT COALESCE(SUM(IF(direction = 'in', amount, -amount)), 0) b FROM cash_transactions WHERE business_id = ? AND DATE(occurred_at) < ?`, [req.business.id, f.from]);
  const FIN = ["adjustment", "opening"];
  const line = (r) => ({ line: `${r.ref_type}:${r.direction}`, amount: r2(r.direction === "in" ? r.a : -r.a) });
  const op = rows.filter((r) => !FIN.includes(r.ref_type)).map(line), fin = rows.filter((r) => FIN.includes(r.ref_type)).map(line);
  const opT = sumBy(op, "amount"), finT = sumBy(fin, "amount");
  return { period: { from: f.from, to: f.to }, stats: [{ key: "opening", value: r2(open.b), type: "money" }, { key: "operating", value: opT, type: "money" }, { key: "financing", value: finT, type: "money" }, { key: "closing", value: r2(num(open.b) + opT + finT), type: "money" }],
    sections: [{ title: "operating", columns: [col("line"), col("amount", "money")], rows: op, totals: { amount: opT } },
      { title: "financing", columns: [col("line"), col("amount", "money")], rows: fin, totals: { amount: finT } }] };
});
acc("receivables_payables", [], async (req) => {
  const c = byParty(shapeDocs(await openDocs(req.business.id, "customer"))), s = byParty(shapeDocs(await openDocs(req.business.id, "supplier")));
  const cols = [col("name"), col("documents", "int"), col("remaining", "money"), col("overdue", "money")];
  const map = (p) => ({ name: p.name, documents: p.documents, remaining: p.balance, overdue: p.overdue || null });
  return { stats: [{ key: "receivable", value: sumBy(c, "balance"), type: "money" }, { key: "payable", value: sumBy(s, "balance"), type: "money" }, { key: "net", value: r2(sumBy(c, "balance") - sumBy(s, "balance")), type: "money" }],
    sections: [{ title: "receivable", columns: cols, rows: c.map(map), totals: { remaining: sumBy(c, "balance"), overdue: sumBy(c, "overdue") } },
      { title: "payable", columns: cols, rows: s.map(map), totals: { remaining: sumBy(s, "balance") } }] };
});
add("expense_analysis", "summary", "finance", "expenses.view", [...RANGE, "branch"], async (req, f) => {
  const [rows] = await pool.query(`SELECT e.category, COUNT(*) n, SUM(e.amount) t, MAX(e.amount) mx FROM expenses e WHERE e.business_id = ? AND e.expense_date BETWEEN ? AND ?${bsql(f, "e")} GROUP BY e.category ORDER BY t DESC`, [req.business.id, f.from, f.to]);
  const [months] = await pool.query(`SELECT DATE_FORMAT(e.expense_date, '%Y-%m') m, SUM(e.amount) t FROM expenses e WHERE e.business_id = ? AND e.expense_date BETWEEN ? AND ?${bsql(f, "e")} GROUP BY m ORDER BY m`, [req.business.id, f.from, f.to]);
  const all = sumBy(rows, "t");
  return { period: { from: f.from, to: f.to }, stats: [{ key: "total", value: all, type: "money" }, { key: "categories", value: rows.length, type: "int" }],
    sections: [{ title: "byCategory", columns: [col("category"), col("entries", "int"), col("amount", "money"), col("largest", "money"), col("share", "pct")],
      rows: rows.map((r) => ({ category: r.category, entries: Number(r.n), amount: r2(r.t), largest: r2(r.mx), share: all ? r2((num(r.t) / all) * 100) : null })), totals: { amount: all } },
    { title: "byMonth", columns: [col("month"), col("amount", "money")], rows: months.map((x) => ({ month: x.m, amount: r2(x.t) })), totals: { amount: all } }] };
});

/* ===================== SUMMARY: branches ===================== */
add("branch_performance", "summary", "branches", "reports.view", RANGE, async (req, f) => {
  const list = req.branch?.list || [];
  const rows = [];
  for (const b of list) {
    const x = await figures(req, { ...f, branch: b.id });
    rows.push({ branch: b.name, sales: x.sales + x.invoices, revenue: x.revenue, ...(can(req.user, "costs.view") ? { gross: x.gross } : {}), purchases: x.purchased, expenses: x.expenses, ...(can(req.user, "costs.view") ? { net: x.net } : {}) });
  }
  const costs = can(req.user, "costs.view");
  return { period: { from: f.from, to: f.to }, stats: [{ key: "branches", value: rows.length, type: "int" }, { key: "revenue", value: sumBy(rows, "revenue"), type: "money" }],
    sections: [{ columns: [col("branch"), col("sales", "int"), col("revenue", "money"), ...(costs ? [col("gross", "money")] : []), col("purchases", "money"), col("expenses", "money"), ...(costs ? [col("net", "money")] : [])], rows,
      totals: { revenue: sumBy(rows, "revenue"), purchases: sumBy(rows, "purchases"), expenses: sumBy(rows, "expenses"), ...(costs ? { gross: sumBy(rows, "gross"), net: sumBy(rows, "net") } : {}) } }] };
});
add("branch_sales_comparison", "summary", "branches", "reports.view", RANGE, async (req, f) => {
  const list = req.branch?.list || [];
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(at, '%Y-%m') m, bid, SUM(t) t FROM (SELECT s.sold_at at, s.branch_id bid, s.total t FROM sales s WHERE s.business_id = ? AND s.status <> 'cancelled'${between("s.sold_at")}
       UNION ALL SELECT i.issue_date, i.branch_id, i.total FROM invoices i WHERE i.business_id = ? AND i.status NOT IN ('draft','cancelled')${between("i.issue_date")}) x GROUP BY m, bid ORDER BY m`,
    [req.business.id, f.from, f.to, req.business.id, f.from, f.to]);
  const months = [...new Set(rows.map((r) => r.m))];
  const shaped = months.map((m) => Object.fromEntries([["month", m], ...list.map((b) => [`b${b.id}`, r2(rows.find((r) => r.m === m && Number(r.bid) === b.id)?.t)])]));
  return { period: { from: f.from, to: f.to },
    sections: [{ columns: [col("month"), ...list.map((b) => col(`b${b.id}`, "money", { label: b.name }))], rows: shaped, totals: Object.fromEntries(list.map((b) => [`b${b.id}`, sumBy(shaped, `b${b.id}`)])) }] };
});
add("branch_inventory", "summary", "branches", "stock.view", [], async (req) => {
  const costs = can(req.user, "costs.view");
  const [rows] = await pool.query(
    `SELECT b.name branch, COUNT(DISTINCT l.id) locations, COUNT(DISTINCT IF(ps.qty > 0, ps.product_id, NULL)) items, COALESCE(SUM(ps.qty), 0) units, COALESCE(SUM(ps.qty * p.cost_price), 0) value, COALESCE(SUM(ps.qty * p.selling_price), 0) retail
       FROM branches b LEFT JOIN stock_locations l ON l.branch_id = b.id AND l.business_id = b.business_id LEFT JOIN product_stock ps ON ps.location_id = l.id LEFT JOIN products p ON p.id = ps.product_id
      WHERE b.business_id = ?${req.branch?.filterId ? ` AND b.id = ${Number(req.branch.filterId)}` : ""} GROUP BY b.id ORDER BY b.is_main DESC, b.name`, [req.business.id]);
  const shaped = rows.map((r) => ({ branch: r.branch, locations: Number(r.locations), items: Number(r.items), units: r4(r.units), ...(costs ? { value: r2(r.value) } : {}), retail: r2(r.retail) }));
  return { sections: [{ columns: [col("branch"), col("locations", "int"), col("items", "int"), col("units", "qty"), ...(costs ? [col("value", "money")] : []), col("retail", "money")], rows: shaped,
    totals: { units: r4(shaped.reduce((s, x) => s + x.units, 0)), ...(costs ? { value: sumBy(shaped, "value") } : {}), retail: sumBy(shaped, "retail") } }] };
});

/* ---------- who may run what ---------- */
async function available(req) {
  const off = req.business.disabledModules || [];
  const mode = (await accountingMode(req.business.id).catch(() => "simple"));
  const branches = (req.branch?.list || []).length;
  return Object.values(R).filter((r) => can(req.user, r.perm) && (!r.costs || can(req.user, "costs.view") || r.perm === "costs.view")
    && (!r.accounting || !off.includes("accounting")) && (!r.advanced || mode === "advanced")
    && (r.group !== "branches" || branches > 1 || r.key === "branch_report"));
}

router.get("/", ah(async (req, res) => {
  res.json({ reports: (await available(req)).map((r) => ({ key: r.key, category: r.category, group: r.group, filters: r.filters })),
    branches: req.branch?.fixed ? [] : (req.branch?.list || []) });
}));

/* pickers for the filters (only this business's records) */
router.get("/options", ah(async (req, res) => {
  const bid = req.business.id;
  const q = `%${text(req.query.q, 60)}%`;
  const kind = req.query.kind;
  const SQL = {
    customer: ["customers.view", "SELECT id, name, phone sub FROM customers WHERE business_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY name LIMIT 30", [bid, q, q]],
    supplier: ["suppliers.view", "SELECT id, name, phone sub FROM suppliers WHERE business_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY name LIMIT 30", [bid, q, q]],
    product: ["products.view", "SELECT id, name, sku sub FROM products WHERE business_id = ? AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?) ORDER BY is_active DESC, name LIMIT 30", [bid, q, q, q]],
    category: ["products.view", "SELECT id, name, NULL sub FROM categories WHERE business_id = ? AND name LIKE ? ORDER BY name LIMIT 100", [bid, q]],
    invoice: ["invoices.view", "SELECT i.id, i.invoice_no name, c.name sub FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.business_id = ? AND (i.invoice_no LIKE ? OR c.name LIKE ?) ORDER BY i.id DESC LIMIT 30", [bid, q, q]],
    purchase: ["purchases.view", "SELECT p.id, p.purchase_no name, s.name sub FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.business_id = ? AND (p.purchase_no LIKE ? OR s.name LIKE ?) ORDER BY p.id DESC LIMIT 30", [bid, q, q]],
    account: ["accounting.view", "SELECT id, CONCAT(code, ' · ', name) name, type sub FROM acc_accounts WHERE business_id = ? AND (code LIKE ? OR name LIKE ?) ORDER BY code LIMIT 100", [bid, q, q]]
  };
  if (kind === "branch") return res.json({ options: (req.branch?.list || []).map((b) => ({ id: b.id, name: b.name })) });
  const s = SQL[kind];
  if (!s) throw badRequest({ kind: "required" });
  if (kind === "account") await syncBooks(pool, bid);   // the chart of accounts is complete
  if (!can(req.user, s[0])) return res.status(403).json({ code: "forbidden" });
  const [rows] = await pool.query(s[1], s[2]);
  res.json({ options: rows.map((r) => ({ id: r.id, name: r.name, sub: r.sub || "" })) });
}));

router.get("/:key", ah(async (req, res) => {
  const r = (await available(req)).find((x) => x.key === req.params.key);
  if (!r) return res.status(403).json({ code: "forbidden" });
  const f = filtersOf(req);
  if (r.accounting) await syncBooks(pool, req.business.id);   // finance reports read books that are up to date
  const out = await r.run(req, f);
  const branch = f.branch ? (req.branch?.list || []).find((b) => b.id === f.branch)?.name : null;
  res.json({ key: r.key, category: r.category, group: r.group, generatedAt: new Date().toISOString(), branch, ...out });
}));

export default router;
