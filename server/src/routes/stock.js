import crypto from "node:crypto";
import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, text, optText, id, quantity, withTx, ensureOwned, badRequest, conflict, num, round2, range } from "../lib/http.js";
import { lockProducts, moveStock } from "../lib/ledger.js";
import { defaultLocationId, activeLocation } from "../lib/stock.js";
import { productName } from "../lib/productName.js";

/*
 * Stock Management (module "stock").
 *   Locations · Current stock · Opening stock · Add stock · Adjust (quantity or verified count)
 *   Transfers · Movement ledger (with reversals) · Low stock · Valuation · Reports
 * Every change goes through moveStock (lib/ledger.js) inside one transaction, and is audited.
 * Manual movements carry ref_type 'stock'; only those (and transfers) can be reversed here —
 * sales, invoices and purchases are corrected from their own modules.
 */
const router = Router();
router.use(requireAuth);

const LOCATION_KINDS = ["shop", "warehouse", "other"];
const ADD_TYPES = ["purchase", "return_in", "stock_in"];               // Purchase received, Customer return, Other stock in
const ADJUST_REASONS = ["damaged", "expired", "lost", "found", "correction", "other"];
const REVERSIBLE = ["opening", "purchase", "return_in", "stock_in", "adjustment", "damaged", "count"];
const q3 = (v) => Math.round(Number(v) * 1000) / 1000;
const pageOf = (q) => {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize, 10) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
};
const canSee = (req, res, next) => (can(req.user, "stock.view") || can(req.user, "products.view") ? next() : res.status(403).json({ code: "forbidden" }));

/* Low-stock rule: a location's own alert level when set, otherwise the product's Low Stock Alert Level. */
const ALERT = "COALESCE(ps.alert_level, p.min_stock)";
const STATUS_SQL = `CASE WHEN COALESCE(ps.qty,0) < 0 THEN 'negative' WHEN COALESCE(ps.qty,0) = 0 THEN 'out'
  WHEN COALESCE(ps.qty,0) <= ${ALERT} THEN 'low' ELSE 'in' END`;

/* ===================== Locations ===================== */
router.get("/locations", canSee, ah(async (req, res) => {
  const bid = req.business.id;
  await defaultLocationId(pool, bid);
  const [rows] = await pool.query(
    `SELECT l.*, (SELECT COALESCE(SUM(ps.qty),0) FROM product_stock ps WHERE ps.location_id = l.id) units,
            (SELECT COUNT(*) FROM product_stock ps WHERE ps.location_id = l.id AND ps.qty <> 0) products
       FROM stock_locations l WHERE l.business_id = ? ORDER BY l.is_default DESC, l.is_active DESC, l.name`, [bid]);
  res.json({ locations: rows.map((l) => ({
    id: l.id, name: l.name, kind: l.kind, address: l.address || "", isDefault: Boolean(l.is_default), isActive: Boolean(l.is_active),
    units: num(l.units), products: num(l.products)
  })) });
}));

function readLocation(b) {
  const d = { name: text(b.name, 100), kind: LOCATION_KINDS.includes(b.kind) ? b.kind : "shop", address: optText(b.address, 200) };
  if (!d.name) throw badRequest({ name: "required" });
  return d;
}
const dupName = (err) => (err.code === "ER_DUP_ENTRY" ? badRequest({ name: "locationNameTaken" }) : err);

router.post("/locations", requirePerm("stock.locations"), ah(async (req, res) => {
  const d = readLocation(req.body || {});
  const bid = req.business.id;
  try {
    const [r] = await pool.query("INSERT INTO stock_locations (business_id, name, kind, address) VALUES (?, ?, ?, ?)", [bid, d.name, d.kind, d.address]);
    await audit(null, { businessId: bid, userId: req.user.id, action: "location.created", entity: "location", entityId: r.insertId, meta: d, ip: req.ip });
    res.status(201).json({ id: r.insertId });
  } catch (err) { throw dupName(err); }
}));

/* PUT { name, kind, address, isActive, isDefault } — the default location can't be switched off;
 * a location still holding stock can't be switched off (transfer it first). */
