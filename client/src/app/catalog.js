import { useApi } from "./ui.jsx";
import { useProfile } from "./profile.js";

/*
 * Product lists for dropdowns: the ready-made values of the business type (profile.categories, sizeSystems,
 * colors) merged with the business's own (Products → Product lists, GET /api/catalog).
 *
 *   const cat = useCatalog();
 *   cat.categories                  ["Men's Clothing", …]
 *   cat.subcategoriesOf(category)   ["Shirts", …]
 *   cat.brands, cat.collections, cat.seasons, cat.units (extra units)
 *   cat.colors                      [{ name, code }]
 *   cat.sizeSystems                 { "Letter (XXS–4XL)": ["XXS", …], …custom systems }
 *   cat.systemFor(category)         size system a category uses (clothing)
 */
const uniq = (list) => [...new Set(list.filter((x) => x && String(x).trim()))];

export function useCatalog() {
  const profile = useProfile();
  const api = useApi("/api/catalog");
  const d = api.data || { categories: [], brands: [], options: {} };
  const own = (kind) => d.options?.[kind] || [];
  const builtIn = profile.categories || {};

  const sizeSystems = { ...(profile.sizeSystems || {}) };
  for (const s of own("size")) sizeSystems[s.parent] = uniq([...(sizeSystems[s.parent] || []), s.name]);

  return {
    loading: api.loading && !api.data,
    reload: api.reload,
    raw: d,
    categories: uniq([...Object.keys(builtIn), ...d.categories.map((c) => c.name)]),
    subcategoriesOf: (category) => uniq([...(builtIn[category] || []), ...own("subcategory").filter((s) => s.parent === category).map((s) => s.name)]),
    brands: uniq(d.brands.map((b) => b.name)),
    collections: uniq(own("collection").map((x) => x.name)),
    seasons: uniq([...(profile.fashion ? ["All seasons", "Summer", "Winter", "Rainy season", "Ramadan / Eid", "School season"] : []), ...own("season").map((x) => x.name)]),
    units: uniq(own("unit").map((x) => x.name)),
    colors: [
      ...(profile.colors || []).map(([name, code]) => ({ name, code })),
      ...own("color").filter((c) => !(profile.colors || []).some(([n]) => n === c.name)).map((c) => ({ name: c.name, code: c.code }))
    ],
    sizeSystems,
    systemFor: (category) => profile.categorySizes?.[category] || Object.keys(sizeSystems)[0] || ""
  };
}

/** SearchSelect options from a list of names. */
export const asOptions = (list) => list.map((x) => ({ value: x, label: x }));
