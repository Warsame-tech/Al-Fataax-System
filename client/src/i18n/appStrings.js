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
    invalidImage: "Photo must be PNG, JPG or WEBP.", changeNeedsCash: "Change can only be given from a cash payment.", imageTooLarge: "Photo must be 2 MB or smaller.",
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
    discountLocked: "Only owners and managers can give discounts.", exact: "Exact", walkInDefault: "Walk-in customer (default)", outRibbon: "Out of stock"
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
    rolesHelp: { manager: "Everything except staff and business settings", cashier: "POS, invoices, customers, payments", stockkeeper: "Products, suppliers, purchases" }
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
    invalidImage: "Sawirku waa inuu noqdaa PNG, JPG ama WEBP.", changeNeedsCash: "Baaqiga waxaa laga bixin karaa lacag caddaan ah oo keliya.", imageTooLarge: "Sawirku waa inuu ka yaraadaa 2 MB.",
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
    discountLocked: "Kaliya milkiilayaasha iyo maamulayaasha ayaa dhimis bixin kara.", exact: "Sax", walkInDefault: "Macmiil socod ah (caadi)", outRibbon: "Waa dhammaaday"
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
    rolesHelp: { manager: "Wax walba marka laga reebo shaqaalaha iyo dejinta", cashier: "POS, qaansheegyo, macaamiil, lacag-bixin", stockkeeper: "Alaab, alaab-qeybiyeyaal, iibsi" }
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
