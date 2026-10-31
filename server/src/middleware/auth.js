import jwt from "jsonwebtoken";
import { ALL_PERMISSIONS, permissionsFor } from "../lib/permissions.js";
import { parsePermissions } from "../lib/roles.js";
import { pool } from "../config/db.js";
import { env } from "../config/env.js";
import { profileFor } from "../lib/businessProfiles.js";

export const SESSION_COOKIE = "faatix_session";

export function setSessionCookie(res, payload) {
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: `${env.sessionDays}d` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",          // blocks cross-site requests carrying the cookie (CSRF)
    secure: env.isProd,          // HTTPS-only in production
    maxAge: env.sessionDays * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/*
 * Requires a signed-in business user. Re-reads the user and business on every
 * request so suspended accounts lose access immediately, and attaches:
 *   req.user     { id, fullName, username, role, language }
 *   req.business { id, name, ... }
 * Every business query MUST filter by req.business.id (tenant isolation).
 */
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return res.status(401).json({ code: "unauthenticated" });

    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      clearSessionCookie(res);
      return res.status(401).json({ code: "unauthenticated" });
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.full_name, u.username, u.language, u.status AS user_status,
              r.role, r.role_id, ro.name AS role_name, ro.permissions AS role_permissions,
              b.id AS business_id, b.name AS business_name, b.status AS business_status,
              b.logo_path, b.phone, b.email, b.address, b.business_type,
              s.currency, s.invoice_prefix, s.invoice_footer, s.allow_duplicate_codes, s.weight_decimals
         FROM users u
         JOIN businesses b ON b.id = u.business_id
         JOIN business_user_roles r ON r.user_id = u.id AND r.business_id = b.id
         LEFT JOIN roles ro ON ro.id = r.role_id AND ro.business_id = b.id
         LEFT JOIN business_settings s ON s.business_id = b.id
        WHERE u.id = ? AND b.id = ?`,
      [payload.uid, payload.bid]
    );
    const row = rows[0];
    if (!row || row.user_status !== "active") {
      clearSessionCookie(res);
      return res.status(401).json({ code: "unauthenticated" });
    }
    if (row.business_status !== "active") {
      return res.status(403).json({ code: "businessSuspended" });
    }

    // Owner: everything. Staff: the permissions of their business role (none if the role is missing).
    const isOwner = row.role === "owner";
    const permissions = isOwner ? ALL_PERMISSIONS
      : row.role_id ? (row.role_name ? parsePermissions(row.role_permissions) : [])
      : permissionsFor(row.role);   // not linked yet: the old fixed role of the same name
    req.user = {
      id: row.id, fullName: row.full_name, username: row.username, language: row.language,
      role: isOwner ? "owner" : row.role, roleId: row.role_id || null,
      roleName: isOwner ? null : row.role_name || null, permissions
    };
    req.business = {
      id: row.business_id, name: row.business_name, logoPath: row.logo_path, phone: row.phone,
      email: row.email, address: row.address, type: row.business_type,
      currency: row.currency || "USD", invoicePrefix: row.invoice_prefix, invoiceFooter: row.invoice_footer,
      allowDuplicateCodes: Boolean(row.allow_duplicate_codes),
      weightDecimals: row.weight_decimals === null || row.weight_decimals === undefined ? 3 : Number(row.weight_decimals),
      profile: profileFor(row.business_type)        // this business type's own interface (lib/businessProfiles.js)
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Allows only the listed roles, e.g. requireRole("owner", "manager"). */
export function requireRole(...roles) {
  return (req, res, next) => (roles.includes(req.user?.role) ? next() : res.status(403).json({ code: "forbidden" }));
}

/** Writes an audit record. Never throws (auditing must not break the request). */
export async function audit(conn, { businessId = null, userId = null, action, entity = null, entityId = null, meta = null, ip = null }) {
  try {
    await (conn || pool).query(
      "INSERT INTO audit_logs (business_id, user_id, action, entity, entity_id, meta, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [businessId, userId, action, entity, entityId, meta ? JSON.stringify(meta) : null, ip]
    );
  } catch (err) {
    console.error("audit failed:", err.message);
  }
}
