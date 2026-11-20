import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { SUPPORTED, useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../services/api.js";
import { useApi, useSubmit, Field, FormError, Loading, EmptyState, StatusBadge, SearchBox, ReasonModal, Modal } from "../app/ui.jsx";
import { date, fill, money } from "../app/format.js";
import usePageTitle from "../hooks/usePageTitle.js";
import logo from "../assets/faatix-logo.png";
import AdminDashboard from "./AdminDashboard.jsx";
import { Subscriptions, Payments, Plans, GivePlan, RecordPayment } from "./AdminBilling.jsx";
import { Tickets, Messages } from "./AdminSupport.jsx";
import { Announcements, Reports, Security, AdminsPage, SettingsPage, ExportPage, AccountPage, ShownOnce } from "./AdminPlatform.jsx";
import { RegisterBusiness, ProvisioningRoute, Hosting, Databases, Backups, BranchOverview, BranchLimit, BusinessModules } from "./AdminTenancy.jsx";

/*
 * Super Admin (platform owner) area — separate sign-in and session from businesses.
 * The sidebar (MENU) groups every page; an item shows only to roles with its permission (`perm`, lib/platform.js ADMIN_ROLES)
 * and may carry a count of what is waiting (`badge`, GET /api/admin/badges). Pages live in AdminDashboard / AdminBilling /
 * AdminSupport / AdminPlatform; businesses, trials, users and activity are here.
 */
const MENU = [
  { id: "dashboard", icon: "grid", items: [
    { to: "/admin", label: "overview" }, { to: "/admin/health", label: "health" }] },
  { id: "businesses", icon: "briefcase", items: [
    { to: "/admin/businesses/create", label: "register", perm: "provision" },
    { to: "/admin/businesses", label: "all" }, { to: "/admin/businesses?status=active", label: "active" },
    { to: "/admin/businesses?status=provisioning", label: "settingUp" }, { to: "/admin/businesses?status=suspended", label: "suspended" },
    { to: "/admin/businesses?status=expired", label: "expired" }, { to: "/admin/businesses?status=archived", label: "archived" },
    { to: "/admin/businesses?status=deactivated", label: "deactivated" },
    { to: "/admin/businesses?since=30", label: "newest" }, { to: "/admin/business-types", label: "types" }, { to: "/admin/branches", label: "branches" }] },
  { id: "infra", icon: "server", items: [
    { to: "/admin/hosting", label: "hosting" }, { to: "/admin/databases", label: "databases", perm: "databases" }, { to: "/admin/backups", label: "backups", perm: "backups" }] },
  { id: "billing", icon: "credit-card", items: [
    { to: "/admin/subscriptions", label: "subscriptions" }, { to: "/admin/subscriptions?filter=due", label: "due" },
    { to: "/admin/subscriptions?filter=overdue", label: "overdue", badge: "overdue" }, { to: "/admin/subscriptions?filter=none", label: "noPlan" },
    { to: "/admin/payments", label: "payments" }, { to: "/admin/plans", label: "plans" }] },
  { id: "trials", icon: "clock", items: [
    { to: "/admin/trials", label: "trialsActive" }, { to: "/admin/trials?filter=ending", label: "trialsEnding", badge: "trialsEnding" }, { to: "/admin/trials?filter=expired", label: "trialsExpired" }] },
  { id: "users", icon: "users", items: [
    { to: "/admin/users", label: "allUsers" }, { to: "/admin/users?status=disabled", label: "disabledUsers" }, { to: "/admin/admins", label: "admins" }] },
  { id: "support", icon: "message", items: [
    { to: "/admin/tickets?status=waiting", label: "waitingTickets", badge: "tickets" }, { to: "/admin/tickets", label: "allTickets" },
    { to: "/admin/messages", label: "messages", badge: "messages" }] },
  { id: "communication", icon: "bell", items: [{ to: "/admin/announcements", label: "announcements" }] },
  { id: "reportsMenu", icon: "file-chart", perm: "reports", items: [{ to: "/admin/reports", label: "reports" }] },
  { id: "activity", icon: "activity", items: [
    { to: "/admin/security", label: "security", perm: "security" }, { to: "/admin/audit", label: "allActivity" },
    { to: "/admin/audit?kind=admin", label: "adminActions" }, { to: "/admin/audit?kind=logins", label: "logins" }] },
  { id: "system", icon: "settings", items: [
    { to: "/admin/settings", label: "settings", perm: "settings" }, { to: "/admin/export", label: "export", perm: "export" }] },
  { id: "myAccount", icon: "user-key", items: [{ to: "/admin/account", label: "account" }] }
];

export default function AdminApp() {
  const [state, setState] = useState("loading");
  const check = () => apiRequest("/api/admin/me").then(() => setState("in")).catch(() => setState("out"));
  useEffect(() => { check(); }, []);
  if (state === "loading") return <div className="app-loading"><span className="app-spinner" /></div>;
  return (
    <Routes>
      <Route path="signin" element={state === "in" ? <Navigate to="/admin" replace /> : <AdminSignIn onDone={() => setState("in")} />} />
      <Route path="*" element={state === "in" ? <AdminShell onSignOut={() => setState("out")} /> : <Navigate to="/admin/signin" replace />} />
    </Routes>
  );
}

/* Sign-in: username and password, then (when two-step sign-in is on) the 6-digit code from the authenticator app */
function AdminSignIn({ onDone }) {
  const { t } = useLanguage();
  usePageTitle("meta.signin");
  const [f, setF] = useState({ username: "", password: "", code: "" });
  const [step, setStep] = useState("password");
  const [error, setError] = useState(null);
  const sub = useSubmit();
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    const ok = await sub.run(() => apiRequest("/api/admin/sign-in", { method: "POST", body: step === "code" ? f : { username: f.username, password: f.password } }));
    if (ok) return onDone();
  };
  useEffect(() => {
    const code = sub.formError?.code || sub.formError?.data?.code;
    if (!code) return;
    if (code === "twoFactorRequired") { setStep("code"); setError(null); return; }
    setError(code === "tooManyAttempts" ? "signin.tooManyAttempts" : code === "twoFactorWrong" ? "ui.errors.twoFactorWrong" : "ui.admin.invalid");
  }, [sub.formError]);
  return (
    <div className="admin-login">
      <form className="admin-login__card" onSubmit={submit}>
        <img src={logo} alt="Faatix" />
        <span className="admin-badge"><Icon name="shield-check" />{t("ui.admin.title")}</span>
        <h1>{t(step === "code" ? "ui.platform.codeTitle" : "ui.admin.signInTitle")}</h1>
        {step === "password" ? (<>
          <Field label={t("ui.admin.username")}><input className="input" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
          <Field label={t("ui.admin.password")}><input className="input" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        </>) : (<>
          <p className="muted">{t("ui.platform.codeHelp")}</p>
          <Field label={t("ui.platform.code")}><input className="input input--big admin-login__code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} placeholder="123456" /></Field>
        </>)}
        {error && <p className="form-status form-status--error" role="alert">{t(error)}</p>}
        <button type="submit" className="btn btn--navy btn--lg btn--block" disabled={sub.busy || (step === "code" && f.code.length !== 6)}>{t("ui.admin.signIn")}</button>
        {step === "code" && <button type="button" className="link-btn" onClick={() => { setStep("password"); setF({ ...f, code: "" }); }}>{t("ui.common.back")}</button>}
      </form>
    </div>
  );
}

