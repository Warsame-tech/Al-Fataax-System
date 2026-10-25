/*
 * Business application + Super Admin strings (merged into translations.js under "ui").
 * Use {name}-style placeholders with fill() from app/format.js.
 */
const en = {
  common: {
    save: "Save", saving: "Saving…", cancel: "Cancel", close: "Close", edit: "Edit", add: "Add", delete: "Delete", view: "View",
    search: "Search", searchPh: "Search…", all: "All", actions: "Actions", confirm: "Confirm", back: "Back", print: "Print / PDF",
    exportCsv: "Export Excel (CSV)", from: "From", to: "To", apply: "Apply", total: "Total", subtotal: "Subtotal", discount: "Discount",
    paid: "Paid", balance: "Balance", amount: "Amount", date: "Date", status: "Status", notes: "Notes", name: "Name", phone: "Phone",
    email: "Email", address: "Address", description: "Description", category: "Category", method: "Payment method", reference: "Reference",
    qty: "Qty", price: "Price", unitPrice: "Unit price", unitCost: "Unit cost", items: "Items", item: "Item", product: "Product",
    customer: "Customer", supplier: "Supplier", user: "User", role: "Role", loading: "Loading…", noResults: "Nothing found.",
    saved: "Saved.", optional: "(optional)", reason: "Reason", reasonPh: "Why is this needed?", remove: "Remove", more: "More",
    choose: "Choose…", bankAccount: "Bank account", noBank: "Add a bank account in Cash & bank first.", yes: "Yes", no: "No",
    sample: "SAMPLE"
  },
  errors: {
    required: "This field is required.", invalidAmount: "Enter a valid amount.", invalidEmail: "Enter a valid email address.",
    invalidPhone: "Enter a valid phone number.", duplicate: "This value is already used by another product.",
    forbidden: "You don't have permission for this.", exceedsBalance: "The amount is more than what is owed.",
    notEnough: "Amount received is less than the total.", tooLarge: "The discount is larger than the total.",
    requiredForCredit: "Choose a customer for credit sales.", beforeIssue: "Due date can't be before the issue date.",
    future: "Date can't be in the future.", sameAccount: "Choose two different accounts.", wrongPassword: "Current password is wrong.",
    weakPassword: "Use at least 8 characters with letters and numbers.", invalidUsername: "Use 3–30 letters, numbers, dot or underscore.",
    usernameTaken: "This username is already taken.", insufficientStock: "{product}: only {available} in stock.",
    alreadyCancelled: "This was already cancelled.", hasPayments: "This has payments and can't be cancelled.",
    notPayable: "This can't receive payments.", invalidLogo: "Logo must be PNG, JPG or WEBP.", logoTooLarge: "Logo must be 2 MB or smaller.",
    invalidImage: "Photo must be PNG, JPG or WEBP.", changeNeedsCash: "Change can only be given from a cash payment.",
    openingExists: "{product} already has opening stock at {location}. Reverse it in Movements to enter it again.",
    stockChanged: "The stock changed while you were reviewing. Check the new numbers and confirm again.",
    locationHasStock: "This location still holds stock. Transfer it to another location first.",
    defaultLocationActive: "The default location can't be switched off. Make another location the default first.",
    notReversible: "This movement can't be reversed here. Sales, invoices and purchases are corrected in their own modules.",
    alreadyReversed: "This movement was already reversed.", locationNameTaken: "Another location already has this name.",
    barcodeTaken: "This barcode already belongs to {product}.", sameLocation: "Choose two different locations.",
    noChange: "The counted quantity equals the recorded stock — nothing to adjust.", inactiveProduct: "An inactive product can't receive stock.", imageTooLarge: "Photo must be 2 MB or smaller.",
    importErrors: "Some rows have errors. Fix them and try again.", serverOffline: "Cannot reach the server.", failed: "Something went wrong. Please try again.",
    validation: "Please check the highlighted fields.", notFound: "Not found.", mismatch: "Passwords don't match."
  },
  methods: { cash: "Cash", mobile_money: "Mobile money", bank: "Bank", credit: "Credit (pay later)" },
  status: {
    completed: "Completed", cancelled: "Cancelled", unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid", overdue: "Overdue",
    received: "Received", active: "Active", disabled: "Disabled", suspended: "Suspended", deactivated: "Deactivated", draft: "Draft",
    returned: "Returned", expired: "Expired", converted: "Converted"
  },
  products: {
    title: "Products & inventory", add: "Add product", edit: "Edit product", sku: "SKU", barcode: "Barcode", brand: "Brand", unit: "Unit",
    costPrice: "Cost price", sellingPrice: "Retail price", wholesalePrice: "Wholesale price", minStock: "Minimum stock", openingStock: "Opening stock",
    stock: "Stock", active: "Active", inactive: "Inactive", showInactive: "Show inactive", lowOnly: "Low stock only", adjust: "Adjust stock",
    adjustHelp: "Use a positive number to add stock and a negative number to remove it (for example −3 for damaged items).",
    qtyChange: "Quantity change", history: "Stock history", import: "Import CSV",
    importHelp: "CSV columns: name, sku, barcode, category, unit, costPrice, sellingPrice, wholesalePrice, minStock, openingStock",
    importDone: "{n} products imported.",
    searchPh: "Search name, SKU or barcode", allBrands: "All brands", allCategories: "All categories", allSubcategories: "All subcategories",
    anyLocation: "Any location", stockAt: "In stock at {location}", allSuppliers: "All suppliers", resetFilters: "Reset filters ({n})",
    alertAt: "alert at {n}", subcategory: "Subcategory", barcodePh: "Scan or type the barcode", openExisting: "Open this product",
    barcodeExistsHelp: "No new product is created. Open the existing one or add stock to it.",
    lowStockAlert: "Low Stock Alert Level", lowStockAlertHint: "Alert when stock reaches or falls below this number.",
    stockSeparate: "Stock is entered separately: after saving, use Stock → Opening stock or Add stock.",
    units: { pcs: "pcs", bottle: "bottle", box: "box", pack: "pack", carton: "carton", kg: "kg", g: "g", liter: "liter", ml: "ml", meter: "meter", yard: "yard", roll: "roll", pair: "pair", dozen: "dozen" },
    image: "Product photo", imageChoose: "Choose photo", imageChange: "Change photo", imageRemove: "Remove photo", imageHint: "PNG, JPG or WEBP, up to 2 MB", empty: "No products yet. Add your first product to start selling.",
    moveTypes: { opening: "Opening stock", purchase: "Purchase", sale: "POS sale", invoice: "Invoice", adjustment: "Adjustment", return_in: "Returned in", return_out: "Returned out", purchase_return: "Purchase cancelled" }
  },
  parties: {
    customers: "Customers", suppliers: "Suppliers", addCustomer: "Add customer", addSupplier: "Add supplier", editCustomer: "Edit customer",
    editSupplier: "Edit supplier", owesYou: "Owes you", youOwe: "You owe", overdue: "Overdue", statement: "Account statement",
    receivePayment: "Receive payment", paySupplier: "Pay supplier", debit: "Charged", credit: "Paid", runningBalance: "Balance",
    kinds: { invoice: "Invoice", sale: "Credit sale", purchase: "Purchase", payment: "Payment" },
    emptyCustomers: "No customers yet.", emptySuppliers: "No suppliers yet.",
    paymentHelp: "The payment is applied to the oldest unpaid documents first."
  },
  pos: {
    title: "Point of sale", search: "Search product or scan barcode…", cart: "Cart", emptyCart: "Add products by searching or scanning.",
    walkIn: "Walk-in customer", received: "Amount received", change: "Change", creditPaid: "Paid now (optional)", paidWith: "Paid now with",
    charge: "Complete sale · {amount}", newSale: "New sale", receipt: "Receipt", history: "Sales history", cancelSale: "Cancel & refund",
    cancelHelp: "Stock will be returned and the money received will be refunded. This is recorded in the activity log.",
    inStock: "{qty} in stock", outOfStock: "Out of stock", cashier: "Cashier", receiptNo: "Receipt no.", thankYou: "Thank you for shopping with us!",
    done: "Sale completed", notFound: "No product with this barcode.", noDiscount: "Only owners and managers can give discounts.",
    scan: "Scan barcode", scanTitle: "Scan with camera", scanHelp: "Hold the item's barcode in front of the camera.",
    scanNoCamera: "The camera can't be opened. Allow camera access, or use a barcode scanner or type the code.",
    scanned: "Scanned item", added: "Added to cart", inCart: "In cart: {qty}", addAnother: "Add another",
    scanEmpty: "Scan or pick a product to see its photo, price and details here.", noPhoto: "No photo",
    clearItem: "Clear highlighted item", payment: "Payment", unitsAt: "{qty} unit(s) at {price}", qtyLabel: "QTY: {qty}",
    payTitle: "Payment", addMethod: "Click to add a payment method:", applied: "Applied payments", noApplied: "No payments added yet. Click a payment method on the left.",
    totalDue: "Total due", totalPaid: "Total paid", remaining: "Remaining", changeDue: "Change to give", confirm: "Confirm order",
    restOnCredit: "The rest stays on credit — {name} pays later.", needCustomer: "Choose a customer above to leave the rest on credit.",
    discountLocked: "Only owners and managers can give discounts.", exact: "Exact", walkInDefault: "Walk-in customer (default)", outRibbon: "Out of stock",
    codePh: "Scan or type barcode, then Enter", filterPh: "Search products…", newProduct: "New product", itemsCount: "{n} items",
    discPercent: "Discount in percent — click to switch to an amount", discAmount: "Discount as an amount — click to switch to percent", locked: "Locked",
    scanCamera: "Camera", scanAuto: "Automatic (back camera)", scanManual: "Or type the barcode number",
    scanTips: "Good light, hold the barcode flat and still across the orange box, about 10–20 cm from the camera. Laptop webcams are often blurry up close — a USB barcode scanner or a phone works best.",
    noMethods: "No payment methods are switched on. The owner can add them in Settings → Payment methods."
  },
  stock: {
    title: "Stock management",
    tabs: { current: "Current stock", add: "Add stock", opening: "Opening stock", adjust: "Adjust", transfer: "Transfer", movements: "Movements", low: "Low stock", valuation: "Valuation", reports: "Reports", locations: "Locations" },
    types: { opening: "Opening stock", purchase: "Purchase received", stock_in: "Other stock in", return_in: "Customer return", sale: "POS sale", invoice: "Invoice",
      return_out: "Returned out", purchase_return: "Supplier return", transfer_out: "Transfer out", transfer_in: "Transfer in", damaged: "Damaged stock",
      adjustment: "Stock adjustment", count: "Physical count correction", reversal: "Reversal" },
    reasons: { damaged: "Damaged", expired: "Expired", lost: "Lost / stolen", found: "Found", correction: "Count correction", other: "Other", opening: "Opening stock",
      purchase: "Purchase received", return_in: "Customer return", stock_in: "Other stock in", transfer: "Transfer" },
    status: { in: "In stock", low: "Low stock", out: "Out of stock", negative: "Negative stock" },
    alertFrom: { product: "product level", location: "location level" },
    kinds: { shop: "Shop", warehouse: "Warehouse", other: "Other" },
    location: "Location", allLocations: "All locations", default: "default", defaultLocation: "Default location", allStatuses: "All stock statuses", allTypes: "All movement types",
    stockStatus: "Stock status", current: "Current stock", available: "Available", alertLevel: "Low Stock Alert Level", lastMovement: "Last movement",
    searchPh: "Search name, SKU or barcode", searchMovesPh: "Product, SKU, barcode or reference", adjust: "Adjust", setAlert: "Alert level at this location",
    alertHelp: "Set a low-stock level just for {location}, or leave it empty to use the product's Low Stock Alert Level.", alertEmpty: "Empty = use the product's level",
    availableNote: "Available = current stock (Faatix doesn't reserve stock for unpaid orders).",
    results: "{n} results", pageOf: "Page {page} of {pages} · {n} results",
    pickerPh: "Scan, or type a name, SKU or barcode — then Enter", scanProducts: "Scan or pick the products",
    scanNoAdd: "Scanning only selects a product — type the quantity for each line.", noLines: "No products yet. Scan or search above.",
    transactionType: "Transaction type", reference: "Reference", referencePh: "e.g. GRN-0012, delivery note no.", totalNow: "Total now: {qty} {unit}",
    purchaseNote: "This only adds stock. To record what you owe a supplier, use Purchases.",
    linesSummary: "{n} products · {units} units", reviewSave: "Review & save", confirm: "Confirm", confirmAdd: "Confirm stock in",
    confirmAddHelp: "{type} at {location}:", addDone: "Saved: {n} products added to {location}.",
    openingHelp: "Opening stock is the quantity you already have when you start using Faatix. It is entered once per product and location.",
    openingQty: "Opening quantity", openingExistsHere: "This product already has opening stock at {location}.", confirmOpening: "Confirm opening stock",
    openingDone: "Opening stock saved: {name} now has {qty} at {location}.",
    method: "Method", modeAdjust: "Adjust quantity", modeCount: "Set verified quantity", adjustType: "Add or subtract", add: "Add", subtract: "Subtract",
    adjustQty: "Quantity", countedQty: "Physically counted quantity", countHint: "Enter what you counted; the difference is calculated for you.",
    previous: "Previous stock", change: "Change", newStock: "New stock", valueEffect: "Value effect (cost)", wouldBeNegative: "Stock can't go below zero.",
    reviewAdjust: "Review adjustment", confirmAdjust: "Confirm stock adjustment", stockChanged: "The stock changed meanwhile — the numbers are updated, check and confirm again.",
    adjustDone: "Saved: {name} {before} → {after} {unit}.",
    fromLocation: "From location", toLocation: "To location", availableAt: "{qty} {unit} at {location}", reviewTransfer: "Review transfer", confirmTransfer: "Confirm transfer",
    transferDone: "Transferred {n} products from {from} to {to} ({ref}).", needTwoLocations: "Add a second location (Locations tab) to transfer stock between them.",
    movementType: "Movement type", beforeAfter: "Before → after", value: "Value", reasonRef: "Reason · reference", reverse: "Reverse", reversed: "Reversed",
    reversalOf: "reverses #{id}", reverseHelp: "A correcting movement is added; the original stays in the history.",
    reverseTransferHelp: "Both lines of this transfer are reversed: the stock goes back to where it came from.",
    noLow: "No product is at or below its alert level.", lowHelp: "A product appears here when its stock reaches its Low Stock Alert Level (or a location's own level).",
    costValue: "Stock value (cost)", retailValue: "Retail value", units: "Units on hand", unitsShort: "{n} units",
    valuationNote: "Valued at each product's current cost price.", moreReports: "All reports", byType: "Movements by type", moves: "Moves", qtyIn: "In", qtyOut: "Out",
    losses: "Biggest losses (damaged, adjustments, counts)", noLosses: "No losses in this period.",
    locationsHelp: "Shops and warehouses where you keep stock. Sales, invoices and purchases use the default location.",
    newLocation: "New location", editLocation: "Edit location", kind: "Type", locationNamePh: "e.g. Bakara warehouse", makeDefault: "Make this the default location",
    locationActive: "Active", defaultHelp: "The default location is where POS sales, invoices and purchases take and put stock.",
    locationSummary: "{products} products · {units} units"
  },
  receipt: {
    paper: "Paper width", receipt: "Receipt", servedBy: "Served by", item: "Item", items: "Items", totalDiscount: "Total discount", payments: "Payments",
    tendered: "Cash given", amountPaid: "Amount paid", balanceDue: "Balance due", refund: "Refund", thanks: "Thank you for your business! Please visit again.",
    verify: "Verification"
  },
  payMethods: {
    title: "Payment methods", help: "These appear on the POS payment screen. Add the wallets and banks your business uses, and switch off the ones you don't.",
    add: "Add payment method", edit: "Edit payment method", name: "Name", number: "Number (optional)", numberHint: "Shown in brackets, e.g. E-Dahab (136227).",
    kind: "Type", kindHint: "Cash payments can give change. Each method gets its own balance in Cash & bank.", kindLocked: "The type can't be changed after the method is created.",
    kinds: { cash: "Cash", mobile_money: "Mobile money", bank: "Bank" }, showOnPos: "Show on the payment screen",
    on: "On", off: "Off", up: "Move up", down: "Move down", preview: "Shows on the payment screen as"
  },
  invoices: {
    title: "Sales invoices", new: "New invoice", priceList: "Price list", retail: "Retail prices", wholesale: "Wholesale prices",
    issueDate: "Issue date", dueDate: "Due date", addItem: "Add product", payNow: "Payment received now (optional)", create: "Create invoice",
    recordPayment: "Record payment", cancelInvoice: "Cancel invoice",
    cancelHelp: "Only invoices without payments can be cancelled. Stock will be returned.", empty: "No invoices in this period."
  },
  purchases: {
    title: "Purchases", new: "Record purchase", create: "Save purchase", payNow: "Paid now (optional)", pay: "Pay supplier",
    cancel: "Cancel purchase", cancelHelp: "Only unpaid purchases can be cancelled. The stock will be removed again.",
    empty: "No purchases in this period.", note: "Stock is added immediately and each product's cost price is updated to this purchase cost."
  },
  money: {
    expenses: "Expenses", income: "Other income", addExpense: "Add expense", addIncome: "Add income", byCategory: "By category",
    empty: "Nothing recorded in this period.", deleteConfirm: "Delete this entry? The money movement will be reversed.",
    categories: { rent: "Rent", salaries: "Salaries", electricity: "Electricity", internet: "Internet", transport: "Transport", repairs: "Repairs", marketing: "Marketing", water: "Water", taxes: "Taxes & fees", other: "Other" },
    incomeCategories: { service: "Service income", commission: "Commission", rental: "Rental income", interest: "Interest", other: "Other" }
  },
  cash: {
    title: "Cash & bank", cashAccounts: "Cash accounts", bankAccounts: "Bank accounts", addBank: "Add bank account", bankName: "Bank name",
    accountName: "Account name", accountNumber: "Account number", entry: "Deposit / withdraw", direction: "Type", in: "Money in", out: "Money out",
    transfer: "Transfer", fromAcc: "From account", toAcc: "To account", transactions: "Transactions", account: "Account", empty: "No transactions in this period.",
    totalBalance: "Total balance",
    types: { customer_payment: "Customer payment", supplier_payment: "Supplier payment", expense: "Expense", other_income: "Other income", transfer: "Transfer", adjustment: "Deposit / withdrawal", refund: "Refund" }
  },
  reports: {
    title: "Reports", choose: "Report",
    types: { sales: "Sales", profit: "Profit", inventory: "Inventory value", lowStock: "Low stock", receivables: "Customer receivables", payables: "Supplier payables", purchases: "Purchases", expenses: "Expenses", cashflow: "Cash flow", bestSellers: "Best-selling products" },
    cols: { date: "Date", count: "Documents", discount: "Discounts", total: "Total", label: "Item", amount: "Amount", name: "Name", sku: "SKU", category: "Category", stock: "Stock", costValue: "Value at cost", retailValue: "Value at retail", minStock: "Minimum", status: "Status", phone: "Phone", nextDue: "Next due", overdue: "Overdue", balance: "Balance", number: "Number", supplier: "Supplier", paid: "Paid", moneyIn: "Money in", moneyOut: "Money out", net: "Net", qty: "Qty sold", revenue: "Revenue", profit: "Profit" },
    lines: { grossSales: "Gross sales", discounts: "Discounts", netSales: "Net sales", cogs: "Cost of goods sold", grossProfit: "Gross profit", expenses: "Expenses", otherIncome: "Other income", netProfit: "Net profit" },
    summary: { salesTotal: "Sales total", documents: "Documents", received: "Money received", netSales: "Net sales", grossProfit: "Gross profit", netProfit: "Net profit", margin: "Gross margin %", products: "Products", costValue: "Value at cost", retailValue: "Value at retail", outOfStock: "Out of stock", lowStock: "Low or out of stock", customers: "Customers", total: "Total", overdue: "Overdue", suppliers: "Suppliers", paid: "Paid", expenses: "Expenses", otherIncome: "Other income", opening: "Opening balance", moneyIn: "Money in", moneyOut: "Money out", closing: "Closing balance", revenue: "Revenue" },
    stockStatus: { outOfStock: "Out of stock", lowStock: "Low" },
    note: "Sales are not the same as cash received. Gross profit = net sales − cost of goods sold. Net profit also subtracts expenses."
  },
  staff: {
    title: "Staff & roles", add: "Add staff member", fullName: "Full name", username: "Username", password: "Password", newPassword: "New password",
    disable: "Disable", enable: "Enable", resetPassword: "Reset password", you: "You", lastLogin: "Last sign-in", never: "Never",
    help: "Cashiers can sell and take payments. Stockkeepers manage products and purchases. Managers can do everything except staff and business settings.",
    rolesHelp: { manager: "Everything except staff and business settings", cashier: "POS, invoices, customers, payments", stockkeeper: "Products, suppliers, purchases" },
    tabStaff: "Staff", tabRoles: "Roles", tabAccess: "Module access",
    help2: "Register each person who works in the business and give them a role. They sign in with their own username and see only the modules their role allows.",
    rolesHelp2: "Create the roles first (for example Cashier, Store keeper, Accountant), then choose what each role can open and do. Changes apply to everyone with that role.",
    accessHelp: "Switch whole modules on or off for each role. To choose single actions (for example discounts or cancelling), edit the role in the Roles tab.",
    accessDetail: "A role that can't open a module doesn't see its tile on the dashboard, and the server refuses its requests.",
    newRole: "New role", editRole: "Edit role", roleName: "Role name", roleNamePh: "e.g. Senior cashier", roleDescPh: "Short note for staff",
    roleNameTaken: "Another role already has this name.", whatCanDo: "What can this role open and do?", copyFrom: "Copy from a role…",
    selectAll: "Select all", clearAll: "Clear all", all: "All", none: "None", module: "Module",
    staffCount: "{n} staff", permCount: "{n} permissions", noModules: "No modules yet", fullAccess: "Full access",
    ownerHelp: "The owner can always see and do everything, including staff, roles, business info and settings.",
    ownerOnlyTitle: "Owner only", ownerOnlyShort: "Owner only",
    ownerOnlyHelp: "Staff & roles, Business info and Settings always stay with the owner, so no staff member can give themselves more access.",
    deleteRoleConfirm: "Delete the role \"{name}\"?", roleInUse: "This role still has {n} staff. Give them another role first.", roleInUseShort: "Staff still use this role",
    noRoles: "There are no roles yet.", manageRoles: "Manage roles"
  },
  perms: {
    "dashboard.finance": "See money totals (sales, profit, cash)",
    "sales.create": "Open POS and make sales", "sales.view": "See sales history and receipts", "sales.discount": "Give discounts and change prices", "sales.cancel": "Cancel sales and refund",
    "invoices.view": "See invoices", "invoices.create": "Create invoices", "invoices.cancel": "Cancel invoices", "payments.receive": "Receive customer payments",
    "products.view": "See products and stock", "products.edit": "Add and edit products", "stock.adjust": "Adjust stock (damage, counts)",
    "customers.view": "See customers and balances", "customers.edit": "Add and edit customers",
    "suppliers.view": "See suppliers and balances", "suppliers.edit": "Add and edit suppliers",
    "purchases.view": "See purchases", "purchases.create": "Record purchases", "purchases.pay": "Pay suppliers", "purchases.cancel": "Cancel purchases",
    "expenses.view": "See expenses and income", "expenses.create": "Record expenses and income", "expenses.delete": "Delete expenses and income",
    "cash.view": "See cash and bank balances", "cash.edit": "Add money, transfers and bank accounts",
    "stock.view": "See stock, movements and valuation", "stock.add": "Add stock and opening stock", "stock.adjust": "Adjust stock, counts and reversals",
    "stock.transfer": "Transfer stock between locations", "stock.locations": "Manage stock locations",
    "reports.view": "See reports", "audit.view": "See the activity log"
  },
  business: {
    title: "Business info", logo: "Logo", removeLogo: "Remove logo", ownerName: "Owner name", type: "Business type", created: "Registered on",
    readonly: "Only the business owner can change this information."
  },
  settings: {
    title: "Settings", currency: "Currency", defaultLanguage: "Default language", invoicePrefix: "Invoice number prefix", receiptPrefix: "Receipt number prefix",
    purchasePrefix: "Purchase number prefix", invoiceFooter: "Invoice footer text", languages: { en: "English", so: "Somali" }
  },
  profile: {
    title: "My profile", details: "My details", password: "Change password", currentPassword: "Current password", newPassword: "New password",
    confirmPassword: "Confirm new password", change: "Change password", username: "Username", lastLogin: "Last sign-in"
  },
  subscription: {
    title: "Subscription", trial: "Free trial", status: "Status", started: "Started", ends: "Ends", daysLeft: "{days} days left",
    plan: "Monthly plan: $10 per month", note: "Paid plans are not active yet. No payment is collected inside the app — contact Faatix to continue after your trial."
  },
  audit: { title: "Activity log", empty: "No activity yet.", when: "When", action: "Action", details: "Details" },
  notifications: {
    title: "Notifications", empty: "You're all caught up.",
    types: { lowStock: "{ref} is running low ({amount} left)", outOfStock: "{ref} is out of stock", invoiceOverdue: "Invoice {ref} is overdue", invoiceDue: "Invoice {ref} is due soon", supplierDue: "You owe {ref}" }
  },
  admin: {
    title: "Super Admin", signInTitle: "Platform administration", signIn: "Sign in", username: "Username or email", password: "Password",
    invalid: "Wrong username or password.", overview: "Overview", businesses: "Businesses", audit: "Platform activity", signOut: "Sign out",
    counts: { businesses: "Businesses", active: "Active", suspended: "Suspended", users: "Users", new30: "New (30 days)", sales: "POS sales", invoices: "Invoices", trials: "Active trials" },
    health: "System health", database: "Database", size: "Database size", uptime: "API uptime", users: "Users", transactions: "Transactions",
    lastActivity: "Last activity", owner: "Owner", registered: "Registered", trial: "Trial", suspend: "Suspend", activate: "Activate",
    deactivate: "Deactivate", reasonRequired: "Give a reason (shown in the audit log).", usage: "Usage", activity: "Recent activity",
    privacy: "For privacy, admins see business summaries only — not individual financial records.", businessUser: "Business"
  }
};

