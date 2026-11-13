/*
 * Flexible retail & wholesale pricing (every business type).
 *
 * Every product has a cost price, a retail price (selling_price), an optional wholesale price and an optional
 * minimum selling price (min_price, per base unit).
 *   - Price list: a sale or invoice uses the customer's price type (customers.price_tier: retail | wholesale);
 *     walk-in sales are retail. Choosing another price list on an invoice needs prices.edit.
 *   - Price editing (products.price_edit): fixed — nobody changes the price at a sale; editable — anyone who sells
 *     may change it; permission — only users with prices.edit.
 *   - Minimum price: a line below the minimum needs prices.approve, or a manager's approval (lib/promotions.js signApproval
 *     "price"). The list price and the approver are kept on the line and the change is written to the audit log.
 *   - Cost price: seen only with costs.view, changed only with costs.edit.
 */
import { can } from "./permissions.js";

export const PRICE_EDIT = ["fixed", "editable", "permission"];
export const PRICE_TIERS = ["retail", "wholesale"];

/** May this user change this product's selling price on a sale / invoice? */
export function canChangePrice(user, product) {
  const mode = product?.price_edit || "permission";
  if (mode === "fixed") return false;
  if (mode === "editable") return true;
  return can(user, "prices.edit");
}

/** The price list a customer buys at (walk-in: retail). */
export async function priceTierOf(db, businessId, customerId) {
  if (!customerId) return "retail";
  const [[c]] = await db.query("SELECT price_tier FROM customers WHERE id = ? AND business_id = ?", [customerId, businessId]);
  return c?.price_tier === "wholesale" ? "wholesale" : "retail";
}

/** Cost fields hidden from users without costs.view (products and stock screens). */
export function withoutCost(user, out, keys = ["costPrice", "costPerGram"]) {
  if (can(user, "costs.view")) return out;
  const copy = { ...out };
  for (const k of keys) if (k in copy) copy[k] = null;
  return copy;
}

/**
 * Lines whose price was changed or went below the minimum: written to the sale / invoice audit entry
 * (the line itself keeps list_price and price_approved_by).
 */
export function priceChanges(lines) {
  return lines.filter((l) => l.priceChanged || l.belowMin).map((l) => ({
    productId: l.product.id, name: l.product.name, unit: l.sell?.unit || l.product.unit, listPrice: l.listPrice, price: l.sell ? l.sell.price : l.unitPrice,
    ...(l.belowMin ? { belowMin: true, minPrice: Number(l.product.min_price), approvedBy: l.approvedBy } : {})
  }));
}
