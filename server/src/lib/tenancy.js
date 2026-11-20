/*
 * Multi-tenancy: which database a business lives in, and which business a request belongs to.
 *
 *   database_registry (core)  business_id → mode "shared" (central database) | "dedicated" (own database),
 *                             with host / port / name / user and the password ENCRYPTED (AES-256-GCM, TENANT_DB_KEY).
 *   Tenant resolution (server side only):
 *     1. the signed session cookie of a business user (its business id)            — every signed-in request
 *     2. the Host: <slug>.<BASE_DOMAIN> or a verified custom domain (business_domains)
 *     3. the X-Tenant header (a slug, set by the app's branded sign-in page /b/<slug> when there is no subdomain)
 *   When the host names a business and the session belongs to another one, the session is refused (middleware/auth.js).
 *
 * A dedicated business's database holds the full business schema with only its own rows; its `businesses` row has the
 * same id as in the core database. Platform data (plans, subscriptions, trials, support, settings) stays in the core.
 */
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { corePool, runWithPool } from "../config/db.js";
import { env } from "../config/env.js";

/* ---------- secrets ---------- */
let warned = false;
function key() {
  if (!env.tenantDbKey) {
    if (env.isProd) throw Object.assign(new Error("TENANT_DB_KEY is not set"), { code: "tenantKeyMissing" });
    if (!warned) { console.warn("TENANT_DB_KEY is not set — using a development key derived from JWT_SECRET."); warned = true; }
  }
  return crypto.createHash("sha256").update(env.tenantDbKey || `${env.jwtSecret}:tenant-db`).digest();
}
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}
export function decryptSecret(value) {
  const [v, iv, tag, data] = String(value || "").split(":");
  if (v !== "v1") throw new Error("bad secret");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/* ---------- registry and pools ---------- */
const regCache = new Map();     // businessId → { at, row|null }
const pools = new Map();        // businessId → mysql pool
export function forgetTenant(businessId) {
  regCache.delete(Number(businessId));
  const p = pools.get(Number(businessId));
  if (p) { pools.delete(Number(businessId)); p.end().catch(() => {}); }
}

export async function registryOf(businessId) {
  const bid = Number(businessId);
  const hit = regCache.get(bid);
  if (hit && Date.now() - hit.at < 30000) return hit.row;
  const [[row]] = await corePool.query("SELECT * FROM database_registry WHERE business_id = ?", [bid]);
  regCache.set(bid, { at: Date.now(), row: row || null });
  return row || null;
}

/** Connection settings of a dedicated business database (password decrypted, never logged). */
export function connectionOf(reg) {
  return {
    host: reg.db_host || env.db.host, port: Number(reg.db_port) || env.db.port, database: reg.db_name,
    user: reg.db_user || env.db.user, password: reg.db_password_enc ? decryptSecret(reg.db_password_enc) : env.db.password
  };
}

/** The pool for a business: its own database when dedicated and ready, otherwise the core pool. */
export async function poolFor(businessId) {
  const reg = await registryOf(businessId);
  if (!reg || reg.mode !== "dedicated" || !["ready", "migrating"].includes(reg.status)) return corePool;
  let p = pools.get(Number(businessId));
  if (!p) {
    p = mysql.createPool({ ...connectionOf(reg), waitForConnections: true, connectionLimit: 5, charset: "utf8mb4", dateStrings: true });
    pools.set(Number(businessId), p);
  }
  return p;
}
export const isDedicated = async (businessId) => (await poolFor(businessId)) !== corePool;

/** Runs fn(pool) with `pool` (config/db.js) pointing at the business's database. */
export async function withTenant(businessId, fn) {
  const p = await poolFor(businessId);
  return runWithPool({ pool: p, businessId: Number(businessId), dedicated: p !== corePool }, () => fn(p));
}

/** Every business database: the core (shared businesses) and each ready dedicated one. fn(pool, { businessId|null }) */
export async function forEachDatabase(fn) {
  const out = [await fn(corePool, { businessId: null })];
  const [rows] = await corePool.query("SELECT business_id FROM database_registry WHERE mode = 'dedicated' AND status IN ('ready','migrating')");
  for (const r of rows) {
    try { out.push(await withTenant(r.business_id, (p) => fn(p, { businessId: r.business_id }))); }
    catch (err) { console.error(`Business ${r.business_id} database:`, err.code || err.message); }
  }
  return out;
}

/* ---------- the business row exists in both databases (same id): keep the two copies the same ---------- */
const MIRRORED = ["name", "owner_name", "email", "phone", "business_type", "address", "logo_path"];
/** After the business edits its profile in its own database: copy it to the central registry. */
export async function mirrorToCore(businessId) {
  const p = await poolFor(businessId);
  if (p === corePool) return;
  const [[b]] = await p.query(`SELECT ${MIRRORED.join(", ")} FROM businesses WHERE id = ?`, [businessId]);
  if (b) await corePool.query(`UPDATE businesses SET ${MIRRORED.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...MIRRORED.map((c) => b[c]), businessId]);
  slugCache.clear();
}
/** After a super admin edits the business in the central registry: copy it to the business's own database. */
export async function mirrorToTenant(businessId) {
  const p = await poolFor(businessId);
  if (p === corePool) return;
  const [[b]] = await corePool.query(`SELECT ${MIRRORED.join(", ")}, status, slug FROM businesses WHERE id = ?`, [businessId]);
  if (b) await p.query(`UPDATE businesses SET ${MIRRORED.map((c) => `${c} = ?`).join(", ")}, status = ?, slug = ? WHERE id = ?`, [...MIRRORED.map((c) => b[c]), b.status, b.slug, businessId]);
}

/* ---------- which business does this request belong to? ---------- */
export const RESERVED_SLUGS = new Set(["www", "app", "admin", "api", "mail", "smtp", "ftp", "static", "assets", "files", "uploads", "help", "support", "status", "blog", "docs", "faatix"]);
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const slugCache = new Map();
export async function businessBySlug(slug) {
  const s = String(slug || "").toLowerCase();
  if (!SLUG.test(s)) return null;
  const hit = slugCache.get(s);
  if (hit && Date.now() - hit.at < 30000) return hit.row;
  const [[row]] = await corePool.query("SELECT id, name, slug, status, logo_path, business_type FROM businesses WHERE slug = ?", [s]);
  slugCache.set(s, { at: Date.now(), row: row || null });
  return row || null;
}
async function businessByDomain(host) {
  const [[row]] = await corePool.query(
    `SELECT b.id, b.name, b.slug, b.status, b.logo_path, b.business_type FROM business_domains d JOIN businesses b ON b.id = d.business_id
      WHERE d.domain = ? AND d.status = 'verified'`, [host]);
  return row || null;
}
export const forgetSlugs = () => slugCache.clear();

/** The business named by the host or the X-Tenant header (null: the plain Faatix address). */
export async function tenantFromRequest(req) {
  const host = String(req.hostname || "").toLowerCase();
  if (env.baseDomain && host.endsWith(`.${env.baseDomain}`)) {
    const sub = host.slice(0, -(env.baseDomain.length + 1));
    if (!sub.includes(".") && !RESERVED_SLUGS.has(sub)) return { business: await businessBySlug(sub), via: "subdomain", slug: sub };
  } else if (host && host !== env.baseDomain && !/^(localhost|127\.|\[::1\]|\d+\.\d+\.\d+\.\d+)/.test(host) && !host.endsWith(".railway.app") && !host.endsWith(".up.railway.app")) {
    const b = await businessByDomain(host).catch(() => null);
    if (b) return { business: b, via: "domain", slug: b.slug };
  }
  const h = String(req.get("X-Tenant") || "").toLowerCase();
  if (h) return { business: await businessBySlug(h), via: "header", slug: h };
  return null;
}

const SKIP = /^\/api\/(admin|contact|health)(\/|$)/;
/*
 * Express middleware (mounted before every API and /files route): picks the business database for this request.
 * Sets req.tenant = { id, slug, via } when the host / header names a business.
 */
export function tenantContext(cookieName) {
  return async (req, res, next) => {
    if (SKIP.test(req.originalUrl)) return next();
    try {
      const t = await tenantFromRequest(req);
      if (t) {
        if (!t.business) return res.status(404).json({ code: "tenantNotFound" });
        req.tenant = { id: t.business.id, slug: t.business.slug, via: t.via, status: t.business.status };
      }
      let bid = req.tenant?.id || null;
      const token = req.cookies?.[cookieName];
      if (token) {
        try { const p = jwt.verify(token, env.jwtSecret); if (p?.bid) bid = req.tenant && req.tenant.id !== p.bid ? req.tenant.id : p.bid; } catch { /* checked by requireAuth */ }
      }
      if (!bid) return next();
      const p = await poolFor(bid);
      runWithPool({ pool: p, businessId: bid, dedicated: p !== corePool }, () => next());
    } catch (err) { next(err); }
  };
}
