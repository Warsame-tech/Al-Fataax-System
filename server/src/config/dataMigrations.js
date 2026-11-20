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
  },
  {
    // Purchases received before partial receipts existed: every line was received in full.
    name: "purchase_received_qty_v1",
    async run(db) {
      await db.query(`UPDATE purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
                         SET pi.received_qty = pi.qty WHERE p.status IN ('received', 'cancelled', 'returned') AND pi.received_qty = 0`);
      await db.query("UPDATE purchases SET ordered_total = total WHERE ordered_total IS NULL");
    }
  },
  {
    // New pricing permissions for existing roles, so nobody loses what they could do before:
    // "give discounts and change prices" → change prices; approving discounts → approving prices below the minimum;
    // product editors could see and change costs; roles that saw costs elsewhere (purchases, reports, stock) still see them.
    name: "pricing_permissions_v1",
    async run(db) {
      const [roles] = await db.query("SELECT id, permissions FROM roles");
      for (const r of roles) {
        let perms;
        try { perms = JSON.parse(r.permissions || "[]"); } catch { perms = []; }
        const set = new Set(perms);
        if (set.has("sales.discount")) set.add("prices.edit");
        if (set.has("discounts.approve")) set.add("prices.approve");
        if (set.has("products.edit")) { set.add("costs.view"); set.add("costs.edit"); }
        if (["purchases.view", "reports.view", "stock.view"].some((p) => set.has(p))) set.add("costs.view");
        if (set.size !== perms.length) await db.query("UPDATE roles SET permissions = ? WHERE id = ?", [JSON.stringify([...set]), r.id]);
      }
    }
  },
  {
    // Invoice editing: roles that could cancel invoices (managers) may now correct unpaid invoices and approve edits;
    // correcting paid invoices (refunds) stays with the owner until given to a role.
    name: "invoice_edit_permissions_v1",
    async run(db) {
      const [roles] = await db.query("SELECT id, permissions FROM roles");
      for (const r of roles) {
        let perms;
        try { perms = JSON.parse(r.permissions || "[]"); } catch { perms = []; }
        const set = new Set(perms);
        if (set.has("invoices.cancel")) { set.add("invoices.edit"); set.add("invoices.approveEdit"); }
        if (set.size !== perms.length) await db.query("UPDATE roles SET permissions = ? WHERE id = ?", [JSON.stringify([...set]), r.id]);
      }
    }
  },
  {
    // Super admin roles: the super admins that already exist become owners (they could do everything before).
    name: "platform_admin_roles_v1",
    async run(db) {
      await db.query("UPDATE platform_admins SET role = 'owner'");
    }
  },
  {
    // Starting plans (prices can be changed in Subscriptions → Plans).
    name: "platform_plans_v1",
    async run(db) {
      const [[n]] = await db.query("SELECT COUNT(*) n FROM plans");
      if (Number(n.n)) return;
      await db.query(
        `INSERT INTO plans (name, code, description, price_monthly, price_yearly, max_users, max_branches, max_products, features, sort_order) VALUES
         ('Basic', 'basic', 'One shop: POS, stock, customers and reports', 10, 100, 3, 1, 1000, '["POS","Inventory","Customers","Reports"]', 1),
         ('Standard', 'standard', 'A growing business: invoices, purchases, staff roles', 20, 200, 10, 2, 10000, '["Everything in Basic","Invoices","Purchases","Staff roles","Promotions"]', 2),
         ('Premium', 'premium', 'Several branches, no limits', 40, 400, NULL, NULL, NULL, '["Everything in Standard","Unlimited branches","Unlimited users","Priority support"]', 3)`);
    }
  }
];
