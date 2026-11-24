/*
 * Modules a super admin can switch off for one business (Super admin → business page → Modules; table business_modules
 * in the central database, a row with enabled = 0 means off; no row = on).
 * Off: the module disappears from the business's menu, dashboard and shortcuts (client), and the API refuses every change
 * (POST / PUT / PATCH / DELETE) under its paths with 403 moduleDisabled (middleware/auth.js). Reading stays allowed, because
 * other screens use the same lists (e.g. the POS lists customers).
 * The core of the app (overview, POS, products, stock, staff, settings…) can't be switched off.
 */
import { corePool } from "../config/db.js";

export const SWITCHABLE = {
  invoices: ["/api/invoices"],
  customers: ["/api/customers"],
  suppliers: ["/api/suppliers"],
  purchases: ["/api/purchases"],
  promotions: ["/api/promotions"],
  shifts: ["/api/shifts"],
  expenses: ["/api/money"],
  cashbook: ["/api/accounts"],
  reports: ["/api/reports"],
  hr: ["/api/hr"],
  branches: ["/api/branches"],
  devices: ["/api/devices"],
  warranties: ["/api/warranties"],
  rolls: ["/api/rolls"],
  tailoring: ["/api/tailoring"],
  waste: ["/api/waste"],
  accounting: ["/api/accounting"]
};
// modules switched off completely (reading too): nothing else depends on their lists
const WHOLE = new Set(["accounting"]);

const cache = new Map();   // businessId → { at, list }
export const forgetModules = (businessId) => cache.delete(Number(businessId));

export async function disabledModules(businessId) {
  const hit = cache.get(Number(businessId));
  if (hit && Date.now() - hit.at < 30000) return hit.list;
  const [rows] = await corePool.query("SELECT module FROM business_modules WHERE business_id = ? AND enabled = 0", [businessId]);
  const list = rows.map((r) => r.module).filter((m) => SWITCHABLE[m]);
  cache.set(Number(businessId), { at: Date.now(), list });
  return list;
}

/** The switched-off module a change request falls under (or null). */
export function blockedModule(disabled, method, url) {
  const read = ["GET", "HEAD", "OPTIONS"].includes(method);
  const path = String(url || "").split("?")[0];
  return disabled.find((m) => (!read || WHOLE.has(m)) && SWITCHABLE[m].some((p) => path === p || path.startsWith(`${p}/`))) || null;
}
