import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, text, num, badRequest } from "../lib/http.js";
import { productNameSql } from "../lib/productName.js";
import { branchSql } from "../lib/branches.js";

/*
 * Global search (Ctrl + K) and keyboard shortcuts.
 *   GET /api/search?q=       products, customers, suppliers, invoices, sales receipts, purchases, expenses and categories that
 *                            match, up to 6 of each — only the kinds the user may see; each result says where it opens
 *                            (business modules are matched in the app, which knows their names in the user's language)
 *   GET /api/search/shortcuts    the business's shortcut keys (null = the app's defaults)
 *   PUT /api/search/shortcuts    { shortcuts: { action: "Alt+S", … } } owner: change them
 */
const router = Router();
router.use(requireAuth);

const LIMIT = 6;
router.get("/", ah(async (req, res) => {
  const q = text(req.query.q, 80);
  if (q.length < 1) return res.json({ q, results: [] });
  const bid = req.business.id;
  const like = `%${q}%`;
  const B = branchSql(req);
  const tasks = [];
  const add = (kind, perm, sql, params, shape) => {
    if (perm && !can(req.user, perm)) return;
    tasks.push(pool.query(sql, params).then(([rows]) => rows.map((r) => ({ kind, ...shape(r) }))));
  };
  add("product", "products.view",
    `SELECT p.id, ${productNameSql("p")} name, p.sku, p.barcode, p.selling_price, p.stock_qty, p.unit FROM products p
      WHERE p.business_id = ? AND p.is_active = 1 AND (${productNameSql("p")} LIKE ? OR p.sku LIKE ? OR p.barcode = ?
        OR EXISTS (SELECT 1 FROM product_barcodes xb WHERE xb.product_id = p.id AND xb.barcode = ?))
      ORDER BY (p.sku = ? OR p.barcode = ?) DESC, p.name LIMIT ?`, [bid, like, like, q, q, q, q, LIMIT],
    (r) => ({ id: r.id, title: r.name, sub: [r.sku, r.barcode].filter(Boolean).join(" · "), price: num(r.selling_price), stock: num(r.stock_qty), unit: r.unit,
      to: `/app/m/products?q=${encodeURIComponent(r.sku || r.name)}` }));
  add("customer", "customers.view",
    `SELECT id, name, phone, email FROM customers WHERE business_id = ? AND (name LIKE ? OR phone LIKE ? OR email LIKE ?) ORDER BY name LIMIT ?`, [bid, like, like, like, LIMIT],
    (r) => ({ id: r.id, title: r.name, sub: [r.phone, r.email].filter(Boolean).join(" · "), to: `/app/m/customers?open=${r.id}` }));
  add("supplier", "suppliers.view",
    `SELECT id, name, phone FROM suppliers WHERE business_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY name LIMIT ?`, [bid, like, like, LIMIT],
    (r) => ({ id: r.id, title: r.name, sub: r.phone || "", to: `/app/m/suppliers?open=${r.id}` }));
  add("invoice", "invoices.view",
    `SELECT i.id, i.invoice_no, i.issue_date, i.total, i.status, c.name customer FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.business_id = ?${B("i")} AND (i.invoice_no LIKE ? OR c.name LIKE ?) ORDER BY i.issue_date DESC, i.id DESC LIMIT ?`, [bid, like, like, LIMIT],
    (r) => ({ id: r.id, title: r.invoice_no, sub: r.customer, date: r.issue_date, amount: num(r.total), status: r.status, to: `/app/invoices/${r.id}` }));
  add("sale", "sales.view",
    `SELECT s.id, s.receipt_no, s.sold_at, s.total, s.status, COALESCE(c.name, s.walkin_name, s.walkin_phone) who FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.business_id = ?${B("s")} AND (s.receipt_no LIKE ? OR c.name LIKE ? OR s.walkin_phone LIKE ? OR s.walkin_name LIKE ?) ORDER BY s.sold_at DESC LIMIT ?`, [bid, like, like, like, like, LIMIT],
    (r) => ({ id: r.id, title: r.receipt_no, sub: r.who || "", date: r.sold_at, amount: num(r.total), status: r.status, to: `/app/sales/${r.id}` }));
  add("purchase", "purchases.view",
    `SELECT p.id, p.purchase_no, p.purchased_at, p.total, p.status, s.name supplier FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.business_id = ?${B("p")} AND (p.purchase_no LIKE ? OR s.name LIKE ?) ORDER BY p.purchased_at DESC LIMIT ?`, [bid, like, like, LIMIT],
    (r) => ({ id: r.id, title: r.purchase_no, sub: r.supplier || "", date: r.purchased_at, amount: num(r.total), status: r.status, to: `/app/m/purchases?open=${r.id}` }));
  add("expense", "expenses.view",
    `SELECT id, category, description, amount, expense_date FROM expenses WHERE business_id = ?${B()} AND (description LIKE ? OR category LIKE ?) ORDER BY expense_date DESC LIMIT ?`, [bid, like, like, LIMIT],
    (r) => ({ id: r.id, title: r.description || r.category, sub: r.category, date: r.expense_date, amount: num(r.amount), to: "/app/m/expenses" }));
  add("category", "products.view",
    `SELECT c.id, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) n FROM categories c WHERE c.business_id = ? AND c.name LIKE ? ORDER BY c.name LIMIT ?`, [bid, like, LIMIT],
    (r) => ({ id: r.id, title: r.name, count: Number(r.n), to: `/app/m/products?categoryId=${r.id}` }));
  const groups = await Promise.all(tasks);
  res.json({ q, results: groups.flat() });
}));

/* ---------- keyboard shortcuts (the app holds the list of actions and their default keys) ---------- */
const KEY = /^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F([1-9]|1[0-2])|\/)$/;
router.get("/shortcuts", ah(async (req, res) => {
  const [[s]] = await pool.query("SELECT shortcuts FROM business_settings WHERE business_id = ?", [req.business.id]);
  let shortcuts = null;
  try { shortcuts = s?.shortcuts ? JSON.parse(s.shortcuts) : null; } catch { shortcuts = null; }
  res.json({ shortcuts });
}));
router.put("/shortcuts", requirePerm("settings.edit"), ah(async (req, res) => {
  const raw = req.body?.shortcuts;
  if (raw === null) {   // back to the defaults
    await pool.query("UPDATE business_settings SET shortcuts = NULL WHERE business_id = ?", [req.business.id]);
    return res.json({ shortcuts: null });
  }
  if (!raw || typeof raw !== "object") throw badRequest({ shortcuts: "required" });
  const out = {};
  const e = {};
  const used = new Map();
  for (const [action, combo] of Object.entries(raw).slice(0, 60)) {
    const a = text(action, 40);
    const c = combo === "" || combo === null ? "" : text(combo, 30);
    if (!a) continue;
    if (c && !KEY.test(c)) { e[a] = "invalidKey"; continue; }
    if (c && !/^(Ctrl|Alt)\+/.test(c) && !/^F\d/.test(c)) { e[a] = "needsModifier"; continue; }   // a plain letter would fire while typing
    if (c && used.has(c)) { e[a] = "keyTaken"; continue; }
    if (c) used.set(c, a);
    out[a] = c;
  }
  if (Object.keys(e).length) throw badRequest(e);
  await pool.query("UPDATE business_settings SET shortcuts = ? WHERE business_id = ?", [JSON.stringify(out), req.business.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "settings.shortcuts", meta: out, ip: req.ip });
  res.json({ shortcuts: out });
}));

export default router;
