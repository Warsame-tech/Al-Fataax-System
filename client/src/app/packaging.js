/*
 * Product packaging (pharmacy): packs above the base unit, largest first — same rules as the server (lib/packaging.js).
 *   unit "tablet", packaging [{ name: "Carton", per: 100 }, { name: "Box", per: 6 }, { name: "Strip", per: 10 }]
 *   → 1 carton = 6,000 tablets · 2 cartons = 200 boxes = 1,200 strips = 12,000 tablets
 * Stock is kept in the base unit; purchases, stock entry, POS and invoices may use the packs.
 */
import { qty as fmtQty } from "./format.js";

const q4 = (v) => Math.round(Number(v) * 10000) / 10000;   // quantities: 4 decimals (lengths in meters: 0.1 mm)

/* Dosage forms and the packaging they usually come in (the counts are filled in per product). */
export const DOSAGE_FORMS = {
  tablet: { unit: "tablet", packs: [["Carton", true, false], ["Box", true, true], ["Strip", false, true]] },
  capsule: { unit: "capsule", packs: [["Carton", true, false], ["Box", true, true], ["Strip", false, true]] },
  syrup: { unit: "bottle", packs: [["Carton", true, false], ["Box", true, true]] },
  liquid: { unit: "ml", packs: [["Bottle", true, true]] },
  cream: { unit: "tube", packs: [["Carton", true, false], ["Box", true, true]] },
  injection: { unit: "ampoule", packs: [["Carton", true, false], ["Box", true, true]] },
  drops: { unit: "bottle", packs: [["Carton", true, false], ["Box", true, true]] },
  sachet: { unit: "sachet", packs: [["Carton", true, false], ["Box", true, true]] },
  other: { unit: "pcs", packs: [] }
};
export const PACK_NAMES = ["Carton", "Box", "Strip", "Blister", "Pack", "Bottle", "Tray"];

/** A dosage form's template: { unit, packaging: [{ name, per: "", buy, sell, price: "" }] } */
export function templateFor(form) {
  const tpl = DOSAGE_FORMS[form] || DOSAGE_FORMS.other;
  return { unit: tpl.unit, packaging: tpl.packs.map(([name, buy, sell]) => ({ name, per: "", buy, sell, price: "" })) };
}

/** Base units in one pack of this name (1 for the base unit); null when unknown or not complete. */
export function unitsPer(product, name) {
  if (!name || name === product.unit) return 1;
  const levels = product.packaging || [];
  const at = levels.findIndex((l) => l.name === name);
  if (at < 0) return null;
  let m = 1;
  for (const l of levels.slice(at)) { const n = Number(l.per); if (!(n > 0)) return null; m *= n; }
  return q4(m);
}

/** Units a product can be bought / sold in: [{ name, per, price }], base unit last. kind: "buy" | "sell" | "all" */
export function unitsOf(product, kind = "all") {
  const packs = (product.packaging || []).filter((l) => kind === "all" || (kind === "buy" ? l.buy !== false : l.sell))
    .map((l) => ({ name: l.name, per: unitsPer(product, l.name), price: l.price ?? null })).filter((u) => u.per);
  return [...packs, { name: product.unit, per: 1, price: null }];
}

/** Price of one pack: its own price, or the base price × units in the pack. */
export const packPrice = (product, name, basePrice = product.sellingPrice) => {
  const u = unitsOf(product, "all").find((x) => x.name === name);
  if (!u || u.per === 1) return Number(basePrice) || 0;
  return u.price !== null && u.price !== "" ? Number(u.price) : Math.round(Number(basePrice) * u.per * 10000) / 10000;
};

/**
 * "2 Carton = 200 Box = 1,200 Strip = 12,000 tablet" for a quantity of one pack (down to the base unit).
 * unitName(u) translates the base unit.
 */
export function breakdown(product, name, amount, unitName = (u) => u) {
  const n = Number(amount);
  if (!(n > 0)) return "";
  const levels = product.packaging || [];
  const at = name === product.unit ? levels.length : levels.findIndex((l) => l.name === name);
  if (at < 0) return "";
  const parts = [`${fmtQty(n)} ${name === product.unit ? unitName(name) : name}`];
  let count = n;
  for (let i = at; i < levels.length; i++) {
    const per = Number(levels[i].per);
    if (!(per > 0)) return parts.join(" = ");
    count = q4(count * per);
    parts.push(`${fmtQty(count)} ${i + 1 < levels.length ? levels[i + 1].name : unitName(product.unit)}`);
  }
  return parts.join(" = ");
}

/** Stock in base units shown in whole packs, e.g. 12,345 tablets → "2 Carton · 0 Box · 5 Strip · 3 tablet" (non-zero parts only). */
export function inPacks(product, amount, unitName = (u) => u) {
  let left = Math.max(0, Number(amount) || 0);
  const parts = [];
  for (const l of product.packaging || []) {
    const per = unitsPer(product, l.name);
    if (!per) return "";
    const n = Math.floor(left / per + 1e-9);
    if (n > 0) { parts.push(`${fmtQty(n)} ${l.name}`); left = q4(left - n * per); }
  }
  if (left > 0 || !parts.length) parts.push(`${fmtQty(left)} ${unitName(product.unit)}`);
  return parts.join(" · ");
}
