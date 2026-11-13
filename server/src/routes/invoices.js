import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, money, withTx, ensureOwned, badRequest, conflict, num, round2, METHODS, text, optText, isDate, today, range, HttpError } from "../lib/http.js";
import { nextNumber, lockProducts, moveStock, moneyMove } from "../lib/ledger.js";
import { priceLines, goodsCost } from "./sales.js";
import { sellDevices, returnSoldDevices, deviceLabel, isTracked } from "../lib/devices.js";
import { isRoll, attachRolls, cutFromRoll, returnCuts, cutsByItem } from "../lib/rolls.js";
import { consumeForSale, restoreConsumption, viaRecipe } from "../lib/food.js";
import { branchSql, branchLocation } from "../lib/branches.js";
import { createWarranties, voidWarranties } from "../lib/warranties.js";
import { defaultLocationId } from "../lib/stock.js";
import { currentRates } from "../lib/jewelry.js";
import { receiveCustomerPayment, readPayment } from "./parties.js";
import { vatFor } from "../lib/vat.js";
import { PRICE_TIERS, priceTierOf, priceChanges } from "../lib/pricing.js";
import { readApproval } from "../lib/promotions.js";
import { RULE_KEYS, editRules, editNeeds, snapshot, diff, ruleGroups, addRevision, currentRevision } from "../lib/invoiceEdits.js";

const router = Router();
router.use(requireAuth);

/** Overdue is derived: unpaid / partially paid with a due date in the past. */
const STATUS_SQL = `CASE WHEN i.status IN ('unpaid','partially_paid') AND i.due_date IS NOT NULL AND i.due_date < UTC_DATE() THEN 'overdue' ELSE i.status END`;

/*
 * Discount (optional): an amount ("5", "5.50") or a percentage of the subtotal ("10%").
 * Returns { amount } or { error } — empty means no discount.
 */
export function readDiscount(value, subtotal) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return { amount: 0 };
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(raw);
  if (pct) {
    const p = Number(pct[1]);
    if (!(p >= 0 && p <= 100)) return { error: "invalidAmount" };
    return { amount: round2((subtotal * p) / 100), percent: p };
  }
  const amount = money(raw);
  return Number.isNaN(amount) ? { error: "invalidDiscount" } : { amount };
}