function AdminShell({ onSignOut }) {
  const { t, lang, setLang } = useLanguage();
  const navigate = useNavigate();
  const me = useApi("/api/admin/me");
  const [menuOpen, setMenuOpen] = useState(false);   // phones: the sidebar slides in
  const [badges, setBadges] = useState({});
  const { pathname, search } = useLocation();
  const loadBadges = useCallback(() => apiRequest("/api/admin/badges").then(setBadges).catch(() => {}), []);
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); loadBadges(); }, [pathname, search, loadBadges]);
  const signOut = async () => { await apiRequest("/api/admin/sign-out", { method: "POST" }).catch(() => {}); onSignOut(); navigate("/admin/signin"); };
  if (!me.data) return <div className="app-loading"><span className="app-spinner" /></div>;
  const admin = me.data.admin;
  const can = (perm) => admin.permissions.includes(perm) || (perm === "notes" && admin.permissions.includes("businesses"));
  return (
    <div className="app-shell admin-shell">
      <header className="app-bar app-bar--admin">
        <div className="app-bar__inner">
          <button type="button" className="admin-burger" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-controls="admin-side" aria-label={t("ui.admin.menu.menu")}><Icon name={menuOpen ? "x" : "grid"} /></button>
          <Link to="/admin" className="app-bar__brand"><img src={logo} alt="Faatix" /></Link>
          <span className="admin-badge"><Icon name="shield-check" />{t("ui.admin.title")}</span>
          <div className="app-bar__actions">
            <span className="admin-who"><Icon name="user" /><span>{admin.username}<small>{t(`ui.platform.roles.${admin.role}`)}</small></span></span>
            <div className="lang-switch" role="group">{SUPPORTED.map((c) => <button key={c} type="button" aria-pressed={lang === c} onClick={() => setLang(c)}>{c.toUpperCase()}</button>)}</div>
            <button type="button" className="app-signout" onClick={signOut}><Icon name="log-out" /><span>{t("ui.admin.signOut")}</span></button>
          </div>
        </div>
      </header>
      <div className={"admin-layout" + (menuOpen ? " is-menu-open" : "")}>
        <AdminSidebar can={can} badges={badges} />
        {menuOpen && <button type="button" className="admin-scrim" aria-label={t("ui.common.close")} onClick={() => setMenuOpen(false)} />}
        <main className="app-main admin-main">
          <Routes>
            <Route index element={<AdminDashboard can={can} />} />
            <Route path="health" element={<Health />} />
            <Route path="businesses" element={<Businesses />} />
            <Route path="businesses/create" element={can("provision") ? <RegisterBusiness /> : <Navigate to="/admin/businesses" replace />} />
            <Route path="businesses/:id/setup" element={<ProvisioningRoute can={can} />} />
            <Route path="businesses/:id" element={<BusinessDetail can={can} />} />
            <Route path="hosting" element={<Hosting can={can} />} />
            <Route path="databases" element={can("databases") ? <Databases /> : <Navigate to="/admin" replace />} />
            <Route path="backups" element={can("backups") ? <Backups /> : <Navigate to="/admin" replace />} />
            <Route path="branches" element={<BranchOverview can={can} />} />
            <Route path="business-types" element={<BusinessTypes />} />
            <Route path="subscriptions" element={<Subscriptions can={can} />} />
            <Route path="payments" element={<Payments />} />
            <Route path="plans" element={<Plans can={can} />} />
            <Route path="trials" element={<Trials can={can} />} />
            <Route path="users" element={<Users />} />
            <Route path="admins" element={<AdminsPage can={can} />} />
            <Route path="tickets" element={<Tickets can={can} />} />
            <Route path="messages" element={<Messages can={can} />} />
            <Route path="announcements" element={<Announcements can={can} />} />
            <Route path="reports" element={can("reports") ? <Reports /> : <Navigate to="/admin" replace />} />
            <Route path="security" element={can("security") ? <Security can={can} /> : <Navigate to="/admin" replace />} />
            <Route path="audit" element={<PlatformAudit />} />
            <Route path="settings" element={can("settings") ? <SettingsPage can={can} /> : <Navigate to="/admin" replace />} />
            <Route path="export" element={can("export") ? <ExportPage /> : <Navigate to="/admin" replace />} />
            <Route path="account" element={<AccountPage me={admin} onChanged={() => me.reload()} />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

/*
 * The sidebar: a group per menu, its sub-menus under it. The group of the page you are on opens by itself; the others
 * open / close on a click. A sub-menu is "current" when the address (and its filter) is exactly its link; a business's
 * own page counts as "All businesses". Counts (badges) show what is waiting.
 */
function AdminSidebar({ can, badges }) {
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  const here = `${pathname.replace(/\/$/, "") || "/admin"}${search}`;
  const isCurrent = (to) => to === here || (to === "/admin/businesses" && /^\/admin\/businesses\/\d+/.test(pathname));
  const menu = MENU.filter((g) => !g.perm || can(g.perm)).map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) })).filter((g) => g.items.length);
  const groupOf = menu.find((g) => g.items.some((i) => isCurrent(i.to)))?.id;
  const [open, setOpen] = useState(() => new Set([groupOf || "dashboard"]));
  useEffect(() => { if (groupOf) setOpen((s) => new Set([...s, groupOf])); }, [groupOf]);
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <nav className="admin-side" id="admin-side" aria-label={t("ui.admin.menu.menu")}>
      {menu.map((g) => {
        const waiting = g.items.reduce((s, i) => s + (i.badge ? badges[i.badge] || 0 : 0), 0);
        return (
          <div key={g.id} className={"admin-side__group" + (groupOf === g.id ? " is-here" : "")}>
            <button type="button" className="admin-side__head" aria-expanded={open.has(g.id)} onClick={() => toggle(g.id)}>
              <Icon name={g.icon} /><span>{t(`ui.admin.menu.${g.id}`)}</span>
              {waiting > 0 && !open.has(g.id) && <span className="admin-side__badge">{waiting}</span>}
              <Icon name="chevron-down" className="admin-side__chev" />
            </button>
            {open.has(g.id) && (
              <ul>
                {g.items.map((i) => (
                  <li key={i.to}>
                    <Link to={i.to} className={"admin-side__link" + (isCurrent(i.to) ? " is-current" : "")} aria-current={isCurrent(i.to) ? "page" : undefined}>
                      <span>{t(`ui.admin.menu.${i.label}`)}</span>
                      {i.badge && badges[i.badge] > 0 && <span className="admin-side__badge">{badges[i.badge]}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function HealthCard({ health, long = false }) {
  const { t } = useLanguage();
  const s = health.uptimeSec;
  return (
    <section className="panel-card">
      <h2 className="panel-card__title"><Icon name="activity" /> {t("ui.admin.health")}</h2>
      <dl className="sub-card__facts">
        <div><dt>{t("ui.admin.database")}</dt><dd><StatusBadge status={health.database === "connected" ? "active" : "suspended"} /></dd></div>
        <div><dt>{t("ui.admin.size")}</dt><dd>{health.sizeMb} MB</dd></div>
        <div><dt>{t("ui.admin.uptime")}</dt><dd>{long ? fill(t("ui.admin.uptimeLong"), { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60) }) : `${Math.round(s / 60)} min`}</dd></div>
        <div><dt>{long ? t("ui.admin.nodeVersion") : "Node.js"}</dt><dd>{health.node}</dd></div>
      </dl>
    </section>
  );
}

function Health() {
  const { t } = useLanguage();
  const o = useApi("/api/admin/overview");
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.health")}</h1>
      {!o.data ? <Loading /> : <HealthCard health={o.data.health} long />}
    </div>
  );
}

/* Businesses: the sidebar's sub-menus set the filter in the address (status / since / type); the list follows it */
const STATUSES = ["pending", "provisioning", "active", "suspended", "expired", "archived", "deactivated"];
function Businesses() {
  const { t, lang } = useLanguage();
  const me = useApi("/api/admin/me");
  const canRegister = me.data?.admin?.permissions?.includes("provision");
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const status = params.get("status") || "";
  const since = params.get("since") || "";
  const type = params.get("type") || "";
  const list = useApi(`/api/admin/businesses?${new URLSearchParams({ q, status, since, type })}`);
  const rows = list.data?.businesses || [];
  const title = status ? (status === "provisioning" ? t("ui.admin.menu.settingUp") : t(`ui.status.${status}`)) : since ? t("ui.admin.menu.newest") : type ? `${t("ui.admin.businesses")} · ${t(`register.types.${type}`)}` : t("ui.admin.menu.all");
  return (
    <div className="page">
      <h1 className="admin-title">{title}</h1>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} />
        <select className="input input--auto" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
          <option value="">{t("ui.common.all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`ui.status.${s}`)}</option>)}
        </select>
        {canRegister && <Link className="btn btn--primary" to="/admin/businesses/create"><Icon name="plus" /><span>{t("ui.admin.menu.register")}</span></Link>}
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.admin.businessUser")}</th><th>{t("ui.admin.owner")}</th><th>{t("ui.common.phone")}</th><th>{t("ui.admin.registered")}</th><th className="num">{t("ui.admin.users")}</th><th className="num">{t("ui.admin.transactions")}</th><th>{t("ui.admin.trial")}</th><th>{t("ui.common.status")}</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><Link to={`/admin/businesses/${b.id}`} className="biz-cell">{b.logoPath ? <img src={fileUrl(b.logoPath)} alt="" /> : <span>{b.name.slice(0, 1)}</span>}<span><strong>{b.name}</strong><small className="cell-sub">{b.slug}{b.database === "dedicated" ? ` · ${t("ui.tenancy.detail.dedicated")}` : ""}</small></span></Link></td>
                <td>{b.owner}</td><td>{b.phone}</td><td>{date(b.createdAt, lang)}</td>
                <td className="num">{b.users}</td><td className="num">{b.transactions}</td>
                <td>{b.trial ? `${t(`ui.status.${b.trial.status}`)} · ${date(b.trial.endDate, lang)}` : "—"}</td>
                <td><StatusBadge status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

/*
 * One business: status, details (edit), owner password reset, sign everyone out, plan and payments, notes, tickets,
 * users, usage and recent activity. Buttons show only to roles that may use them.
 */
function BusinessDetail({ can }) {
  const { id } = useParams();
  const { t, lang } = useLanguage();
  const d = useApi(`/api/admin/businesses/${id}`);
  const plans = useApi("/api/admin/plans");
  const [modal, setModal] = useState(null);   // suspended | deactivated | extend | edit | plan | pay | shown
  const [shown, setShown] = useState(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState(null);
  if (d.loading && !d.data) return <Loading />;
  if (!d.data) return <EmptyState text={t("ui.errors.notFound")} />;
  const { business: b, users, usage, trial, activity, subscription: s, payments, notes, tickets, owner, database, provisioning } = d.data;
  const settingUp = ["pending", "provisioning"].includes(b.status);
  const signin = b.url || (b.link ? `${window.location.origin}${b.link}` : null);
  const cur = plans.data?.currency || "USD";
  const m = (v) => money(v, cur, lang);
  const close = () => { setModal(null); d.reload(); };
  const setStatus = (status, reason) => apiRequest(`/api/admin/businesses/${b.id}`, { method: "PATCH", body: { status, reason } }).then(() => d.reload());
  const resetOwner = async () => { if (!window.confirm(fill(t("ui.platform.resetOwnerConfirm"), { name: b.name }))) return; const r = await apiRequest(`/api/admin/businesses/${b.id}/reset-owner-password`, { method: "POST" }); setShown({ ...r, title: t("ui.platform.newPassword") }); };
  const signOutAll = async () => { if (!window.confirm(fill(t("ui.platform.signOutConfirm"), { name: b.name }))) return; await apiRequest(`/api/admin/businesses/${b.id}/sign-out-all`, { method: "POST" }); setMsg(t("ui.platform.signedOut")); d.reload(); };
  const addNote = async (e) => { e.preventDefault(); if (!note.trim()) return; await apiRequest(`/api/admin/businesses/${b.id}/notes`, { method: "POST", body: { note } }); setNote(""); d.reload(); };
  const delNote = async (n) => { await apiRequest(`/api/admin/businesses/${b.id}/notes/${n.id}`, { method: "DELETE" }); d.reload(); };
  return (
    <div className="page">
      <Link className="auth__back" to="/admin/businesses"><Icon name="arrow-left" /><span>{t("ui.common.back")}</span></Link>
      <section className="panel-card admin-biz">
        <div className="admin-biz__head">
          {b.logoPath ? <img src={fileUrl(b.logoPath)} alt="" /> : <span className="admin-biz__initial">{b.name.slice(0, 1)}</span>}
          <div><h1>{b.name}</h1><p className="muted">{b.owner} · {b.phone}{b.email ? ` · ${b.email}` : ""}</p><p className="muted">{t(`register.types.${b.type}`)} · {t("ui.admin.registered")} {date(b.createdAt, lang)}{b.address ? ` · ${b.address}` : ""}</p></div>
          <StatusBadge status={b.status} />
        </div>
        <div className="form-actions admin-biz__actions">
          {settingUp && <Link className="btn btn--primary" to={`/admin/businesses/${b.id}/setup`}><Icon name="activity" /><span>{t("ui.tenancy.detail.viewSetup")}</span></Link>}
          {can("businesses") && !settingUp && b.status !== "active" && <button type="button" className="btn btn--primary" onClick={() => setStatus("active", "")}>{t("ui.admin.activate")}</button>}
          {can("businesses") && b.status === "active" && <button type="button" className="btn btn--danger" onClick={() => setModal("suspended")}>{t("ui.admin.suspend")}</button>}
          {can("businesses") && !settingUp && !["expired", "archived", "deactivated"].includes(b.status) && <button type="button" className="btn btn--outline" onClick={() => setModal("expired")}>{t("ui.tenancy.detail.expire")}</button>}
          {can("businesses") && !settingUp && b.status !== "archived" && <button type="button" className="btn btn--outline" onClick={() => setModal("archived")}><Icon name="archive" /><span>{t("ui.tenancy.detail.archive")}</span></button>}
          {can("businesses") && !settingUp && b.status !== "deactivated" && <button type="button" className="btn btn--outline" onClick={() => setModal("deactivated")}>{t("ui.admin.deactivate")}</button>}
          {can("businesses") && <button type="button" className="btn btn--outline" onClick={() => setModal("edit")}><Icon name="settings" /><span>{t("ui.platform.editDetails")}</span></button>}
          {can("businesses") && trial && !s && <button type="button" className="btn btn--outline" onClick={() => setModal("extend")}><Icon name="clock" /><span>{t("ui.admin.extend")}</span></button>}
          {can("businesses") && owner && <button type="button" className="btn btn--outline" onClick={resetOwner}><Icon name="lock" /><span>{t("ui.platform.resetOwner")}</span></button>}
          {can("security") && <button type="button" className="btn btn--outline" onClick={signOutAll}><Icon name="log-out" /><span>{t("ui.platform.signOutAll")}</span></button>}
        </div>
        {msg && <p className="form-status form-status--success">{msg}</p>}
        {provisioning?.status === "failed" && <p className="form-status form-status--error"><Icon name="alert" /> {fill(t("ui.tenancy.detail.setupFailed"), { step: t(`ui.tenancy.prov.steps.${provisioning.step}`) })} <Link to={`/admin/businesses/${b.id}/setup`}>{t("ui.tenancy.detail.viewSetup")}</Link></p>}
        <dl className="sub-card__facts biz-infra">
          {signin && <div><dt>{t("ui.tenancy.detail.signin")}</dt><dd><a href={signin} target="_blank" rel="noreferrer">{signin}</a></dd></div>}
          {database && <div><dt>{t("ui.tenancy.detail.database")}</dt><dd>{database.mode === "dedicated" ? <>{t("ui.tenancy.detail.dedicated")} · <code>{database.name}</code></> : t("ui.tenancy.detail.shared")}{database.schemaVersion ? ` · v${database.schemaVersion}` : ""}</dd></div>}
          <div><dt>{t("ui.tenancy.branches.limit")}</dt><dd>{b.maxBranches ?? "—"} {can("businesses") && <button type="button" className="link-btn" onClick={() => setModal("branches")}>{t("ui.tenancy.branches.setLimit")}</button>}</dd></div>
        </dl>
        <p className="page-help"><Icon name="lock" /> {t("ui.admin.privacy")}</p>
      </section>
      <div className="split-view">
        <section className="panel-card">
          <h2 className="panel-card__title"><Icon name="credit-card" /> {t("ui.platform.planPayments")}</h2>
          {s ? (
            <dl className="sub-card__facts">
              <div><dt>{t("ui.billing.plan")}</dt><dd><b>{s.plan}</b> · {t(`ui.billing.cycles.${s.cycle}`)}</dd></div>
              <div><dt>{t("ui.billing.price")}</dt><dd>{m(s.price)}</dd></div>
              <div><dt>{t("ui.billing.paidUntil")}</dt><dd>{date(s.periodEnd, lang)}</dd></div>
              <div><dt>{t("ui.common.status")}</dt><dd>{t(`ui.billing.statuses.${s.status}`)}</dd></div>
            </dl>
          ) : <p className="muted">{trial ? `${t("ui.admin.trial")}: ${t(`ui.status.${trial.status}`)} · ${date(trial.start_date, lang)} – ${date(trial.end_date, lang)}` : t("ui.billing.noPlanYet")}</p>}
          {can("billing") && (
            <div className="form-actions">
              {s && s.status !== "cancelled" && <button type="button" className="btn btn--primary btn--sm" onClick={() => setModal("pay")}><Icon name="wallet" /><span>{t("ui.billing.recordPayment")}</span></button>}
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal("plan")}>{t(s ? "ui.billing.changePlan" : "ui.billing.givePlan")}</button>
            </div>
          )}
          {payments.length > 0 && (
            <table className="table table--compact"><tbody>{payments.slice(0, 8).map((p) => (
              <tr key={p.id}><td>{date(p.paidAt, lang)}</td><td>{p.plan || "—"}<small className="cell-sub">{t(`ui.billing.methods.${p.method}`)}{p.reference ? ` · ${p.reference}` : ""}</small></td><td className="num"><b>{m(p.amount)}</b></td></tr>
            ))}</tbody></table>
          )}
        </section>
        <section className="panel-card">
          <h2 className="panel-card__title"><Icon name="file-chart" /> {t("ui.platform.notes")}</h2>
          {can("notes") && <form onSubmit={addNote} className="note-form"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ui.platform.notePh")} /><button type="submit" className="btn btn--primary btn--sm" disabled={!note.trim()}>{t("ui.common.add")}</button></form>}
          {notes.length === 0 ? <p className="muted">{t("ui.platform.noNotes")}</p> : (
            <ul className="note-list">{notes.map((n) => <li key={n.id}><p>{n.note}</p><small className="muted">{n.admin || "—"} · {date(n.at, lang, true)}{can("notes") && <button type="button" className="link-btn" onClick={() => delNote(n)}> {t("ui.common.delete")}</button>}</small></li>)}</ul>
          )}
        </section>
      </div>
      <div className="split-view">
        <section className="panel-card">
          <h2 className="panel-card__title">{t("ui.admin.usage")}</h2>
          <dl className="sub-card__facts">{Object.entries(usage).map(([k, v]) => <div key={k}><dt>{t(`ui.platform.usage.${k}`).startsWith("ui.") ? k : t(`ui.platform.usage.${k}`)}</dt><dd>{v}</dd></div>)}</dl>
        </section>
        <section className="panel-card">
          <h2 className="panel-card__title">{t("ui.admin.users")}</h2>
          <ul className="pay-list">{users.map((u) => <li key={u.id}><strong>{u.fullName}</strong> · {u.username} · {u.roleName || t(`app.roles.${u.role}`)} · <StatusBadge status={u.status} /></li>)}</ul>
        </section>
      </div>
      {!settingUp && <BusinessModules businessId={b.id} can={can} />}
      {tickets.length > 0 && (
        <section className="panel-card">
          <h2 className="panel-card__title"><Icon name="message" /> {t("ui.platform.tickets")}</h2>
          <ul className="pay-list">{tickets.map((x) => <li key={x.id}><Link to="/admin/tickets">{x.subject}</Link> · {t(`ui.support.statuses.${x.status}`)} · {date(x.updatedAt, lang, true)}</li>)}</ul>
        </section>
      )}
      <section className="panel-card">
        <h2 className="panel-card__title">{t("ui.admin.activity")}</h2>
        <ul className="pay-list">{activity.map((a, i) => <li key={i}>{date(a.at, lang, true)} · {a.user || "—"} · <code className="action-code">{a.action}</code></li>)}</ul>
      </section>
      {modal === "branches" && <BranchLimit business={{ id: b.id, name: b.name, limitFrom: b.maxBranches ? "business" : null, limit: b.maxBranches }} onClose={() => setModal(null)} onDone={close} />}
      {["suspended", "deactivated", "expired", "archived"].includes(modal) && <ReasonModal title={modal === "expired" ? t("ui.tenancy.detail.expire") : modal === "archived" ? t("ui.tenancy.detail.archive") : t(`ui.admin.${modal === "suspended" ? "suspend" : "deactivate"}`)} help={t("ui.admin.reasonRequired")} confirmLabel={t("ui.common.confirm")}
        onConfirm={(reason) => setStatus(modal, reason)} onClose={() => setModal(null)} />}
      {modal === "extend" && <ExtendTrial business={b} onClose={() => setModal(null)} onDone={close} />}
      {modal === "edit" && <EditBusiness business={b} onClose={() => setModal(null)} onDone={close} />}
      {modal === "plan" && <GivePlan business={{ id: b.id, name: b.name, planId: s?.planId, cycle: s?.cycle }} plans={plans.data?.plans || []} currency={cur} onClose={() => setModal(null)} onDone={close} />}
      {modal === "pay" && s && <RecordPayment sub={{ businessId: b.id, business: b.name, plan: s.plan, cycle: s.cycle, price: s.price, periodEnd: s.periodEnd }} currency={cur} onClose={() => setModal(null)} onDone={close} />}
      {shown && <ShownOnce title={shown.title} username={shown.username} password={shown.password} onClose={() => setShown(null)} />}
    </div>
  );
}

const TYPES = ["supermarket", "cosmetics", "fashion", "pharmacy", "electronics", "jewelry", "fabric", "restaurant", "cafe", "fast_food", "bakery", "juice_bar", "food_truck", "takeaway", "food_other"];
function EditBusiness({ business: b, onClose, onDone }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ name: b.name, ownerName: b.owner, phone: b.phone || "", email: b.email || "", address: b.address || "", type: b.type });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(`/api/admin/businesses/${b.id}`, { method: "PUT", body: f }))) onDone(); };
  return (
    <Modal title={t("ui.platform.editDetails")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.name")} error={sub.fieldErrors.name}><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label={t("ui.admin.owner")} error={sub.fieldErrors.ownerName}><input className="input" value={f.ownerName} onChange={set("ownerName")} /></Field>
        <Field label={t("ui.common.phone")} error={sub.fieldErrors.phone}><input className="input" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={t("ui.admin.email")} error={sub.fieldErrors.email}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={t("ui.common.address")}><input className="input" value={f.address} onChange={set("address")} /></Field>
        <Field label={t("ui.admin.type")}><select className="input" value={f.type} onChange={set("type")}>{TYPES.map((x) => <option key={x} value={x}>{t(`register.types.${x}`)}</option>)}</select></Field>
        <p className="muted ff--full">{t("ui.platform.typeChangeNote")}</p>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

/* Extend a business's trial by a number of days (recorded in the platform activity log) */
function ExtendTrial({ business, onClose, onDone }) {
  const { t } = useLanguage();
  const [days, setDays] = useState("7");
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(`/api/admin/businesses/${business.id}/trial`, { method: "PATCH", body: { days: Number(days) } }))) onDone(); };
  return (
    <Modal title={fill(t("ui.admin.extendTitle"), { name: business.name })} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.admin.extendDays")} error={sub.fieldErrors.days}>
          <div className="seg">{["7", "14", "30"].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{d}</button>)}</div>
        </Field>
        <FormError error={sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.admin.extend")}</button>
        </div>
      </form>
    </Modal>
  );
}

function BusinessTypes() {
  const { t, lang } = useLanguage();
  const d = useApi("/api/admin/business-types");
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.types")}</h1>
      {!d.data ? <Loading /> : d.data.types.length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.admin.type")}</th><th className="num">{t("ui.admin.count")}</th><th className="num">{t("ui.admin.menu.active")}</th><th>{t("ui.admin.latest")}</th><th /></tr></thead>
          <tbody>{d.data.types.map((x) => (
            <tr key={x.type}>
              <td><strong>{t(`register.types.${x.type}`).startsWith("register.") ? x.type : t(`register.types.${x.type}`)}</strong></td>
              <td className="num">{x.count}</td><td className="num">{x.active}</td><td>{date(x.latest, lang)}</td>
              <td><Link className="btn btn--outline btn--sm" to={`/admin/businesses?type=${encodeURIComponent(x.type)}`}>{t("ui.admin.view")}</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

/* Trials: active, ending within 7 days, expired; each can be extended */
function Trials({ can }) {
  const { t, lang } = useLanguage();
  const [params] = useSearchParams();
  const filter = params.get("filter") || "";
  const d = useApi(`/api/admin/trials?filter=${filter}`);
  const [extending, setExtending] = useState(null);
  const rows = d.data?.trials || [];
  return (
    <div className="page">
      <h1 className="admin-title">{t(`ui.admin.menu.${filter === "ending" ? "trialsEnding" : filter === "expired" ? "trialsExpired" : "trialsActive"}`)}</h1>
      {!d.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="clock" text={t("ui.admin.noTrials")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.admin.businessUser")}</th><th>{t("ui.admin.owner")}</th><th>{t("ui.common.phone")}</th><th>{t("ui.admin.starts")}</th><th>{t("ui.admin.ends")}</th><th className="num">{t("ui.admin.daysLeft")}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.businessId}>
              <td><Link to={`/admin/businesses/${r.businessId}`}><strong>{r.name}</strong></Link></td>
              <td>{r.owner}</td><td>{r.phone}</td><td>{date(r.start, lang)}</td><td>{date(r.end, lang)}</td>
              <td className={"num" + (r.daysLeft <= 3 ? " is-neg" : "")}>{Math.max(0, r.daysLeft)}</td>
              <td>{can("businesses") && <button type="button" className="btn btn--outline btn--sm" onClick={() => setExtending({ id: r.businessId, name: r.name })}>{t("ui.admin.extend")}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {extending && <ExtendTrial business={extending} onClose={() => setExtending(null)} onDone={() => { setExtending(null); d.reload(); }} />}
    </div>
  );
}

/* Every business user on the platform (search by name, username, phone or business) */
function Users() {
  const { t, lang } = useLanguage();
  const [params] = useSearchParams();
  const status = params.get("status") || "";
  const [q, setQ] = useState("");
  const d = useApi(`/api/admin/users?${new URLSearchParams({ q, status })}`);
  const rows = d.data?.users || [];
  return (
    <div className="page">
      <h1 className="admin-title">{t(`ui.admin.menu.${status === "disabled" ? "disabledUsers" : "allUsers"}`)}</h1>
      <div className="toolbar"><SearchBox value={q} onChange={setQ} /></div>
      {!d.data ? <Loading /> : rows.length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.common.name")}</th><th>{t("ui.admin.username")}</th><th>{t("ui.admin.businessUser")}</th><th>{t("ui.admin.role")}</th><th>{t("ui.admin.lastLogin")}</th><th>{t("ui.common.status")}</th></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id}>
              <td><strong>{u.name}</strong>{u.phone && <small className="cell-sub">{u.phone}</small>}</td><td>{u.username}</td>
              <td><Link to={`/admin/businesses/${u.businessId}`}>{u.business}</Link></td>
              <td>{u.role === "owner" ? t("app.roles.owner") : u.role}</td>
              <td>{u.lastLoginAt ? date(u.lastLoginAt, lang, true) : t("ui.admin.never")}</td>
              <td><StatusBadge status={u.status} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function PlatformAudit() {
  const { t, lang } = useLanguage();
  const [params] = useSearchParams();
  const kind = params.get("kind") || "";
  const list = useApi(`/api/admin/audit?kind=${kind}`);
  return (
    <div className="page">
      <h1 className="admin-title">{t(`ui.admin.menu.${kind === "admin" ? "adminActions" : kind === "logins" ? "logins" : "allActivity"}`)}</h1>
      {!list.data ? <Loading /> : list.data.logs.length === 0 ? <EmptyState icon="activity" text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table table--compact">
          <thead><tr><th>{t("ui.audit.when")}</th><th>{t("ui.admin.businessUser")}</th><th>{t("ui.common.user")}</th><th>{t("ui.audit.action")}</th><th>IP</th></tr></thead>
          <tbody>{list.data.logs.map((l, i) => <tr key={i}><td>{date(l.at, lang, true)}</td><td>{l.business || "—"}</td><td>{l.user || "—"}</td><td><code className="action-code">{l.action}</code></td><td>{l.ip || "—"}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
