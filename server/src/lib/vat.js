/*
 * VAT: a fixed 5%, optional per sale / invoice ("Add VAT" on the payment screen and the invoice form).
 * It is charged on the amount after discount and added to the total the customer pays.
 * VAT is not the business's income: sales totals on the dashboard and in reports leave it out.
 */
export const VAT_RATE = 5;

/** body.vat true → { rate: 5, amount }, otherwise no VAT. */
export function vatFor(addVat, netAmount) {
  if (!(addVat === true || addVat === "true" || addVat === 1 || addVat === "1")) return { rate: 0, amount: 0 };
  // exact, never rounded: 5% of a cent amount always fits in 4 decimals (50.75 → 2.5375, 0.15 → 0.0075)
  const tenThousandths = Math.round(netAmount * 10000);
  return { rate: VAT_RATE, amount: Math.round((tenThousandths * VAT_RATE) / 100) / 10000 };
}
