/*
 * Batch & expiry tracking (products with track_batches = 1, e.g. cosmetics).
 * Called only from moveStock, so every stock change keeps the batches in step with the location quantity:
 *
 *   stock in   → the batches given ({ batchNo, expiryDate, qty }), else the batches the change mirrors
 *                (cancelled sale / invoice, reversal, transfer from another location), else "no batch"
 *   stock out  → the batches the change mirrors (purchase return, reversal), else first-expiry-first-out
 *
 * Each movement's share of each batch is kept in stock_movement_batches, which is what lets a
 * cancel / reversal / transfer put the stock back into the same batches.
 */
const q3 = (v) => Math.round(Number(v) * 1000) / 1000;

async function record(conn, movementId, batchId, qty) {
  if (movementId && qty) await conn.query("INSERT INTO stock_movement_batches (movement_id, batch_id, qty) VALUES (?, ?, ?)", [movementId, batchId, qty]);
}

/** Adds qty to the batch (product, location, batch no, expiry), creating it when new. */
async function addTo(conn, { businessId, productId, locationId, batchNo, expiryDate, qty, movementId }) {
  const [[b]] = await conn.query(
    "SELECT id FROM product_batches WHERE product_id = ? AND location_id = ? AND batch_no = ? AND expiry_date <=> ? LIMIT 1 FOR UPDATE",
    [productId, locationId, batchNo || "", expiryDate || null]);
  let batchId = b?.id;
  if (batchId) await conn.query("UPDATE product_batches SET qty = qty + ? WHERE id = ?", [qty, batchId]);
  else {
    const [r] = await conn.query("INSERT INTO product_batches (business_id, product_id, location_id, batch_no, expiry_date, qty) VALUES (?, ?, ?, ?, ?, ?)",
      [businessId, productId, locationId, batchNo || "", expiryDate || null, qty]);
    batchId = r.insertId;
  }
  await record(conn, movementId, batchId, qty);
}

/** Takes up to qty from batches first-expiry-first-out (no expiry last). Returns what could not be taken. */
async function takeFefo(conn, { productId, locationId, qty, movementId }) {
  const [rows] = await conn.query(
    `SELECT id, qty FROM product_batches WHERE product_id = ? AND location_id = ? AND qty > 0
      ORDER BY expiry_date IS NULL, expiry_date, id FOR UPDATE`, [productId, locationId]);
  let left = qty;
  for (const b of rows) {
    if (left <= 0) break;
    const take = q3(Math.min(left, Number(b.qty)));
    await conn.query("UPDATE product_batches SET qty = qty - ? WHERE id = ?", [take, b.id]);
    await record(conn, movementId, b.id, -take);
    left = q3(left - take);
  }
  return left;
}

/* The earlier movement this one undoes or continues (its batch shares are mirrored). */
async function sourceMovement(conn, m) {
  if (m.reversalOf) return { id: m.reversalOf, sameLocation: true };
  if (m.type === "transfer_in" && m.transferRef) {
    const [[s]] = await conn.query(
      "SELECT id FROM stock_movements WHERE business_id = ? AND product_id = ? AND transfer_ref = ? AND type = 'transfer_out' ORDER BY id DESC LIMIT 1",
      [m.businessId, m.productId, m.transferRef]);
    return s ? { id: s.id, sameLocation: false } : null;
  }
  if (["sale", "invoice", "purchase"].includes(m.refType) && m.refId) {
    const [[s]] = await conn.query(
      `SELECT id FROM stock_movements WHERE business_id = ? AND product_id = ? AND ref_type = ? AND ref_id = ? AND SIGN(qty_change) = ? AND id <> ?
        ORDER BY id LIMIT 1`, [m.businessId, m.productId, m.refType, m.refId, m.qtyChange > 0 ? -1 : 1, m.movementId]);
    return s ? { id: s.id, sameLocation: true } : null;
  }
  return null;
}

