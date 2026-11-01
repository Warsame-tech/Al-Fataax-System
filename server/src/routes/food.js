import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, money, withTx, ensureOwned, badRequest, conflict, num, round2, range } from "../lib/http.js";
import { lockProducts } from "../lib/ledger.js";
import { productName } from "../lib/productName.js";
import { ITEM_KINDS, SERVICES, viaRecipe, optionsOf, recipeOf, saveRecipe, recipeCost, produce, unitsFor } from "../lib/food.js";
import { createSale } from "./sales.js";

/*
 * Restaurant & cafe (food business types, profile.food):
 *   settings   kitchen stations (default by food type), "delayed" after N minutes
 *   menu       menu items, extras and goods with their sizes (name, price, recipe factor), allowed extras, station, sold out
 *   recipes    versioned recipes (lib/food.js) with today's cost; batch production of prepared items
 *   tables     tables (number, area, capacity, status) with the open orders on them
 *   orders     dine-in / takeaway / counter / delivery orders: items with size, extras, left-out ingredients and notes,
 *              sent to the kitchen, moved / combined / split between tables, paid through a POS sale (createSale: the
 *              receipt, split and partial payments, credit, discounts; recipes deducted with their cost kept)
 *   kitchen    the items of sent orders by station; staff move them preparing → ready → served
 *   reports    preparation times, delayed and cancelled orders, sales by service type
 */
const router = Router();
router.use(requireAuth);
router.use((req, res, next) => (req.business.profile.food ? next() : res.status(404).json({ code: "notFound" })));

const any = (...perms) => (req, res, next) => (perms.some((p) => can(req.user, p)) ? next() : res.status(403).json({ code: "forbidden" }));
const STATUSES = ["received", "sent", "preparing", "ready", "served", "delivered", "completed", "cancelled", "merged"];
const OPEN = ["received", "sent", "preparing", "ready", "served", "delivered"];
const TABLE_STATUSES = ["available", "occupied", "reserved", "cleaning"];
const q4 = (v) => Math.round(Number(v) * 10000) / 10000;
const json = (v, d) => { try { return JSON.parse(v || "null") ?? d; } catch { return d; } };

/* ===================== settings ===================== */
async function settingsOf(db, req) {
  const [[s]] = await db.query("SELECT kitchen_stations, food_settings FROM business_settings WHERE business_id = ?", [req.business.id]);
  const stations = json(s?.kitchen_stations, null);
  const other = json(s?.food_settings, {});
  return { stations: Array.isArray(stations) && stations.length ? stations : req.business.profile.food.stations, delayMinutes: Number(other.delayMinutes) || 20 };
}
router.get("/settings", ah(async (req, res) => {
  const s = await settingsOf(pool, req);
  res.json({ ...s, services: req.business.profile.food.services, tables: req.business.profile.food.tables, foodType: req.business.profile.food.type, defaults: req.business.profile.food.stations });
}));
router.put("/settings", requirePerm("settings.edit"), ah(async (req, res) => {
  const stations = (Array.isArray(req.body?.stations) ? req.body.stations : []).map((x) => text(x, 60)).filter(Boolean).slice(0, 20);
  const delay = Number(req.body?.delayMinutes);
  if (!stations.length || new Set(stations.map((x) => x.toLowerCase())).size !== stations.length) throw badRequest({ stations: "invalidStages" });
  if (!Number.isInteger(delay) || delay < 1 || delay > 600) throw badRequest({ delayMinutes: "invalidAmount" });
  await pool.query("UPDATE business_settings SET kitchen_stations = ?, food_settings = ? WHERE business_id = ?", [JSON.stringify(stations), JSON.stringify({ delayMinutes: delay }), req.business.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "food.settings", entity: "business", entityId: req.business.id, meta: { stations, delay }, ip: req.ip });
  res.json({ code: "saved" });
}));

/* ===================== menu ===================== */
const NAME = "CONCAT_WS(' ', p.name, NULLIF(p.size, ''), NULLIF(p.shade, ''), NULLIF(p.fragrance, ''), NULLIF(p.formula, ''), NULLIF(p.pack_size, ''))";
const seeCost = (req) => can(req.user, "dashboard.finance") || can(req.user, "products.edit");

/** GET /api/food/menu — what the POS sells: menu items, extras and goods (active), with sizes and extras resolved */
router.get("/menu", any("sales.create", "products.view", "kitchen.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const [rows] = await pool.query(
    `SELECT p.*, ${NAME} full_name, c.name category_name,
            (SELECT COUNT(*) FROM recipes r WHERE r.product_id = p.id AND r.is_current = 1) has_recipe
       FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
      WHERE p.business_id = ? AND p.is_active = 1 AND p.item_kind IN ('menu', 'modifier', 'goods', 'prepared') ORDER BY c.name, p.name`, [bid]);
  const byId = new Map(rows.map((p) => [p.id, p]));
  // optional ingredients of each current recipe (the customer may ask for them to be left out)
  const [optional] = await pool.query(
    `SELECT r.product_id, l.id line_id, ${NAME} name FROM recipes r JOIN recipe_lines l ON l.recipe_id = r.id JOIN products p ON p.id = l.ingredient_id
      WHERE r.business_id = ? AND r.is_current = 1 AND l.optional = 1 ORDER BY l.sort, l.id`, [bid]);
  const cost = seeCost(req);
  const items = [];
  for (const p of rows) {
    const o = optionsOf(p);
    const recipe = cost && Number(p.has_recipe) ? await recipeCost(pool, bid, p.id) : null;
    items.push({
      id: p.id, name: p.full_name, kind: p.item_kind, category: p.category_name || null, price: num(p.selling_price), imagePath: p.image_path || null,
      description: p.description || "", sku: p.sku || null, barcode: p.barcode || null, station: p.station || "", available: Boolean(p.available),
      stock: viaRecipe(p) ? null : num(p.stock_qty), unit: p.unit,
      sizes: o.sizes.map((s) => ({ name: s.name, price: num(s.price), factor: num(s.factor) || 1 })),
      extras: o.extras.map((x) => byId.get(x)).filter((x) => x && x.item_kind === "modifier").map((x) => ({ id: x.id, name: x.full_name, price: num(x.selling_price), available: Boolean(x.available) })),
      hasRecipe: Boolean(Number(p.has_recipe)), optional: optional.filter((x) => x.product_id === p.id).map((x) => ({ lineId: x.line_id, name: x.name })),
      ...(cost ? { recipeCost: recipe, costPrice: num(p.cost_price) } : {})
    });
  }
  res.json({ items });
}));

