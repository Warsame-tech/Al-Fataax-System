import mysql from "mysql2/promise";
import { env } from "./env.js";

/** Shared MySQL connection pool. Use `pool.query(sql, params)` everywhere. */
export const pool = mysql.createPool({
  ...env.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  dateStrings: true   // return DATE/DATETIME exactly as stored (no timezone shifts)
});

/** Returns true when MySQL answers, false otherwise (never throws). */
export async function checkDatabase() {
  try {
    await pool.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }
}
