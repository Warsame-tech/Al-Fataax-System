import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, money, withTx, ensureOwned, badRequest, conflict, num, round2, METHODS } from "../lib/http.js";
import { moneyMove } from "../lib/ledger.js";

/*
 * Table reservations (food businesses): date and time, guests, table, customer contact, deposit, status
 * booked → seated → completed, or cancelled / no-show. A table can't be booked twice for overlapping times, nor for more
 * guests than its seats. A deposit is money in (cash / mobile money / bank); cancelling may refund it, a no-show keeps it.
 * No-shows are counted per customer phone so staff see them when booking again.
 */
const router = Router();
router.use(requireAuth);
router.use((req, res, next) => (req.business.profile.food ? next() : res.status(404).json({ code: "notFound" })));

const STATUSES = ["booked", "seated", "completed", "cancelled", "no_show"];
const SELECT = `SELECT r.*, t.name table_name, t.capacity, c.name cust_name, c.phone cust_phone, u.full_name user_name FROM reservations r
  LEFT JOIN food_tables t ON t.id = r.table_id LEFT JOIN customers c ON c.id = r.customer_id AND c.business_id = r.business_id LEFT JOIN users u ON u.id = r.user_id`;
const shape = (r) => ({
  id: r.id, tableId: r.table_id, table: r.table_name || null, capacity: r.capacity ?? null, customerId: r.customer_id, name: r.customer_name || r.cust_name || "",
  phone: r.customer_phone || r.cust_phone || "", guests: r.guests, at: r.reserved_for, durationMin: r.duration_min, status: r.status, notes: r.notes || "",
  deposit: num(r.deposit), depositMethod: r.deposit_method, refunded: num(r.refunded), cancelReason: r.cancel_reason || "", seatedAt: r.seated_at, user: r.user_name, createdAt: r.created_at
});

/* another booking on that table overlapping [at, at + duration) */
async function clash(db, businessId, tableId, at, minutes, exceptId = 0) {
  if (!tableId) return null;
  const [[x]] = await db.query(
    `SELECT id, reserved_for FROM reservations WHERE business_id = ? AND table_id = ? AND id <> ? AND status IN ('booked', 'seated')
        AND reserved_for < DATE_ADD(?, INTERVAL ? MINUTE) AND DATE_ADD(reserved_for, INTERVAL duration_min MINUTE) > ? LIMIT 1`,
    [businessId, tableId, exceptId, at, minutes, at]);
  return x || null;
}

function readBooking(b, current = {}) {
  const at = typeof b.at === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(b.at) ? b.at.replace("T", " ").slice(0, 16) : current.at;
  const d = { tableId: b.tableId === undefined ? current.tableId ?? null : id(b.tableId), customerId: b.customerId === undefined ? current.customerId ?? null : id(b.customerId),
    name: b.name === undefined ? current.name ?? null : optText(b.name, 150), phone: b.phone === undefined ? current.phone ?? null : optText(b.phone, 30),
    guests: b.guests === undefined ? current.guests : Number(b.guests), at, durationMin: b.durationMin === undefined ? current.durationMin ?? 90 : Number(b.durationMin),
    notes: b.notes === undefined ? current.notes ?? null : optText(b.notes, 255) };
  const e = {};
  if (!d.at) e.at = "required";
  if (!Number.isInteger(d.guests) || d.guests < 1 || d.guests > 500) e.guests = "invalidAmount";
  if (!Number.isInteger(d.durationMin) || d.durationMin < 15 || d.durationMin > 720) e.durationMin = "invalidAmount";
  if (!d.customerId && !d.name) e.name = "required";
  if (!d.customerId && !d.phone) e.phone = "required";
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}
async function checkTable(conn, req, d, exceptId = 0) {
  if (!d.tableId) return;
  const tb = await ensureOwned(conn, "food_tables", d.tableId, req.business.id);
  if (d.guests > tb.capacity) throw conflict("tooManyGuests", { seats: tb.capacity });
  const x = await clash(conn, req.business.id, d.tableId, d.at, d.durationMin, exceptId);
  if (x) throw conflict("tableBooked", { at: x.reserved_for });
}

