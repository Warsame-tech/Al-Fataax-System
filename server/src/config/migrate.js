/*
 * Small, idempotent schema upgrades for databases created by an older schema.sql.
 * Runs at server start; each step checks information_schema first, so it is safe
 * on MySQL and MariaDB and does nothing when the column already exists.
 */
import { pool } from "./db.js";

const COLUMNS = [
  { table: "products", column: "image_path", ddl: "ALTER TABLE products ADD COLUMN image_path VARCHAR(255) NULL AFTER barcode" }
];

export async function migrate() {
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
}
