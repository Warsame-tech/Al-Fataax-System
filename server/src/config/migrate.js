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
  { table: "business_user_roles", column: "role_id", ddl: "ALTER TABLE business_user_roles ADD COLUMN role_id INT UNSIGNED NULL AFTER role" }
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
  await linkAllBusinesses();
}
