/*
 * Warranties (electronics). Products may carry a warranty policy (months, provider, terms); a sale or invoice line
 * may set its own months (individual sale). One warranty per device sold (serial / IMEI), or one per line
 * for products sold by quantity. No months → no warranty.
 * Status: active, under_review, claim_submitted, resolved, rejected, void (sale cancelled); "expired" is shown
 * when an active warranty is past its end date.
 */
export const WARRANTY_STATUSES = ["active", "under_review", "claim_submitted", "resolved", "rejected", "void"];

export async function createWarranties(conn, { businessId, product, devices = [], qty, months, customerId, refType, refId, userId, date = null }) {
  const m = months === null || months === undefined ? Number(product.warranty_months || 0) : Number(months);
  if (!(m > 0)) return [];
  const rows = devices.length ? devices.map((d) => ({ deviceId: d.id, qty: 1 })) : [{ deviceId: null, qty }];
  const ids = [];
  for (const r of rows) {
    const [w] = await conn.query(
      `INSERT INTO warranties (business_id, product_id, device_id, customer_id, ref_type, ref_id, qty, provider, months, start_date, end_date, terms, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE(COALESCE(?, UTC_TIMESTAMP())), DATE_ADD(DATE(COALESCE(?, UTC_TIMESTAMP())), INTERVAL ? MONTH), ?, 'active')`,
      [businessId, product.id, r.deviceId, customerId || null, refType, refId, r.qty, product.warranty_provider || null, m, date, date, m, product.warranty_terms || null]);
    await conn.query("INSERT INTO warranty_events (warranty_id, changes, note, user_id) VALUES (?, NULL, 'created', ?)", [w.insertId, userId]);
    ids.push(w.insertId);
  }
  return ids;
}

/** A cancelled sale / invoice: its warranties become void (kept in history). */
export async function voidWarranties(conn, { businessId, refType, refId, userId, reason }) {
  const [rows] = await conn.query("SELECT id, status FROM warranties WHERE business_id = ? AND ref_type = ? AND ref_id = ? AND status <> 'void' FOR UPDATE", [businessId, refType, refId]);
  for (const w of rows) {
    await conn.query("UPDATE warranties SET status = 'void' WHERE id = ?", [w.id]);
    await conn.query("INSERT INTO warranty_events (warranty_id, changes, note, user_id) VALUES (?, ?, ?, ?)",
      [w.id, JSON.stringify([{ field: "status", from: w.status, to: "void" }]), reason || null, userId]);
  }
}
