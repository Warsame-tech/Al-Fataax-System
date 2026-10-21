/*
 * Role-based permissions (enforced on the server for every protected route).
 * Roles: owner, manager, cashier, stockkeeper.
 */
const ALL = ["owner", "manager", "cashier", "stockkeeper"];
const OM = ["owner", "manager"];

export const PERMISSIONS = {
  "dashboard.finance": OM,                       // money figures on the dashboard
  "sales.create": ["owner", "manager", "cashier"],
  "sales.view": ["owner", "manager", "cashier"],
  "sales.discount": OM,                          // discounts and custom prices
  "sales.cancel": OM,                            // cancellations / refunds
  "invoices.view": ["owner", "manager", "cashier"],
  "invoices.create": ["owner", "manager", "cashier"],
  "invoices.cancel": OM,
  "payments.receive": ["owner", "manager", "cashier"],
  "products.view": ALL,
  "products.edit": ["owner", "manager", "stockkeeper"],
  "stock.adjust": OM,
  "customers.view": ["owner", "manager", "cashier"],
  "customers.edit": ["owner", "manager", "cashier"],
  "suppliers.view": ["owner", "manager", "stockkeeper"],
  "suppliers.edit": ["owner", "manager", "stockkeeper"],
  "purchases.view": ["owner", "manager", "stockkeeper"],
  "purchases.create": ["owner", "manager", "stockkeeper"],
  "purchases.pay": OM,
  "purchases.cancel": OM,
  "expenses.view": OM,
  "expenses.create": OM,
  "expenses.delete": ["owner"],
  "cash.view": OM,
  "cash.edit": OM,
  "reports.view": OM,
  "audit.view": OM,
  "staff.manage": ["owner"],
  "business.edit": ["owner"],
  "settings.edit": ["owner"]
};

export const can = (role, perm) => Boolean(PERMISSIONS[perm]?.includes(role));
export const permissionsFor = (role) => Object.keys(PERMISSIONS).filter((p) => can(role, p));

/** Express middleware: allow only roles holding the permission. */
export const requirePerm = (perm) => (req, res, next) =>
  can(req.user?.role, perm) ? next() : res.status(403).json({ code: "forbidden" });
