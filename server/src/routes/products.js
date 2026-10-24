import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, text, optText, id, money, quantity, withTx, ensureOwned, badRequest, num } from "../lib/http.js";
import { moveStock } from "../lib/ledger.js";
import { imageUpload, saveImage, removeImage } from "../lib/files.js";

const router = Router();
router.use(requireAuth);

/* Product photos: PNG / JPG / WEBP up to 2 MB, stored in the database (see lib/files.js). */
async function imageFrom(req) {
  if (!req.file) return null;
  const saved = await saveImage(pool, req.business.id, req.file, "product");
  if (!saved) throw badRequest({ image: "invalidImage" });
  return saved;
}

const shape = (p) => ({
  id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, unit: p.unit, imagePath: p.image_path || null,
  categoryId: p.category_id, category: p.category_name || null, brand: p.brand_name || null,
  costPrice: num(p.cost_price), sellingPrice: num(p.selling_price),
  wholesalePrice: p.wholesale_price === null ? null : num(p.wholesale_price),
  stock: num(p.stock_qty), minStock: num(p.min_stock), isActive: Boolean(p.is_active)
});

const SELECT = `SELECT p.*, c.name category_name, b.name brand_name FROM products p
  LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
  LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id`;

/* GET /api/products?q=&categoryId=&low=1&active=all */
router.get("/", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const where = ["p.business_id = ?"];
  const params = [bid];
  const q = text(req.query.q, 80);
  if (q) { where.push("(p.name LIKE ? OR p.sku = ? OR p.barcode = ?)"); params.push(`%${q}%`, q, q); }
  if (id(req.query.categoryId)) { where.push("p.category_id = ?"); params.push(id(req.query.categoryId)); }
  if (req.query.low === "1") where.push("p.stock_qty <= p.min_stock");
  if (req.query.active !== "all") where.push("p.is_active = 1");
  const [rows] = await pool.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY p.name LIMIT 500`, params);
  res.json({ products: rows.map(shape) });
}));

/* GET /api/products/barcode/:code — scanner lookup */
router.get("/barcode/:code", requirePerm("products.view"), ah(async (req, res) => {
  const code = text(req.params.code, 80);
  const [[p]] = await pool.query(`${SELECT} WHERE p.business_id = ? AND p.is_active = 1 AND (p.barcode = ? OR p.sku = ?) LIMIT 1`, [req.business.id, code, code]);
  if (!p) return res.status(404).json({ code: "notFound" });
  res.json({ product: shape(p) });
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
    name: text(body.name, 190), sku: optText(body.sku, 80), barcode: optText(body.barcode, 80),
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

function duplicate(err) {
  if (err.code !== "ER_DUP_ENTRY") return err;
  return badRequest(String(err.sqlMessage).includes("barcode") ? { barcode: "duplicate" } : { sku: "duplicate" });
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
        `INSERT INTO products (business_id, category_id, brand_id, name, sku, barcode, image_path, unit, cost_price, selling_price, wholesale_price, min_stock, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bid, await categoryId(conn, bid, d.category), await brandId(conn, bid, d.brand), d.name, d.sku, d.barcode, image, d.unit,
          d.costPrice, d.sellingPrice, d.wholesalePrice, d.minStock, d.isActive ? 1 : 0]
      );
      if (d.openingStock > 0) {
        const product = { id: r.insertId, name: d.name, stock_qty: 0 };
        await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: d.openingStock, type: "opening", note: "Opening stock" });
      }
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.created", entity: "product", entityId: r.insertId, ip: req.ip });
      return r.insertId;
    });
    res.status(201).json({ id: productId });
  } catch (err) { removeImage(image); throw duplicate(err); }
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
        `UPDATE products SET category_id = ?, brand_id = ?, name = ?, sku = ?, barcode = ?, image_path = ?, unit = ?, cost_price = ?, selling_price = ?,
                wholesale_price = ?, min_stock = ?, is_active = ? WHERE id = ? AND business_id = ?`,
        [await categoryId(conn, bid, d.category), await brandId(conn, bid, d.brand), d.name, d.sku, d.barcode, next, d.unit, d.costPrice,
          d.sellingPrice, d.wholesalePrice, d.minStock, d.isActive ? 1 : 0, p.id, bid]
      );
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.updated", entity: "product", entityId: p.id, ip: req.ip });
      return p.image_path !== next ? p.image_path : null;
    });
    removeImage(oldImage);
    res.json({ code: "saved" });
  } catch (err) { removeImage(image); throw duplicate(err); }
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
    await moveStock(conn, { businessId: bid, userId: req.user.id, product: p, qtyChange: Math.round(change * 1000) / 1000, type: "adjustment", note: reason });
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
          `INSERT INTO products (business_id, category_id, name, sku, barcode, unit, cost_price, selling_price, wholesale_price, min_stock)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [bid, await categoryId(conn, bid, d.category), d.name, d.sku, d.barcode, d.unit, d.costPrice, d.sellingPrice, d.wholesalePrice, d.minStock]
        );
        if (d.openingStock > 0) {
          await moveStock(conn, { businessId: bid, userId: req.user.id, product: { id: ins.insertId, name: d.name, stock_qty: 0 }, qtyChange: d.openingStock, type: "opening", note: "Imported opening stock" });
        }
        n++;
      }
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.imported", meta: { count: n }, ip: req.ip });
      return n;
    });
    res.status(201).json({ created });
  } catch (err) { throw duplicate(err); }
}));

export default router;
