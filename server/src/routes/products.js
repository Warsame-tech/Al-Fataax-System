import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, text, optText, id, money, quantity, withTx, ensureOwned, badRequest, num, HttpError } from "../lib/http.js";
import { moveStock } from "../lib/ledger.js";
import { imageUpload, saveImage, removeImage } from "../lib/files.js";
import { defaultLocationId } from "../lib/stock.js";
import { productName } from "../lib/productName.js";

const router = Router();
router.use(requireAuth);

/* Product photos: PNG / JPG / WEBP up to 2 MB, stored in the database (see lib/files.js). */
async function imageFrom(req) {
  if (!req.file) return null;
  const saved = await saveImage(pool, req.business.id, req.file, "product");
  if (!saved) throw badRequest({ image: "invalidImage" });
  return saved;
}

/*
 * stock = total of all locations. When a location is asked for (?location=default or ?locationId=),
 * stock is the quantity at that location (POS and invoices sell from the default location),
 * and totalStock keeps the total.
 */
const shape = (p) => ({
  id: p.id, name: productName(p), baseName: p.name, size: p.size || "", description: p.description || "", sku: p.sku, barcode: p.barcode, unit: p.unit, imagePath: p.image_path || null,
  categoryId: p.category_id, category: p.category_name || null, brandId: p.brand_id, brand: p.brand_name || null, subcategory: p.subcategory || null,
  costPrice: num(p.cost_price), sellingPrice: num(p.selling_price),
  wholesalePrice: p.wholesale_price === null ? null : num(p.wholesale_price),
  stock: p.loc_qty === undefined ? num(p.stock_qty) : num(p.loc_qty ?? 0), totalStock: num(p.stock_qty),
  minStock: num(p.min_stock), isActive: Boolean(p.is_active),
  stockStatus: num(p.stock_qty) < 0 ? "negative" : num(p.stock_qty) === 0 ? "out" : num(p.stock_qty) <= num(p.min_stock) ? "low" : "in"
});

const SELECT = `SELECT p.*, c.name category_name, b.name brand_name FROM products p
  LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
  LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id`;

/* Location asked for by the request: ?location=default or ?locationId=<id> (null = totals). */
async function requestedLocation(req) {
  if (req.query.location === "default") return defaultLocationId(pool, req.business.id);
  return id(req.query.locationId) || null;
}
const withLocation = (loc) => (loc
  ? `SELECT p.*, c.name category_name, b.name brand_name, ps.qty loc_qty FROM products p
      LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
      LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
      LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.location_id = ${Number(loc)}`
  : SELECT);

const SORTS = { name: "p.name, p.size", size: "p.size", sku: "p.sku", category: "c.name", brand: "b.name", cost: "p.cost_price", price: "p.selling_price", stock: "p.stock_qty", updated: "p.updated_at" };
const STATUS_WHERE = {
  in: "p.stock_qty > p.min_stock", low: "p.stock_qty > 0 AND p.stock_qty <= p.min_stock",
  out: "p.stock_qty = 0", negative: "p.stock_qty < 0", lowOrOut: "p.stock_qty <= p.min_stock"
};

/*
 * GET /api/products — filters work together:
 *   q (name / SKU / barcode), brandId, categoryId, subcategory, status (in|low|out|negative), locationId (has stock there),
 *   supplierId (bought from that supplier), active=all, low=1 (old: low or out)
 *   sort (name|sku|category|brand|cost|price|stock|updated) + dir (asc|desc), page + pageSize (optional; default: up to 500)
 *   location=default | locationId → stock at that location
 */