/** PUT /api/food/menu/:id/options { sizes: [{ name, price, factor }], extras: [productId], station } */
router.put("/menu/:id/options", requirePerm("products.edit"), ah(async (req, res) => {
  const bid = req.business.id;
  const b = req.body || {};
  const e = {};
  const sizes = (Array.isArray(b.sizes) ? b.sizes : []).slice(0, 8).map((s, i) => {
    const name = text(s?.name, 40);
    const price = money(s?.price);
    const factor = s?.factor === "" || s?.factor == null ? 1 : Number(s.factor);
    if (!name) e[`sizes.${i}.name`] = "required";
    if (Number.isNaN(price)) e[`sizes.${i}.price`] = "invalidAmount";
    if (!Number.isFinite(factor) || factor <= 0 || factor > 50) e[`sizes.${i}.factor`] = "invalidAmount";
    return { name, price, factor: q4(factor) };
  });
  if (new Set(sizes.map((s) => s.name.toLowerCase())).size !== sizes.length) e.sizes = "duplicate";
  const extras = [...new Set((Array.isArray(b.extras) ? b.extras : []).map(Number).filter(Boolean))].slice(0, 40);
  if (Object.keys(e).length) throw badRequest(e);
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "products", id(req.params.id), bid, true);
    if (extras.length) {
      const [ok] = await conn.query("SELECT id FROM products WHERE business_id = ? AND item_kind = 'modifier' AND id IN (?)", [bid, extras]);
      if (ok.length !== extras.length) throw badRequest({ extras: "required" });
    }
    await conn.query("UPDATE products SET menu_options = ?, station = ? WHERE id = ?", [JSON.stringify({ sizes, extras }), b.station === undefined ? p.station : optText(b.station, 60), p.id]);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "product.changed", entity: "product", entityId: p.id, meta: { menuOptions: { sizes, extras } }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/** POST /api/food/menu/:id/availability { available } — sold out today / back on */
router.post("/menu/:id/availability", any("products.edit", "kitchen.update"), ah(async (req, res) => {
  const p = await ensureOwned(pool, "products", id(req.params.id), req.business.id);
  await pool.query("UPDATE products SET available = ? WHERE id = ?", [req.body?.available ? 1 : 0, p.id]);
  await audit(null, { businessId: req.business.id, userId: req.user.id, action: "product.changed", entity: "product", entityId: p.id, meta: { available: Boolean(req.body?.available) }, ip: req.ip });
  res.json({ code: "saved" });
}));

/* ===================== recipes ===================== */
/** Items a recipe may use: ingredients, packaging, prepared items, goods, and menu items / extras (combos). */
router.get("/ingredients", any("products.view", "products.edit"), ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, ${NAME} name, p.unit, p.cost_price, p.item_kind, p.stock_qty FROM products p WHERE p.business_id = ? AND p.is_active = 1 ORDER BY FIELD(p.item_kind, 'ingredient', 'packaging', 'prepared', 'goods', 'modifier', 'menu'), p.name`, [req.business.id]);
  const cost = seeCost(req);
  const items = [];
  for (const p of rows) {
    // a menu item / extra inside a combo costs what its recipe costs today
    const c = cost ? (viaRecipe(p) ? (await recipeCost(pool, req.business.id, p.id)) ?? num(p.cost_price) : num(p.cost_price)) : undefined;
    items.push({ id: p.id, name: p.name, unit: p.unit, kind: p.item_kind, units: unitsFor(p.unit), stock: viaRecipe(p) ? null : num(p.stock_qty), ...(cost ? { cost: c } : {}) });
  }
  res.json({ items });
}));

const shapeRecipe = (r, cost) => r && ({
  id: r.id, version: r.version, yieldQty: r.yieldQty, notes: r.notes, createdAt: r.createdAt,
  lines: r.lines.map((l) => ({ id: l.id, ingredientId: l.ingredient_id, name: productName({ name: l.ingredient_name, size: l.size, shade: l.shade, fragrance: l.fragrance, formula: l.formula, pack_size: l.pack_size }),
    qty: num(l.qty), unit: l.unit, ingredientUnit: l.ingredient_unit, kind: l.item_kind, optional: Boolean(l.optional), service: l.service,
    ...(cost ? { unitCost: num(l.cost_price) } : {}) }))
});

router.get("/recipes/:productId", any("products.view", "products.edit", "kitchen.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const p = await ensureOwned(pool, "products", id(req.params.productId), bid);
  const cost = seeCost(req);
  const r = await recipeOf(pool, bid, p.id);
  const [versions] = await pool.query(
    "SELECT r.id, r.version, r.created_at, r.is_current, u.full_name user FROM recipes r LEFT JOIN users u ON u.id = r.user_id WHERE r.business_id = ? AND r.product_id = ? ORDER BY r.version DESC", [bid, p.id]);
  const total = cost && r ? await recipeCost(pool, bid, p.id) : null;
  const takeaway = cost && r ? await recipeCost(pool, bid, p.id, { takeaway: true }) : null;
  res.json({
    product: { id: p.id, name: productName(p), kind: p.item_kind, unit: p.unit, price: num(p.selling_price), sizes: optionsOf(p).sizes },
    recipe: shapeRecipe(r, cost), ...(cost ? { cost: total, takeawayCost: takeaway } : {}),
    versions: versions.map((v) => ({ id: v.id, version: v.version, at: v.created_at, current: Boolean(v.is_current), user: v.user }))
  });
}));
router.get("/recipes/:productId/versions/:recipeId", any("products.view", "products.edit"), ah(async (req, res) => {
  const p = await ensureOwned(pool, "products", id(req.params.productId), req.business.id);
  const r = await recipeOf(pool, req.business.id, p.id, id(req.params.recipeId));
  if (!r) return res.status(404).json({ code: "notFound" });
  res.json({ recipe: shapeRecipe(r, seeCost(req)) });
}));
/** PUT /api/food/recipes/:productId { yieldQty, notes, lines: [{ ingredientId, qty, unit, optional, service }] } → a new version */
router.put("/recipes/:productId", requirePerm("products.edit"), ah(async (req, res) => {
  const bid = req.business.id;
  const r = await withTx(async (conn) => {
    const p = await ensureOwned(conn, "products", id(req.params.productId), bid, true);
    if (!["menu", "modifier", "prepared"].includes(p.item_kind)) throw badRequest({ productId: "noRecipeKind" });
    const saved = await saveRecipe(conn, { businessId: bid, product: p, body: req.body || {}, userId: req.user.id });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "recipe.saved", entity: "product", entityId: p.id, meta: { version: saved.version, lines: (req.body?.lines || []).length }, ip: req.ip });
    return saved;
  });
  res.json(r);
}));

/** POST /api/food/production { productId, qty, note } — a batch of a prepared item (its recipe's ingredients → its stock) */
router.post("/production", requirePerm("stock.add"), ah(async (req, res) => {
  const qty = Number(req.body?.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw badRequest({ qty: "invalidAmount" });
  const r = await withTx(async (conn) => {
    const products = await lockProducts(conn, req.business.id, [id(req.body?.productId)]);
    const p = products.get(id(req.body?.productId));
    const done = await produce(conn, { businessId: req.business.id, userId: req.user.id, product: p, qty: q4(qty), note: optText(req.body?.note, 200) });
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "food.production", entity: "product", entityId: p.id, meta: { qty, cost: done.cost }, ip: req.ip });
    return done;
  });
  res.status(201).json(r);
}));

/* ===================== tables ===================== */
router.get("/tables", any("sales.create", "kitchen.view", "tables.manage"), ah(async (req, res) => {
  const bid = req.business.id;
  const [tables] = await pool.query("SELECT * FROM food_tables WHERE business_id = ? AND is_active = 1 ORDER BY sort, area, LENGTH(name), name", [bid]);
  const [orders] = await pool.query(
    `SELECT o.id, o.order_no, o.table_id, o.status, o.guests, o.created_at, o.sale_id,
            (SELECT COALESCE(SUM(i.line_total), 0) FROM food_order_items i WHERE i.order_id = o.id AND i.status <> 'cancelled') total
       FROM food_orders o WHERE o.business_id = ? AND o.table_id IS NOT NULL AND o.status IN (?)`, [bid, OPEN]);
  // the next booking today for each table (from 30 minutes ago), shown on the table map
  const [booked] = await pool.query(
    `SELECT id, table_id, reserved_for, guests, COALESCE(customer_name, '') name FROM reservations WHERE business_id = ? AND status = 'booked' AND table_id IS NOT NULL
        AND reserved_for BETWEEN DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) AND DATE_ADD(DATE(UTC_TIMESTAMP()), INTERVAL 1 DAY) ORDER BY reserved_for`, [bid]);
  res.json({ tables: tables.map((tb) => ({ id: tb.id, name: tb.name, area: tb.area || "", capacity: tb.capacity, status: tb.status,
    nextReservation: (() => { const x = booked.find((r) => r.table_id === tb.id); return x ? { id: x.id, at: x.reserved_for, guests: x.guests, name: x.name } : null; })(),
    orders: orders.filter((o) => o.table_id === tb.id).map((o) => ({ id: o.id, number: o.order_no, status: o.status, guests: o.guests, total: num(o.total), paid: Boolean(o.sale_id), at: o.created_at })) })) });
}));
function readTable(b) {
  const d = { name: text(b.name, 40), area: optText(b.area, 60), capacity: Number(b.capacity ?? 4) };
  const e = {};
  if (!d.name) e.name = "required";
  if (!Number.isInteger(d.capacity) || d.capacity < 1 || d.capacity > 100) e.capacity = "invalidAmount";
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}
const tableTaken = (err) => (err.code === "ER_DUP_ENTRY" ? badRequest({ name: "tableNameTaken" }) : err);
router.post("/tables", requirePerm("tables.manage"), ah(async (req, res) => {
  const d = readTable(req.body || {});
  try {
    const [r] = await pool.query("INSERT INTO food_tables (business_id, name, area, capacity) VALUES (?, ?, ?, ?)", [req.business.id, d.name, d.area, d.capacity]);
    res.status(201).json({ id: r.insertId });
  } catch (err) { throw tableTaken(err); }
}));
router.put("/tables/:id", requirePerm("tables.manage"), ah(async (req, res) => {
  const d = readTable(req.body || {});
  const tb = await ensureOwned(pool, "food_tables", id(req.params.id), req.business.id);
  try {
    await pool.query("UPDATE food_tables SET name = ?, area = ?, capacity = ?, is_active = ? WHERE id = ?", [d.name, d.area, d.capacity, req.body?.isActive === false ? 0 : 1, tb.id]);
    res.json({ code: "saved" });
  } catch (err) { throw tableTaken(err); }
}));
/** status: available | reserved | cleaning (occupied follows the orders) */
router.post("/tables/:id/status", requirePerm("sales.create"), ah(async (req, res) => {
  const status = req.body?.status;
  if (!["available", "reserved", "cleaning"].includes(status)) throw badRequest({ status: "required" });
  const tb = await ensureOwned(pool, "food_tables", id(req.params.id), req.business.id);
  const [[busy]] = await pool.query("SELECT COUNT(*) n FROM food_orders WHERE business_id = ? AND table_id = ? AND status IN (?)", [req.business.id, tb.id, OPEN]);
  if (busy.n) throw conflict("tableHasOrder");
  await pool.query("UPDATE food_tables SET status = ? WHERE id = ?", [status, tb.id]);
  res.json({ code: "saved" });
}));
/* a table is occupied while an order is open on it; when the last one closes it needs cleaning */
async function syncTable(conn, businessId, tableId) {
  if (!tableId) return;
  const [[busy]] = await conn.query("SELECT COUNT(*) n FROM food_orders WHERE business_id = ? AND table_id = ? AND status IN (?)", [businessId, tableId, OPEN]);
  if (busy.n) await conn.query("UPDATE food_tables SET status = 'occupied' WHERE id = ? AND business_id = ?", [tableId, businessId]);
  else await conn.query("UPDATE food_tables SET status = 'cleaning' WHERE id = ? AND business_id = ? AND status = 'occupied'", [tableId, businessId]);
}

/* ===================== orders ===================== */
async function nextOrderNo(conn, businessId) {
  await conn.query("SELECT business_id FROM business_settings WHERE business_id = ? FOR UPDATE", [businessId]);
  const [[n]] = await conn.query("SELECT COUNT(*) n FROM food_orders WHERE business_id = ?", [businessId]);
  return `ORD-${String(Number(n.n) + 1).padStart(5, "0")}`;
}

/*
 * Order lines from a request: [{ productId, qty, size?, extras?: [id], removed?: [recipeLineId], notes? }] — priced here:
 * size price (or the menu price) + extras; left-out ingredients must be optional lines of the item's recipe.
 */
async function readLines(conn, businessId, list, field = "items") {
  const items = Array.isArray(list) ? list.slice(0, 100) : [];
  if (!items.length) throw badRequest({ [field]: "required" });
  const ids = [...new Set(items.map((x) => id(x?.productId)).filter(Boolean))];
  const [rows] = ids.length ? await conn.query("SELECT * FROM products WHERE business_id = ? AND id IN (?)", [businessId, ids]) : [[]];
  const byId = new Map(rows.map((p) => [p.id, p]));
  const out = [];
  for (const [i, x] of items.entries()) {
    const p = byId.get(id(x?.productId));
    const qty = Number(x?.qty);
    if (!p || !p.is_active || !["menu", "modifier", "goods", "prepared"].includes(p.item_kind)) throw badRequest({ [`${field}.${i}.productId`]: "required" });
    if (!p.available) throw badRequest({ [`${field}.${i}.productId`]: "soldOut" }, "validation");
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1000) throw badRequest({ [`${field}.${i}.qty`]: "invalidAmount" });
    const o = optionsOf(p);
    let price = num(p.selling_price);
    let factor = 1;
    let size = null;
    if (x?.size) {
      const s = o.sizes.find((z) => z.name === x.size);
      if (!s) throw badRequest({ [`${field}.${i}.size`]: "required" });
      size = s.name; price = num(s.price); factor = num(s.factor) || 1;
    }
    const extraIds = [...new Set((Array.isArray(x?.extras) ? x.extras : []).map(Number).filter(Boolean))];
    if (extraIds.some((e) => !o.extras.includes(e))) throw badRequest({ [`${field}.${i}.extras`]: "required" });
    const [ex] = extraIds.length ? await conn.query("SELECT id, name, size, selling_price, available FROM products WHERE business_id = ? AND id IN (?) AND item_kind = 'modifier' AND is_active = 1", [businessId, extraIds]) : [[]];
    if (ex.length !== extraIds.length || ex.some((e) => !e.available)) throw badRequest({ [`${field}.${i}.extras`]: "soldOut" });
    const extras = ex.map((e) => ({ id: e.id, name: productName(e), price: num(e.selling_price) }));
    const removedIds = [...new Set((Array.isArray(x?.removed) ? x.removed : []).map(Number).filter(Boolean))];
    let removed = [];
    if (removedIds.length) {
      const r = await recipeOf(conn, businessId, p.id);
      const optional = new Map((r?.lines || []).filter((l) => l.optional).map((l) => [l.id, l.ingredient_name]));
      if (removedIds.some((rid) => !optional.has(rid))) throw badRequest({ [`${field}.${i}.removed`]: "required" });
      removed = removedIds.map((rid) => ({ lineId: rid, name: optional.get(rid) }));
    }
    const unitPrice = q4(price + extras.reduce((s, e) => s + e.price, 0));
    out.push({ product: p, qty: q4(qty), size, factor, extras, removed, notes: optText(x?.notes, 255), unitPrice, lineTotal: round2(qty * unitPrice), station: p.station || null });
  }
  return out;
}
async function insertLines(conn, { businessId, orderId, lines, send, userId }) {
  for (const l of lines) {
    await conn.query(
      `INSERT INTO food_order_items (business_id, order_id, product_id, qty, size, size_factor, extras, removed, notes, unit_price, line_total, station, status, user_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${send ? "UTC_TIMESTAMP()" : "NULL"})`,
      [businessId, orderId, l.product.id, l.qty, l.size, l.factor, JSON.stringify(l.extras), JSON.stringify(l.removed), l.notes, l.unitPrice, l.lineTotal, l.station, send ? "sent" : "new", userId]);
  }
}

/* The order's status follows its items: all ready → ready, any started → preparing, otherwise sent. */
async function refreshStatus(conn, order) {
  const [items] = await conn.query("SELECT status FROM food_order_items WHERE order_id = ? AND status NOT IN ('cancelled', 'new')", [order.id]);
  if (["completed", "cancelled", "merged", "delivered"].includes(order.status)) return order.status;
  let status = "received";
  if (items.length) {
    if (items.every((i) => i.status === "served")) status = "served";
    else if (items.every((i) => ["ready", "served"].includes(i.status))) status = "ready";
    else if (items.some((i) => ["preparing", "ready", "served"].includes(i.status))) status = "preparing";
    else status = "sent";
  }
  if (status !== order.status) {
    await conn.query(`UPDATE food_orders SET status = ?${status === "ready" ? ", ready_at = COALESCE(ready_at, UTC_TIMESTAMP())" : ""}${status === "sent" ? ", sent_at = COALESCE(sent_at, UTC_TIMESTAMP())" : ""} WHERE id = ?`, [status, order.id]);
  }
  return status;
}

async function lockOrder(conn, req, orderId) {
  const o = await ensureOwned(conn, "food_orders", id(orderId), req.business.id, true);
  return o;
}
const isOpen = (o) => OPEN.includes(o.status);

async function readOrderHead(conn, req, b, current = null) {
  const service = SERVICES.includes(b.serviceType) ? b.serviceType : current?.service_type;
  if (!service || !req.business.profile.food.services.includes(service)) throw badRequest({ serviceType: "required" });
  const tableId = b.tableId === undefined ? current?.table_id ?? null : id(b.tableId);
  if (service === "dine_in" && req.business.profile.food.tables && !tableId) throw badRequest({ tableId: "required" });
  if (tableId) await ensureOwned(conn, "food_tables", tableId, req.business.id);
  const customerId = b.customerId === undefined ? current?.customer_id ?? null : id(b.customerId);
  if (customerId) await ensureOwned(conn, "customers", customerId, req.business.id);
  const fee = b.deliveryFee === undefined ? num(current?.delivery_fee) : b.deliveryFee === "" || b.deliveryFee == null ? 0 : money(b.deliveryFee);
  if (Number.isNaN(fee) || fee < 0) throw badRequest({ deliveryFee: "invalidAmount" });
  const pick = (k, col, max) => (b[k] === undefined ? current?.[col] ?? null : optText(b[k], max));
  const d = { service, tableId: service === "dine_in" ? tableId : null, guests: b.guests === undefined ? current?.guests ?? null : (Number(b.guests) > 0 ? Math.min(200, Math.floor(Number(b.guests))) : null),
    customerId, customerName: pick("customerName", "customer_name", 150), customerPhone: pick("customerPhone", "customer_phone", 30),
    address: pick("deliveryAddress", "delivery_address", 255), fee: service === "delivery" ? fee : 0, driver: pick("driver", "driver", 100), notes: pick("notes", "notes", 500) };
  if (service === "delivery" && !d.address) throw badRequest({ deliveryAddress: "required" });
  if (service === "delivery" && !d.customerPhone && !customerId) throw badRequest({ customerPhone: "required" });
  return d;
}

/** POST /api/food/orders { serviceType, tableId?, guests?, customer…, delivery…, notes?, items, send? (default true) } */
router.post("/orders", requirePerm("sales.create"), ah(async (req, res) => {
  const b = req.body || {};
  const r = await withTx(async (conn) => {
    const d = await readOrderHead(conn, req, b);
    const lines = await readLines(conn, req.business.id, b.items);
    const send = b.send !== false;
    const number = await nextOrderNo(conn, req.business.id);
    const [x] = await conn.query(
      `INSERT INTO food_orders (business_id, order_no, service_type, table_id, guests, customer_id, customer_name, customer_phone, delivery_address, delivery_fee, driver, notes, status, user_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${send ? "UTC_TIMESTAMP()" : "NULL"})`,
      [req.business.id, number, d.service, d.tableId, d.guests, d.customerId, d.customerName, d.customerPhone, d.address, d.fee, d.driver, d.notes, send ? "sent" : "received", req.user.id]);
    await insertLines(conn, { businessId: req.business.id, orderId: x.insertId, lines, send, userId: req.user.id });
    await syncTable(conn, req.business.id, d.tableId);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "food.order", entity: "food_order", entityId: x.insertId, meta: { number, service: d.service, items: lines.length }, ip: req.ip });
    return { id: x.insertId, number };
  });
  res.status(201).json(r);
}));

/** POST /api/food/orders/:id/items { items, send? } — more items on an open, unpaid order */
router.post("/orders/:id/items", requirePerm("sales.create"), ah(async (req, res) => {
  await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    if (!isOpen(o)) throw conflict("orderClosed");
    if (o.sale_id) throw conflict("orderPaid");
    const lines = await readLines(conn, req.business.id, req.body?.items);
    const send = req.body?.send !== false;
    await insertLines(conn, { businessId: req.business.id, orderId: o.id, lines, send, userId: req.user.id });
    if (send && ["served", "ready"].includes(o.status)) o.status = "sent";
    if (send) await conn.query("UPDATE food_orders SET status = 'sent', sent_at = COALESCE(sent_at, UTC_TIMESTAMP()) WHERE id = ? AND status IN ('received', 'ready', 'served')", [o.id]);
    await refreshStatus(conn, { ...o, status: send ? "sent" : o.status });
  });
  res.status(201).json({ code: "saved" });
}));

/** POST /api/food/orders/:id/send — items not yet sent go to the kitchen */
router.post("/orders/:id/send", requirePerm("sales.create"), ah(async (req, res) => {
  await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    if (!isOpen(o)) throw conflict("orderClosed");
    const [x] = await conn.query("UPDATE food_order_items SET status = 'sent', sent_at = UTC_TIMESTAMP() WHERE order_id = ? AND status = 'new'", [o.id]);
    if (!x.affectedRows) throw conflict("nothingToSend");
    await conn.query("UPDATE food_orders SET status = 'sent', sent_at = COALESCE(sent_at, UTC_TIMESTAMP()) WHERE id = ?", [o.id]);
    await refreshStatus(conn, { ...o, status: "sent" });
  });
  res.json({ code: "saved" });
}));

/** PATCH /api/food/orders/:id { tableId (move to another table), guests, customer…, delivery…, notes } */
router.patch("/orders/:id", requirePerm("sales.create"), ah(async (req, res) => {
  await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    if (!isOpen(o)) throw conflict("orderClosed");
    const d = await readOrderHead(conn, req, req.body || {}, o);
    if (o.sale_id && d.fee !== num(o.delivery_fee)) throw conflict("orderPaid");
    await conn.query(
      `UPDATE food_orders SET service_type = ?, table_id = ?, guests = ?, customer_id = ?, customer_name = ?, customer_phone = ?, delivery_address = ?, delivery_fee = ?, driver = ?, notes = ? WHERE id = ?`,
      [d.service, d.tableId, d.guests, d.customerId, d.customerName, d.customerPhone, d.address, d.fee, d.driver, d.notes, o.id]);
    if (o.table_id !== d.tableId) {
      await syncTable(conn, req.business.id, o.table_id);
      await syncTable(conn, req.business.id, d.tableId);
      await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "food.moved", entity: "food_order", entityId: o.id, meta: { from: o.table_id, to: d.tableId }, ip: req.ip });
    }
  });
  res.json({ code: "saved" });
}));

/** POST /api/food/orders/:id/merge { orderId } — tables combined: that order's items move onto this one */
router.post("/orders/:id/merge", requirePerm("sales.create"), ah(async (req, res) => {
  await withTx(async (conn) => {
    const into = await lockOrder(conn, req, req.params.id);
    const from = await lockOrder(conn, req, req.body?.orderId);
    if (into.id === from.id) throw badRequest({ orderId: "required" });
    if (!isOpen(into) || !isOpen(from)) throw conflict("orderClosed");
    if (into.sale_id || from.sale_id) throw conflict("orderPaid");
    await conn.query("UPDATE food_order_items SET order_id = ? WHERE order_id = ?", [into.id, from.id]);
    await conn.query("UPDATE food_orders SET status = 'merged', merged_into = ?, closed_at = UTC_TIMESTAMP() WHERE id = ?", [into.id, from.id]);
    await conn.query("UPDATE food_orders SET guests = COALESCE(guests, 0) + COALESCE(?, 0) WHERE id = ?", [from.guests, into.id]);
    await refreshStatus(conn, into);
    await syncTable(conn, req.business.id, from.table_id);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "food.merged", entity: "food_order", entityId: into.id, meta: { from: from.order_no }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/** POST /api/food/orders/:id/split { items: [{ id, qty }] } — those items (or part of a line) become a new bill on the same table */
router.post("/orders/:id/split", requirePerm("sales.create"), ah(async (req, res) => {
  const r = await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    if (!isOpen(o)) throw conflict("orderClosed");
    if (o.sale_id) throw conflict("orderPaid");
    const want = (Array.isArray(req.body?.items) ? req.body.items : []).map((x) => ({ id: id(x?.id), qty: Number(x?.qty) })).filter((x) => x.id && x.qty > 0);
    if (!want.length) throw badRequest({ items: "required" });
    const [items] = await conn.query("SELECT * FROM food_order_items WHERE order_id = ? AND status <> 'cancelled' FOR UPDATE", [o.id]);
    const moving = want.map((w, i) => {
      const it = items.find((x) => x.id === w.id);
      if (!it || w.qty > num(it.qty) + 0.00005) throw badRequest({ [`items.${i}.qty`]: "invalidAmount" });
      return { it, qty: q4(w.qty) };
    });
    const left = items.reduce((s, it) => s + num(it.qty), 0) - moving.reduce((s, m) => s + m.qty, 0);
    if (left <= 0.00005) throw badRequest({ items: "splitAll" });
    const number = await nextOrderNo(conn, req.business.id);
    const [x] = await conn.query(
      `INSERT INTO food_orders (business_id, order_no, service_type, table_id, customer_id, customer_name, customer_phone, notes, status, user_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.business.id, number, o.service_type, o.table_id, o.customer_id, o.customer_name, o.customer_phone, `Split from ${o.order_no}`, o.status, req.user.id, o.sent_at]);
    for (const { it, qty } of moving) {
      if (qty >= num(it.qty) - 0.00005) { await conn.query("UPDATE food_order_items SET order_id = ? WHERE id = ?", [x.insertId, it.id]); continue; }
      // part of a line: the line is divided between the two bills
      await conn.query("UPDATE food_order_items SET qty = ?, line_total = ? WHERE id = ?", [q4(num(it.qty) - qty), round2((num(it.qty) - qty) * num(it.unit_price)), it.id]);
      await conn.query(
        `INSERT INTO food_order_items (business_id, order_id, product_id, qty, size, size_factor, extras, removed, notes, unit_price, line_total, station, status, user_id, created_at, sent_at, started_at, ready_at, served_at)
         SELECT business_id, ?, product_id, ?, size, size_factor, extras, removed, notes, unit_price, ?, station, status, user_id, created_at, sent_at, started_at, ready_at, served_at FROM food_order_items WHERE id = ?`,
        [x.insertId, qty, round2(qty * num(it.unit_price)), it.id]);
    }
    await refreshStatus(conn, o);
    await refreshStatus(conn, { id: x.insertId, status: o.status });
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "food.split", entity: "food_order", entityId: o.id, meta: { into: number }, ip: req.ip });
    return { id: x.insertId, number };
  });
  res.status(201).json(r);
}));

