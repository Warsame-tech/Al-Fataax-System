import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, text, optText, id, money, withTx, ensureOwned, badRequest, num, HttpError } from "../lib/http.js";
import { moveStock } from "../lib/ledger.js";
import { imageUpload, saveImage, removeImage } from "../lib/files.js";
import { defaultLocationId } from "../lib/stock.js";
import { productName, productNameSql } from "../lib/productName.js";
import { startBatchTracking } from "../lib/batches.js";
import { readPackaging, packagingOf } from "../lib/packaging.js";
import { TRACKING } from "../lib/devices.js";
import { conflict } from "../lib/http.js";
import { currentRates, weightPrice, netWeight } from "../lib/jewelry.js";

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
 * Variant fields (size, shade, fragrance, formula, packSize) are part of the shown name.
 */
const shape = (p, rates = null) => withJewelry(p, rates, {
  id: p.id, name: productName(p), baseName: p.name, size: p.size || "", shade: p.shade || "", fragrance: p.fragrance || "", formula: p.formula || "",
  packSize: p.pack_size || "", variantOf: p.variant_of || null, variantCount: p.variant_count === undefined ? undefined : Number(p.variant_count),
  description: p.description || "", sku: p.sku, barcode: p.barcode, unit: p.unit, imagePath: p.image_path || null,
  categoryId: p.category_id, category: p.category_name || null, brandId: p.brand_id, brand: p.brand_name || null, subcategory: p.subcategory || null,
  costPrice: num(p.cost_price), sellingPrice: num(p.selling_price),
  wholesalePrice: p.wholesale_price === null ? null : num(p.wholesale_price),
  stock: p.loc_qty === undefined ? num(p.stock_qty) : num(p.loc_qty ?? 0), totalStock: num(p.stock_qty),
  minStock: num(p.min_stock), isActive: Boolean(p.is_active), trackBatches: Boolean(p.track_batches), nextExpiry: p.next_expiry || null,
  // pharmacy: medicine details and packaging (packs above the base unit, see lib/packaging.js)
  genericName: p.generic_name || "", dosageForm: p.dosage_form || "", manufacturer: p.manufacturer || "", supplierId: p.supplier_id || null,
  supplier: p.supplier_name || null, rxRequired: Boolean(p.rx_required), storageInstructions: p.storage_instructions || "", packaging: packagingOf(p),
  // electronics: type, model, specs, tracking (qty / serial / imei / serial_imei), warranty policy, minimum price
  collection: p.collection || "", season: p.season || "",
  productType: p.product_type || "", modelNumber: p.model_number || "", countryOfOrigin: p.country_of_origin || "", notes: p.notes || "",
  specs: specsOf(p), tracking: p.tracking || "qty", minPrice: p.min_price === null || p.min_price === undefined ? null : num(p.min_price),
  warrantyMonths: p.warranty_months ?? null, warrantyProvider: p.warranty_provider || "", warrantyTerms: p.warranty_terms || "",
  stockStatus: num(p.stock_qty) < 0 ? "negative" : num(p.stock_qty) === 0 ? "out" : num(p.stock_qty) <= num(p.min_stock) ? "low" : "in"
});

function specsOf(p) { try { return JSON.parse(p.specs || "{}") || {}; } catch { return {}; } }

/* Technical specifications from the form: { "RAM": "8 GB", … } (multipart: JSON string), up to 60 fields. */
function readSpecs(raw) {
  let o = raw;
  if (typeof raw === "string") { try { o = raw.trim() ? JSON.parse(raw) : {}; } catch { o = {}; } }
  if (!o || typeof o !== "object" || Array.isArray(o)) return {};
  const out = {};
  for (const [k, v] of Object.entries(o).slice(0, 60)) {
    const key = String(k).trim().slice(0, 60);
    const val = v === null || v === undefined ? "" : String(v).trim().slice(0, 120);
    if (key && val) out[key] = val;
  }
  return out;
}

/*
 * Jewelry: weights, purity and pricing; a weight-priced item's selling price is today's price
 * (net weight × current rate + making + extra — lib/jewelry.js), with the breakdown in priceDetail.
 */
function withJewelry(p, rates, out) {
  if (!p.metal && p.pricing_mode !== "weight" && !p.unique_item) return out;
  const live = weightPrice(p, rates);
  return {
    ...out,
    metal: p.metal || "", purity: p.purity || "", grossWeight: p.gross_weight === null ? null : num(p.gross_weight),
    stoneWeight: p.stone_weight === null ? null : num(p.stone_weight), netWeight: netWeight(p.gross_weight, p.stone_weight),
    pricingMode: p.pricing_mode || "fixed", makingCharge: p.making_charge === null ? null : num(p.making_charge), makingType: p.making_type || "per_gram",
    extraCharge: p.extra_charge === null ? null : num(p.extra_charge), uniqueItem: Boolean(p.unique_item), itemStatus: p.item_status || "active",
    fixedPrice: num(p.selling_price),
    ...(live ? { sellingPrice: live.price, priceDetail: live.detail } : p.pricing_mode === "weight" ? { priceDetail: null, noRate: true } : {})
  };
}

