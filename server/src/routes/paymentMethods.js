import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, text, optText, id, withTx, ensureOwned, badRequest, METHODS } from "../lib/http.js";
import { resolveAccount } from "../lib/ledger.js";

/*
 * POS payment methods, set up per business (Settings → Payment methods):
 * e.g. "Cash", "E-Dahab (136227)", "Premier Wallet (310078)", "Salaam Bank".
 * Each method has a kind (cash / mobile_money / bank) and its own money account,
 * so the Cash & bank page shows a separate balance for every wallet or bank.
 */
const router = Router();
router.use(requireAuth);

const label = (m) => (m.number ? `${m.name} (${m.number})` : m.name);
const shape = (m) => ({
  id: m.id, name: m.name, number: m.number, kind: m.kind, label: label(m),
  isActive: Boolean(m.is_active), sortOrder: m.sort_order
});

/* Creates the money account a new method pays into. */
async function createAccount(conn, bid, kind, name, number) {
  if (kind === "bank") {
    const [r] = await conn.query("INSERT INTO bank_accounts (business_id, bank_name, account_name, account_number) VALUES (?, ?, ?, ?)", [bid, name, name, number]);
    return { cash_account_id: null, bank_account_id: r.insertId };
  }
  const accName = (number ? `${name} (${number})` : name).slice(0, 100);
  await conn.query("INSERT IGNORE INTO cash_accounts (business_id, name, is_default) VALUES (?, ?, 0)", [bid, accName]);
  const [[a]] = await conn.query("SELECT id FROM cash_accounts WHERE business_id = ? AND name = ?", [bid, accName]);
  return { cash_account_id: a.id, bank_account_id: null };
}

/* First use: Cash, Mobile money and one method per existing bank account. */
export async function ensureDefaultMethods(bid) {
  const [[has]] = await pool.query("SELECT COUNT(*) n FROM payment_methods WHERE business_id = ?", [bid]);
  if (has.n) return;
  await withTx(async (conn) => {
    await conn.query("SELECT id FROM businesses WHERE id = ? FOR UPDATE", [bid]); // one seeding at a time
    const [[again]] = await conn.query("SELECT COUNT(*) n FROM payment_methods WHERE business_id = ?", [bid]);
    if (again.n) return;
    let order = 0;
    for (const kind of ["cash", "mobile_money"]) {
      const acc = await resolveAccount(conn, bid, kind, null);
      await conn.query("INSERT INTO payment_methods (business_id, name, kind, cash_account_id, sort_order) VALUES (?, ?, ?, ?, ?)",
        [bid, kind === "cash" ? "Cash" : "Mobile money", kind, acc.cash_account_id, order++]);
    }
    const [banks] = await conn.query("SELECT id, bank_name, account_number FROM bank_accounts WHERE business_id = ? ORDER BY id", [bid]);
    for (const b of banks) {
      await conn.query("INSERT INTO payment_methods (business_id, name, number, kind, bank_account_id, sort_order) VALUES (?, ?, ?, 'bank', ?, ?)",
        [bid, b.bank_name, b.account_number, b.id, order++]);
    }
  });
}

/* Loads an active method of this business for a payment: kind + account to put money in. */
export async function methodForPayment(conn, bid, methodId) {
  const [[m]] = await conn.query("SELECT * FROM payment_methods WHERE id = ? AND business_id = ? AND is_active = 1", [methodId, bid]);
  if (!m) return null;
  return { id: m.id, kind: m.kind, label: label(m), account: { cash_account_id: m.cash_account_id, bank_account_id: m.bank_account_id } };
}

function readMethod(body, { creating }) {
  const d = { name: text(body.name, 80), number: optText(body.number, 60), kind: body.kind, isActive: body.isActive === undefined ? true : Boolean(body.isActive) };
  const e = {};
  if (!d.name) e.name = "required";
  if (creating && !METHODS.includes(d.kind)) e.kind = "required";
  if (Object.keys(e).length) throw badRequest(e);
  return d;
}

/* GET /api/payment-methods        → active methods (POS)
 * GET /api/payment-methods?all=1  → all methods (Settings, owner) */
router.get("/", ah(async (req, res) => {
  const bid = req.business.id;
  await ensureDefaultMethods(bid);
  const all = req.query.all === "1" && can(req.user, "settings.edit");
  const [rows] = await pool.query(
    `SELECT * FROM payment_methods WHERE business_id = ? ${all ? "" : "AND is_active = 1"} ORDER BY sort_order, id`, [bid]
  );
  res.json({ methods: rows.map(shape) });
}));

router.post("/", requirePerm("settings.edit"), ah(async (req, res) => {
  const d = readMethod(req.body || {}, { creating: true });
  const bid = req.business.id;
  await ensureDefaultMethods(bid);
  const newId = await withTx(async (conn) => {
    const acc = await createAccount(conn, bid, d.kind, d.name, d.number);
    const [[o]] = await conn.query("SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM payment_methods WHERE business_id = ?", [bid]);
    const [r] = await conn.query(
      "INSERT INTO payment_methods (business_id, name, number, kind, cash_account_id, bank_account_id, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [bid, d.name, d.number, d.kind, acc.cash_account_id, acc.bank_account_id, d.isActive ? 1 : 0, o.n]
    );
    await audit(conn, { businessId: bid, userId: req.user.id, action: "paymentMethod.created", entity: "payment_method", entityId: r.insertId, meta: { name: d.name, kind: d.kind }, ip: req.ip });
    return r.insertId;
  });
  res.status(201).json({ id: newId });
}));

/* PUT /api/payment-methods/:id  { name, number, isActive } — the kind can't change after creation */
router.put("/:id", requirePerm("settings.edit"), ah(async (req, res) => {
  const d = readMethod(req.body || {}, { creating: false });
  const bid = req.business.id;
  await withTx(async (conn) => {
    const m = await ensureOwned(conn, "payment_methods", id(req.params.id), bid, true);
    await conn.query("UPDATE payment_methods SET name = ?, number = ?, is_active = ? WHERE id = ? AND business_id = ?", [d.name, d.number, d.isActive ? 1 : 0, m.id, bid]);
    await audit(conn, { businessId: bid, userId: req.user.id, action: "paymentMethod.updated", entity: "payment_method", entityId: m.id, meta: { name: d.name, active: d.isActive }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/* PATCH /api/payment-methods/:id/move  { dir: "up" | "down" } — order shown on the payment screen */
router.patch("/:id/move", requirePerm("settings.edit"), ah(async (req, res) => {
  const bid = req.business.id;
  const dir = req.body?.dir === "up" ? "up" : "down";
  await withTx(async (conn) => {
    const m = await ensureOwned(conn, "payment_methods", id(req.params.id), bid, true);
    const [list] = await conn.query("SELECT id, sort_order FROM payment_methods WHERE business_id = ? ORDER BY sort_order, id FOR UPDATE", [bid]);
    const i = list.findIndex((x) => x.id === m.id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) await conn.query("UPDATE payment_methods SET sort_order = ? WHERE id = ? AND business_id = ?", [k, list[k].id, bid]);
  });
  res.json({ code: "saved" });
}));

export default router;
