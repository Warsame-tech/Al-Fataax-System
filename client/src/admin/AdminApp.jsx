import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { SUPPORTED, useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../services/api.js";
import { useApi, useSubmit, Field, FormError, Loading, EmptyState, StatusBadge, SearchBox, ReasonModal } from "../app/ui.jsx";
import { date } from "../app/format.js";
import usePageTitle from "../hooks/usePageTitle.js";
import logo from "../assets/faatix-logo.png";

/*
 * Super Admin (platform owner) area — separate sign-in and session from businesses.
 *   /admin/signin, /admin (overview), /admin/businesses, /admin/businesses/:id, /admin/audit
 */
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
  const signOut = async () => { await apiRequest("/api/admin/sign-out", { method: "POST" }).catch(() => {}); onSignOut(); navigate("/admin/signin"); };
  return (
    <div className="app-shell admin-shell">
      <header className="app-bar app-bar--admin">
        <div className="app-bar__inner">
          <Link to="/admin" className="app-bar__brand"><img src={logo} alt="Faatix" /></Link>
          <span className="admin-badge"><Icon name="shield-check" />{t("ui.admin.title")}</span>
          <nav className="admin-nav">
            <Link to="/admin">{t("ui.admin.overview")}</Link>
            <Link to="/admin/businesses">{t("ui.admin.businesses")}</Link>
            <Link to="/admin/audit">{t("ui.admin.audit")}</Link>
          </nav>
          <div className="app-bar__actions">
            <div className="lang-switch" role="group">{SUPPORTED.map((c) => <button key={c} type="button" aria-pressed={lang === c} onClick={() => setLang(c)}>{c.toUpperCase()}</button>)}</div>
            <button type="button" className="app-signout" onClick={signOut}><Icon name="log-out" /><span>{t("ui.admin.signOut")}</span></button>
          </div>
        </div>
      </header>
      <main className="app-main">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="businesses" element={<Businesses />} />
          <Route path="businesses/:id" element={<BusinessDetail />} />
          <Route path="audit" element={<PlatformAudit />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Overview() {
  const { t } = useLanguage();
  const o = useApi("/api/admin/overview");
  if (!o.data) return <Loading />;
  const { counts, health } = o.data;
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.overview")}</h1>
      <div className="dash-kpis">
        {Object.entries(counts).map(([k, v]) => (
          <article key={k} className="kpi kpi--navy"><div className="kpi__top"><h3>{t(`ui.admin.counts.${k}`)}</h3></div><p className="kpi__value">{v}</p></article>
        ))}
      </div>
      <section className="panel-card">
        <h2 className="panel-card__title"><Icon name="activity" /> {t("ui.admin.health")}</h2>
        <dl className="sub-card__facts">
          <div><dt>{t("ui.admin.database")}</dt><dd><StatusBadge status={health.database === "connected" ? "active" : "suspended"} /></dd></div>
          <div><dt>{t("ui.admin.size")}</dt><dd>{health.sizeMb} MB</dd></div>
          <div><dt>{t("ui.admin.uptime")}</dt><dd>{Math.round(health.uptimeSec / 60)} min</dd></div>
          <div><dt>Node.js</dt><dd>{health.node}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function Businesses() {
  const { t, lang } = useLanguage();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useApi(`/api/admin/businesses?${new URLSearchParams({ q, status })}`);
  const rows = list.data?.businesses || [];
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.businesses")}</h1>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)}>
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
          <ul className="pay-list">{users.map((u) => <li key={u.id}><strong>{u.fullName}</strong> · {u.username} · {t(`app.roles.${u.role}`)} · <StatusBadge status={u.status} /></li>)}</ul>
        </section>
      </div>
      <section className="panel-card">
        <h2 className="panel-card__title">{t("ui.admin.activity")}</h2>
        <ul className="pay-list">{activity.map((a, i) => <li key={i}>{date(a.at, lang, true)} · {a.user || "—"} · <code className="action-code">{a.action}</code></li>)}</ul>
      </section>
      {changing && <ReasonModal title={t(`ui.admin.${changing === "suspended" ? "suspend" : "deactivate"}`)} help={t("ui.admin.reasonRequired")} confirmLabel={t("ui.common.confirm")}
        onConfirm={(reason) => setStatus(changing, reason)} onClose={() => setChanging(null)} />}
    </div>
  );
}

function PlatformAudit() {
  const { t, lang } = useLanguage();
  const list = useApi("/api/admin/audit");
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.audit")}</h1>
      {!list.data ? <Loading /> : (
        <div className="table-wrap"><table className="table table--compact">
          <thead><tr><th>{t("ui.audit.when")}</th><th>{t("ui.admin.businessUser")}</th><th>{t("ui.common.user")}</th><th>{t("ui.audit.action")}</th><th>IP</th></tr></thead>
          <tbody>{list.data.logs.map((l, i) => <tr key={i}><td>{date(l.at, lang, true)}</td><td>{l.business || "—"}</td><td>{l.user || "—"}</td><td><code className="action-code">{l.action}</code></td><td>{l.ip || "—"}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
