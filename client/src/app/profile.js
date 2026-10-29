import { useAuth } from "../auth/AuthContext.jsx";

/*
 * The signed-in business's own interface, picked by its business type at sign-up
 * (server: lib/businessProfiles.js). Screens read it to show the fields and tools that business needs:
 *
 *   const profile = useProfile();
 *   profile.variants        ["size", "shade", "fragrance", "formula", "packSize"]   (cosmetics)
 *   profile.extraBarcodes   packaging barcodes      profile.batches   batch + expiry tracking
 *   profile.hiddenFields    product form fields not used by this business (cosmetics: description)
 *   profile.medicine        medicine details (generic name, dosage form, manufacturer, supplier, prescription, storage)
 *   profile.packaging       packs above the base unit (app/packaging.js)   profile.purchaseOrders   order first, receive later
 *   profile.units           units offered in the product form (cosmetics: pcs, bottle, tube, box, carton; null = all)
 *   label("costPrice")      "Purchase cost" for cosmetics, "Cost price" otherwise
 */
const DEFAULT = { key: "default", variants: ["size"], extraBarcodes: false, batches: false, expirySoonDays: 90, labels: {}, units: null, hiddenFields: [], medicine: false, packaging: false, purchaseOrders: false };

export function useProfile() {
  const { business } = useAuth();
  return business?.profile || DEFAULT;
}

/** Product field label in this business's words: t(`ui.products.<label>`). */
export function productLabel(t, profile, key) {
  return t(`ui.products.${profile.labels?.[key] || key}`);
}

/** Variant fields other than size, e.g. "220 Natural Beige · Rose · Matte · Pack of 3". */
export const variantText = (p) => [p.shade, p.fragrance, p.formula, p.packSize].filter(Boolean).join(" · ");

/** "expired" | "soon" | null for a nearest-expiry date (YYYY-MM-DD). */
export function expiryState(dateStr, soonDays = 90) {
  if (!dateStr) return null;
  const days = Math.floor((Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00Z`) - Date.now()) / 86400000);
  return days < 0 ? "expired" : days <= soonDays ? "soon" : null;
}
