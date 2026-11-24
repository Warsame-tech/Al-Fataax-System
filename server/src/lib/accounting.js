/*
 * Faatix accounting engine — one double-entry ledger for every business (Simple and Advanced mode use the same books).
 *
 * The books are built from the records the other modules already keep; nothing is typed twice:
 *   sale / invoice     Dr Customer debts (total)         Cr Sales (net) · Cr Taxes collected (VAT) · Cr Service & fees
 *                      Dr Cost of goods sold             Cr Inventory                (cost of the items sold)
 *   purchase           Dr Inventory                      Cr Supplier debts
 *   customer return    Dr Sales  Cr Customer debts       Dr Inventory  Cr Cost of goods sold
 *   supplier return    Dr Supplier debts                 Cr Inventory
 *   expense            Dr <expense category>             Cr Expenses to pay
 *   other income       Dr Other income to receive        Cr <income category>
 *   waste / stock count / damage / opening stock         Inventory against losses (or opening equity)
 *   money movement     the money account against the account the money settles (customer debts for sales, invoices and
 *                      customer payments; supplier debts for purchases and supplier payments; expenses to pay;
 *                      transfers in transit; owner's money; opening equity…)
 * so every sale paid at once nets to zero in Customer debts, and a sale on credit stays there until it is paid.
 *
 * syncBooks() compares every source record with what is posted (a fingerprint of its lines): new records are posted,
 * changed ones get a reversal entry and a new revision, removed / cancelled ones a reversal. Posted entries are never
 * edited or deleted; one source can't be posted twice (unique key). It runs in one lock per business.
 */
import crypto from "node:crypto";

export const SYSTEM_ACCOUNTS = [
  ["1090", "transit", "Money in transfer", "asset"],
  ["1100", "receivable", "Customer debts", "asset"],
  ["1150", "otherReceivable", "Other income to receive", "asset"],
  ["1200", "inventory", "Inventory", "asset"],
  ["2000", "payable", "Supplier debts", "liability"],
  ["2050", "expensesPayable", "Expenses to pay", "liability"],
  ["2100", "tax", "Taxes collected (VAT)", "liability"],
  ["2300", "advances", "Customer deposits & advances", "liability"],
  ["2900", "suspense", "Unclassified money", "liability"],
  ["3000", "opening", "Opening balances (equity)", "equity"],
  ["3100", "owner", "Owner's money in & out", "equity"],
  ["4000", "sales", "Sales", "revenue"],
  ["4100", "service", "Service & other fees", "revenue"],
  ["5000", "cogs", "Cost of goods sold", "cogs"],
  ["6800", "stockLoss", "Stock adjustments & losses", "expense"],
  ["6850", "waste", "Waste", "expense"]
];
export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "cogs", "expense"];
const DEBIT_NORMAL = new Set(["asset", "cogs", "expense"]);
export const normalBalance = (type, debit, credit) => (DEBIT_NORMAL.has(type) ? debit - credit : credit - debit);

// money movements: the account the money settles, by the movement's kind (cash_transactions.ref_type)
const MONEY_COUNTER = {
  sale: "receivable", invoice: "receivable", customer_payment: "receivable", refund: "receivable",
  purchase: "payable", supplier_payment: "payable",
  expense: "expensesPayable", other_income: "otherReceivable",
  transfer: "transit", adjustment: "owner", opening: "opening",
  reservation: "advances", tailoring: "advances", warranty: "service", gold_buy: "inventory"
};
const r4 = (v) => Math.round(Number(v || 0) * 10000) / 10000;
const day = (v) => String(v || "").slice(0, 10);

