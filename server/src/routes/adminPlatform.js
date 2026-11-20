import { pool, checkDatabase } from "../config/db.js";
import { ah, id, text, optText, num, round2, badRequest, conflict, money, isDate } from "../lib/http.js";
import { requireAdminPerm, adminAudit, platformSettings, savePlatformSettings, SETTING_DEFAULTS, forgetBlockedIps } from "../lib/platform.js";

/*
 * Super admin: running the platform (registered on the authenticated /api/admin router by routes/admin.js).
 *   GET  /dashboard                     everything the overview shows (totals, money, what needs attention, charts, lists)
 *   Billing   /plans (GET, POST, PUT /:id), /subscriptions (GET ?filter=, POST), /subscriptions/:businessId (PATCH),
 *             /subscriptions/:businessId/payments (POST), /payments (GET ?from&to)
 *   Support   /messages (GET ?status=, PATCH /:id), /tickets (GET ?status=, GET /:id, POST /:id/reply, PATCH /:id)
 *   /announcements (GET, POST, PUT /:id, DELETE /:id)
 *   /reports (GET ?months=)          sign-ups and revenue per month, activity, business types, trial conversion
 *   /security (GET), /blocked-ips (POST, DELETE /:id)
 *   /settings (GET, PUT)             trial length, grace days, automatic suspension, contact details, business types
 *   /export (GET)                    every table as one JSON file (owners only)
 * Every change goes into the platform activity log (audit_logs with the admin's id).
 */
const CYCLES = ["monthly", "yearly"];
const METHODS = ["cash", "mobile_money", "bank", "card", "other"];
const months = (n) => {   // the last n months as "YYYY-MM", oldest first
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)); }
  return out;
};
const series = (keys, rows, field = "n") => keys.map((k) => ({ month: k, value: num(rows.find((r) => r.m === k)?.[field] || 0) }));
const addPeriod = (cycle, n = 1) => (cycle === "yearly" ? `INTERVAL ${12 * n} MONTH` : `INTERVAL ${n} MONTH`);

