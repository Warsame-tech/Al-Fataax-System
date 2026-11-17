import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { SUPPORTED, useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../services/api.js";
import { useApi, useSubmit, Field, FormError, Loading, EmptyState, StatusBadge, SearchBox, ReasonModal, Modal } from "../app/ui.jsx";
import { date, fill } from "../app/format.js";
import usePageTitle from "../hooks/usePageTitle.js";
import logo from "../assets/faatix-logo.png";

/*
 * Super Admin (platform owner) area — separate sign-in and session from businesses.
 * A sidebar with menus and sub-menus (MENU); each sub-menu is a page or a filtered view of one:
 *   /admin (overview), /admin/health, /admin/businesses[?status=|since=|type=], /admin/businesses/:id, /admin/business-types,
 *   /admin/trials[?filter=ending|expired], /admin/users[?status=disabled], /admin/admins, /admin/audit[?kind=admin|logins], /admin/account
 */
const MENU = [
  { id: "dashboard", icon: "grid", items: [
    { to: "/admin", label: "overview" }, { to: "/admin/health", label: "health" }] },
  { id: "businesses", icon: "briefcase", items: [
    { to: "/admin/businesses", label: "all" }, { to: "/admin/businesses?status=active", label: "active" },
    { to: "/admin/businesses?status=suspended", label: "suspended" }, { to: "/admin/businesses?status=deactivated", label: "deactivated" },
    { to: "/admin/businesses?since=30", label: "newest" }, { to: "/admin/business-types", label: "types" }] },
  { id: "trials", icon: "clock", items: [
    { to: "/admin/trials", label: "trialsActive" }, { to: "/admin/trials?filter=ending", label: "trialsEnding" }, { to: "/admin/trials?filter=expired", label: "trialsExpired" }] },
  { id: "users", icon: "users", items: [
    { to: "/admin/users", label: "allUsers" }, { to: "/admin/users?status=disabled", label: "disabledUsers" }, { to: "/admin/admins", label: "admins" }] },
  { id: "activity", icon: "activity", items: [
    { to: "/admin/audit", label: "allActivity" }, { to: "/admin/audit?kind=admin", label: "adminActions" }, { to: "/admin/audit?kind=logins", label: "logins" }] },
  { id: "account", icon: "user-key", items: [{ to: "/admin/account", label: "password" }] }
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

function AdminSignIn({ onDone }) {
  const { t } = useLanguage();
  usePageTitle("meta.signin");
  const [f, setF] = useState({ username: "", password: "" });
  const [error, setError] = useState(false);
  const sub = useSubmit();
  const submit = async (e) => {
    e.preventDefault(); setError(false);
    const ok = await sub.run(() => apiRequest("/api/admin/sign-in", { method: "POST", body: f }));
    if (ok) onDone(); else setError(true);
  };
  return (
    <div className="admin-login">
      <form className="admin-login__card" onSubmit={submit}>
        <img src={logo} alt="Faatix" />
        <span className="admin-badge"><Icon name="shield-check" />{t("ui.admin.title")}</span>
        <h1>{t("ui.admin.signInTitle")}</h1>
        <Field label={t("ui.admin.username")}><input className="input" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label={t("ui.admin.password")}><input className="input" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {error && <p className="form-status form-status--error" role="alert">{sub.formError?.code === "tooManyAttempts" ? t("signin.tooManyAttempts") : t("ui.admin.invalid")}</p>}
        <button type="submit" className="btn btn--navy btn--lg btn--block" disabled={sub.busy}>{t("ui.admin.signIn")}</button>
      </form>
    </div>
  );
}

function AdminShell({ onSignOut }) {
  const { t, lang, setLang } = useLanguage();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);   // phones: the sidebar slides in
  const { pathname, search } = useLocation();
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [pathname, search]);
  const signOut = async () => { await apiRequest("/api/admin/sign-out", { method: "POST" }).catch(() => {}); onSignOut(); navigate("/admin/signin"); };
  return (
    <div className="app-shell admin-shell">
      <header className="app-bar app-bar--admin">
        <div className="app-bar__inner">
          <button type="button" className="admin-burger" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-controls="admin-side" aria-label={t("ui.admin.menu.menu")}><Icon name={menuOpen ? "x" : "grid"} /></button>
          <Link to="/admin" className="app-bar__brand"><img src={logo} alt="Faatix" /></Link>
          <span className="admin-badge"><Icon name="shield-check" />{t("ui.admin.title")}</span>
          <div className="app-bar__actions">
            <div className="lang-switch" role="group">{SUPPORTED.map((c) => <button key={c} type="button" aria-pressed={lang === c} onClick={() => setLang(c)}>{c.toUpperCase()}</button>)}</div>
            <button type="button" className="app-signout" onClick={signOut}><Icon name="log-out" /><span>{t("ui.admin.signOut")}</span></button>
          </div>
        </div>
      </header>
      <div className={"admin-layout" + (menuOpen ? " is-menu-open" : "")}>
        <AdminSidebar />
        {menuOpen && <button type="button" className="admin-scrim" aria-label={t("ui.common.close")} onClick={() => setMenuOpen(false)} />}
        <main className="app-main admin-main">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="health" element={<Health />} />
            <Route path="businesses" element={<Businesses />} />
            <Route path="businesses/:id" element={<BusinessDetail />} />
            <Route path="business-types" element={<BusinessTypes />} />
            <Route path="trials" element={<Trials />} />
            <Route path="users" element={<Users />} />
            <Route path="admins" element={<Admins />} />
            <Route path="audit" element={<PlatformAudit />} />
            <Route path="account" element={<Account />} />
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
 * own page counts as "All businesses".
 */
function AdminSidebar() {
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  const here = `${pathname.replace(/\/$/, "") || "/admin"}${search}`;
  const isCurrent = (to) => to === here || (to === "/admin/businesses" && /^\/admin\/businesses\/\d+/.test(pathname));
  const groupOf = MENU.find((g) => g.items.some((i) => isCurrent(i.to)))?.id;
  const [open, setOpen] = useState(() => new Set([groupOf || "dashboard"]));
  useEffect(() => { if (groupOf) setOpen((s) => new Set([...s, groupOf])); }, [groupOf]);
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <nav className="admin-side" id="admin-side" aria-label={t("ui.admin.menu.menu")}>
      {MENU.map((g) => (
        <div key={g.id} className={"admin-side__group" + (groupOf === g.id ? " is-here" : "")}>
          <button type="button" className="admin-side__head" aria-expanded={open.has(g.id)} onClick={() => toggle(g.id)}>
            <Icon name={g.icon} /><span>{t(`ui.admin.menu.${g.id}`)}</span><Icon name="chevron-down" className="admin-side__chev" />
          </button>
          {open.has(g.id) && (
            <ul>
              {g.items.map((i) => (
                <li key={i.to}><Link to={i.to} className={"admin-side__link" + (isCurrent(i.to) ? " is-current" : "")} aria-current={isCurrent(i.to) ? "page" : undefined}>{t(`ui.admin.menu.${i.label}`)}</Link></li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}

function Overview() {
  const { t } = useLanguage();
  const o = useApi("/api/admin/overview");
  if (!o.data) return <Loading />;
  const { counts, health } = o.data;
  // each total opens the list behind it
  const LINK = { businesses: "/admin/businesses", active: "/admin/businesses?status=active", suspended: "/admin/businesses?status=suspended", users: "/admin/users",
    new30: "/admin/businesses?since=30", trials: "/admin/trials" };
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.overview")}</h1>
      <div className="dash-kpis">
        {Object.entries(counts).map(([k, v]) => {
          const body = <><div className="kpi__top"><h3>{t(`ui.admin.counts.${k}`)}</h3></div><p className="kpi__value">{v}</p></>;
          return LINK[k] ? <Link key={k} to={LINK[k]} className="kpi kpi--navy kpi--link">{body}</Link> : <article key={k} className="kpi kpi--navy">{body}</article>;
        })}
      </div>
      <HealthCard health={health} />
    </div>
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
function Businesses() {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const status = params.get("status") || "";
  const since = params.get("since") || "";
  const type = params.get("type") || "";
  const list = useApi(`/api/admin/businesses?${new URLSearchParams({ q, status, since, type })}`);
  const rows = list.data?.businesses || [];
  const title = status ? t(`ui.admin.menu.${status}`) : since ? t("ui.admin.menu.newest") : type ? `${t("ui.admin.businesses")} · ${t(`register.types.${type}`)}` : t("ui.admin.menu.all");
  return (
    <div className="page">
      <h1 className="admin-title">{title}</h1>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} />
        <select className="input input--auto" value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
          <option value="">{t("ui.common.all")}</option>
          {["active", "suspended", "deactivated"].map((s) => <option key={s} value={s}>{t(`ui.status.${s}`)}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.admin.businessUser")}</th><th>{t("ui.admin.owner")}</th><th>{t("ui.common.phone")}</th><th>{t("ui.admin.registered")}</th><th className="num">{t("ui.admin.users")}</th><th className="num">{t("ui.admin.transactions")}</th><th>{t("ui.admin.trial")}</th><th>{t("ui.common.status")}</th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><Link to={`/admin/businesses/${b.id}`} className="biz-cell">{b.logoPath ? <img src={fileUrl(b.logoPath)} alt="" /> : <span>{b.name.slice(0, 1)}</span>}<strong>{b.name}</strong></Link></td>
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

function BusinessDetail() {
  const { id } = useParams();
  const { t, lang } = useLanguage();
  const d = useApi(`/api/admin/businesses/${id}`);
  const [changing, setChanging] = useState(null);
  const [extending, setExtending] = useState(false);
  if (d.loading && !d.data) return <Loading />;
  if (!d.data) return <EmptyState text={t("ui.errors.notFound")} />;
  const { business: b, users, usage, trial, activity } = d.data;
  const setStatus = (status, reason) => apiRequest(`/api/admin/businesses/${b.id}`, { method: "PATCH", body: { status, reason } }).then(() => d.reload());
  return (
    <div className="page">
      <Link className="auth__back" to="/admin/businesses"><Icon name="arrow-left" /><span>{t("ui.common.back")}</span></Link>
      <section className="panel-card admin-biz">
        <div className="admin-biz__head">
          {b.logoPath ? <img src={fileUrl(b.logoPath)} alt="" /> : <span className="admin-biz__initial">{b.name.slice(0, 1)}</span>}
          <div><h1>{b.name}</h1><p className="muted">{b.owner} · {b.phone}{b.email ? ` · ${b.email}` : ""}</p><p className="muted">{t(`register.types.${b.type}`)} · {t("ui.admin.registered")} {date(b.createdAt, lang)}</p></div>
          <StatusBadge status={b.status} />
        </div>
        <div className="form-actions">
          {b.status !== "active" && <button type="button" className="btn btn--primary" onClick={() => setStatus("active", "")}>{t("ui.admin.activate")}</button>}
          {b.status === "active" && <button type="button" className="btn btn--danger" onClick={() => setChanging("suspended")}>{t("ui.admin.suspend")}</button>}
          {b.status !== "deactivated" && <button type="button" className="btn btn--outline" onClick={() => setChanging("deactivated")}>{t("ui.admin.deactivate")}</button>}
          {trial && <button type="button" className="btn btn--outline" onClick={() => setExtending(true)}><Icon name="clock" /><span>{t("ui.admin.extend")}</span></button>}
        </div>
        <p className="page-help"><Icon name="lock" /> {t("ui.admin.privacy")}</p>
      </section>
      <div className="split-view">
        <section className="panel-card">
          <h2 className="panel-card__title">{t("ui.admin.usage")}</h2>
          <dl className="sub-card__facts">{Object.entries(usage).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {trial && <p className="muted">{t("ui.admin.trial")}: {t(`ui.status.${trial.status}`)} · {date(trial.start_date, lang)} – {date(trial.end_date, lang)}</p>}
        </section>
        <section className="panel-card">
          <h2 className="panel-card__title">{t("ui.admin.users")}</h2>
          <ul className="pay-list">{users.map((u) => <li key={u.id}><strong>{u.fullName}</strong> · {u.username} · {u.roleName || t(`app.roles.${u.role}`)} · <StatusBadge status={u.status} /></li>)}</ul>
        </section>
      </div>
      <section className="panel-card">
        <h2 className="panel-card__title">{t("ui.admin.activity")}</h2>
        <ul className="pay-list">{activity.map((a, i) => <li key={i}>{date(a.at, lang, true)} · {a.user || "—"} · <code className="action-code">{a.action}</code></li>)}</ul>
      </section>
      {changing && <ReasonModal title={t(`ui.admin.${changing === "suspended" ? "suspend" : "deactivate"}`)} help={t("ui.admin.reasonRequired")} confirmLabel={t("ui.common.confirm")}
        onConfirm={(reason) => setStatus(changing, reason)} onClose={() => setChanging(null)} />}
      {extending && <ExtendTrial business={b} onClose={() => setExtending(false)} onDone={() => { setExtending(false); d.reload(); }} />}
    </div>
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
function Trials() {
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
              <td><button type="button" className="btn btn--outline btn--sm" onClick={() => setExtending({ id: r.businessId, name: r.name })}>{t("ui.admin.extend")}</button></td>
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

function Admins() {
  const { t, lang } = useLanguage();
  const d = useApi("/api/admin/admins");
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.admins")}</h1>
      {!d.data ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.admin.username")}</th><th>{t("ui.admin.email")}</th><th>{t("ui.admin.lastLogin")}</th><th>{t("ui.admin.registered")}</th><th>{t("ui.common.status")}</th></tr></thead>
          <tbody>{d.data.admins.map((a) => (
            <tr key={a.id}>
              <td><strong>{a.username}</strong>{a.me && <span className="track-tag"> {t("ui.admin.you")}</span>}</td><td>{a.email || "—"}</td>
              <td>{a.lastLoginAt ? date(a.lastLoginAt, lang, true) : t("ui.admin.never")}</td><td>{date(a.createdAt, lang)}</td><td><StatusBadge status={a.status} /></td>
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

/* My account: change my own super admin password (the current one is asked for) */
function Account() {
  const { t } = useLanguage();
  const [f, setF] = useState({ current: "", next: "", repeat: "" });
  const [done, setDone] = useState(false);
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault(); setDone(false);
    if (f.next !== f.repeat) { sub.setFieldErrors({ repeat: "mismatch" }); return; }
    if (await sub.run(() => apiRequest("/api/admin/me/password", { method: "POST", body: { current: f.current, next: f.next } }))) { setDone(true); setF({ current: "", next: "", repeat: "" }); }
  };
  const err = (k) => sub.fieldErrors[k];   // codes: wrongPassword, adminPasswordWeak, mismatch (ui.errors)
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.password")}</h1>
      <form onSubmit={save} className="panel-card form-grid admin-account">
        <Field label={t("ui.admin.currentPassword")} error={err("current")}><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label={t("ui.admin.newPassword")} error={err("next")} hint={t("ui.admin.passwordRules")}><input className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label={t("ui.admin.repeatPassword")} error={err("repeat")}><input className="input" type="password" autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} /></Field>
        {sub.formError && sub.formError.code !== "validation" && <FormError error={sub.formError} />}
        {done && <p className="form-status form-status--success" role="status">{t("ui.admin.passwordSaved")}</p>}
        <div className="form-actions"><button type="submit" className="btn btn--navy" disabled={sub.busy || !f.current || !f.next}>{t("ui.common.save")}</button></div>
      </form>
    </div>
  );
}
