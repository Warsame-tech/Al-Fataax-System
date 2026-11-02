import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, withTx, ensureOwned, badRequest, conflict, num, round2, range } from "../lib/http.js";
import { branchesOf, forgetBranches } from "../lib/branches.js";

/*
 * Branches (lib/branches.js): the owner adds branches, each selling from its own stock location; staff are assigned to a
 * branch (or work in all of them); reports compare the branches and add them up (consolidated).
 *   GET /api/branches · POST /api/branches · PUT /api/branches/:id          (settings.edit)
 *   GET /api/branches/staff · PUT /api/branches/staff/:userId { branchId }  (staff.manage)
 *   GET /api/branches/summary?from&to                                       sales, gross profit, expenses, net per branch
 */
const router = Router();
router.use(requireAuth);

router.get("/", ah(async (req, res) => {
  await branchesOf(pool, req.business.id);
  const [rows] = await pool.query(
    `SELECT b.*, l.name location_name,
            (SELECT COUNT(*) FROM business_user_roles r WHERE r.business_id = b.business_id AND r.branch_id = b.id) staff,
            (SELECT COUNT(*) FROM stock_locations s WHERE s.business_id = b.business_id AND s.branch_id = b.id AND s.is_active = 1) locations
       FROM branches b LEFT JOIN stock_locations l ON l.id = b.sell_location_id WHERE b.business_id = ? ORDER BY b.is_main DESC, b.name`, [req.business.id]);
  res.json({ branches: rows.map((b) => ({ id: b.id, name: b.name, address: b.address || "", phone: b.phone || "", sellLocationId: b.sell_location_id, sellLocation: b.location_name || null,
    isMain: Boolean(b.is_main), isActive: Boolean(b.is_active), staff: Number(b.staff), locations: Number(b.locations) })), current: req.branch.filterId, fixed: req.branch.fixed });
}));

function readBranch(b) {
  const d = { name: text(b.name, 100), address: optText(b.address, 200), phone: optText(b.phone, 30), sellLocationId: id(b.sellLocationId) };
  if (!d.name) throw badRequest({ name: "required" });
  return d;
}
const nameTaken = (err) => (err.code === "ER_DUP_ENTRY" ? badRequest({ name: "branchNameTaken" }) : err);

/** POST { name, address?, phone?, sellLocationId? } — without a selling location, a shop location of the same name is made */
router.post("/", requirePerm("settings.edit"), ah(async (req, res) => {
  const d = readBranch(req.body || {});
  try {
    const r = await withTx(async (conn) => {
      await branchesOf(conn, req.business.id);   // the main branch exists first
      const [x] = await conn.query("INSERT INTO branches (business_id, name, address, phone) VALUES (?, ?, ?, ?)", [req.business.id, d.name, d.address, d.phone]);
      let loc = d.sellLocationId;
      if (loc) {
        const l = await ensureOwned(conn, "stock_locations", loc, req.business.id, true);
        await conn.query("UPDATE stock_locations SET branch_id = ? WHERE id = ?", [x.insertId, l.id]);
      } else {
        const [l] = await conn.query("INSERT INTO stock_locations (business_id, name, kind, address, branch_id) VALUES (?, ?, 'shop', ?, ?)", [req.business.id, d.name, d.address, x.insertId]);
        loc = l.insertId;
      }
      await conn.query("UPDATE branches SET sell_location_id = ? WHERE id = ?", [loc, x.insertId]);
      await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "branch.created", entity: "branch", entityId: x.insertId, meta: d, ip: req.ip });
      return { id: x.insertId, sellLocationId: loc };
    });
    forgetBranches(req.business.id);
    res.status(201).json(r);
  } catch (err) { throw nameTaken(err); }
}));

router.put("/:id", requirePerm("settings.edit"), ah(async (req, res) => {
  const d = readBranch(req.body || {});
  const active = req.body?.isActive !== false;
  try {
    await withTx(async (conn) => {
      const b = await ensureOwned(conn, "branches", id(req.params.id), req.business.id, true);
      if (b.is_main && !active) throw conflict("mainBranchActive");
      if (d.sellLocationId) {
        await ensureOwned(conn, "stock_locations", d.sellLocationId, req.business.id);
        await conn.query("UPDATE stock_locations SET branch_id = ? WHERE id = ?", [b.id, d.sellLocationId]);
      }
      await conn.query("UPDATE branches SET name = ?, address = ?, phone = ?, sell_location_id = COALESCE(?, sell_location_id), is_active = ? WHERE id = ?",
        [d.name, d.address, d.phone, d.sellLocationId, active ? 1 : 0, b.id]);
      await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "branch.changed", entity: "branch", entityId: b.id, meta: { ...d, active }, ip: req.ip });
    });
    forgetBranches(req.business.id);
    res.json({ code: "saved" });
  } catch (err) { throw nameTaken(err); }
}));

