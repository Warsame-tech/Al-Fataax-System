import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, money, withTx, ensureOwned, badRequest, conflict, num, METHODS } from "../lib/http.js";
import { moneyMove, moveStock } from "../lib/ledger.js";
import { currentRates, usedGoldValue, netWeight, units, toNumber } from "../lib/jewelry.js";
import { defaultLocationId } from "../lib/stock.js";

/*
 * Jewelry: metal rates (per gram of a metal + purity, kept with history — sales keep the rate they used),
 * the weight precision setting, and used-gold purchases from customers:
 *   pending_inspection → offered → approved → paid (held, not for sale yet) → for_resale (made a stock item) | scrap
 *   rejected (before payment)
 * Every step is kept in gold_buy_events for accountability.
 */
const router = Router();
router.use(requireAuth);

/* ===================== metal rates ===================== */
router.get("/rates", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const rates = await currentRates(pool, bid);
  const [history] = await pool.query(
    `SELECT r.metal, r.purity, r.rate, r.created_at, u.full_name user_name FROM metal_rates r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.business_id = ? ORDER BY r.id DESC LIMIT 60`, [bid]);
  const [[s]] = await pool.query("SELECT weight_decimals FROM business_settings WHERE business_id = ?", [bid]);
  res.json({
    rates: [...rates.entries()].map(([k, rate]) => { const [metal, purity] = k.split("|"); return { metal, purity, rate }; }),
    history: history.map((h) => ({ metal: h.metal, purity: h.purity, rate: Number(h.rate), user: h.user_name, at: h.created_at })),
    weightDecimals: Number(s?.weight_decimals ?? 3)
  });
}));

/* POST /api/jewelry/rates { rates: [{ metal, purity, rate }], weightDecimals? } — a new rate is added (old ones stay as history) */
router.post("/rates", requirePerm("products.edit"), ah(async (req, res) => {
  const bid = req.business.id;
  const list = Array.isArray(req.body?.rates) ? req.body.rates.slice(0, 60) : [];
  const current = await currentRates(pool, bid);
  const changed = [];
  list.forEach((x, i) => {
    const metal = text(x?.metal, 20).toLowerCase();
    const purity = text(x?.purity, 20);
    if (x?.rate === "" || x?.rate === null || x?.rate === undefined) return;
    const rate = money(x.rate);
    if (!metal || !purity || Number.isNaN(rate) || rate <= 0) throw badRequest({ [`rates.${i}.rate`]: "invalidAmount" });
    if (current.get(`${metal}|${purity}`) !== rate) changed.push({ metal, purity, rate });
  });
  const wd = req.body?.weightDecimals === undefined ? null : Number(req.body.weightDecimals);
  if (wd !== null && ![0, 1, 2, 3, 4].includes(wd)) throw badRequest({ weightDecimals: "invalidAmount" });
  await withTx(async (conn) => {
    for (const c of changed) await conn.query("INSERT INTO metal_rates (business_id, metal, purity, rate, user_id) VALUES (?, ?, ?, ?, ?)", [bid, c.metal, c.purity, c.rate, req.user.id]);
    if (wd !== null) await conn.query("UPDATE business_settings SET weight_decimals = ? WHERE business_id = ?", [wd, bid]);
    if (changed.length) await audit(conn, { businessId: bid, userId: req.user.id, action: "jewelry.rates", meta: { changed }, ip: req.ip });
  });
  res.json({ code: "saved", changed: changed.length });
}));

