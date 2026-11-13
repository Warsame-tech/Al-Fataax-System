/*
 * Retail / wholesale pricing rules shared by the POS and invoices (the server checks the same: lib/pricing.js).
 *   priceEdit "fixed": nobody changes the price at a sale; "editable": anyone who sells; "permission": prices.edit only.
 *   minPrice is per base unit; below it the sale needs prices.approve or a manager's approval.
 */
export const canChangePrice = (can, p) => {
  const mode = p?.priceEdit || "permission";
  return mode === "editable" || (mode === "permission" && can("prices.edit"));
};

/** Is this price (for `per` base units, e.g. a box of 10) below the product's minimum selling price? */
export const isBelowMin = (p, price, per = 1) =>
  p?.minPrice !== null && p?.minPrice !== undefined && price !== "" && price !== null && Number(price) / (per || 1) < Number(p.minPrice) - 0.00005;
