/*
 * Business roles stored in the database (Staff & roles → Roles).
 * Each business starts with Manager, Cashier and Stockkeeper (from DEFAULT_ROLES);
 * existing staff with those old fixed roles are linked to them automatically.
 */
import { pool } from "../config/db.js";
import { DEFAULT_ROLES, normalizePermissions } from "./permissions.js";

export function parsePermissions(json) {
  try { return normalizePermissions(JSON.parse(json || "[]")); } catch { return []; }
}

/** Creates the starting roles once and links staff that still use the old fixed role names. */
export async function ensureDefaultRoles(bid, db = pool) {
  const [[has]] = await db.query("SELECT COUNT(*) n FROM roles WHERE business_id = ?", [bid]);
  if (!has.n) {
    for (const r of DEFAULT_ROLES) {
      await db.query(
        "INSERT IGNORE INTO roles (business_id, name, description, permissions, template_key) VALUES (?, ?, ?, ?, ?)",
        [bid, r.name, r.description, JSON.stringify(r.permissions), r.key]
      );
    }
  }
  await db.query(
    `UPDATE business_user_roles bur JOIN roles ro ON ro.business_id = bur.business_id AND ro.template_key = bur.role
        SET bur.role_id = ro.id
      WHERE bur.business_id = ? AND bur.role_id IS NULL AND bur.role <> 'owner'`, [bid]
  );
}

/** At server start: link every business's existing staff to roles. */
export async function linkAllBusinesses() {
  const [rows] = await pool.query(
    "SELECT DISTINCT business_id FROM business_user_roles WHERE role <> 'owner' AND role_id IS NULL"
  );
  for (const r of rows) await ensureDefaultRoles(r.business_id);
}
