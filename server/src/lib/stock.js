/*
 * Stock locations (shops, warehouses) and per-location stock.
 *
 * products.stock_qty is the product's TOTAL stock (all locations) and is kept equal to
 * SUM(product_stock.qty) by moveStock in lib/ledger.js — so every older screen and report
 * that reads stock_qty keeps working. Sales, invoices and purchases use the default location.
 */
export const DEFAULT_LOCATION_NAME = "Main shop";

/** The business's default location id (created on first use). */
export async function defaultLocationId(db, businessId) {
  const [[row]] = await db.query(
    "SELECT id FROM stock_locations WHERE business_id = ? AND is_default = 1 ORDER BY id LIMIT 1", [businessId]
  );
  if (row) return row.id;
  await db.query(
    "INSERT IGNORE INTO stock_locations (business_id, name, kind, is_default) VALUES (?, ?, 'shop', 1)",
    [businessId, DEFAULT_LOCATION_NAME]
  );
  const [[made]] = await db.query(
    "SELECT id FROM stock_locations WHERE business_id = ? ORDER BY is_default DESC, id LIMIT 1", [businessId]
  );
  if (made && !row) await db.query("UPDATE stock_locations SET is_default = 1 WHERE id = ? AND business_id = ?", [made.id, businessId]);
  return made.id;
}

/** An active location of this business, or null. */
export async function activeLocation(db, businessId, locationId) {
  if (!locationId) return null;
  const [[row]] = await db.query(
    "SELECT * FROM stock_locations WHERE id = ? AND business_id = ? AND is_active = 1", [locationId, businessId]
  );
  return row || null;
}

/** Locks (creating when missing) the product's stock row at a location. Returns the row. */
export async function lockStockRow(conn, businessId, productId, locationId) {
  await conn.query(
    "INSERT IGNORE INTO product_stock (business_id, product_id, location_id, qty) VALUES (?, ?, ?, 0)",
    [businessId, productId, locationId]
  );
  const [[row]] = await conn.query(
    "SELECT * FROM product_stock WHERE product_id = ? AND location_id = ? AND business_id = ? FOR UPDATE",
    [productId, locationId, businessId]
  );
  return row;
}