/* One invoice line (no stock: drafts, and lines added by an edit, whose stock is moved separately). */
async function insertLine(conn, businessId, invoiceId, l) {
  const [it] = await conn.query(
    `INSERT INTO invoice_items (business_id, invoice_id, product_id, qty, unit_price, unit_cost, line_total, sell_unit, sell_qty, sell_price, price_detail, list_price, price_approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [businessId, invoiceId, l.product.id, l.qty, l.unitPrice, l.unitCost, l.lineTotal, l.sell?.unit || null, l.sell?.qty ?? null, l.sell?.price ?? null, l.priceDetail ? JSON.stringify(l.priceDetail) : null,
      l.priceChanged || l.belowMin ? l.listPrice : null, l.approvedBy || null]);
  return it.insertId;
}

/*
 * Creates a wholesale invoice in one transaction.
 * body: { customerId, billPhone?, billAddress?, items:[{productId, qty, unitPrice?}], priceList?: retail|wholesale (default: the customer's), priceApprovalToken?,
 *         discount? ("5" or "10%"), discountLabel?, issueDate?, dueDate?, notes?, amountPaid?, method?, bankAccountId?, draft? }
 * draft: saved with its number and lines but no stock taken and no payment; POST /:id/post makes it a real invoice.
 * Lines with serial numbers / IMEIs or from fabric rolls are chosen when the invoice is made, so they can't be in a draft.
 */
export async function createInvoice(conn, ctx, body) {
  const { businessId, userId, role } = ctx;
  const draft = body.draft === true;
  const customerId = id(body.customerId);
  if (!customerId) throw badRequest({ customerId: "required" });
  await ensureOwned(conn, "customers", customerId, businessId);
  const items = Array.isArray(body.items) ? body.items.slice(0, 200).map((x) => ({ productId: id(x?.productId), qty: x?.qty, unitPrice: x?.unitPrice, unit: x?.unit, deviceIds: x?.deviceIds, rollId: x?.rollId, warrantyMonths: x?.warrantyMonths })) : [];
  if (!items.length) throw badRequest({ items: "required" });

  const issueDate = isDate(body.issueDate) ? body.issueDate : today();
  const dueDate = isDate(body.dueDate) ? body.dueDate : null;
  if (dueDate && dueDate < issueDate) throw badRequest({ dueDate: "beforeIssue" });

  // the customer's price type picks the price list; choosing the other one is a price change (prices.edit)
  const tier = await priceTierOf(conn, businessId, customerId);
  const priceList = PRICE_TIERS.includes(body.priceList) ? body.priceList : tier;
  if (priceList !== tier && !can(role, "prices.edit")) throw badRequest({ priceList: "priceLocked" });

  const products = await lockProducts(conn, businessId, items.map((i) => i.productId).filter(Boolean));
  const rates = [...products.values()].some((p) => p.pricing_mode === "weight") ? await currentRates(conn, businessId) : null;
  await attachRolls(conn, businessId, items);
  const lines = priceLines(items, products, { user: role, userId, priceList, rates, priceApprover: readApproval(body.priceApprovalToken, businessId, "price") });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const disc = readDiscount(body.discount, subtotal);
  if (disc.error) throw badRequest({ discount: disc.error });
  const discount = disc.amount;
  if (discount > 0 && !can(role, "sales.discount")) throw badRequest({ discount: "forbidden" });
  if (discount > subtotal) throw badRequest({ discount: "tooLarge" });
  if (discount > 0 && round2(subtotal - discount) < goodsCost(lines) - 0.005) throw badRequest({ discount: "belowCost" });
  const vat = vatFor(body.vat, round2(subtotal - discount));   // optional 5% VAT on the amount after discount
  const total = round2(subtotal - discount + vat.amount);
  const discountLabel = discount > 0 ? optText(body.discountLabel, 80) || (disc.percent !== undefined ? `${disc.percent}%` : null) : null;

  const amountPaid = body.amountPaid ? money(body.amountPaid) : 0;
  if (Number.isNaN(amountPaid) || amountPaid > total) throw badRequest({ amountPaid: "invalidAmount" });
  if (amountPaid > 0 && !METHODS.includes(body.method)) throw badRequest({ method: "required" });
  if (draft) {
    if (amountPaid > 0) throw badRequest({ amountPaid: "draftNoPayment" });
    const e = {};
    lines.forEach((l, i) => { if (isTracked(l.product) || isRoll(l.product)) e[`items.${i}.productId`] = "draftNoTracked"; });
    if (Object.keys(e).length) throw badRequest(e);
  }

  const number = await nextNumber(conn, businessId, "invoice");
  const [r] = await conn.query(
    `INSERT INTO invoices (business_id, invoice_no, customer_id, bill_phone, bill_address, user_id, issue_date, due_date, subtotal, discount, discount_label, vat_rate, vat_amount, total, amount_paid, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [businessId, number, customerId, optText(body.billPhone, 30), optText(body.billAddress, 255), userId, issueDate, dueDate, subtotal, discount, discountLabel, vat.rate, vat.amount, total, draft ? "draft" : "unpaid", optText(body.notes, 255)]
  );
  const loc = ctx.branch?.locationId || await defaultLocationId(conn, businessId);
  if (ctx.branch) await conn.query("UPDATE invoices SET branch_id = ? WHERE id = ?", [ctx.branch.id, r.insertId]);
  await conn.query("UPDATE invoices SET price_list = ? WHERE id = ?", [priceList, r.insertId]);   // retail / wholesale transaction
  for (const [i, l] of lines.entries()) {
    if (draft) { await insertLine(conn, businessId, r.insertId, l); continue; }   // a draft takes no stock
    const food = await consumeForSale(conn, { businessId, userId, product: l.product, qty: l.qty, locationId: loc, refType: "invoice", refId: r.insertId, note: number });
    if (food) { l.unitCost = food.unitCost; l.priceDetail = food.detail; }
    const [it] = await conn.query(
      `INSERT INTO invoice_items (business_id, invoice_id, product_id, qty, unit_price, unit_cost, line_total, sell_unit, sell_qty, sell_price, price_detail, list_price, price_approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [businessId, r.insertId, l.product.id, l.qty, l.unitPrice, l.unitCost, l.lineTotal, l.sell?.unit || null, l.sell?.qty ?? null, l.sell?.price ?? null, l.priceDetail ? JSON.stringify(l.priceDetail) : null,
        l.priceChanged || l.belowMin ? l.listPrice : null, l.approvedBy || null]
    );
    const devices = await sellDevices(conn, { businessId, userId, product: l.product, line: l, index: i, locationId: loc, refType: "invoice", refId: r.insertId, itemId: it.insertId, customerId });
    if (isRoll(l.product)) await cutFromRoll(conn, { businessId, product: l.product, rollId: l.rollId, meters: l.qty, locationId: loc, refType: "invoice", refId: r.insertId, itemId: it.insertId, userId, field: `items.${i}.rollId` });
    if (!food) await moveStock(conn, { businessId, userId, product: l.product, qtyChange: -l.qty, type: "invoice", refType: "invoice", refId: r.insertId, locationId: loc, devices: true });
    await createWarranties(conn, { businessId, product: l.product, devices, qty: l.qty, months: l.warrantyMonths, customerId, refType: "invoice", refId: r.insertId, userId, date: ctx.at || null });
    if (Number(l.product.unique_item) && Number(l.product.stock_qty) <= 0) await conn.query("UPDATE products SET item_status = 'sold' WHERE id = ?", [l.product.id]);
  }
  if (amountPaid > 0) {
    await receiveCustomerPayment(conn, { businessId, userId, customerId, amount: amountPaid, method: body.method, bankAccountId: id(body.bankAccountId), reference: number, invoiceId: r.insertId, at: ctx.at || null });
  }
  await audit(conn, { businessId, userId, action: draft ? "invoice.drafted" : "invoice.created", entity: "invoice", entityId: r.insertId, meta: { total, amountPaid, priceList } });
  await addRevision(conn, { businessId, invoiceId: r.insertId, action: "created", after: await snapshot(conn, businessId, r.insertId), userId });
  const changed = priceChanges(lines);
  if (changed.length || priceList !== tier) {
    await audit(conn, { businessId, userId, action: "price.changed", entity: "invoice", entityId: r.insertId, meta: { ref: number, priceList, ...(priceList !== tier ? { customerPriceList: tier } : {}), lines: changed } });
  }
  return { id: r.insertId, number, total };
}

router.post("/", requirePerm("invoices.create"), ah(async (req, res) => {
  const result = await withTx((conn) => createInvoice(conn, { businessId: req.business.id, userId: req.user.id, role: req.user, branch: req.branch }, req.body || {}));
  res.status(201).json(result);
}));

/* GET /api/invoices?status=&q=&from=&to= */
router.get("/", requirePerm("invoices.view"), ah(async (req, res) => {
  const r = range(req.query, 365);
  const where = ["i.business_id = ?", "i.issue_date BETWEEN ? AND ?"];
  const params = [req.business.id, r.from, r.to];
  const q = text(req.query.q, 60);
  if (q) { where.push("(i.invoice_no LIKE ? OR c.name LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const status = req.query.status;
  if (["unpaid", "partially_paid", "paid", "cancelled", "overdue"].includes(status)) { where.push(`${STATUS_SQL} = ?`); params.push(status); }
  if (id(req.query.customerId)) { where.push("i.customer_id = ?"); params.push(id(req.query.customerId)); }
  if (req.branch.filterId) { where.push("i.branch_id = ?"); params.push(req.branch.filterId); }
  const [rows] = await pool.query(
    `SELECT i.id, i.invoice_no, i.issue_date, i.due_date, i.total, i.amount_paid, ${STATUS_SQL} status, c.name customer
       FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      WHERE ${where.join(" AND ")} ORDER BY i.issue_date DESC, i.id DESC LIMIT 500`, params);
  res.json({ range: r, invoices: rows.map((i) => ({ id: i.id, number: i.invoice_no, issueDate: i.issue_date, dueDate: i.due_date, total: num(i.total), paid: num(i.amount_paid), balance: round2(num(i.total) - num(i.amount_paid)), status: i.status, customer: i.customer })) });
}));

/* ===================== Invoice editing (lib/invoiceEdits.js) ===================== */

/* GET / PUT /api/invoices/edit-rules — which changes to a posted invoice need a manager's approval (owner) */
router.get("/edit-rules", requirePerm("invoices.view"), ah(async (req, res) => res.json({ rules: await editRules(pool, req.business.id) })));
router.put("/edit-rules", requirePerm("settings.edit"), ah(async (req, res) => {
  const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, req.body?.rules?.[k] === true]));
  await pool.query("UPDATE business_settings SET invoice_edit_rules = ? WHERE business_id = ?", [JSON.stringify(rules), req.business.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "invoice.editRules", entity: "business", entityId: req.business.id, meta: rules, ip: req.ip });
  res.json({ rules });
}));

const special = (p) => isTracked(p) || isRoll(p) || viaRecipe(p);
const round4 = (v) => Math.round(v * 10000) / 10000;

/* GET /api/invoices/:id/edit — what the edit screen starts from: the invoice, its lines (locked ones can't change), the rules */
router.get("/:id/edit", requirePerm("invoices.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const inv = await ensureOwned(pool, "invoices", id(req.params.id), bid);
  const needs = editNeeds(inv.status);
  const snap = await snapshot(pool, bid, inv.id);
  const [rows] = await pool.query(
    `SELECT ii.id, p.tracking, p.item_kind, (SELECT GROUP_CONCAT(DISTINCT e.roll_id) FROM roll_events e WHERE e.item_id = ii.id AND e.ref_type = 'invoice') roll_ids
       FROM invoice_items ii JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ? AND ii.business_id = ?`, [inv.id, bid]);
  const lockedIds = new Set(rows.filter((r) => special(r)).map((r) => r.id));
  res.json({
    invoice: { ...snap, id: inv.id, vat: num(inv.vat_rate) > 0 },
    items: snap.items.map((x) => ({ ...x, locked: lockedIds.has(x.itemId) })),
    revision: await currentRevision(pool, bid, inv.id),
    needs, canEdit: Boolean(needs && can(req.user, needs.perm)), rules: await editRules(pool, bid),
    canApprove: can(req.user, "invoices.approveEdit")
  });
}));

/*
 * PUT /api/invoices/:id — edit an invoice (who and how: lib/invoiceEdits.js).
 * body: { revision, reason, customerId?, billPhone?, billAddress?, issueDate?, dueDate?, notes?, priceList?, discount?, discountLabel?, vat?,
 *         items: [{ itemId? (a line kept), productId, qty, unit?, unitPrice? }], approvalToken?, priceApprovalToken?, refund?: { method, bankAccountId? } }
 * Kept lines keep their row; the stock difference per product is a new stock movement; a total below what was paid needs
 * refund (money given back as a refund payment). The whole invoice before and after is kept as a new revision.
 */
router.put("/:id", ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  const user = req.user;
  const result = await withTx(async (conn) => {
    const inv = await ensureOwned(conn, "invoices", id(req.params.id), bid, true);
    const needs = editNeeds(inv.status);
    if (!needs) throw conflict("cancelledNoEdit");
    if (!can(user, needs.perm)) throw new HttpError(403, "forbidden", null, { needs: needs.perm });
    const reason = optText(b.reason, 255);
    if (needs.reason && !reason) throw badRequest({ reason: "required" });
    const rev = await currentRevision(conn, bid, inv.id);
    if (b.revision !== undefined && Number(b.revision) !== rev) throw conflict("invoiceChanged");   // someone else edited it meanwhile
    const before = await snapshot(conn, bid, inv.id);
    const posted = inv.status !== "draft";
    const paid = num(inv.amount_paid);

    // customer: a paid invoice stays with the customer who paid it
    const customerId = id(b.customerId) || inv.customer_id;
    if (customerId !== inv.customer_id) {
      await ensureOwned(conn, "customers", customerId, bid);
      if (paid > 0) throw badRequest({ customerId: "customerHasPayments" });
    }
    const issueDate = isDate(b.issueDate) ? b.issueDate : before.issueDate;
    const dueDate = b.dueDate === "" || b.dueDate === null ? null : isDate(b.dueDate) ? b.dueDate : before.dueDate;
    if (dueDate && dueDate < issueDate) throw badRequest({ dueDate: "beforeIssue" });
    const tier = await priceTierOf(conn, bid, customerId);
    const priceList = PRICE_TIERS.includes(b.priceList) ? b.priceList : before.priceList;
    if (priceList !== before.priceList && priceList !== tier && !can(user, "prices.edit")) throw badRequest({ priceList: "priceLocked" });

    // lines
    const raw = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
    if (!raw.length) throw badRequest({ items: "required" });
    const [rows] = await conn.query("SELECT * FROM invoice_items WHERE invoice_id = ? AND business_id = ? ORDER BY id FOR UPDATE", [inv.id, bid]);
    const items = raw.map((x) => ({ itemId: id(x?.itemId), productId: id(x?.productId), qty: x?.qty, unitPrice: x?.unitPrice, unit: x?.unit || null }));
    const products = await lockProducts(conn, bid, [...new Set([...rows.map((r) => r.product_id), ...items.map((x) => x.productId).filter(Boolean)])]);
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const errors = {};
    const keptSpecial = [];
    const plain = [];          // { index, item, row? }
    items.forEach((x, i) => {
      const row = x.itemId ? rowById.get(x.itemId) : null;
      if (x.itemId && (!row || row.product_id !== x.productId)) { errors[`items.${i}.productId`] = "required"; return; }
      const p = products.get(x.productId);
      if (!p) { errors[`items.${i}.productId`] = "required"; return; }
      if (special(p)) {
        // serial / IMEI, roll and recipe lines stay exactly as sold (to change them: cancel and replace the invoice)
        if (!row) { errors[`items.${i}.productId`] = "useNewInvoice"; return; }
        const sellQty = row.sell_unit ? num(row.sell_qty) : num(row.qty);
        const sellPrice = row.sell_unit ? num(row.sell_price) : num(row.unit_price);
        if (Math.abs(Number(x.qty) - sellQty) > 0.00005 || (x.unit || null) !== (row.sell_unit || null) || (x.unitPrice !== undefined && x.unitPrice !== "" && Math.abs(Number(x.unitPrice) - sellPrice) > 0.00005)) {
          errors[`items.${i}.qty`] = "lineLocked"; return;
        }
        keptSpecial.push(row);
        return;
      }
      plain.push({ index: i, item: x, row });
    });
    for (const r of rows) if (special(products.get(r.product_id)) && !keptSpecial.includes(r)) errors.items = "lockedLineRemoved";
    if (Object.keys(errors).length) throw badRequest(errors);

    // price the plain lines like a new invoice (a kept line keeps its earlier price unless it is changed)
    const rates = [...products.values()].some((p) => p.pricing_mode === "weight") ? await currentRates(conn, bid) : null;
    let lines = [];
    if (plain.length) {
      const toPrice = plain.map(({ item, row }) => ({ productId: item.productId, qty: item.qty, unit: item.unit, unitPrice: item.unitPrice,
        ...(row && (row.sell_unit || null) === (item.unit || null) ? { keepPrice: row.sell_unit ? num(row.sell_price) : num(row.unit_price) } : {}) }));
      try {
        lines = priceLines(toPrice, products, { user, userId: user.id, priceList, rates, priceApprover: readApproval(b.priceApprovalToken, bid, "price") });
      } catch (err) {   // errors back on the screen's own line numbers
        if (!err.errors) throw err;
        throw badRequest(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k.replace(/^items\.(\d+)/, (_, n) => `items.${plain[Number(n)].index}`), v])));
      }
    }
    // a kept line keeps its cost (the sale's cost at the time); new lines take today's cost
    lines.forEach((l, k) => { const row = plain[k].row; if (row) l.unitCost = num(row.unit_cost); });

    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0) + keptSpecial.reduce((s, r) => s + num(r.line_total), 0));
    const disc = b.discount === undefined ? { amount: before.discount } : readDiscount(b.discount, subtotal);
    if (disc.error) throw badRequest({ discount: disc.error });
    const discount = disc.amount;
    if (discount !== before.discount && discount > 0 && !can(user, "sales.discount")) throw badRequest({ discount: "forbidden" });
    if (discount > subtotal) throw badRequest({ discount: "tooLarge" });
    const cost = round2(goodsCost(lines) + keptSpecial.reduce((s, r) => s + num(r.qty) * num(r.unit_cost), 0));
    if (discount > 0 && discount !== before.discount && round2(subtotal - discount) < cost - 0.005) throw badRequest({ discount: "belowCost" });
    const vat = vatFor(b.vat === undefined ? before.vatRate > 0 : b.vat, round2(subtotal - discount));
    const total = round2(subtotal - discount + vat.amount);
    const discountLabel = discount > 0 ? (b.discountLabel === undefined ? before.discountLabel || null : optText(b.discountLabel, 80) || (disc.percent !== undefined ? `${disc.percent}%` : null)) : null;

    // stock: only the difference per product moves (new movements; the earlier ones stay as they were)
    if (posted) {
      const loc = await branchLocation(conn, bid, inv.branch_id);
      const delta = new Map();
      for (const r of rows) if (!special(products.get(r.product_id))) delta.set(r.product_id, round4((delta.get(r.product_id) || 0) - num(r.qty)));
      for (const l of lines) delta.set(l.product.id, round4((delta.get(l.product.id) || 0) + l.qty));
      for (const [pid, d] of delta) {
        if (Math.abs(d) < 0.00005) continue;
        await moveStock(conn, { businessId: bid, userId: user.id, product: products.get(pid), qtyChange: -d, type: "invoice_edit", refType: "invoice", refId: inv.id, locationId: loc, note: `${inv.invoice_no} edit` });
      }
    }
    // lines: kept rows are updated, new ones added, removed ones taken off (the whole before-version is in the revision)
    const keepIds = new Set(keptSpecial.map((r) => r.id));
    for (const [k, l] of lines.entries()) {
      const row = plain[k].row;
      if (!row) { await insertLine(conn, bid, inv.id, l); continue; }
      keepIds.add(row.id);
      await conn.query(
        `UPDATE invoice_items SET qty = ?, unit_price = ?, line_total = ?, sell_unit = ?, sell_qty = ?, sell_price = ?, list_price = ?, price_approved_by = COALESCE(?, price_approved_by) WHERE id = ?`,
        [l.qty, l.unitPrice, l.lineTotal, l.sell?.unit || null, l.sell?.qty ?? null, l.sell?.price ?? null, l.priceChanged || l.belowMin ? l.listPrice : null, l.approvedBy || null, row.id]);
    }
    const gone = rows.filter((r) => !keepIds.has(r.id)).map((r) => r.id);
    if (gone.length) await conn.query("DELETE FROM invoice_items WHERE id IN (?) AND business_id = ?", [gone, bid]);

    // money: a new total below what was paid gives the difference back (a refund payment, recorded like any other)
    let amountPaid = paid;
    let refunded = 0;
    if (posted && total < paid - 0.00005) {
      const method = b.refund?.method;
      if (!METHODS.includes(method)) throw new HttpError(400, "validation", { refund: "required" }, { excess: round2(paid - total) });
      refunded = round2(paid - total);
      const [p] = await conn.query("INSERT INTO customer_payments (business_id, customer_id, invoice_id, amount, method, reference, paid_at, user_id) VALUES (?, ?, ?, ?, ?, 'REFUND', UTC_TIMESTAMP(), ?)",
        [bid, inv.customer_id, inv.id, -refunded, method, user.id]);
      await moneyMove(conn, { businessId: bid, userId: user.id, direction: "out", method, bankAccountId: id(b.refund?.bankAccountId), amount: refunded, refType: "refund", refId: p.insertId, description: `${inv.invoice_no} refund (edit)` });
      amountPaid = total;
    }
    const status = !posted ? "draft" : amountPaid >= total - 0.00005 && total > 0 ? "paid" : amountPaid > 0 ? "partially_paid" : "unpaid";
    await conn.query(
      `UPDATE invoices SET customer_id = ?, bill_phone = ?, bill_address = ?, issue_date = ?, due_date = ?, notes = ?, price_list = ?, subtotal = ?, discount = ?, discount_label = ?,
              vat_rate = ?, vat_amount = ?, total = ?, amount_paid = ?, status = ? WHERE id = ? AND business_id = ?`,
      [customerId, b.billPhone === undefined ? inv.bill_phone : optText(b.billPhone, 30), b.billAddress === undefined ? inv.bill_address : optText(b.billAddress, 255),
        issueDate, dueDate, b.notes === undefined ? inv.notes : optText(b.notes, 255), priceList, subtotal, discount, discountLabel, vat.rate, vat.amount, total, amountPaid, status, inv.id, bid]);

    // what changed, and the approvals it needs (a missing approval undoes everything above)
    const after = await snapshot(conn, bid, inv.id);
    const changes = diff(before, after);
    if (!changes.length) throw conflict("noChanges");
    let approvedBy = null;
    if (needs.approvals) {
      const rules = await editRules(conn, bid);
      const groups = ruleGroups(changes).filter((g) => rules[g]);
      if (groups.length) {
        approvedBy = can(user, "invoices.approveEdit") ? user.id : readApproval(b.approvalToken, bid, "invoiceEdit");
        if (!approvedBy) throw conflict("invoiceEditNeedsApproval", { groups });
      }
    }
    if (refunded) changes.push({ kind: "refund", to: refunded, method: b.refund.method });
    const revNo = await addRevision(conn, { businessId: bid, invoiceId: inv.id, action: "edited", before, after, changes, reason, userId: user.id, approvedBy });
    await audit(conn, { businessId: bid, userId: user.id, action: "invoice.edited", entity: "invoice", entityId: inv.id,
      meta: { ref: inv.invoice_no, revision: revNo, reason, approvedBy, refunded, total: { from: before.total, to: total }, changes: changes.length }, ip: req.ip });
    return { code: "saved", revision: revNo, total, refunded, status };
  });
  res.json(result);
}));

/* POST /api/invoices/:id/post — a draft becomes a real invoice: its stock is taken now */
router.post("/:id/post", requirePerm("invoices.create"), ah(async (req, res) => {
  const bid = req.business.id;
  const uid = req.user.id;
  const r = await withTx(async (conn) => {
    const inv = await ensureOwned(conn, "invoices", id(req.params.id), bid, true);
    if (inv.status !== "draft") throw conflict("notDraft");
    const before = await snapshot(conn, bid, inv.id);
    const loc = await branchLocation(conn, bid, inv.branch_id);
    const [rows] = await conn.query("SELECT * FROM invoice_items WHERE invoice_id = ? AND business_id = ? ORDER BY id", [inv.id, bid]);
    const products = await lockProducts(conn, bid, rows.map((x) => x.product_id));
    for (const row of rows) {
      const product = products.get(row.product_id);
      const food = await consumeForSale(conn, { businessId: bid, userId: uid, product, qty: num(row.qty), locationId: loc, refType: "invoice", refId: inv.id, note: inv.invoice_no });
      if (food) await conn.query("UPDATE invoice_items SET unit_cost = ?, price_detail = ? WHERE id = ?", [food.unitCost, JSON.stringify(food.detail), row.id]);
      else {
        await moveStock(conn, { businessId: bid, userId: uid, product, qtyChange: -num(row.qty), type: "invoice", refType: "invoice", refId: inv.id, locationId: loc });
        await conn.query("UPDATE invoice_items SET unit_cost = ? WHERE id = ?", [num(product.cost_price), row.id]);   // today's cost, as when selling
      }
    }
    await conn.query("UPDATE invoices SET status = 'unpaid' WHERE id = ?", [inv.id]);
    const revNo = await addRevision(conn, { businessId: bid, invoiceId: inv.id, action: "posted", before, after: await snapshot(conn, bid, inv.id), userId: uid });
    await audit(conn, { businessId: bid, userId: uid, action: "invoice.posted", entity: "invoice", entityId: inv.id, meta: { ref: inv.invoice_no, revision: revNo }, ip: req.ip });
    return { code: "saved", revision: revNo };
  });
  res.json(r);
}));

/* GET /api/invoices/:id/history — every version (who, when, why, approved by, before / after) and every payment and refund */
router.get("/:id/history", requirePerm("invoices.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const inv = await ensureOwned(pool, "invoices", id(req.params.id), bid);
  const [revs] = await pool.query(
    `SELECT r.*, u.full_name user_name, a.full_name approver_name FROM invoice_revisions r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users a ON a.id = r.approved_by
      WHERE r.invoice_id = ? AND r.business_id = ? ORDER BY r.rev_no`, [inv.id, bid]);
  const [pays] = await pool.query(
    `SELECT cp.id, cp.amount, cp.method, cp.reference, cp.paid_at, u.full_name user_name FROM customer_payments cp LEFT JOIN users u ON u.id = cp.user_id
      WHERE cp.invoice_id = ? AND cp.business_id = ? ORDER BY cp.paid_at, cp.id`, [inv.id, bid]);
  const json = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  res.json({
    number: inv.invoice_no,
    revisions: revs.map((r) => ({ revision: r.rev_no, action: r.action, at: r.created_at, user: r.user_name, approvedBy: r.approver_name || null, reason: r.reason || null,
      changes: json(r.changes) || [], before: json(r.before_data), after: json(r.after_data) })),
    payments: pays.map((p) => ({ id: p.id, amount: num(p.amount), refund: num(p.amount) < 0, method: p.method, reference: p.reference || "", at: p.paid_at, user: p.user_name }))
  });
}));

/* GET /api/invoices/:id — printable invoice */
router.get("/:id", requirePerm("invoices.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const invId = id(req.params.id);
  if (!invId) return res.status(404).json({ code: "notFound" });
  const [[inv]] = await pool.query(
    `SELECT i.*, ${STATUS_SQL} computed_status, c.name customer_name, c.phone customer_phone, c.email customer_email, c.address customer_address
       FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
      WHERE i.id = ? AND i.business_id = ?`, [invId, bid]);
  if (!inv) return res.status(404).json({ code: "notFound" });
  const [items] = await pool.query(
    `SELECT ii.id, ii.product_id, ii.qty, ii.unit_price, ii.discount, ii.line_total, ii.price_detail, ii.sell_unit, ii.sell_qty, ii.sell_price, p.unit base_unit, COALESCE(ii.description, CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.fragrance, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, ''))) name, p.sku, p.barcode
       FROM invoice_items ii JOIN products p ON p.id = ii.product_id AND p.business_id = ii.business_id
      WHERE ii.invoice_id = ? AND ii.business_id = ? ORDER BY ii.id`, [invId, bid]);
  const [payments] = await pool.query("SELECT amount, method, paid_at, reference FROM customer_payments WHERE invoice_id = ? AND business_id = ? ORDER BY paid_at, id", [invId, bid]);
  const [devs] = await pool.query("SELECT id, serial_no, imei1, imei2, sold_item_id FROM devices WHERE business_id = ? AND sold_ref_type = 'invoice' AND sold_ref_id = ?", [bid, invId]);
  const cuts = await cutsByItem(pool, bid, "invoice", invId);
  const [wars] = await pool.query("SELECT product_id, months, end_date, status FROM warranties WHERE business_id = ? AND ref_type = 'invoice' AND ref_id = ?", [bid, invId]);
  res.json({
    business: req.business,
    invoice: {
      id: inv.id, number: inv.invoice_no, issueDate: inv.issue_date, dueDate: inv.due_date, status: inv.computed_status,
      subtotal: num(inv.subtotal), discount: num(inv.discount), discountLabel: inv.discount_label || null, vatRate: num(inv.vat_rate || 0), vat: num(inv.vat_amount || 0), total: num(inv.total), paid: num(inv.amount_paid),
      balance: round2(num(inv.total) - num(inv.amount_paid)), notes: inv.notes, customerId: inv.customer_id, revision: await currentRevision(pool, bid, invId),
      customer: { name: inv.customer_name, phone: inv.bill_phone || inv.customer_phone, email: inv.customer_email, address: inv.bill_address || inv.customer_address }
    },
    items: items.map((i) => ({ name: i.name, sku: i.sku, barcode: i.barcode || null, qty: i.sell_unit ? num(i.sell_qty) : num(i.qty),
      unitPrice: i.sell_unit ? num(i.sell_price) : num(i.unit_price), unit: i.sell_unit || null, baseQty: num(i.qty), baseUnit: i.base_unit,
      discount: num(i.discount), total: num(i.line_total),
      devices: devs.filter((d) => d.sold_item_id === i.id).map((d) => ({ id: d.id, label: deviceLabel(d) })), rolls: cuts.get(i.id) || [],
      priceDetail: i.price_detail ? JSON.parse(i.price_detail) : null,
      warranty: (() => { const w = wars.find((x) => x.product_id === i.product_id); return w ? { months: w.months, endDate: w.end_date, status: w.status } : null; })() })),
    payments: payments.map((p) => ({ amount: num(p.amount), method: p.method, at: p.paid_at, reference: p.reference }))
  });
}));

/* POST /api/invoices/:id/payments { amount, method, bankAccountId?, reference? } */
router.post("/:id/payments", requirePerm("payments.receive"), ah(async (req, res) => {
  const p = readPayment(req.body || {});
  const bid = req.business.id;
  await withTx(async (conn) => {
    const inv = await ensureOwned(conn, "invoices", id(req.params.id), bid, true);
    if (!["unpaid", "partially_paid"].includes(inv.status)) throw conflict("notPayable");
    await receiveCustomerPayment(conn, { businessId: bid, userId: req.user.id, customerId: inv.customer_id, invoiceId: inv.id, ...p, reference: p.reference || inv.invoice_no });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "payment.received", entity: "invoice", entityId: inv.id, meta: { amount: p.amount, method: p.method }, ip: req.ip });
  });
  res.status(201).json({ code: "saved" });
}));

/*
 * POST /api/invoices/:id/cancel { reason, refund?: { method, bankAccountId? } } — restores stock (a draft took none).
 * An invoice with payments is cancelled only with invoices.editPaid and a refund of everything paid (refund payments,
 * recorded like any other); the invoice, its lines and payments stay, and the cancellation is a revision.
 */
router.post("/:id/cancel", requirePerm("invoices.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const bid = req.business.id;
  await withTx(async (conn) => {
    const inv = await ensureOwned(conn, "invoices", id(req.params.id), bid, true);
    if (inv.status === "cancelled") throw conflict("alreadyCancelled");
    const before = await snapshot(conn, bid, inv.id);
    const paid = num(inv.amount_paid);
    if (paid > 0) {
      if (!can(req.user, "invoices.editPaid")) throw conflict("hasPayments");
      const method = req.body?.refund?.method;
      if (!METHODS.includes(method)) throw new HttpError(400, "validation", { refund: "required" }, { excess: paid });
      const [p] = await conn.query("INSERT INTO customer_payments (business_id, customer_id, invoice_id, amount, method, reference, paid_at, user_id) VALUES (?, ?, ?, ?, ?, 'REFUND', UTC_TIMESTAMP(), ?)",
        [bid, inv.customer_id, inv.id, -paid, method, req.user.id]);
      await moneyMove(conn, { businessId: bid, userId: req.user.id, direction: "out", method, bankAccountId: id(req.body?.refund?.bankAccountId), amount: paid, refType: "refund", refId: p.insertId, description: `${inv.invoice_no} refund (cancelled)` });
      await conn.query("UPDATE invoices SET amount_paid = 0 WHERE id = ?", [inv.id]);
    }
    if (inv.status === "draft") {   // nothing left stock: nothing to bring back
      await conn.query("UPDATE invoices SET status = 'cancelled', notes = CONCAT(COALESCE(notes,''), ?) WHERE id = ? AND business_id = ?", [` [Cancelled: ${reason}]`, inv.id, bid]);
      await addRevision(conn, { businessId: bid, invoiceId: inv.id, action: "cancelled", before, after: await snapshot(conn, bid, inv.id), reason, userId: req.user.id });
      await audit(conn, { businessId: bid, userId: req.user.id, action: "invoice.cancelled", entity: "invoice", entityId: inv.id, meta: { reason, draft: true }, ip: req.ip });
      return;
    }
    const loc = await branchLocation(conn, bid, inv.branch_id);
    const [items] = await conn.query("SELECT product_id, qty, price_detail FROM invoice_items WHERE invoice_id = ? AND business_id = ?", [inv.id, bid]);
    const products = await lockProducts(conn, bid, items.map((i) => i.product_id));
    for (const i of items) {
      if (viaRecipe(products.get(i.product_id))) await restoreConsumption(conn, { businessId: bid, userId: req.user.id, detail: JSON.parse(i.price_detail || "{}"), refType: "invoice", refId: inv.id, locationId: loc, note: reason });
      else await moveStock(conn, { businessId: bid, userId: req.user.id, product: products.get(i.product_id), qtyChange: num(i.qty), type: "return_in", refType: "invoice", refId: inv.id, locationId: loc, note: reason, devices: true });
      if (Number(products.get(i.product_id).unique_item)) await conn.query("UPDATE products SET item_status = 'returned' WHERE id = ?", [i.product_id]);
    }
    await returnSoldDevices(conn, { businessId: bid, userId: req.user.id, refType: "invoice", refId: inv.id, locationId: loc, note: reason });
    await returnCuts(conn, { businessId: bid, refType: "invoice", refId: inv.id, locationId: loc, userId: req.user.id, note: reason });
    await voidWarranties(conn, { businessId: bid, refType: "invoice", refId: inv.id, userId: req.user.id, reason });
    await conn.query("UPDATE invoices SET status = 'cancelled', notes = CONCAT(COALESCE(notes,''), ?) WHERE id = ? AND business_id = ?", [` [Cancelled: ${reason}]`, inv.id, bid]);
    await addRevision(conn, { businessId: bid, invoiceId: inv.id, action: "cancelled", before, after: await snapshot(conn, bid, inv.id), reason, userId: req.user.id,
      ...(paid > 0 ? { changes: [{ kind: "refund", to: paid, method: req.body.refund.method }] } : {}) });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "invoice.cancelled", entity: "invoice", entityId: inv.id, meta: { reason, refunded: paid }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
