import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { ah, text, id, ensureOwned, badRequest } from "../lib/http.js";

/*
 * Drafts: unfinished work saved to continue later (a POS cart, an invoice, a purchase,
 * a stock entry, a transfer, a new product). Each draft belongs to the user who saved it.
 * The form's own state is stored as JSON; nothing is posted to stock or money until the
 * real form is submitted.
 */
const router = Router();
router.use(requireAuth);

const MODULES = ["pos", "invoice", "purchase", "stock_add", "stock_transfer", "product"];
const MAX_BYTES = 200 * 1024;
const MAX_PER_MODULE = 30;

const shape = (d) => ({ id: d.id, module: d.module, title: d.title, data: JSON.parse(d.data), updatedAt: d.updated_at });

/* GET /api/drafts?module=pos — my drafts for one module, newest first */
router.get("/", ah(async (req, res) => {
  const module = MODULES.includes(req.query.module) ? req.query.module : null;
  if (!module) throw badRequest({ module: "required" });
  const [rows] = await pool.query(
    "SELECT * FROM drafts WHERE business_id = ? AND user_id = ? AND module = ? ORDER BY updated_at DESC, id DESC LIMIT ?",
    [req.business.id, req.user.id, module, MAX_PER_MODULE]);
  res.json({ drafts: rows.map(shape) });
}));

function readDraft(body) {
  const module = MODULES.includes(body.module) ? body.module : null;
  const title = text(body.title, 120) || "Draft";
  const json = JSON.stringify(body.data ?? null);
  const e = {};
  if (!module) e.module = "required";
  if (!body.data || typeof body.data !== "object") e.data = "required";
  if (Buffer.byteLength(json) > MAX_BYTES) e.data = "tooLarge";
  if (Object.keys(e).length) throw badRequest(e);
  return { module, title, json };
}

/* POST /api/drafts { module, title, data } */
router.post("/", ah(async (req, res) => {
  const d = readDraft(req.body || {});
  const [[n]] = await pool.query("SELECT COUNT(*) n FROM drafts WHERE business_id = ? AND user_id = ? AND module = ?", [req.business.id, req.user.id, d.module]);
  if (n.n >= MAX_PER_MODULE) throw badRequest({ data: "tooManyDrafts" });
  const [r] = await pool.query("INSERT INTO drafts (business_id, user_id, module, title, data) VALUES (?, ?, ?, ?, ?)",
    [req.business.id, req.user.id, d.module, d.title, d.json]);
  res.status(201).json({ id: r.insertId });
}));

/* PUT /api/drafts/:id { module, title, data } — update my own draft */
router.put("/:id", ah(async (req, res) => {
  const d = readDraft(req.body || {});
  const row = await ensureOwned(pool, "drafts", id(req.params.id), req.business.id);
  if (row.user_id !== req.user.id) return res.status(404).json({ code: "notFound" });
  await pool.query("UPDATE drafts SET title = ?, data = ? WHERE id = ?", [d.title, d.json, row.id]);
  res.json({ code: "saved" });
}));

/* DELETE /api/drafts/:id — also called automatically when the real form is submitted */
router.delete("/:id", ah(async (req, res) => {
  const row = await ensureOwned(pool, "drafts", id(req.params.id), req.business.id);
  if (row.user_id !== req.user.id) return res.status(404).json({ code: "notFound" });
  await pool.query("DELETE FROM drafts WHERE id = ?", [row.id]);
  res.json({ code: "deleted" });
}));

export default router;