router.put("/locations/:id", requirePerm("stock.locations"), ah(async (req, res) => {
  const d = readLocation(req.body || {});
  const bid = req.business.id;
  const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
  const isDefault = Boolean(req.body?.isDefault);
  try {
    await withTx(async (conn) => {
      const l = await ensureOwned(conn, "stock_locations", id(req.params.id), bid, true);
      if (!isActive) {
        if (l.is_default || isDefault) throw conflict("defaultLocationActive");
        const [[held]] = await conn.query("SELECT COUNT(*) n FROM product_stock WHERE location_id = ? AND qty <> 0", [l.id]);
        if (held.n) throw conflict("locationHasStock", { count: Number(held.n) });
      }
      if (isDefault && !l.is_default) await conn.query("UPDATE stock_locations SET is_default = 0 WHERE business_id = ?", [bid]);
      await conn.query("UPDATE stock_locations SET name = ?, kind = ?, address = ?, is_active = ?, is_default = ? WHERE id = ? AND business_id = ?",
        [d.name, d.kind, d.address, isActive ? 1 : 0, isDefault || l.is_default ? 1 : 0, l.id, bid]);
      await audit(conn, { businessId: bid, userId: req.user.id, action: "location.updated", entity: "location", entityId: l.id, meta: { ...d, isActive, isDefault }, ip: req.ip });
    });
    res.json({ code: "saved" });
  } catch (err) { throw dupName(err); }
}));

