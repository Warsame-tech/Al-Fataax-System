/*
 * Uploaded images (business logos, product photos) are stored in the database table
 * `stored_files`, not as loose files. Hosting platforms such as Railway wipe the server's
 * disk on every deploy; the database keeps the images safe.
 * Images are served publicly at /files/<random key> (like a normal image link).
 * Older images saved as files under /uploads/... keep working and are cleaned up the same way.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { pool } from "../config/db.js";

const UPLOADS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads");
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** multer for one image field kept in memory (PNG / JPG / WEBP, up to 2 MB). */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => cb(null, IMAGE_TYPES.includes(file.mimetype))
});

/** The real type from the file's first bytes (not the name the browser sent), or null. */
export function imageType(buffer) {
  const b = buffer?.subarray(0, 12);
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Saves an uploaded image; returns its public path ("/files/<key>"). */
export async function saveImage(db, businessId, file, kind) {
  const mime = imageType(file?.buffer);
  if (!mime) return null;
  const key = crypto.randomBytes(16).toString("hex");
  await db.query(
    "INSERT INTO stored_files (file_key, business_id, kind, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)",
    [key, businessId || null, kind, mime, file.buffer.length, file.buffer]
  );
  return `/files/${key}`;
}

/** Removes an image that is no longer used (database image or an old file on disk). Never throws. */
export async function removeImage(p, db = pool) {
  if (!p) return;
  try {
    const stored = /^\/files\/([a-f0-9]{32})$/.exec(p);
    if (stored) { await db.query("DELETE FROM stored_files WHERE file_key = ?", [stored[1]]); return; }
    const old = /^\/uploads\/(logos|products)\/([\w.-]+)$/.exec(p);
    if (old) await fs.promises.unlink(path.join(UPLOADS_ROOT, old[1], old[2]));
  } catch { /* already gone */ }
}

/* GET /files/:key — public image (logos and product photos appear on invoices and the POS). */
export const filesRouter = Router();
filesRouter.get("/:key", async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{32}$/.test(req.params.key)) return res.status(404).end();
    const [[f]] = await pool.query("SELECT mime, data FROM stored_files WHERE file_key = ?", [req.params.key]);
    if (!f) return res.status(404).end();
    res.set({
      "Content-Type": f.mime,
      "Cache-Control": "public, max-age=31536000, immutable",   // the key changes whenever the image changes
      "X-Content-Type-Options": "nosniff"
    });
    res.send(f.data);
  } catch (err) { next(err); }
});