/* ===================== used gold from customers ===================== */
const shape = (g) => ({
  id: g.id, refNo: g.ref_no, customerId: g.customer_id, customerName: g.customer_name || g.c_name || "", customerPhone: g.customer_phone || g.c_phone || "",
  idDocument: g.id_document || "", description: g.description, metal: g.metal, grossWeight: num(g.gross_weight), stoneWeight: num(g.stone_weight),
  netWeight: netWeight(g.gross_weight, g.stone_weight), declaredPurity: g.declared_purity || "", testedPurity: g.tested_purity || "", inspection: g.inspection || "",
  valuation: g.valuation, rateUsed: g.rate_used === null ? null : num(g.rate_used), deductionPct: num(g.deduction_pct),
  suggestedValue: g.suggested_value === null ? null : num(g.suggested_value), offerAmount: g.offer_amount === null ? null : num(g.offer_amount),
  agreedPrice: g.agreed_price === null ? null : num(g.agreed_price), approvedBy: g.approver_name || null, approvedAt: g.approved_at,
  paymentMethod: g.payment_method, paidAmount: num(g.paid_amount), paymentStatus: num(g.paid_amount) > 0 && num(g.paid_amount) >= num(g.agreed_price || 0) ? "paid" : "unpaid",
  status: g.status, productId: g.product_id, user: g.user_name || null, at: g.created_at
});
const SELECT = `SELECT g.*, c.name c_name, c.phone c_phone, u.full_name user_name, a.full_name approver_name FROM gold_buys g
  LEFT JOIN customers c ON c.id = g.customer_id AND c.business_id = g.business_id
  LEFT JOIN users u ON u.id = g.user_id LEFT JOIN users a ON a.id = g.approved_by`;
const event = (conn, g, name, detail, userId) =>
  conn.query("INSERT INTO gold_buy_events (gold_buy_id, event, detail, user_id) VALUES (?, ?, ?, ?)", [g, name, detail ? JSON.stringify(detail) : null, userId]);
const weightOf = (v, field) => {
  const n = Number(v);
  if (v === "" || v === null || v === undefined || !Number.isFinite(n) || n < 0 || n > 1e6) throw badRequest({ [field]: "invalidAmount" });
  return toNumber(units(v));
};

router.get("/gold-buys", requirePerm("purchases.view"), ah(async (req, res) => {
  const q = text(req.query.q, 80);
  const st = text(req.query.status, 20);
  const where = ["g.business_id = ?"]; const params = [req.business.id];
  if (q) { where.push("(g.ref_no LIKE ? OR g.customer_name LIKE ? OR c.name LIKE ? OR g.customer_phone LIKE ? OR g.description LIKE ?)"); params.push(...Array(5).fill(`%${q}%`)); }
  if (st) { where.push("g.status = ?"); params.push(st); }
  const [rows] = await pool.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY g.id DESC LIMIT 300`, params);
  res.json({ goldBuys: rows.map(shape) });
}));

router.get("/gold-buys/:id", requirePerm("purchases.view"), ah(async (req, res) => {
  await ensureOwned(pool, "gold_buys", id(req.params.id), req.business.id);
  const [[g]] = await pool.query(`${SELECT} WHERE g.id = ?`, [id(req.params.id)]);
  const [events] = await pool.query("SELECT e.event, e.detail, e.created_at, u.full_name user_name FROM gold_buy_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.gold_buy_id = ? ORDER BY e.id", [g.id]);
  const rates = await currentRates(pool, req.business.id);
  res.json({ goldBuy: shape(g), business: req.business,
    history: events.map((e) => ({ event: e.event, detail: e.detail ? JSON.parse(e.detail) : null, user: e.user_name, at: e.created_at })),
    rates: [...rates.entries()].map(([k, rate]) => { const [metal, purity] = k.split("|"); return { metal, purity, rate }; }) });
}));

/* 1. Received: customer, item, weight, declared purity → pending inspection (not for sale) */
router.post("/gold-buys", requirePerm("purchases.create"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  const description = text(b.description, 255);
  const metal = text(b.metal, 20).toLowerCase() || "gold";
  const e = {};
  if (!description) e.description = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const gross = weightOf(b.grossWeight, "grossWeight");
  const stone = b.stoneWeight === "" || b.stoneWeight == null ? 0 : weightOf(b.stoneWeight, "stoneWeight");
  if (stone > gross) throw badRequest({ stoneWeight: "stoneAboveGross" });
  const customerId = id(b.customerId);
  const result = await withTx(async (conn) => {
    if (customerId) await ensureOwned(conn, "customers", customerId, bid);
    const [[n]] = await conn.query("SELECT COUNT(*) n FROM gold_buys WHERE business_id = ?", [bid]);
    const ref = `UG-${String(Number(n.n) + 1).padStart(5, "0")}`;
    const [r] = await conn.query(
      `INSERT INTO gold_buys (business_id, ref_no, customer_id, customer_name, customer_phone, id_document, description, metal, gross_weight, stone_weight, declared_purity, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bid, ref, customerId, optText(b.customerName, 150), optText(b.customerPhone, 30), optText(b.idDocument, 80), description, metal, gross, stone, optText(b.declaredPurity, 20), req.user.id]);
    await event(conn, r.insertId, "received", { grossWeight: gross, stoneWeight: stone, declaredPurity: optText(b.declaredPurity, 20) }, req.user.id);
    return { id: r.insertId, refNo: ref };
  });
  res.status(201).json(result);
}));

