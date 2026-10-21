/*
 * Runs database/schema.sql against MySQL.
 * Usage (from /server): npm run db:init
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { env } from "../config/env.js";

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");

// Connect without selecting a database, since the script creates it.
const { database, ...connection } = env.db;

try {
  const conn = await mysql.createConnection({ ...connection, multipleStatements: true });
  await conn.query(sql);
  await conn.end();
  console.log(`Database ready: ${database}`);
} catch (err) {
  console.error(`Could not set up the database: ${err.code || err.message}`);
  console.error("Is MySQL running? Check DB_* values in server/.env.");
  process.exit(1);
}
