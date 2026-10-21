import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { pool } from "../config/db.js";
import { env } from "../config/env.js";
import { setSessionCookie, clearSessionCookie, requireAuth, audit } from "../middleware/auth.js";
import { permissionsFor } from "../lib/permissions.js";

const router = Router();

/* ---------- logo uploads ---------- */
export const UPLOAD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads/logos");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const LOGO_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `logo-${Date.now()}-${Math.round(Math.random() * 1e9)}${LOGO_TYPES[file.mimetype]}`)
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, Boolean(LOGO_TYPES[file.mimetype]))
});

// Checks the file really is PNG / JPEG / WEBP (not just the declared type).
function isRealImage(file) {
  const b = fs.readFileSync(file.path).subarray(0, 12);
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const webp = b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
  return png || jpg || webp;
}
const removeFile = (file) => file && fs.promises.unlink(file.path).catch(() => {});

/* ---------- validation ---------- */
export const BUSINESS_TYPES = ["retail", "supermarket", "cosmetics", "fashion", "pharmacy", "electronics", "furniture",
  "hardware", "books", "bakery", "jewelry", "wholesale", "services", "other"];

const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9\s-]{7,20}$/;

function validateRegistration(b) {
  const errors = {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const data = {
    businessName: str(b.businessName), ownerName: str(b.ownerName), username: str(b.username).toLowerCase(),
    email: str(b.email).toLowerCase(), phone: str(b.phone), password: typeof b.password === "string" ? b.password : "",
    confirmPassword: typeof b.confirmPassword === "string" ? b.confirmPassword : "",
    businessType: str(b.businessType), address: str(b.address)
  };
  if (data.businessName.length < 2 || data.businessName.length > 150) errors.businessName = "required";
  if (data.ownerName.length < 2 || data.ownerName.length > 150) errors.ownerName = "required";
  if (!USERNAME.test(data.username)) errors.username = "invalidUsername";
  if (data.email && !EMAIL.test(data.email)) errors.email = "invalidEmail";
  if (!PHONE.test(data.phone)) errors.phone = "invalidPhone";
  // The owner chooses any password (only non-empty and a sane maximum length).
  if (!data.password || data.password.length > 200) errors.password = "required";
  if (data.password !== data.confirmPassword) errors.confirmPassword = "passwordMismatch";
  if (!BUSINESS_TYPES.includes(data.businessType)) errors.businessType = "required";
  if (data.address.length > 255) errors.address = "tooLong";
  return { data, errors };
}

/* ---------- POST /api/auth/register ---------- */
router.post("/register", upload.single("logo"), async (req, res, next) => {
  const file = req.file;
  const { data, errors } = validateRegistration(req.body || {});
  if (file && !isRealImage(file)) errors.logo = "invalidLogo";
  if (Object.keys(errors).length) {
    await removeFile(file);
    return res.status(400).json({ code: "validation", errors });
  }

  const conn = await pool.getConnection();
  try {
    const [taken] = await conn.query("SELECT id FROM users WHERE username = ?", [data.username]);
    if (taken.length) {
      await removeFile(file);
      return res.status(409).json({ code: "validation", errors: { username: "usernameTaken" } });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const logoPath = file ? `/uploads/logos/${file.filename}` : null;

    // Everything below succeeds or fails together.
    await conn.beginTransaction();
    const [biz] = await conn.query(
      `INSERT INTO businesses (name, owner_name, email, phone, business_type, address, logo_path, terms_accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [data.businessName, data.ownerName, data.email || null, data.phone, data.businessType, data.address || null, logoPath]
    );
    const businessId = biz.insertId;
    const [usr] = await conn.query(
      "INSERT INTO users (business_id, full_name, username, email, phone, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
      [businessId, data.ownerName, data.username, data.email || null, data.phone, passwordHash]
    );
    const userId = usr.insertId;
    await conn.query("INSERT INTO business_user_roles (business_id, user_id, role) VALUES (?, ?, 'owner')", [businessId, userId]);
    await conn.query("INSERT INTO business_settings (business_id) VALUES (?)", [businessId]);
    await conn.query("INSERT INTO cash_accounts (business_id, name, is_default) VALUES (?, 'Main cash', 1), (?, 'Mobile money', 0)", [businessId, businessId]);
    await conn.query(
      "INSERT INTO trial_records (business_id, start_date, end_date) VALUES (?, UTC_DATE(), DATE_ADD(UTC_DATE(), INTERVAL ? DAY))",
      [businessId, env.trialDays]
    );
    await audit(conn, { businessId, userId, action: "business.registered", entity: "business", entityId: businessId, ip: req.ip });
    await conn.commit();

    setSessionCookie(res, { uid: userId, bid: businessId });
    res.status(201).json({ code: "registered" });
  } catch (err) {
    await conn.rollback().catch(() => {});
    await removeFile(file);
    if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ code: "validation", errors: { username: "usernameTaken" } });
    next(err);
  } finally {
    conn.release();
  }
});

/* ---------- POST /api/auth/sign-in ---------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ code: "tooManyAttempts" })
});

// A real bcrypt hash used when the user doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

router.post("/sign-in", loginLimiter, async (req, res, next) => {
  try {
    const login = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!login || !password) return res.status(400).json({ code: "required" });

    // Username, email or phone.
    const [rows] = await pool.query(
      `SELECT u.id, u.business_id, u.password_hash, u.status, b.status AS business_status
         FROM users u JOIN businesses b ON b.id = u.business_id
        WHERE u.username = ? OR u.email = ? OR u.phone = ?
        LIMIT 1`,
      [login, login, login]
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok || user.status !== "active") {
      await audit(null, { businessId: user?.business_id ?? null, userId: user?.id ?? null, action: "auth.login_failed", ip: req.ip });
      return res.status(401).json({ code: "invalidCredentials" });
    }
    if (user.business_status !== "active") return res.status(403).json({ code: "businessSuspended" });

    await pool.query("UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [user.id]);
    await audit(null, { businessId: user.business_id, userId: user.id, action: "auth.login", ip: req.ip });
    setSessionCookie(res, { uid: user.id, bid: user.business_id }); // fresh token = fresh session
    res.json({ code: "signedIn" });
  } catch (err) {
    next(err);
  }
});

/* ---------- POST /api/auth/sign-out ---------- */
router.post("/sign-out", (req, res) => {
  clearSessionCookie(res);
  res.json({ code: "signedOut" });
});

/* ---------- GET /api/auth/me ---------- */
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const [trial] = await pool.query(
      "SELECT start_date, end_date, status FROM trial_records WHERE business_id = ? ORDER BY id DESC LIMIT 1",
      [req.business.id]
    );
    res.json({ user: req.user, business: req.business, trial: trial[0] || null, permissions: permissionsFor(req.user.role) });
  } catch (err) {
    next(err);
  }
});

/* ---------- PATCH /api/auth/language ---------- */
router.patch("/language", requireAuth, async (req, res, next) => {
  try {
    const lang = req.body?.language;
    if (!["en", "so"].includes(lang)) return res.status(400).json({ code: "required" });
    await pool.query("UPDATE users SET language = ? WHERE id = ? AND business_id = ?", [lang, req.user.id, req.business.id]);
    res.json({ code: "saved" });
  } catch (err) {
    next(err);
  }
});

export default router;
