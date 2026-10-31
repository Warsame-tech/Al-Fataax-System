/*
 * Product packaging structure (pharmacy medicines): the packs above the base unit, largest first.
 *
 *   unit = "tablet", packaging = [
 *     { name: "Carton", per: 100, buy: true,  sell: false, price: null },   1 carton = 100 boxes
 *     { name: "Box",    per: 6,   buy: true,  sell: true,  price: 8 },      1 box    = 6 strips
 *     { name: "Strip",  per: 10,  buy: false, sell: true,  price: null }    1 strip  = 10 tablets
 *   ]
 *   → 1 carton = 6,000 tablets, 1 box = 60, 1 strip = 10.  2 cartons = 200 boxes = 1,200 strips = 12,000 tablets.
 *
 * Stock is always kept in the base unit; purchases, stock entry, POS and invoices may use a pack and are
 * converted here. A pack's price is optional (empty = base price × units in the pack).
 */
const q4 = (v) => Math.round(Number(v) * 10000) / 10000;   // quantities: 4 decimals (lengths in meters: 0.1 mm)

/** Packaging from a request (array or JSON string) → validated levels, or { error } with the field key. */
export function readPackaging(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = raw.trim() ? JSON.parse(raw) : []; } catch { return { error: "packaging" }; } }
  if (!Array.isArray(list)) return { levels: [] };
  const levels = [];
  for (const [i, x] of list.slice(0, 5).entries()) {
    const name = typeof x?.name === "string" ? x.name.trim().slice(0, 30) : "";
    const per = Number(x?.per);
    const price = x?.price === "" || x?.price === null || x?.price === undefined ? null : Number(x.price);
    if (!name) return { error: `packaging.${i}.name` };
    if (!Number.isFinite(per) || per <= 0 || per > 1e6) return { error: `packaging.${i}.per` };
    if (price !== null && (!Number.isFinite(price) || price < 0)) return { error: `packaging.${i}.price` };
    levels.push({ name, per: q4(per), buy: x?.buy !== false, sell: Boolean(x?.sell), price: price === null ? null : Math.round(price * 10000) / 10000 });
  }
  const names = levels.map((l) => l.name.toLowerCase());
  const dup = names.findIndex((n, i) => names.indexOf(n) !== i);
  if (dup >= 0) return { error: `packaging.${dup}.name` };
  return { levels };
}

/** Saved packaging (JSON text from the database) → levels. */
export function packagingOf(product) {
  try { return Array.isArray(product?.packaging) ? product.packaging : JSON.parse(product?.packaging || "[]") || []; } catch { return []; }
}

/** Base units in one pack of this name (1 for the base unit), or null when the product has no such pack. */
export function unitsPer(product, name) {
  if (!name || name === product.unit) return 1;
  const levels = packagingOf(product);
  const at = levels.findIndex((l) => l.name === name);
  if (at < 0) return null;
  return q4(levels.slice(at).reduce((m, l) => m * l.per, 1));
}

/** The pack itself (name, per, buy, sell, price) or null for the base unit. */
export const packOf = (product, name) => packagingOf(product).find((l) => l.name === name) || null;
