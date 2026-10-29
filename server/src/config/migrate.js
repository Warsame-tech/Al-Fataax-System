/*
 * Small, idempotent schema upgrades for databases created by an older schema.sql.
 * Runs at server start; each step checks information_schema first, so it is safe
 * on MySQL and MariaDB and does nothing when the table / column already exists.
 */
import mysql from "mysql2/promise";
import { pool } from "./db.js";
import { env } from "./env.js";
import { schemaSql } from "./schema.js";
import { linkAllBusinesses } from "../lib/roles.js";
import { DATA_STEPS } from "./dataMigrations.js";

/* Brand-new database (e.g. a fresh Railway MySQL): create every table from schema.sql. */
async function createSchemaIfEmpty() {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses'"
  );
  if (row.n) return;
  const conn = await mysql.createConnection({ ...env.db, multipleStatements: true });
  try {
    await conn.query(schemaSql(env.db.database));
    console.log(`Database set up: created all tables in "${env.db.database}"`);
  } finally {
    await conn.end();
  }
}

const TABLES = [
  {
    table: "drafts",
    ddl: `CREATE TABLE IF NOT EXISTS drafts (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      business_id INT UNSIGNED NOT NULL,
      user_id     INT UNSIGNED NOT NULL,
      module      VARCHAR(30)  NOT NULL,
      title       VARCHAR(120) NOT NULL,
      data        MEDIUMTEXT   NOT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_drafts_user (business_id, user_id, module, updated_at),
      CONSTRAINT fk_drafts_business FOREIGN KEY (business_id) REFERENCES businesses(id),
      CONSTRAINT fk_drafts_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB`
  },
  {
    table: "app_migrations",
    ddl: `CREATE TABLE IF NOT EXISTS app_migrations (
      name       VARCHAR(60) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  },
  {
    table: "stock_locations",
    ddl: `CREATE TABLE IF NOT EXISTS stock_locations (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      business_id INT UNSIGNED NOT NULL,
      name        VARCHAR(100) NOT NULL,
      kind        VARCHAR(20)  NOT NULL DEFAULT 'shop',
      address     VARCHAR(200) NULL,
      is_default  TINYINT(1) NOT NULL DEFAULT 0,
      is_active   TINYINT(1) NOT NULL DEFAULT 1,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_location_name (business_id, name),
      CONSTRAINT fk_location_business FOREIGN KEY (business_id) REFERENCES businesses(id)
    ) ENGINE=InnoDB`
  },
  {
    table: "product_stock",
    ddl: `CREATE TABLE IF NOT EXISTS product_stock (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      business_id INT UNSIGNED NOT NULL,
      product_id  INT UNSIGNED NOT NULL,
      location_id INT UNSIGNED NOT NULL,
      qty         DECIMAL(14,3) NOT NULL DEFAULT 0,
      alert_level DECIMAL(14,3) NULL,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_product_location (product_id, location_id),
      INDEX idx_stock_business (business_id, location_id),
      CONSTRAINT fk_ps_business FOREIGN KEY (business_id) REFERENCES businesses(id),
      CONSTRAINT fk_ps_product  FOREIGN KEY (product_id)  REFERENCES products(id),
      CONSTRAINT fk_ps_location FOREIGN KEY (location_id) REFERENCES stock_locations(id)
    ) ENGINE=InnoDB`
  },
  {
    table: "stored_files",
    ddl: `CREATE TABLE IF NOT EXISTS stored_files (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      file_key    CHAR(32)     NOT NULL UNIQUE,
      business_id INT UNSIGNED NULL,
      kind        VARCHAR(20)  NOT NULL,
      mime        VARCHAR(40)  NOT NULL,
      size        INT UNSIGNED NOT NULL,
      data        MEDIUMBLOB   NOT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_files_business (business_id)
    ) ENGINE=InnoDB`
  },
  {
    table: "roles",
    ddl: `CREATE TABLE IF NOT EXISTS roles (
      id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      business_id  INT UNSIGNED NOT NULL,
      name         VARCHAR(60)  NOT NULL,
      description  VARCHAR(200) NULL,
      permissions  TEXT NOT NULL,
      template_key VARCHAR(20)  NULL,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_role_name (business_id, name),
      CONSTRAINT fk_role_business FOREIGN KEY (business_id) REFERENCES businesses(id)
    ) ENGINE=InnoDB`
  },
  {
    table: "payment_methods",
    ddl: `CREATE TABLE IF NOT EXISTS payment_methods (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      business_id     INT UNSIGNED NOT NULL,
      name            VARCHAR(80)  NOT NULL,
      number          VARCHAR(60)  NULL,
      kind            ENUM('cash','mobile_money','bank') NOT NULL,
      cash_account_id INT UNSIGNED NULL,
      bank_account_id INT UNSIGNED NULL,
      is_active       TINYINT(1) NOT NULL DEFAULT 1,
      sort_order      INT NOT NULL DEFAULT 0,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pm_business (business_id, sort_order),
      CONSTRAINT fk_pm_business FOREIGN KEY (business_id) REFERENCES businesses(id),
      CONSTRAINT fk_pm_cash     FOREIGN KEY (cash_account_id) REFERENCES cash_accounts(id),
      CONSTRAINT fk_pm_bank     FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
    ) ENGINE=InnoDB`
  },
  {
    table: "product_barcodes",
    ddl: `CREATE TABLE IF NOT EXISTS product_barcodes (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      business_id INT UNSIGNED NOT NULL,
      product_id  INT UNSIGNED NOT NULL,
      barcode     VARCHAR(80)  NOT NULL,
      pack_label  VARCHAR(60)  NULL,                 -- e.g. Box, Carton, Gift set
      pack_qty    DECIMAL(14,3) NOT NULL DEFAULT 1,  -- units in this packaging (scanning it sells / adds this many)
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pb_barcode (business_id, barcode),
      INDEX idx_pb_product (product_id),
      CONSTRAINT fk_pb_business FOREIGN KEY (business_id) REFERENCES businesses(id),
      CONSTRAINT fk_pb_product  FOREIGN KEY (product_id)  REFERENCES products(id)
    ) ENGINE=InnoDB`
  },
  {
    table: "product_batches",
    ddl: `CREATE TABLE IF NOT EXISTS product_batches (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      business_id INT UNSIGNED NOT NULL,
      product_id  INT UNSIGNED NOT NULL,
      location_id INT UNSIGNED NOT NULL,
      batch_no    VARCHAR(60)  NOT NULL DEFAULT '',  -- '' = stock without a batch number
      expiry_date DATE NULL,
      qty         DECIMAL(14,3) NOT NULL DEFAULT 0,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_batch_lookup (product_id, location_id, batch_no, expiry_date),
      INDEX idx_batch_expiry (business_id, expiry_date),
      CONSTRAINT fk_batch_business FOREIGN KEY (business_id) REFERENCES businesses(id),
      CONSTRAINT fk_batch_product  FOREIGN KEY (product_id)  REFERENCES products(id),
      CONSTRAINT fk_batch_location FOREIGN KEY (location_id) REFERENCES stock_locations(id)
    ) ENGINE=InnoDB`
  },
  {
    table: "stock_movement_batches",
    ddl: `CREATE TABLE IF NOT EXISTS stock_movement_batches (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      movement_id BIGINT UNSIGNED NOT NULL,
      batch_id    INT UNSIGNED NOT NULL,
      qty         DECIMAL(14,3) NOT NULL,            -- + into the batch, − out of it
      INDEX idx_smb_movement (movement_id),
      INDEX idx_smb_batch (batch_id)
    ) ENGINE=InnoDB`
  }
];

const COLUMNS = [
  { table: "products", column: "image_path", ddl: "ALTER TABLE products ADD COLUMN image_path VARCHAR(255) NULL AFTER barcode" },
  { table: "customer_payments", column: "payment_method_id", ddl: "ALTER TABLE customer_payments ADD COLUMN payment_method_id INT UNSIGNED NULL AFTER method" },
  { table: "business_user_roles", column: "role_id", ddl: "ALTER TABLE business_user_roles ADD COLUMN role_id INT UNSIGNED NULL AFTER role" },
  // product master data
  { table: "sales", column: "vat_rate", ddl: "ALTER TABLE sales ADD COLUMN vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER discount" },
  { table: "sales", column: "vat_amount", ddl: "ALTER TABLE sales ADD COLUMN vat_amount DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER vat_rate" },
  { table: "invoices", column: "vat_rate", ddl: "ALTER TABLE invoices ADD COLUMN vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER discount" },
  { table: "invoices", column: "vat_amount", ddl: "ALTER TABLE invoices ADD COLUMN vat_amount DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER vat_rate" },
  { table: "invoices", column: "bill_phone", ddl: "ALTER TABLE invoices ADD COLUMN bill_phone VARCHAR(30) NULL AFTER customer_id" },
  { table: "invoices", column: "bill_address", ddl: "ALTER TABLE invoices ADD COLUMN bill_address VARCHAR(255) NULL AFTER bill_phone" },
  { table: "invoices", column: "discount_label", ddl: "ALTER TABLE invoices ADD COLUMN discount_label VARCHAR(80) NULL AFTER discount" },
  { table: "products", column: "size", ddl: "ALTER TABLE products ADD COLUMN size VARCHAR(40) NULL AFTER name" },
  { table: "products", column: "subcategory", ddl: "ALTER TABLE products ADD COLUMN subcategory VARCHAR(120) NULL AFTER brand_id" },
  { table: "products", column: "description", ddl: "ALTER TABLE products ADD COLUMN description TEXT NULL AFTER name" },
  // stock movement ledger: location, balances, reason, references, reversal link, cost at the time
  { table: "stock_movements", column: "location_id", ddl: "ALTER TABLE stock_movements ADD COLUMN location_id INT UNSIGNED NULL AFTER product_id" },
  { table: "stock_movements", column: "balance_before", ddl: "ALTER TABLE stock_movements ADD COLUMN balance_before DECIMAL(14,3) NULL AFTER qty_change" },
  { table: "stock_movements", column: "balance_after", ddl: "ALTER TABLE stock_movements ADD COLUMN balance_after DECIMAL(14,3) NULL AFTER balance_before" },
  { table: "stock_movements", column: "unit", ddl: "ALTER TABLE stock_movements ADD COLUMN unit VARCHAR(20) NULL AFTER balance_after" },
  { table: "stock_movements", column: "unit_cost", ddl: "ALTER TABLE stock_movements ADD COLUMN unit_cost DECIMAL(14,4) NULL AFTER unit" },
  { table: "stock_movements", column: "reason", ddl: "ALTER TABLE stock_movements ADD COLUMN reason VARCHAR(120) NULL AFTER ref_id" },
  { table: "stock_movements", column: "reference", ddl: "ALTER TABLE stock_movements ADD COLUMN reference VARCHAR(80) NULL AFTER reason" },
  { table: "stock_movements", column: "supplier_id", ddl: "ALTER TABLE stock_movements ADD COLUMN supplier_id INT UNSIGNED NULL AFTER reference" },
  { table: "stock_movements", column: "transfer_ref", ddl: "ALTER TABLE stock_movements ADD COLUMN transfer_ref VARCHAR(40) NULL AFTER supplier_id" },
  { table: "stock_movements", column: "reversal_of", ddl: "ALTER TABLE stock_movements ADD COLUMN reversal_of BIGINT UNSIGNED NULL AFTER transfer_ref" },
  // POS: change given back (shown on the receipt)
  { table: "sales", column: "change_amount", ddl: "ALTER TABLE sales ADD COLUMN change_amount DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER amount_paid" }
];

/* Indexes added after the fact (name → DDL); checked against information_schema.STATISTICS. */
// Product variants (cosmetics: shade, fragrance, formula, pack size), variant groups, batch tracking, duplicate codes setting.
COLUMNS.push(
  { table: "products", column: "shade", ddl: "ALTER TABLE products ADD COLUMN shade VARCHAR(60) NULL AFTER size" },
  { table: "products", column: "fragrance", ddl: "ALTER TABLE products ADD COLUMN fragrance VARCHAR(60) NULL AFTER shade" },
  { table: "products", column: "formula", ddl: "ALTER TABLE products ADD COLUMN formula VARCHAR(60) NULL AFTER fragrance" },
  { table: "products", column: "pack_size", ddl: "ALTER TABLE products ADD COLUMN pack_size VARCHAR(40) NULL AFTER formula" },
  { table: "products", column: "variant_of", ddl: "ALTER TABLE products ADD COLUMN variant_of INT UNSIGNED NULL AFTER pack_size" },
  { table: "products", column: "track_batches", ddl: "ALTER TABLE products ADD COLUMN track_batches TINYINT(1) NOT NULL DEFAULT 0 AFTER min_stock" },
  { table: "business_settings", column: "allow_duplicate_codes", ddl: "ALTER TABLE business_settings ADD COLUMN allow_duplicate_codes TINYINT(1) NOT NULL DEFAULT 0 AFTER invoice_footer" }
);

const INDEXES = [
  { table: "products", name: "idx_products_category", ddl: "ALTER TABLE products ADD INDEX idx_products_category (business_id, category_id)" },
  { table: "products", name: "idx_products_brand", ddl: "ALTER TABLE products ADD INDEX idx_products_brand (business_id, brand_id)" },
  { table: "stock_movements", name: "idx_moves_location", ddl: "ALTER TABLE stock_movements ADD INDEX idx_moves_location (business_id, location_id, created_at)" },
  { table: "stock_movements", name: "idx_moves_reversal", ddl: "ALTER TABLE stock_movements ADD INDEX idx_moves_reversal (reversal_of)" },
  { table: "products", name: "idx_products_variant", ddl: "ALTER TABLE products ADD INDEX idx_products_variant (business_id, variant_of)" }
];

export async function migrate() {
  await createSchemaIfEmpty();
  for (const t of TABLES) {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [t.table]
    );
    if (!row.n) {
      await pool.query(t.ddl);
      console.log(`Database upgraded: created ${t.table}`);
    }
  }
  for (const c of COLUMNS) {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [c.table, c.column]
    );
    if (!row.n) {
      await pool.query(c.ddl);
      console.log(`Database upgraded: added ${c.table}.${c.column}`);
    }
  }
  // Custom roles: business_user_roles.role becomes free text ('owner', old role names or 'staff').
  const [[roleCol]] = await pool.query(
    "SELECT DATA_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_user_roles' AND COLUMN_NAME = 'role'"
  );
  if (roleCol?.t === "enum") {
    await pool.query("ALTER TABLE business_user_roles MODIFY role VARCHAR(20) NOT NULL");
    console.log("Database upgraded: business_user_roles.role now allows custom roles");
  }
  // Stock ledger: movement types become free text (transfers, damaged, count corrections, reversals…).
  const [[moveType]] = await pool.query(
    "SELECT DATA_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_movements' AND COLUMN_NAME = 'type'"
  );
  if (moveType?.t === "enum") {
    await pool.query("ALTER TABLE stock_movements MODIFY type VARCHAR(30) NOT NULL");
    console.log("Database upgraded: stock_movements.type now allows all movement types");
  }
  // Money keeps 4 decimals so 5% VAT is exact (5% of 0.15 = 0.0075): widen every DECIMAL(14,2) column.
  const [narrow] = await pool.query(
    `SELECT TABLE_NAME t, COLUMN_NAME c, IS_NULLABLE n, COLUMN_DEFAULT d FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'decimal' AND NUMERIC_PRECISION = 14 AND NUMERIC_SCALE = 2`
  );
  for (const col of narrow) {
    const def = col.d === null || String(col.d).toUpperCase() === "NULL" ? "" : ` DEFAULT ${Number(String(col.d).replace(/'/g, ""))}`;
    await pool.query(`ALTER TABLE \`${col.t}\` MODIFY \`${col.c}\` DECIMAL(14,4) ${col.n === "YES" ? "NULL" : "NOT NULL"}${def}`);
  }
  if (narrow.length) console.log(`Database upgraded: ${narrow.length} money columns now keep 4 decimals`);
  // SKU / barcode: unique per business unless the business allows duplicates (checked in routes/products.js),
  // so the strict database keys become normal indexes.
  for (const [uq, ix, col] of [["uq_product_sku", "idx_products_sku", "sku"], ["uq_product_barcode", "idx_products_barcode", "barcode"]]) {
    const [[u]] = await pool.query(
      "SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND INDEX_NAME = ?", [uq]);
    if (u.n) {
      await pool.query(`ALTER TABLE products DROP INDEX ${uq}, ADD INDEX ${ix} (business_id, ${col})`);
      console.log(`Database upgraded: products.${col} duplicates are checked by the app`);
    }
  }
  for (const ix of INDEXES) {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?", [ix.table, ix.name]
    );
    if (!row.n) await pool.query(ix.ddl);
  }
  await linkAllBusinesses();
  // One-time data steps (each runs once, recorded in app_migrations).
  for (const step of DATA_STEPS) {
    const [[done]] = await pool.query("SELECT COUNT(*) n FROM app_migrations WHERE name = ?", [step.name]);
    if (done.n) continue;
    await step.run(pool);
    await pool.query("INSERT INTO app_migrations (name) VALUES (?)", [step.name]);
    console.log(`Database upgraded: ${step.name}`);
  }
}
