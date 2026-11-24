/*
 * Business application modules shown as tiles on the dashboard.
 * `perm` hides the tile from roles that can't use it (the API enforces it too).
 * `profile` shows the tile only to business types whose profile has that feature (e.g. electronics: devices, warranties).
 */
export const MODULES = [
  { id: "overview",     icon: "chart-line",  color: "#f2712f", perm: null },
  { id: "accounting",   icon: "landmark",    color: "#0f766e", perm: "accounting.view" },
  { id: "pos",          icon: "cart",        color: "#2373f4", perm: "sales.create" },
  { id: "invoices",     icon: "receipt",     color: "#2c3494", perm: "invoices.view" },
  { id: "customers",    icon: "users",       color: "#1f9d61", perm: "customers.view" },
  { id: "suppliers",    icon: "store",       color: "#7c3aed", perm: "suppliers.view" },
  { id: "purchases",    icon: "truck",       color: "#f2712f", perm: "purchases.view" },
  { id: "products",     icon: "package",     color: "#d97706", perm: "products.view" },
  { id: "stock",        icon: "layers",      color: "#0f766e", perm: "stock.view" },
  { id: "devices",      icon: "smartphone",  color: "#2c3494", perm: "products.view", profile: "serials" },
  { id: "warranties",   icon: "shield-check", color: "#1f9d61", perm: "sales.view", profile: "warranties" },
  { id: "metalRates",   icon: "chart-line",  color: "#d4a017", perm: "products.view", profile: "jewelry" },
  { id: "usedGold",     icon: "gem",         color: "#b8860b", perm: "purchases.view", profile: "jewelry" },
  { id: "rolls",        icon: "roll",        color: "#0f766e", perm: "stock.view", profile: "fabric" },
  { id: "menu",         icon: "utensils",    color: "#d97706", perm: "products.view", profile: "food" },
  { id: "tables",       icon: "grid",        color: "#2373f4", perm: "sales.create", profile: "food" },
  { id: "kitchen",      icon: "flame",       color: "#dc2626", perm: "kitchen.view", profile: "food" },
  { id: "waste",        icon: "trash",       color: "#b42318", perm: ["stock.adjust", "kitchen.update", "stock.add"], profile: "food" },
  { id: "tailoring",    icon: "scissors",    color: "#be185d", perm: "sales.view", profile: "fabric" },
  { id: "promotions",   icon: "percent",     color: "#be185d", perm: "promotions.manage" },
  { id: "shifts",       icon: "clock",       color: "#0f766e", perm: "sales.create" },
  { id: "expenses",     icon: "wallet",      color: "#dc2626", perm: "expenses.view" },
  { id: "cashbook",     icon: "book-open",   color: "#2373f4", perm: "cash.view" },
  { id: "reports",      icon: "file-chart",  color: "#0f9488", perm: "reports.view" },
  { id: "pdfReports",   icon: "printer",     color: "#2c3494", perm: ["reports.view", "customers.view", "suppliers.view", "products.view", "sales.view", "accounting.view"] },
  { id: "hr",           icon: "users",       color: "#0f766e", perm: ["hr.view", "hr.payroll"] },
  { id: "branches",     icon: "store",       color: "#d97706", perm: ["settings.edit", "staff.manage"] },
  { id: "staff",        icon: "user-key",    color: "#475569", perm: "staff.manage" },
  { id: "business",     icon: "briefcase",   color: "#2c3494", perm: null },
  { id: "profile",      icon: "user",        color: "#f2712f", perm: null },
  { id: "support",      icon: "message",     color: "#2373f4", perm: null },
  { id: "settings",     icon: "settings",    color: "#475569", perm: null },
  { id: "audit",        icon: "activity",    color: "#0f9488", perm: "audit.view" }
];

export const QUICK_ACTIONS = [
  { key: "newSale",        to: "/app/m/pos",        icon: "cart",    tone: "orange", perm: "sales.create" },
  { key: "newInvoice",     to: "/app/invoices/new", icon: "receipt", tone: "blue",   perm: "invoices.create", module: "invoices" },
  { key: "addProduct",     to: "/app/m/products",   icon: "package", tone: "navy",   perm: "products.edit" },
  { key: "addStock",       to: "/app/m/stock?tab=add", icon: "layers", tone: "green", perm: "stock.add" },
  { key: "recordPurchase", to: "/app/m/purchases",  icon: "truck",   tone: "green",  perm: "purchases.create", module: "purchases" },
  { key: "addExpense",     to: "/app/m/expenses",   icon: "wallet",  tone: "red",    perm: "expenses.create", module: "expenses" }
];

export const moduleById = (id) => MODULES.find((m) => m.id === id);

/*
 * Two dashboard buttons combine related modules (money in / out, and running the business); each opens a page with
 * its modules (/app/g/<group>). Every other module keeps its own button on the dashboard.
 */
export const GROUPS = [
  { id: "money", icon: "wallet", color: "#dc2626", modules: ["accounting", "overview", "expenses", "cashbook", "reports", "pdfReports"],
    // the group's page shows its modules in these sections, as simple links
    sections: [{ id: "books", modules: ["accounting"] }, { id: "moneyFlow", modules: ["expenses", "cashbook"] }, { id: "insight", modules: ["overview", "reports", "pdfReports"] }] },
  { id: "business", icon: "briefcase", color: "#2c3494", modules: ["business", "branches", "staff", "hr", "settings", "audit", "profile", "support"],
    sections: [{ id: "company", modules: ["business", "branches", "settings"] }, { id: "people", modules: ["staff", "hr", "profile"] }, { id: "help", modules: ["audit", "support"] }] }
];
export const groupOf = (moduleId) => GROUPS.find((g) => g.modules.includes(moduleId))?.id || null;