/* ---------- which branch each staff member works in ---------- */
router.get("/staff", requirePerm("staff.manage"), ah(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.username, r.role, r.branch_id, ro.name role_name FROM users u JOIN business_user_roles r ON r.user_id = u.id AND r.business_id = u.business_id
       LEFT JOIN roles ro ON ro.id = r.role_id WHERE u.business_id = ? AND u.status = 'active' ORDER BY u.full_name`, [req.business.id]);
  res.json({ staff: rows.map((u) => ({ id: u.id, name: u.full_name, username: u.username, role: u.role === "owner" ? "owner" : u.role_name || u.role, branchId: u.branch_id })) });
}));
router.put("/staff/:userId", requirePerm("staff.manage"), ah(async (req, res) => {
  const branchId = req.body?.branchId ? id(req.body.branchId) : null;
  await withTx(async (conn) => {
    const [[r]] = await conn.query("SELECT role FROM business_user_roles WHERE business_id = ? AND user_id = ? FOR UPDATE", [req.business.id, id(req.params.userId)]);
    if (!r) throw badRequest({ userId: "required" });
    if (r.role === "owner" && branchId) throw conflict("ownerAllBranches");
    if (branchId) await ensureOwned(conn, "branches", branchId, req.business.id);
    await conn.query("UPDATE business_user_roles SET branch_id = ? WHERE business_id = ? AND user_id = ?", [branchId, req.business.id, id(req.params.userId)]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "staff.branch", entity: "user", entityId: id(req.params.userId), meta: { branchId }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));

/** GET /api/branches/summary?from&to — each branch and the consolidated total (owners / all-branch users) */
router.get("/summary", (req, res, next) => (can(req.user, "reports.view") || can(req.user, "dashboard.finance") ? next() : res.status(403).json({ code: "forbidden" })), ah(async (req, res) => {
  if (req.branch.fixed) throw conflict("forbidden");   // a branch's staff see their own branch only
  const bid = req.business.id;
  const r = range(req.query, 30);
  const list = await branchesOf(pool, bid);
  const by = async (sql, params) => new Map((await pool.query(sql, params))[0].map((x) => [x.branch_id, x]));
  const [sales, invs, scogs, icogs, exp, inc, orders] = await Promise.all([
    by("SELECT branch_id, COUNT(*) n, COALESCE(SUM(total - vat_amount - fee_amount),0) v, COALESCE(SUM(discount),0) d FROM sales WHERE business_id = ? AND status <> 'cancelled' AND sold_at BETWEEN ? AND ? GROUP BY branch_id", [bid, r.start, r.end]),
    by("SELECT branch_id, COUNT(*) n, COALESCE(SUM(total - vat_amount),0) v FROM invoices WHERE business_id = ? AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN ? AND ? GROUP BY branch_id", [bid, r.from, r.to]),
    by("SELECT s.branch_id, COALESCE(SUM(si.qty * si.unit_cost),0) v FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.business_id = ? AND s.status <> 'cancelled' AND s.sold_at BETWEEN ? AND ? GROUP BY s.branch_id", [bid, r.start, r.end]),
    by("SELECT i.branch_id, COALESCE(SUM(ii.qty * ii.unit_cost),0) v FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.business_id = ? AND i.status NOT IN ('draft','cancelled') AND i.issue_date BETWEEN ? AND ? GROUP BY i.branch_id", [bid, r.from, r.to]),
    by("SELECT branch_id, COALESCE(SUM(amount),0) v FROM expenses WHERE business_id = ? AND expense_date BETWEEN ? AND ? GROUP BY branch_id", [bid, r.from, r.to]),
    by("SELECT branch_id, COALESCE(SUM(amount),0) v FROM other_income WHERE business_id = ? AND income_date BETWEEN ? AND ? GROUP BY branch_id", [bid, r.from, r.to]),
    by("SELECT branch_id, COUNT(*) n FROM food_orders WHERE business_id = ? AND status NOT IN ('merged','cancelled') AND created_at BETWEEN ? AND ? GROUP BY branch_id", [bid, r.start, r.end])
  ]);
  const rows = list.map((b) => {
    const revenue = round2(num(sales.get(b.id)?.v) + num(invs.get(b.id)?.v));
    const cogs = round2(num(scogs.get(b.id)?.v) + num(icogs.get(b.id)?.v));
    const gross = round2(revenue - cogs);
    const expenses = num(exp.get(b.id)?.v);
    const other = num(inc.get(b.id)?.v);
    return { id: b.id, name: b.name, isMain: Boolean(b.is_main), sales: Number(sales.get(b.id)?.n || 0) + Number(invs.get(b.id)?.n || 0), orders: Number(orders.get(b.id)?.n || 0),
      revenue, cogs, grossProfit: gross, expenses, otherIncome: other, netProfit: round2(gross - expenses + other) };
  });
  const sum = (k) => round2(rows.reduce((s, x) => s + x[k], 0));
  res.json({ range: r, branches: rows, total: { sales: sum("sales"), orders: sum("orders"), revenue: sum("revenue"), cogs: sum("cogs"), grossProfit: sum("grossProfit"), expenses: sum("expenses"), otherIncome: sum("otherIncome"), netProfit: sum("netProfit") } });
}));

export default router;