router.get("/", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const where = ["p.business_id = ?"];
  const params = [bid];
  const q = text(req.query.q, 80);
  if (q) { where.push("(CONCAT_WS(' ', p.name, NULLIF(p.size, '')) LIKE ? OR p.sku LIKE ? OR p.barcode = ?)"); params.push(`%${q}%`, `%${q}%`, q); }
  if (id(req.query.categoryId)) { where.push("p.category_id = ?"); params.push(id(req.query.categoryId)); }
  if (id(req.query.brandId)) { where.push("p.brand_id = ?"); params.push(id(req.query.brandId)); }
  const sub = text(req.query.subcategory, 120);
  if (sub) { where.push("p.subcategory = ?"); params.push(sub); }
  if (STATUS_WHERE[req.query.status]) where.push(STATUS_WHERE[req.query.status]);
  if (req.query.low === "1") where.push(STATUS_WHERE.lowOrOut);
  if (id(req.query.supplierId)) {
    where.push(`EXISTS (SELECT 1 FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id AND pu.business_id = pi.business_id
                 WHERE pi.business_id = p.business_id AND pi.product_id = p.id AND pu.supplier_id = ?)`);
    params.push(id(req.query.supplierId));
  }
  if (id(req.query.stockAt)) { where.push("EXISTS (SELECT 1 FROM product_stock s2 WHERE s2.product_id = p.id AND s2.location_id = ? AND s2.qty <> 0)"); params.push(id(req.query.stockAt)); }
  if (req.query.active !== "all") where.push("p.is_active = 1");
  const loc = await requestedLocation(req);
  const sort = SORTS[req.query.sort] || "p.name";
  const dir = req.query.dir === "desc" ? "DESC" : "ASC";
  const paged = req.query.page !== undefined;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
  const base = `${withLocation(loc)} WHERE ${where.join(" AND ")}`;
  const [rows] = await pool.query(`${base} ORDER BY ${sort} ${dir}, p.name ASC, p.id ASC LIMIT ? OFFSET ?`,
    [...params, paged ? pageSize : 500, paged ? (page - 1) * pageSize : 0]);
  let total = rows.length;
  if (paged) {
    const [[c]] = await pool.query(`SELECT COUNT(*) n FROM products p WHERE ${where.join(" AND ")}`, params);
    total = Number(c.n);
  }
  res.json({ products: rows.map(shape), total, page: paged ? page : 1, pageSize: paged ? pageSize : rows.length });
}));

/* GET /api/products/filters — options for the filter dropdowns */
router.get("/filters", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const [[categories], [brands], [subs], [suppliers], [locations]] = await Promise.all([
    pool.query("SELECT id, name FROM categories WHERE business_id = ? ORDER BY name", [bid]),
    pool.query("SELECT id, name FROM brands WHERE business_id = ? ORDER BY name", [bid]),
    pool.query("SELECT DISTINCT subcategory name FROM products WHERE business_id = ? AND subcategory IS NOT NULL AND subcategory <> '' ORDER BY subcategory", [bid]),
    pool.query("SELECT id, name FROM suppliers WHERE business_id = ? ORDER BY name", [bid]),
    pool.query("SELECT id, name FROM stock_locations WHERE business_id = ? AND is_active = 1 ORDER BY is_default DESC, name", [bid])
  ]);
  res.json({ categories, brands, subcategories: subs.map((r) => r.name), suppliers, locations });
}));

/* GET /api/products/barcode/:code — scanner lookup (active products; ?location=default for stock at the selling location) */
router.get("/barcode/:code", requirePerm("products.view"), ah(async (req, res) => {
  const code = text(req.params.code, 80);
  const loc = await requestedLocation(req);
  const [[p]] = await pool.query(`${withLocation(loc)} WHERE p.business_id = ? AND p.is_active = 1 AND (p.barcode = ? OR p.sku = ?) LIMIT 1`, [req.business.id, code, code]);
  if (!p) return res.status(404).json({ code: "notFound" });
  res.json({ product: shape(p) });
}));

/* GET /api/products/check-barcode/:code — for the product form: is this barcode already used (also by inactive products)? */
router.get("/check-barcode/:code", requirePerm("products.view"), ah(async (req, res) => {
  const code = text(req.params.code, 80);
  const [[p]] = await pool.query(`${SELECT} WHERE p.business_id = ? AND p.barcode = ? LIMIT 1`, [req.business.id, code]);
  res.json({ product: p ? shape(p) : null });
}));

/* GET /api/products/categories */
router.get("/categories", requirePerm("products.view"), ah(async (req, res) => {
  const [rows] = await pool.query("SELECT id, name FROM categories WHERE business_id = ? ORDER BY name", [req.business.id]);
  res.json({ categories: rows });
}));

async function categoryId(conn, bid, name) {
  const n = text(name, 120);
  if (!n) return null;
  await conn.query("INSERT IGNORE INTO categories (business_id, name) VALUES (?, ?)", [bid, n]);
  const [[c]] = await conn.query("SELECT id FROM categories WHERE business_id = ? AND name = ?", [bid, n]);
  return c.id;
}
async function brandId(conn, bid, name) {
  const n = text(name, 120);
  if (!n) return null;
  await conn.query("INSERT IGNORE INTO brands (business_id, name) VALUES (?, ?)", [bid, n]);
  const [[b]] = await conn.query("SELECT id FROM brands WHERE business_id = ? AND name = ?", [bid, n]);
  return b.id;
}

