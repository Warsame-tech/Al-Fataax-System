/*
 * A product is shown as its name followed by its variant fields, e.g. "DOP Shampoo 400ml" or
 * (cosmetics) "Fit Me Foundation 30ml 220 Natural Beige". Names may repeat; the variant fields
 * (and barcode / SKU) tell products apart.
 */
const VARIANT_COLUMNS = ["size", "shade", "fragrance", "formula", "pack_size"];

export const productNameSql = (alias = "p") =>
  `CONCAT_WS(' ', ${alias}.name, ${VARIANT_COLUMNS.map((c) => `NULLIF(${alias}.${c}, '')`).join(", ")})`;

export const productName = (row) =>
  [row?.name, ...VARIANT_COLUMNS.map((c) => row?.[c])].filter((v) => v && String(v).trim()).join(" ");