/* nearest expiry of the stock on hand, and how many products are in the variant group */
const EXTRAS = `(SELECT MIN(pb.expiry_date) FROM product_batches pb WHERE pb.product_id = p.id AND pb.qty > 0 AND pb.expiry_date IS NOT NULL) next_expiry,
  (SELECT COUNT(*) FROM products v WHERE v.business_id = p.business_id AND COALESCE(v.variant_of, v.id) = COALESCE(p.variant_of, p.id)) variant_count`;
const SELECT = `SELECT p.*, c.name category_name, b.name brand_name, sp.name supplier_name, ${EXTRAS} FROM products p
  LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
  LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
  LEFT JOIN suppliers sp ON sp.id = p.supplier_id AND sp.business_id = p.business_id`;

/* Location asked for by the request: ?location=default or ?locationId=<id> (null = totals). */
async function requestedLocation(req) {
  if (req.query.location === "default") return defaultLocationId(pool, req.business.id);
  return id(req.query.locationId) || null;
}
const withLocation = (loc) => (loc
  ? `SELECT p.*, c.name category_name, b.name brand_name, sp.name supplier_name, ps.qty loc_qty, ${EXTRAS} FROM products p
      LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
      LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
      LEFT JOIN suppliers sp ON sp.id = p.supplier_id AND sp.business_id = p.business_id
      LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.location_id = ${Number(loc)}`
  : SELECT);

const SORTS = { name: "p.name, p.size, p.shade", size: "p.size", value: "(p.stock_qty * p.cost_price)", sku: "p.sku", category: "c.name", brand: "b.name", cost: "p.cost_price", price: "p.selling_price", stock: "p.stock_qty", updated: "p.updated_at", expiry: "next_expiry IS NULL, next_expiry" };
const STATUS_WHERE = {
  in: "p.stock_qty > p.min_stock", low: "p.stock_qty > 0 AND p.stock_qty <= p.min_stock",
  out: "p.stock_qty = 0", negative: "p.stock_qty < 0", lowOrOut: "p.stock_qty <= p.min_stock"
};
const EXPIRY_WHERE = {
  expired: "EXISTS (SELECT 1 FROM product_batches eb WHERE eb.product_id = p.id AND eb.qty > 0 AND eb.expiry_date < UTC_DATE())",
  soon: "EXISTS (SELECT 1 FROM product_batches eb WHERE eb.product_id = p.id AND eb.qty > 0 AND eb.expiry_date BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL ? DAY)"
};

/*
 * GET /api/products — filters work together:
 *   q (name / variant / SKU / barcode, also packaging barcodes), brandId, categoryId, subcategory, status (in|low|out|negative),
 *   stockAt (has stock there), supplierId (bought from that supplier), active=all|archived, low=1 (old: low or out),
 *   expiry=expired|soon (batch-tracked stock), variantOf=<id> (one variant group), id=<id> (one product), productType
 *   sort (name|sku|category|brand|cost|price|stock|updated|expiry) + dir (asc|desc), page + pageSize (optional; default: up to 500)
 *   location=default | locationId → stock at that location
 */