/** Keeps the product's batches in step with a stock movement (see top of file). */
export async function moveBatches(conn, m) {
  const { businessId, productId, locationId, qtyChange, movementId } = m;
  let left = q3(Math.abs(qtyChange));

  // 1. stock in with batch numbers / expiry dates given (add stock, opening stock, purchases)
  if (qtyChange > 0) {
    for (const b of m.batches || []) {
      const qty = q3(Math.min(left, Number(b.qty) || left));
      if (qty <= 0) continue;
      await addTo(conn, { businessId, productId, locationId, batchNo: b.batchNo, expiryDate: b.expiryDate, qty, movementId });
      left = q3(left - qty);
    }
  }

  // 2. mirror the movement this one undoes / continues
  if (left > 0) {
    const src = await sourceMovement(conn, m);
    if (src) {
      const [shares] = await conn.query(
        `SELECT a.qty, b.id batch_id, b.batch_no, b.expiry_date, b.qty batch_qty FROM stock_movement_batches a
           JOIN product_batches b ON b.id = a.batch_id WHERE a.movement_id = ? ORDER BY a.id FOR UPDATE`, [src.id]);
      for (const s of shares) {
        if (left <= 0) break;
        const want = q3(Math.min(left, Math.abs(Number(s.qty))));
        if (qtyChange > 0) {
          if (src.sameLocation) {
            await conn.query("UPDATE product_batches SET qty = qty + ? WHERE id = ?", [want, s.batch_id]);
            await record(conn, movementId, s.batch_id, want);
          } else {
            await addTo(conn, { businessId, productId, locationId, batchNo: s.batch_no, expiryDate: s.expiry_date, qty: want, movementId });
          }
          left = q3(left - want);
        } else if (src.sameLocation) {
          const take = q3(Math.min(want, Number(s.batch_qty)));
          if (take <= 0) continue;
          await conn.query("UPDATE product_batches SET qty = qty - ? WHERE id = ?", [take, s.batch_id]);
          await record(conn, movementId, s.batch_id, -take);
          left = q3(left - take);
        }
      }
    }
  }

  // 3. the rest: stock in without a batch → "no batch"; stock out → first-expiry-first-out
  if (left > 0) {
    if (qtyChange > 0) await addTo(conn, { businessId, productId, locationId, batchNo: "", expiryDate: null, qty: left, movementId });
    else await takeFefo(conn, { productId, locationId, qty: left, movementId });
  }
}

/**
 * Batch tracking switched on for a product: the stock already there (per location) becomes
 * "no batch" stock, so batches always add up to the location quantities.
 */
export async function startBatchTracking(conn, businessId, productId) {
  const [rows] = await conn.query(
    `SELECT ps.location_id, ps.qty, COALESCE((SELECT SUM(b.qty) FROM product_batches b WHERE b.product_id = ps.product_id AND b.location_id = ps.location_id), 0) batched
       FROM product_stock ps WHERE ps.business_id = ? AND ps.product_id = ? FOR UPDATE`, [businessId, productId]);
  for (const r of rows) {
    const diff = q3(Number(r.qty) - Number(r.batched));
    if (diff > 0) await addTo(conn, { businessId, productId, locationId: r.location_id, batchNo: "", expiryDate: null, qty: diff, movementId: null });
    else if (diff < 0) await takeFefo(conn, { productId, locationId: r.location_id, qty: -diff, movementId: null });
  }
}

/** Batch numbers / expiry dates sent with a stock-in line: [{ batchNo, expiryDate, qty }] or a single { batchNo, expiryDate }. */
export function readBatch(x, qty) {
  const batchNo = typeof x?.batchNo === "string" ? x.batchNo.trim().slice(0, 60) : "";
  const expiryDate = typeof x?.expiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.expiryDate) ? x.expiryDate : null;
  return batchNo || expiryDate ? [{ batchNo, expiryDate, qty }] : [];
}