export function platformRoutes(router) {
  /* ===================== dashboard ===================== */
  router.get("/dashboard", ah(async (req, res) => {
    const db = await checkDatabase();
    const keys = months(12);
    const [[c]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM businesses) businesses, (SELECT COUNT(*) FROM businesses WHERE status = 'active') active,
              (SELECT COUNT(*) FROM businesses WHERE status = 'suspended') suspended, (SELECT COUNT(*) FROM businesses WHERE status = 'deactivated') deactivated,
              (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM businesses WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) new30,
              (SELECT COUNT(*) FROM trial_records t WHERE t.status = 'active' AND t.end_date >= UTC_DATE() AND t.id = (SELECT MAX(id) FROM trial_records WHERE business_id = t.business_id)) trials,
              (SELECT COUNT(*) FROM subscriptions WHERE status = 'active') subscribed,
              (SELECT COUNT(*) FROM subscriptions WHERE status IN ('past_due', 'suspended')) overdue,
              (SELECT COUNT(*) FROM trial_records t WHERE t.status = 'active' AND t.end_date BETWEEN UTC_DATE() AND DATE_ADD(UTC_DATE(), INTERVAL 7 DAY)
                 AND t.id = (SELECT MAX(id) FROM trial_records WHERE business_id = t.business_id)) trialsEnding,
              (SELECT COUNT(*) FROM support_tickets WHERE status <> 'closed') openTickets,
              (SELECT COUNT(*) FROM support_tickets WHERE status <> 'closed' AND last_reply_by = 'business') waitingTickets,
              (SELECT COUNT(*) FROM contact_messages WHERE status = 'new') newMessages,
              (SELECT COUNT(*) FROM audit_logs WHERE action IN ('auth.login_failed', 'admin.login_failed') AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)) failedLogins,
              (SELECT COUNT(*) FROM sales) sales, (SELECT COUNT(*) FROM invoices) invoices`);
    const [[money1]] = await pool.query(
      `SELECT (SELECT COALESCE(SUM(amount), 0) FROM subscription_payments WHERE DATE_FORMAT(paid_at, '%Y-%m') = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m')) thisMonth,
              (SELECT COALESCE(SUM(amount), 0) FROM subscription_payments WHERE DATE_FORMAT(paid_at, '%Y-%m') = DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MONTH), '%Y-%m')) lastMonth,
              (SELECT COALESCE(SUM(amount), 0) FROM subscription_payments) total,
              (SELECT COALESCE(SUM(IF(s.cycle = 'yearly', p.price_yearly / 12, p.price_monthly)), 0) FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'active') mrr`);
    const [signups] = await pool.query("SELECT DATE_FORMAT(created_at, '%Y-%m') m, COUNT(*) n FROM businesses WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 MONTH) GROUP BY m");
    const [revenue] = await pool.query("SELECT DATE_FORMAT(paid_at, '%Y-%m') m, SUM(amount) n FROM subscription_payments WHERE paid_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 MONTH) GROUP BY m");
    const [types] = await pool.query("SELECT business_type type, COUNT(*) n FROM businesses GROUP BY business_type ORDER BY n DESC");
    const [recent] = await pool.query("SELECT id, name, business_type, status, created_at, logo_path FROM businesses ORDER BY created_at DESC, id DESC LIMIT 6");
    const [ending] = await pool.query(
      `SELECT b.id, b.name, t.end_date, DATEDIFF(t.end_date, UTC_DATE()) days_left FROM trial_records t JOIN businesses b ON b.id = t.business_id
        WHERE t.status = 'active' AND t.end_date >= UTC_DATE() AND t.id = (SELECT MAX(id) FROM trial_records WHERE business_id = t.business_id) ORDER BY t.end_date LIMIT 6`);
    const [[size]] = await pool.query("SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) mb FROM information_schema.tables WHERE table_schema = DATABASE()");
    const settings = await platformSettings();
    res.json({
      admin: { username: req.admin.username, role: req.admin.role },
      counts: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, num(v)])),
      money: { currency: settings.billingCurrency, thisMonth: num(money1.thisMonth), lastMonth: num(money1.lastMonth), total: num(money1.total), mrr: round2(num(money1.mrr)) },
      signups: series(keys, signups), revenue: series(keys, revenue),
      types: types.map((t) => ({ type: t.type, count: num(t.n) })),
      recent: recent.map((b) => ({ id: b.id, name: b.name, type: b.business_type, status: b.status, createdAt: b.created_at, logoPath: b.logo_path })),
      endingTrials: ending.map((t) => ({ id: t.id, name: t.name, end: t.end_date, daysLeft: num(t.days_left) })),
      health: { database: db.ok ? "connected" : "down", sizeMb: num(size.mb), uptimeSec: Math.round(process.uptime()), node: process.version }
    });
  }));

  /* GET /badges — small counts the sidebar shows next to its menus (things waiting for the super admin) */
  router.get("/badges", ah(async (req, res) => {
    const [[c]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM subscriptions WHERE status IN ('past_due', 'suspended')) overdue,
              (SELECT COUNT(*) FROM support_tickets WHERE status <> 'closed' AND last_reply_by = 'business') tickets,
              (SELECT COUNT(*) FROM contact_messages WHERE status = 'new') messages,
              (SELECT COUNT(*) FROM trial_records t WHERE t.status = 'active' AND t.end_date BETWEEN UTC_DATE() AND DATE_ADD(UTC_DATE(), INTERVAL 7 DAY)
                 AND t.id = (SELECT MAX(id) FROM trial_records WHERE business_id = t.business_id)) trialsEnding`);
    res.json(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, num(v)])));
  }));

  /* ===================== billing: plans ===================== */
  const readPlan = (b) => {
    const lim = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
    const d = { name: text(b.name, 80), code: text(b.code, 40).toLowerCase().replace(/[^a-z0-9_-]/g, ""), description: optText(b.description, 255),
      priceMonthly: money(b.priceMonthly), priceYearly: money(b.priceYearly), maxUsers: lim(b.maxUsers), maxBranches: lim(b.maxBranches), maxProducts: lim(b.maxProducts),
      features: (Array.isArray(b.features) ? b.features : String(b.features || "").split("\n")).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 20),
      isActive: b.isActive !== false, sortOrder: Number(b.sortOrder) || 0 };
    const e = {};
    if (!d.name) e.name = "required";
    if (!d.code) e.code = "required";
    if (Number.isNaN(d.priceMonthly)) e.priceMonthly = "invalidAmount";
    if (Number.isNaN(d.priceYearly)) e.priceYearly = "invalidAmount";
    for (const k of ["maxUsers", "maxBranches", "maxProducts"]) if (d[k] !== null && (!Number.isInteger(d[k]) || d[k] < 1)) e[k] = "invalidAmount";
    if (Object.keys(e).length) throw badRequest(e);
    return d;
  };
  const planOut = (p) => ({ id: p.id, name: p.name, code: p.code, description: p.description || "", priceMonthly: num(p.price_monthly), priceYearly: num(p.price_yearly),
    maxUsers: p.max_users, maxBranches: p.max_branches, maxProducts: p.max_products, features: (() => { try { return JSON.parse(p.features || "[]"); } catch { return []; } })(),
    isActive: Boolean(p.is_active), sortOrder: p.sort_order, subscribers: p.subscribers === undefined ? undefined : num(p.subscribers) });
  router.get("/plans", ah(async (req, res) => {
    const [rows] = await pool.query("SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status <> 'cancelled') subscribers FROM plans p ORDER BY p.sort_order, p.id");
    res.json({ plans: rows.map(planOut), currency: (await platformSettings()).billingCurrency });
  }));
  router.post("/plans", requireAdminPerm("billing"), ah(async (req, res) => {
    const d = readPlan(req.body || {});
    const [[dup]] = await pool.query("SELECT id FROM plans WHERE code = ?", [d.code]);
    if (dup) throw badRequest({ code: "duplicate" });
    const [r] = await pool.query(
      "INSERT INTO plans (name, code, description, price_monthly, price_yearly, max_users, max_branches, max_products, features, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [d.name, d.code, d.description, d.priceMonthly, d.priceYearly, d.maxUsers, d.maxBranches, d.maxProducts, JSON.stringify(d.features), d.isActive ? 1 : 0, d.sortOrder]);
    await adminAudit(pool, { adminId: req.admin.id, action: "billing.plan_created", entity: "plan", entityId: r.insertId, meta: d, ip: req.ip });
    res.status(201).json({ id: r.insertId });
  }));
  router.put("/plans/:id", requireAdminPerm("billing"), ah(async (req, res) => {
    const pid = id(req.params.id);
    const d = readPlan(req.body || {});
    const [[dup]] = await pool.query("SELECT id FROM plans WHERE code = ? AND id <> ?", [d.code, pid || 0]);
    if (dup) throw badRequest({ code: "duplicate" });
    const [r] = await pool.query(
      "UPDATE plans SET name = ?, code = ?, description = ?, price_monthly = ?, price_yearly = ?, max_users = ?, max_branches = ?, max_products = ?, features = ?, is_active = ?, sort_order = ? WHERE id = ?",
      [d.name, d.code, d.description, d.priceMonthly, d.priceYearly, d.maxUsers, d.maxBranches, d.maxProducts, JSON.stringify(d.features), d.isActive ? 1 : 0, d.sortOrder, pid || 0]);
    if (!r.affectedRows) return res.status(404).json({ code: "notFound" });
    await adminAudit(pool, { adminId: req.admin.id, action: "billing.plan_changed", entity: "plan", entityId: pid, meta: d, ip: req.ip });
    res.json({ code: "saved" });
  }));

  /* ===================== billing: subscriptions and payments ===================== */
  /* filter: active | due (ending in 7 days) | overdue (past due or suspended for not paying) | cancelled | none (no plan yet) */
  router.get("/subscriptions", ah(async (req, res) => {
    const f = req.query.filter;
    if (f === "none") {
      const [rows] = await pool.query(
        `SELECT b.id, b.name, b.owner_name, b.phone, b.status, b.created_at, (SELECT CONCAT(t.status, '|', t.end_date) FROM trial_records t WHERE t.business_id = b.id ORDER BY t.id DESC LIMIT 1) trial
           FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.business_id = b.id) ORDER BY b.created_at DESC LIMIT 500`);
      return res.json({ businesses: rows.map((b) => { const [ts, te] = String(b.trial || "|").split("|"); return { id: b.id, name: b.name, owner: b.owner_name, phone: b.phone, status: b.status, createdAt: b.created_at, trial: ts ? { status: ts, end: te } : null }; }) });
    }
    const where = f === "due" ? "s.status = 'active' AND s.current_period_end BETWEEN UTC_DATE() AND DATE_ADD(UTC_DATE(), INTERVAL 7 DAY)"
      : f === "overdue" ? "s.status IN ('past_due', 'suspended')" : f === "cancelled" ? "s.status = 'cancelled'" : f === "all" ? "1=1" : "s.status = 'active'";
    const [rows] = await pool.query(
      `SELECT s.*, b.name business, b.status business_status, b.phone, p.name plan, p.price_monthly, p.price_yearly, DATEDIFF(s.current_period_end, UTC_DATE()) days_left,
              (SELECT MAX(paid_at) FROM subscription_payments sp WHERE sp.business_id = s.business_id) last_paid
         FROM subscriptions s JOIN businesses b ON b.id = s.business_id JOIN plans p ON p.id = s.plan_id WHERE ${where} ORDER BY s.current_period_end LIMIT 500`);
    res.json({ subscriptions: rows.map((s) => ({ businessId: s.business_id, business: s.business, businessStatus: s.business_status, phone: s.phone, planId: s.plan_id, plan: s.plan,
      cycle: s.cycle, status: s.status, price: num(s.cycle === "yearly" ? s.price_yearly : s.price_monthly), periodStart: s.current_period_start, periodEnd: s.current_period_end,
      daysLeft: num(s.days_left), lastPaid: s.last_paid })) });
  }));
  /* POST /subscriptions { businessId, planId, cycle, startDate?, payment?: { amount, method, reference } } — give a business a plan (or switch it) */
  router.post("/subscriptions", requireAdminPerm("billing"), ah(async (req, res) => {
    const b = req.body || {};
    const bid = id(b.businessId);
    const pid = id(b.planId);
    const cycle = CYCLES.includes(b.cycle) ? b.cycle : "monthly";
    const start = isDate(b.startDate) ? b.startDate : new Date().toISOString().slice(0, 10);
    const [[biz]] = await pool.query("SELECT id, status FROM businesses WHERE id = ?", [bid || 0]);
    const [[plan]] = await pool.query("SELECT * FROM plans WHERE id = ?", [pid || 0]);
    if (!biz) throw badRequest({ businessId: "required" });
    if (!plan) throw badRequest({ planId: "required" });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[old]] = await conn.query("SELECT * FROM subscriptions WHERE business_id = ? FOR UPDATE", [bid]);
      if (old) {
        await conn.query(`UPDATE subscriptions SET plan_id = ?, cycle = ?, status = 'active', current_period_start = ?, current_period_end = DATE_ADD(?, ${addPeriod(cycle)}), cancel_reason = NULL WHERE id = ?`, [pid, cycle, start, start, old.id]);
      } else {
        await conn.query(`INSERT INTO subscriptions (business_id, plan_id, cycle, status, current_period_start, current_period_end) VALUES (?, ?, ?, 'active', ?, DATE_ADD(?, ${addPeriod(cycle)}))`, [bid, pid, cycle, start, start]);
      }
      await conn.query("UPDATE trial_records SET status = 'converted' WHERE business_id = ? AND status IN ('active', 'expired')", [bid]);
      if (old?.status === "suspended" && biz.status === "suspended") await conn.query("UPDATE businesses SET status = 'active' WHERE id = ?", [bid]);
      const amount = b.payment ? money(b.payment.amount) : 0;
      if (b.payment && (Number.isNaN(amount) || amount <= 0)) throw badRequest({ amount: "invalidAmount" });
      if (amount > 0) {
        await conn.query(`INSERT INTO subscription_payments (business_id, plan_id, amount, method, reference, period_start, period_end, admin_id) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(?, ${addPeriod(cycle)}), ?)`,
          [bid, pid, amount, METHODS.includes(b.payment.method) ? b.payment.method : "cash", optText(b.payment.reference, 80), start, start, req.admin.id]);
      }
      await adminAudit(conn, { adminId: req.admin.id, businessId: bid, action: old ? "billing.plan_switched" : "billing.subscribed", meta: { plan: plan.name, cycle, start, amount }, ip: req.ip });
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
    res.status(201).json({ code: "saved" });
  }));
  /* POST /subscriptions/:businessId/payments { amount, method, reference?, notes?, periods? } — a payment extends the subscription by its cycle × periods */
  router.post("/subscriptions/:businessId/payments", requireAdminPerm("billing"), ah(async (req, res) => {
    const bid = id(req.params.businessId);
    const b = req.body || {};
    const amount = money(b.amount);
    const periods = Math.min(24, Math.max(1, parseInt(b.periods, 10) || 1));
    if (Number.isNaN(amount) || amount <= 0) throw badRequest({ amount: "invalidAmount" });
    if (!METHODS.includes(b.method)) throw badRequest({ method: "required" });
    const conn = await pool.getConnection();
    let out;
    try {
      await conn.beginTransaction();
      const [[s]] = await conn.query("SELECT * FROM subscriptions WHERE business_id = ? FOR UPDATE", [bid || 0]);
      if (!s) throw conflict("noSubscription");
      // the paid time starts where the last one ended (or today, if it ended long ago and was suspended / cancelled)
      const [[p]] = await conn.query(
        `SELECT IF(? IN ('active', 'past_due') AND current_period_end >= DATE_SUB(UTC_DATE(), INTERVAL 31 DAY), current_period_end, UTC_DATE()) start FROM subscriptions WHERE id = ?`, [s.status, s.id]);
      const [[e]] = await conn.query(`SELECT DATE_ADD(?, ${addPeriod(s.cycle, periods)}) end_date`, [p.start]);
      await conn.query("UPDATE subscriptions SET status = 'active', current_period_start = ?, current_period_end = ?, cancel_reason = NULL WHERE id = ?", [p.start, e.end_date, s.id]);
      await conn.query("INSERT INTO subscription_payments (business_id, plan_id, amount, method, reference, period_start, period_end, notes, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [bid, s.plan_id, amount, b.method, optText(b.reference, 80), p.start, e.end_date, optText(b.notes, 255), req.admin.id]);
      // suspended for not paying: paying brings the business back
      const [[biz]] = await conn.query("SELECT status FROM businesses WHERE id = ?", [bid]);
      if (s.status === "suspended" && biz.status === "suspended") await conn.query("UPDATE businesses SET status = 'active' WHERE id = ?", [bid]);
      await adminAudit(conn, { adminId: req.admin.id, businessId: bid, action: "billing.payment", meta: { amount, method: b.method, periods, until: e.end_date }, ip: req.ip });
      await conn.commit();
      out = { code: "saved", periodEnd: e.end_date, reactivated: s.status === "suspended" && biz.status === "suspended" };
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
    res.status(201).json(out);
  }));
  /* PATCH /subscriptions/:businessId { status: "cancelled", reason } — cancel (the business keeps working; it is not charged any more) */
  router.patch("/subscriptions/:businessId", requireAdminPerm("billing"), ah(async (req, res) => {
    const bid = id(req.params.businessId);
    if (req.body?.status !== "cancelled") throw badRequest({ status: "required" });
    const reason = text(req.body?.reason, 255);
    if (!reason) throw badRequest({ reason: "required" });
    const [r] = await pool.query("UPDATE subscriptions SET status = 'cancelled', cancel_reason = ? WHERE business_id = ?", [reason, bid || 0]);
    if (!r.affectedRows) return res.status(404).json({ code: "notFound" });
    await adminAudit(pool, { adminId: req.admin.id, businessId: bid, action: "billing.cancelled", meta: { reason }, ip: req.ip });
    res.json({ code: "saved" });
  }));
  router.get("/payments", ah(async (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
    const to = isDate(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(
      `SELECT sp.*, b.name business, p.name plan, pa.username admin FROM subscription_payments sp JOIN businesses b ON b.id = sp.business_id
         LEFT JOIN plans p ON p.id = sp.plan_id LEFT JOIN platform_admins pa ON pa.id = sp.admin_id
        WHERE sp.paid_at BETWEEN ? AND ? ORDER BY sp.paid_at DESC LIMIT 1000`, [`${from} 00:00:00`, `${to} 23:59:59`]);
    const list = rows.map((x) => ({ id: x.id, businessId: x.business_id, business: x.business, plan: x.plan, amount: num(x.amount), method: x.method, reference: x.reference,
      periodStart: x.period_start, periodEnd: x.period_end, paidAt: x.paid_at, admin: x.admin, notes: x.notes }));
    res.json({ from, to, payments: list, total: round2(list.reduce((s, x) => s + x.amount, 0)), currency: (await platformSettings()).billingCurrency });
  }));

  /* ===================== support: website messages ===================== */
  router.get("/messages", ah(async (req, res) => {
    const st = ["new", "read", "closed"].includes(req.query.status) ? req.query.status : null;
    const [rows] = await pool.query(`SELECT m.*, pa.username handled_by_name FROM contact_messages m LEFT JOIN platform_admins pa ON pa.id = m.handled_by
      ${st ? "WHERE m.status = ?" : ""} ORDER BY m.created_at DESC LIMIT 500`, st ? [st] : []);
    res.json({ messages: rows.map((m) => ({ id: m.id, name: m.name, business: m.business_name || "", email: m.email, phone: m.phone, message: m.message, status: m.status, replyNote: m.reply_note || "",
      handledBy: m.handled_by_name, handledAt: m.handled_at, createdAt: m.created_at })) });
  }));
  router.patch("/messages/:id", requireAdminPerm("support"), ah(async (req, res) => {
    const status = ["new", "read", "closed"].includes(req.body?.status) ? req.body.status : null;
    if (!status) throw badRequest({ status: "required" });
    const [r] = await pool.query("UPDATE contact_messages SET status = ?, reply_note = COALESCE(?, reply_note), handled_by = ?, handled_at = UTC_TIMESTAMP() WHERE id = ?",
      [status, optText(req.body?.replyNote, 2000), req.admin.id, id(req.params.id) || 0]);
    if (!r.affectedRows) return res.status(404).json({ code: "notFound" });
    res.json({ code: "saved" });
  }));

  /* ===================== support: tickets from businesses ===================== */
  router.get("/tickets", ah(async (req, res) => {
    const st = ["open", "answered", "closed"].includes(req.query.status) ? req.query.status : req.query.status === "waiting" ? "waiting" : null;
    const where = st === "waiting" ? "t.status <> 'closed' AND t.last_reply_by = 'business'" : st ? "t.status = ?" : "1=1";
    const [rows] = await pool.query(
      `SELECT t.*, b.name business, COALESCE(t.user_name, u.full_name) user_name, (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) replies,
              (SELECT m.body FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) last_body
         FROM support_tickets t JOIN businesses b ON b.id = t.business_id LEFT JOIN users u ON u.id = t.user_id
        WHERE ${where} ORDER BY FIELD(t.priority, 'high', 'normal', 'low'), t.updated_at DESC LIMIT 500`, st && st !== "waiting" ? [st] : []);
    res.json({ tickets: rows.map((t) => ({ id: t.id, businessId: t.business_id, business: t.business, user: t.user_name, subject: t.subject, status: t.status, priority: t.priority,
      lastReplyBy: t.last_reply_by, replies: num(t.replies), lastBody: String(t.last_body || "").slice(0, 160), createdAt: t.created_at, updatedAt: t.updated_at })) });
  }));
  router.get("/tickets/:id", ah(async (req, res) => {
    const [[t]] = await pool.query("SELECT t.*, b.name business, COALESCE(t.user_name, u.full_name) user_name FROM support_tickets t JOIN businesses b ON b.id = t.business_id LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?", [id(req.params.id) || 0]);
    if (!t) return res.status(404).json({ code: "notFound" });
    const [msgs] = await pool.query(
      `SELECT m.*, COALESCE(m.user_name, u.full_name) user_name, pa.username admin_name FROM support_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN platform_admins pa ON pa.id = m.admin_id
        WHERE m.ticket_id = ? ORDER BY m.id`, [t.id]);
    res.json({ ticket: { id: t.id, businessId: t.business_id, business: t.business, user: t.user_name, subject: t.subject, status: t.status, priority: t.priority, createdAt: t.created_at },
      messages: msgs.map((m) => ({ id: m.id, author: m.author, name: m.author === "admin" ? `Faatix · ${m.admin_name || ""}` : m.user_name, body: m.body, at: m.created_at })) });
  }));
  router.post("/tickets/:id/reply", requireAdminPerm("support"), ah(async (req, res) => {
    const body = text(req.body?.body, 5000);
    if (!body) throw badRequest({ body: "required" });
    const [[t]] = await pool.query("SELECT id, business_id FROM support_tickets WHERE id = ?", [id(req.params.id) || 0]);
    if (!t) return res.status(404).json({ code: "notFound" });
    await pool.query("INSERT INTO support_messages (ticket_id, business_id, author, admin_id, body) VALUES (?, ?, 'admin', ?, ?)", [t.id, t.business_id, req.admin.id, body]);
    await pool.query("UPDATE support_tickets SET status = ?, last_reply_by = 'admin', updated_at = UTC_TIMESTAMP() WHERE id = ?", [req.body?.close ? "closed" : "answered", t.id]);
    res.status(201).json({ code: "saved" });
  }));
  router.patch("/tickets/:id", requireAdminPerm("support"), ah(async (req, res) => {
    const status = ["open", "answered", "closed"].includes(req.body?.status) ? req.body.status : undefined;
    const priority = ["low", "normal", "high"].includes(req.body?.priority) ? req.body.priority : undefined;
    if (!status && !priority) throw badRequest({ status: "required" });
    await pool.query("UPDATE support_tickets SET status = COALESCE(?, status), priority = COALESCE(?, priority), updated_at = UTC_TIMESTAMP() WHERE id = ?", [status || null, priority || null, id(req.params.id) || 0]);
    res.json({ code: "saved" });
  }));

  /* ===================== announcements to businesses ===================== */
  const readAnn = (b) => {
    const d = { title: text(b.title, 160), body: text(b.body, 4000), level: ["info", "warning", "success"].includes(b.level) ? b.level : "info",
      audience: b.audience === "type" ? "type" : "all", businessType: b.audience === "type" ? text(b.businessType, 60) : null,
      startsAt: /^\d{4}-\d{2}-\d{2}/.test(b.startsAt || "") ? String(b.startsAt).replace("T", " ").slice(0, 16) : null,
      endsAt: /^\d{4}-\d{2}-\d{2}/.test(b.endsAt || "") ? String(b.endsAt).replace("T", " ").slice(0, 16) : null, isActive: b.isActive !== false };
    const e = {};
    if (!d.title) e.title = "required";
    if (!d.body) e.body = "required";
    if (d.audience === "type" && !d.businessType) e.businessType = "required";
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) e.endsAt = "beforeIssue";
    if (Object.keys(e).length) throw badRequest(e);
    return d;
  };
  router.get("/announcements", ah(async (req, res) => {
    const [rows] = await pool.query("SELECT a.*, pa.username admin FROM announcements a LEFT JOIN platform_admins pa ON pa.id = a.admin_id ORDER BY a.created_at DESC LIMIT 200");
    res.json({ announcements: rows.map((a) => ({ id: a.id, title: a.title, body: a.body, level: a.level, audience: a.audience, businessType: a.business_type, startsAt: a.starts_at, endsAt: a.ends_at,
      isActive: Boolean(a.is_active), admin: a.admin, createdAt: a.created_at,
      live: Boolean(a.is_active) && a.starts_at <= new Date().toISOString().replace("T", " ").slice(0, 19) && (!a.ends_at || a.ends_at > new Date().toISOString().replace("T", " ").slice(0, 19)) })) });
  }));
  router.post("/announcements", requireAdminPerm("announcements"), ah(async (req, res) => {
    const d = readAnn(req.body || {});
    const [r] = await pool.query("INSERT INTO announcements (title, body, level, audience, business_type, starts_at, ends_at, is_active, admin_id) VALUES (?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), ?, ?, ?)",
      [d.title, d.body, d.level, d.audience, d.businessType, d.startsAt, d.endsAt, d.isActive ? 1 : 0, req.admin.id]);
    await adminAudit(pool, { adminId: req.admin.id, action: "admin.announcement", entity: "announcement", entityId: r.insertId, meta: { title: d.title, audience: d.audience }, ip: req.ip });
    res.status(201).json({ id: r.insertId });
  }));
  router.put("/announcements/:id", requireAdminPerm("announcements"), ah(async (req, res) => {
    const d = readAnn(req.body || {});
    await pool.query("UPDATE announcements SET title = ?, body = ?, level = ?, audience = ?, business_type = ?, starts_at = COALESCE(?, starts_at), ends_at = ?, is_active = ? WHERE id = ?",
      [d.title, d.body, d.level, d.audience, d.businessType, d.startsAt, d.endsAt, d.isActive ? 1 : 0, id(req.params.id) || 0]);
    res.json({ code: "saved" });
  }));
  router.delete("/announcements/:id", requireAdminPerm("announcements"), ah(async (req, res) => {
    await pool.query("DELETE FROM announcements WHERE id = ?", [id(req.params.id) || 0]);
    res.json({ code: "saved" });
  }));

  /* ===================== platform reports ===================== */
  router.get("/reports", requireAdminPerm("reports"), ah(async (req, res) => {
    const n = [3, 6, 12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : 12;
    const keys = months(n);
    const [signups] = await pool.query("SELECT DATE_FORMAT(created_at, '%Y-%m') m, COUNT(*) n FROM businesses WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MONTH) GROUP BY m", [n]);
    const [revenue] = await pool.query("SELECT DATE_FORMAT(paid_at, '%Y-%m') m, SUM(amount) n FROM subscription_payments WHERE paid_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MONTH) GROUP BY m", [n]);
    const [sales] = await pool.query("SELECT DATE_FORMAT(sold_at, '%Y-%m') m, COUNT(*) n FROM sales WHERE sold_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MONTH) GROUP BY m", [n]);
    const [[act]] = await pool.query(
      `SELECT SUM(EXISTS (SELECT 1 FROM audit_logs a WHERE a.business_id = b.id AND a.user_id IS NOT NULL AND a.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY))) active,
              COUNT(*) total FROM businesses b WHERE b.status = 'active'`);
    const [types] = await pool.query(
      `SELECT b.business_type type, COUNT(*) n, SUM(b.status = 'active') active,
              SUM(EXISTS (SELECT 1 FROM subscriptions s WHERE s.business_id = b.id AND s.status = 'active')) paying FROM businesses b GROUP BY b.business_type ORDER BY n DESC`);
    const [[conv]] = await pool.query(
      `SELECT COUNT(DISTINCT t.business_id) trials,
              COUNT(DISTINCT IF(EXISTS (SELECT 1 FROM subscriptions s WHERE s.business_id = t.business_id), t.business_id, NULL)) converted,
              COUNT(DISTINCT IF(t.status = 'active' AND t.end_date >= UTC_DATE(), t.business_id, NULL)) running FROM trial_records t`);
    const [plans] = await pool.query("SELECT p.name, COUNT(s.id) n FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status = 'active' GROUP BY p.id ORDER BY p.sort_order");
    const trials = num(conv.trials);
    const converted = num(conv.converted);
    const running = num(conv.running);
    res.json({
      months: n, signups: series(keys, signups), revenue: series(keys, revenue), sales: series(keys, sales),
      activity: { active: num(act.active), inactive: Math.max(0, num(act.total) - num(act.active)) },
      types: types.map((x) => ({ type: x.type, count: num(x.n), active: num(x.active), paying: num(x.paying) })),
      trials: { total: trials, converted, running, lost: Math.max(0, trials - converted - running), rate: trials - running > 0 ? Math.round((converted / (trials - running)) * 1000) / 10 : null },
      plans: plans.map((p) => ({ name: p.name, count: num(p.n) })), currency: (await platformSettings()).billingCurrency
    });
  }));

  /* ===================== security ===================== */
  router.get("/security", requireAdminPerm("security"), ah(async (req, res) => {
    const [byIp] = await pool.query(
      `SELECT ip, COUNT(*) n, MAX(created_at) last, SUM(action = 'admin.login_failed') admin_tries FROM audit_logs
        WHERE action IN ('auth.login_failed', 'admin.login_failed') AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) GROUP BY ip ORDER BY n DESC LIMIT 50`);
    const [recent] = await pool.query(
      `SELECT a.action, a.ip, a.created_at, a.meta, b.name business, u.username FROM audit_logs a LEFT JOIN businesses b ON b.id = a.business_id LEFT JOIN users u ON u.id = a.user_id
        WHERE a.action IN ('auth.login_failed', 'admin.login_failed') ORDER BY a.id DESC LIMIT 50`);
    const [ips] = await pool.query("SELECT bi.*, pa.username admin FROM blocked_ips bi LEFT JOIN platform_admins pa ON pa.id = bi.admin_id ORDER BY bi.created_at DESC");
    const blockedSet = new Set(ips.filter((x) => !x.expires_at || x.expires_at > new Date().toISOString().replace("T", " ").slice(0, 19)).map((x) => x.ip));
    res.json({
      failedByIp: byIp.map((x) => ({ ip: x.ip, count: num(x.n), last: x.last, adminTries: num(x.admin_tries), blocked: blockedSet.has(x.ip) })),
      recentFailed: recent.map((x) => { let meta = {}; try { meta = JSON.parse(x.meta || "{}") || {}; } catch { /* none */ }
        return { admin: x.action === "admin.login_failed", ip: x.ip, at: x.created_at, business: x.business, username: x.username || meta.username || null }; }),
      blocked: ips.map((x) => ({ id: x.id, ip: x.ip, reason: x.reason || "", admin: x.admin, createdAt: x.created_at, expiresAt: x.expires_at, active: blockedSet.has(x.ip) })),
      yourIp: req.ip
    });
  }));
  router.post("/blocked-ips", requireAdminPerm("security"), ah(async (req, res) => {
    const ip = text(req.body?.ip, 64);
    const days = req.body?.days === "" || req.body?.days === undefined || req.body?.days === null ? null : Number(req.body.days);
    if (!/^[0-9a-fA-F:.]{3,64}$/.test(ip)) throw badRequest({ ip: "invalidIp" });
    if (ip === req.ip) throw badRequest({ ip: "ownIp" });   // don't lock yourself out of the business app
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw badRequest({ days: "invalidAmount" });
    await pool.query(`INSERT INTO blocked_ips (ip, reason, admin_id, expires_at) VALUES (?, ?, ?, ${days ? "DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)" : "NULL"})
      ON DUPLICATE KEY UPDATE reason = VALUES(reason), admin_id = VALUES(admin_id), created_at = UTC_TIMESTAMP(), expires_at = VALUES(expires_at)`,
    days ? [ip, optText(req.body?.reason, 255), req.admin.id, days] : [ip, optText(req.body?.reason, 255), req.admin.id]);
    forgetBlockedIps();
    await adminAudit(pool, { adminId: req.admin.id, action: "security.ip_blocked", meta: { ip, days }, ip: req.ip });
    res.status(201).json({ code: "saved" });
  }));
  router.delete("/blocked-ips/:id", requireAdminPerm("security"), ah(async (req, res) => {
    const [[x]] = await pool.query("SELECT ip FROM blocked_ips WHERE id = ?", [id(req.params.id) || 0]);
    await pool.query("DELETE FROM blocked_ips WHERE id = ?", [id(req.params.id) || 0]);
    forgetBlockedIps();
    if (x) await adminAudit(pool, { adminId: req.admin.id, action: "security.ip_unblocked", meta: { ip: x.ip }, ip: req.ip });
    res.json({ code: "saved" });
  }));

  /* ===================== system settings ===================== */
  router.get("/settings", requireAdminPerm("settings"), ah(async (req, res) => res.json({ settings: await platformSettings() })));
  router.put("/settings", requireAdminPerm("settings"), ah(async (req, res) => {
    const b = req.body || {};
    const e = {};
    const trialDays = Number(b.trialDays);
    const graceDays = Number(b.graceDays);
    if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) e.trialDays = "invalidAmount";
    if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) e.graceDays = "invalidAmount";
    if (Object.keys(e).length) throw badRequest(e);
    const list = (v, max) => (Array.isArray(v) ? v : String(v || "").split(/[\n,]/)).map((x) => String(x).trim().slice(0, max)).filter(Boolean).slice(0, 6);
    const values = {
      trialDays, graceDays, autoSuspend: b.autoSuspend === true, suspendAfterTrial: b.suspendAfterTrial === true,
      billingCurrency: /^[A-Z]{3}$/.test(b.billingCurrency || "") ? b.billingCurrency : SETTING_DEFAULTS.billingCurrency,
      contact: { phones: list(b.contact?.phones, 40), emails: list(b.contact?.emails, 190), whatsapp: optText(b.contact?.whatsapp, 40) || "", address: optText(b.contact?.address, 255) || "" },
      disabledTypes: (Array.isArray(b.disabledTypes) ? b.disabledTypes : []).map((x) => String(x).slice(0, 60)).slice(0, 30),
      dailyBackups: b.dailyBackups === true,
      keepBackups: Math.min(90, Math.max(1, Number.parseInt(b.keepBackups, 10) || 14))
    };
    await savePlatformSettings(pool, values);
    await adminAudit(pool, { adminId: req.admin.id, action: "admin.settings", meta: values, ip: req.ip });
    res.json({ settings: await platformSettings() });
  }));

  /* ===================== export: every table as one JSON file (owners) ===================== */
  router.get("/export", requireAdminPerm("export"), ah(async (req, res) => {
    const [tables] = await pool.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    await adminAudit(pool, { adminId: req.admin.id, action: "admin.export", meta: { tables: tables.length }, ip: req.ip });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="faatix-export-${stamp}.json"`);
    res.write(`{"exportedAt":"${new Date().toISOString()}","tables":{`);
    for (const [i, { t }] of tables.entries()) {
      const [rows] = await pool.query(`SELECT * FROM \`${t}\``);
      res.write(`${i ? "," : ""}${JSON.stringify(t)}:${JSON.stringify(rows)}`);
    }
    res.end("}}");
  }));
}