/*
 * 2. Inspection + valuation → offered.
 * { testedPurity, inspection, valuation: weight|manual, deductionPct?, offerAmount? }
 * weight: suggested value = net weight × current rate (metal, tested purity) × (1 − deduction %); manual: the offer typed.
 */
router.post("/gold-buys/:id/inspect", requirePerm("purchases.create"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  await withTx(async (conn) => {
    const g = await ensureOwned(conn, "gold_buys", id(req.params.id), bid, true);
    if (!["pending_inspection", "offered"].includes(g.status)) throw conflict("goldBuyStep");
    const tested = text(b.testedPurity, 20);
    if (!tested) throw badRequest({ testedPurity: "required" });
    const valuation = b.valuation === "manual" ? "manual" : "weight";
    const deduction = b.deductionPct === "" || b.deductionPct == null ? 0 : Number(b.deductionPct);
    if (!Number.isFinite(deduction) || deduction < 0 || deduction > 100) throw badRequest({ deductionPct: "invalidAmount" });
    let rate = null; let suggested = null;
    if (valuation === "weight") {
      rate = (await currentRates(conn, bid)).get(`${g.metal}|${tested}`) ?? null;
      if (rate === null) throw badRequest({ testedPurity: "noRate" });
      suggested = usedGoldValue({ gross: g.gross_weight, stone: g.stone_weight, rate, deductionPct: deduction });
    }
    const offer = b.offerAmount === "" || b.offerAmount == null ? suggested : money(b.offerAmount);
    if (offer === null || Number.isNaN(offer) || offer <= 0) throw badRequest({ offerAmount: "invalidAmount" });
    await conn.query(
      `UPDATE gold_buys SET tested_purity = ?, inspection = ?, valuation = ?, rate_used = ?, deduction_pct = ?, suggested_value = ?, offer_amount = ?, status = 'offered' WHERE id = ?`,
      [tested, optText(b.inspection, 500), valuation, rate, deduction, suggested, offer, g.id]);
    await event(conn, g.id, "inspected", { testedPurity: tested, inspection: optText(b.inspection, 500), valuation, rate, deductionPct: deduction, suggestedValue: suggested, offer }, req.user.id);
  });
  res.json({ code: "saved" });
}));

/* 3. Approval by an authorized user: { agreedPrice } (the customer accepted) */
router.post("/gold-buys/:id/approve", requirePerm("purchases.pay"), ah(async (req, res) => {
  const bid = req.business.id;
  await withTx(async (conn) => {
    const g = await ensureOwned(conn, "gold_buys", id(req.params.id), bid, true);
    if (g.status !== "offered") throw conflict("goldBuyStep");
    const price = req.body?.agreedPrice === "" || req.body?.agreedPrice == null ? num(g.offer_amount) : money(req.body.agreedPrice);
    if (Number.isNaN(price) || price <= 0) throw badRequest({ agreedPrice: "invalidAmount" });
    await conn.query("UPDATE gold_buys SET agreed_price = ?, approved_by = ?, approved_at = UTC_TIMESTAMP(), status = 'approved' WHERE id = ?", [price, req.user.id, g.id]);
    await event(conn, g.id, "approved", { agreedPrice: price, note: optText(req.body?.note, 255) }, req.user.id);
  });
  res.json({ code: "saved" });
}));

