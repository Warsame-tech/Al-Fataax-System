import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, withTx, badRequest, conflict, notFound } from "../lib/http.js";

/*
 * Product lists: the values a business registers once and then picks from dropdowns in the product form.
 *   category, brand        → the categories / brands tables (products point to them)
 *   subcategory (parent = category), color (code = #hex swatch), size (parent = size system),
 *   collection, season, unit  → catalog_options (products keep the value as text)
 * Ready-made values per business type come with the business profile (lib/businessProfiles.js);
 * these are the business's own additions. Renaming a value renames it on the products using it.
 */
const router = Router();
router.use(requireAuth);

const OPTION_KINDS = ["subcategory", "color", "size", "collection", "season", "unit", "purity"];
const KINDS = ["category", "brand", ...OPTION_KINDS];
/* product column holding each text value (renames follow) */
const PRODUCT_COLUMN = { subcategory: "subcategory", color: "shade", size: "size", collection: "collection", season: "season", unit: "unit", purity: "purity" };
const MAX = { purity: 20, subcategory: 120, color: 60, size: 40, collection: 80, season: 40, unit: 20, category: 120, brand: 120 };

const readKind = (k) => { if (!KINDS.includes(k)) throw notFound(); return k; };
const readCode = (v) => {
  const c = optText(v, 20);
  if (c && !/^#[0-9a-f]{6}$/i.test(c)) throw badRequest({ code: "invalidColor" });
  return c;
};

/* GET /api/catalog — every list of the business, with how many products use each category / brand */
router.get("/", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const [[categories], [brands], [options]] = await Promise.all([
    pool.query("SELECT c.id, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) products FROM categories c WHERE c.business_id = ? ORDER BY c.name", [bid]),
    pool.query("SELECT b.id, b.name, (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id) products FROM brands b WHERE b.business_id = ? ORDER BY b.name", [bid]),
    pool.query("SELECT id, kind, name, parent, code FROM catalog_options WHERE business_id = ? ORDER BY kind, parent, sort_order, name", [bid])
  ]);
  const grouped = Object.fromEntries(OPTION_KINDS.map((k) => [k, []]));
  for (const o of options) grouped[o.kind]?.push({ id: o.id, name: o.name, parent: o.parent, code: o.code });
  res.json({
    categories: categories.map((c) => ({ id: c.id, name: c.name, products: Number(c.products) })),
    brands: brands.map((b) => ({ id: b.id, name: b.name, products: Number(b.products) })),
    options: grouped
  });
}));

/* POST /api/catalog/:kind { name, parent?, code? } */
router.post("/:kind", requirePerm("products.edit"), ah(async (req, res) => {
  const kind = readKind(req.params.kind);
  const bid = req.business.id;
  const name = text(req.body?.name, MAX[kind]);
  if (!name) throw badRequest({ name: "required" });
  const withParent = ["subcategory", "size", "purity"].includes(kind);       // purity: its metal
  const parent = withParent ? text(req.body?.parent, 120) || null : null;
  if (withParent && !parent) throw badRequest({ parent: "required" });
  const code = kind === "color" ? readCode(req.body?.code) : null;
  const newId = await withTx(async (conn) => {
    if (kind === "category" || kind === "brand") {
      const table = kind === "category" ? "categories" : "brands";
      const [[dup]] = await conn.query(`SELECT id FROM ${table} WHERE business_id = ? AND name = ?`, [bid, name]);
      if (dup) throw conflict("alreadyInList", { name });
      const [r] = await conn.query(`INSERT INTO ${table} (business_id, name) VALUES (?, ?)`, [bid, name]);
      return r.insertId;
    }
    const [[dup]] = await conn.query("SELECT id FROM catalog_options WHERE business_id = ? AND kind = ? AND name = ? AND parent <=> ?", [bid, kind, name, parent]);
    if (dup) throw conflict("alreadyInList", { name });
    const [r] = await conn.query("INSERT INTO catalog_options (business_id, kind, name, parent, code) VALUES (?, ?, ?, ?, ?)", [bid, kind, name, parent, code]);
    return r.insertId;
  });
  await audit(pool, { businessId: bid, userId: req.user.id, action: "catalog.added", meta: { kind, name, parent }, ip: req.ip });
  res.status(201).json({ id: newId });
}));

/* PUT /api/catalog/:kind/:id { name, code? } — renames the value on the products that use it too */
router.put("/:kind/:id", requirePerm("products.edit"), ah(async (req, res) => {
  const kind = readKind(req.params.kind);
  const bid = req.business.id;
  const name = text(req.body?.name, MAX[kind]);
  if (!name) throw badRequest({ name: "required" });
  await withTx(async (conn) => {
    if (kind === "category" || kind === "brand") {
      const table = kind === "category" ? "categories" : "brands";
      const [[row]] = await conn.query(`SELECT * FROM ${table} WHERE id = ? AND business_id = ? FOR UPDATE`, [id(req.params.id), bid]);
      if (!row) throw notFound();
      const [[dup]] = await conn.query(`SELECT id FROM ${table} WHERE business_id = ? AND name = ? AND id <> ?`, [bid, name, row.id]);
      if (dup) throw conflict("alreadyInList", { name });
      await conn.query(`UPDATE ${table} SET name = ? WHERE id = ?`, [name, row.id]);
      // subcategories and size systems keep pointing at the category by name
      if (kind === "category") await conn.query("UPDATE catalog_options SET parent = ? WHERE business_id = ? AND kind = 'subcategory' AND parent = ?", [name, bid, row.name]);
      return;
    }
    const [[row]] = await conn.query("SELECT * FROM catalog_options WHERE id = ? AND business_id = ? AND kind = ? FOR UPDATE", [id(req.params.id), bid, kind]);
    if (!row) throw notFound();
    const code = kind === "color" ? readCode(req.body?.code) : null;
    await conn.query("UPDATE catalog_options SET name = ?, code = ? WHERE id = ?", [name, code, row.id]);
    if (name !== row.name) await conn.query(`UPDATE products SET ${PRODUCT_COLUMN[kind]} = ? WHERE business_id = ? AND ${PRODUCT_COLUMN[kind]} = ?`, [name, bid, row.name]);
  });
  res.json({ code: "saved" });
}));

/* DELETE /api/catalog/:kind/:id — categories / brands only when no product uses them; other values: products keep theirs */
router.delete("/:kind/:id", requirePerm("products.edit"), ah(async (req, res) => {
  const kind = readKind(req.params.kind);
  const bid = req.business.id;
  await withTx(async (conn) => {
    if (kind === "category" || kind === "brand") {
      const table = kind === "category" ? "categories" : "brands";
      const [[row]] = await conn.query(`SELECT * FROM ${table} WHERE id = ? AND business_id = ? FOR UPDATE`, [id(req.params.id), bid]);
      if (!row) throw notFound();
      const [[used]] = await conn.query(`SELECT COUNT(*) n FROM products WHERE ${kind === "category" ? "category_id" : "brand_id"} = ?`, [row.id]);
      if (used.n) throw conflict("inUse", { n: Number(used.n) });
      await conn.query(`DELETE FROM ${table} WHERE id = ?`, [row.id]);
      if (kind === "category") await conn.query("DELETE FROM catalog_options WHERE business_id = ? AND kind = 'subcategory' AND parent = ?", [bid, row.name]);
      return;
    }
    const [r] = await conn.query("DELETE FROM catalog_options WHERE id = ? AND business_id = ? AND kind = ?", [id(req.params.id), bid, kind]);
    if (!r.affectedRows) throw notFound();
  });
  res.json({ code: "deleted" });
}));

export default router;
