import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, withTx, ensureOwned, badRequest, isDate } from "../lib/http.js";
import { WARRANTY_STATUSES } from "../lib/warranties.js";
import { deviceEvent } from "../lib/devices.js";
import { productNameSql } from "../lib/productName.js";

/*
 * Warranty management (electronics): warranties are created by sales / invoices (lib/warranties.js);
 * here they are searched, viewed with their history, and updated (status, provider, dates, terms, notes).
 */
const router = Router();
router.use(requireAuth);

const SELECT = `SELECT w.*, ${productNameSql("p")} product_name, d.serial_no, d.imei1, d.imei2, c.name customer_name, c.phone customer_phone,
    CASE w.ref_type WHEN 'sale' THEN (SELECT receipt_no FROM sales WHERE id = w.ref_id) ELSE (SELECT invoice_no FROM invoices WHERE id = w.ref_id) END ref_no
  FROM warranties w JOIN products p ON p.id = w.product_id AND p.business_id = w.business_id
  LEFT JOIN devices d ON d.id = w.device_id
  LEFT JOIN customers c ON c.id = w.customer_id AND c.business_id = w.business_id`;

/* "expired" is shown for an active warranty past its end date */
const shape = (w) => ({
  id: w.id, productId: w.product_id, product: w.product_name, deviceId: w.device_id, serial: w.serial_no || "", imei1: w.imei1 || "", imei2: w.imei2 || "",
  customer: w.customer_name || null, customerPhone: w.customer_phone || null, refType: w.ref_type, refId: w.ref_id, refNo: w.ref_no, qty: Number(w.qty),
  provider: w.provider || "", months: w.months, startDate: w.start_date, endDate: w.end_date, terms: w.terms || "",
  status: w.status === "active" && w.end_date < new Date().toISOString().slice(0, 10) ? "expired" : w.status, savedStatus: w.status
});

/* GET /api/warranties?q=&status= — search by customer, receipt / invoice no., product, serial number or IMEI */
router.get("/", requirePerm("sales.view"), ah(async (req, res) => {
  const where = ["w.business_id = ?"];
  const params = [req.business.id];
  const q = text(req.query.q, 80);
  if (q) {
    where.push(`(c.name LIKE ? OR c.phone LIKE ? OR ${productNameSql("p")} LIKE ? OR d.serial_no LIKE ? OR d.imei1 LIKE ? OR d.imei2 LIKE ?
      OR (w.ref_type = 'sale' AND w.ref_id IN (SELECT id FROM sales WHERE business_id = w.business_id AND receipt_no LIKE ?))
      OR (w.ref_type = 'invoice' AND w.ref_id IN (SELECT id FROM invoices WHERE business_id = w.business_id AND invoice_no LIKE ?)))`);
    params.push(...Array(8).fill(`%${q}%`));
  }
  const st = text(req.query.status, 20);
  if (st === "expired") where.push("w.status = 'active' AND w.end_date < UTC_DATE()");
  else if (st === "active") where.push("w.status = 'active' AND w.end_date >= UTC_DATE()");
  else if (WARRANTY_STATUSES.includes(st)) { where.push("w.status = ?"); params.push(st); }
  const [rows] = await pool.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY w.id DESC LIMIT 300`, params);
  res.json({ warranties: rows.map(shape) });
}));

router.get("/:id", requirePerm("sales.view"), ah(async (req, res) => {
  const bid = req.business.id;
  await ensureOwned(pool, "warranties", id(req.params.id), bid);
  const [[w]] = await pool.query(`${SELECT} WHERE w.id = ? AND w.business_id = ?`, [id(req.params.id), bid]);
  const [events] = await pool.query(
    "SELECT e.changes, e.note, e.created_at, u.full_name user_name FROM warranty_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.warranty_id = ? ORDER BY e.id DESC", [w.id]);
  res.json({ warranty: shape(w), history: events.map((e) => ({ changes: e.changes ? JSON.parse(e.changes) : [], note: e.note, user: e.user_name, at: e.created_at })) });
}));

/*
 * PUT /api/warranties/:id { status?, provider?, months?, startDate?, terms?, note? } — authorized update; the end date
 * follows start + months. Every change is kept in the warranty's history (and the device's history).
 */
router.put("/:id", requirePerm("sales.create"), ah(async (req, res) => {
  const b = req.body || {};
  const bid = req.business.id;
  await withTx(async (conn) => {
    const w = await ensureOwned(conn, "warranties", id(req.params.id), bid, true);
    const next = {
      status: b.status === undefined ? w.status : b.status,
      provider: b.provider === undefined ? w.provider : optText(b.provider, 100),
      months: b.months === undefined || b.months === "" ? w.months : Number(b.months),
      start_date: b.startDate === undefined ? w.start_date : b.startDate,
      terms: b.terms === undefined ? w.terms : optText(b.terms, 255)
    };
    const e = {};
    if (!WARRANTY_STATUSES.includes(next.status)) e.status = "required";
    if (!Number.isInteger(next.months) || next.months < 1 || next.months > 240) e.months = "invalidAmount";
    if (!isDate(next.start_date)) e.startDate = "required";
    if (Object.keys(e).length) throw badRequest(e);
    const changes = ["status", "provider", "months", "start_date", "terms"].filter((k) => String(w[k] ?? "") !== String(next[k] ?? ""))
      .map((k) => ({ field: k === "start_date" ? "startDate" : k, from: w[k], to: next[k] }));
    const note = optText(b.note, 255);
    if (!changes.length && !note) return;
    await conn.query("UPDATE warranties SET status = ?, provider = ?, months = ?, start_date = ?, end_date = DATE_ADD(?, INTERVAL ? MONTH), terms = ? WHERE id = ?",
      [next.status, next.provider, next.months, next.start_date, next.start_date, next.months, next.terms, w.id]);
    await conn.query("INSERT INTO warranty_events (warranty_id, changes, note, user_id) VALUES (?, ?, ?, ?)",
      [w.id, changes.length ? JSON.stringify(changes) : null, note, req.user.id]);
    if (w.device_id) await deviceEvent(conn, w.device_id, { event: "warranty", refType: "warranty", refId: w.id, note: [changes.map((c) => `${c.field}: ${c.to}`).join(", "), note].filter(Boolean).join(" · ") || null, userId: req.user.id });
    await audit(conn, { businessId: bid, userId: req.user.id, action: "warranty.updated", entity: "warranty", entityId: w.id, meta: { changes }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
