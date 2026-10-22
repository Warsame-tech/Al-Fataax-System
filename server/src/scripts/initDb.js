/*
 * Runs database/schema.sql against MySQL (for the database named in DB_NAME / MYSQLDATABASE).
 * Usage (from /server): npm run db:init
 * The server also does this automatically on start when the tables don't exist yet.
 */
import mysql from "mysql2/promise";
import { env } from "../config/env.js";
import { schemaSql } from "../config/schema.js";

// Connect without selecting a database, since the script creates it.
const { database, ...connection } = env.db;

try {
  const conn = await mysql.createConnection({ ...connection, multipleStatements: true });
  await conn.query(schemaSql(database));
  await conn.end();
  console.log(`Database ready: ${database}`);
} catch (err) {
  console.error(`Could not set up the database: ${err.code || err.message}`);
  console.error("Is MySQL running? Check DB_* values in server/.env.");
  process.exit(1);
}
