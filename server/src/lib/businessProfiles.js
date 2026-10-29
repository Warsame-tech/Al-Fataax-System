/*
 * Each business type gets its own way of working (products form and list, stock entry, sales, purchases).
 * The type chosen at sign-up ("Business category") picks the profile; the profile is sent to the app
 * with the signed-in business (req.business.profile → GET /api/auth/me) and the screens follow it.
 *
 *   variants        product variant fields shown in the form / list and added to the product name
 *                   (size, shade, fragrance, formula, packSize)
 *   extraBarcodes   several barcodes per product, each for a packaging unit (e.g. box of 12)
 *   batches         every product tracks batch number + expiry date per stock entry, sold first-expiry-first-out
 *   expirySoonDays  "expiring soon" window for batch alerts and filters
 *   labels          different words for the same product fields (keys of ui.products.*)
 *   units           units of measurement offered in the product form (null = the full list)
 *   hiddenFields    product form fields this business does not use (e.g. description)
 *
 * Add a business type here when its special interface is built; types without one use DEFAULT.
 */
const DEFAULT = {
  key: "default",
  variants: ["size"],
  extraBarcodes: false,
  batches: false,
  expirySoonDays: 90,
  labels: {},
  units: null,
  hiddenFields: []
};

const PROFILES = {
  cosmetics: {
    key: "cosmetics",
    variants: ["size", "packSize"],
    extraBarcodes: true,
    batches: true,
    expirySoonDays: 90,
    labels: { costPrice: "purchaseCost", sellingPrice: "retailPrice", lowStockAlert: "reorderLevel", lowStockShort: "reorderLevel" },
    // e.g. 1 bottle, or 1 carton of 12 bottles (packaging barcode: carton × 12)
    units: ["pcs", "bottle", "tube", "box", "carton"],
    hiddenFields: ["description"]
  }
};

export function profileFor(type) {
  return { ...DEFAULT, ...(PROFILES[type] || {}) };
}
