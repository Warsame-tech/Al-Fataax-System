import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { ah, id, text, num } from "../lib/http.js";

/*
 * A business talking to Faatix (the super admin answers in Support → Tickets):
 *   GET  /api/support/tickets              the business's tickets
 *   POST /api/support/tickets              { subject, body, priority? } open one
 *   GET  /api/support/tickets/:id          the conversation
 *   POST /api/support/tickets/:id/reply    { body }
 *   POST /api/support/tickets/:id/close
 *   GET  /api/support/announcements        notices from Faatix running now (for everyone, or this business type)
 * Every user of the business can use support; the tickets are the business's, not one user's.
 */
const router = Router();
router.use(requireAuth);

const own = async (req) => {
  const [[t]] = await pool.query("SELECT * FROM support_tickets WHERE id = ? AND business_id = ?", [id(req.params.id) || 0, req.business.id]);
  return t || null;
};

router.get("/tickets", ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.*, u.full_name user_name, (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) replies FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.business_id = ? ORDER BY t.status = 'closed', t.updated_at DESC LIMIT 200`, [req.business.id]);
  res.json({ tickets: rows.map((t) => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority, lastReplyBy: t.last_reply_by, replies: num(t.replies), user: t.user_name,
    createdAt: t.created_at, updatedAt: t.updated_at })) });
}));

router.post("/tickets", ah(async (req, res) => {
  const subject = text(req.body?.subject, 160);
  const body = text(req.body?.body, 5000);
  const e = {};
  if (!subject) e.subject = "required";
  if (!body) e.body = "required";
  if (Object.keys(e).length) return res.status(400).json({ code: "validation", errors: e });
  const priority = ["low", "normal", "high"].includes(req.body?.priority) ? req.body.priority : "normal";
  const [r] = await pool.query("INSERT INTO support_tickets (business_id, user_id, subject, priority) VALUES (?, ?, ?, ?)", [req.business.id, req.user.id, subject, priority]);
  await pool.query("INSERT INTO support_messages (ticket_id, business_id, author, user_id, body) VALUES (?, ?, 'business', ?, ?)", [r.insertId, req.business.id, req.user.id, body]);
  res.status(201).json({ id: r.insertId });
}));

router.get("/tickets/:id", ah(async (req, res) => {
  const t = await own(req);
  if (!t) return res.status(404).json({ code: "notFound" });
  const [msgs] = await pool.query(
    "SELECT m.id, m.author, m.body, m.created_at, u.full_name user_name FROM support_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? ORDER BY m.id", [t.id]);
  res.json({ ticket: { id: t.id, subject: t.subject, status: t.status, priority: t.priority, createdAt: t.created_at },
    messages: msgs.map((m) => ({ id: m.id, author: m.author, name: m.author === "admin" ? "Faatix" : m.user_name, body: m.body, at: m.created_at })) });
}));

router.post("/tickets/:id/reply", ah(async (req, res) => {
  const t = await own(req);
  if (!t) return res.status(404).json({ code: "notFound" });
  const body = text(req.body?.body, 5000);
  if (!body) return res.status(400).json({ code: "validation", errors: { body: "required" } });
  await pool.query("INSERT INTO support_messages (ticket_id, business_id, author, user_id, body) VALUES (?, ?, 'business', ?, ?)", [t.id, req.business.id, req.user.id, body]);
  await pool.query("UPDATE support_tickets SET status = 'open', last_reply_by = 'business', updated_at = UTC_TIMESTAMP() WHERE id = ?", [t.id]);   // a reply reopens it
  res.status(201).json({ code: "saved" });
}));

router.post("/tickets/:id/close", ah(async (req, res) => {
  const t = await own(req);
  if (!t) return res.status(404).json({ code: "notFound" });
  await pool.query("UPDATE support_tickets SET status = 'closed', updated_at = UTC_TIMESTAMP() WHERE id = ?", [t.id]);
  res.json({ code: "saved" });
}));

router.get("/announcements", ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, title, body, level, starts_at FROM announcements
      WHERE is_active = 1 AND starts_at <= UTC_TIMESTAMP() AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP()) AND (audience = 'all' OR business_type = ?)
      ORDER BY starts_at DESC LIMIT 5`, [req.business.type]);
  res.json({ announcements: rows.map((a) => ({ id: a.id, title: a.title, body: a.body, level: a.level, at: a.starts_at })) });
}));

export default router;
