/*
 * Secure invoice editing (routes/invoices.js).
 *
 * Who may change an invoice depends on its status:
 *   draft                  — anyone who creates invoices (invoices.create); no stock has moved and no money is involved
 *   unpaid / overdue       — invoices.edit, with a reason
 *   partly / fully paid    — invoices.editPaid, with a reason; a new total below what was paid needs a refund of the
 *                            difference (a recorded refund payment, never a changed payment)
 *   cancelled              — never edited
 * Changes the business marks in its rules (prices, quantities, items added / removed, discount, customer) need a manager's
 * approval (invoices.approveEdit, or a short-lived approval typed in by a manager).
 *
 * History: every version is a row of invoice_revisions with the whole invoice before and after (header and lines), the
 * changes, reason, user, time and approver. The invoice itself holds the current version; stock differences are new
 * stock movements ("invoice_edit"), money given back is a refund payment — earlier movements and payments are never
 * changed or deleted. Lines sold with serial numbers / IMEIs, from fabric rolls or through recipes can't be changed by an
 * edit (cancel the invoice and issue a replacement).
 */
import { num, round2 } from "./http.js";

export const RULE_KEYS = ["prices", "quantities", "items", "discount", "customer"];
export const DEFAULT_RULES = { prices: true, quantities: false, items: false, discount: true, customer: true };

export async function editRules(db, businessId) {
  const [[s]] = await db.query("SELECT invoice_edit_rules FROM business_settings WHERE business_id = ?", [businessId]);
  let r = {};
  try { r = JSON.parse(s?.invoice_edit_rules || "{}") || {}; } catch { /* defaults */ }
  return Object.fromEntries(RULE_KEYS.map((k) => [k, r[k] === undefined ? DEFAULT_RULES[k] : Boolean(r[k])]));
}

/** What the user needs to edit an invoice in this status (null: it can't be edited). */
export function editNeeds(status) {
  if (status === "cancelled") return null;
  if (status === "draft") return { perm: "invoices.create", reason: false, approvals: false };
  if (["partially_paid", "paid"].includes(status)) return { perm: "invoices.editPaid", reason: true, approvals: true };
  return { perm: "invoices.edit", reason: true, approvals: true };   // unpaid / overdue
}

/** The whole invoice as it is now (header + lines), kept in a revision. */
export async function snapshot(db, businessId, invoiceId) {
  const [[i]] = await db.query(
    `SELECT i.*, c.name customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ? AND i.business_id = ?`, [invoiceId, businessId]);
  const [items] = await db.query(
    `SELECT ii.id, ii.product_id, ii.qty, ii.unit_price, ii.unit_cost, ii.line_total, ii.sell_unit, ii.sell_qty, ii.sell_price, p.unit base_unit,
            CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.fragrance, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, '')) name
       FROM invoice_items ii JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ? AND ii.business_id = ? ORDER BY ii.id`, [invoiceId, businessId]);
  const d = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
  return {
    number: i.invoice_no, status: i.status, customerId: i.customer_id, customer: i.customer_name, billPhone: i.bill_phone || "", billAddress: i.bill_address || "",
    issueDate: d(i.issue_date), dueDate: d(i.due_date), notes: i.notes || "", priceList: i.price_list || "retail",
    subtotal: num(i.subtotal), discount: num(i.discount), discountLabel: i.discount_label || "", vatRate: num(i.vat_rate), vat: num(i.vat_amount), total: num(i.total), paid: num(i.amount_paid),
    items: items.map((x) => ({ itemId: x.id, productId: x.product_id, name: x.name, unit: x.sell_unit || x.base_unit, qty: x.sell_unit ? num(x.sell_qty) : num(x.qty),
      unitPrice: x.sell_unit ? num(x.sell_price) : num(x.unit_price), baseQty: num(x.qty), unitCost: num(x.unit_cost), lineTotal: num(x.line_total) }))
  };
}

