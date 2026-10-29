/*
 * Business application modules shown as tiles on the dashboard.
 * `perm` hides the tile from roles that can't use it (the API enforces it too).
 * `profile` shows the tile only to business types whose profile has that feature (e.g. electronics: devices, warranties).
 */
export const MODULES = [
  { id: "overview",     icon: "chart-line",  color: "#f2712f", perm: null },
  { id: "pos",          icon: "cart",        color: "#2373f4", perm: "sales.create" },
  { id: "invoices",     icon: "receipt",     color: "#2c3494", perm: "invoices.view" },
  { id: "customers",    icon: "users",       color: "#1f9d61", perm: "customers.view" },
  { id: "suppliers",    icon: "store",       color: "#7c3aed", perm: "suppliers.view" },
  { id: "purchases",    icon: "truck",       color: "#f2712f", perm: "purchases.view" },
  { id: "products",     icon: "package",     color: "#d97706", perm: "products.view" },
  { id: "stock",        icon: "layers",      color: "#0f766e", perm: "stock.view" },
  { id: "devices",      icon: "smartphone",  color: "#2c3494", perm: "products.view", profile: "serials" },
  { id: "warranties",   icon: "shield-check", color: "#1f9d61", perm: "sales.view", profile: "warranties" },
  { id: "expenses",     icon: "wallet",      color: "#dc2626", perm: "expenses.view" },
  { id: "cashbook",     icon: "book-open",   color: "#2373f4", perm: "cash.view" },
  { id: "reports",      icon: "file-chart",  color: "#0f9488", perm: "reports.view" },
  { id: "staff",        icon: "user-key",    color: "#475569", perm: "staff.manage" },
  { id: "business",     icon: "briefcase",   color: "#2c3494", perm: null },
  { id: "profile",      icon: "user",        color: "#f2712f", perm: null },
  { id: "subscription", icon: "credit-card", color: "#7c3aed", perm: null },
  { id: "settings",     icon: "settings",    color: "#475569", perm: null },
  { id: "audit",        icon: "activity",    color: "#0f9488", perm: "audit.view" }
];

export const QUICK_ACTIONS = [
  { key: "newSale",        to: "/app/m/pos",        icon: "cart",    tone: "orange", perm: "sales.create" },
  { key: "newInvoice",     to: "/app/invoices/new", icon: "receipt", tone: "blue",   perm: "invoices.create" },
  { key: "addProduct",     to: "/app/m/products",   icon: "package", tone: "navy",   perm: "products.edit" },
  { key: "addStock",       to: "/app/m/stock?tab=add", icon: "layers", tone: "green", perm: "stock.add" },
  { key: "recordPurchase", to: "/app/m/purchases",  icon: "truck",   tone: "green",  perm: "purchases.create" },
  { key: "addExpense",     to: "/app/m/expenses",   icon: "wallet",  tone: "red",    perm: "expenses.create" }
];

export const moduleById = (id) => MODULES.find((m) => m.id === id);