/* ---------- accounts ---------- */
async function accountMap(conn, bid) {
  for (const [code, key, name, type] of SYSTEM_ACCOUNTS) {
    await conn.query("INSERT IGNORE INTO acc_accounts (business_id, code, name, type, system_key, is_system) VALUES (?, ?, ?, ?, ?, 1)", [bid, code, name, type, key]);
  }
  const [rows] = await conn.query("SELECT id, code, system_key, money_kind, money_id, type FROM acc_accounts WHERE business_id = ?", [bid]);
  const map = new Map(rows.filter((r) => r.system_key).map((r) => [r.system_key, r.id]));
  const codes = new Set(rows.map((r) => r.code));
  // one account per money account (cash, mobile money, bank) and per expense / income category, made when first needed
  const ensure = async (key, make) => {
    if (map.has(key)) return map.get(key);
    const { code, name, type, moneyKind = null, moneyId = null } = make();
    let c = code;
    for (let i = 2; codes.has(c); i++) c = `${code}-${i}`;
    await conn.query("INSERT IGNORE INTO acc_accounts (business_id, code, name, type, system_key, money_kind, money_id, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      [bid, c, name.slice(0, 120), type, key, moneyKind, moneyId]);
    const [[r]] = await conn.query("SELECT id FROM acc_accounts WHERE business_id = ? AND system_key = ?", [bid, key]);
    codes.add(c); map.set(key, r.id);
    return r.id;
  };
  return { map, ensure };
}
const label = (s) => String(s || "other").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/* ---------- what each source record should post ---------- */
async function expectedEntries(conn, bid) {
  const out = new Map();   // "type:id" → { date, branch, ref, desc, party, lines: [[accountKey, debit, credit]] }
  const add = (type, id, e) => { e.lines = e.lines.filter(([, d, c]) => Math.abs(d) > 0.00005 || Math.abs(c) > 0.00005); if (e.lines.length) out.set(`${type}:${id}`, e); };
  const cogs = async (table, fk) => {
    const [rows] = await conn.query(`SELECT ${fk} id, SUM(qty * COALESCE(unit_cost, 0)) c FROM ${table} WHERE business_id = ? GROUP BY ${fk}`, [bid]);
    return new Map(rows.map((r) => [Number(r.id), r4(r.c)]));
  };

  const saleCost = await cogs("sale_items", "sale_id");
  const [sales] = await conn.query("SELECT id, receipt_no, customer_id, total, vat_amount, fee_amount, DATE(sold_at) d, branch_id FROM sales WHERE business_id = ? AND status <> 'cancelled'", [bid]);
  for (const s of sales) {
    const total = r4(s.total), vat = r4(s.vat_amount), fee = r4(s.fee_amount), c = saleCost.get(Number(s.id)) || 0;
    add("sale", s.id, { date: day(s.d), branch: s.branch_id, ref: s.receipt_no, desc: "Sale", party: s.customer_id ? ["customer", s.customer_id] : null,
      lines: [["receivable", total, 0], ["sales", 0, r4(total - vat - fee)], ["tax", 0, vat], ["service", 0, fee], ["cogs", c, 0], ["inventory", 0, c]] });
  }
  const invCost = await cogs("invoice_items", "invoice_id");
  const [invoices] = await conn.query("SELECT id, invoice_no, customer_id, total, vat_amount, issue_date d, branch_id FROM invoices WHERE business_id = ? AND status NOT IN ('draft','cancelled')", [bid]);
  for (const i of invoices) {
    const total = r4(i.total), vat = r4(i.vat_amount), c = invCost.get(Number(i.id)) || 0;
    add("invoice", i.id, { date: day(i.d), branch: i.branch_id, ref: i.invoice_no, desc: "Invoice", party: i.customer_id ? ["customer", i.customer_id] : null,
      lines: [["receivable", total, 0], ["sales", 0, r4(total - vat)], ["tax", 0, vat], ["cogs", c, 0], ["inventory", 0, c]] });
  }
  const [purchases] = await conn.query("SELECT id, purchase_no, supplier_id, total, DATE(COALESCE(received_at, purchased_at)) d, branch_id FROM purchases WHERE business_id = ? AND status IN ('received','partial','returned')", [bid]);
  for (const p of purchases) {
    const total = r4(p.total);
    add("purchase", p.id, { date: day(p.d), branch: p.branch_id, ref: p.purchase_no, desc: "Purchase", party: ["supplier", p.supplier_id], lines: [["inventory", total, 0], ["payable", 0, total]] });
  }
  const retCost = await cogs("return_items", "return_id");
  const [returns] = await conn.query("SELECT id, type, total, DATE(returned_at) d FROM returns WHERE business_id = ?", [bid]);
  for (const r of returns) {
    const total = r4(r.total), c = retCost.get(Number(r.id)) || 0;
    if (["purchase", "purchase_return"].includes(r.type)) add("return", r.id, { date: day(r.d), ref: `RET-${r.id}`, desc: "Return to supplier", lines: [["payable", total, 0], ["inventory", 0, total]] });
    else add("return", r.id, { date: day(r.d), ref: `RET-${r.id}`, desc: "Customer return", lines: [["sales", total, 0], ["receivable", 0, total], ["inventory", c, 0], ["cogs", 0, c]] });
  }
  for (const [table, dateCol, kind] of [["expenses", "expense_date", "expense"], ["other_income", "income_date", "income"]]) {
    const [rows] = await conn.query(`SELECT id, category, amount, ${dateCol} d, description, branch_id FROM ${table} WHERE business_id = ?`, [bid]);
    for (const e of rows) {
      const a = r4(e.amount), cat = `${kind}:${e.category || "other"}`;
      add(kind === "expense" ? "expense" : "other_income", e.id, { date: day(e.d), branch: e.branch_id, ref: `${kind === "expense" ? "EXP" : "INC"}-${e.id}`, desc: e.description || label(e.category),
        category: cat, lines: kind === "expense" ? [[cat, a, 0], ["expensesPayable", 0, a]] : [["otherReceivable", a, 0], [cat, 0, a]] });
    }
  }
  const [waste] = await conn.query("SELECT id, COALESCE(actual_cost, est_cost) c, waste_date d, branch_id FROM waste_records WHERE business_id = ? AND status = 'approved'", [bid]).catch(() => [[]]);
  for (const w of waste) { const c = r4(w.c); add("waste", w.id, { date: day(w.d), branch: w.branch_id, ref: `WST-${w.id}`, desc: "Waste", lines: [["waste", c, 0], ["inventory", 0, c]] }); }
  const [moves] = await conn.query(
    "SELECT id, type, qty_change, unit_cost, DATE(created_at) d FROM stock_movements WHERE business_id = ? AND type IN ('adjustment','count','damaged','opening') AND unit_cost IS NOT NULL", [bid]);
  for (const m of moves) {
    const v = r4(Number(m.qty_change) * Number(m.unit_cost));
    const other = m.type === "opening" ? "opening" : "stockLoss";
    add("stock", m.id, { date: day(m.d), ref: `STK-${m.id}`, desc: m.type === "opening" ? "Opening stock" : "Stock adjustment",
      lines: v >= 0 ? [["inventory", v, 0], [other, 0, v]] : [[other, -v, 0], ["inventory", 0, -v]] });
  }
  const [money] = await conn.query("SELECT id, cash_account_id, bank_account_id, direction, amount, ref_type, ref_id, description, DATE(occurred_at) d FROM cash_transactions WHERE business_id = ?", [bid]);
  for (const t of money) {
    const a = r4(t.amount);
    const acc = t.bank_account_id ? `money:bank:${t.bank_account_id}` : `money:cash:${t.cash_account_id}`;
    const counter = MONEY_COUNTER[t.ref_type] || "suspense";
    add("money", t.id, { date: day(t.d), ref: `${t.ref_type}${t.ref_id ? `-${t.ref_id}` : ""}`, desc: t.description || label(t.ref_type), moneyKind: t.ref_type,
      lines: t.direction === "in" ? [[acc, a, 0], [counter, 0, a]] : [[counter, a, 0], [acc, 0, a]] });
  }
  return out;
}

const fingerprint = (e) => crypto.createHash("sha1").update(JSON.stringify([e.date, e.branch || null, e.lines.map(([k, d, c]) => [k, r4(d), r4(c)])])).digest("hex");

/* ---------- posting ---------- */
async function insertEntry(conn, bid, { sourceType, sourceId, revision, kind, current, fp, e, lines, reversesId = null }) {
  const [r] = await conn.query(
    `INSERT INTO acc_entries (business_id, source_type, source_id, revision, kind, is_current, fingerprint, entry_date, branch_id, reference, description, party_type, party_id, reverses_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [bid, sourceType, sourceId, revision, kind, current ? 1 : 0, fp, e.date, e.branch || null, e.ref ? String(e.ref).slice(0, 80) : null, e.desc ? String(e.desc).slice(0, 255) : null,
      e.party?.[0] || null, e.party?.[1] || null, reversesId]);
  for (const [accountId, d, c] of lines) {
    await conn.query("INSERT INTO acc_lines (entry_id, business_id, account_id, debit, credit, entry_date, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [r.insertId, bid, accountId, r4(d), r4(c), e.date, e.branch || null]);
  }
  return r.insertId;
}

const lastSync = new Map();
/** Brings the books up to date with every module's records. Returns { posted, reversed }. */
export async function syncBooks(db, bid, { force = false } = {}) {
  const now = Date.now();
  if (!force && lastSync.get(bid) && now - lastSync.get(bid) < 15000) return { skipped: true };
  const conn = await db.getConnection();
  let posted = 0, reversed = 0;
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK(?, 20) ok", [`faatix_acc_${bid}`]);
    if (!lock.ok) return { busy: true };
    try {
      const { ensure } = await accountMap(conn, bid);
      const resolve = async (key) => {
        if (key.startsWith("money:")) {
          const [, kind, id] = key.split(":");
          return ensure(key, () => ({ code: `${kind === "bank" ? "1050" : "1010"}.${id}`, name: `${kind === "bank" ? "Bank" : "Cash"} #${id}`, type: "asset", moneyKind: kind, moneyId: Number(id) }));
        }
        if (key.startsWith("expense:") || key.startsWith("income:")) {
          const [kind, cat] = key.split(":");
          return ensure(key, () => ({ code: `${kind === "expense" ? "6000" : "4500"}.${cat.slice(0, 12)}`, name: `${kind === "expense" ? "" : "Other income – "}${label(cat)}`, type: kind === "expense" ? "expense" : "revenue" }));
        }
        return ensure(key, () => { throw new Error(`unknown account ${key}`); });
      };
      const expected = await expectedEntries(conn, bid);
      const [cur] = await conn.query("SELECT id, source_type, source_id, revision, fingerprint FROM acc_entries WHERE business_id = ? AND kind = 'post' AND is_current = 1", [bid]);
      const current = new Map(cur.map((c) => [`${c.source_type}:${c.source_id}`, c]));
      const work = [];
      for (const [k, e] of expected) {
        const fp = fingerprint(e);
        const c = current.get(k);
        if (!c) work.push({ k, e, fp, prev: null });
        else if (c.fingerprint !== fp) work.push({ k, e, fp, prev: c });
      }
      for (const [k, c] of current) if (!expected.has(k)) work.push({ k, e: null, fp: null, prev: c });
      // in batches, each one transaction: a failure leaves no half-posted entry
      for (let i = 0; i < work.length; i += 200) {
        await conn.beginTransaction();
        try {
          for (const w of work.slice(i, i + 200)) {
            const [sourceType, sourceIdRaw] = w.k.split(":");
            const sourceId = Number(sourceIdRaw);
            let nextRev = 1;
            if (w.prev) {
              // reverse what was posted: the same lines, debit and credit swapped, dated today
              const [lines] = await conn.query("SELECT account_id, debit, credit FROM acc_lines WHERE entry_id = ?", [w.prev.id]);
              const [[orig]] = await conn.query("SELECT * FROM acc_entries WHERE id = ?", [w.prev.id]);
              await insertEntry(conn, bid, { sourceType, sourceId, revision: w.prev.revision, kind: "reversal", current: false, fp: w.prev.fingerprint,
                e: { date: new Date().toISOString().slice(0, 10), branch: orig.branch_id, ref: orig.reference, desc: `Reversal: ${orig.description || ""}`, party: orig.party_type ? [orig.party_type, orig.party_id] : null },
                lines: lines.map((l) => [l.account_id, Number(l.credit), Number(l.debit)]), reversesId: w.prev.id });
              await conn.query("UPDATE acc_entries SET is_current = 0 WHERE id = ?", [w.prev.id]);
              reversed++;
              nextRev = w.prev.revision + 1;
            } else {
              const [[m]] = await conn.query("SELECT MAX(revision) r FROM acc_entries WHERE business_id = ? AND source_type = ? AND source_id = ?", [bid, sourceType, sourceId]);
              nextRev = (Number(m.r) || 0) + 1;
            }
            if (w.e) {
              const lines = [];
              for (const [key, d, c] of w.e.lines) lines.push([await resolve(key), d, c]);
              const dr = lines.reduce((s, l) => s + l[1], 0), cr = lines.reduce((s, l) => s + l[2], 0);
              if (Math.abs(dr - cr) > 0.001) throw new Error(`unbalanced ${w.k}: ${dr} / ${cr}`);
              await insertEntry(conn, bid, { sourceType, sourceId, revision: nextRev, kind: "post", current: true, fp: w.fp, e: w.e, lines });
              posted++;
            }
          }
          await conn.commit();
        } catch (err) { await conn.rollback(); throw err; }
      }
      await nameMoneyAccounts(conn, bid);
      lastSync.set(bid, Date.now());
      return { posted, reversed };
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [`faatix_acc_${bid}`]);
    }
  } finally {
    conn.release();
  }
}
export const forgetSync = (bid) => lastSync.delete(bid);

/* money accounts carry their real names (cash account name, bank · account) */
async function nameMoneyAccounts(conn, bid) {
  await conn.query(`UPDATE acc_accounts a JOIN cash_accounts c ON c.id = a.money_id AND c.business_id = a.business_id SET a.name = c.name
                     WHERE a.business_id = ? AND a.money_kind = 'cash' AND a.name <> c.name`, [bid]);
  await conn.query(`UPDATE acc_accounts a JOIN bank_accounts b ON b.id = a.money_id AND b.business_id = a.business_id SET a.name = LEFT(CONCAT(b.bank_name, ' · ', b.account_name), 120)
                     WHERE a.business_id = ? AND a.money_kind = 'bank'`, [bid]);
}
