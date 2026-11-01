/*
 * Food businesses: recipes and what selling a dish uses up.
 *
 * Products have a kind (products.item_kind):
 *   menu       prepared dish / drink; no stock of its own — selling it uses its recipe's ingredients
 *   modifier   an extra / add-on (extra cheese) with a price and (optional) its own recipe
 *   prepared   made in batches from a recipe (sauce, dough) and kept in stock (POST /api/food/production)
 *   goods      bought and sold as is (bottled water) · ingredient · packaging — ordinary stock items
 *
 * A recipe (recipes + recipe_lines) is versioned: saving a change adds a new version and keeps the old ones.
 * Lines are quantities of an ingredient in any convertible unit (g ↔ kg, ml ↔ liter) and may be optional (the customer
 * can leave it out), takeaway-only (a box) or dine-in only. A line may be another menu item (combos / meal deals):
 * its own recipe is used. yield_qty: how many units one recipe makes (batch recipes).
 *
 * Selling: the ingredients leave stock (movement type "consumption") and the cost of what was used, at today's
 * ingredient costs, is kept on the sale line (unit_cost + price_detail.consumption) — later price or recipe changes
 * never change a past sale's cost.
 */
import { HttpError, badRequest, conflict } from "./http.js";
import { productName } from "./productName.js";
import { lockProducts, moveStock } from "./ledger.js";

export const ITEM_KINDS = ["menu", "goods", "ingredient", "packaging", "modifier", "prepared"];
/** sold through its recipe (no stock of its own) */
export const viaRecipe = (p) => p?.item_kind === "menu" || p?.item_kind === "modifier";
export const SERVICES = ["dine_in", "takeaway", "counter", "delivery"];
const TAKEAWAY = new Set(["takeaway", "delivery"]);
const q4 = (v) => Math.round(Number(v) * 10000) / 10000;
const num = (v) => Number(v || 0);

/* unit conversion: mass and volume families; anything else must match exactly */
const FAMILY = { mg: ["m", 0.001], g: ["m", 1], kg: ["m", 1000], ml: ["v", 1], cl: ["v", 10], liter: ["v", 1000], l: ["v", 1000] };
export function convert(qty, from, to) {
  if (from === to) return Number(qty);
  const a = FAMILY[String(from).toLowerCase()];
  const b = FAMILY[String(to).toLowerCase()];
  if (!a || !b || a[0] !== b[0]) return null;
  return (Number(qty) * a[1]) / b[1];
}
/** units a recipe line may use for an ingredient kept in `unit` */
export const unitsFor = (unit) => {
  const f = FAMILY[String(unit).toLowerCase()];
  return f ? Object.keys(FAMILY).filter((u) => FAMILY[u][0] === f[0] && u !== "l") : [unit];
};

/** Menu options (sizes, extras) saved on a product. */
export function optionsOf(p) {
  try {
    const o = JSON.parse(p?.menu_options || "{}") || {};
    return { sizes: Array.isArray(o.sizes) ? o.sizes : [], extras: Array.isArray(o.extras) ? o.extras.map(Number).filter(Boolean) : [] };
  } catch { return { sizes: [], extras: [] }; }
}

/* ---------- recipes ---------- */
export async function recipeOf(db, businessId, productId, versionId = null) {
  const [[r]] = await db.query(
    versionId ? "SELECT * FROM recipes WHERE business_id = ? AND product_id = ? AND id = ?" : "SELECT * FROM recipes WHERE business_id = ? AND product_id = ? AND is_current = 1",
    versionId ? [businessId, productId, versionId] : [businessId, productId]);
  if (!r) return null;
  const [lines] = await db.query(
    `SELECT l.*, p.name ingredient_name, p.size, p.shade, p.fragrance, p.formula, p.pack_size, p.unit ingredient_unit, p.cost_price, p.item_kind, p.stock_qty
       FROM recipe_lines l JOIN products p ON p.id = l.ingredient_id WHERE l.recipe_id = ? ORDER BY l.sort, l.id`, [r.id]);
  return { id: r.id, version: r.version, yieldQty: num(r.yield_qty) || 1, notes: r.notes || "", createdAt: r.created_at, userId: r.user_id, lines };
}

