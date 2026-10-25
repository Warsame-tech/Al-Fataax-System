import { pool } from "../config/db.js";

/** Wraps an async route handler so errors reach the central error handler. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, code, errors = null, extra = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.extra = extra;
  }
}
export const badRequest = (errors, code = "validation") => new HttpError(400, code, errors);
export const notFound = () => new HttpError(404, "notFound");
export const forbidden = () => new HttpError(403, "forbidden");
export const conflict = (code, extra) => new HttpError(409, code, null, extra);

/* ---------- input helpers (server-side validation) ---------- */
export const text = (v, max = 255) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const optText = (v, max = 255) => text(v, max) || null;

export function id(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
/** Money: finite, >= 0, kept to 4 decimals (exact 5% VAT, e.g. 5% of 0.15 = 0.0075). Returns NaN when invalid. */
export function money(v, { allowZero = true } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e11 || (!allowZero && n === 0)) return NaN;
  return Math.round(n * 10000) / 10000;
}
/** Quantity: finite, > 0, up to 3 decimals. */
export function quantity(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) return NaN;
  return Math.round(n * 1000) / 1000;
}
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const today = () => new Date().toISOString().slice(0, 10);
/** Money arithmetic result, to 4 decimals (never rounded to the cent). */
export const round2 = (n) => Math.round(n * 10000) / 10000;
export const num = (v) => Number(v || 0);

export const METHODS = ["cash", "mobile_money", "bank"];

/** Optional date range from query (?from=&to=). Defaults: last 30 days. */
export function range(q, defaultDays = 30) {
  const to = isDate(q.to) ? q.to : today();
  const fromDefault = new Date(Date.parse(to + "T00:00:00Z") - (defaultDays - 1) * 86400000).toISOString().slice(0, 10);
  const from = isDate(q.from) && q.from <= to ? q.from : fromDefault;
  return { from, to, start: `${from} 00:00:00`, end: `${to} 23:59:59` };
}

/** Runs fn inside a transaction; commits on success, rolls back on any error. */
export async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Throws 404 unless the row exists AND belongs to the business (tenant check). */
export async function ensureOwned(conn, table, rowId, businessId, lock = false) {
  if (!rowId) throw notFound();
  const [[row]] = await conn.query(
    `SELECT * FROM ${table} WHERE id = ? AND business_id = ?${lock ? " FOR UPDATE" : ""}`,
    [rowId, businessId]
  );
  if (!row) throw notFound();
  return row;
}
