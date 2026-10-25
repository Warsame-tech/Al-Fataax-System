/* VAT: fixed 5%, optional per sale / invoice. Same rule as the server (server/src/lib/vat.js):
 * exact, never rounded — 50.75 → 2.5375, 0.15 → 0.0075, 19.99 → 0.9995 (money keeps 4 decimals). */
export const VAT_RATE = 5;
export const vatOf = (addVat, net) => (addVat ? Math.round((Math.round(net * 10000) * VAT_RATE) / 100) / 10000 : 0);
