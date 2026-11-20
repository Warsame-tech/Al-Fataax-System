/*
 * Backups (Super admin → Databases → Backups). Written by the server itself (no mysqldump needed):
 * one gzip file of JSON lines per backup — { "table": ..., "row": {...} } — in BACKUP_DIR (default server/backups).
 *   scope "core"      the whole central database
 *   scope "business"  a business: its own database (dedicated), or its rows in the central database (shared)
 * The list is in the backups table. Restoring is a deliberate manual job (see docs/ARCHITECTURE.md).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { corePool } from "../config/db.js";
import { env } from "../config/env.js";
import { poolFor, registryOf } from "./tenancy.js";
import { platformSettings } from "./platform.js";

export const BACKUP_DIR = path.resolve(env.backupDir || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../backups"));
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");

async function dump(db, out, filter) {
  const [tables] = await db.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
  let rows = 0;
  let count = 0;
  for (const { t } of tables) {
    let where = "";
    const params = [];
    if (filter) {
      const [[col]] = await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'business_id'", [t]);
      if (col.n) { where = " WHERE business_id = ?"; params.push(filter); }
      else if (t === "businesses") { where = " WHERE id = ?"; params.push(filter); }
      else continue;   // a shared business: only tables that carry its business id
    }
    count++;
    // in pages, so a big table never sits in memory at once
    for (let offset = 0; ; offset += 2000) {
      const [page] = await db.query(`SELECT * FROM \`${t}\`${where} LIMIT 2000 OFFSET ${offset}`, params);
      for (const r of page) {
        for (const [k, v] of Object.entries(r)) if (Buffer.isBuffer(v)) r[k] = { $base64: v.toString("base64") };
        if (!out.write(JSON.stringify({ table: t, row: r }) + "\n")) await once(out, "drain");
        rows++;
      }
      if (page.length < 2000) break;
    }
  }
  return { tables: count, rows };
}

/** Makes a backup; returns the backups row. */
export async function makeBackup({ scope, businessId = null, adminId = null }) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = scope === "core" ? `core-${stamp()}.jsonl.gz` : `business-${businessId}-${stamp()}.jsonl.gz`;
  const file = path.join(BACKUP_DIR, name);
  const [ins] = await corePool.query("INSERT INTO backups (scope, business_id, file_name, status, admin_id) VALUES (?, ?, ?, 'running', ?)", [scope, businessId, name, adminId]);
  const gz = zlib.createGzip();
  const fileStream = fs.createWriteStream(file, { mode: 0o600 });
  gz.pipe(fileStream);
  try {
    gz.write(JSON.stringify({ faatixBackup: 1, scope, businessId, at: new Date().toISOString() }) + "\n");
    let res;
    if (scope === "core") res = await dump(corePool, gz, null);
    else {
      const reg = await registryOf(businessId);
      const db = await poolFor(businessId);
      res = await dump(db, gz, reg?.mode === "dedicated" && db !== corePool ? null : businessId);
      await corePool.query("UPDATE database_registry SET last_backup_at = UTC_TIMESTAMP() WHERE business_id = ?", [businessId]);
    }
    gz.end();
    await once(fileStream, "finish");
    const size = fs.statSync(file).size;
    await corePool.query("UPDATE backups SET status = 'done', size_bytes = ?, tables_count = ?, rows_count = ? WHERE id = ?", [size, res.tables, res.rows, ins.insertId]);
  } catch (err) {
    gz.destroy();
    fileStream.destroy();
    fs.promises.unlink(file).catch(() => {});
    await corePool.query("UPDATE backups SET status = 'failed', error = ? WHERE id = ?", [String(err.code || err.message).slice(0, 480), ins.insertId]);
  }
  const [[row]] = await corePool.query("SELECT * FROM backups WHERE id = ?", [ins.insertId]);
  return row;
}

export function backupPath(fileName) {
  const safe = path.basename(String(fileName || ""));
  return /^[\w.-]+\.jsonl\.gz$/.test(safe) ? path.join(BACKUP_DIR, safe) : null;
}

/** Daily backups when switched on (System settings → Backups): the core and every own database, keeping the newest N. */
export async function runScheduledBackups() {
  const s = await platformSettings();
  if (!s.dailyBackups) return;
  const [[last]] = await corePool.query("SELECT MAX(created_at) at FROM backups WHERE scope = 'core' AND status = 'done' AND admin_id IS NULL");
  if (last?.at && Date.now() - new Date(`${String(last.at).replace(" ", "T")}Z`).getTime() < 23 * 3600 * 1000) return;
  await makeBackup({ scope: "core" });
  const [rows] = await corePool.query("SELECT business_id FROM database_registry WHERE mode = 'dedicated' AND status = 'ready'");
  for (const r of rows) await makeBackup({ scope: "business", businessId: r.business_id });
  // keep the newest backups of each kind
  const keep = Math.max(1, Number(s.keepBackups) || 14);
  const [old] = await corePool.query(
    `SELECT id, file_name FROM (SELECT id, file_name, ROW_NUMBER() OVER (PARTITION BY scope, business_id ORDER BY created_at DESC) n FROM backups WHERE admin_id IS NULL) x WHERE n > ?`, [keep]);
  for (const o of old) {
    const p = backupPath(o.file_name);
    if (p) await fs.promises.unlink(p).catch(() => {});
    await corePool.query("DELETE FROM backups WHERE id = ?", [o.id]);
  }
}
export function startBackupJob() {
  const run = () => runScheduledBackups().catch((err) => console.error("Scheduled backup failed:", err.code || err.message));
  setTimeout(run, 60000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
