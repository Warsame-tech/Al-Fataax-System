/*
 * Branches. Every business has a main branch (made on first use; existing records and stock locations become the
 * main branch's). A branch sells from its own stock location and owns its storage locations, orders, sales, invoices,
 * purchases, expenses, cashier shifts, tables, reservations, employees and waste.
 *
 * Which branch a request works in (req.branch, set by requireAuth):
 *   staff assigned to a branch (business_user_roles.branch_id) — always that branch;
 *   others (owner, head office) — the branch chosen in the app (X-Branch header), or all branches: lists and reports
 *   then show every branch (consolidated) and new records go to the main branch.
 *   req.branch = { id (for new records), filterId (null = all), fixed, locationId (selling location), mainId, list }
 */
import { defaultLocationId } from "./stock.js";

export const BRANCH_TABLES = ["stock_locations", "sales", "invoices", "purchases", "expenses", "other_income", "cash_sessions",
  "food_orders", "food_tables", "reservations", "employees", "waste_records"];
const cache = new Map();   // businessId → { at, list }
export const forgetBranches = (businessId) => cache.delete(businessId);

export async function branchesOf(db, businessId) {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < 30000) return hit.list;
  let [rows] = await db.query("SELECT * FROM branches WHERE business_id = ? ORDER BY is_main DESC, name", [businessId]);
  if (!rows.length) {
    const loc = await defaultLocationId(db, businessId);
    const [x] = await db.query("INSERT IGNORE INTO branches (business_id, name, sell_location_id, is_main) VALUES (?, 'Main branch', ?, 1)", [businessId, loc]);
    if (x.insertId) {
      // everything recorded before branches existed belongs to the main branch
      for (const t of BRANCH_TABLES) await db.query(`UPDATE ${t} SET branch_id = ? WHERE business_id = ? AND branch_id IS NULL`, [x.insertId, businessId]);
    }
    [rows] = await db.query("SELECT * FROM branches WHERE business_id = ? ORDER BY is_main DESC, name", [businessId]);
  }
  cache.set(businessId, { at: Date.now(), list: rows });
  return rows;
}

export async function resolveBranch(db, businessId, fixedId, chosen) {
  const list = await branchesOf(db, businessId);
  const main = list.find((b) => b.is_main) || list[0];
  const pick = (v) => list.find((b) => b.id === Number(v) && b.is_active) || null;
  const fixed = fixedId ? pick(fixedId) || list.find((b) => b.id === Number(fixedId)) : null;
  const cur = fixed || (chosen ? pick(chosen) : null);
  const at = cur || main;
  return { id: at.id, filterId: cur ? cur.id : null, fixed: Boolean(fixed), locationId: at.sell_location_id || null, mainId: main.id,
    list: list.filter((b) => b.is_active).map((b) => ({ id: b.id, name: b.name, isMain: Boolean(b.is_main) })) };
}

/** " AND x.branch_id = 5" when the request looks at one branch (an integer from the server, safe inline), else "". */
export const branchSql = (req) => (alias = "") => (req.branch?.filterId ? ` AND ${alias ? `${alias}.` : ""}branch_id = ${Number(req.branch.filterId)}` : "");

/** The selling location of a branch (its own stock), or the business's default location. */
export async function branchLocation(db, businessId, branchId) {
  if (branchId) {
    const [[b]] = await db.query("SELECT sell_location_id FROM branches WHERE id = ? AND business_id = ?", [branchId, businessId]);
    if (b?.sell_location_id) return b.sell_location_id;
  }
  return defaultLocationId(db, businessId);
}
