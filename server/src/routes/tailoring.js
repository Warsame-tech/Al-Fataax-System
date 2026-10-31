import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, money, withTx, ensureOwned, badRequest, conflict, num, round2, isDate, METHODS, range } from "../lib/http.js";
import { moneyMove } from "../lib/ledger.js";

/*
 * Tailoring orders (fabric businesses): a garment made for a customer.
 *   customer, garment type, measurements, design notes, fabric (bought here on a receipt, or the customer's own),
 *   quoted price, deposit and later payments, labour / material / extra costs, promised date, assigned worker,
 *   stages (configurable: New Order → … → Ready for Pickup → Delivered), fittings / alterations as stage notes.
 * Stock: a tailoring order never moves stock. Fabric from the shop is sold on a POS receipt or invoice (that sale took it
 * from its roll) and is only linked here; the customer's own fabric is described but never enters or leaves stock.
 *
 *   GET  /api/tailoring/stages                PUT /api/tailoring/stages { stages: [...] }   (owner)
 *   GET  /api/tailoring?status=&stage=&q=     POST /api/tailoring
 *   GET  /api/tailoring/:id                   PUT  /api/tailoring/:id
 *   POST /api/tailoring/:id/stage { stage, note? }        POST /api/tailoring/:id/payments { amount, method, bankAccountId? }
 *   POST /api/tailoring/:id/deliver { note? }             POST /api/tailoring/:id/cancel { reason, refund? }
 */
const router = Router();
router.use(requireAuth);

export const DEFAULT_STAGES = ["New Order", "Measurements Confirmed", "Cutting", "Sewing", "Fitting", "Alterations", "Ready for Pickup", "Delivered"];
const seeOrders = (req, res, next) => (["sales.create", "sales.view", "invoices.create"].some((p) => can(req.user, p)) ? next() : res.status(403).json({ code: "forbidden" }));

async function stagesOf(db, businessId) {
  const [[s]] = await db.query("SELECT tailoring_stages FROM business_settings WHERE business_id = ?", [businessId]);
  try { const list = JSON.parse(s?.tailoring_stages || "null"); if (Array.isArray(list) && list.length >= 2) return list; } catch { /* default */ }
  return DEFAULT_STAGES;
}

const shape = (o) => {
  const costs = round2(num(o.labor_cost) + num(o.material_cost) + num(o.extra_cost));
  let measurements = {};
  try { measurements = JSON.parse(o.measurements || "{}") || {}; } catch { /* none */ }
  return {
    id: o.id, number: o.order_no, customerId: o.customer_id, customer: o.customer_name || o.cust_name || "", phone: o.customer_phone || o.cust_phone || "",
    garmentType: o.garment_type, measurements, designNotes: o.design_notes || "", fabricSource: o.fabric_source, customerFabric: o.customer_fabric || "",
    linkedSaleId: o.linked_sale_id, linkedReceipt: o.receipt_no || null, quotedPrice: num(o.quoted_price), paid: num(o.paid_amount),
    balance: round2(num(o.quoted_price) - num(o.paid_amount)), laborCost: num(o.labor_cost), materialCost: num(o.material_cost), extraCost: num(o.extra_cost),
    costs, profit: round2(num(o.quoted_price) - costs), promisedDate: o.promised_date || null, assignedWorker: o.assigned_worker || "",
    stage: o.stage, status: o.status, createdAt: o.created_at, updatedAt: o.updated_at,
    late: o.status === "open" && o.promised_date && String(o.promised_date).slice(0, 10) < new Date().toISOString().slice(0, 10)
  };
};
const SELECT = `SELECT o.*, c.name cust_name, c.phone cust_phone, s.receipt_no FROM tailoring_orders o
  LEFT JOIN customers c ON c.id = o.customer_id AND c.business_id = o.business_id
  LEFT JOIN sales s ON s.id = o.linked_sale_id AND s.business_id = o.business_id`;

