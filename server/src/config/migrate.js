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
  }
];

const COLUMNS = [
  { table: "products", column: "image_path", ddl: "ALTER TABLE products ADD COLUMN image_path VARCHAR(255) NULL AFTER barcode" },
  { table: "customer_payments", column: "payment_method_id", ddl: "ALTER TABLE customer_payments ADD COLUMN payment_method_id INT UNSIGNED NULL AFTER method" },
  { table: "business_user_roles", column: "role_id", ddl: "ALTER TABLE business_user_roles ADD COLUMN role_id INT UNSIGNED NULL AFTER role" },
  // product master data
  { table: "sales", column: "vat_rate", ddl: "ALTER TABLE sales ADD COLUMN vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER discount" },
  { table: "sales", column: "vat_amount", ddl: "ALTER TABLE sales ADD COLUMN vat_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER vat_rate" },
  { table: "invoices", column: "vat_rate", ddl: "ALTER TABLE invoices ADD COLUMN vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER discount" },
  { table: "invoices", column: "vat_amount", ddl: "ALTER TABLE invoices ADD COLUMN vat_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER vat_rate" },
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
  { table: "stock_movements", column: "unit_cost", ddl: "ALTER TABLE stock_movements ADD COLUMN unit_cost DECIMAL(14,2) NULL AFTER unit" },
  { table: "stock_movements", column: "reason", ddl: "ALTER TABLE stock_movements ADD COLUMN reason VARCHAR(120) NULL AFTER ref_id" },
  { table: "stock_movements", column: "reference", ddl: "ALTER TABLE stock_movements ADD COLUMN reference VARCHAR(80) NULL AFTER reason" },
  { table: "stock_movements", column: "supplier_id", ddl: "ALTER TABLE stock_movements ADD COLUMN supplier_id INT UNSIGNED NULL AFTER reference" },
  { table: "stock_movements", column: "transfer_ref", ddl: "ALTER TABLE stock_movements ADD COLUMN transfer_ref VARCHAR(40) NULL AFTER supplier_id" },
  { table: "stock_movements", column: "reversal_of", ddl: "ALTER TABLE stock_movements ADD COLUMN reversal_of BIGINT UNSIGNED NULL AFTER transfer_ref" },
  // POS: change given back (shown on the receipt)
  { table: "sales", column: "change_amount", ddl: "ALTER TABLE sales ADD COLUMN change_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER amount_paid" }
];

/* Indexes added after the fact (name → DDL); checked against information_schema.STATISTICS. */
const INDEXES = [
  { table: "products", name: "idx_products_category", ddl: "ALTER TABLE products ADD INDEX idx_products_category (business_id, category_id)" },
  { table: "products", name: "idx_products_brand", ddl: "ALTER TABLE products ADD INDEX idx_products_brand (business_id, brand_id)" },
  { table: "stock_movements", name: "idx_moves_location", ddl: "ALTER TABLE stock_movements ADD INDEX idx_moves_location (business_id, location_id, created_at)" },
  { table: "stock_movements", name: "idx_moves_reversal", ddl: "ALTER TABLE stock_movements ADD INDEX idx_moves_reversal (reversal_of)" }
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