/**
 * What changed between two versions: [{ kind, field?, productId?, name?, from, to }], and which rule groups they touch.
 * kinds: customer, discount, price, quantity, added, removed, details (dates, notes, bill-to, VAT, price list).
 */
export function diff(before, after) {
  const out = [];
  if (before.customerId !== after.customerId) out.push({ kind: "customer", from: before.customer, to: after.customer });
  if (before.discount !== after.discount) out.push({ kind: "discount", from: before.discount, to: after.discount });
  if (before.priceList !== after.priceList) out.push({ kind: "price", field: "priceList", from: before.priceList, to: after.priceList });
  for (const f of ["issueDate", "dueDate", "notes", "billPhone", "billAddress", "discountLabel"]) {
    if ((before[f] || "") !== (after[f] || "")) out.push({ kind: "details", field: f, from: before[f] || "", to: after[f] || "" });
  }
  if (before.vatRate !== after.vatRate) out.push({ kind: "details", field: "vat", from: before.vatRate, to: after.vatRate });
  // lines kept by an edit keep their row (itemId); a line only in one version was added / removed
  const old = new Map(before.items.map((x) => [x.itemId, x]));
  const kept = new Set();
  for (const x of after.items) {
    const o = old.get(x.itemId);
    if (!o) { out.push({ kind: "added", productId: x.productId, name: x.name, to: { qty: x.qty, unit: x.unit, unitPrice: x.unitPrice } }); continue; }
    kept.add(x.itemId);
    if (o.qty !== x.qty || o.unit !== x.unit) out.push({ kind: "quantity", productId: x.productId, name: x.name, from: `${o.qty} ${o.unit}`, to: `${x.qty} ${x.unit}` });
    if (o.unitPrice !== x.unitPrice) out.push({ kind: "price", productId: x.productId, name: x.name, from: o.unitPrice, to: x.unitPrice });
  }
  for (const o of before.items) if (!kept.has(o.itemId)) out.push({ kind: "removed", productId: o.productId, name: o.name, from: { qty: o.qty, unit: o.unit, unitPrice: o.unitPrice } });
  if (before.total !== after.total) out.push({ kind: "total", from: before.total, to: after.total });
  return out;
}

/** The approval rule groups a list of changes touches. */
export function ruleGroups(changes) {
  const g = new Set();
  for (const c of changes) {
    if (c.kind === "price") g.add("prices");
    if (c.kind === "quantity") g.add("quantities");
    if (c.kind === "added" || c.kind === "removed") g.add("items");
    if (c.kind === "discount") g.add("discount");
    if (c.kind === "customer") g.add("customer");
  }
  return [...g];
}

/** Adds a version to the invoice's history (rows are only ever added). */
export async function addRevision(conn, { businessId, invoiceId, action, before = null, after = null, changes = null, reason = null, userId, approvedBy = null }) {
  const [[n]] = await conn.query("SELECT COALESCE(MAX(rev_no), 0) + 1 n FROM invoice_revisions WHERE invoice_id = ? AND business_id = ? FOR UPDATE", [invoiceId, businessId]);
  await conn.query(
    `INSERT INTO invoice_revisions (business_id, invoice_id, rev_no, action, before_data, after_data, changes, reason, user_id, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [businessId, invoiceId, n.n, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, changes ? JSON.stringify(changes) : null, reason, userId, approvedBy]);
  return Number(n.n);
}

/** The invoice's current version number (0 = no history yet: invoices from before editing existed). */
export async function currentRevision(db, businessId, invoiceId) {
  const [[n]] = await db.query("SELECT COALESCE(MAX(rev_no), 0) n FROM invoice_revisions WHERE invoice_id = ? AND business_id = ?", [invoiceId, businessId]);
  return Number(n.n);
}

export const totalsOf = (lines) => round2(lines.reduce((s, l) => s + l.lineTotal, 0));
