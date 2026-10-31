/*
 * Serial number / IMEI tracking (electronics). A product's `tracking` is
 *   qty          ordinary quantities (chargers, cables…)
 *   serial       each unit has a serial number (laptops, printers)
 *   imei         each unit has an IMEI (phones), a second IMEI for dual-SIM is optional
 *   serial_imei  both
 * Every tracked unit is a row in `devices` with its status and location; `device_events` keeps its history.
 * Stock quantities still go through moveStock (one ledger); the callers below keep the devices in step and
 * moveStock refuses tracked products unless the caller says it handled the devices (devices: true).
 */
import { HttpError, badRequest, conflict } from "./http.js";
import { productName } from "./productName.js";

export const TRACKING = ["qty", "serial", "imei", "serial_imei", "roll"];   // roll: fabric rolls (lib/rolls.js)
export const isTracked = (product) => ["serial", "imei", "serial_imei"].includes(product?.tracking);   // serial / IMEI devices (rolls: lib/rolls.js)
const needsSerial = (p) => p.tracking === "serial" || p.tracking === "serial_imei";
const needsImei = (p) => p.tracking === "imei" || p.tracking === "serial_imei";
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : v === undefined || v === null ? "" : String(v).trim().slice(0, max));

/**
 * Devices coming in (receiving, opening stock, add stock): [{ serial, imei1, imei2 }] — one per unit.
 * Checks the count, the required numbers, IMEI format (15 digits) and duplicates in the list. field = error key prefix.
 */
export function readNewDevices(product, list, qty, field) {
  const devices = (Array.isArray(list) ? list : []).map((d) => ({ serial: clean(d?.serial, 80), imei1: clean(d?.imei1, 20), imei2: clean(d?.imei2, 20) }))
    .filter((d) => d.serial || d.imei1 || d.imei2);
  if (!Number.isInteger(qty) || devices.length !== qty) {
    throw new HttpError(400, "validation", { [field]: "devicesCount" }, { product: productName(product), expected: qty, given: devices.length });
  }
  const seen = new Set();
  devices.forEach((d, i) => {
    if (needsSerial(product) && !d.serial) throw badRequest({ [`${field}.${i}.serial`]: "required" });
    if (needsImei(product) && !d.imei1) throw badRequest({ [`${field}.${i}.imei1`]: "required" });
    for (const k of ["imei1", "imei2"]) if (d[k] && !/^\d{15}$/.test(d[k])) throw badRequest({ [`${field}.${i}.${k}`]: "invalidImei" });
    for (const key of [d.serial && `s:${d.serial.toLowerCase()}`, d.imei1 && `i:${d.imei1}`, d.imei2 && `i:${d.imei2}`].filter(Boolean)) {
      if (seen.has(key)) throw new HttpError(400, "validation", { [`${field}.${i}`]: "duplicateDevice" }, { device: key.slice(2) });
      seen.add(key);
    }
  });
  return devices;
}

/** No other device of the business may already use these IMEIs, nor these serials for the same product. */
async function assertUnique(conn, businessId, product, devices) {
  for (const d of devices) {
    const imeis = [d.imei1, d.imei2].filter(Boolean);
    if (imeis.length) {
      const [[x]] = await conn.query(
        "SELECT id FROM devices WHERE business_id = ? AND (imei1 IN (?) OR imei2 IN (?)) AND status <> 'removed' LIMIT 1", [businessId, imeis, imeis]);
      if (x) throw conflict("imeiExists", { device: imeis.join(" / ") });
    }
    if (d.serial) {
      const [[x]] = await conn.query("SELECT id FROM devices WHERE business_id = ? AND product_id = ? AND serial_no = ? AND status <> 'removed' LIMIT 1",
        [businessId, product.id, d.serial]);
      if (x) throw conflict("serialExists", { device: d.serial });
    }
  }
}

