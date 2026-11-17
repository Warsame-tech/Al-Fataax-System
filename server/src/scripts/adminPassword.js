/*
 * Sets the password of a super admin (platform_admins), creating the account if it doesn't exist.
 * Usage (from /server):  npm run admin:password -- <username> [password]
 *   no password given → a strong random one is made and printed once.
 * Works on any database the server is configured for (server/.env locally, the host's MySQL variables online).
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";

const username = String(process.argv[2] || "").trim().toLowerCase();
let password = process.argv[3];
if (!username) {
  console.error("Usage: npm run admin:password -- <username> [password]");
  process.exit(1);
}
if (!password) password = `${crypto.randomBytes(9).toString("base64url")}#${crypto.randomInt(10, 99)}`;
if (password.length < 10) {
  console.error("The password must be at least 10 characters.");
  process.exit(1);
}

try {
  const hash = await bcrypt.hash(password, 12);
  const [[a]] = await pool.query("SELECT id FROM platform_admins WHERE username = ? OR email = ?", [username, username]);
  if (a) {
    await pool.query("UPDATE platform_admins SET password_hash = ?, status = 'active' WHERE id = ?", [hash, a.id]);
    await pool.query("INSERT INTO audit_logs (platform_admin_id, action) VALUES (?, 'admin.passwordReset')", [a.id]);
    console.log(`Password changed for super admin "${username}".`);
  } else {
    const [r] = await pool.query("INSERT INTO platform_admins (username, email, password_hash) VALUES (?, ?, ?)", [username, `${username}@faatix.local`, hash]);
    await pool.query("INSERT INTO audit_logs (platform_admin_id, action) VALUES (?, 'admin.created')", [r.insertId]);
    console.log(`Super admin "${username}" created.`);
  }
  if (!process.argv[3]) console.log(`New password: ${password}`);
  console.log("Sign in at /admin");
  process.exit(0);
} catch (err) {
  console.error(`Could not set the password: ${err.code || err.message}`);
  process.exit(1);
}