/* 4. Payment to the customer { method, bankAccountId? } → paid; the item is held (not for sale) */
router.post("/gold-buys/:id/pay", requirePerm("purchases.pay"), ah(async (req, res) => {
  const bid = req.business.id;
  const method = req.body?.method;
  if (!METHODS.includes(method)) throw badRequest({ method: "required" });
  await withTx(async (conn) => {
    const g = await ensureOwned(conn, "gold_buys", id(req.params.id), bid, true);
    if (g.status !== "approved") throw conflict("goldBuyStep");
    const amount = num(g.agreed_price);
    await moneyMove(conn, { businessId: bid, userId: req.user.id, direction: "out", method, bankAccountId: id(req.body?.bankAccountId), amount,
      refType: "gold_buy", refId: g.id, description: `${g.ref_no} used gold` });
    await conn.query("UPDATE gold_buys SET paid_amount = ?, payment_method = ?, status = 'paid' WHERE id = ?", [amount, method, g.id]);
    await event(conn, g.id, "paid", { amount, method }, req.user.id);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "goldbuy.paid", entity: "gold_buy", entityId: g.id, meta: { amount }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/* Rejected / not bought (before payment) { reason } */
router.post("/gold-buys/:id/reject", requirePerm("purchases.create"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  await withTx(async (conn) => {
    const g = await ensureOwned(conn, "gold_buys", id(req.params.id), req.business.id, true);
    if (!["pending_inspection", "offered", "approved"].includes(g.status)) throw conflict("goldBuyStep");
    await conn.query("UPDATE gold_buys SET status = 'rejected' WHERE id = ?", [g.id]);
    await event(conn, g.id, "rejected", { reason }, req.user.id);
  });
  res.json({ code: "saved" });
}));

/*
 * 5. Decision after holding (approved users): { action: "resale" | "scrap", name?, sellingPrice?, pricingMode? }
 * resale → a unique stock item (weights, tested purity, cost = price paid) with 1 in stock; scrap → kept as scrap / melting.
 */
router.post("/gold-buys/:id/decide", requirePerm("purchases.pay"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  const result = await withTx(async (conn) => {
    const g = await ensureOwned(conn, "gold_buys", id(req.params.id), bid, true);
    if (g.status !== "paid") throw conflict("goldBuyStep");
    if (b.action === "scrap") {
      await conn.query("UPDATE gold_buys SET status = 'scrap' WHERE id = ?", [g.id]);
      await event(conn, g.id, "scrap", { note: optText(b.note, 255) }, req.user.id);
      return { status: "scrap" };
    }
    if (b.action !== "resale") throw badRequest({ action: "required" });
    const pricing = b.pricingMode === "fixed" ? "fixed" : "weight";
    const selling = b.sellingPrice === "" || b.sellingPrice == null ? 0 : money(b.sellingPrice);
    if (Number.isNaN(selling)) throw badRequest({ sellingPrice: "invalidAmount" });
    const name = text(b.name, 190) || g.description;
    await conn.query("INSERT IGNORE INTO categories (business_id, name) VALUES (?, ?)", [bid, g.metal === "silver" ? "Silver" : "Gold"]);
    const [[cat]] = await conn.query("SELECT id FROM categories WHERE business_id = ? AND name = ?", [bid, g.metal === "silver" ? "Silver" : "Gold"]);
    const [p] = await conn.query(
      `INSERT INTO products (business_id, category_id, name, sku, unit, cost_price, selling_price, metal, purity, gross_weight, stone_weight, pricing_mode,
                             unique_item, item_status, notes, is_active)
       VALUES (?, ?, ?, ?, 'pcs', ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, 1)`,
      [bid, cat.id, name, g.ref_no, num(g.agreed_price), selling, g.metal, g.tested_purity, g.gross_weight, g.stone_weight, pricing, `Bought from a customer: ${g.ref_no}`]);
    const product = { id: p.insertId, name, stock_qty: 0, unit: "pcs", cost_price: num(g.agreed_price), unique_item: 1 };
    await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: 1, type: "purchase", refType: "gold_buy", refId: g.id,
      locationId: await defaultLocationId(conn, bid), note: `Used gold ${g.ref_no}` });
    await conn.query("UPDATE gold_buys SET status = 'for_resale', product_id = ? WHERE id = ?", [p.insertId, g.id]);
    await event(conn, g.id, "for_resale", { productId: p.insertId, name, pricingMode: pricing }, req.user.id);
    return { status: "for_resale", productId: p.insertId };
  });
  res.json({ code: "saved", ...result });
}));

export default router;
