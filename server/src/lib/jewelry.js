/*
 * Jewelry pricing. Weights are grams, rates are money per gram of a metal + purity (metal_rates, latest wins).
 *
 *   net weight   = gross weight − stone / non-metal weight
 *   metal value  = net weight × rate (metal, purity)
 *   making       = making charge × net weight (per gram) or a fixed amount
 *   price        = metal value + making + additional charges          (fixed-price items: their selling price)
 *
 * All arithmetic is done in whole units of 1/10,000 with BigInt (no floating-point sums); results are rounded half up
 * to 4 decimals like the rest of Faatix money. Each sale / invoice line keeps the detail (rate, purity, weights,
 * charges) it was priced with, so later rate changes never alter history.
 */
const SCALE = 10000n;

/** "12.3456" / 12.3456 → 123456n (units of 1/10,000), half up */
export function units(v) {
  if (v === null || v === undefined || v === "") return 0n;
  const s = String(v).trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return BigInt(Math.round(Number(v) * 10000));
  const frac = (m[3] || "").padEnd(5, "0");
  let n = BigInt(m[2] || "0") * SCALE + BigInt(frac.slice(0, 4));
  if (Number(frac[4]) >= 5) n += 1n;
  return m[1] ? -n : n;
}
/** 123456n → 12.3456 */
export const toNumber = (u) => Number(u) / 10000;
/** a × b for two scaled values, half up */
const mul = (a, b) => { const p = a * b; return p >= 0n ? (p + SCALE / 2n) / SCALE : -((-p + SCALE / 2n) / SCALE); };

export const netWeight = (gross, stone) => {
  const n = units(gross) - units(stone);
  return toNumber(n > 0n ? n : 0n);
};

/** Current rate map: "gold|22K" → rate (number). */
export async function currentRates(db, businessId) {
  const [rows] = await db.query(
    `SELECT r.metal, r.purity, r.rate FROM metal_rates r
      JOIN (SELECT metal, purity, MAX(id) id FROM metal_rates WHERE business_id = ? GROUP BY metal, purity) x ON x.id = r.id`, [businessId]);
  return new Map(rows.map((r) => [`${r.metal}|${r.purity}`, Number(r.rate)]));
}

/**
 * Price of one weight-priced item with a rate map. Returns null for fixed-price items or when no rate is set
 * (then the item's own selling price is used). detail is what gets recorded on the sale line.
 */
export function weightPrice(p, rates) {
  if (p.pricing_mode !== "weight" || !p.metal || !p.purity) return null;
  const rate = rates?.get(`${p.metal}|${p.purity}`);
  if (rate === undefined) return null;
  const net = units(p.gross_weight) - units(p.stone_weight);
  const netW = net > 0n ? net : 0n;
  const metalValue = mul(netW, units(rate));
  const making = p.making_type === "fixed" ? units(p.making_charge) : mul(netW, units(p.making_charge));
  const extra = units(p.extra_charge);
  const total = metalValue + making + extra;
  return {
    price: toNumber(total),
    detail: {
      metal: p.metal, purity: p.purity, rate, grossWeight: toNumber(units(p.gross_weight)), stoneWeight: toNumber(units(p.stone_weight)),
      netWeight: toNumber(netW), metalValue: toNumber(metalValue), makingType: p.making_type, makingCharge: toNumber(units(p.making_charge)),
      making: toNumber(making), extra: toNumber(extra), total: toNumber(total)
    }
  };
}

/** Value of used gold offered by a customer: net weight × rate × (1 − deduction %). */
export function usedGoldValue({ gross, stone, rate, deductionPct }) {
  const net = units(gross) - units(stone);
  const value = mul(net > 0n ? net : 0n, units(rate));
  const keep = SCALE * 100n - units(deductionPct);          // (100 − d) %, scaled
  return toNumber(((value * keep) + (SCALE * 100n) / 2n) / (SCALE * 100n));
}

/* Item statuses (jewelry): sold is set by sales; damaged / pending inspection can't be sold. */
export const ITEM_STATUSES = ["active", "returned", "damaged", "sold"];
export const unsellable = (p) => ["damaged", "pending_inspection"].includes(p.item_status);
