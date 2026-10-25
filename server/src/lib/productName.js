/*
 * A product is shown as its name followed by its size, e.g. "DOP Shampoo 400ml".
 * Names may repeat; the size (and barcode / SKU) tells products apart.
 */
export const productNameSql = (alias = "p") => `CONCAT_WS(' ', ${alias}.name, NULLIF(${alias}.size, ''))`;
export const productName = (row) => [row?.name, row?.size].filter((v) => v && String(v).trim()).join(" ");