/* ===================== Current stock (product × location) ===================== */
router.get("/current", requirePerm("stock.view"), ah(async (req, res) => {
  const bid = req.business.id;
  await defaultLocationId(pool, bid);
  const { page, pageSize, offset } = pageOf(req.query);
  const where = ["p.business_id = ?", "p.is_active = 1", "l.is_active = 1"];
  const params = [bid];
  const loc = id(req.query.locationId);
  if (loc) { where.push("l.id = ?"); params.push(loc); }
  const q = text(req.query.q, 80);
  if (q) { where.push("(CONCAT_WS(' ', p.name, NULLIF(p.size, '')) LIKE ? OR p.sku = ? OR p.barcode = ?)"); params.push(`%${q}%`, q, q); }
  if (id(req.query.categoryId)) { where.push("p.category_id = ?"); params.push(id(req.query.categoryId)); }
  const status = ["in", "low", "out", "negative"].includes(req.query.status) ? req.query.status : null;
  if (status) { where.push(`${STATUS_SQL} = ?`); params.push(status); }
  // Show a product at a location when it has a stock row there, or always at the default location.
  where.push("(ps.id IS NOT NULL OR l.is_default = 1)");
  const from = `FROM products p JOIN stock_locations l ON l.business_id = p.business_id
    LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.location_id = l.id
    LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
   WHERE ${where.join(" AND ")}`;
  const [[count]] = await pool.query(`SELECT COUNT(*) n ${from}`, params);
  const [rows] = await pool.query(
    `SELECT p.id, CONCAT_WS(' ', p.name, NULLIF(p.size, '')) name, p.sku, p.barcode, p.image_path, p.unit, p.min_stock, p.cost_price, c.name category,
            l.id location_id, l.name location_name, COALESCE(ps.qty,0) qty, ps.alert_level, ${STATUS_SQL} status,
            (SELECT MAX(m.created_at) FROM stock_movements m WHERE m.product_id = p.id AND m.location_id = l.id) last_move
       ${from} ORDER BY FIELD(${STATUS_SQL}, 'negative','out','low','in'), p.name, l.name LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]);
  res.json({
    page, pageSize, total: Number(count.n),
    rows: rows.map((r) => ({
      productId: r.id, name: r.name, sku: r.sku, barcode: r.barcode, imagePath: r.image_path, unit: r.unit, category: r.category,
      locationId: r.location_id, location: r.location_name, qty: num(r.qty), available: num(r.qty),
      alertLevel: r.alert_level === null ? num(r.min_stock) : num(r.alert_level), alertSource: r.alert_level === null ? "product" : "location",
      status: r.status, lastMovementAt: r.last_move, value: round2(num(r.qty) * num(r.cost_price))
    }))
  });
}));

/* PATCH /api/stock/alert-level { productId, locationId, alertLevel|null } — per-location level (null = use the product's) */
router.patch("/alert-level", requirePerm("products.edit"), ah(async (req, res) => {
  const bid = req.business.id;
  const b = req.body || {};
  const level = b.alertLevel === null || b.alertLevel === "" || b.alertLevel === undefined ? null : Number(b.alertLevel);
  if (level !== null && (!Number.isFinite(level) || level < 0)) throw badRequest({ alertLevel: "invalidAmount" });
  await ensureOwned(pool, "products", id(b.productId), bid);
  const loc = await activeLocation(pool, bid, id(b.locationId));
  if (!loc) throw badRequest({ locationId: "required" });
  await pool.query(
    `INSERT INTO product_stock (business_id, product_id, location_id, qty, alert_level) VALUES (?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE alert_level = VALUES(alert_level)`, [bid, id(b.productId), loc.id, level]);
  res.json({ code: "saved" });
}));

/* GET /api/stock/product/:id — one product at every active location (for previews: before → after) */
router.get("/product/:id", canSee, ah(async (req, res) => {
  const bid = req.business.id;
  await defaultLocationId(pool, bid);
  const p = await ensureOwned(pool, "products", id(req.params.id), bid);
  const [[names]] = await pool.query(
    `SELECT c.name category, b.name brand FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
       LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id WHERE p.id = ?`, [p.id]);
  const [rows] = await pool.query(
    `SELECT l.id, l.name, l.is_default, COALESCE(ps.qty, 0) qty, ps.alert_level,
            EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = ? AND m.location_id = l.id AND m.type = 'opening'
                     AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reversal_of = m.id)) has_opening
       FROM stock_locations l LEFT JOIN product_stock ps ON ps.location_id = l.id AND ps.product_id = ?
      WHERE l.business_id = ? AND l.is_active = 1 ORDER BY l.is_default DESC, l.name`, [p.id, p.id, bid]);
  res.json({
    product: {
      id: p.id, name: productName(p), size: p.size || "", unit: p.unit, sku: p.sku, barcode: p.barcode, imagePath: p.image_path, brand: names?.brand || null,
      category: names?.category || null, subcategory: p.subcategory || null, sellingPrice: num(p.selling_price),
      costPrice: num(p.cost_price), total: num(p.stock_qty), stock: num(p.stock_qty), alertLevel: num(p.min_stock), isActive: Boolean(p.is_active)
    },
    locations: rows.map((r) => ({ locationId: r.id, location: r.name, isDefault: Boolean(r.is_default), qty: num(r.qty),
      alertLevel: r.alert_level === null ? null : num(r.alert_level), hasOpening: Boolean(r.has_opening) }))
  });
}));

/* ===================== Opening stock ===================== */
/* POST { productId, locationId, qty, reference?, notes? } — once per product and location (reverse it to redo). */
router.post("/opening", requirePerm("stock.add"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  const qty = quantity(b.qty);
  const e = {};
  if (!id(b.productId)) e.productId = "required";
  if (Number.isNaN(qty)) e.qty = "invalidAmount";
  if (Object.keys(e).length) throw badRequest(e);
  const result = await withTx(async (conn) => {
    const loc = await activeLocation(conn, bid, id(b.locationId));
    if (!loc) throw badRequest({ locationId: "required" });
    const products = await lockProducts(conn, bid, [id(b.productId)]);
    const product = products.get(id(b.productId));
    const [[dup]] = await conn.query(
      `SELECT m.id FROM stock_movements m WHERE m.business_id = ? AND m.product_id = ? AND m.location_id = ? AND m.type = 'opening'
          AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reversal_of = m.id) LIMIT 1`, [bid, product.id, loc.id]);
    if (dup) throw conflict("openingExists", { product: productName(product), location: loc.name });
    const m = await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: qty, type: "opening", refType: "stock",
      locationId: loc.id, reason: "opening", reference: optText(b.reference, 80), note: optText(b.notes, 255) });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "stock.opening", entity: "product", entityId: product.id, meta: { location: loc.name, qty }, ip: req.ip });
    return m;
  });
  res.status(201).json(result);
}));

/* ===================== Add stock (one or many products) ===================== */
/* POST { locationId, type: purchase|return_in|stock_in, reference?, supplierId?, notes?, items: [{ productId, qty }] } */
router.post("/add", requirePerm("stock.add"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  const type = ADD_TYPES.includes(b.type) ? b.type : null;
  const items = Array.isArray(b.items) ? b.items.slice(0, 200).map((x) => ({ productId: id(x?.productId), qty: quantity(x?.qty) })) : [];
  const e = {};
  if (!type) e.type = "required";
  if (!items.length) e.items = "required";
  items.forEach((x, i) => {
    if (!x.productId) e[`items.${i}.productId`] = "required";
    if (Number.isNaN(x.qty)) e[`items.${i}.qty`] = "invalidAmount";
  });
  if (Object.keys(e).length) throw badRequest(e);
  const result = await withTx(async (conn) => {
    const loc = await activeLocation(conn, bid, id(b.locationId));
    if (!loc) throw badRequest({ locationId: "required" });
    const supplierId = id(b.supplierId);
    if (supplierId) await ensureOwned(conn, "suppliers", supplierId, bid);
    const products = await lockProducts(conn, bid, items.map((x) => x.productId));
    const moves = [];
    for (const x of items) {
      const product = products.get(x.productId);
      if (!product.is_active) throw badRequest({ items: "inactiveProduct" });
      moves.push(await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: x.qty, type, refType: "stock",
        locationId: loc.id, reason: type, reference: optText(b.reference, 80), supplierId, note: optText(b.notes, 255) }));
    }
    await audit(conn, { businessId: bid, userId: req.user.id, action: "stock.added", entity: "location", entityId: loc.id,
      meta: { type, items: items.length, units: q3(items.reduce((s, x) => s + x.qty, 0)), reference: optText(b.reference, 80) }, ip: req.ip });
    return { count: moves.length };
  });
  res.status(201).json(result);
}));

/* ===================== Adjust stock ===================== */
/*
 * POST { productId, locationId, mode: "adjust" | "count", direction: "add"|"subtract", qty, counted,
 *        reason, notes?, expectedBefore? }
 * adjust → ± qty (qty must be > 0).   count → the verified quantity; the difference is calculated.
 * expectedBefore: the balance shown in the preview; if stock changed meanwhile the request is refused
 * so the user can confirm again with the new numbers.
 */
router.post("/adjust", requirePerm("stock.adjust"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  const mode = b.mode === "count" ? "count" : "adjust";
  const reason = mode === "count" ? (ADJUST_REASONS.includes(b.reason) ? b.reason : "correction") : (ADJUST_REASONS.includes(b.reason) ? b.reason : null);
  const e = {};
  if (!id(b.productId)) e.productId = "required";
  if (!reason) e.reason = "required";
  let qty = null; let counted = null;
  if (mode === "adjust") {
    qty = quantity(b.qty);
    if (Number.isNaN(qty)) e.qty = "invalidAmount";
    if (!["add", "subtract"].includes(b.direction)) e.direction = "required";
  } else {
    counted = Number(b.counted);
    if (b.counted === "" || b.counted === null || b.counted === undefined || !Number.isFinite(counted) || counted < 0) e.counted = "invalidAmount";
    else counted = q3(counted);
  }
  if (Object.keys(e).length) throw badRequest(e);
  const result = await withTx(async (conn) => {
    const loc = await activeLocation(conn, bid, id(b.locationId));
    if (!loc) throw badRequest({ locationId: "required" });
    const products = await lockProducts(conn, bid, [id(b.productId)]);
    const product = products.get(id(b.productId));
    await conn.query("INSERT IGNORE INTO product_stock (business_id, product_id, location_id, qty) VALUES (?, ?, ?, 0)", [bid, product.id, loc.id]);
    const [[row]] = await conn.query("SELECT qty FROM product_stock WHERE product_id = ? AND location_id = ? FOR UPDATE", [product.id, loc.id]);
    const before = num(row.qty);
    if (b.expectedBefore !== undefined && b.expectedBefore !== null && b.expectedBefore !== "" && q3(b.expectedBefore) !== q3(before)) {
      throw conflict("stockChanged", { current: before });
    }
    const change = mode === "count" ? q3(counted - before) : (b.direction === "subtract" ? -qty : qty);
    if (change === 0) throw badRequest({ counted: "noChange" });
    const type = mode === "count" ? "count" : (["damaged", "expired"].includes(reason) ? "damaged" : "adjustment");
    const m = await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: change, type, refType: "stock",
      locationId: loc.id, reason, note: optText(b.notes, 255) });
    const valueChange = round2(change * num(product.cost_price));
    await audit(conn, { businessId: bid, userId: req.user.id, action: "stock.adjusted", entity: "product", entityId: product.id,
      meta: { location: loc.name, mode, reason, before, change, after: m.after, valueChange }, ip: req.ip });
    return { id: m.id, before, change, after: m.after, valueChange };
  });
  res.status(201).json(result);
}));

/* ===================== Transfers between locations ===================== */
/* POST { fromLocationId, toLocationId, items: [{ productId, qty }], reference?, notes? } — all lines move together or none. */
router.post("/transfer", requirePerm("stock.transfer"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  const items = Array.isArray(b.items) ? b.items.slice(0, 200).map((x) => ({ productId: id(x?.productId), qty: quantity(x?.qty) })) : [];
  const e = {};
  if (!items.length) e.items = "required";
  items.forEach((x, i) => { if (!x.productId) e[`items.${i}.productId`] = "required"; if (Number.isNaN(x.qty)) e[`items.${i}.qty`] = "invalidAmount"; });
  if (id(b.fromLocationId) && id(b.fromLocationId) === id(b.toLocationId)) e.toLocationId = "sameLocation";
  if (Object.keys(e).length) throw badRequest(e);
  const result = await withTx(async (conn) => {
    const from = await activeLocation(conn, bid, id(b.fromLocationId));
    const to = await activeLocation(conn, bid, id(b.toLocationId));
    if (!from) throw badRequest({ fromLocationId: "required" });
    if (!to) throw badRequest({ toLocationId: "required" });
    const ref = `TR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const products = await lockProducts(conn, bid, items.map((x) => x.productId));
    for (const x of items) {
      const product = products.get(x.productId);
      const common = { businessId: bid, userId: req.user.id, product, refType: "transfer", reason: "transfer", reference: optText(b.reference, 80) || ref, transferRef: ref, note: optText(b.notes, 255) };
      await moveStock(conn, { ...common, qtyChange: -x.qty, type: "transfer_out", locationId: from.id });
      await moveStock(conn, { ...common, qtyChange: x.qty, type: "transfer_in", locationId: to.id });
    }
    await audit(conn, { businessId: bid, userId: req.user.id, action: "stock.transferred", entity: "location", entityId: from.id,
      meta: { from: from.name, to: to.name, items: items.length, ref }, ip: req.ip });
    return { transferRef: ref, count: items.length };
  });
  res.status(201).json(result);
}));