async function event(conn, orderId, e, userId) {
  await conn.query("INSERT INTO tailoring_events (order_id, event, stage, amount, method, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [orderId, e.event, e.stage || null, e.amount ?? null, e.method || null, e.note || null, userId]);
}

/* ---------- stages ---------- */
router.get("/stages", seeOrders, ah(async (req, res) => res.json({ stages: await stagesOf(pool, req.business.id), defaults: DEFAULT_STAGES })));
router.put("/stages", requirePerm("settings.edit"), ah(async (req, res) => {
  const list = (Array.isArray(req.body?.stages) ? req.body.stages : []).map((x) => text(x, 60)).filter(Boolean).slice(0, 20);
  if (list.length < 2 || new Set(list.map((x) => x.toLowerCase())).size !== list.length) throw badRequest({ stages: "invalidStages" });
  await pool.query("UPDATE business_settings SET tailoring_stages = ? WHERE business_id = ?", [JSON.stringify(list), req.business.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "tailoring.stages", entity: "business", entityId: req.business.id, meta: { stages: list }, ip: req.ip });
  res.json({ stages: list });
}));

/* ---------- orders ---------- */
router.get("/", seeOrders, ah(async (req, res) => {
  const where = ["o.business_id = ?"];
  const params = [req.business.id];
  if (["open", "delivered", "cancelled"].includes(req.query.status)) { where.push("o.status = ?"); params.push(req.query.status); }
  if (req.query.stage) { where.push("o.stage = ?"); params.push(text(req.query.stage, 60)); }
  if (req.query.from || req.query.to) { const r = range(req.query, 90); where.push("o.created_at BETWEEN ? AND ?"); params.push(r.start, r.end); }
  const q = text(req.query.q, 60);
  if (q) { where.push("(o.order_no LIKE ? OR o.customer_name LIKE ? OR c.name LIKE ? OR o.customer_phone LIKE ? OR o.garment_type LIKE ?)"); params.push(...Array(5).fill(`%${q}%`)); }
  const [rows] = await pool.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY o.status = 'open' DESC, o.promised_date IS NULL, o.promised_date, o.id DESC LIMIT 500`, params);
  res.json({ orders: rows.map(shape), stages: await stagesOf(pool, req.business.id) });
}));

router.get("/:id", seeOrders, ah(async (req, res) => {
  const [[o]] = await pool.query(`${SELECT} WHERE o.id = ? AND o.business_id = ?`, [id(req.params.id), req.business.id]);
  if (!o) return res.status(404).json({ code: "notFound" });
  const [events] = await pool.query(
    "SELECT e.*, u.full_name user_name FROM tailoring_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.order_id = ? ORDER BY e.id", [o.id]);
  // fabric bought for it: the lines of the linked receipt (that sale took the stock)
  const [fabric] = o.linked_sale_id ? await pool.query(
    `SELECT CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, '')) name, si.qty, si.sell_unit, si.sell_qty, si.line_total, p.unit
       FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? AND si.business_id = ?`, [o.linked_sale_id, req.business.id]) : [[]];
  res.json({
    order: shape(o), stages: await stagesOf(pool, req.business.id),
    fabric: fabric.map((f) => ({ name: f.name, qty: f.sell_unit ? num(f.sell_qty) : num(f.qty), unit: f.sell_unit || f.unit, total: num(f.line_total) })),
    events: events.map((e) => ({ id: e.id, event: e.event, stage: e.stage, amount: e.amount === null ? null : num(e.amount), method: e.method, note: e.note || "", user: e.user_name, at: e.created_at }))
  });
}));

/* The order's details from a request (create / edit). */
async function readOrder(conn, businessId, b, { creating, currentSaleId = null, orderId = 0 }) {
  const d = {
    customerId: id(b.customerId), customerName: optText(b.customerName, 150), customerPhone: optText(b.customerPhone, 30),
    garmentType: text(b.garmentType, 80), designNotes: optText(b.designNotes, 1000),
    fabricSource: b.fabricSource === "customer" ? "customer" : "store", customerFabric: optText(b.customerFabric, 255),
    quotedPrice: money(b.quotedPrice), laborCost: b.laborCost ? money(b.laborCost) : 0, materialCost: b.materialCost ? money(b.materialCost) : 0,
    extraCost: b.extraCost ? money(b.extraCost) : 0, promisedDate: isDate(b.promisedDate) ? b.promisedDate : null, assignedWorker: optText(b.assignedWorker, 120)
  };
  const raw = b.measurements && typeof b.measurements === "object" && !Array.isArray(b.measurements) ? b.measurements : {};
  d.measurements = JSON.stringify(Object.fromEntries(Object.entries(raw).slice(0, 40).map(([k, v]) => [text(k, 40), text(String(v ?? ""), 40)]).filter(([k, v]) => k && v)));
  const e = {};
  if (!d.garmentType) e.garmentType = "required";
  if (!d.customerId && !d.customerName) e.customerName = "required";
  if (Number.isNaN(d.quotedPrice)) e.quotedPrice = "invalidAmount";
  for (const k of ["laborCost", "materialCost", "extraCost"]) if (Number.isNaN(d[k])) e[k] = "invalidAmount";
  if (d.fabricSource === "customer" && !d.customerFabric) e.customerFabric = "required";
  if (Object.keys(e).length) throw badRequest(e);
  if (d.customerId) await ensureOwned(conn, "customers", d.customerId, businessId);
  // fabric bought here: link the receipt that sold it (its stock was taken there — never again here)
  d.linkedSaleId = currentSaleId;
  const receipt = text(b.linkedReceipt, 40);
  if (d.fabricSource === "store" && receipt) {
    const [[s]] = await conn.query("SELECT id, status FROM sales WHERE business_id = ? AND receipt_no = ?", [businessId, receipt]);
    if (!s) throw badRequest({ linkedReceipt: "receiptNotFound" });
    if (s.status !== "completed") throw badRequest({ linkedReceipt: "receiptCancelled" });
    const [[other]] = await conn.query("SELECT order_no FROM tailoring_orders WHERE business_id = ? AND linked_sale_id = ? AND id <> ? AND status <> 'cancelled'", [businessId, s.id, orderId]);
    if (other) throw badRequest({ linkedReceipt: "receiptLinked" });
    d.linkedSaleId = s.id;
  } else if (d.fabricSource === "customer" || (b.linkedReceipt !== undefined && !receipt)) d.linkedSaleId = null;
  void creating;
  return d;
}

router.post("/", requirePerm("sales.create"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  const deposit = b.deposit ? money(b.deposit) : 0;
  if (Number.isNaN(deposit) || deposit < 0) throw badRequest({ deposit: "invalidAmount" });
  if (deposit > 0 && !METHODS.includes(b.method)) throw badRequest({ method: "required" });
  const result = await withTx(async (conn) => {
    const d = await readOrder(conn, bid, b, { creating: true });
    if (deposit > d.quotedPrice) throw badRequest({ deposit: "moreThanPrice" });
    const stages = await stagesOf(conn, bid);
    await conn.query("SELECT business_id FROM business_settings WHERE business_id = ? FOR UPDATE", [bid]);   // numbers in order
    const [[n]] = await conn.query("SELECT COUNT(*) n FROM tailoring_orders WHERE business_id = ?", [bid]);
    const number = `TO-${String(Number(n.n) + 1).padStart(5, "0")}`;
    const [r] = await conn.query(
      `INSERT INTO tailoring_orders (business_id, order_no, customer_id, customer_name, customer_phone, garment_type, measurements, design_notes, fabric_source,
                                     customer_fabric, linked_sale_id, quoted_price, paid_amount, labor_cost, material_cost, extra_cost, promised_date, assigned_worker, stage, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [bid, number, d.customerId, d.customerName, d.customerPhone, d.garmentType, d.measurements, d.designNotes, d.fabricSource, d.customerFabric, d.linkedSaleId,
        d.quotedPrice, d.laborCost, d.materialCost, d.extraCost, d.promisedDate, d.assignedWorker, stages[0], req.user.id]);
    await event(conn, r.insertId, { event: "created", stage: stages[0] }, req.user.id);
    if (deposit > 0) await pay(conn, req, { id: r.insertId, order_no: number }, deposit, b.method, id(b.bankAccountId), "deposit");
    await audit(conn, { businessId: bid, userId: req.user.id, action: "tailoring.created", entity: "tailoring", entityId: r.insertId, meta: { number, quotedPrice: d.quotedPrice, deposit }, ip: req.ip });
    return { id: r.insertId, number };
  });
  res.status(201).json(result);
}));

