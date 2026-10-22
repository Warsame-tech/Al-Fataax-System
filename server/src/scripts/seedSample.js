/*
 * Creates SAMPLE data for trying Faatix (clearly marked "SAMPLE").
 * Usage (from /server):   npm run db:seed          (skips if the sample business exists)
 *                         npm run db:seed -- --reset   (deletes the sample business first)
 *
 * All records are created through the same functions the API uses, so stock,
 * payments, balances and reports stay consistent.
 */
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";
import { withTx } from "../lib/http.js";
import { moveStock, moneyMove } from "../lib/ledger.js";
import { createSale } from "../routes/sales.js";
import { createInvoice } from "../routes/invoices.js";
import { createPurchase } from "../routes/purchases.js";
import { recordEntry } from "../routes/money.js";
import { receiveCustomerPayment } from "../routes/parties.js";

export const SAMPLE = {
  business: "Hodan Supermarket (SAMPLE)",
  users: [
    { username: "hodan", password: "Faatix@2026", fullName: "Hodan Ali", role: "owner" },
    { username: "manager1", password: "Manager@2026", fullName: "Abdi Hassan", role: "manager" },
    { username: "cashier1", password: "Cashier@2026", fullName: "Amina Yusuf", role: "cashier" },
    { username: "stock1", password: "Stock@2026", fullName: "Omar Farah", role: "stockkeeper" }
  ],
  admin: { username: "superadmin", password: "Admin@2026", email: "admin@faatix.local" }
};

const day = (offset, time = "10:00:00") => {
  const d = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  return { date: d, at: `${d} ${time}` };
};

async function resetSample() {
  const [[b]] = await pool.query("SELECT id FROM businesses WHERE name = ?", [SAMPLE.business]);
  if (!b) return;
  await withTx(async (conn) => {
    for (const t of ["return_items", "returns", "sale_items", "invoice_items", "purchase_items", "customer_payments", "supplier_payments",
      "cash_transactions", "stock_movements", "sales", "invoices", "purchases", "expenses", "other_income", "products", "categories", "brands",
      "customers", "suppliers", "payment_methods", "cash_accounts", "bank_accounts", "notifications", "trial_records", "business_settings", "business_user_roles", "audit_logs", "users"]) {
      await conn.query(`DELETE FROM ${t} WHERE business_id = ?`, [b.id]);
    }
    await conn.query("DELETE FROM businesses WHERE id = ?", [b.id]);
  });
  console.log("Removed the previous sample business.");
}

