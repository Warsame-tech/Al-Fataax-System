/* Business slugs: the subdomain / link name of a business (prodima → prodima.faatix.com, /b/prodima). */
import { RESERVED_SLUGS, SLUG } from "./tenancy.js";

export function slugify(name) {
  const s = String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "");
  return s.length >= 3 ? s : `biz-${s || "x"}`.slice(0, 30);
}
export const slugProblem = (s) => (!SLUG.test(s) ? "invalidSlug" : RESERVED_SLUGS.has(s) ? "slugReserved" : null);

/** The slug, or slug-2, slug-3 … when it is taken by another business (or reserved). */
export async function freeSlug(db, base, exceptId = 0) {
  let candidate = base;
  for (let i = 2; i < 500; i++) {
    if (!slugProblem(candidate)) {
      const [[t]] = await db.query("SELECT id FROM businesses WHERE slug = ? AND id <> ?", [candidate, exceptId || 0]);
      if (!t) return candidate;
    }
    candidate = `${base.slice(0, 36)}-${i}`;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}