router.put("/:id", requirePerm("sales.create"), ah(async (req, res) => {
  const bid = req.business.id;
  await withTx(async (conn) => {
    const o = await ensureOwned(conn, "tailoring_orders", id(req.params.id), bid, true);
    if (o.status !== "open") throw conflict("orderClosed");
    const d = await readOrder(conn, bid, req.body || {}, { creating: false, currentSaleId: o.linked_sale_id, orderId: o.id });
    if (d.quotedPrice < num(o.paid_amount)) throw badRequest({ quotedPrice: "belowPaid" });
    await conn.query(
      `UPDATE tailoring_orders SET customer_id = ?, customer_name = ?, customer_phone = ?, garment_type = ?, measurements = ?, design_notes = ?, fabric_source = ?, customer_fabric = ?,
              linked_sale_id = ?, quoted_price = ?, labor_cost = ?, material_cost = ?, extra_cost = ?, promised_date = ?, assigned_worker = ? WHERE id = ?`,
      [d.customerId, d.customerName, d.customerPhone, d.garmentType, d.measurements, d.designNotes, d.fabricSource, d.customerFabric, d.linkedSaleId,
        d.quotedPrice, d.laborCost, d.materialCost, d.extraCost, d.promisedDate, d.assignedWorker, o.id]);
    const changed = [];
    if (num(o.quoted_price) !== d.quotedPrice) changed.push(`price ${num(o.quoted_price)} → ${d.quotedPrice}`);
    if ((o.measurements || "{}") !== d.measurements) changed.push("measurements");
    if ((o.promised_date ? String(o.promised_date).slice(0, 10) : null) !== d.promisedDate) changed.push(`promised ${d.promisedDate || "—"}`);
    if ((o.assigned_worker || null) !== d.assignedWorker) changed.push(`worker ${d.assignedWorker || "—"}`);
    await event(conn, o.id, { event: "updated", note: changed.join(" · ").slice(0, 500) || null }, req.user.id);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "tailoring.updated", entity: "tailoring", entityId: o.id, meta: { changed }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

router.post("/:id/stage", requirePerm("sales.create"), ah(async (req, res) => {
  const bid = req.business.id;
  const stage = text(req.body?.stage, 60);
  await withTx(async (conn) => {
    const o = await ensureOwned(conn, "tailoring_orders", id(req.params.id), bid, true);
    if (o.status !== "open") throw conflict("orderClosed");
    const stages = await stagesOf(conn, bid);
    if (!stages.includes(stage)) throw badRequest({ stage: "required" });
    if (stage === stages[stages.length - 1]) throw badRequest({ stage: "useDeliver" });   // the last stage is delivery (payment check)
    await conn.query("UPDATE tailoring_orders SET stage = ? WHERE id = ?", [stage, o.id]);
    await event(conn, o.id, { event: "stage", stage, note: optText(req.body?.note, 500) }, req.user.id);
  });
  res.json({ code: "saved" });
}));

async function pay(conn, req, o, amount, method, bankAccountId, kind) {
  await moneyMove(conn, { businessId: req.business.id, userId: req.user.id, direction: "in", method, bankAccountId, amount, refType: "tailoring", refId: o.id, description: `${o.order_no} ${kind}` });
  await conn.query("UPDATE tailoring_orders SET paid_amount = paid_amount + ? WHERE id = ?", [amount, o.id]);
  await event(conn, o.id, { event: "payment", amount, method, note: kind }, req.user.id);
}

router.post("/:id/payments", requirePerm("payments.receive"), ah(async (req, res) => {
  const b = req.body || {};
  const amount = money(b.amount);
  if (Number.isNaN(amount) || amount <= 0) throw badRequest({ amount: "invalidAmount" });
  if (!METHODS.includes(b.method)) throw badRequest({ method: "required" });
  await withTx(async (conn) => {
    const o = await ensureOwned(conn, "tailoring_orders", id(req.params.id), req.business.id, true);
    if (o.status === "cancelled") throw conflict("orderClosed");
    if (amount > round2(num(o.quoted_price) - num(o.paid_amount)) + 0.00005) throw badRequest({ amount: "moreThanBalance" });
    await pay(conn, req, o, amount, b.method, id(b.bankAccountId), "payment");
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "tailoring.paid", entity: "tailoring", entityId: o.id, meta: { amount, method: b.method }, ip: req.ip });
  });
  res.status(201).json({ code: "saved" });
}));

/* Delivered to the customer: paid in full, or the rest left on the customer's account (allowBalance, needs a customer). */
router.post("/:id/deliver", requirePerm("sales.create"), ah(async (req, res) => {
  const bid = req.business.id;
  await withTx(async (conn) => {
    const o = await ensureOwned(conn, "tailoring_orders", id(req.params.id), bid, true);
    if (o.status !== "open") throw conflict("orderClosed");
    const balance = round2(num(o.quoted_price) - num(o.paid_amount));
    if (balance > 0 && !(req.body?.allowBalance && can(req.user, "sales.discount"))) throw conflict("balanceDue", { balance });
    const stages = await stagesOf(conn, bid);
    const last = stages[stages.length - 1];
    await conn.query("UPDATE tailoring_orders SET stage = ?, status = 'delivered' WHERE id = ?", [last, o.id]);
    await event(conn, o.id, { event: "delivered", stage: last, note: optText(req.body?.note, 500) }, req.user.id);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "tailoring.delivered", entity: "tailoring", entityId: o.id, meta: { balance }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/* Cancelled: optionally refunds part or all of what was paid (same method). Stock is never touched. */
router.post("/:id/cancel", requirePerm("sales.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  const refund = req.body?.refund ? money(req.body.refund) : 0;
  if (Number.isNaN(refund) || refund < 0) throw badRequest({ refund: "invalidAmount" });
  if (refund > 0 && !METHODS.includes(req.body?.method)) throw badRequest({ method: "required" });
  await withTx(async (conn) => {
    const o = await ensureOwned(conn, "tailoring_orders", id(req.params.id), req.business.id, true);
    if (o.status !== "open") throw conflict("orderClosed");
    if (refund > num(o.paid_amount)) throw badRequest({ refund: "moreThanPaid" });
    if (refund > 0) {
      await moneyMove(conn, { businessId: req.business.id, userId: req.user.id, direction: "out", method: req.body.method, bankAccountId: id(req.body.bankAccountId), amount: refund, refType: "tailoring", refId: o.id, description: `${o.order_no} refund` });
      await conn.query("UPDATE tailoring_orders SET paid_amount = paid_amount - ? WHERE id = ?", [refund, o.id]);
      await event(conn, o.id, { event: "refund", amount: -refund, method: req.body.method, note: reason }, req.user.id);
    }
    await conn.query("UPDATE tailoring_orders SET status = 'cancelled' WHERE id = ?", [o.id]);
    await event(conn, o.id, { event: "cancelled", note: reason }, req.user.id);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "tailoring.cancelled", entity: "tailoring", entityId: o.id, meta: { reason, refund }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