/** POST /api/food/orders/:id/items/:itemId/cancel { reason } — a line taken off (once sent to the kitchen: needs sales.cancel) */
router.post("/orders/:id/items/:itemId/cancel", requirePerm("sales.create"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    if (!isOpen(o)) throw conflict("orderClosed");
    if (o.sale_id) throw conflict("orderPaid");
    const [[it]] = await conn.query("SELECT * FROM food_order_items WHERE id = ? AND order_id = ? FOR UPDATE", [id(req.params.itemId), o.id]);
    if (!it || it.status === "cancelled") throw badRequest({ itemId: "required" });
    if (it.status !== "new") {
      if (!can(req.user, "sales.cancel")) throw conflict("needsApproval");
      if (!reason) throw badRequest({ reason: "required" });
    }
    await conn.query("UPDATE food_order_items SET status = 'cancelled', notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?", [reason ? ` [Cancelled: ${reason}]` : "", it.id]);
    await refreshStatus(conn, o);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "food.itemCancelled", entity: "food_order", entityId: o.id, meta: { itemId: it.id, product: it.product_id, qty: num(it.qty), reason, wasSent: it.status !== "new" }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/** POST /api/food/orders/:id/status { status: served | delivered | completed } — completed needs the bill paid */
router.post("/orders/:id/status", requirePerm("sales.create"), ah(async (req, res) => {
  const status = req.body?.status;
  if (!["served", "delivered", "completed"].includes(status)) throw badRequest({ status: "required" });
  await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    if (!isOpen(o)) throw conflict("orderClosed");
    if (status === "completed" && !o.sale_id) throw conflict("orderUnpaid");
    if (status === "delivered" && o.service_type !== "delivery") throw badRequest({ status: "required" });
    if (status === "served" || status === "delivered") await conn.query("UPDATE food_order_items SET status = 'served', served_at = COALESCE(served_at, UTC_TIMESTAMP()) WHERE order_id = ? AND status IN ('sent', 'preparing', 'ready')", [o.id]);
    if (status === "completed") await conn.query("UPDATE food_order_items SET status = 'served', served_at = COALESCE(served_at, UTC_TIMESTAMP()) WHERE order_id = ? AND status IN ('sent', 'preparing', 'ready')", [o.id]);
    await conn.query(`UPDATE food_orders SET status = ?${status === "completed" ? ", closed_at = UTC_TIMESTAMP()" : ""} WHERE id = ?`, [status, o.id]);
    await syncTable(conn, req.business.id, o.table_id);
  });
  res.json({ code: "saved" });
}));

