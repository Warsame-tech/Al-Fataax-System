import { AsyncLocalStorage } from "node:async_hooks";
import mysql from "mysql2/promise";
import { env } from "./env.js";

/*
 * Databases
 *   corePool — the central platform database (DB_NAME, e.g. "faatix"): businesses registry, plans, subscriptions,
 *              super admins, support, settings … and the data of businesses that still share it ("shared" mode).
 *   pool     — "the database of the business this request belongs to". It is a stand-in that forwards every call
 *              to the tenant pool chosen for the current request (lib/tenancy.js → tenantContext), or to corePool
 *              when there is none. All business routes keep using `pool` unchanged; a business with its own
 *              database (faatix_<slug>_db) simply gets its own pool here.
 */
export const corePool = mysql.createPool({
  ...env.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  dateStrings: true   // return DATE/DATETIME exactly as stored (no timezone shifts)
});

const tenantStore = new AsyncLocalStorage();
/** The pool of the current request's business (or the core pool). */
export const currentPool = () => tenantStore.getStore()?.pool || corePool;
/** The current tenant context ({ pool, businessId, dedicated }) or null. */
export const currentTenant = () => tenantStore.getStore() || null;
/** Runs fn with `pool` pointing at the given pool. */
export const runWithPool = (ctx, fn) => tenantStore.run(ctx, fn);

export const pool = new Proxy({}, {
  get(_, key) {
    const target = currentPool();
    const v = target[key];
    return typeof v === "function" ? v.bind(target) : v;
  }
});

/** Returns true when MySQL answers, false otherwise (never throws). */
export async function checkDatabase(db = corePool) {
  try {
    await db.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }
}
