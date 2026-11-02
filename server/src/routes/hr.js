import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth, audit } from "../middleware/auth.js";
import { can, requirePerm } from "../lib/permissions.js";
import { ah, id, text, optText, money, withTx, ensureOwned, badRequest, conflict, num, round2, isDate, today } from "../lib/http.js";
import { recordEntry } from "./money.js";

/*
 * Staff: employees, work shifts (schedule), attendance (clock in / out), payroll and performance — every business type.
 *   employees    name, position, pay (monthly / daily / hourly rate); may be linked to a staff login (clock in themselves)
 *   shifts       planned work: date, start, end (end before start = overnight)
 *   attendance   clock in / out by the employee, or entered / corrected by a manager (kept with who did it)
 *   payroll      a run for a period: monthly pay (prorated for a shorter period), days worked × daily rate, or hours × hourly
 *                rate; additions and deductions per line while a draft; paying it records one Salaries expense
 *   performance  hours scheduled vs worked, late arrivals, sales and orders taken (staff with a login)
 * Permissions: hr.view (see), hr.manage (employees, shifts, attendance), hr.payroll (payroll).
 */
const router = Router();
router.use(requireAuth);

const PAY_TYPES = ["monthly", "daily", "hourly"];
const LATE_MIN = 10;   // minutes after the shift start that count as late
const q2 = (v) => Math.round(Number(v) * 100) / 100;
const dt = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) ? new Date(v.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v.replace(" ", "T")}Z`) : null);
const sqlDt = (d) => d.toISOString().slice(0, 19).replace("T", " ");

/* ---------------- employees ---------------- */
const shapeEmp = (e) => ({ id: e.id, userId: e.user_id, username: e.username || null, name: e.full_name, phone: e.phone || "", position: e.position || "",
  payType: e.pay_type, payRate: num(e.pay_rate), hiredOn: e.hired_on, isActive: Boolean(e.is_active), notes: e.notes || "" });

router.get("/employees", requirePerm("hr.view"), ah(async (req, res) => {
  const [rows] = await pool.query("SELECT e.*, u.username FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.business_id = ? ORDER BY e.is_active DESC, e.full_name", [req.business.id]);
  const [staff] = await pool.query("SELECT u.id, u.full_name, u.username FROM users u WHERE u.business_id = ? AND u.status = 'active' ORDER BY u.full_name", [req.business.id]);
  res.json({ employees: rows.map(shapeEmp), logins: staff.map((u) => ({ id: u.id, name: u.full_name, username: u.username })) });
}));
async function readEmployee(conn, req, b) {
  const d = { name: text(b.name, 150), phone: optText(b.phone, 30), position: optText(b.position, 80), payType: PAY_TYPES.includes(b.payType) ? b.payType : null,
    payRate: money(b.payRate), hiredOn: isDate(b.hiredOn) ? b.hiredOn : null, userId: id(b.userId), notes: optText(b.notes, 255), isActive: b.isActive !== false };
  const e = {};
  if (!d.name) e.name = "required";
  if (!d.payType) e.payType = "required";
  if (Number.isNaN(d.payRate) || d.payRate < 0) e.payRate = "invalidAmount";
  if (Object.keys(e).length) throw badRequest(e);
  if (d.userId) await ensureOwned(conn, "users", d.userId, req.business.id);
  return d;
}
const empTaken = (err) => (err.code === "ER_DUP_ENTRY" ? badRequest({ userId: "loginLinked" }) : err);
router.post("/employees", requirePerm("hr.manage"), ah(async (req, res) => {
  try {
    const r = await withTx(async (conn) => {
      const d = await readEmployee(conn, req, req.body || {});
      const [x] = await conn.query("INSERT INTO employees (business_id, user_id, full_name, phone, position, pay_type, pay_rate, hired_on, notes, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [req.business.id, d.userId, d.name, d.phone, d.position, d.payType, d.payRate, d.hiredOn, d.notes, id(req.body?.branchId) || req.branch.id]);
      await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "employee.created", entity: "employee", entityId: x.insertId, meta: { name: d.name, payType: d.payType, payRate: d.payRate }, ip: req.ip });
      return { id: x.insertId };
    });
    res.status(201).json(r);
  } catch (err) { throw empTaken(err); }
}));
router.put("/employees/:id", requirePerm("hr.manage"), ah(async (req, res) => {
  try {
    await withTx(async (conn) => {
      const e = await ensureOwned(conn, "employees", id(req.params.id), req.business.id, true);
      const d = await readEmployee(conn, req, req.body || {});
      await conn.query("UPDATE employees SET user_id = ?, full_name = ?, phone = ?, position = ?, pay_type = ?, pay_rate = ?, hired_on = ?, notes = ?, is_active = ? WHERE id = ?",
        [d.userId, d.name, d.phone, d.position, d.payType, d.payRate, d.hiredOn, d.notes, d.isActive ? 1 : 0, e.id]);
      const changes = num(e.pay_rate) !== d.payRate || e.pay_type !== d.payType ? { pay: { from: `${e.pay_type} ${num(e.pay_rate)}`, to: `${d.payType} ${d.payRate}` } } : {};
      await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "employee.changed", entity: "employee", entityId: e.id, meta: { name: d.name, active: d.isActive, ...changes }, ip: req.ip });
    });
    res.json({ code: "saved" });
  } catch (err) { throw empTaken(err); }
}));

/* ---------------- attendance ---------------- */
async function myEmployee(db, req) {
  const [[e]] = await db.query("SELECT * FROM employees WHERE business_id = ? AND user_id = ? AND is_active = 1", [req.business.id, req.user.id]);
  return e || null;
}
/** GET /api/hr/me — my employee record, open clock-in and today's shift */
router.get("/me", ah(async (req, res) => {
  const e = await myEmployee(pool, req);
  if (!e) return res.json({ employee: null });
  const [[open]] = await pool.query("SELECT id, clock_in FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1", [e.id]);
  const [shifts] = await pool.query("SELECT shift_date, start_time, end_time FROM work_shifts WHERE employee_id = ? AND shift_date = ?", [e.id, today()]);
  res.json({ employee: shapeEmp(e), open: open ? { id: open.id, clockIn: open.clock_in } : null, shifts: shifts.map((s) => ({ start: s.start_time, end: s.end_time })) });
}));
/** POST /api/hr/clock { action: in | out, note? } — the signed-in employee */
router.post("/clock", ah(async (req, res) => {
  const action = req.body?.action;
  if (!["in", "out"].includes(action)) throw badRequest({ action: "required" });
  const r = await withTx(async (conn) => {
    const e = await myEmployee(conn, req);
    if (!e) throw conflict("notAnEmployee");
    const [[open]] = await conn.query("SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE", [e.id]);
    if (action === "in") {
      if (open) throw conflict("alreadyClockedIn");
      const [x] = await conn.query("INSERT INTO attendance (business_id, employee_id, clock_in, source, note, user_id) VALUES (?, ?, UTC_TIMESTAMP(), 'self', ?, ?)", [req.business.id, e.id, optText(req.body?.note, 200), req.user.id]);
      return { id: x.insertId };
    }
    if (!open) throw conflict("notClockedIn");
    await conn.query("UPDATE attendance SET clock_out = UTC_TIMESTAMP(), minutes = TIMESTAMPDIFF(MINUTE, clock_in, UTC_TIMESTAMP()), note = COALESCE(?, note) WHERE id = ?", [optText(req.body?.note, 200), open.id]);
    return { id: open.id };
  });
  res.json(r);
}));
/** POST /api/hr/attendance { employeeId, clockIn, clockOut?, note } and PUT /api/hr/attendance/:id — a manager enters or corrects */
function readAttendance(b) {
  const inAt = dt(b.clockIn);
  const outAt = b.clockOut ? dt(b.clockOut) : null;
  const e = {};
  if (!inAt) e.clockIn = "required";
  if (b.clockOut && !outAt) e.clockOut = "required";
  if (inAt && outAt && outAt <= inAt) e.clockOut = "beforeIssue";
  if (inAt && inAt > new Date(Date.now() + 5 * 60000)) e.clockIn = "future";
  if (!text(b.note, 200)) e.note = "required";   // a manager entry always says why
  if (Object.keys(e).length) throw badRequest(e);
  return { inAt, outAt, minutes: outAt ? Math.round((outAt - inAt) / 60000) : null, note: text(b.note, 200) };
}
router.post("/attendance", requirePerm("hr.manage"), ah(async (req, res) => {
  const d = readAttendance(req.body || {});
  const r = await withTx(async (conn) => {
    const e = await ensureOwned(conn, "employees", id(req.body?.employeeId), req.business.id);
    const [x] = await conn.query("INSERT INTO attendance (business_id, employee_id, clock_in, clock_out, minutes, source, note, user_id) VALUES (?, ?, ?, ?, ?, 'manager', ?, ?)",
      [req.business.id, e.id, sqlDt(d.inAt), d.outAt ? sqlDt(d.outAt) : null, d.minutes, d.note, req.user.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "attendance.entered", entity: "attendance", entityId: x.insertId, meta: { employee: e.full_name, minutes: d.minutes, note: d.note }, ip: req.ip });
    return { id: x.insertId };
  });
  res.status(201).json(r);
}));
router.put("/attendance/:id", requirePerm("hr.manage"), ah(async (req, res) => {
  const d = readAttendance(req.body || {});
  await withTx(async (conn) => {
    const a = await ensureOwned(conn, "attendance", id(req.params.id), req.business.id, true);
    await conn.query("UPDATE attendance SET clock_in = ?, clock_out = ?, minutes = ?, note = ?, edited_by = ? WHERE id = ?", [sqlDt(d.inAt), d.outAt ? sqlDt(d.outAt) : null, d.minutes, d.note, req.user.id, a.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "attendance.corrected", entity: "attendance", entityId: a.id,
      meta: { from: { in: a.clock_in, out: a.clock_out }, to: { in: sqlDt(d.inAt), out: d.outAt ? sqlDt(d.outAt) : null }, note: d.note }, ip: req.ip });
  });
  res.json({ code: "saved" });
}));
const dayRange = (q) => {
  const from = isDate(q.from) ? q.from : today();
  const to = isDate(q.to) ? q.to : from;
  return { from, to, start: `${from} 00:00:00`, end: `${to} 23:59:59` };
};
router.get("/attendance", requirePerm("hr.view"), ah(async (req, res) => {
  const r = dayRange(req.query);
  const where = ["a.business_id = ?", "a.clock_in BETWEEN ? AND ?"];
  const params = [req.business.id, r.start, r.end];
  if (id(req.query.employeeId)) { where.push("a.employee_id = ?"); params.push(id(req.query.employeeId)); }
  const [rows] = await pool.query(
    `SELECT a.*, e.full_name, u.full_name user_name, x.full_name editor FROM attendance a JOIN employees e ON e.id = a.employee_id
       LEFT JOIN users u ON u.id = a.user_id LEFT JOIN users x ON x.id = a.edited_by WHERE ${where.join(" AND ")} ORDER BY a.clock_in DESC LIMIT 1000`, params);
  res.json({ ...r, attendance: rows.map((a) => ({ id: a.id, employeeId: a.employee_id, employee: a.full_name, clockIn: a.clock_in, clockOut: a.clock_out,
    minutes: a.minutes === null ? null : Number(a.minutes), source: a.source, note: a.note || "", by: a.user_name, editedBy: a.editor || null })) });
}));

/* ---------------- work shifts (schedule) ---------------- */
router.get("/shifts", requirePerm("hr.view"), ah(async (req, res) => {
  const r = dayRange(req.query);
  const [rows] = await pool.query(
    `SELECT s.*, e.full_name FROM work_shifts s JOIN employees e ON e.id = s.employee_id WHERE s.business_id = ? AND s.shift_date BETWEEN ? AND ? ORDER BY s.shift_date, s.start_time`,
    [req.business.id, r.from, r.to]);
  res.json({ ...r, shifts: rows.map((s) => ({ id: s.id, employeeId: s.employee_id, employee: s.full_name, date: s.shift_date, start: String(s.start_time).slice(0, 5), end: String(s.end_time).slice(0, 5), note: s.note || "" })) });
}));
router.post("/shifts", requirePerm("hr.manage"), ah(async (req, res) => {
  const b = req.body || {};
  const time = (v) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null);
  const days = (Array.isArray(b.dates) ? b.dates : [b.date]).filter(isDate).slice(0, 62);
  const e = {};
  if (!days.length) e.date = "required";
  if (!time(b.start)) e.start = "required";
  if (!time(b.end)) e.end = "required";
  if (Object.keys(e).length) throw badRequest(e);
  const r = await withTx(async (conn) => {
    const emp = await ensureOwned(conn, "employees", id(b.employeeId), req.business.id);
    for (const day of days) {
      await conn.query("INSERT INTO work_shifts (business_id, employee_id, shift_date, start_time, end_time, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [req.business.id, emp.id, day, b.start, b.end, optText(b.note, 120), req.user.id]);
    }
    return { count: days.length };
  });
  res.status(201).json(r);
}));
router.delete("/shifts/:id", requirePerm("hr.manage"), ah(async (req, res) => {
  const s = await ensureOwned(pool, "work_shifts", id(req.params.id), req.business.id);
  await pool.query("DELETE FROM work_shifts WHERE id = ?", [s.id]);
  res.json({ code: "saved" });
}));

/* ---------------- performance ---------------- */
async function performance(db, businessId, r) {
  // shift times are the business clock: clock-ins (UTC) are read in the business time zone
  const [[set]] = await db.query("SELECT timezone FROM business_settings WHERE business_id = ?", [businessId]);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: set?.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const local = (v) => {
    const d = v instanceof Date ? v : new Date(`${String(v).replace(" ", "T")}Z`);
    const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
  };
  const [emps] = await db.query("SELECT * FROM employees WHERE business_id = ? AND is_active = 1 ORDER BY full_name", [businessId]);
  const [att] = await db.query("SELECT employee_id, clock_in, minutes FROM attendance WHERE business_id = ? AND clock_in BETWEEN ? AND ?", [businessId, r.start, r.end]);
  const [shifts] = await db.query("SELECT employee_id, shift_date, start_time, end_time FROM work_shifts WHERE business_id = ? AND shift_date BETWEEN ? AND ?", [businessId, r.from, r.to]);
  const [sales] = await db.query("SELECT user_id, COUNT(*) n, COALESCE(SUM(total), 0) total FROM sales WHERE business_id = ? AND status = 'completed' AND sold_at BETWEEN ? AND ? GROUP BY user_id", [businessId, r.start, r.end]);
  const [orders] = await db.query("SELECT user_id, COUNT(*) n FROM food_orders WHERE business_id = ? AND status <> 'merged' AND created_at BETWEEN ? AND ? GROUP BY user_id", [businessId, r.start, r.end]);
  const mins = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
  return emps.map((e) => {
    const mine = att.filter((a) => a.employee_id === e.id);
    const plan = shifts.filter((s) => s.employee_id === e.id);
    const scheduled = plan.reduce((s, x) => s + (((mins(x.end_time) - mins(x.start_time)) + 1440) % 1440 || 1440), 0);
    // late: the first clock-in of a scheduled day more than LATE_MIN after the shift start (business clock)
    const dayOf = (p) => (p.shift_date instanceof Date ? p.shift_date.toISOString() : String(p.shift_date)).slice(0, 10);
    let late = 0;
    for (const p of plan) {
      const ins = mine.map((a) => local(a.clock_in)).filter((x) => x.day === dayOf(p));
      if (ins.length && Math.min(...ins.map((x) => x.min)) > mins(p.start_time) + LATE_MIN) late++;
    }
    const s = sales.find((x) => x.user_id && x.user_id === e.user_id);
    const o = orders.find((x) => x.user_id && x.user_id === e.user_id);
    const days = new Set(mine.map((a) => local(a.clock_in).day)).size;
    return { employeeId: e.id, name: e.full_name, position: e.position || "", scheduledHours: q2(scheduled / 60), workedHours: q2(mine.reduce((a, x) => a + Number(x.minutes || 0), 0) / 60),
      daysWorked: days, shifts: plan.length, absent: plan.filter((p) => !mine.some((a) => local(a.clock_in).day === dayOf(p))).length,
      late, sales: s ? Number(s.n) : 0, salesTotal: s ? num(s.total) : 0, orders: o ? Number(o.n) : 0, open: mine.some((a) => a.minutes === null) };
  });
}
router.get("/performance", requirePerm("hr.view"), ah(async (req, res) => {
  const r = dayRange({ from: req.query.from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: req.query.to });
  res.json({ ...r, employees: await performance(pool, req.business.id, r) });
}));

/* ---------------- payroll ---------------- */
const shapeRun = (p) => ({ id: p.id, from: p.period_start, to: p.period_end, status: p.status, total: num(p.total), paidAt: p.paid_at, method: p.method, user: p.user_name || null, createdAt: p.created_at });
router.get("/payroll", requirePerm("hr.payroll"), ah(async (req, res) => {
  const [rows] = await pool.query("SELECT p.*, u.full_name user_name FROM payroll_runs p LEFT JOIN users u ON u.id = p.user_id WHERE p.business_id = ? ORDER BY p.period_end DESC, p.id DESC LIMIT 100", [req.business.id]);
  res.json({ runs: rows.map(shapeRun) });
}));
/** POST /api/hr/payroll { from, to } — a draft with a line per active employee */
router.post("/payroll", requirePerm("hr.payroll"), ah(async (req, res) => {
  const b = req.body || {};
  if (!isDate(b.from) || !isDate(b.to) || b.to < b.from) throw badRequest({ to: "beforeIssue" });
  const r = await withTx(async (conn) => {
    const range = dayRange(b);
    const perf = await performance(conn, req.business.id, range);
    const [emps] = await conn.query("SELECT * FROM employees WHERE business_id = ? AND is_active = 1", [req.business.id]);
    const days = Math.round((Date.parse(`${b.to}T00:00:00Z`) - Date.parse(`${b.from}T00:00:00Z`)) / 86400000) + 1;
    const [x] = await conn.query("INSERT INTO payroll_runs (business_id, period_start, period_end, status, total, user_id) VALUES (?, ?, ?, 'draft', 0, ?)", [req.business.id, b.from, b.to, req.user.id]);
    let total = 0;
    for (const e of emps) {
      const p = perf.find((y) => y.employeeId === e.id) || { daysWorked: 0, workedHours: 0 };
      const rate = num(e.pay_rate);
      // monthly pay: a whole month (28+ days) is the rate, a shorter period its share of 30 days
      const base = e.pay_type === "monthly" ? q2(days >= 28 ? rate : (rate * days) / 30) : e.pay_type === "daily" ? q2(rate * p.daysWorked) : q2(rate * p.workedHours);
      await conn.query("INSERT INTO payroll_lines (run_id, employee_id, pay_type, rate, days, hours, base, additions, deductions, net) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
        [x.insertId, e.id, e.pay_type, rate, p.daysWorked, p.workedHours, base, base]);
      total += base;
    }
    await conn.query("UPDATE payroll_runs SET total = ? WHERE id = ?", [q2(total), x.insertId]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "payroll.drafted", entity: "payroll", entityId: x.insertId, meta: { from: b.from, to: b.to, total: q2(total) }, ip: req.ip });
    return { id: x.insertId };
  });
  res.status(201).json(r);
}));
router.get("/payroll/:id", requirePerm("hr.payroll"), ah(async (req, res) => {
  const [[p]] = await pool.query("SELECT p.*, u.full_name user_name FROM payroll_runs p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.business_id = ?", [id(req.params.id), req.business.id]);
  if (!p) return res.status(404).json({ code: "notFound" });
  const [lines] = await pool.query("SELECT l.*, e.full_name, e.position FROM payroll_lines l JOIN employees e ON e.id = l.employee_id WHERE l.run_id = ? ORDER BY e.full_name", [p.id]);
  res.json({ run: shapeRun(p), lines: lines.map((l) => ({ id: l.id, employeeId: l.employee_id, name: l.full_name, position: l.position || "", payType: l.pay_type, rate: num(l.rate), days: num(l.days),
    hours: num(l.hours), base: num(l.base), additions: num(l.additions), deductions: num(l.deductions), net: num(l.net), note: l.note || "" })) });
}));
/** PUT /api/hr/payroll/:id/lines/:lineId { additions, deductions, note } — while a draft */
router.put("/payroll/:id/lines/:lineId", requirePerm("hr.payroll"), ah(async (req, res) => {
  const add = req.body?.additions === "" || req.body?.additions == null ? 0 : money(req.body.additions);
  const ded = req.body?.deductions === "" || req.body?.deductions == null ? 0 : money(req.body.deductions);
  if (Number.isNaN(add) || add < 0) throw badRequest({ additions: "invalidAmount" });
  if (Number.isNaN(ded) || ded < 0) throw badRequest({ deductions: "invalidAmount" });
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "payroll_runs", id(req.params.id), req.business.id, true);
    if (p.status !== "draft") throw conflict("payrollPaid");
    const [[l]] = await conn.query("SELECT * FROM payroll_lines WHERE id = ? AND run_id = ?", [id(req.params.lineId), p.id]);
    if (!l) throw badRequest({ lineId: "required" });
    const net = q2(num(l.base) + add - ded);
    if (net < 0) throw badRequest({ deductions: "moreThanPay" });
    await conn.query("UPDATE payroll_lines SET additions = ?, deductions = ?, net = ?, note = ? WHERE id = ?", [add, ded, net, optText(req.body?.note, 200), l.id]);
    await conn.query("UPDATE payroll_runs SET total = (SELECT SUM(net) FROM payroll_lines WHERE run_id = ?) WHERE id = ?", [p.id, p.id]);
  });
  res.json({ code: "saved" });
}));
/** POST /api/hr/payroll/:id/pay { method, bankAccountId? } — records the Salaries expense (money out) and closes the run */
router.post("/payroll/:id/pay", requirePerm("hr.payroll"), ah(async (req, res) => {
  const r = await withTx(async (conn) => {
    const p = await ensureOwned(conn, "payroll_runs", id(req.params.id), req.business.id, true);
    if (p.status !== "draft") throw conflict("payrollPaid");
    if (!(num(p.total) > 0)) throw badRequest({ total: "invalidAmount" });
    const fmt = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
    const expenseId = await recordEntry(conn, { businessId: req.business.id, userId: req.user.id, branchId: req.branch.id }, "expense",
      { category: "salaries", amount: num(p.total), method: req.body?.method, bankAccountId: req.body?.bankAccountId, description: `Payroll ${fmt(p.period_start)} – ${fmt(p.period_end)}` });
    await conn.query("UPDATE payroll_runs SET status = 'paid', paid_at = UTC_TIMESTAMP(), method = ?, expense_id = ? WHERE id = ?", [req.body?.method, expenseId, p.id]);
    await audit(conn, { businessId: req.business.id, userId: req.user.id, action: "payroll.paid", entity: "payroll", entityId: p.id, meta: { total: num(p.total), method: req.body?.method }, ip: req.ip });
    return { expenseId, total: num(p.total) };
  });
  res.json(r);
}));
router.delete("/payroll/:id", requirePerm("hr.payroll"), ah(async (req, res) => {
  await withTx(async (conn) => {
    const p = await ensureOwned(conn, "payroll_runs", id(req.params.id), req.business.id, true);
    if (p.status !== "draft") throw conflict("payrollPaid");
    await conn.query("DELETE FROM payroll_lines WHERE run_id = ?", [p.id]);
    await conn.query("DELETE FROM payroll_runs WHERE id = ?", [p.id]);
  });
  res.json({ code: "saved" });
}));

export default router;
