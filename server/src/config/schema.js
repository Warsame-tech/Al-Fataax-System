/*
 * Loads database/schema.sql for the configured database name (e.g. "faatix" locally,
 * "railway" on Railway). Every statement in the file is IF NOT EXISTS, so it is safe to re-run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../database/schema.sql");

export function schemaSql(database) {
  const name = String(database).replace(/`/g, "");
  return fs.readFileSync(schemaPath, "utf8")
    .replace(/CREATE DATABASE IF NOT EXISTS faatix\b/, `CREATE DATABASE IF NOT EXISTS \`${name}\``)
    .replace(/^USE faatix;/m, `USE \`${name}\`;`);
}
