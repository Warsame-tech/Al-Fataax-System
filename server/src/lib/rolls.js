/*
 * Fabric rolls. A product sold from rolls has tracking = "roll" and its stock in meters (base unit).
 * Each roll keeps the supplier-declared length, the verified length on receipt and the remaining length;
 * roll_events keeps every change (received, sold, returned, inspected, measured, waste, damaged, transferred…).
 * The product's stock at a location = remaining meters of its rolls there that are available or pending inspection.
 *
 * Lengths: 1 yd = 0.9144 m exactly. Conversions use whole units of 1/10,000 m (BigInt) so nothing drifts.
 * moveStock refuses roll products unless the caller moved the rolls too (devices: true — "items handled").
 */
import { HttpError, badRequest, conflict } from "./http.js";
import { units, toNumber } from "./jewelry.js";
import { productName } from "./productName.js";

export const isRoll = (p) => p?.tracking === "roll";
export const YARD = "0.9144";
const SCALE = 10000n;
/** a length in meter / yard → meters (exact to 0.1 mm) */
export function toMeters(value, unit) {
  const v = units(value);
  if (unit !== "yard") return toNumber(v);
  const p = v * units(YARD);
  return toNumber((p + SCALE / 2n) / SCALE);
}
/** meters → yards (for display), 4 decimals */
export const toYards = (m) => toNumber((units(m) * SCALE + units(YARD) / 2n) / units(YARD));
const q4 = (v) => Math.round(Number(v) * 10000) / 10000;

async function event(conn, rollId, e) {
  await conn.query(
    `INSERT INTO roll_events (roll_id, event, length_change, remaining_after, ref_type, ref_id, item_id, location_id, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [rollId, e.event, e.change || 0, e.remaining, e.refType || null, e.refId || null, e.itemId || null, e.locationId || null, e.note || null, e.userId || null]);
}

/**
 * Rolls coming in: [{ code?, declared?, verified }] in unit (meter | yard) → meters.
 * verified is required (what really came in); declared defaults to verified. field = error key prefix.
 */
export function readNewRolls(product, list, unit, field) {
  const rolls = (Array.isArray(list) ? list : []).map((r) => ({
    code: typeof r?.code === "string" ? r.code.trim().slice(0, 40) : "",
    declared: r?.declared === "" || r?.declared == null ? null : Number(r.declared),
    verified: r?.verified === "" || r?.verified == null ? null : Number(r.verified)
  })).filter((r) => r.code || r.declared !== null || r.verified !== null);
  if (!rolls.length) throw new HttpError(400, "validation", { [field]: "rollsRequired" }, { product: productName(product) });
  const seen = new Set();
  rolls.forEach((r, i) => {
    if (r.verified === null || !Number.isFinite(r.verified) || r.verified <= 0) throw badRequest({ [`${field}.${i}.verified`]: "invalidAmount" });
    if (r.declared !== null && (!Number.isFinite(r.declared) || r.declared <= 0)) throw badRequest({ [`${field}.${i}.declared`]: "invalidAmount" });
    if (r.code) { if (seen.has(r.code.toLowerCase())) throw badRequest({ [`${field}.${i}.code`]: "duplicateRoll" }); seen.add(r.code.toLowerCase()); }
  });
  const out = rolls.map((r) => ({ code: r.code, declared: toMeters(r.declared ?? r.verified, unit), verified: toMeters(r.verified, unit) }));
  // the declared length as typed (meters or yards): what a supplier bills
  out.typed = toNumber(rolls.reduce((s, r) => s + units(r.declared ?? r.verified), 0n));
  return out;
}
export const sumMeters = (rolls, key) => toNumber(rolls.reduce((s, r) => s + units(r[key]), 0n));

/** New rolls into stock at a location (the caller moves the stock: + verified meters). Codes: given or R-000001. */
export async function addRolls(conn, { businessId, product, locationId, rolls, purchaseId = null, supplierId = null, costPerMeter = null, userId, source, refType, refId }) {
  const ids = [];
  for (const r of rolls) {
    let code = r.code;
    if (code) {
      const [[dup]] = await conn.query("SELECT id FROM fabric_rolls WHERE business_id = ? AND roll_code = ?", [businessId, code]);
      if (dup) throw conflict("rollCodeExists", { roll: code });
    } else {
      const [[n]] = await conn.query("SELECT COUNT(*) n FROM fabric_rolls WHERE business_id = ?", [businessId]);
      code = `R-${String(Number(n.n) + 1).padStart(6, "0")}`;
    }
    const [x] = await conn.query(
      `INSERT INTO fabric_rolls (business_id, product_id, roll_code, supplier_id, purchase_id, declared_length, verified_length, remaining, cost_per_meter, location_id, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)`,
      [businessId, product.id, code, supplierId, purchaseId, r.declared, r.verified, r.verified, costPerMeter, locationId, source]);
    await event(conn, x.insertId, { event: "received", change: r.verified, remaining: r.verified, refType, refId, locationId, userId,
      note: r.declared !== r.verified ? `declared ${r.declared} m, verified ${r.verified} m` : null });
    ids.push(x.insertId);
  }
  return ids;
}

/** Lock a roll of this product (and, if given, at that location). */
export async function lockRoll(conn, { businessId, product, rollId, locationId = null, statuses = ["available"], field = "rollId" }) {
  const [[r]] = await conn.query("SELECT * FROM fabric_rolls WHERE id = ? AND business_id = ? FOR UPDATE", [Number(rollId) || 0, businessId]);
  if (!r || (product && r.product_id !== product.id)) throw badRequest({ [field]: "rollNotFound" });
  if (!statuses.includes(r.status)) throw conflict("rollUnavailable", { roll: r.roll_code, status: r.status });
  if (locationId && r.location_id !== locationId) throw conflict("rollElsewhere", { roll: r.roll_code });
  return r;
}

/** Cut a length (meters) from a roll for a sale / invoice line. A length beyond what is left is refused. */
export async function cutFromRoll(conn, { businessId, product, rollId, meters, locationId, refType, refId, itemId, userId, field }) {
  const r = await lockRoll(conn, { businessId, product, rollId, locationId, field });
  const left = units(r.remaining) - units(meters);
  if (left < 0n) throw new HttpError(409, "rollTooShort", null, { roll: r.roll_code, available: Number(r.remaining) });
  const remaining = toNumber(left);
  await conn.query("UPDATE fabric_rolls SET remaining = ?, status = ? WHERE id = ?", [remaining, remaining === 0 ? "finished" : "available", r.id]);
  await event(conn, r.id, { event: "sold", change: -meters, remaining, refType, refId, itemId, locationId, userId });
  return r;
}

/**
 * A sale / invoice is cancelled: the cut fabric comes back as a returned piece waiting for inspection
 * (counted in stock, but not sellable until approved). Returns the new piece's ids.
 */
export async function returnCuts(conn, { businessId, refType, refId, locationId, userId, note }) {
  const [cuts] = await conn.query(
    `SELECT e.roll_id, e.length_change, r.product_id, r.roll_code, r.cost_per_meter FROM roll_events e JOIN fabric_rolls r ON r.id = e.roll_id
      WHERE r.business_id = ? AND e.ref_type = ? AND e.ref_id = ? AND e.event = 'sold'`, [businessId, refType, refId]);
  const ids = [];
  for (const c of cuts) {
    const meters = Math.abs(Number(c.length_change));
    const [[n]] = await conn.query("SELECT COUNT(*) n FROM fabric_rolls WHERE business_id = ?", [businessId]);
    const code = `RET-${String(Number(n.n) + 1).padStart(6, "0")}`;
    const [x] = await conn.query(
      `INSERT INTO fabric_rolls (business_id, product_id, roll_code, declared_length, verified_length, remaining, cost_per_meter, location_id, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_inspection', 'return')`,
      [businessId, c.product_id, code, meters, meters, meters, c.cost_per_meter, locationId]);
    await event(conn, x.insertId, { event: "returned", change: meters, remaining: meters, refType, refId, locationId, userId, note: `${note || ""} (cut from ${c.roll_code})`.trim() });
    ids.push(x.insertId);
  }
  return ids;
}