async function main() {
  if (process.argv.includes("--reset")) await resetSample();

  // Super admin (platform owner)
  const [[admin]] = await pool.query("SELECT id FROM platform_admins WHERE username = ?", [SAMPLE.admin.username]);
  if (!admin) {
    await pool.query("INSERT INTO platform_admins (username, email, password_hash) VALUES (?, ?, ?)",
      [SAMPLE.admin.username, SAMPLE.admin.email, await bcrypt.hash(SAMPLE.admin.password, 12)]);
    console.log("Created super admin.");
  }

  const [[exists]] = await pool.query("SELECT id FROM businesses WHERE name = ?", [SAMPLE.business]);
  if (exists) { console.log("Sample business already exists (use --reset to recreate)."); return; }
  const taken = await pool.query("SELECT username FROM users WHERE username IN (?)", [SAMPLE.users.map((u) => u.username)]);
  if (taken[0].length) { console.log("Sample usernames are already used by another business:", taken[0].map((u) => u.username).join(", ")); return; }

  const ids = await withTx(async (conn) => {
    const [b] = await conn.query(
      `INSERT INTO businesses (name, owner_name, email, phone, business_type, address, terms_accepted_at, created_at)
       VALUES (?, 'Hodan Ali', 'sample@hodan.example', '+252 61 0000001', 'supermarket', 'SAMPLE address, Mogadishu', UTC_TIMESTAMP(), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 40 DAY))`,
      [SAMPLE.business]);
    const bid = b.insertId;
    const users = {};
    for (const u of SAMPLE.users) {
      const [r] = await conn.query("INSERT INTO users (business_id, full_name, username, password_hash, phone) VALUES (?, ?, ?, ?, NULL)",
        [bid, u.fullName, u.username, await bcrypt.hash(u.password, 12)]);
      await conn.query("INSERT INTO business_user_roles (business_id, user_id, role) VALUES (?, ?, ?)", [bid, r.insertId, u.role]);
      users[u.role] = r.insertId;
    }
    await conn.query("INSERT INTO business_settings (business_id, invoice_footer) VALUES (?, 'Thank you for shopping with Hodan Supermarket. (SAMPLE)')", [bid]);
    await conn.query("INSERT INTO cash_accounts (business_id, name, is_default) VALUES (?, 'Main cash', 1), (?, 'Mobile money', 0)", [bid, bid]);
    const [bank] = await conn.query("INSERT INTO bank_accounts (business_id, bank_name, account_name, account_number) VALUES (?, 'Salaam Bank', 'Hodan Supermarket', 'SAMPLE-0001')", [bid]);
    await conn.query("INSERT INTO trial_records (business_id, start_date, end_date) VALUES (?, UTC_DATE(), DATE_ADD(UTC_DATE(), INTERVAL 15 DAY))", [bid]);
    return { bid, users, bankId: bank.insertId };
  });
  const { bid, users, bankId } = ids;
  const owner = { businessId: bid, userId: users.owner, role: "owner" };
  const cashier = { businessId: bid, userId: users.cashier, role: "cashier" };

  // Opening balances (owner's capital)
  await withTx(async (conn) => {
    const s = day(-30, "08:00:00").at;
    await moneyMove(conn, { businessId: bid, userId: users.owner, direction: "in", method: "cash", amount: 800, refType: "adjustment", description: "Opening cash (SAMPLE)", at: s });
    await moneyMove(conn, { businessId: bid, userId: users.owner, direction: "in", method: "bank", bankAccountId: bankId, amount: 3000, refType: "adjustment", description: "Opening bank balance (SAMPLE)", at: s });
  });

  // Products (no stock yet — stock arrives through purchases)
  const PRODUCTS = [
    ["Rice 25kg", "Food", "RICE-25", "6001000000011", 18, 24, 22, 10],
    ["Sugar 5kg", "Food", "SUG-5", "6001000000028", 4.2, 5.5, 5, 15],
    ["Cooking oil 3L", "Food", "OIL-3", "6001000000035", 5.8, 7.5, 7, 12],
    ["Spaghetti 500g", "Food", "PAS-500", "6001000000042", 0.55, 0.9, 0.8, 40],
    ["Tea leaves 250g", "Food", "TEA-250", "6001000000059", 1.4, 2.2, 2, 20],
    ["Milk powder 400g", "Dairy", "MLK-400", "6001000000066", 3.6, 4.8, 4.4, 15],
    ["Bottled water 1.5L", "Drinks", "WAT-15", "6001000000073", 0.25, 0.5, 0.4, 60],
    ["Soft drink 330ml", "Drinks", "SOD-330", "6001000000080", 0.35, 0.7, 0.6, 48],
    ["Laundry soap", "Household", "SOAP-1", "6001000000097", 0.6, 1, 0.9, 30],
    ["Toothpaste 120g", "Personal care", "TPA-120", "6001000000103", 1.1, 1.8, 1.6, 20],
    ["Dates 1kg", "Food", "DAT-1", "6001000000110", 2.8, 4, 3.6, 10],
    ["Flour 10kg", "Food", "FLR-10", "6001000000127", 7, 9.5, 9, 8]
  ];
  const productIds = {};
  await withTx(async (conn) => {
    for (const [name, cat, sku, barcode, cost, sell, whole, min] of PRODUCTS) {
      await conn.query("INSERT IGNORE INTO categories (business_id, name) VALUES (?, ?)", [bid, cat]);
      const [[c]] = await conn.query("SELECT id FROM categories WHERE business_id = ? AND name = ?", [bid, cat]);
      const [r] = await conn.query(
        "INSERT INTO products (business_id, category_id, name, sku, barcode, cost_price, selling_price, wholesale_price, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [bid, c.id, name, sku, barcode, cost, sell, whole, min]);
      productIds[sku] = r.insertId;
    }
  });
  const P = (sku) => productIds[sku];

  // Suppliers & customers
  const supplierIds = [];
  const customerIds = [];
  await withTx(async (conn) => {
    for (const [n, ph] of [["Banadir Wholesale (SAMPLE)", "+252 61 1000001"], ["Hormuud Foods Distributor (SAMPLE)", "+252 61 1000002"], ["Gulf Imports (SAMPLE)", "+252 61 1000003"]]) {
      const [r] = await conn.query("INSERT INTO suppliers (business_id, name, phone) VALUES (?, ?, ?)", [bid, n, ph]); supplierIds.push(r.insertId);
    }
    for (const [n, ph] of [["Xamar Mini Market (SAMPLE)", "+252 61 2000001"], ["Ayaan Restaurant (SAMPLE)", "+252 61 2000002"], ["Faisal Shop (SAMPLE)", "+252 61 2000003"], ["Walk-in customer (SAMPLE)", null]]) {
      const [r] = await conn.query("INSERT INTO customers (business_id, name, phone) VALUES (?, ?, ?)", [bid, n, ph]); customerIds.push(r.insertId);
    }
  });

  // Purchases (stock in)
  const purchase = (offset, supplier, items, paid, method = "cash") => withTx((conn) =>
    createPurchase(conn, { ...owner, at: day(offset, "09:00:00").at }, { supplierId: supplier, items, amountPaid: paid, method, bankAccountId: bankId }));
  await purchase(-28, supplierIds[0], [{ productId: P("RICE-25"), qty: 40, unitCost: 18 }, { productId: P("SUG-5"), qty: 60, unitCost: 4.2 }, { productId: P("FLR-10"), qty: 25, unitCost: 7 }], 1000, "bank");
  await purchase(-26, supplierIds[1], [{ productId: P("OIL-3"), qty: 50, unitCost: 5.8 }, { productId: P("PAS-500"), qty: 200, unitCost: 0.55 }, { productId: P("TEA-250"), qty: 60, unitCost: 1.4 }, { productId: P("MLK-400"), qty: 50, unitCost: 3.6 }, { productId: P("DAT-1"), qty: 30, unitCost: 2.8 }], 500);
  await purchase(-20, supplierIds[2], [{ productId: P("WAT-15"), qty: 300, unitCost: 0.25 }, { productId: P("SOD-330"), qty: 240, unitCost: 0.35 }, { productId: P("SOAP-1"), qty: 100, unitCost: 0.6 }, { productId: P("TPA-120"), qty: 22, unitCost: 1.1 }], 0);

  // POS sales over the last 18 days
  const basket = [
    [["WAT-15", 6], ["SOD-330", 4], ["PAS-500", 5]], [["RICE-25", 1], ["SUG-5", 2]], [["OIL-3", 1], ["TEA-250", 2], ["MLK-400", 1]],
    [["SOAP-1", 3], ["TPA-120", 2]], [["DAT-1", 2], ["WAT-15", 12]], [["FLR-10", 1], ["SUG-5", 1], ["OIL-3", 1]], [["SOD-330", 12], ["PAS-500", 10]]
  ];
  const methods = ["cash", "cash", "mobile_money", "cash", "mobile_money", "cash", "bank"];
  let n = 0;
  for (let d = -18; d <= 0; d++) {
    const perDay = d === 0 ? 3 : 2 + (Math.abs(d) % 3);
    for (let k = 0; k < perDay; k++) {
      const items = basket[n % basket.length].map(([sku, qty]) => ({ productId: P(sku), qty }));
      const method = methods[n % methods.length];
      const hour = String(9 + ((n * 3) % 10)).padStart(2, "0");
      await withTx((conn) => createSale(conn, { ...cashier, at: day(d, `${hour}:15:00`).at }, { items, paymentMethod: method, bankAccountId: bankId }));
      n++;
    }
  }
  // A credit sale (customer still owes part)
  await withTx((conn) => createSale(conn, { ...owner, at: day(-3, "16:40:00").at }, { customerId: customerIds[2], items: [{ productId: P("RICE-25"), qty: 2 }, { productId: P("OIL-3"), qty: 2 }], paymentMethod: "credit", amountReceived: 20, paidMethod: "cash" }));

  // Wholesale invoices
  const inv1 = await withTx((conn) => createInvoice(conn, { ...owner, at: day(-10).at }, {
    customerId: customerIds[0], priceList: "wholesale", issueDate: day(-10).date, dueDate: day(4).date, amountPaid: 300, method: "mobile_money",
    items: [{ productId: P("RICE-25"), qty: 10 }, { productId: P("SUG-5"), qty: 20 }, { productId: P("OIL-3"), qty: 10 }, { productId: P("WAT-15"), qty: 50 }],
    notes: "SAMPLE invoice"
  }));
  await withTx((conn) => createInvoice(conn, { ...owner, at: day(-25).at }, {
    customerId: customerIds[1], priceList: "wholesale", issueDate: day(-25).date, dueDate: day(-11).date,
    items: [{ productId: P("FLR-10"), qty: 6 }, { productId: P("TEA-250"), qty: 15 }, { productId: P("PAS-500"), qty: 60 }], notes: "SAMPLE invoice (overdue)"
  }));
  const inv3 = await withTx((conn) => createInvoice(conn, { ...owner, at: day(-6).at }, {
    customerId: customerIds[0], priceList: "wholesale", issueDate: day(-6).date, dueDate: day(8).date,
    items: [{ productId: P("MLK-400"), qty: 12 }, { productId: P("DAT-1"), qty: 8 }], notes: "SAMPLE invoice"
  }));
  await withTx((conn) => receiveCustomerPayment(conn, { businessId: bid, userId: users.owner, customerId: customerIds[0], invoiceId: inv3.id, amount: inv3.total, method: "bank", bankAccountId: bankId, reference: inv3.number, at: day(-2, "11:00:00").at }));

  // A supplier payment for the unpaid purchase
  const [[open]] = await pool.query("SELECT id, supplier_id, total FROM purchases WHERE business_id = ? AND amount_paid = 0 LIMIT 1", [bid]);
  if (open) {
    const { paySupplier } = await import("../routes/parties.js");
    await withTx((conn) => paySupplier(conn, { businessId: bid, userId: users.owner, supplierId: open.supplier_id, purchaseId: open.id, amount: 100, method: "cash", reference: "SAMPLE part payment", at: day(-5, "15:00:00").at }));
  }

  // Expenses and other income
  const entries = [
    ["expense", { category: "rent", amount: 400, date: day(-27).date, method: "bank", bankAccountId: bankId, description: "Shop rent (SAMPLE)" }],
    ["expense", { category: "electricity", amount: 65, date: day(-15).date, method: "cash", description: "Electricity bill (SAMPLE)" }],
    ["expense", { category: "salaries", amount: 350, date: day(-1).date, method: "mobile_money", description: "Staff salaries (SAMPLE)" }],
    ["expense", { category: "transport", amount: 30, date: day(-8).date, method: "cash", description: "Delivery fuel (SAMPLE)" }],
    ["expense", { category: "internet", amount: 25, date: day(-12).date, method: "mobile_money", description: "Internet (SAMPLE)" }],
    ["income", { category: "commission", amount: 40, date: day(-9).date, method: "mobile_money", description: "Mobile money agent commission (SAMPLE)" }]
  ];
  for (const [kind, body] of entries) await withTx((conn) => recordEntry(conn, owner, kind, body));

  // A recorded stock adjustment (damaged goods)
  await withTx(async (conn) => {
    const [[p]] = await conn.query("SELECT * FROM products WHERE id = ? FOR UPDATE", [P("SOD-330")]);
    await moveStock(conn, { businessId: bid, userId: users.manager, product: p, qtyChange: -6, type: "adjustment", note: "Damaged cans (SAMPLE)" });
  });

  console.log(`Sample business created (id ${bid}). Invoice example: ${inv1.number} for ${inv1.total}.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("Seed failed:", err.code || err.message, JSON.stringify(err.errors || err.extra || ""));
    console.error(String(err.stack).split("\n").slice(1, 4).join("\n"));
    await pool.end();
    process.exit(1);
  });
