/*
 * Permissions (enforced on the server for every protected route).
 *
 * The owner always has every permission. Every other staff member gets the permissions
 * of their business role. Roles are created by the owner (Staff & roles → Roles) and stored
 * in the `roles` table; new businesses start with Manager, Cashier and Stockkeeper.
 *
 * OWNER_ONLY permissions can never be given to a role, so no staff member can raise
 * their own access (manage staff and roles, edit the business, change settings).
 */

/* Catalog: every permission, grouped by the module it belongs to. The first permission
 * of each group is the one that opens the module ("can see it"). */
export const PERMISSION_GROUPS = [
  { module: "overview", perms: ["dashboard.finance"] },
  { module: "pos", perms: ["sales.create", "sales.view", "sales.discount", "sales.cancel"] },
  { module: "invoices", perms: ["invoices.view", "invoices.create", "invoices.cancel", "payments.receive"] },
  { module: "products", perms: ["products.view", "products.edit"] },
  { module: "stock", perms: ["stock.view", "stock.add", "stock.adjust", "stock.transfer", "stock.locations"] },
  { module: "customers", perms: ["customers.view", "customers.edit"] },
  { module: "suppliers", perms: ["suppliers.view", "suppliers.edit"] },
  { module: "purchases", perms: ["purchases.view", "purchases.create", "purchases.pay", "purchases.cancel"] },
  { module: "expenses", perms: ["expenses.view", "expenses.create", "expenses.delete"] },
  { module: "cashbook", perms: ["cash.view", "cash.edit"] },
  { module: "reports", perms: ["reports.view"] },
  { module: "audit", perms: ["audit.view"] }
];

export const OWNER_ONLY = ["staff.manage", "business.edit", "settings.edit"];
export const ROLE_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.perms);   // what a role may hold
export const ALL_PERMISSIONS = [...ROLE_PERMISSIONS, ...OWNER_ONLY];

/* An action needs the module's "see" permission too (e.g. products.edit → products.view). */
const BASE = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.perms.slice(1).map((p) => [p, g.perms[0]])));
// POS: viewing history doesn't need to sell, but cancelling / discounting does.
BASE["sales.view"] = undefined;

/** Cleans a role's permission list: known keys only, never owner-only, plus required base permissions. */
export function normalizePermissions(list) {
  const set = new Set((Array.isArray(list) ? list : []).filter((p) => ROLE_PERMISSIONS.includes(p)));
  for (const p of [...set]) if (BASE[p]) set.add(BASE[p]);
  return ROLE_PERMISSIONS.filter((p) => set.has(p));
}

/* Starting roles for every business (the owner can edit or delete them). */
const OM = ["owner", "manager"];
const LEGACY = {
  "dashboard.finance": OM,
  "sales.create": ["manager", "cashier"], "sales.view": ["manager", "cashier"], "sales.discount": OM, "sales.cancel": OM,
  "invoices.view": ["manager", "cashier"], "invoices.create": ["manager", "cashier"], "invoices.cancel": OM, "payments.receive": ["manager", "cashier"],
  "products.view": ["manager", "cashier", "stockkeeper"], "products.edit": ["manager", "stockkeeper"],
  "stock.view": ["manager", "stockkeeper"], "stock.add": ["manager", "stockkeeper"], "stock.adjust": OM, "stock.transfer": OM, "stock.locations": OM,
  "customers.view": ["manager", "cashier"], "customers.edit": ["manager", "cashier"],
  "suppliers.view": ["manager", "stockkeeper"], "suppliers.edit": ["manager", "stockkeeper"],
  "purchases.view": ["manager", "stockkeeper"], "purchases.create": ["manager", "stockkeeper"], "purchases.pay": OM, "purchases.cancel": OM,
  "expenses.view": OM, "expenses.create": OM, "expenses.delete": [],
  "cash.view": OM, "cash.edit": OM, "reports.view": OM, "audit.view": OM
};
export const DEFAULT_ROLES = [
  { key: "manager", name: "Manager", description: "Everything except staff and business settings" },
  { key: "cashier", name: "Cashier", description: "POS, invoices, customers, payments" },
  { key: "stockkeeper", name: "Stockkeeper", description: "Products, suppliers, purchases" }
].map((r) => ({ ...r, permissions: ROLE_PERMISSIONS.filter((p) => LEGACY[p]?.includes(r.key)) }));

/**
 * can(subject, perm): subject is req.user ({ role, permissions }) or a role name.
 * "owner" can do everything; other users use the permissions loaded from their role.
 */
export function can(subject, perm) {
  if (!subject) return false;
  if (typeof subject === "string") {
    if (subject === "owner") return true;
    return Boolean(DEFAULT_ROLES.find((r) => r.key === subject)?.permissions.includes(perm));
  }
  if (subject.role === "owner") return true;
  return Array.isArray(subject.permissions) && subject.permissions.includes(perm);
}

export const permissionsFor = (subject) => ALL_PERMISSIONS.filter((p) => can(subject, p));

/** Express middleware: allow only users holding the permission. */
export const requirePerm = (perm) => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ code: "forbidden" });