/** GET /api/reservations?from=&to=&status=&q= (default today on) + no-shows per phone for the people listed */
router.get("/", requirePerm("sales.create"), ah(async (req, res) => {
  const bid = req.business.id;
  const where = ["r.business_id = ?"];
  const params = [bid];
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : new Date().toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : from;
  where.push("r.reserved_for BETWEEN ? AND ?"); params.push(`${from} 00:00:00`, `${to} 23:59:59`);
  if (STATUSES.includes(req.query.status)) { where.push("r.status = ?"); params.push(req.query.status); }
  const q = text(req.query.q, 60);
  if (q) { where.push("(r.customer_name LIKE ? OR r.customer_phone LIKE ? OR c.name LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const [rows] = await pool.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY r.reserved_for, r.id`, params);
  const phones = [...new Set(rows.map((r) => r.customer_phone || r.cust_phone).filter(Boolean))];
  const [ns] = phones.length ? await pool.query("SELECT customer_phone phone, COUNT(*) n FROM reservations WHERE business_id = ? AND status = 'no_show' AND customer_phone IN (?) GROUP BY customer_phone", [bid, phones]) : [[]];
  const noShows = new Map(ns.map((x) => [x.phone, Number(x.n)]));
  const [[sum]] = await pool.query(
    `SELECT COUNT(*) n, SUM(status = 'no_show') no_shows, SUM(status = 'cancelled') cancelled, SUM(status IN ('seated', 'completed')) came, COALESCE(SUM(guests), 0) guests
       FROM reservations WHERE business_id = ? AND reserved_for BETWEEN ? AND ?`, [bid, `${from} 00:00:00`, `${to} 23:59:59`]);
  res.json({ from, to, reservations: rows.map((r) => ({ ...shape(r), noShows: noShows.get(r.customer_phone || r.cust_phone) || 0 })),
    summary: { count: Number(sum.n), noShows: Number(sum.no_shows || 0), cancelled: Number(sum.cancelled || 0), came: Number(sum.came || 0), guests: Number(sum.guests) } });
}));

/** POST /api/reservations { tableId?, customerId? | name + phone, guests, at, durationMin?, notes?, deposit?, method?, bankAccountId? } */
router.post("/", requirePerm("sales.create"), ah(async (req, res) => {
  const b = req.body || {};
  const d = readBooking(b);
  const deposit = b.deposit ? money(b.deposit) : 0;
  if (Number.isNaN(deposit) || deposit < 0) throw badRequest({ deposit: "invalidAmount" });
  if (deposit > 0 && !METHODS.includes(b.method)) throw badRequest({ method: "required" });
  const r = await withTx(async (conn) => {
    if (d.customerId) await ensureOwned(conn, "customers", d.customerId, req.business.id);
    await checkTable(conn, req, d);
    const [x] = await conn.query(
      `INSERT INTO reservations (business_id, table_id, customer_id, customer_name, customer_phone, guests, reserved_for, duration_min, notes, deposit, deposit_method, status, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?)`,
      [req.business.id, d.tableId, d.customerId, d.name, d.phone, d.guests, d.at, d.durationMin, d.notes, deposit, deposit > 0 ? b.method : null, req.user.id]);
    if (deposit > 0) await moneyMove(conn, { businessId: req.business.id, userId: req.user.id, direction: "in", method: b.method, bankAccountId: id(b.bankAccountId), amount: deposit, refType: "reservation", refId: x.insertId, description: `Reservation deposit · ${d.name || ""}`.trim() });
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "reservation.booked", entity: "reservation", entityId: x.insertId, meta: { at: d.at, guests: d.guests, table: d.tableId, deposit }, ip: req.ip });
    return { id: x.insertId };
  });
  res.status(201).json(r);
}));

/** PUT /api/reservations/:id — change time, table, guests, contact or notes while booked */
router.put("/:id", requirePerm("sales.create"), ah(async (req, res) => {
  await withTx(async (conn) => {
    const r = await ensureOwned(conn, "reservations", id(req.params.id), req.business.id, true);
    if (r.status !== "booked") throw conflict("reservationClosed");
    const d = readBooking(req.body || {}, { tableId: r.table_id, customerId: r.customer_id, name: r.customer_name, phone: r.customer_phone, guests: r.guests,
      at: String(r.reserved_for instanceof Date ? r.reserved_for.toISOString().replace("T", " ") : r.reserved_for).slice(0, 16), durationMin: r.duration_min, notes: r.notes });
    await checkTable(conn, req, d, r.id);
    await conn.query("UPDATE reservations SET table_id = ?, customer_id = ?, customer_name = ?, customer_phone = ?, guests = ?, reserved_for = ?, duration_min = ?, notes = ? WHERE id = ?",
      [d.tableId, d.customerId, d.name, d.phone, d.guests, d.at, d.durationMin, d.notes, r.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "reservation.changed", entity: "reservation", entityId: r.id, meta: d, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/** POST /api/reservations/:id/status { status: seated | completed | no_show | cancelled, reason?, refund?, method?, bankAccountId? } */
router.post("/:id/status", requirePerm("sales.create"), ah(async (req, res) => {
  const b = req.body || {};
  const status = b.status;
  if (!["seated", "completed", "no_show", "cancelled"].includes(status)) throw badRequest({ status: "required" });
  await withTx(async (conn) => {
    const r = await ensureOwned(conn, "reservations", id(req.params.id), req.business.id, true);
    const from = { seated: ["booked"], completed: ["seated", "booked"], no_show: ["booked"], cancelled: ["booked"] }[status];
    if (!from.includes(r.status)) throw conflict("reservationClosed");
    let refund = 0;
    if (status === "cancelled") {
      if (!text(b.reason, 200)) throw badRequest({ reason: "required" });
      refund = b.refund ? money(b.refund) : 0;
      if (Number.isNaN(refund) || refund < 0 || refund > num(r.deposit)) throw badRequest({ refund: "moreThanPaid" });
      if (refund > 0) {
        if (!METHODS.includes(b.method)) throw badRequest({ method: "required" });
        await moneyMove(conn, { businessId: req.business.id, userId: req.user.id, direction: "out", method: b.method, bankAccountId: id(b.bankAccountId), amount: refund, refType: "refund", refId: r.id, description: "Reservation deposit refund" });
      }
    }
    await conn.query(`UPDATE reservations SET status = ?, refunded = refunded + ?, cancel_reason = COALESCE(?, cancel_reason)${status === "seated" ? ", seated_at = UTC_TIMESTAMP()" : ""} WHERE id = ?`,
      [status, round2(refund), status === "cancelled" ? text(b.reason, 200) : null, r.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: `reservation.${status}`, entity: "reservation", entityId: r.id, meta: { refund, reason: text(b.reason, 200) || null }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

export default router;