/** POST /api/food/orders/:id/cancel { reason } — an unpaid order (a paid one is refunded by cancelling its receipt first) */
router.post("/orders/:id/cancel", requirePerm("sales.cancel"), ah(async (req, res) => {
  const reason = text(req.body?.reason, 200);
  if (!reason) throw badRequest({ reason: "required" });
  await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    if (!isOpen(o)) throw conflict("orderClosed");
    if (o.sale_id) {
      const [[s]] = await conn.query("SELECT status FROM sales WHERE id = ?", [o.sale_id]);
      if (s?.status === "completed") throw conflict("orderPaid");
    }
    await conn.query("UPDATE food_order_items SET status = 'cancelled' WHERE order_id = ? AND status <> 'served'", [o.id]);
    await conn.query("UPDATE food_orders SET status = 'cancelled', cancel_reason = ?, closed_at = UTC_TIMESTAMP() WHERE id = ?", [reason, o.id]);
    await syncTable(conn, req.business.id, o.table_id);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "food.cancelled", entity: "food_order", entityId: o.id, meta: { number: o.order_no, reason }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/*
 * POST /api/food/orders/:id/pay { payments, discount?, vat?, customerId? } — the bill: a POS sale of the order's items
 * (receipt, split / partial payments, credit for a customer). The recipes' ingredients leave stock now, with their cost.
 * Dine-in orders stay open on the table until served / completed; counter and takeaway orders stay in the kitchen queue.
 */
router.post("/orders/:id/pay", requirePerm("sales.create"), ah(async (req, res) => {
  const b = req.body || {};
  const r = await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    if (!isOpen(o)) throw conflict("orderClosed");
    if (o.sale_id) throw conflict("orderPaid");
    const [items] = await conn.query("SELECT * FROM food_order_items WHERE order_id = ? AND status <> 'cancelled' ORDER BY id", [o.id]);
    if (!items.length) throw badRequest({ items: "required" });
    const ctxItems = items.map((it) => {
      const extras = json(it.extras, []);
      const removed = json(it.removed, []);
      return { productId: it.product_id, qty: num(it.qty), menu: { unitPrice: num(it.unit_price), factor: num(it.size_factor) || 1, size: it.size, extras,
        removed: removed.map((x) => x.lineId), removedNames: removed.map((x) => x.name), notes: it.notes, service: o.service_type } };
    });
    const customerId = b.customerId || o.customer_id;   // the order's customer unless another one is chosen at payment
    const sale = await createSale(conn, { businessId: req.business.id, userId: req.user.id, role: req.user, items: ctxItems,
      fee: num(o.delivery_fee) > 0 ? { amount: num(o.delivery_fee), label: "Delivery" } : null }, { ...b, customerId });
    await conn.query("UPDATE food_orders SET sale_id = ?, customer_id = COALESCE(customer_id, ?) WHERE id = ?", [sale.id, id(customerId), o.id]);
    // nothing left to wait for: the order is done
    const [[left]] = await conn.query("SELECT COUNT(*) n FROM food_order_items WHERE order_id = ? AND status IN ('new', 'sent', 'preparing', 'ready')", [o.id]);
    if (!left.n && ["served", "delivered"].includes(o.status)) {
      await conn.query("UPDATE food_orders SET status = 'completed', closed_at = UTC_TIMESTAMP() WHERE id = ?", [o.id]);
      await syncTable(conn, req.business.id, o.table_id);
    }
    return { ...sale, orderId: o.id };
  });
  res.status(201).json(r);
}));

const shapeItem = (it) => ({ id: it.id, productId: it.product_id, name: it.product_name, qty: num(it.qty), size: it.size, extras: json(it.extras, []), removed: json(it.removed, []),
  notes: it.notes || "", unitPrice: num(it.unit_price), total: num(it.line_total), station: it.station || "", status: it.status,
  sentAt: it.sent_at, startedAt: it.started_at, readyAt: it.ready_at, servedAt: it.served_at, imagePath: it.image_path || null });
const ITEM_SELECT = `SELECT i.*, ${NAME} product_name, p.image_path FROM food_order_items i JOIN products p ON p.id = i.product_id`;
const ORDER_SELECT = `SELECT o.*, t.name table_name, c.name cust_name, c.phone cust_phone, s.receipt_no, s.total sale_total, s.amount_paid sale_paid, s.status sale_status, u.full_name user_name
  FROM food_orders o LEFT JOIN food_tables t ON t.id = o.table_id LEFT JOIN customers c ON c.id = o.customer_id AND c.business_id = o.business_id
  LEFT JOIN sales s ON s.id = o.sale_id LEFT JOIN users u ON u.id = o.user_id`;
function shapeOrder(o, items) {
  const active = items.filter((i) => i.status !== "cancelled");
  const subtotal = round2(active.reduce((s, i) => s + num(i.line_total), 0));
  return {
    id: o.id, number: o.order_no, service: o.service_type, tableId: o.table_id, table: o.table_name || null, guests: o.guests,
    customerId: o.customer_id, customer: o.customer_name || o.cust_name || "", phone: o.customer_phone || o.cust_phone || "",
    deliveryAddress: o.delivery_address || "", deliveryFee: num(o.delivery_fee), driver: o.driver || "", notes: o.notes || "", status: o.status,
    subtotal, total: round2(subtotal + num(o.delivery_fee)), saleId: o.sale_id, receiptNo: o.receipt_no || null,
    paid: o.sale_id ? num(o.sale_paid) : 0, billTotal: o.sale_id ? num(o.sale_total) : null, saleStatus: o.sale_status || null,
    balance: o.sale_id ? round2(num(o.sale_total) - num(o.sale_paid)) : null, mergedInto: o.merged_into, cancelReason: o.cancel_reason || "",
    user: o.user_name || null, createdAt: o.created_at, sentAt: o.sent_at, readyAt: o.ready_at, closedAt: o.closed_at,
    unsent: items.filter((i) => i.status === "new").length, items: items.map(shapeItem)
  };
}

/** GET /api/food/orders?status=open|closed|all&service=&tableId=&q=&from=&to= */
router.get("/orders", any("sales.create", "sales.view", "kitchen.view"), ah(async (req, res) => {
  const where = ["o.business_id = ?", "o.status <> 'merged'"];
  const params = [req.business.id];
  const st = req.query.status || "open";
  if (st === "open") { where.push("o.status IN (?)"); params.push(OPEN); }
  else if (st === "closed") where.push("o.status IN ('completed', 'cancelled')");
  else if (STATUSES.includes(st)) { where.push("o.status = ?"); params.push(st); }
  if (SERVICES.includes(req.query.service)) { where.push("o.service_type = ?"); params.push(req.query.service); }
  if (id(req.query.tableId)) { where.push("o.table_id = ?"); params.push(id(req.query.tableId)); }
  if (st !== "open" && (req.query.from || req.query.to)) { const r = range(req.query, 7); where.push("o.created_at BETWEEN ? AND ?"); params.push(r.start, r.end); }
  const q = text(req.query.q, 60);
  if (q) { where.push("(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR c.name LIKE ? OR t.name = ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q); }
  const [orders] = await pool.query(`${ORDER_SELECT} WHERE ${where.join(" AND ")} ORDER BY o.id DESC LIMIT 300`, params);
  const [items] = orders.length ? await pool.query(`${ITEM_SELECT} WHERE i.order_id IN (?) ORDER BY i.id`, [orders.map((o) => o.id)]) : [[]];
  res.json({ orders: orders.map((o) => shapeOrder(o, items.filter((i) => i.order_id === o.id))) });
}));
router.get("/orders/:id", any("sales.create", "sales.view", "kitchen.view"), ah(async (req, res) => {
  const [[o]] = await pool.query(`${ORDER_SELECT} WHERE o.id = ? AND o.business_id = ?`, [id(req.params.id), req.business.id]);
  if (!o) return res.status(404).json({ code: "notFound" });
  const [items] = await pool.query(`${ITEM_SELECT} WHERE i.order_id = ? ORDER BY i.id`, [o.id]);
  res.json({ order: shapeOrder(o, items) });
}));

/* ===================== kitchen ===================== */
/** GET /api/food/kitchen?station= — sent orders and their items for that station (all stations when empty) */
router.get("/kitchen", requirePerm("kitchen.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const station = text(req.query.station, 60);
  const [items] = await pool.query(
    `${ITEM_SELECT} JOIN food_orders o ON o.id = i.order_id WHERE i.business_id = ? AND o.status IN (?) AND i.status IN ('sent', 'preparing', 'ready')
       ${station ? "AND i.station = ?" : ""} ORDER BY i.sent_at, i.id`, station ? [bid, OPEN, station] : [bid, OPEN]);
  const ids = [...new Set(items.map((i) => i.order_id))];
  const [orders] = ids.length ? await pool.query(`${ORDER_SELECT} WHERE o.id IN (?)`, [ids]) : [[]];
  const s = await settingsOf(pool, req);
  res.json({
    now: new Date().toISOString(), delayMinutes: s.delayMinutes, stations: s.stations,
    orders: ids.map((oid) => {
      const o = orders.find((x) => x.id === oid);
      return { id: o.id, number: o.order_no, service: o.service_type, table: o.table_name || null, customer: o.customer_name || o.cust_name || "", notes: o.notes || "",
        status: o.status, sentAt: o.sent_at, paid: Boolean(o.sale_id), items: items.filter((i) => i.order_id === oid).map(shapeItem) };
    })
  });
}));
const NEXT = { sent: "preparing", preparing: "ready", ready: "served" };
const STAMP = { preparing: "started_at", ready: "ready_at", served: "served_at" };
async function setItemsStatus(conn, req, order, itemIds, status) {
  for (const iid of itemIds) {
    const [[it]] = await conn.query("SELECT * FROM food_order_items WHERE id = ? AND order_id = ? FOR UPDATE", [iid, order.id]);
    if (!it || !["sent", "preparing", "ready"].includes(it.status)) continue;
    await conn.query(`UPDATE food_order_items SET status = ?, ${STAMP[status]} = COALESCE(${STAMP[status]}, UTC_TIMESTAMP())${status === "ready" ? ", started_at = COALESCE(started_at, sent_at)" : ""} WHERE id = ?`, [status, it.id]);
  }
  await refreshStatus(conn, order);
}
/** POST /api/food/kitchen/items/:id { status: preparing | ready | served } */
router.post("/kitchen/items/:id", requirePerm("kitchen.update"), ah(async (req, res) => {
  const status = req.body?.status;
  if (!STAMP[status]) throw badRequest({ status: "required" });
  await withTx(async (conn) => {
    const [[it]] = await conn.query("SELECT order_id FROM food_order_items WHERE id = ? AND business_id = ?", [id(req.params.id), req.business.id]);
    if (!it) throw badRequest({ itemId: "required" });
    const o = await lockOrder(conn, req, it.order_id);
    await setItemsStatus(conn, req, o, [id(req.params.id)], status);
  });
  res.json({ code: "saved" });
}));
/** POST /api/food/kitchen/orders/:id { station? } — bump: every item of the order (at that station) moves one step */
router.post("/kitchen/orders/:id", requirePerm("kitchen.update"), ah(async (req, res) => {
  const station = text(req.body?.station, 60);
  await withTx(async (conn) => {
    const o = await lockOrder(conn, req, req.params.id);
    const [items] = await conn.query(`SELECT id, status FROM food_order_items WHERE order_id = ? AND status IN ('sent', 'preparing', 'ready') ${station ? "AND station = ?" : ""}`, station ? [o.id, station] : [o.id]);
    if (!items.length) return;
    // the least advanced items move first, so the whole ticket moves together
    const order = ["sent", "preparing", "ready"];
    const lowest = order.find((s) => items.some((i) => i.status === s));
    await setItemsStatus(conn, req, o, items.filter((i) => i.status === lowest).map((i) => i.id), NEXT[lowest]);
  });
  res.json({ code: "saved" });
}));

/* ===================== reports ===================== */
/** GET /api/food/reports?from&to — preparation times (by station and item), delayed and cancelled orders, sales by service type */
router.get("/reports", any("reports.view", "kitchen.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const r = range(req.query, 7);
  const s = await settingsOf(pool, req);
  const PREP = "TIMESTAMPDIFF(SECOND, i.sent_at, i.ready_at)";
  const [stations] = await pool.query(
    `SELECT COALESCE(i.station, '') station, COUNT(*) items, AVG(${PREP}) avg_s, MAX(${PREP}) max_s, SUM(${PREP} > ?) late_items
       FROM food_order_items i WHERE i.business_id = ? AND i.ready_at IS NOT NULL AND i.sent_at BETWEEN ? AND ? GROUP BY i.station ORDER BY avg_s DESC`, [s.delayMinutes * 60, bid, r.start, r.end]);
  const [products] = await pool.query(
    `SELECT ${NAME} name, COUNT(*) times, SUM(i.qty) qty, AVG(${PREP}) avg_s FROM food_order_items i JOIN products p ON p.id = i.product_id
      WHERE i.business_id = ? AND i.ready_at IS NOT NULL AND i.sent_at BETWEEN ? AND ? GROUP BY i.product_id ORDER BY avg_s DESC LIMIT 30`, [bid, r.start, r.end]);
  const [delayed] = await pool.query(
    `SELECT o.order_no, o.service_type, t.name table_name, o.sent_at, o.ready_at, TIMESTAMPDIFF(SECOND, o.sent_at, COALESCE(o.ready_at, UTC_TIMESTAMP())) secs
       FROM food_orders o LEFT JOIN food_tables t ON t.id = o.table_id WHERE o.business_id = ? AND o.sent_at BETWEEN ? AND ? AND o.status <> 'merged'
        AND TIMESTAMPDIFF(SECOND, o.sent_at, COALESCE(o.ready_at, IF(o.status IN ('completed', 'cancelled'), o.sent_at, UTC_TIMESTAMP()))) > ? ORDER BY secs DESC LIMIT 50`, [bid, r.start, r.end, s.delayMinutes * 60]);
  const [cancelled] = await pool.query(
    `SELECT o.order_no, o.service_type, o.cancel_reason, o.closed_at, u.full_name user FROM food_orders o LEFT JOIN users u ON u.id = o.user_id
      WHERE o.business_id = ? AND o.status = 'cancelled' AND o.created_at BETWEEN ? AND ? ORDER BY o.id DESC LIMIT 50`, [bid, r.start, r.end]);
  const [services] = await pool.query(
    `SELECT o.service_type, COUNT(*) orders, COALESCE(SUM(s.total), 0) total FROM food_orders o JOIN sales s ON s.id = o.sale_id AND s.status = 'completed'
      WHERE o.business_id = ? AND s.sold_at BETWEEN ? AND ? GROUP BY o.service_type`, [bid, r.start, r.end]);
  res.json({
    range: r, delayMinutes: s.delayMinutes,
    stations: stations.map((x) => ({ station: x.station, items: Number(x.items), avgMinutes: round1(x.avg_s / 60), maxMinutes: round1(x.max_s / 60), delayed: Number(x.late_items) })),
    products: products.map((x) => ({ name: x.name, times: Number(x.times), qty: num(x.qty), avgMinutes: round1(x.avg_s / 60) })),
    delayed: delayed.map((x) => ({ number: x.order_no, service: x.service_type, table: x.table_name, sentAt: x.sent_at, minutes: round1(x.secs / 60), open: !x.ready_at })),
    cancelled: cancelled.map((x) => ({ number: x.order_no, service: x.service_type, reason: x.cancel_reason, at: x.closed_at, user: x.user })),
    services: services.map((x) => ({ service: x.service_type, orders: Number(x.orders), total: num(x.total) }))
  });
}));
const round1 = (v) => Math.round(Number(v || 0) * 10) / 10;

export default router;