/* ===================== Movement ledger ===================== */
router.get("/movements", requirePerm("stock.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const { page, pageSize, offset } = pageOf(req.query);
  const where = ["m.business_id = ?"];
  const params = [bid];
  if (id(req.query.productId)) { where.push("m.product_id = ?"); params.push(id(req.query.productId)); }
  if (id(req.query.locationId)) { where.push("m.location_id = ?"); params.push(id(req.query.locationId)); }
  if (req.query.type) { where.push("m.type = ?"); params.push(text(req.query.type, 30)); }
  if (req.query.from || req.query.to) { const r = range(req.query, 30); where.push("m.created_at BETWEEN ? AND ?"); params.push(r.start, r.end); }
  const q = text(req.query.q, 80);
  if (q) { where.push("(CONCAT_WS(' ', p.name, NULLIF(p.size, '')) LIKE ? OR p.sku = ? OR p.barcode = ? OR m.reference = ?)"); params.push(`%${q}%`, q, q, q); }
  const from = `FROM stock_movements m JOIN products p ON p.id = m.product_id AND p.business_id = m.business_id WHERE ${where.join(" AND ")}`;
  const [[count]] = await pool.query(`SELECT COUNT(*) n ${from}`, params);
  const [rows] = await pool.query(
    `SELECT m.*, CONCAT_WS(' ', p.name, NULLIF(p.size, '')) product_name, p.sku, p.unit product_unit, l.name location_name, u.full_name user_name, s.name supplier_name,
            (SELECT r.id FROM stock_movements r WHERE r.reversal_of = m.id LIMIT 1) reversed_by
       ${from.replace("WHERE", `LEFT JOIN stock_locations l ON l.id = m.location_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN suppliers s ON s.id = m.supplier_id AND s.business_id = m.business_id
      WHERE`)} ORDER BY m.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  res.json({
    page, pageSize, total: Number(count.n),
    movements: rows.map((m) => ({
      id: m.id, productId: m.product_id, product: m.product_name, sku: m.sku, location: m.location_name, locationId: m.location_id,
      type: m.type, change: num(m.qty_change), before: m.balance_before === null ? null : num(m.balance_before),
      after: m.balance_after === null ? null : num(m.balance_after), unit: m.unit || m.product_unit,
      value: m.unit_cost === null ? null : round2(num(m.qty_change) * num(m.unit_cost)),
      reason: m.reason, reference: m.reference, supplier: m.supplier_name, notes: m.note, refType: m.ref_type, refId: m.ref_id,
      transferRef: m.transfer_ref, reversalOf: m.reversal_of, reversedBy: m.reversed_by, user: m.user_name, at: m.created_at,
      canReverse: !m.reversed_by && !m.reversal_of && (m.ref_type === "stock" ? REVERSIBLE.includes(m.type) : m.ref_type === "transfer")
    }))
  });
}));

/* POST /api/stock/movements/:id/reverse { reason } — adds the opposite movement (a transfer reverses both of its lines).
 * Nothing is deleted: the original stays in the ledger, linked to its reversal. */
router.post("/movements/:id/reverse", requirePerm("stock.adjust"), ah(async (req, res) => {
  const bid = req.business.id;
  const reason = text(req.body?.reason, 120);
  if (!reason) throw badRequest({ reason: "required" });
  const result = await withTx(async (conn) => {
    const m = await ensureOwned(conn, "stock_movements", id(req.params.id), bid, true);
    const reversible = m.ref_type === "stock" ? REVERSIBLE.includes(m.type) : m.ref_type === "transfer";
    if (!reversible || m.reversal_of) throw conflict("notReversible");
    const lines = m.ref_type === "transfer"
      ? (await conn.query("SELECT * FROM stock_movements WHERE business_id = ? AND transfer_ref = ? ORDER BY id FOR UPDATE", [bid, m.transfer_ref]))[0]
      : [m];
    const [[done]] = await conn.query("SELECT COUNT(*) n FROM stock_movements WHERE reversal_of IN (?)", [lines.map((l) => l.id)]);
    if (done.n) throw conflict("alreadyReversed");
    const products = await lockProducts(conn, bid, lines.map((l) => l.product_id));
    // reverse the incoming side of a transfer first, so the stock is still there to move back
    const ordered = [...lines].sort((a, b) => num(b.qty_change) - num(a.qty_change));
    for (const l of ordered) {
      await moveStock(conn, { businessId: bid, userId: req.user.id, product: products.get(l.product_id), qtyChange: -num(l.qty_change),
        type: "reversal", refType: l.ref_type, refId: l.id, locationId: l.location_id, reason, reference: l.reference, transferRef: l.transfer_ref, reversalOf: l.id });
    }
    await audit(conn, { businessId: bid, userId: req.user.id, action: "stock.reversed", entity: "stock_movement", entityId: m.id, meta: { type: m.type, reason }, ip: req.ip });
    return { reversed: lines.length };
  });
  res.status(201).json(result);
}));

/* ===================== Low stock ===================== */
/* Product total at or below its Low Stock Alert Level, plus any location at or below its own alert level. */
router.get("/low", requirePerm("stock.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const [rows] = await pool.query(
    `SELECT p.id, CONCAT_WS(' ', p.name, NULLIF(p.size, '')) name, p.sku, p.unit, p.image_path, l.id location_id, l.name location_name, ps.qty, ${ALERT} level,
            (ps.alert_level IS NOT NULL) own_level
       FROM product_stock ps JOIN products p ON p.id = ps.product_id AND p.business_id = ps.business_id
       JOIN stock_locations l ON l.id = ps.location_id AND l.is_active = 1
      WHERE ps.business_id = ? AND p.is_active = 1 AND ps.qty <= ${ALERT} AND (ps.alert_level IS NOT NULL OR l.is_default = 1)
      ORDER BY (ps.qty <= 0) DESC, ps.qty, p.name`, [bid]);
  res.json({ items: rows.map((r) => ({
    productId: r.id, name: r.name, sku: r.sku, unit: r.unit, imagePath: r.image_path, locationId: r.location_id, location: r.location_name,
    qty: num(r.qty), alertLevel: num(r.level), alertSource: r.own_level ? "location" : "product", status: num(r.qty) < 0 ? "negative" : num(r.qty) === 0 ? "out" : "low"
  })) });
}));

/* ===================== Valuation (cost and retail value of stock on hand) ===================== */
router.get("/valuation", requirePerm("stock.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const loc = id(req.query.locationId);
  const [rows] = await pool.query(
    `SELECT p.id, CONCAT_WS(' ', p.name, NULLIF(p.size, '')) name, p.sku, p.unit, p.cost_price, p.selling_price, l.id location_id, l.name location_name, ps.qty
       FROM product_stock ps JOIN products p ON p.id = ps.product_id AND p.business_id = ps.business_id
       JOIN stock_locations l ON l.id = ps.location_id
      WHERE ps.business_id = ? AND ps.qty <> 0 ${loc ? "AND l.id = ?" : ""} ORDER BY l.is_default DESC, l.name, p.name`, loc ? [bid, loc] : [bid]);
  const items = rows.map((r) => ({
    productId: r.id, name: r.name, sku: r.sku, unit: r.unit, location: r.location_name, locationId: r.location_id, qty: num(r.qty),
    costPrice: num(r.cost_price), sellingPrice: num(r.selling_price),
    costValue: round2(num(r.qty) * num(r.cost_price)), retailValue: round2(num(r.qty) * num(r.selling_price))
  }));
  const byLocation = {};
  for (const i of items) {
    const b = (byLocation[i.locationId] ||= { locationId: i.locationId, location: i.location, units: 0, costValue: 0, retailValue: 0 });
    b.units = q3(b.units + i.qty); b.costValue = round2(b.costValue + i.costValue); b.retailValue = round2(b.retailValue + i.retailValue);
  }
  const totals = Object.values(byLocation).reduce((t, b) => ({ units: q3(t.units + b.units), costValue: round2(t.costValue + b.costValue), retailValue: round2(t.retailValue + b.retailValue) }), { units: 0, costValue: 0, retailValue: 0 });
  res.json({ items, byLocation: Object.values(byLocation), totals });
}));

/* ===================== Stock report: movements by type for a period ===================== */
router.get("/report", requirePerm("stock.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const r = range(req.query, 30);
  const loc = id(req.query.locationId);
  const params = [bid, r.start, r.end, ...(loc ? [loc] : [])];
  const [rows] = await pool.query(
    `SELECT m.type, COUNT(*) moves, SUM(CASE WHEN m.qty_change > 0 THEN m.qty_change ELSE 0 END) qty_in,
            SUM(CASE WHEN m.qty_change < 0 THEN -m.qty_change ELSE 0 END) qty_out, SUM(m.qty_change * COALESCE(m.unit_cost, 0)) value
       FROM stock_movements m WHERE m.business_id = ? AND m.created_at BETWEEN ? AND ? ${loc ? "AND m.location_id = ?" : ""}
      GROUP BY m.type ORDER BY m.type`, params);
  const [losses] = await pool.query(
    `SELECT CONCAT_WS(' ', p.name, NULLIF(p.size, '')) name, m.reason, SUM(-m.qty_change) qty, SUM(-m.qty_change * COALESCE(m.unit_cost, 0)) value
       FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.business_id = ? AND m.created_at BETWEEN ? AND ? ${loc ? "AND m.location_id = ?" : ""}
        AND m.qty_change < 0 AND m.type IN ('damaged','adjustment','count')
      GROUP BY p.id, m.reason ORDER BY value DESC LIMIT 10`, params);
  res.json({
    range: r,
    byType: rows.map((x) => ({ type: x.type, moves: Number(x.moves), qtyIn: num(x.qty_in), qtyOut: num(x.qty_out), value: round2(num(x.value)) })),
    losses: losses.map((x) => ({ name: x.name, reason: x.reason, qty: num(x.qty), value: round2(num(x.value)) }))
  });
}));

export default router;
