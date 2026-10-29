/*
 * One-time data upgrades. Each step runs once per database and is recorded in app_migrations.
 */
import { defaultLocationId } from "../lib/stock.js";
import { profileFor } from "../lib/businessProfiles.js";
import { startBatchTracking } from "../lib/batches.js";

const STOCK_PERMS_ADD_EDIT = ["stock.view", "stock.add"];
const STOCK_PERMS_MANAGER = ["stock.view", "stock.add", "stock.adjust", "stock.transfer", "stock.locations"];

export const DATA_STEPS = [
  {
    // Every business gets a default location holding all of its current stock.
    name: "stock_locations_v1",
    async run(db) {
      const [businesses] = await db.query("SELECT id FROM businesses");
      for (const b of businesses) {
        const loc = await defaultLocationId(db, b.id);
        await db.query(
          `INSERT IGNORE INTO product_stock (business_id, product_id, location_id, qty)
           SELECT p.business_id, p.id, ?, p.stock_qty FROM products p WHERE p.business_id = ?`, [loc, b.id]
        );
        await db.query("UPDATE stock_movements SET location_id = ? WHERE business_id = ? AND location_id IS NULL", [loc, b.id]);
      }
    }
  },
  {
    // New Stock permissions for existing roles, so nobody loses what they could do before:
    // product editors could set opening stock → view + add stock;
    // roles that could adjust stock (managers) → every stock permission.
    name: "stock_permissions_v1",
    async run(db) {
      const [roles] = await db.query("SELECT id, permissions FROM roles");
      for (const r of roles) {
        let perms;
        try { perms = JSON.parse(r.permissions || "[]"); } catch { perms = []; }
        const set = new Set(perms);
        if (set.has("products.edit")) STOCK_PERMS_ADD_EDIT.forEach((p) => set.add(p));
        if (set.has("stock.adjust")) STOCK_PERMS_MANAGER.forEach((p) => set.add(p));
        if (set.size !== perms.length) await db.query("UPDATE roles SET permissions = ? WHERE id = ?", [JSON.stringify([...set]), r.id]);
      }
    }
  },
  {
    // Business types whose products always track batches (cosmetics): switch it on for existing products;
    // the stock already there becomes "no batch" stock.
    name: "profile_batches_v1",
    async run(db) {
      const [products] = await db.query("SELECT p.id, p.business_id, b.business_type FROM products p JOIN businesses b ON b.id = p.business_id WHERE p.track_batches = 0");
      for (const p of products.filter((x) => profileFor(x.business_type).batches)) {
        await db.query("UPDATE products SET track_batches = 1 WHERE id = ?", [p.id]);
        await startBatchTracking(db, p.business_id, p.id);
      }
    }
  },
  {
    // "Retail" is no longer a business category: those businesses become Supermarket.
    name: "retail_to_supermarket_v1",
    async run(db) {
      await db.query("UPDATE businesses SET business_type = 'supermarket' WHERE business_type = 'retail'");
    }
  }
];