router.get("/", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const where = ["p.business_id = ?"];
  const params = [bid];
  const q = text(req.query.q, 80);
  if (q) {
    where.push(`(${productNameSql("p")} LIKE ? OR p.generic_name LIKE ? OR p.sku LIKE ? OR p.barcode = ? OR p.model_number LIKE ? OR b.name LIKE ? OR p.product_type LIKE ?
      OR EXISTS (SELECT 1 FROM product_barcodes xb WHERE xb.product_id = p.id AND xb.barcode = ?))`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, q, `%${q}%`, `%${q}%`, `%${q}%`, q);
  }
  if (id(req.query.categoryId)) { where.push("p.category_id = ?"); params.push(id(req.query.categoryId)); }
  if (id(req.query.brandId)) { where.push("p.brand_id = ?"); params.push(id(req.query.brandId)); }
  const sub = text(req.query.subcategory, 120);
  if (sub) { where.push("p.subcategory = ?"); params.push(sub); }
  if (STATUS_WHERE[req.query.status]) where.push(STATUS_WHERE[req.query.status]);
  if (req.query.low === "1") where.push(STATUS_WHERE.lowOrOut);
  if (req.query.expiry === "expired") where.push(EXPIRY_WHERE.expired);
  if (req.query.expiry === "soon") { where.push(EXPIRY_WHERE.soon); params.push(req.business.profile.expirySoonDays); }
  if (id(req.query.variantOf)) { where.push("COALESCE(p.variant_of, p.id) = ?"); params.push(id(req.query.variantOf)); }
  if (id(req.query.id)) { where.push("p.id = ?"); params.push(id(req.query.id)); }
  const ptype = text(req.query.productType, 60);
  if (ptype) { where.push("p.product_type = ?"); params.push(ptype); }
  if (id(req.query.supplierId)) {
    where.push(`EXISTS (SELECT 1 FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id AND pu.business_id = pi.business_id
                 WHERE pi.business_id = p.business_id AND pi.product_id = p.id AND pu.supplier_id = ?)`);
    params.push(id(req.query.supplierId));
  }
  if (id(req.query.stockAt)) { where.push("EXISTS (SELECT 1 FROM product_stock s2 WHERE s2.product_id = p.id AND s2.location_id = ? AND s2.qty <> 0)"); params.push(id(req.query.stockAt)); }
  if (req.query.active === "archived") where.push("p.is_active = 0");
  else if (req.query.active !== "all") where.push("p.is_active = 1");
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
  let summary;
  if (paged) {
    const [[c]] = await pool.query(
      `SELECT COUNT(*) n, COALESCE(SUM(p.stock_qty), 0) units, COALESCE(SUM(p.stock_qty * p.cost_price), 0) value
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id AND b.business_id = p.business_id
         LEFT JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id WHERE ${where.join(" AND ")}`, params);
    total = Number(c.n);
    summary = { count: total, units: num(c.units), stockValue: Math.round(num(c.value) * 10000) / 10000 };
  }
  const rates = req.business.profile.jewelry ? await currentRates(pool, bid) : null;
  res.json({ products: rows.map((p) => shape(p, rates)), total, summary, page: paged ? page : 1, pageSize: paged ? pageSize : rows.length });
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

/*
 * GET /api/products/barcode/:code — scanner lookup (active products; ?location=default for stock at the selling location).
 * A packaging barcode (product_barcodes) answers with the product and pack: { label, qty } — scanning it counts that many units.
 */
router.get("/barcode/:code", requirePerm("products.view"), ah(async (req, res) => {
  const code = text(req.params.code, 80);
  const loc = await requestedLocation(req);
  const [[p]] = await pool.query(`${withLocation(loc)} WHERE p.business_id = ? AND p.is_active = 1 AND (p.barcode = ? OR p.sku = ?) LIMIT 1`, [req.business.id, code, code]);
  const rates = req.business.profile.jewelry ? await currentRates(pool, req.business.id) : null;
  if (p) return res.json({ product: shape(p, rates), pack: null });
  const [[x]] = await pool.query(
    `${withLocation(loc)} JOIN product_barcodes xb ON xb.product_id = p.id AND xb.business_id = p.business_id
      WHERE p.business_id = ? AND p.is_active = 1 AND xb.barcode = ? LIMIT 1`, [req.business.id, code]);
  if (!x) return res.status(404).json({ code: "notFound" });
  const [[pack]] = await pool.query("SELECT pack_label, pack_qty FROM product_barcodes WHERE business_id = ? AND barcode = ? AND product_id = ? LIMIT 1", [req.business.id, code, x.id]);
  res.json({ product: shape(x, rates), pack: { label: pack.pack_label || null, qty: num(pack.pack_qty) || 1 } });
}));

/* GET /api/products/check-barcode/:code — for the product form: is this barcode already used (also by archived products, and as a packaging barcode)? */
router.get("/check-barcode/:code", requirePerm("products.view"), ah(async (req, res) => {
  const code = text(req.params.code, 80);
  const [[p]] = await pool.query(
    `${SELECT} WHERE p.business_id = ? AND (p.barcode = ? OR EXISTS (SELECT 1 FROM product_barcodes xb WHERE xb.product_id = p.id AND xb.barcode = ?)) LIMIT 1`,
    [req.business.id, code, code]);
  res.json({ product: p ? shape(p, null) : null, allowDuplicates: req.business.allowDuplicateCodes });
}));

/* GET /api/products/categories */
router.get("/categories", requirePerm("products.view"), ah(async (req, res) => {
  const [rows] = await pool.query("SELECT id, name FROM categories WHERE business_id = ? ORDER BY name", [req.business.id]);
  res.json({ categories: rows });
}));

/* PUT /api/products/settings { allowDuplicateCodes } — owner setting: may products share a SKU / barcode? */
router.put("/settings", requirePerm("settings.edit"), ah(async (req, res) => {
  const allow = req.body?.allowDuplicateCodes === true;
  await pool.query("UPDATE business_settings SET allow_duplicate_codes = ? WHERE business_id = ?", [allow ? 1 : 0, req.business.id]);
  await audit(pool, { businessId: req.business.id, userId: req.user.id, action: "settings.duplicateCodes", meta: { allow }, ip: req.ip });
  res.json({ code: "saved", allowDuplicateCodes: allow });
}));

/* Extra technical specification fields per product type, set by the owner: { "Smartphone": ["Water resistance"], … } */
router.get("/spec-fields", requirePerm("products.view"), ah(async (req, res) => {
  const [[s]] = await pool.query("SELECT spec_fields FROM business_settings WHERE business_id = ?", [req.business.id]);
  let fields = {};
  try { fields = JSON.parse(s?.spec_fields || "{}") || {}; } catch { fields = {}; }
  res.json({ fields });
}));
router.put("/spec-fields", requirePerm("settings.edit"), ah(async (req, res) => {
  const raw = req.body?.fields && typeof req.body.fields === "object" ? req.body.fields : {};
  const fields = {};
  for (const [type, list] of Object.entries(raw).slice(0, 60)) {
    const t = String(type).trim().slice(0, 60);
    const names = (Array.isArray(list) ? list : []).map((x) => String(x).trim().slice(0, 60)).filter(Boolean);
    if (t && names.length) fields[t] = [...new Set(names)].slice(0, 30);
  }
  await pool.query("UPDATE business_settings SET spec_fields = ? WHERE business_id = ?", [JSON.stringify(fields), req.business.id]);
  await audit(pool, { businessId: req.business.id, userId: req.user.id, action: "settings.specFields", ip: req.ip });
  res.json({ fields });
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

/* Default supplier of a product (must be one of the business's suppliers). */
async function supplierOf(conn, bid, supplierId) {
  if (!supplierId) return null;
  await ensureOwned(conn, "suppliers", supplierId, bid);
  return supplierId;
}

/* Packaging barcodes from the form: [{ barcode, label, qty }] (multipart sends it as a JSON string). */
function readBarcodes(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).map((x) => ({ barcode: text(x?.barcode, 80), label: optText(x?.label, 60), qty: Number(x?.qty) }))
    .filter((x) => x.barcode);
}

function readProduct(body, { creating }) {
  const d = {
    name: text(body.name, 190), size: optText(body.size, 40), shade: optText(body.shade, 60), fragrance: optText(body.fragrance, 60),
    formula: optText(body.formula, 60), packSize: optText(body.packSize, 40),
    sku: optText(body.sku, 80), barcode: optText(body.barcode, 80),
    subcategory: optText(body.subcategory, 120), description: optText(body.description, 2000),
    unit: text(body.unit, 20) || "pcs", category: text(body.category, 120), brand: text(body.brand, 120),
    costPrice: money(body.costPrice), sellingPrice: money(body.sellingPrice),
    wholesalePrice: body.wholesalePrice === "" || body.wholesalePrice == null ? null : money(body.wholesalePrice),
    minStock: body.minStock === "" || body.minStock == null ? 0 : Number(body.minStock),
    openingStock: creating ? (body.openingStock === "" || body.openingStock == null ? 0 : Number(body.openingStock)) : 0,
    // multipart sends "true"/"false" strings
    isActive: body.isActive === undefined ? true : body.isActive === true || body.isActive === "true",
    trackBatches: body.trackBatches === true || body.trackBatches === "true",
    barcodes: body.barcodes === undefined ? null : readBarcodes(body.barcodes),
    variantOf: creating ? id(body.variantOf) : null,
    genericName: optText(body.genericName, 190), dosageForm: optText(body.dosageForm, 40), manufacturer: optText(body.manufacturer, 150),
    supplierId: id(body.supplierId), rxRequired: body.rxRequired === true || body.rxRequired === "true",
    storageInstructions: optText(body.storageInstructions, 255),
    collection: optText(body.collection, 80), season: optText(body.season, 40),
    // jewelry
    metal: optText(body.metal, 20), purity: optText(body.purity, 20),
    grossWeight: body.grossWeight === "" || body.grossWeight == null ? null : Number(body.grossWeight),
    stoneWeight: body.stoneWeight === "" || body.stoneWeight == null ? null : Number(body.stoneWeight),
    pricingMode: body.pricingMode === "weight" ? "weight" : "fixed",
    makingCharge: body.makingCharge === "" || body.makingCharge == null ? null : money(body.makingCharge),
    makingType: body.makingType === "fixed" ? "fixed" : "per_gram",
    extraCharge: body.extraCharge === "" || body.extraCharge == null ? null : money(body.extraCharge),
    uniqueItem: body.uniqueItem === true || body.uniqueItem === "true",
    itemStatus: ["active", "returned", "damaged"].includes(body.itemStatus) ? body.itemStatus : null,
    productType: optText(body.productType, 60), modelNumber: optText(body.modelNumber, 80), countryOfOrigin: optText(body.countryOfOrigin, 60),
    notes: optText(body.notes, 2000), specs: body.specs === undefined ? undefined : JSON.stringify(readSpecs(body.specs)),
    tracking: TRACKING.includes(body.tracking) ? body.tracking : "qty",
    minPrice: body.minPrice === "" || body.minPrice == null ? null : money(body.minPrice),
    warrantyMonths: body.warrantyMonths === "" || body.warrantyMonths == null ? null : Number(body.warrantyMonths),
    warrantyProvider: optText(body.warrantyProvider, 100), warrantyTerms: optText(body.warrantyTerms, 255)
  };
  const pack = readPackaging(body.packaging);
  // not sent (businesses without packaging): keep what is saved
  d.packaging = body.packaging === undefined ? undefined : pack.levels ? JSON.stringify(pack.levels) : null;
  const e = {};
  if (d.name.length < 1) e.name = "required";
  if (pack.error) e[pack.error] = "invalidAmount";
  if (d.minPrice !== null && Number.isNaN(d.minPrice)) e.minPrice = "invalidAmount";
  for (const k of ["grossWeight", "stoneWeight"]) if (d[k] !== null && (!Number.isFinite(d[k]) || d[k] < 0 || d[k] > 1e6)) e[k] = "invalidAmount";
  if (d.grossWeight !== null && d.stoneWeight !== null && d.stoneWeight > d.grossWeight) e.stoneWeight = "stoneAboveGross";
  if (d.makingCharge !== null && Number.isNaN(d.makingCharge)) e.makingCharge = "invalidAmount";
  if (d.extraCharge !== null && Number.isNaN(d.extraCharge)) e.extraCharge = "invalidAmount";
  if (d.pricingMode === "weight" && (!d.metal || !d.purity || !(d.grossWeight > 0))) e.pricingMode = "weightNeedsMetal";
  if (d.minPrice !== null && !Number.isNaN(d.minPrice) && !Number.isNaN(d.sellingPrice) && d.minPrice > d.sellingPrice) e.minPrice = "minAboveSelling";
  if (d.warrantyMonths !== null && (!Number.isInteger(d.warrantyMonths) || d.warrantyMonths < 0 || d.warrantyMonths > 240)) e.warrantyMonths = "invalidAmount";
  if (pack.levels?.some((l) => l.name === d.unit)) e.packaging = "packSameAsUnit";
  if (Number.isNaN(d.costPrice)) e.costPrice = "invalidAmount";
  if (Number.isNaN(d.sellingPrice)) e.sellingPrice = "invalidAmount";
  if (d.wholesalePrice !== null && Number.isNaN(d.wholesalePrice)) e.wholesalePrice = "invalidAmount";
  if (!Number.isFinite(d.minStock) || d.minStock < 0) e.minStock = "invalidAmount";
  if (!Number.isFinite(d.openingStock) || d.openingStock < 0) e.openingStock = "invalidAmount";
  (d.barcodes || []).forEach((x, i) => {
    if (!Number.isFinite(x.qty) || x.qty <= 0) e[`barcodes.${i}.qty`] = "invalidAmount";
    if (x.barcode === d.barcode || d.barcodes.findIndex((y) => y.barcode === x.barcode) !== i) e[`barcodes.${i}.barcode`] = "barcodeTaken";
  });
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}

/*
 * SKU and barcodes (main + packaging) must not be used by another product of the business,
 * unless the business allows duplicates (Products → Settings). When editing, only codes that changed are checked
 * (codes shared while duplicates were allowed don't block other edits later).
 */
async function checkCodes(conn, business, d, old = null) {
  if (business.allowDuplicateCodes) return;
  const productId = old?.id || 0;
  const kept = new Set(old ? (await conn.query("SELECT barcode FROM product_barcodes WHERE product_id = ?", [old.id]))[0].map((r) => r.barcode) : []);
  const bid = business.id;
  const first = async (sql, params) => (await conn.query(sql, params))[0][0] || null;
  const barcodeOwner = (code) => first(
    `SELECT p.id, ${productNameSql("p")} name FROM products p WHERE p.business_id = ? AND p.id <> ?
       AND (p.barcode = ? OR EXISTS (SELECT 1 FROM product_barcodes xb WHERE xb.product_id = p.id AND xb.barcode = ?)) LIMIT 1`, [bid, productId, code, code]);
  if (d.sku && d.sku !== old?.sku) {
    const other = await first(`SELECT ${productNameSql("p")} name FROM products p WHERE p.business_id = ? AND p.sku = ? AND p.id <> ? LIMIT 1`, [bid, d.sku, productId]);
    if (other) throw new HttpError(400, "validation", { sku: "duplicate" }, { usedBy: other.name });
  }
  if (d.barcode && d.barcode !== old?.barcode) {
    const other = await barcodeOwner(d.barcode);
    if (other) throw new HttpError(400, "validation", { barcode: "barcodeTaken" }, { usedBy: other.name });
  }
  for (const [i, x] of (d.barcodes || []).entries()) {
    if (kept.has(x.barcode)) continue;
    const other = await barcodeOwner(x.barcode);
    if (other) throw new HttpError(400, "validation", { [`barcodes.${i}.barcode`]: "barcodeTaken" }, { usedBy: other.name });
  }
}

async function saveBarcodes(conn, bid, productId, list) {
  if (list === null) return;            // not sent: keep the existing packaging barcodes
  await conn.query("DELETE FROM product_barcodes WHERE business_id = ? AND product_id = ?", [bid, productId]);
  for (const x of list) {
    await conn.query("INSERT INTO product_barcodes (business_id, product_id, barcode, pack_label, pack_qty) VALUES (?, ?, ?, ?, ?)",
      [bid, productId, x.barcode, x.label, Math.round(x.qty * 1000) / 1000]);
  }
}

/* Changes to costs, prices, reorder level and status are kept in the product's change history (audit log). */
const TRACKED = [["costPrice", "cost_price"], ["sellingPrice", "selling_price"], ["wholesalePrice", "wholesale_price"], ["minStock", "min_stock"]];
function changesOf(old, d) {
  const out = [];
  for (const [field, col] of TRACKED) {
    const before = old[col] === null ? null : num(old[col]);
    const after = d[field] === null ? null : num(d[field]);
    if (before !== after) out.push({ field, from: before, to: after });
  }
  if (Boolean(old.is_active) !== d.isActive) out.push({ field: "status", from: old.is_active ? "active" : "archived", to: d.isActive ? "active" : "archived" });
  if (Boolean(old.track_batches) !== d.trackBatches) out.push({ field: "trackBatches", from: Boolean(old.track_batches), to: d.trackBatches });
  if ((old.tracking || "qty") !== d.tracking) out.push({ field: "tracking", from: old.tracking || "qty", to: d.tracking });
  if ((old.pricing_mode || "fixed") !== d.pricingMode) out.push({ field: "pricingMode", from: old.pricing_mode || "fixed", to: d.pricingMode });
  for (const [field, col] of [["makingCharge", "making_charge"], ["extraCharge", "extra_charge"]]) {
    const before = old[col] === null || old[col] === undefined ? null : num(old[col]);
    if (before !== d[field]) out.push({ field, from: before, to: d[field] });
  }
  if (d.itemStatus && (old.item_status || "active") !== d.itemStatus) out.push({ field: "itemStatus", from: old.item_status || "active", to: d.itemStatus });
  const oldMin = old.min_price === null || old.min_price === undefined ? null : num(old.min_price);
  if (oldMin !== d.minPrice) out.push({ field: "minPrice", from: oldMin, to: d.minPrice });
  return out;
}

/* POST /api/products (multipart; barcodes = JSON [{ barcode, label, qty }]; variantOf = product this is a variant of) */
router.post("/", requirePerm("products.edit"), imageUpload.single("image"), ah(async (req, res) => {
  const d = readProduct(req.body || {}, { creating: true });
  if (req.business.profile.batches) d.trackBatches = true;     // e.g. cosmetics: every product tracks batches & expiry
  const image = await imageFrom(req);
  const bid = req.business.id;
  try {
    const productId = await withTx(async (conn) => {
      await checkCodes(conn, req.business, d);
      let group = null;
      if (d.variantOf) { const parent = await ensureOwned(conn, "products", d.variantOf, bid); group = parent.variant_of || parent.id; }
      const [r] = await conn.query(
        `INSERT INTO products (business_id, category_id, brand_id, subcategory, name, generic_name, dosage_form, manufacturer, supplier_id, rx_required, storage_instructions,
                               product_type, model_number, collection, season, metal, purity, gross_weight, stone_weight, pricing_mode, making_charge,
                               making_type, extra_charge, unique_item, item_status, country_of_origin, notes, specs, tracking, min_price, warranty_months, warranty_provider, warranty_terms,
                               size, shade, fragrance, formula, pack_size, variant_of, description,
                               sku, barcode, image_path, unit, packaging, cost_price, selling_price, wholesale_price, min_stock, track_batches, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bid, await categoryId(conn, bid, d.category), await brandId(conn, bid, d.brand), d.subcategory, d.name, d.genericName, d.dosageForm, d.manufacturer,
          await supplierOf(conn, bid, d.supplierId), d.rxRequired ? 1 : 0, d.storageInstructions,
          d.productType, d.modelNumber, d.collection, d.season, d.metal, d.purity, d.grossWeight, d.stoneWeight, d.pricingMode, d.makingCharge,
          d.makingType, d.extraCharge, d.uniqueItem ? 1 : 0, d.itemStatus || "active", d.countryOfOrigin, d.notes, d.specs ?? null, d.tracking, d.minPrice, d.warrantyMonths, d.warrantyProvider, d.warrantyTerms,
          d.size, d.shade, d.fragrance, d.formula, d.packSize,
          group, d.description, d.sku, d.barcode, image, d.unit, d.packaging ?? null, d.costPrice, d.sellingPrice, d.wholesalePrice, d.minStock, d.trackBatches ? 1 : 0, d.isActive ? 1 : 0]
      );
      await saveBarcodes(conn, bid, r.insertId, d.barcodes || []);
      // A product can exist with zero stock. Opening stock is normally entered in Stock → Opening stock.
      if (d.openingStock > 0 && d.tracking === "qty") {
        const product = { id: r.insertId, name: d.name, stock_qty: 0, unit: d.unit, cost_price: d.costPrice, track_batches: d.trackBatches ? 1 : 0 };
        await moveStock(conn, { businessId: bid, userId: req.user.id, product, qtyChange: d.openingStock, type: "opening", refType: "stock", reason: "opening", note: "Opening stock" });
      }
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.created", entity: "product", entityId: r.insertId,
        meta: { costPrice: d.costPrice, sellingPrice: d.sellingPrice, wholesalePrice: d.wholesalePrice, status: d.isActive ? "active" : "archived" }, ip: req.ip });
      return r.insertId;
    });
    res.status(201).json({ id: productId });
  } catch (err) { removeImage(image); throw err; }
}));

/* PUT /api/products/:id (stock is changed only through movements, never here) */
/* multipart: product fields + optional "image" file; removeImage=true clears the photo */
router.put("/:id", requirePerm("products.edit"), imageUpload.single("image"), ah(async (req, res) => {
  const d = readProduct(req.body || {}, { creating: false });
  if (req.business.profile.batches) d.trackBatches = true;
  const image = await imageFrom(req);
  const bid = req.business.id;
  try {
    const oldImage = await withTx(async (conn) => {
      const p = await ensureOwned(conn, "products", id(req.params.id), bid, true);
      await checkCodes(conn, req.business, d, p);
      // the tracking method can change only while nothing is in stock (devices must match the stock)
      if ((p.tracking || "qty") !== d.tracking && num(p.stock_qty) !== 0) throw conflict("trackingNeedsZeroStock");
      if (d.uniqueItem && num(p.stock_qty) > 1) throw conflict("uniqueOne");
      const next = image || (req.body?.removeImage === "true" ? null : p.image_path);
      await conn.query(
        `UPDATE products SET category_id = ?, brand_id = ?, subcategory = ?, name = ?, generic_name = ?, dosage_form = ?, manufacturer = ?, supplier_id = ?, rx_required = ?,
                storage_instructions = ?, product_type = ?, model_number = ?, collection = ?, season = ?, metal = ?, purity = ?, gross_weight = ?, stone_weight = ?,
                pricing_mode = ?, making_charge = ?, making_type = ?, extra_charge = ?, unique_item = ?, item_status = ?, country_of_origin = ?, notes = ?, specs = ?, tracking = ?, min_price = ?,
                warranty_months = ?, warranty_provider = ?, warranty_terms = ?, size = ?, shade = ?, fragrance = ?, formula = ?, pack_size = ?, description = ?,
                sku = ?, barcode = ?, image_path = ?, unit = ?, packaging = ?, cost_price = ?, selling_price = ?, wholesale_price = ?, min_stock = ?, track_batches = ?, is_active = ?
          WHERE id = ? AND business_id = ?`,
        [await categoryId(conn, bid, d.category), await brandId(conn, bid, d.brand), d.subcategory, d.name, d.genericName, d.dosageForm, d.manufacturer,
          await supplierOf(conn, bid, d.supplierId), d.rxRequired ? 1 : 0, d.storageInstructions,
          d.productType, d.modelNumber, d.collection, d.season, d.metal, d.purity, d.grossWeight, d.stoneWeight, d.pricingMode, d.makingCharge,
          d.makingType, d.extraCharge, d.uniqueItem ? 1 : 0, d.itemStatus || p.item_status || "active", d.countryOfOrigin, d.notes, d.specs === undefined ? p.specs : d.specs, d.tracking, d.minPrice,
          d.warrantyMonths, d.warrantyProvider, d.warrantyTerms, d.size, d.shade, d.fragrance, d.formula, d.packSize,
          d.description, d.sku, d.barcode, next, d.unit, d.packaging === undefined ? p.packaging : d.packaging, d.costPrice, d.sellingPrice, d.wholesalePrice, d.minStock, d.trackBatches ? 1 : 0, d.isActive ? 1 : 0, p.id, bid]
      );
      await saveBarcodes(conn, bid, p.id, d.barcodes);
      if (d.trackBatches && !p.track_batches) await startBatchTracking(conn, bid, p.id);
      const changes = changesOf(p, d);
      await audit(conn, { businessId: bid, userId: req.user.id, action: changes.length ? "product.changed" : "product.updated", entity: "product", entityId: p.id,
        meta: changes.length ? { changes } : null, ip: req.ip });
      return p.image_path !== next ? p.image_path : null;
    });
    removeImage(oldImage);
    res.json({ code: "saved" });
  } catch (err) { removeImage(image); throw err; }
}));

/*
 * POST /api/products/:id/variants { variants: [{ size?, shade?, formula?, packSize?, sku?, barcode?, sellingPrice?, costPrice? }] }
 * Creates several variants of a product at once (e.g. every size × colour of a shirt). Each variant is its own product
 * in the same variant group with its own SKU, barcode, prices, stock and minimum stock; the rest is copied from the product.
 * Combinations that already exist in the group are skipped. No stock is added (use Opening stock / purchases).
 */
router.post("/:id/variants", requirePerm("products.edit"), ah(async (req, res) => {
  const bid = req.business.id;
  const list = Array.isArray(req.body?.variants) ? req.body.variants.slice(0, 200) : [];
  if (!list.length) throw badRequest({ variants: "required" });
  const result = await withTx(async (conn) => {
    const parent = await ensureOwned(conn, "products", id(req.params.id), bid, true);
    const group = parent.variant_of || parent.id;
    const [existing] = await conn.query("SELECT size, shade, formula, pack_size FROM products WHERE business_id = ? AND COALESCE(variant_of, id) = ?", [bid, group]);
    const key = (v) => [v.size, v.shade, v.formula, v.pack_size].map((x) => String(x || "").trim().toLowerCase()).join("|");
    const seen = new Set(existing.map(key));
    const created = [];
    let skipped = 0;
    for (const [i, raw] of list.entries()) {
      const v = { size: optText(raw?.size, 40), shade: optText(raw?.shade, 60), formula: optText(raw?.formula, 60), pack_size: optText(raw?.packSize, 40) };
      if (seen.has(key(v))) { skipped++; continue; }
      seen.add(key(v));
      const d = { sku: optText(raw?.sku, 80), barcode: optText(raw?.barcode, 80), barcodes: [] };
      try { await checkCodes(conn, req.business, d); } catch (err) { throw new HttpError(400, "validation", Object.fromEntries(Object.entries(err.errors || {}).map(([k, x]) => [`variants.${i}.${k}`, x])), err.extra); }
      const selling = raw?.sellingPrice === undefined || raw?.sellingPrice === "" ? num(parent.selling_price) : money(raw.sellingPrice);
      const cost = raw?.costPrice === undefined || raw?.costPrice === "" ? num(parent.cost_price) : money(raw.costPrice);
      if (Number.isNaN(selling) || Number.isNaN(cost)) throw badRequest({ [`variants.${i}.sellingPrice`]: "invalidAmount" });
      const [r] = await conn.query(
        `INSERT INTO products (business_id, category_id, brand_id, subcategory, name, generic_name, dosage_form, manufacturer, supplier_id, rx_required, storage_instructions,
                               product_type, model_number, collection, season, country_of_origin, notes, specs, tracking, min_price, warranty_months, warranty_provider, warranty_terms,
                               size, shade, fragrance, formula, pack_size, variant_of, description, sku, barcode, image_path, unit, packaging,
                               cost_price, selling_price, wholesale_price, min_stock, track_batches, is_active)
         SELECT business_id, category_id, brand_id, subcategory, name, generic_name, dosage_form, manufacturer, supplier_id, rx_required, storage_instructions,
                product_type, model_number, collection, season, country_of_origin, notes, specs, tracking, min_price, warranty_months, warranty_provider, warranty_terms,
                ?, ?, fragrance, ?, ?, ?, description, ?, ?, NULL, unit, packaging, ?, ?, wholesale_price, min_stock, track_batches, 1
           FROM products WHERE id = ?`,
        [v.size, v.shade, v.formula, v.pack_size, group, d.sku, d.barcode, cost, selling, parent.id]);
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.created", entity: "product", entityId: r.insertId,
        meta: { costPrice: cost, sellingPrice: selling, status: "active", variantOf: group }, ip: req.ip });
      created.push(r.insertId);
    }
    return { created: created.length, skipped, ids: created };
  });
  res.status(201).json(result);
}));

/* POST /api/products/:id/archive and /restore — archived products are hidden from sales, purchases and stock entry */
for (const [path, active] of [["archive", false], ["restore", true]]) {
  router.post(`/:id/${path}`, requirePerm("products.edit"), ah(async (req, res) => {
    const bid = req.business.id;
    await withTx(async (conn) => {
      const p = await ensureOwned(conn, "products", id(req.params.id), bid, true);
      if (Boolean(p.is_active) === active) return;
      await conn.query("UPDATE products SET is_active = ? WHERE id = ? AND business_id = ?", [active ? 1 : 0, p.id, bid]);
      await audit(conn, { businessId: bid, userId: req.user.id, action: "product.changed", entity: "product", entityId: p.id,
        meta: { changes: [{ field: "status", from: active ? "archived" : "active", to: active ? "active" : "archived" }] }, ip: req.ip });
    });
    res.json({ code: "saved" });
  }));
}

/* GET /api/products/:id/details — packaging barcodes, the variant group and the batches on hand */
router.get("/:id/details", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const p = await ensureOwned(pool, "products", id(req.params.id), bid);
  const group = p.variant_of || p.id;
  const [[barcodes], [variants], [batches]] = await Promise.all([
    pool.query("SELECT barcode, pack_label, pack_qty FROM product_barcodes WHERE business_id = ? AND product_id = ? ORDER BY id", [bid, p.id]),
    pool.query(`${SELECT} WHERE p.business_id = ? AND COALESCE(p.variant_of, p.id) = ? ORDER BY p.id`, [bid, group]),
    pool.query(
      `SELECT b.id, b.batch_no, b.expiry_date, b.qty, l.name location FROM product_batches b JOIN stock_locations l ON l.id = b.location_id
        WHERE b.business_id = ? AND b.product_id = ? AND b.qty > 0 ORDER BY b.expiry_date IS NULL, b.expiry_date, b.id`, [bid, p.id])
  ]);
  res.json({
    barcodes: barcodes.map((x) => ({ barcode: x.barcode, label: x.pack_label || "", qty: num(x.pack_qty) })),
    variants: variants.map((v) => shape(v, null)),
    batches: batches.map((b) => ({ id: b.id, batchNo: b.batch_no, expiryDate: b.expiry_date, qty: num(b.qty), location: b.location }))
  });
}));

/* GET /api/products/:id/changes — who changed costs, prices, reorder level or status, and when */
router.get("/:id/changes", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  await ensureOwned(pool, "products", id(req.params.id), bid);
  const [rows] = await pool.query(
    `SELECT a.action, a.meta, a.created_at, u.full_name user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.business_id = ? AND a.entity = 'product' AND a.entity_id = ? AND a.action IN ('product.created', 'product.changed')
      ORDER BY a.id DESC LIMIT 200`, [bid, id(req.params.id)]);
  const meta = (m) => (typeof m === "string" ? JSON.parse(m) : m) || {};
  res.json({ changes: rows.map((r) => ({ action: r.action, at: r.created_at, user: r.user_name, ...meta(r.meta) })) });
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

/* POST /api/products/import  { rows: [{name, size, shade, fragrance, formula, packSize, sku, barcode, category, unit, costPrice, sellingPrice, wholesalePrice, minStock, openingStock}] } */
router.post("/import", requirePerm("products.edit"), ah(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [];
  if (!rows.length) throw badRequest({ rows: "required" });
  const bid = req.business.id;
  const errors = [];
  rows.forEach((r, i) => { try { readProduct(r, { creating: true }); } catch (e) { errors.push({ row: i + 2, errors: e.errors }); } });
  if (errors.length) return res.status(400).json({ code: "importErrors", rows: errors.slice(0, 50) });
  const created = await withTx(async (conn) => {
    let n = 0;
    for (const [i, r] of rows.entries()) {
      const d = readProduct(r, { creating: true });
      try { await checkCodes(conn, req.business, d); } catch (err) { throw new HttpError(400, "importErrors", null, { rows: [{ row: i + 2, errors: err.errors }] }); }
      const [ins] = await conn.query(
        `INSERT INTO products (business_id, category_id, name, size, shade, fragrance, formula, pack_size, sku, barcode, unit, cost_price, selling_price, wholesale_price, min_stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [bid, await categoryId(conn, bid, d.category), d.name, d.size, d.shade, d.fragrance, d.formula, d.packSize, d.sku, d.barcode, d.unit, d.costPrice, d.sellingPrice, d.wholesalePrice, d.minStock]
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
}));

export default router;