/** Selling: the chosen roll of each line (locked) is put on the line as it.roll (whole-roll price and length). */
export async function attachRolls(conn, businessId, items) {
  for (const it of items) {
    if (!it.rollId) continue;
    const [[r]] = await conn.query("SELECT * FROM fabric_rolls WHERE id = ? AND business_id = ? FOR UPDATE", [Number(it.rollId) || 0, businessId]);
    it.roll = r || null;
  }
}

/** Roll codes cut for each line of a sale / invoice: Map(itemId → [{ code, meters }]) */
export async function cutsByItem(db, businessId, refType, refId) {
  const [rows] = await db.query(
    `SELECT e.item_id, r.roll_code, -e.length_change meters FROM roll_events e JOIN fabric_rolls r ON r.id = e.roll_id
      WHERE r.business_id = ? AND e.ref_type = ? AND e.ref_id = ? AND e.event = 'sold' ORDER BY e.id`, [businessId, refType, refId]);
  const out = new Map();
  for (const x of rows) out.set(x.item_id, [...(out.get(x.item_id) || []), { code: x.roll_code, meters: q4(x.meters) }]);
  return out;
}

/** The meters a cancelled document gave back per product (to move the stock back). */
export async function cutsOf(conn, businessId, refType, refId) {
  const [rows] = await conn.query(
    `SELECT r.product_id, SUM(-e.length_change) meters FROM roll_events e JOIN fabric_rolls r ON r.id = e.roll_id
      WHERE r.business_id = ? AND e.ref_type = ? AND e.ref_id = ? AND e.event = 'sold' GROUP BY r.product_id`, [businessId, refType, refId]);
  return new Map(rows.map((x) => [x.product_id, q4(x.meters)]));
}

export { event as rollEvent };
