/*
 * Promotions and discount controls (POS sales, restaurant bills).
 *
 * promotions.kind
 *   percent   x % off eligible items          amount  x off each eligible item       price  eligible items at price x
 *   bogo      buy N get M free (the cheapest units of the eligible items are free)
 *   order_percent / order_amount   off the whole order when it reaches min_total
 * Eligible items: the promotion's products and / or categories (none = every item). Active between starts_at and
 * ends_at, on the chosen weekdays (none = every day). A line gets the best item promotion (no stacking); the order gets
 * the best order promotion, worked out on the total after item promotions.
 *
 * Discount controls (business_settings.discount_rules { maxPct, approvalPct }): a manual discount above approvalPct
 * of the bill needs a manager's approval (discounts.approve — a short-lived approval from POST /api/promotions/approval);
 * nobody but the owner may go above maxPct.
 */
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError, conflict } from "./http.js";
import { can } from "./permissions.js";

export const PROMO_KINDS = ["percent", "amount", "price", "bogo", "order_percent", "order_amount"];
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
const num = (v) => Number(v || 0);
const list = (v) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a.map(Number).filter(Boolean) : []; } catch { return []; } };

/** Active promotions now (business time is UTC in the database). */
export async function activePromotions(db, businessId, at = new Date()) {
  const [rows] = await db.query(
    `SELECT * FROM promotions WHERE business_id = ? AND is_active = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)`, [businessId, at, at]);
  const day = at.getUTCDay();
  return rows.map((p) => ({ ...p, products: list(p.product_ids), categories: list(p.category_ids), days: list(p.days_json).map((d) => d - 1) }))
    .filter((p) => !p.days.length || p.days.includes(day));
}

const eligible = (p, line) => (!p.products.length && !p.categories.length) || p.products.includes(line.productId) || (line.categoryId && p.categories.includes(line.categoryId));

/**
 * lines: [{ productId, categoryId, qty, unitPrice, lineTotal }] → { lines: [{ discount, promo }], order: { discount, promo } }
 */
export function applyPromotions(promos, lines) {
  const out = lines.map(() => ({ discount: 0, promo: null }));
  for (const [i, l] of lines.entries()) {
    for (const p of promos.filter((x) => !x.kind.startsWith("order_") && eligible(x, l))) {
      let d = 0;
      const v = num(p.value);
      if (p.kind === "percent") d = (num(l.lineTotal) * Math.min(v, 100)) / 100;
      else if (p.kind === "amount") d = Math.min(v * num(l.qty), num(l.lineTotal));
      else if (p.kind === "price") d = Math.max(0, num(l.unitPrice) - v) * num(l.qty);
      else if (p.kind === "bogo" && num(p.buy_qty) > 0 && num(p.get_qty) > 0) {
        const free = Math.floor(num(l.qty) / (num(p.buy_qty) + num(p.get_qty))) * num(p.get_qty);
        d = free * num(l.unitPrice);
      }
      d = r4(Math.min(d, num(l.lineTotal)));
      if (d > out[i].discount) out[i] = { discount: d, promo: { id: p.id, name: p.name, kind: p.kind } };
    }
  }
  const after = r4(lines.reduce((s, l, i) => s + num(l.lineTotal) - out[i].discount, 0));
  let order = { discount: 0, promo: null };
  for (const p of promos.filter((x) => x.kind.startsWith("order_") && after >= num(x.min_total))) {
    const d = r4(Math.min(after, p.kind === "order_percent" ? (after * Math.min(num(p.value), 100)) / 100 : num(p.value)));
    if (d > order.discount) order = { discount: d, promo: { id: p.id, name: p.name, kind: p.kind } };
  }
  return { lines: out, order };
}

/* ---------- discount rules and manager approval ---------- */
export async function discountRules(db, businessId) {
  const [[s]] = await db.query("SELECT discount_rules FROM business_settings WHERE business_id = ?", [businessId]);
  let r = {};
  try { r = JSON.parse(s?.discount_rules || "{}") || {}; } catch { /* defaults */ }
  return { maxPct: r.maxPct === undefined || r.maxPct === null ? 100 : Number(r.maxPct), approvalPct: r.approvalPct === undefined || r.approvalPct === null ? 100 : Number(r.approvalPct) };
}
/** A manager's approval of one discount (10 minutes). */
export const signApproval = (businessId, userId) => jwt.sign({ kind: "discount-approval", bid: businessId, uid: userId }, env.jwtSecret, { expiresIn: "10m" });
export function readApproval(token, businessId) {
  try {
    const p = jwt.verify(String(token || ""), env.jwtSecret);
    return p.kind === "discount-approval" && p.bid === businessId ? p.uid : null;
  } catch { return null; }
}
/**
 * A manual discount on a bill: within maxPct (owner excepted), and above approvalPct only with a manager's approval.
 * Returns the approving user id (or null).
 */
export async function checkDiscount(db, { businessId, role, discount, base, approvalToken }) {
  if (!(discount > 0) || !(base > 0)) return null;
  const pct = (discount / base) * 100;
  const rules = await discountRules(db, businessId);
  if (pct > rules.maxPct + 0.0001 && role?.role !== "owner") throw new HttpError(409, "discountTooHigh", null, { max: rules.maxPct });
  if (pct <= rules.approvalPct + 0.0001 || can(role, "discounts.approve")) return null;
  const approver = readApproval(approvalToken, businessId);
  if (!approver) throw conflict("discountNeedsApproval", { limit: rules.approvalPct });
  return approver;
}