function readProduct(body, { creating }) {
  const d = {
    name: text(body.name, 190), size: optText(body.size, 40), sku: optText(body.sku, 80), barcode: optText(body.barcode, 80),
    subcategory: optText(body.subcategory, 120), description: optText(body.description, 2000),
    unit: text(body.unit, 20) || "pcs", category: text(body.category, 120), brand: text(body.brand, 120),
    costPrice: money(body.costPrice), sellingPrice: money(body.sellingPrice),
    wholesalePrice: body.wholesalePrice === "" || body.wholesalePrice == null ? null : money(body.wholesalePrice),
    minStock: body.minStock === "" || body.minStock == null ? 0 : Number(body.minStock),
    openingStock: creating ? (body.openingStock === "" || body.openingStock == null ? 0 : Number(body.openingStock)) : 0,
    // multipart sends "true"/"false" strings
    isActive: body.isActive === undefined ? true : body.isActive === true || body.isActive === "true"
  };
  const e = {};
  if (d.name.length < 1) e.name = "required";
  if (Number.isNaN(d.costPrice)) e.costPrice = "invalidAmount";
  if (Number.isNaN(d.sellingPrice)) e.sellingPrice = "invalidAmount";
  if (d.wholesalePrice !== null && Number.isNaN(d.wholesalePrice)) e.wholesalePrice = "invalidAmount";
  if (!Number.isFinite(d.minStock) || d.minStock < 0) e.minStock = "invalidAmount";
  if (!Number.isFinite(d.openingStock) || d.openingStock < 0) e.openingStock = "invalidAmount";
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}

/* Duplicate barcode / SKU → a clear message naming the product that already uses it. */
async function duplicate(err, bid, d) {
  if (err.code !== "ER_DUP_ENTRY") return err;
  const isBarcode = String(err.sqlMessage).includes("barcode");
  const field = isBarcode ? "barcode" : "sku";
  const [[other]] = await pool.query(`SELECT name FROM products WHERE business_id = ? AND ${field} = ? LIMIT 1`, [bid, isBarcode ? d.barcode : d.sku]).catch(() => [[null]]);
  return new HttpError(400, "validation", { [field]: isBarcode ? "barcodeTaken" : "duplicate" }, other ? { usedBy: other.name } : null);
}

/* POST /api/products */
router.post("/", requirePerm("products.edit"), imageUpload.single("image"), ah(async (req, res) => {
  let d;
  d = readProduct(req.body || {}, { creating: true });
  const image = await imageFrom(req);
  const bid = req.business.id;
  try {
    const productId = await withTx(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO products (business_id, category_id, brand_id, subcategory, name, size, description, sku, barcode, image_path, unit, cost_price, selling_price, wholesale_price, min_stock, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bid, await categoryId(conn, bid, d.category), await brandId(conn, bid, d.brand), d.subcategory, d.name, d.size, d.description, d.sku, d.barcode, image, d.unit,
          d.costPrice, d.sellingPrice, d.wholesalePrice, d.minStock, d.isActive ? 1 : 0]
      );
      // A product can exist with zero stock. Opening stock is normally entered in Stock → Opening stock.
      if (d.openingStock > 0) {
        const product = { id: r.insertId, name: d.name, stock_qty: 0, unit: d.unit, cost_price: d.costPrice };
        await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: d.openingStock, type: "opening", refType: "stock", reason: "opening", note: "Opening stock" });
      }
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.created", entity: "product", entityId: r.insertId, ip: req.ip });
      return r.insertId;
    });
    res.status(201).json({ id: productId });
  } catch (err) { removeImage(image); throw await duplicate(err, bid, d); }
}));