const so = {
  common: {
    save: "Kaydi", saving: "Waa la kaydinayaa…", cancel: "Jooji", close: "Xir", edit: "Wax ka beddel", add: "Ku dar", delete: "Tirtir", view: "Eeg",
    search: "Raadi", searchPh: "Raadi…", all: "Dhammaan", actions: "Ficillo", confirm: "Xaqiiji", back: "Dib u noqo", print: "Daabac / PDF",
    exportCsv: "U dhoofi Excel (CSV)", from: "Laga bilaabo", to: "Ilaa", apply: "Codso", total: "Wadarta", subtotal: "Wadarta hoose", discount: "Dhimis",
    paid: "La bixiyay", balance: "Haraaga", amount: "Qaddarka", date: "Taariikhda", status: "Xaaladda", notes: "Xusuus", name: "Magaca", phone: "Taleefan",
    email: "Iimayl", address: "Cinwaan", description: "Faahfaahin", category: "Qaybta", method: "Habka lacag-bixinta", reference: "Tixraac",
    qty: "Tirada", price: "Qiimaha", unitPrice: "Qiimaha halkii", unitCost: "Kharashka halkii", items: "Alaabta", item: "Alaab", product: "Alaab",
    customer: "Macmiil", supplier: "Alaab-qeybiye", user: "Isticmaale", role: "Door", loading: "Waa la soo dejinayaa…", noResults: "Waxba lama helin.",
    saved: "Waa la kaydiyay.", optional: "(ikhtiyaari)", reason: "Sababta", reasonPh: "Maxaa loogu baahan yahay?", remove: "Ka saar", more: "Wax badan",
    choose: "Dooro…", bankAccount: "Akoonka bangiga", noBank: "Marka hore ku dar akoon bangi qaybta Lacagta & bangiga.", yes: "Haa", no: "Maya",
    sample: "TUSAALE"
  },
  errors: {
    required: "Goobtan waa loo baahan yahay.", invalidAmount: "Geli qaddar sax ah.", invalidEmail: "Geli iimayl sax ah.",
    invalidPhone: "Geli lambar taleefan oo sax ah.", duplicate: "Qiimahan waxaa isticmaalaya alaab kale.",
    forbidden: "Ogolaansho uma lihid tan.", exceedsBalance: "Qaddarku wuu ka badan yahay waxa lagu leeyahay.",
    notEnough: "Lacagta la helay way ka yar tahay wadarta.", tooLarge: "Dhimistu way ka weyn tahay wadarta.",
    requiredForCredit: "Iibka deynta ah u dooro macmiil.", beforeIssue: "Taariikhda bixintu kama horrayn karto taariikhda qaansheegta.",
    future: "Taariikhdu ma noqon karto mustaqbalka.", sameAccount: "Dooro laba akoon oo kala duwan.", wrongPassword: "Furaha sirta ah ee hadda waa khalad.",
    weakPassword: "Isticmaal ugu yaraan 8 xaraf oo xarfo iyo tiro leh.", invalidUsername: "Isticmaal 3–30 xaraf, tiro, dhibic ama hoosta-xariiq.",
    usernameTaken: "Magacan isticmaale horay ayaa loo qaatay.", insufficientStock: "{product}: kaliya {available} ayaa kaydka ku jira.",
    alreadyCancelled: "Tan horay ayaa loo joojiyay.", hasPayments: "Tani lacag-bixin ayay leedahay lamana joojin karo.",
    notPayable: "Tani lacag ma qaadan karto.", invalidLogo: "Astaantu waa inay noqotaa PNG, JPG ama WEBP.", logoTooLarge: "Astaantu waa inay ka yaraataa 2 MB.",
    invalidImage: "Sawirku waa inuu noqdaa PNG, JPG ama WEBP.", changeNeedsCash: "Baaqiga waxaa laga bixin karaa lacag caddaan ah oo keliya.",
    openingExists: "{product} horey ayuu kayd furitaan ugu leeyahay {location}. Ka celi qaybta Dhaqdhaqaaqa si aad mar kale u geliso.",
    stockChanged: "Kaydku wuu isbeddelay intaad eegaysay. Hubi tirooyinka cusub oo mar kale xaqiiji.",
    locationHasStock: "Goobtan weli kayd ayay haysaa. Marka hore u wareeji goob kale.",
    defaultLocationActive: "Goobta caadiga ah lama dami karo. Marka hore goob kale ka dhig mid caadi ah.",
    notReversible: "Dhaqdhaqaaqan halkan laguma celin karo. Iibka, qaansheegyada iyo iibsiga waxaa lagu saxaa qaybahooda.",
    alreadyReversed: "Dhaqdhaqaaqan horey ayaa loo celiyay.", locationNameTaken: "Goob kale ayaa magacan leh.",
    barcodeTaken: "Baarkoodkan wuxuu horey u leeyahay {product}.", sameLocation: "Dooro laba goobood oo kala duwan.",
    noChange: "Tirada la tiriyay waxay la mid tahay kaydka diiwaansan — waxba lama hagaajinayo.", inactiveProduct: "Alaab dansan kayd lama siin karo.", imageTooLarge: "Sawirku waa inuu ka yaraadaa 2 MB.",
    importErrors: "Safaf qaar ayaa khalad leh. Sax oo isku day mar kale.", serverOffline: "Lama gaari karo server-ka.", failed: "Wax baa khaldamay. Isku day mar kale.",
    validation: "Fadlan hubi goobaha la calaamadeeyay.", notFound: "Lama helin.", mismatch: "Furayaasha sirta ah isma mid aha."
  },
  methods: { cash: "Caddaan", mobile_money: "Lacag moobayl", bank: "Bangi", credit: "Deyn (bixin dambe)" },
  status: {
    completed: "La dhammeeyay", cancelled: "La joojiyay", unpaid: "Lama bixin", partially_paid: "Qayb ahaan la bixiyay", paid: "La bixiyay", overdue: "Waqtigii dhaafay",
    received: "La helay", active: "Firfircoon", disabled: "La damiyay", suspended: "La hakiyay", deactivated: "La xiray", draft: "Qabyo",
    returned: "La soo celiyay", expired: "Dhacay", converted: "La beddelay"
  },
  products: {
    title: "Alaabta & kaydka", add: "Ku dar alaab", edit: "Wax ka beddel alaabta", sku: "SKU", barcode: "Baarkood", brand: "Calaamad", unit: "Cabbir",
    costPrice: "Qiimaha iibsiga", sellingPrice: "Qiimaha tafaariiqda", wholesalePrice: "Qiimaha jumlada", minStock: "Kaydka ugu yar", openingStock: "Kaydka bilowga",
    stock: "Kaydka", active: "Firfircoon", inactive: "Aan firfircoonayn", showInactive: "Muuji kuwa aan firfircoonayn", lowOnly: "Kaydka yar oo keliya", adjust: "Hagaaji kaydka",
    adjustHelp: "Isticmaal tiro togan si aad kayd ugu darto iyo tiro taban si aad uga saarto (tusaale −3 alaab dhaawacan).",
    qtyChange: "Isbeddelka tirada", history: "Taariikhda kaydka", import: "Soo geli CSV",
    importHelp: "Tiirarka CSV: name, sku, barcode, category, unit, costPrice, sellingPrice, wholesalePrice, minStock, openingStock",
    importDone: "{n} alaab ayaa la soo geliyay.",
    searchPh: "Raadi magac, SKU ama baarkood", allBrands: "Dhammaan astaamaha", allCategories: "Dhammaan qaybaha", allSubcategories: "Dhammaan qaybaha hoose",
    anyLocation: "Goob kasta", stockAt: "Kayd ku jira {location}", allSuppliers: "Dhammaan alaab-qeybiyeyaasha", resetFilters: "Nadiifi shaandhada ({n})",
    alertAt: "digniin {n}", subcategory: "Qayb hoose", barcodePh: "Akhri ama qor baarkoodka", openExisting: "Fur alaabtan",
    barcodeExistsHelp: "Alaab cusub lama samaynayo. Fur tan jirta ama kayd ku dar.",
    lowStockAlert: "Heerka Digniinta Kayd Yar", lowStockAlertHint: "Digniin marka kaydku gaadho ama ka hooseeyo tiradan.",
    stockSeparate: "Kaydka si gaar ah ayaa loo geliyaa: kaydinta kadib, isticmaal Kaydka → Kayd furitaan ama Ku dar kayd.",
    units: { pcs: "xabbo", bottle: "dhalo", box: "sanduuq", pack: "baakad", carton: "kartoon", kg: "kg", g: "g", liter: "litir", ml: "ml", meter: "mitir", yard: "yaard", roll: "duub", pair: "lammaane", dozen: "dersin" },
    image: "Sawirka alaabta", imageChoose: "Dooro sawir", imageChange: "Beddel sawirka", imageRemove: "Ka saar sawirka", imageHint: "PNG, JPG ama WEBP, ilaa 2 MB", empty: "Weli alaab ma jirto. Ku dar alaabtaada ugu horreysa si aad u bilowdo iibka.",
    moveTypes: { opening: "Kaydka bilowga", purchase: "Iibsi", sale: "Iib POS", invoice: "Qaansheeg", adjustment: "Hagaajin", return_in: "La soo celiyay", return_out: "La celiyay", purchase_return: "Iibsi la joojiyay" }
  },
  parties: {
    customers: "Macaamiisha", suppliers: "Alaab-qeybiyeyaasha", addCustomer: "Ku dar macmiil", addSupplier: "Ku dar alaab-qeybiye", editCustomer: "Wax ka beddel macmiilka",
    editSupplier: "Wax ka beddel alaab-qeybiyaha", owesYou: "Wuu kugu leeyahay", youOwe: "Waad ku leedahay", overdue: "Waqtigii dhaafay", statement: "Bayaanka akoonka",
    receivePayment: "Qaado lacag", paySupplier: "Bixi alaab-qeybiyaha", debit: "Lagu dallacay", credit: "La bixiyay", runningBalance: "Haraaga",
    kinds: { invoice: "Qaansheeg", sale: "Iib deyn ah", purchase: "Iibsi", payment: "Lacag-bixin" },
    emptyCustomers: "Weli macaamiil ma jiraan.", emptySuppliers: "Weli alaab-qeybiyeyaal ma jiraan.",
    paymentHelp: "Lacagta waxaa marka hore la mariyaa dukumentiyada ugu da'da weyn ee aan la bixin."
  },
  pos: {
    title: "Barta iibka", search: "Raadi alaab ama akhri baarkoodka…", cart: "Gaariga", emptyCart: "Ku dar alaab adigoo raadinaya ama akhrinaya.",
    walkIn: "Macmiil soo socod ah", received: "Lacagta la helay", change: "Haraaga la celinayo", creditPaid: "Hadda la bixiyay (ikhtiyaari)", paidWith: "Hadda lagu bixiyay",
    charge: "Dhammee iibka · {amount}", newSale: "Iib cusub", receipt: "Rasiid", history: "Taariikhda iibka", cancelSale: "Jooji & celi lacagta",
    cancelHelp: "Kaydka waa la celin doonaa, lacagta la helayna waa la celin doonaa. Tan waxaa lagu diiwaan gelinayaa diiwaanka dhaqdhaqaaqa.",
    inStock: "{qty} ayaa kaydka ku jira", outOfStock: "Kaydka waa dhammaaday", cashier: "Khasnaji", receiptNo: "Lambarka rasiidka", thankYou: "Waad ku mahadsan tahay iibsashadaada!",
    done: "Iibka waa la dhammeeyay", notFound: "Ma jiro alaab baarkoodkan leh.", noDiscount: "Kaliya milkiilayaasha iyo maamulayaasha ayaa dhimis bixin kara.",
    scan: "Akhri baarkoodka", scanTitle: "Ku akhri kamarada", scanHelp: "Baarkoodka alaabta hor dhig kamarada.",
    scanNoCamera: "Kamarada lama furi karo. Oggolow kamarada, ama isticmaal qalabka baarkoodka ama qor koodka.",
    scanned: "Alaabta la akhriyay", added: "Waa lagu daray gaadhiga", inCart: "Gaadhiga: {qty}", addAnother: "Mid kale ku dar",
    scanEmpty: "Akhri ama dooro alaab si aad halkan ugu aragto sawirkeeda, qiimaha iyo faahfaahinteeda.", noPhoto: "Sawir ma leh",
    clearItem: "Tirtir shayga la doortay", payment: "Lacag bixinta", unitsAt: "{qty} xabbo oo {price} ah", qtyLabel: "TIRADA: {qty}",
    payTitle: "Lacag bixinta", addMethod: "Guji hab lacag bixin si aad ugu darto:", applied: "Lacagaha la bixiyay", noApplied: "Weli lacag lama darin. Guji hab lacag bixin bidixda.",
    totalDue: "Wadarta la bixinayo", totalPaid: "Wadarta la bixiyay", remaining: "Haraaga", changeDue: "Baaqiga la celinayo", confirm: "Xaqiiji iibka",
    restOnCredit: "Haraagu waa deyn — {name} ayaa bixin doona mar dambe.", needCustomer: "Kor ka dooro macmiil si haraagu deyn u noqdo.",
    discountLocked: "Kaliya milkiilayaasha iyo maamulayaasha ayaa dhimis bixin kara.", exact: "Sax", walkInDefault: "Macmiil socod ah (caadi)", outRibbon: "Waa dhammaaday",
    codePh: "Akhri ama qor baarkoodka, kadib Enter", filterPh: "Raadi alaab…", newProduct: "Alaab cusub", itemsCount: "{n} shay",
    discPercent: "Dhimis boqolley ah — guji si aad ugu beddesho qaddar", discAmount: "Dhimis qaddar ah — guji si aad ugu beddesho boqolley", locked: "Xiran",
    scanCamera: "Kamarada", scanAuto: "Toos (kamarada dambe)", scanManual: "Ama qor lambarka baarkoodka",
    scanTips: "Iftiin fiican, baarkoodka si siman oo aan dhaqaaqin ugu hay sanduuqa oranjiga ah, qiyaastii 10–20 cm kamarada. Kamarada laptop-ka badanaa way caddayn la'dahay marka u dhow — qalabka baarkoodka USB ama taleefan ayaa ugu fiican.",
    noMethods: "Ma jiro hab lacag bixin oo shidan. Milkiiluhu wuxuu ku dari karaa Dejinta → Hababka lacag bixinta."
  },
  stock: {
    title: "Maamulka kaydka",
    tabs: { current: "Kaydka hadda", add: "Ku dar kayd", opening: "Kayd furitaan", adjust: "Hagaaji", transfer: "Wareeji", movements: "Dhaqdhaqaaqa", low: "Kayd yar", valuation: "Qiimaynta", reports: "Warbixinno", locations: "Goobaha" },
    types: { opening: "Kayd furitaan", purchase: "Iibsi la helay", stock_in: "Kayd kale oo soo galay", return_in: "Celin macmiil", sale: "Iib POS", invoice: "Qaansheeg",
      return_out: "La celiyay", purchase_return: "Celin alaab-qeybiye", transfer_out: "Wareejin bax", transfer_in: "Wareejin gal", damaged: "Kayd khasaaray",
      adjustment: "Hagaajin kayd", count: "Sixitaan tirin", reversal: "Celin" },
    reasons: { damaged: "Khasaaray", expired: "Dhacay", lost: "Lumay / la xaday", found: "La helay", correction: "Sixitaan tirin", other: "Kale", opening: "Kayd furitaan",
      purchase: "Iibsi la helay", return_in: "Celin macmiil", stock_in: "Kayd kale oo soo galay", transfer: "Wareejin" },
    status: { in: "Kayd jira", low: "Kayd yar", out: "Kayd dhammaaday", negative: "Kayd taban" },
    alertFrom: { product: "heerka alaabta", location: "heerka goobta" },
    kinds: { shop: "Dukaan", warehouse: "Bakhaar", other: "Kale" },
    location: "Goobta", allLocations: "Dhammaan goobaha", default: "caadi", defaultLocation: "Goobta caadiga ah", allStatuses: "Dhammaan xaaladaha kaydka", allTypes: "Dhammaan noocyada",
    stockStatus: "Xaaladda kaydka", current: "Kaydka hadda", available: "La heli karo", alertLevel: "Heerka Digniinta Kayd Yar", lastMovement: "Dhaqdhaqaaqii u dambeeyay",
    searchPh: "Raadi magac, SKU ama baarkood", searchMovesPh: "Alaab, SKU, baarkood ama tixraac", adjust: "Hagaaji", setAlert: "Heerka digniinta goobtan",
    alertHelp: "Dhig heer kayd yar oo keliya {location}, ama ka tag madhan si loo isticmaalo heerka alaabta.", alertEmpty: "Madhan = heerka alaabta",
    availableNote: "La heli karo = kaydka hadda (Faatix kayd uma xannibo dalabyada aan la bixin).",
    results: "{n} natiijo", pageOf: "Bogga {page} ee {pages} · {n} natiijo",
    pickerPh: "Akhri, ama qor magac, SKU ama baarkood — kadib Enter", scanProducts: "Akhri ama dooro alaabta",
    scanNoAdd: "Akhrintu waxay keliya doorataa alaab — qor tirada saf kasta.", noLines: "Weli alaab ma jirto. Kor ka akhri ama raadi.",
    transactionType: "Nooca dhaqdhaqaaqa", reference: "Tixraac", referencePh: "tusaale GRN-0012, lambarka warqadda keenista", totalNow: "Wadarta hadda: {qty} {unit}",
    purchaseNote: "Tani waxay keliya kordhisaa kaydka. Si aad u diiwaan geliso waxa aad alaab-qeybiye ku leedahay, isticmaal Iibsiga.",
    linesSummary: "{n} alaab · {units} xabbo", reviewSave: "Eeg oo kaydi", confirm: "Xaqiiji", confirmAdd: "Xaqiiji kaydka soo galaya",
    confirmAddHelp: "{type} ee {location}:", addDone: "La kaydiyay: {n} alaab ayaa lagu daray {location}.",
    openingHelp: "Kaydka furitaanku waa tirada aad haysato marka aad bilowdo isticmaalka Faatix. Hal mar ayaa la geliyaa alaab iyo goob kasta.",
    openingQty: "Tirada furitaanka", openingExistsHere: "Alaabtan horey ayay kayd furitaan ugu leedahay {location}.", confirmOpening: "Xaqiiji kaydka furitaanka",
    openingDone: "Kayd furitaan waa la kaydiyay: {name} hadda waxay leedahay {qty} gudaha {location}.",
    method: "Habka", modeAdjust: "Hagaaji tirada", modeCount: "Geli tirada la xaqiijiyay", adjustType: "Ku dar ama ka jar", add: "Ku dar", subtract: "Ka jar",
    adjustQty: "Tirada", countedQty: "Tirada si dhab ah loo tiriyay", countHint: "Geli waxa aad tirisay; farqiga ayaa laguu xisaabinayaa.",
    previous: "Kaydkii hore", change: "Isbeddel", newStock: "Kaydka cusub", valueEffect: "Saamaynta qiimaha (kharash)", wouldBeNegative: "Kaydku kama hoos dhici karo eber.",
    reviewAdjust: "Eeg hagaajinta", confirmAdjust: "Xaqiiji hagaajinta kaydka", stockChanged: "Kaydku wuu isbeddelay — tirooyinka waa la cusbooneysiiyay, hubi oo mar kale xaqiiji.",
    adjustDone: "La kaydiyay: {name} {before} → {after} {unit}.",
    fromLocation: "Goobta laga qaadayo", toLocation: "Goobta loo wareejinayo", availableAt: "{qty} {unit} gudaha {location}", reviewTransfer: "Eeg wareejinta", confirmTransfer: "Xaqiiji wareejinta",
    transferDone: "{n} alaab ayaa laga wareejiyay {from} loona wareejiyay {to} ({ref}).", needTwoLocations: "Ku dar goob labaad (qaybta Goobaha) si aad kayd ugu kala wareejiso.",
    movementType: "Nooca dhaqdhaqaaqa", beforeAfter: "Kahor → kadib", value: "Qiimaha", reasonRef: "Sabab · tixraac", reverse: "Celi", reversed: "La celiyay",
    reversalOf: "wuxuu celinayaa #{id}", reverseHelp: "Dhaqdhaqaaq sixitaan ah ayaa lagu darayaa; kii hore wuxuu ku jirayaa taariikhda.",
    reverseTransferHelp: "Labada saf ee wareejintan waa la celinayaa: kaydku wuxuu ku noqonayaa meeshii uu ka yimid.",
    noLow: "Ma jirto alaab gaadhay heerka digniinteeda.", lowHelp: "Alaab halkan ayay ka muuqataa marka kaydkeedu gaadho Heerka Digniinta Kayd Yar (ama heerka goobta).",
    costValue: "Qiimaha kaydka (kharash)", retailValue: "Qiimaha tafaariiqda", units: "Xabbada gacanta ku jirta", unitsShort: "{n} xabbo",
    valuationNote: "Waxaa lagu qiimeeyay qiimaha kharashka hadda ee alaab kasta.", moreReports: "Dhammaan warbixinnada", byType: "Dhaqdhaqaaqa nooc ahaan", moves: "Dhaqdhaqaaq", qtyIn: "Gal", qtyOut: "Bax",
    losses: "Khasaaraha ugu waaweyn (khasaare, hagaajin, tirin)", noLosses: "Khasaare ma jiro muddadan.",
    locationsHelp: "Dukaamada iyo bakhaarada aad kayd ku haysato. Iibka, qaansheegyada iyo iibsiga waxay isticmaalaan goobta caadiga ah.",
    newLocation: "Goob cusub", editLocation: "Wax ka beddel goobta", kind: "Nooca", locationNamePh: "tusaale Bakhaarka Bakaaraha", makeDefault: "Ka dhig goobta caadiga ah",
    locationActive: "Shidan", defaultHelp: "Goobta caadiga ah waa halka iibka POS, qaansheegyada iyo iibsigu kayd ka qaataan oo dhigaan.",
    locationSummary: "{products} alaab · {units} xabbo"
  },
  receipt: {
    paper: "Ballaca warqadda", receipt: "Rasiid", servedBy: "Waxaa adeegay", item: "Shay", items: "Alaabta", totalDiscount: "Dhimista guud", payments: "Lacag-bixinta",
    tendered: "Lacagta la bixiyay", amountPaid: "Lacagta la bixiyay", balanceDue: "Haraaga lagu leeyahay", refund: "Celin lacag", thanks: "Waad ku mahadsantahay ganacsigaaga! Mar kale soo booqo.",
    verify: "Xaqiijin"
  },
  payMethods: {
    title: "Hababka lacag bixinta", help: "Kuwani waxay ka muuqdaan shaashadda lacag bixinta ee POS. Ku dar boorsooyinka iyo bangiyada ganacsigaagu isticmaalo, oo dami kuwa aadan isticmaalin.",
    add: "Ku dar hab lacag bixin", edit: "Wax ka beddel habka lacag bixinta", name: "Magaca", number: "Lambarka (ikhtiyaari)", numberHint: "Wuxuu ka muuqdaa qaansooyinka, tusaale E-Dahab (136227).",
    kind: "Nooca", kindHint: "Lacagta caddaanka ah ayaa baaqi bixin karta. Hab kastaa wuxuu leeyahay haraag gaar ah oo ku jira Lacagta & bangiga.", kindLocked: "Nooca lama beddeli karo marka habka la sameeyo kadib.",
    kinds: { cash: "Lacag caddaan", mobile_money: "Lacag mobile", bank: "Bangi" }, showOnPos: "Ka muuji shaashadda lacag bixinta",
    on: "Shidan", off: "Dansan", up: "Kor u qaad", down: "Hoos u dhig", preview: "Shaashadda lacag bixinta waxay u muujinaysaa"
  },
  invoices: {
    title: "Qaansheegyada iibka", new: "Qaansheeg cusub", priceList: "Liiska qiimaha", retail: "Qiimaha tafaariiqda", wholesale: "Qiimaha jumlada",
    issueDate: "Taariikhda", dueDate: "Taariikhda bixinta", addItem: "Ku dar alaab", payNow: "Lacag hadda la helay (ikhtiyaari)", create: "Samee qaansheeg",
    recordPayment: "Diiwaan geli lacag-bixin", cancelInvoice: "Jooji qaansheegta",
    cancelHelp: "Kaliya qaansheegyada aan lacag laga bixin ayaa la joojin karaa. Kaydka waa la celin doonaa.", empty: "Muddadan qaansheeg ma jiro."
  },
  purchases: {
    title: "Iibsiga", new: "Diiwaan geli iibsi", create: "Kaydi iibsiga", payNow: "Hadda la bixiyay (ikhtiyaari)", pay: "Bixi alaab-qeybiyaha",
    cancel: "Jooji iibsiga", cancelHelp: "Kaliya iibsiyada aan la bixin ayaa la joojin karaa. Kaydka mar kale ayaa laga saarayaa.",
    empty: "Muddadan iibsi ma jiro.", note: "Kaydka isla markiiba waa lagu darayaa, qiimaha iibsiga alaab kastana waxaa loo cusboonaysiinayaa qiimahan."
  },
  money: {
    expenses: "Kharashyada", income: "Dakhli kale", addExpense: "Ku dar kharash", addIncome: "Ku dar dakhli", byCategory: "Qayb ahaan",
    empty: "Muddadan waxba lama diiwaan gelin.", deleteConfirm: "Tirtir tan? Dhaqdhaqaaqa lacagta waa la celin doonaa.",
    categories: { rent: "Kiro", salaries: "Mushaharaad", electricity: "Koronto", internet: "Internet", transport: "Gaadiid", repairs: "Dayactir", marketing: "Suuq-geyn", water: "Biyo", taxes: "Canshuuro & khidmado", other: "Kale" },
    incomeCategories: { service: "Dakhli adeeg", commission: "Komishan", rental: "Dakhli kiro", interest: "Faa'iido", other: "Kale" }
  },
  cash: {
    title: "Lacagta & bangiga", cashAccounts: "Akoonnada caddaanka", bankAccounts: "Akoonnada bangiga", addBank: "Ku dar akoon bangi", bankName: "Magaca bangiga",
    accountName: "Magaca akoonka", accountNumber: "Lambarka akoonka", entry: "Dhigasho / bixis", direction: "Nooca", in: "Lacag soo gashay", out: "Lacag baxday",
    transfer: "Wareejin", fromAcc: "Akoonka laga wareejinayo", toAcc: "Akoonka loo wareejinayo", transactions: "Dhaqdhaqaaqyada", account: "Akoon", empty: "Muddadan dhaqdhaqaaq ma jiro.",
    totalBalance: "Wadarta haraaga",
    types: { customer_payment: "Lacag macmiil", supplier_payment: "Lacag alaab-qeybiye", expense: "Kharash", other_income: "Dakhli kale", transfer: "Wareejin", adjustment: "Dhigasho / bixis", refund: "Celin lacag" }
  },
  reports: {
    title: "Warbixinnada", choose: "Warbixin",
    types: { sales: "Iibka", profit: "Faa'iidada", inventory: "Qiimaha kaydka", lowStock: "Kaydka yar", receivables: "Deymaha macaamiisha", payables: "Deymaha alaab-qeybiyeyaasha", purchases: "Iibsiga", expenses: "Kharashyada", cashflow: "Socodka lacagta", bestSellers: "Alaabta ugu iibka badan" },
    cols: { date: "Taariikh", count: "Dukumentiyo", discount: "Dhimisyo", total: "Wadarta", label: "Shay", amount: "Qaddar", name: "Magac", sku: "SKU", category: "Qayb", stock: "Kayd", costValue: "Qiimaha iibsiga", retailValue: "Qiimaha iibka", minStock: "Ugu yar", status: "Xaalad", phone: "Taleefan", nextDue: "Bixinta xigta", overdue: "Waqti dhaaf", balance: "Haraag", number: "Lambar", supplier: "Alaab-qeybiye", paid: "La bixiyay", moneyIn: "Soo gashay", moneyOut: "Baxday", net: "Saafi", qty: "Tirada la iibiyay", revenue: "Dakhli", profit: "Faa'iido" },
    lines: { grossSales: "Iibka guud", discounts: "Dhimisyada", netSales: "Iibka saafiga", cogs: "Kharashka alaabta la iibiyay", grossProfit: "Faa'iidada guud", expenses: "Kharashyada", otherIncome: "Dakhli kale", netProfit: "Faa'iidada saafiga" },
    summary: { salesTotal: "Wadarta iibka", documents: "Dukumentiyo", received: "Lacagta la helay", netSales: "Iibka saafiga", grossProfit: "Faa'iidada guud", netProfit: "Faa'iidada saafiga", margin: "Boqolleyda faa'iidada", products: "Alaab", costValue: "Qiimaha iibsiga", retailValue: "Qiimaha iibka", outOfStock: "Kayd dhammaaday", lowStock: "Kayd yar ama dhammaaday", customers: "Macaamiil", total: "Wadarta", overdue: "Waqti dhaaf", suppliers: "Alaab-qeybiyeyaal", paid: "La bixiyay", expenses: "Kharashyada", otherIncome: "Dakhli kale", opening: "Haraaga bilowga", moneyIn: "Lacag soo gashay", moneyOut: "Lacag baxday", closing: "Haraaga dhammaadka", revenue: "Dakhli" },
    stockStatus: { outOfStock: "Dhammaaday", lowStock: "Yar" },
    note: "Iibku la mid ma aha lacagta la helay. Faa'iidada guud = iibka saafiga − kharashka alaabta. Faa'iidada saafiga waxaa sidoo kale laga jaraa kharashyada."
  },
  staff: {
    title: "Shaqaalaha & doorarka", add: "Ku dar shaqaale", fullName: "Magaca oo buuxa", username: "Magaca isticmaalaha", password: "Furaha sirta ah", newPassword: "Furaha sirta ah ee cusub",
    disable: "Dami", enable: "Shid", resetPassword: "Dib u deji furaha", you: "Adiga", lastLogin: "Gelitaankii ugu dambeeyay", never: "Weligii",
    help: "Khasnajiyadu way iibin karaan oo lacag qaadan karaan. Kaydiyeyaashu waxay maamulaan alaabta iyo iibsiga. Maamulayaashu wax walba way samayn karaan marka laga reebo shaqaalaha iyo dejinta ganacsiga.",
    rolesHelp: { manager: "Wax walba marka laga reebo shaqaalaha iyo dejinta", cashier: "POS, qaansheegyo, macaamiil, lacag-bixin", stockkeeper: "Alaab, alaab-qeybiyeyaal, iibsi" },
    tabStaff: "Shaqaalaha", tabRoles: "Doorarka", tabAccess: "Gelitaanka qaybaha",
    help2: "Diiwaan geli qof kasta oo ka shaqeeya ganacsiga oo sii door. Waxay ku galayaan magacooda isticmaalaha waxayna arkaan oo keliya qaybaha uu doorkoodu u oggol yahay.",
    rolesHelp2: "Marka hore samee doorarka (tusaale Khasnaji, Kaydiye, Xisaabiye), kadib dooro waxa door kastaa furi karo oo samayn karo. Isbeddelku wuxuu khuseeyaa qof kasta oo doorkaas leh.",
    accessHelp: "Shid ama dami qaybaha oo dhan door kasta. Si aad u doorato ficillo gaar ah (tusaale dhimis ama baajin), wax ka beddel doorka qaybta Doorarka.",
    accessDetail: "Door aan furi karin qayb ma arko sanduuqeeda dashboard-ka, server-kuna wuu diidaa codsiyadiisa.",
    newRole: "Door cusub", editRole: "Wax ka beddel doorka", roleName: "Magaca doorka", roleNamePh: "tusaale Khasnaji sare", roleDescPh: "Qoraal gaaban oo shaqaalaha loogu talagalay",
    roleNameTaken: "Door kale ayaa magacan leh.", whatCanDo: "Muxuu doorkani furi karaa oo samayn karaa?", copyFrom: "Ka koobbiyee door…",
    selectAll: "Dooro dhammaan", clearAll: "Tirtir dhammaan", all: "Dhammaan", none: "Midna", module: "Qaybta",
    staffCount: "{n} shaqaale", permCount: "{n} oggolaansho", noModules: "Weli qayb ma leh", fullAccess: "Gelitaan buuxa",
    ownerHelp: "Milkiiluhu mar walba wax walba wuu arki karaa oo samayn karaa, oo ay ku jiraan shaqaalaha, doorarka, xogta ganacsiga iyo dejinta.",
    ownerOnlyTitle: "Milkiilaha oo keliya", ownerOnlyShort: "Milkiilaha oo keliya",
    ownerOnlyHelp: "Shaqaalaha & doorarka, Xogta ganacsiga iyo Dejinta had iyo jeer waxay la jiraan milkiilaha, si aanu shaqaale isu siin gelitaan dheeraad ah.",
    deleteRoleConfirm: "Ma tirtirtaa doorka \"{name}\"?", roleInUse: "Doorkan waxaa weli leh {n} shaqaale. Marka hore sii door kale.", roleInUseShort: "Shaqaale ayaa weli isticmaala doorkan",
    noRoles: "Weli door ma jiro.", manageRoles: "Maamul doorarka"
  },
  perms: {
    "dashboard.finance": "Arag wadarta lacagta (iib, faa'iido, caddaan)",
    "sales.create": "Fur POS oo samee iib", "sales.view": "Arag taariikhda iibka iyo rasiidyada", "sales.discount": "Bixi dhimis oo beddel qiimaha", "sales.cancel": "Baaji iibka oo celi lacagta",
    "invoices.view": "Arag qaansheegyada", "invoices.create": "Samee qaansheegyo", "invoices.cancel": "Baaji qaansheegyada", "payments.receive": "Qaado lacag-bixinta macaamiisha",
    "products.view": "Arag alaabta iyo kaydka", "products.edit": "Ku dar oo wax ka beddel alaabta", "stock.adjust": "Hagaaji kaydka (khasaare, tirin)",
    "customers.view": "Arag macaamiisha iyo haraagooda", "customers.edit": "Ku dar oo wax ka beddel macaamiisha",
    "suppliers.view": "Arag alaab-qeybiyeyaasha iyo haraagooda", "suppliers.edit": "Ku dar oo wax ka beddel alaab-qeybiyeyaasha",
    "purchases.view": "Arag iibsiyada", "purchases.create": "Diiwaan geli iibsiyada", "purchases.pay": "Bixi alaab-qeybiyeyaasha", "purchases.cancel": "Baaji iibsiyada",
    "expenses.view": "Arag kharashyada iyo dakhliga", "expenses.create": "Diiwaan geli kharash iyo dakhli", "expenses.delete": "Tirtir kharash iyo dakhli",
    "cash.view": "Arag haraagga caddaanka iyo bangiga", "cash.edit": "Ku dar lacag, wareejin iyo akoonno bangi",
    "stock.view": "Arag kaydka, dhaqdhaqaaqa iyo qiimaynta", "stock.add": "Ku dar kayd iyo kayd furitaan", "stock.adjust": "Hagaaji kaydka, tirinta iyo celinta",
    "stock.transfer": "Kayd u kala wareeji goobaha", "stock.locations": "Maamul goobaha kaydka",
    "reports.view": "Arag warbixinnada", "audit.view": "Arag diiwaanka hawlaha"
  },
  business: {
    title: "Xogta ganacsiga", logo: "Astaanta", removeLogo: "Ka saar astaanta", ownerName: "Magaca milkiilaha", type: "Nooca ganacsiga", created: "La diiwaan geliyay",
    readonly: "Kaliya milkiilaha ganacsiga ayaa beddeli kara xogtan."
  },
  settings: {
    title: "Dejinta", currency: "Lacagta", defaultLanguage: "Luqadda caadiga ah", invoicePrefix: "Horgalaha lambarka qaansheegta", receiptPrefix: "Horgalaha lambarka rasiidka",
    purchasePrefix: "Horgalaha lambarka iibsiga", invoiceFooter: "Qoraalka hoose ee qaansheegta", languages: { en: "Ingiriis", so: "Soomaali" }
  },
  profile: {
    title: "Xogta qaaska ah", details: "Faahfaahintayda", password: "Beddel furaha sirta ah", currentPassword: "Furaha sirta ah ee hadda", newPassword: "Furaha sirta ah ee cusub",
    confirmPassword: "Xaqiiji furaha cusub", change: "Beddel furaha", username: "Magaca isticmaalaha", lastLogin: "Gelitaankii ugu dambeeyay"
  },
  subscription: {
    title: "Xirmada", trial: "Tijaabo bilaash ah", status: "Xaaladda", started: "Bilaabatay", ends: "Dhammaanaysa", daysLeft: "{days} maalmood ayaa haray",
    plan: "Qorshaha bishii: $10 bishii", note: "Qorshayaasha lacagta ah weli ma shaqaynayaan. Abka gudihiisa lacag lagama qaado — la xiriir Faatix si aad u sii wadato tijaabada kadib."
  },
  audit: { title: "Diiwaanka dhaqdhaqaaqa", empty: "Weli dhaqdhaqaaq ma jiro.", when: "Goorma", action: "Ficil", details: "Faahfaahin" },
  notifications: {
    title: "Ogeysiisyo", empty: "Wax cusub ma jiraan.",
    types: { lowStock: "{ref} kaydkiisu wuu yaraanayaa ({amount} ayaa haray)", outOfStock: "{ref} kaydkiisu waa dhammaaday", invoiceOverdue: "Qaansheegta {ref} waqtigeedii waa dhaafay", invoiceDue: "Qaansheegta {ref} dhowaan ayay bixinteedu tahay", supplierDue: "Waxaad ku leedahay {ref}" }
  },
  admin: {
    title: "Maamulaha Sare", signInTitle: "Maamulka madasha", signIn: "Soo gal", username: "Magaca isticmaalaha ama iimayl", password: "Furaha sirta ah",
    invalid: "Magaca ama furaha sirta ah waa khalad.", overview: "Guudmar", businesses: "Ganacsiyada", audit: "Dhaqdhaqaaqa madasha", signOut: "Ka bax",
    counts: { businesses: "Ganacsiyo", active: "Firfircoon", suspended: "La hakiyay", users: "Isticmaalayaal", new30: "Cusub (30 maalmood)", sales: "Iibka POS", invoices: "Qaansheegyo", trials: "Tijaabooyin firfircoon" },
    health: "Caafimaadka nidaamka", database: "Keydka xogta", size: "Cabbirka keydka", uptime: "Waqtiga API-ga", users: "Isticmaalayaal", transactions: "Macaamillo",
    lastActivity: "Dhaqdhaqaaqii ugu dambeeyay", owner: "Milkiile", registered: "La diiwaan geliyay", trial: "Tijaabo", suspend: "Hakii", activate: "Firfircooni",
    deactivate: "Xir", reasonRequired: "Qor sababta (waxay ka muuqan doontaa diiwaanka).", usage: "Isticmaalka", activity: "Dhaqdhaqaaqa dhowaa",
    privacy: "Asturnaanta awgeed, maamulayaashu waxay arkaan kaliya soo koobidda ganacsiga — ma aha diiwaannada maaliyadeed ee gaarka ah.", businessUser: "Ganacsi"
  }
};

export default { en, so };