export async function deviceEvent(conn, deviceId, { event, refType = null, refId = null, locationId = null, note = null, userId = null }) {
  await conn.query("INSERT INTO device_events (device_id, event, ref_type, ref_id, location_id, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [deviceId, event, refType, refId, locationId, note, userId]);
}

/** New devices into stock at a location (event: received | opening | stock_in | found). */
export async function addDevices(conn, { businessId, product, locationId, devices, purchaseId = null, supplierId = null, cost = null, userId, event, refType, refId }) {
  await assertUnique(conn, businessId, product, devices);
  const ids = [];
  for (const d of devices) {
    const [r] = await conn.query(
      `INSERT INTO devices (business_id, product_id, serial_no, imei1, imei2, location_id, status, purchase_id, supplier_id, cost)
       VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
      [businessId, product.id, d.serial || null, d.imei1 || null, d.imei2 || null, locationId, purchaseId, supplierId, cost]);
    await deviceEvent(conn, r.insertId, { event, refType, refId, locationId, userId });
    ids.push(r.insertId);
  }
  return ids;
}

/**
 * The exact devices leaving a location (sale, invoice, transfer, adjustment, supplier return): they must be this
 * product's, available, at that location, and as many as the quantity. Locks them. field = error key.
 */
export async function pickDevices(conn, { businessId, product, locationId, deviceIds, qty, field, statuses = ["available"] }) {
  const ids = [...new Set((Array.isArray(deviceIds) ? deviceIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!Number.isInteger(qty) || ids.length !== qty) {
    throw new HttpError(400, "validation", { [field]: "devicesCount" }, { product: productName(product), expected: qty, given: ids.length });
  }
  const [rows] = await conn.query("SELECT * FROM devices WHERE business_id = ? AND id IN (?) FOR UPDATE", [businessId, ids]);
  for (const id of ids) {
    const d = rows.find((r) => r.id === id);
    if (!d || d.product_id !== product.id) throw badRequest({ [field]: "deviceNotFound" });
    if (!statuses.includes(d.status)) throw conflict(d.status === "sold" ? "deviceSold" : "deviceUnavailable", { device: d.serial_no || d.imei1 });
    if (locationId && d.location_id !== locationId) throw conflict("deviceElsewhere", { device: d.serial_no || d.imei1 });
  }
  return rows;
}

/** Sets status / location of devices and records the event. */
export async function updateDevices(conn, devices, { status, locationId, event, refType = null, refId = null, note = null, userId = null, sale = null }) {
  for (const d of devices) {
    if (sale) {
      await conn.query("UPDATE devices SET status = ?, location_id = NULL, sold_ref_type = ?, sold_ref_id = ?, sold_item_id = ?, customer_id = ?, sold_at = UTC_TIMESTAMP() WHERE id = ?",
        [status, sale.refType, sale.refId, sale.itemId, sale.customerId || null, d.id]);
    } else if (status === "available") {
      await conn.query("UPDATE devices SET status = 'available', location_id = ?, sold_ref_type = NULL, sold_ref_id = NULL, sold_item_id = NULL, customer_id = NULL, sold_at = NULL WHERE id = ?",
        [locationId ?? d.location_id, d.id]);
    } else {
      await conn.query("UPDATE devices SET status = ?, location_id = ? WHERE id = ?", [status, locationId === undefined ? d.location_id : locationId, d.id]);
    }
    await deviceEvent(conn, d.id, { event, refType, refId, locationId: locationId ?? d.location_id, note, userId });
  }
}

/** Devices sold on a sale / invoice (for cancellations). */
export async function devicesSoldOn(conn, businessId, refType, refId) {
  const [rows] = await conn.query("SELECT * FROM devices WHERE business_id = ? AND sold_ref_type = ? AND sold_ref_id = ? FOR UPDATE", [businessId, refType, refId]);
  return rows;
}

export const deviceLabel = (d) => [d.serial_no && `S/N ${d.serial_no}`, d.imei1 && `IMEI ${d.imei1}`, d.imei2 && `IMEI2 ${d.imei2}`].filter(Boolean).join(" · ");
export const shapeDevice = (d) => ({
  id: d.id, productId: d.product_id, product: d.product_name, serial: d.serial_no || "", imei1: d.imei1 || "", imei2: d.imei2 || "",
  status: d.status, locationId: d.location_id, location: d.location_name || null, cost: d.cost === null ? null : Number(d.cost),
  purchaseId: d.purchase_id, purchaseNo: d.purchase_no || null, supplier: d.supplier_name || null,
  soldRefType: d.sold_ref_type, soldRefId: d.sold_ref_id, soldRefNo: d.sold_ref_no || null, customer: d.customer_name || null, soldAt: d.sold_at,
  createdAt: d.created_at
});

/* ---------- selling (POS / invoices) ---------- */
/** The devices of a tracked sale line: whole units only, the exact devices chosen, marked sold and linked to the line. */
export async function sellDevices(conn, { businessId, userId, product, line, index, locationId, refType, refId, itemId, customerId }) {
  if (!isTracked(product)) return [];
  const devices = await pickDevices(conn, { businessId, product, locationId, deviceIds: line.deviceIds, qty: line.qty, field: `items.${index}.deviceIds` });
  await updateDevices(conn, devices, { status: "sold", event: "sold", refType, refId, userId, sale: { refType, refId, itemId, customerId } });
  return devices;
}

/** Cancelled sale / invoice: its devices come back to stock at the location the stock returns to. */
export async function returnSoldDevices(conn, { businessId, userId, refType, refId, locationId, note }) {
  const devices = await devicesSoldOn(conn, businessId, refType, refId);
  await updateDevices(conn, devices, { status: "available", locationId, event: "returned", refType, refId, note, userId });
  return devices;
}
