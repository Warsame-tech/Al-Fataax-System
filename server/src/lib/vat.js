/*
 * VAT: a fixed 5%, optional per sale / invoice ("Add VAT" on the payment screen and the invoice form).
 * It is charged on the amount after discount and added to the total the customer pays.
 * VAT is not the business's income: sales totals on the dashboard and in reports leave it out.
 */
export const VAT_RATE = 5;
const r2 = (v) => Math.round(v * 100) / 100;

/** body.vat true → { rate: 5, amount }, otherwise no VAT. */
export function vatFor(addVat, netAmount) {
  if (!(addVat === true || addVat === "true" || addVat === 1 || addVat === "1")) return { rate: 0, amount: 0 };
  // work in whole cents so the result is exact: 50.75 → 5075 cents × 5% = 253.75 → 254 cents = 2.54
  const cents = Math.round(netAmount * 100);
  return { rate: VAT_RATE, amount: Math.round((cents * VAT_RATE) / 100) / 100 };
}
