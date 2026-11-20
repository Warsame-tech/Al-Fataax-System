/*
 * Platform (super admin) services: admin roles, platform settings, two-step sign-in (TOTP), blocked IPs,
 * plan limits, and the billing check that runs every hour.
 */
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { pool, corePool } from "../config/db.js";
import { env } from "../config/env.js";
import { conflict } from "./http.js";

/* ---------- platform roles (stored codes kept for existing accounts) ----------
 * owner     Super Admin       — everything, including other super admins, the data export and databases
 * admin     Platform Manager  — businesses (register, edit, suspend), billing, support, reports, settings, domains
 * technical Technical Admin   — provisioning, hosting & domains, databases, migrations, backups, security
 * billing   Finance Admin     — plans, subscriptions and payments, reports
 * support   Support Agent     — look around, answer support / messages, announcements, notes
 * The roles and their permissions are also written to platform_roles / platform_permissions (config/migrate.js). */
export const ADMIN_ROLES = {
  owner: ["view", "businesses", "provision", "billing", "support", "announcements", "reports", "security", "settings", "admins", "export", "hosting", "databases", "backups"],
  admin: ["view", "businesses", "provision", "billing", "support", "announcements", "reports", "security", "settings", "hosting"],
  technical: ["view", "provision", "hosting", "databases", "backups", "security", "reports"],
  billing: ["view", "billing", "reports"],
  support: ["view", "support", "announcements", "notes"]
};
export const ADMIN_ROLE_INFO = {
  owner: { name: "Super Admin", description: "Everything, including super admins, data export and databases" },
  admin: { name: "Platform Manager", description: "Businesses, billing, support, reports, settings and domains" },
  technical: { name: "Technical Admin", description: "Provisioning, hosting & domains, databases, migrations, backups and security" },
  billing: { name: "Finance Admin", description: "Plans, subscriptions, payments and reports" },
  support: { name: "Support Agent", description: "Support tickets, website messages, announcements and notes" }
};
export const adminCan = (admin, perm) => Boolean(ADMIN_ROLES[admin?.role]?.includes(perm) || (perm === "notes" && ADMIN_ROLES[admin?.role]?.includes("businesses")));
export const requireAdminPerm = (perm) => (req, res, next) => (adminCan(req.admin, perm) ? next() : res.status(403).json({ code: "forbidden" }));

/** A platform activity log entry made by a super admin (or by the system: adminId null). */
export async function adminAudit(db, { adminId = null, businessId = null, action, entity = null, entityId = null, meta = null, ip = null }) {
  await db.query("INSERT INTO audit_logs (platform_admin_id, business_id, action, entity, entity_id, meta, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [adminId, businessId, action, entity, entityId, meta ? JSON.stringify(meta) : null, ip]);
}

/* ---------- platform settings (key / value) ---------- */
export const SETTING_DEFAULTS = {
  trialDays: null,                // null: the server's TRIAL_DAYS (env.trialDays)
  graceDays: 7,                   // days after a subscription ends before it can be suspended
  autoSuspend: false,             // suspend a business when its subscription is unpaid past the grace days
  suspendAfterTrial: false,       // suspend a business whose trial ended without a plan
  billingCurrency: "USD",
  contact: { phones: [], emails: [], whatsapp: "", address: "" },   // empty: the website's own (client config/site.js)
  disabledTypes: [],              // business types new sign-ups can't choose
  dailyBackups: false,            // back up the central database and every own business database once a day
  keepBackups: 14                 // how many automatic backups of each database are kept
};
let cache = null;
export async function platformSettings(db = corePool) {
  if (cache && Date.now() - cache.at < 30000) return cache.value;
  const [rows] = await db.query("SELECT name, value FROM platform_settings");
  const value = { ...SETTING_DEFAULTS };
  for (const r of rows) { try { value[r.name] = JSON.parse(r.value); } catch { /* default kept */ } }
  if (value.trialDays === null || value.trialDays === undefined) value.trialDays = env.trialDays;
  cache = { at: Date.now(), value };
  return value;
}
export async function savePlatformSettings(db, values) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in SETTING_DEFAULTS)) continue;
    await db.query("INSERT INTO platform_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [k, JSON.stringify(v)]);
  }
  cache = null;
}

/* ---------- two-step sign-in: TOTP (RFC 6238 — Google Authenticator, Microsoft Authenticator…) ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function base32Decode(s) {
  let bits = "";
  for (const c of String(s).replace(/=+$/, "").toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, "0"); }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totpCode(secret, step = Math.floor(Date.now() / 30000)) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
/** A code is accepted for the current 30 seconds and one step either side (clock drift). */
export function totpValid(secret, code) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c) || !secret) return false;
  const now = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(totpCode(secret, now + d)), Buffer.from(c)));
}
export const totpUrl = (secret, username) => `otpauth://totp/${encodeURIComponent(`Faatix Admin:${username}`)}?secret=${secret}&issuer=Faatix%20Admin&algorithm=SHA1&digits=6&period=30`;

