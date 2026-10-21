/*
 * Shared accounting helpers. Every function takes a transaction connection
 * so callers keep sales / invoices / purchases atomic.
 */
import { badRequest, HttpError, notFound } from "./http.js";

/* ---------- document numbers (serialized by locking the settings row) ---------- */
const NUMBERING = {
  invoice: ["invoice_prefix", "invoices"],
  receipt: ["receipt_prefix", "sales"],
  purchase: ["purchase_prefix", "purchases"]
};
export async function nextNumber(conn, businessId, kind) {
  const [col, table] = NUMBERING[kind];
  const [[s]] = await conn.query(`SELECT ${col} AS p FROM business_settings WHERE business_id = ? FOR UPDATE`, [businessId]);
  const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM ${table} WHERE business_id = ?`, [businessId]);
  return `${s?.p || ""}${String(Number(c.n) + 1).padStart(5, "0")}`;
}

/* ---------- money accounts ---------- */
const CASH_NAMES = { cash: "Main cash", mobile_money: "Mobile money" };

/**
 * Resolves where money goes for a payment method:
 *   cash → "Main cash", mobile_money → "Mobile money" (cash accounts), bank → a bank account (required).
 */
export async function resolveAccount(conn, businessId, method, bankAccountId) {
  if (method === "bank") {
    const [[b]] = await conn.query("SELECT id FROM bank_accounts WHERE id = ? AND business_id = ?", [bankAccountId || 0, businessId]);
    if (!b) throw badRequest({ bankAccountId: "required" });
    return { cash_account_id: null, bank_account_id: b.id };
  }
  const name = CASH_NAMES[method];
  if (!name) throw badRequest({ method: "required" });
  await conn.query(
    "INSERT IGNORE INTO cash_accounts (business_id, name, is_default) VALUES (?, ?, ?)",
    [businessId, name, method === "cash" ? 1 : 0]
  );
  const [[a]] = await conn.query("SELECT id FROM cash_accounts WHERE business_id = ? AND name = ?", [businessId, name]);
  return { cash_account_id: a.id, bank_account_id: null };
}

/** Records money moving in or out of an account (the source of truth for balances). */
export async function moneyMove(conn, { businessId, userId, direction, method, bankAccountId, account, amount, refType, refId = null, description = null, at = null }) {
  if (!(amount > 0)) return;
  const acc = account || (await resolveAccount(conn, businessId, method, bankAccountId));
  await conn.query(
    `INSERT INTO cash_transactions (business_id, cash_account_id, bank_account_id, direction, amount, ref_type, ref_id, description, user_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
    [businessId, acc.cash_account_id, acc.bank_account_id, direction, amount, refType, refId, description, userId, at]
  );
}

/* ---------- stock ---------- */
/** Locks the products (FOR UPDATE) and returns a Map id → row. 404 if any id is not this business's. */
export async function lockProducts(conn, businessId, ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const [rows] = await conn.query(
    "SELECT * FROM products WHERE business_id = ? AND id IN (?) FOR UPDATE",
    [businessId, unique]
  );
  if (rows.length !== unique.length) throw notFound();
  return new Map(rows.map((r) => [r.id, r]));
}

/** Changes stock and records the movement. Refuses to go below zero. */
export async function moveStock(conn, { businessId, userId, product, qtyChange, type, refType = null, refId = null, note = null }) {
  const current = Number(product.stock_qty);
  const next = Math.round((current + qtyChange) * 1000) / 1000;
  if (next < 0) throw new HttpError(409, "insufficientStock", null, { product: product.name, available: current });
  await conn.query("UPDATE products SET stock_qty = ? WHERE id = ? AND business_id = ?", [next, product.id, businessId]);
  await conn.query(
    `INSERT INTO stock_movements (business_id, product_id, type, qty_change, ref_type, ref_id, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [businessId, product.id, type, qtyChange, refType, refId, note, userId]
  );
  product.stock_qty = next; // keep the in-memory row in sync for repeated lines
}
