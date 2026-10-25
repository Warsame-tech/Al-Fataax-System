/* VAT: fixed 5%, optional per sale / invoice. Same rule as the server (server/src/lib/vat.js):
 * worked out in whole cents, half up — 50.75 → 2.54, 33.33 → 1.67, 19.99 → 1.00. */
export const VAT_RATE = 5;
export const vatOf = (addVat, net) => (addVat ? Math.round((Math.round(net * 100) * VAT_RATE) / 100) / 100 : 0);