/* ---------- blocked IPs: requests from them get 403 (business app, public site, sign-in; not the super admin area) ---------- */
let blocked = { at: 0, set: new Set() };
export async function blockedIps() {
  if (Date.now() - blocked.at < 30000) return blocked.set;
  const [rows] = await corePool.query("SELECT ip FROM blocked_ips WHERE expires_at IS NULL OR expires_at > UTC_TIMESTAMP()");
  blocked = { at: Date.now(), set: new Set(rows.map((r) => r.ip)) };
  return blocked.set;
}
export const forgetBlockedIps = () => { blocked = { at: 0, set: new Set() }; };
export function blockIpMiddleware() {
  return async (req, res, next) => {
    if (req.path.startsWith("/admin") || req.path.startsWith("/health")) return next();
    try { if ((await blockedIps()).has(req.ip)) return res.status(403).json({ code: "ipBlocked" }); } catch { /* table not ready yet */ }
    next();
  };
}

/* ---------- plan limits (users, branches, products) ---------- */
const LIMIT_SQL = {
  users: "SELECT COUNT(*) n FROM users WHERE business_id = ? AND status = 'active'",
  branches: "SELECT COUNT(*) n FROM branches WHERE business_id = ? AND is_active = 1",
  products: "SELECT COUNT(*) n FROM products WHERE business_id = ? AND is_active = 1"
};
/** The business's plan (null: no plan yet, e.g. on trial — no limits). */
export async function planOf(db, businessId) {   // plans live in the central database
  const [[p]] = await corePool.query(
    `SELECT s.id subscription_id, s.status, s.cycle, s.current_period_end, p.* FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.business_id = ?`, [businessId]);
  return p || null;
}
/** Throws planLimit when adding `adding` more would go over the plan's limit for kind (users | branches | products). */
export async function checkPlanLimit(db, businessId, kind, adding = 1) {
  const plan = await planOf(db, businessId);
  let limit = plan ? plan[`max_${kind}`] : null;
  if (kind === "branches") {   // a branch limit set on the business itself (Super admin → Branch overview) wins
    const [[b]] = await corePool.query("SELECT max_branches FROM businesses WHERE id = ?", [businessId]);
    if (b?.max_branches !== null && b?.max_branches !== undefined) limit = b.max_branches;
  }
  if (limit === null || limit === undefined) return;
  const [[c]] = await db.query(LIMIT_SQL[kind], [businessId]);
  if (Number(c.n) + adding > Number(limit)) throw conflict("planLimit", { kind, limit: Number(limit), plan: plan?.name || "—" });
}

/* ---------- billing check (every hour, and when the server starts) ----------
 * trials past their end → expired (and, with suspendAfterTrial, the business is suspended when it has no plan);
 * subscriptions past their end → past_due; past the grace days, with autoSuspend → the business is suspended
 * (subscription status "suspended", so a payment brings it back). Every change is in the platform activity log. */
export async function runBillingCheck() {
  const s = await platformSettings();
  await corePool.query("UPDATE trial_records SET status = 'expired' WHERE status = 'active' AND end_date < UTC_DATE()");
  await corePool.query("UPDATE subscriptions SET status = 'past_due' WHERE status = 'active' AND current_period_end < UTC_DATE()");
  if (s.autoSuspend) {
    const [due] = await corePool.query(
      `SELECT s.id, s.business_id FROM subscriptions s JOIN businesses b ON b.id = s.business_id
        WHERE s.status = 'past_due' AND b.status = 'active' AND s.current_period_end < DATE_SUB(UTC_DATE(), INTERVAL ? DAY)`, [Number(s.graceDays) || 0]);
    for (const d of due) {
      await corePool.query("UPDATE businesses SET status = 'suspended' WHERE id = ?", [d.business_id]);
      await corePool.query("UPDATE subscriptions SET status = 'suspended' WHERE id = ?", [d.id]);
      await adminAudit(corePool, { businessId: d.business_id, action: "billing.suspended", meta: { reason: "unpaid", graceDays: s.graceDays } });
    }
  }
  if (s.suspendAfterTrial) {
    const [ended] = await corePool.query(
      `SELECT b.id FROM businesses b JOIN trial_records t ON t.business_id = b.id AND t.id = (SELECT MAX(id) FROM trial_records WHERE business_id = b.id)
        WHERE b.status = 'active' AND t.end_date < UTC_DATE() AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.business_id = b.id)`);
    for (const b of ended) {
      await corePool.query("UPDATE businesses SET status = 'suspended' WHERE id = ?", [b.id]);
      await adminAudit(corePool, { businessId: b.id, action: "billing.suspended", meta: { reason: "trialEnded" } });
    }
  }
}
export function startBillingJob() {
  const run = () => runBillingCheck().catch((err) => console.error("Billing check failed:", err.message));
  setTimeout(run, 15000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

/* ---------- a short-lived step between password and code (two-step sign-in) ---------- */
export const signPending = (adminId) => jwt.sign({ aid: adminId, scope: "admin-2fa" }, env.jwtSecret, { expiresIn: "5m" });
export function readPending(token) {
  try { const p = jwt.verify(String(token || ""), env.jwtSecret); return p.scope === "admin-2fa" ? p.aid : null; } catch { return null; }
}