/* PUT /api/products/:id (stock is changed only through movements, never here) */
/* multipart: product fields + optional "image" file; removeImage=true clears the photo */
router.put("/:id", requirePerm("products.edit"), imageUpload.single("image"), ah(async (req, res) => {
  let d;
  d = readProduct(req.body || {}, { creating: false });
  const image = await imageFrom(req);
  const bid = req.business.id;
  try {
    const oldImage = await withTx(async (conn) => {
      const p = await ensureOwned(conn, "products", id(req.params.id), bid, true);
      const next = image || (req.body?.removeImage === "true" ? null : p.image_path);
      await conn.query(
        `UPDATE products SET category_id = ?, brand_id = ?, subcategory = ?, name = ?, size = ?, description = ?, sku = ?, barcode = ?, image_path = ?, unit = ?, cost_price = ?, selling_price = ?,
                wholesale_price = ?, min_stock = ?, is_active = ? WHERE id = ? AND business_id = ?`,
        [await categoryId(conn, bid, d.category), await brandId(conn, bid, d.brand), d.subcategory, d.name, d.size, d.description, d.sku, d.barcode, next, d.unit, d.costPrice,
          d.sellingPrice, d.wholesalePrice, d.minStock, d.isActive ? 1 : 0, p.id, bid]
      );
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.updated", entity: "product", entityId: p.id, ip: req.ip });
      return p.image_path !== next ? p.image_path : null;
    });
    removeImage(oldImage);
    res.json({ code: "saved" });
  } catch (err) { removeImage(image); throw await duplicate(err, bid, d); }
}));

/* POST /api/products/:id/adjust  { qtyChange: +/-, reason } — authorized adjustments only */
router.post("/:id/adjust", requirePerm("stock.adjust"), ah(async (req, res) => {
  const change = Number(req.body?.qtyChange);
  const reason = text(req.body?.reason, 200);
  const e = {};
  if (!Number.isFinite(change) || change === 0) e.qtyChange = "invalidAmount";
  if (!reason) e.reason = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const bid = req.business.id;
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "products", id(req.params.id), bid, true);
    await moveStock(conn, { businessId: bid, userId: req.user.id, product: p, qtyChange: Math.round(change * 1000) / 1000, type: "adjustment", refType: "stock", reason: "other", note: reason });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "stock.adjusted", entity: "product", entityId: p.id, meta: { change, reason }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/* GET /api/products/:id/movements */
router.get("/:id/movements", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  await ensureOwned(pool, "products", id(req.params.id), bid);
  const [rows] = await pool.query(
    `SELECT m.type, m.qty_change, m.note, m.ref_type, m.ref_id, m.created_at, u.full_name user_name
       FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.business_id = ? AND m.product_id = ? ORDER BY m.id DESC LIMIT 200`,
    [bid, id(req.params.id)]
  );
  res.json({ movements: rows.map((m) => ({ type: m.type, change: num(m.qty_change), note: m.note, at: m.created_at, user: m.user_name })) });
}));

/* POST /api/products/import  { rows: [{name, sku, barcode, category, unit, costPrice, sellingPrice, wholesalePrice, minStock, openingStock}] } */
router.post("/import", requirePerm("products.edit"), ah(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [];
  if (!rows.length) throw badRequest({ rows: "required" });
  const bid = req.business.id;
  const errors = [];
  rows.forEach((r, i) => { try { readProduct(r, { creating: true }); } catch (e) { errors.push({ row: i + 2, errors: e.errors }); } });
  if (errors.length) return res.status(400).json({ code: "importErrors", rows: errors.slice(0, 50) });
  try {
    const created = await withTx(async (conn) => {
      let n = 0;
      for (const r of rows) {
        const d = readProduct(r, { creating: true });
        const [ins] = await conn.query(
          `INSERT INTO products (business_id, category_id, name, size, sku, barcode, unit, cost_price, selling_price, wholesale_price, min_stock)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [bid, await categoryId(conn, bid, d.category), d.name, d.size, d.sku, d.barcode, d.unit, d.costPrice, d.sellingPrice, d.wholesalePrice, d.minStock]
        );
        if (d.openingStock > 0) {
          await moveStock(conn, { businessId: bid, userId: req.user.id, product: { id: ins.insertId, name: d.name, stock_qty: 0, unit: d.unit, cost_price: d.costPrice }, qtyChange: d.openingStock, type: "opening", refType: "stock", reason: "opening", note: "Imported opening stock" });
        }
        n++;
      }
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.imported", meta: { count: n }, ip: req.ip });
      return n;
    });
    res.status(201).json({ created });
  } catch (err) { throw await duplicate(err, bid, {}); }
}));

export default router;