/** Saves a new version of a product's recipe. lines: [{ ingredientId, qty, unit, optional?, service? }] */
export async function saveRecipe(conn, { businessId, product, body, userId }) {
  const raw = Array.isArray(body.lines) ? body.lines.slice(0, 80) : [];
  const yieldQty = body.yieldQty === "" || body.yieldQty == null ? 1 : Number(body.yieldQty);
  const e = {};
  if (!Number.isFinite(yieldQty) || yieldQty <= 0) e.yieldQty = "invalidAmount";
  const ids = [...new Set(raw.map((l) => Number(l?.ingredientId)).filter(Boolean))];
  const [ings] = ids.length ? await conn.query("SELECT id, name, unit, item_kind FROM products WHERE business_id = ? AND id IN (?)", [businessId, ids]) : [[]];
  const byId = new Map(ings.map((p) => [p.id, p]));
  const lines = raw.map((l, i) => {
    const ing = byId.get(Number(l?.ingredientId));
    const qty = Number(l?.qty);
    const unit = typeof l?.unit === "string" && l.unit.trim() ? l.unit.trim().slice(0, 20) : ing?.unit;
    if (!ing) { e[`lines.${i}.ingredientId`] = "required"; return null; }
    if (ing.id === product.id) { e[`lines.${i}.ingredientId`] = "recipeSelf"; return null; }
    if (!Number.isFinite(qty) || qty <= 0) { e[`lines.${i}.qty`] = "invalidAmount"; return null; }
    if (convert(1, unit, ing.unit) === null) { e[`lines.${i}.unit`] = "unitMismatch"; return null; }
    return { ingredientId: ing.id, qty: q4(qty), unit, optional: Boolean(l.optional), service: ["takeaway", "dine_in"].includes(l.service) ? l.service : "all" };
  }).filter(Boolean);
  if (Object.keys(e).length) throw badRequest(e);
  // a combo may contain other menu items, but not one that contains this item (loop)
  for (const l of lines) {
    if (viaRecipe(byId.get(l.ingredientId)) && (await usesProduct(conn, businessId, l.ingredientId, product.id, 0))) throw badRequest({ lines: "recipeLoop" });
  }
  const [[last]] = await conn.query("SELECT MAX(version) v FROM recipes WHERE business_id = ? AND product_id = ?", [businessId, product.id]);
  await conn.query("UPDATE recipes SET is_current = 0 WHERE business_id = ? AND product_id = ?", [businessId, product.id]);
  const [r] = await conn.query("INSERT INTO recipes (business_id, product_id, version, yield_qty, notes, is_current, user_id) VALUES (?, ?, ?, ?, ?, 1, ?)",
    [businessId, product.id, Number(last?.v || 0) + 1, q4(yieldQty), typeof body.notes === "string" ? body.notes.trim().slice(0, 255) || null : null, userId]);
  for (const [i, l] of lines.entries()) {
    await conn.query("INSERT INTO recipe_lines (recipe_id, ingredient_id, qty, unit, optional, service, sort) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [r.insertId, l.ingredientId, l.qty, l.unit, l.optional ? 1 : 0, l.service, i]);
  }
  return { id: r.insertId, version: Number(last?.v || 0) + 1 };
}
async function usesProduct(db, businessId, productId, target, depth) {
  if (depth > 5) return false;
  const r = await recipeOf(db, businessId, productId);
  for (const l of r?.lines || []) {
    if (l.ingredient_id === target) return true;
    if (viaRecipe(l) && (await usesProduct(db, businessId, l.ingredient_id, target, depth + 1))) return true;
  }
  return false;
}

/*
 * What `qty` of a product uses: Map ingredientId → quantity in the ingredient's unit.
 * opts: { factor (size), removed: Set(lineId) (top level only), takeaway } — menu items inside go through their recipe.
 * Returns { needs, recipes: [{ productId, version }], hasRecipe }.
 */
export async function needsOf(db, businessId, productId, qty, opts = {}, acc = null, depth = 0) {
  const out = acc || { needs: new Map(), recipes: [], hasRecipe: false };
  const r = await recipeOf(db, businessId, productId);
  if (!r) return out;
  if (depth === 0) out.hasRecipe = true;
  out.recipes.push({ productId, version: r.version });
  const mult = (Number(qty) * (depth === 0 ? Number(opts.factor || 1) : 1)) / r.yieldQty;
  for (const l of r.lines) {
    if (depth === 0 && opts.removed?.has(l.id)) continue;
    if (l.service === "takeaway" && !opts.takeaway) continue;
    if (l.service === "dine_in" && opts.takeaway) continue;
    const per = convert(l.qty, l.unit, l.ingredient_unit);
    if (per === null) throw new HttpError(409, "unitMismatch", null, { product: productName({ name: l.ingredient_name }) });
    const need = per * mult;
    // a menu item / extra inside (combo, meal deal): its own recipe; without one it uses nothing
    if (viaRecipe(l)) {
      if (depth < 4) await needsOf(db, businessId, l.ingredient_id, need, { takeaway: opts.takeaway }, out, depth + 1);
      continue;
    }
    out.needs.set(l.ingredient_id, (out.needs.get(l.ingredient_id) || 0) + need);
  }
  return out;
}

/** Cost of a recipe at today's ingredient costs (per one unit of the item, before size / extras). */
export async function recipeCost(db, businessId, productId, opts = {}) {
  const { needs, hasRecipe } = await needsOf(db, businessId, productId, 1, opts);
  if (!hasRecipe) return null;
  if (!needs.size) return 0;
  const [rows] = await db.query("SELECT id, cost_price FROM products WHERE business_id = ? AND id IN (?)", [businessId, [...needs.keys()]]);
  return q4(rows.reduce((s, p) => s + num(p.cost_price) * needs.get(p.id), 0));
}

/*
 * Selling `qty` of a menu item / extra (plus its chosen extras): the ingredients leave stock now.
 * (Waste of a prepared dish uses the same path with type "waste" — routes/waste.js — so it is never mixed with sales.)
 * menu: { factor, removed: [lineId], extras: [{ id, name, price }], service } (from a food order; absent = plain sale)
 * Returns { unitCost, detail } to keep on the sale line, or null when the product is an ordinary stock item.
 */
export async function consumeForSale(conn, { businessId, userId, product, qty, menu = null, locationId, refType, refId, note, type = "consumption", reason = "recipe" }) {
  if (!viaRecipe(product)) return null;
  const takeaway = TAKEAWAY.has(menu?.service);
  const acc = await needsOf(conn, businessId, product.id, qty, { factor: menu?.factor || 1, removed: new Set(menu?.removed || []), takeaway });
  for (const x of menu?.extras || []) await needsOf(conn, businessId, x.id, qty, { takeaway }, acc, 1);
  const ids = [...acc.needs.keys()];
  const used = [];
  let total = 0;
  if (ids.length) {
    const products = await lockProducts(conn, businessId, ids);
    for (const id of ids) {
      const p = products.get(id);
      const need = q4(acc.needs.get(id));
      if (need <= 0) continue;
      const cost = q4(need * num(p.cost_price));
      total += cost;
      try {
        await moveStock(conn, { businessId, userId, product: p, qtyChange: -need, type, refType, refId, locationId, reason, note: note || productName(product), devices: true });
      } catch (err) {
        if (err.code === "insufficientStock") throw new HttpError(409, "ingredientShort", null, { ingredient: productName(p), dish: productName(product), available: err.extra?.available, needed: need, unit: p.unit });
        throw err;
      }
      used.push({ id, name: productName(p), qty: need, unit: p.unit, cost });
    }
  }
  const unitCost = acc.hasRecipe ? q4(total / Number(qty)) : num(product.cost_price);
  return { unitCost, detail: { recipes: acc.recipes, consumption: used, recipeCost: q4(total), ...(menu ? { menu: { size: menu.size || null, extras: menu.extras || [], removed: menu.removedNames || [], notes: menu.notes || null } } : {}) } };
}

/** A cancelled sale / invoice: what its dishes used comes back into stock (the movements are kept). */
export async function restoreConsumption(conn, { businessId, userId, detail, locationId, refType, refId, note }) {
  const used = detail?.consumption || [];
  if (!used.length) return;
  const products = await lockProducts(conn, businessId, used.map((u) => u.id));
  for (const u of used) {
    await moveStock(conn, { businessId, userId, product: products.get(u.id), qtyChange: q4(u.qty), type: "return_in", refType, refId, locationId, reason: "recipe", note, devices: true });
  }
}

/** Batch preparation: a prepared item made from its recipe goes into stock; its cost per unit is what the batch used. */
export async function produce(conn, { businessId, userId, product, qty, note }) {
  if (product.item_kind !== "prepared") throw badRequest({ productId: "notPrepared" });
  const acc = await needsOf(conn, businessId, product.id, qty);
  if (!acc.hasRecipe) throw conflict("noRecipe", { product: productName(product) });
  const ids = [...acc.needs.keys()];
  let total = 0;
  const products = ids.length ? await lockProducts(conn, businessId, ids) : new Map();
  for (const id of ids) {
    const p = products.get(id);
    const need = q4(acc.needs.get(id));
    total += need * num(p.cost_price);
    await moveStock(conn, { businessId, userId, product: p, qtyChange: -need, type: "consumption", refType: "production", reason: "production", note: note || `→ ${productName(product)}`, devices: true });
  }
  const unitCost = q4(total / qty);
  await conn.query("UPDATE products SET cost_price = ? WHERE id = ?", [unitCost, product.id]);
  product.cost_price = unitCost;
  const m = await moveStock(conn, { businessId, userId, product, qtyChange: q4(qty), type: "production", refType: "production", reason: "production", note, devices: true });
  return { movementId: m.id, unitCost, cost: q4(total) };
}
