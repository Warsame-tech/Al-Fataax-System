/* VAT: fixed 5%, optional per sale / invoice. Same rule as the server (server/src/lib/vat.js). */
export const VAT_RATE = 5;
export const vatOf = (addVat, net) => (addVat ? Math.round(net * VAT_RATE) / 100 : 0);
