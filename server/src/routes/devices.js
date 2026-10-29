import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePerm } from "../lib/permissions.js";
import { ah, id, text, ensureOwned } from "../lib/http.js";
import { defaultLocationId } from "../lib/stock.js";
import { shapeDevice } from "../lib/devices.js";
import { productNameSql } from "../lib/productName.js";

/*
 * Serial number / IMEI devices (electronics): search, the devices of a product at a location (POS / invoice /
 * transfer pickers), scanner lookup and each device's history. Devices only change through stock operations.
 */
const router = Router();
router.use(requireAuth);

const SELECT = `SELECT d.*, ${productNameSql("p")} product_name, l.name location_name, pu.purchase_no, s.name supplier_name, c.name customer_name,
    CASE d.sold_ref_type WHEN 'sale' THEN (SELECT receipt_no FROM sales WHERE id = d.sold_ref_id) WHEN 'invoice' THEN (SELECT invoice_no FROM invoices WHERE id = d.sold_ref_id) END sold_ref_no
  FROM devices d JOIN products p ON p.id = d.product_id AND p.business_id = d.business_id
  LEFT JOIN stock_locations l ON l.id = d.location_id
  LEFT JOIN purchases pu ON pu.id = d.purchase_id AND pu.business_id = d.business_id
  LEFT JOIN suppliers s ON s.id = d.supplier_id AND s.business_id = d.business_id
  LEFT JOIN customers c ON c.id = d.customer_id AND c.business_id = d.business_id`;

/* GET /api/devices?q=&productId=&status=&locationId=|location=default — newest first, up to 300 */
router.get("/", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  const where = ["d.business_id = ?"];
  const params = [bid];
  const q = text(req.query.q, 80);
  if (q) { where.push(`(d.serial_no LIKE ? OR d.imei1 LIKE ? OR d.imei2 LIKE ? OR ${productNameSql("p")} LIKE ?)`); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (id(req.query.productId)) { where.push("d.product_id = ?"); params.push(id(req.query.productId)); }
  if (typeof req.query.status === "string" && req.query.status) { where.push("d.status = ?"); params.push(text(req.query.status, 20)); }
  const loc = req.query.location === "default" ? await defaultLocationId(pool, bid) : id(req.query.locationId);
  if (loc) { where.push("d.location_id = ?"); params.push(loc); }
  const [rows] = await pool.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY d.id DESC LIMIT 300`, params);
  res.json({ devices: rows.map(shapeDevice) });
}));

/* GET /api/devices/lookup/:code — a serial number or IMEI scanned at the POS (available devices first) */
router.get("/lookup/:code", requirePerm("products.view"), ah(async (req, res) => {
  const code = text(req.params.code, 80);
  const [[d]] = await pool.query(`${SELECT} WHERE d.business_id = ? AND (d.serial_no = ? OR d.imei1 = ? OR d.imei2 = ?)
    ORDER BY d.status = 'available' DESC, d.id DESC LIMIT 1`, [req.business.id, code, code, code]);
  if (!d) return res.status(404).json({ code: "notFound" });
  res.json({ device: shapeDevice(d) });
}));

/* GET /api/devices/:id — the device and its history (received, transferred, sold, returned, warranty…) */
router.get("/:id", requirePerm("products.view"), ah(async (req, res) => {
  const bid = req.business.id;
  await ensureOwned(pool, "devices", id(req.params.id), bid);
  const [[d]] = await pool.query(`${SELECT} WHERE d.id = ? AND d.business_id = ?`, [id(req.params.id), bid]);
  const [events] = await pool.query(
    `SELECT e.*, l.name location_name, u.full_name user_name FROM device_events e LEFT JOIN stock_locations l ON l.id = e.location_id
       LEFT JOIN users u ON u.id = e.user_id WHERE e.device_id = ? ORDER BY e.id DESC`, [d.id]);
  const [warranties] = await pool.query("SELECT id, months, start_date, end_date, status FROM warranties WHERE business_id = ? AND device_id = ? ORDER BY id DESC", [bid, d.id]);
  res.json({
    device: shapeDevice(d),
    events: events.map((e) => ({ event: e.event, refType: e.ref_type, refId: e.ref_id, location: e.location_name, note: e.note, user: e.user_name, at: e.created_at })),
    warranties: warranties.map((w) => ({ id: w.id, months: w.months, startDate: w.start_date, endDate: w.end_date, status: w.status }))
  });
}));

export default router;
