import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BrowserQRCodeSvgWriter } from "@zxing/browser";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { useApi, useSubmit, Field, FormError, Loading, EmptyState, StatusBadge, Modal } from "../app/ui.jsx";
import { date, fill, money } from "../app/format.js";
import { AreaChart, BarChart, Donut, paletteColor } from "./Charts.jsx";

/*
 * Running the platform: announcements, reports, security, super admins, system settings, data export, my account.
 * Each page shows its actions only to roles that may use them (`can`, from GET /api/admin/me); the server checks too.
 */
const TYPES = ["supermarket", "cosmetics", "fashion", "pharmacy", "electronics", "jewelry", "fabric", "restaurant", "cafe", "fast_food", "bakery", "juice_bar", "food_truck", "takeaway", "food_other"];
const useTypeName = () => { const { t } = useLanguage(); return (x) => (t(`register.types.${x}`).startsWith("register.") ? x : t(`register.types.${x}`)); };
/* "Shown once" box for new passwords */
export function ShownOnce({ title, username, password, onClose }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="shown-once">
        <p className="modal__help">{t("ui.platform.shownOnce")}</p>
        <dl><div><dt>{t("ui.admin.username")}</dt><dd><code>{username}</code></dd></div><div><dt>{t("ui.admin.password")}</dt><dd><code className="shown-once__pw">{password}</code></dd></div></dl>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={() => { navigator.clipboard?.writeText(password).then(() => setCopied(true)).catch(() => {}); }}><Icon name="copy" /><span>{copied ? t("ui.platform.copied") : t("ui.platform.copy")}</span></button>
          <button type="button" className="btn btn--primary" onClick={onClose}>{t("ui.common.close")}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ===================== announcements ===================== */
export function Announcements({ can }) {
  const { t, lang } = useLanguage();
  const typeName = useTypeName();
  const d = useApi("/api/admin/announcements");
  const [editing, setEditing] = useState(null);
  const del = async (a) => { if (window.confirm(fill(t("ui.platform.deleteConfirm"), { title: a.title }))) { await apiRequest(`/api/admin/announcements/${a.id}`, { method: "DELETE" }); d.reload(); } };
  return (
    <div className="page">
      <div className="admin-head"><h1 className="admin-title">{t("ui.admin.menu.announcements")}</h1>{can("announcements") && <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.platform.newAnnouncement")}</span></button>}</div>
      <p className="page-help"><Icon name="info" /> {t("ui.platform.annHelp")}</p>
      {!d.data ? <Loading /> : d.data.announcements.length === 0 ? <EmptyState icon="bell" text={t("ui.platform.noAnnouncements")} /> : (
        <div className="ann-list">
          {d.data.announcements.map((a) => (
            <article key={a.id} className={`ann-card is-${a.level}${a.live ? " is-live" : ""}`}>
              <header>
                <span className="ann-card__level"><Icon name={a.level === "warning" ? "alert" : a.level === "success" ? "check" : "info"} /></span>
                <strong>{a.title}</strong>
                {a.live ? <span className="ann-card__live">{t("ui.platform.live")}</span> : <span className="track-tag">{a.isActive ? t("ui.platform.scheduled") : t("ui.platform.off")}</span>}
              </header>
              <p>{a.body}</p>
              <footer className="muted">
                {a.audience === "type" ? typeName(a.businessType) : t("ui.platform.everyone")} · {date(a.startsAt, lang, true)}{a.endsAt ? ` → ${date(a.endsAt, lang, true)}` : ""} · {a.admin || "—"}
                {can("announcements") && <span className="ann-card__actions"><button type="button" className="icon-btn" onClick={() => setEditing(a)} title={t("ui.common.edit")}><Icon name="settings" /></button><button type="button" className="icon-btn" onClick={() => del(a)} title={t("ui.common.delete")}><Icon name="trash" /></button></span>}
              </footer>
            </article>
          ))}
        </div>
      )}
      {editing && <AnnouncementForm a={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); d.reload(); }} />}
    </div>
  );
}
function AnnouncementForm({ a, onClose, onDone }) {
  const { t } = useLanguage();
  const typeName = useTypeName();
  const isNew = !a.id;
  const local = (v) => (v ? String(v).replace(" ", "T").slice(0, 16) : "");
  const [f, setF] = useState({ title: a.title || "", body: a.body || "", level: a.level || "info", audience: a.audience || "all", businessType: a.businessType || "", startsAt: local(a.startsAt), endsAt: local(a.endsAt), isActive: a.isActive !== false });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(isNew ? "/api/admin/announcements" : `/api/admin/announcements/${a.id}`, { method: isNew ? "POST" : "PUT", body: f }))) onDone(); };
  return (
    <Modal title={isNew ? t("ui.platform.newAnnouncement") : t("ui.common.edit")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.platform.annTitle")} error={sub.fieldErrors.title} full><input className="input" value={f.title} onChange={set("title")} maxLength={160} /></Field>
        <Field label={t("ui.platform.annBody")} error={sub.fieldErrors.body} full><textarea className="input" rows="4" value={f.body} onChange={set("body")} /></Field>
        <Field label={t("ui.platform.level")}><div className="seg">{["info", "warning", "success"].map((x) => <button key={x} type="button" aria-pressed={f.level === x} onClick={() => setF({ ...f, level: x })}>{t(`ui.platform.levels.${x}`)}</button>)}</div></Field>
        <Field label={t("ui.platform.audience")} error={sub.fieldErrors.businessType}>
          <select className="input" value={f.audience === "all" ? "" : f.businessType} onChange={(e) => setF({ ...f, audience: e.target.value ? "type" : "all", businessType: e.target.value })}>
            <option value="">{t("ui.platform.everyone")}</option>{TYPES.map((x) => <option key={x} value={x}>{typeName(x)}</option>)}
          </select>
        </Field>
        <Field label={`${t("ui.platform.starts")} ${t("ui.common.optional")}`} hint={t("ui.platform.startsHint")}><input className="input" type="datetime-local" value={f.startsAt} onChange={set("startsAt")} /></Field>
        <Field label={`${t("ui.platform.ends")} ${t("ui.common.optional")}`} error={sub.fieldErrors.endsAt}><input className="input" type="datetime-local" value={f.endsAt} onChange={set("endsAt")} /></Field>
        <label className="check-row ff--full"><input type="checkbox" checked={f.isActive} onChange={set("isActive")} /> {t("ui.platform.annOn")}</label>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

/* ===================== platform reports ===================== */
export function Reports() {
  const { t, lang } = useLanguage();
  const typeName = useTypeName();
  const [months, setMonths] = useState(12);
  const d = useApi(`/api/admin/reports?months=${months}`);
  if (!d.data) return <div className="page"><Loading /></div>;
  const r = d.data;
  const m = (v) => money(v, r.currency, lang);
  const sum = (s) => s.reduce((a, x) => a + x.value, 0);
  return (
    <div className="page adash">
      <div className="admin-head"><h1 className="admin-title">{t("ui.admin.menu.reports")}</h1>
        <div className="seg">{[3, 6, 12, 24].map((n) => <button key={n} type="button" aria-pressed={months === n} onClick={() => setMonths(n)}>{fill(t("ui.platform.monthsN"), { n })}</button>)}</div></div>
      <div className="adash-kpis">
        <div className="adash-kpi" style={{ "--c": "var(--blue)" }}><span className="adash-kpi__label">{t("ui.platform.rep.signups")}</span><strong className="adash-kpi__value">{sum(r.signups)}</strong></div>
        <div className="adash-kpi" style={{ "--c": "var(--orange)" }}><span className="adash-kpi__label">{t("ui.platform.rep.revenue")}</span><strong className="adash-kpi__value">{m(sum(r.revenue))}</strong></div>
        <div className="adash-kpi" style={{ "--c": "#1f9d61" }}><span className="adash-kpi__label">{t("ui.platform.rep.conversion")}</span><strong className="adash-kpi__value">{r.trials.rate === null ? "—" : `${r.trials.rate}%`}</strong>
          <small className="adash-kpi__sub">{fill(t("ui.platform.rep.convLine"), r.trials)}</small></div>
        <div className="adash-kpi" style={{ "--c": "#7c3aed" }}><span className="adash-kpi__label">{t("ui.platform.rep.active30")}</span><strong className="adash-kpi__value">{r.activity.active}</strong>
          <small className="adash-kpi__sub">{fill(t("ui.platform.rep.inactiveN"), { n: r.activity.inactive })}</small></div>
      </div>
      <div className="adash-grid2">
        <section className="adash-card"><h2>{t("ui.platform.rep.revenue")}</h2><AreaChart data={r.revenue} lang={lang} color="#ff8a4c" format={m} label={t("ui.platform.rep.revenue")} /></section>
        <section className="adash-card"><h2>{t("ui.platform.rep.signups")}</h2><BarChart data={r.signups} lang={lang} color="#2373f4" label={t("ui.platform.rep.signups")} /></section>
        <section className="adash-card"><h2>{t("ui.platform.rep.sales")}</h2><AreaChart data={r.sales} lang={lang} color="#1f9d61" label={t("ui.platform.rep.sales")} /></section>
        <section className="adash-card">
          <h2>{t("ui.platform.rep.activity")}</h2>
          <div className="adash-types">
            <Donut items={[{ label: t("ui.platform.rep.activeL"), value: r.activity.active }, { label: t("ui.platform.rep.inactiveL"), value: r.activity.inactive }]} center={r.activity.active + r.activity.inactive} sub={t("ui.platform.rep.activeBiz")} />
            <ul className="adash-legend">
              <li><span><span className="adash-legend__dot" style={{ background: paletteColor(0) }} />{t("ui.platform.rep.activeL")}<b>{r.activity.active}</b></span></li>
              <li><span><span className="adash-legend__dot" style={{ background: paletteColor(1) }} />{t("ui.platform.rep.inactiveL")}<b>{r.activity.inactive}</b></span></li>
            </ul>
          </div>
          <p className="muted">{t("ui.platform.rep.activityHelp")}</p>
        </section>
      </div>
      <div className="adash-grid2">
        <section className="adash-card">
          <h2>{t("ui.platform.rep.byType")}</h2>
          <table className="table table--compact"><thead><tr><th>{t("ui.admin.type")}</th><th className="num">{t("ui.admin.count")}</th><th className="num">{t("ui.admin.menu.active")}</th><th className="num">{t("ui.platform.rep.paying")}</th></tr></thead>
            <tbody>{r.types.map((x) => <tr key={x.type}><td><Link to={`/admin/businesses?type=${x.type}`}>{typeName(x.type)}</Link></td><td className="num">{x.count}</td><td className="num">{x.active}</td><td className="num">{x.paying}</td></tr>)}</tbody></table>
        </section>
        <section className="adash-card">
          <h2>{t("ui.platform.rep.plans")}</h2>
          <ul className="bar-list">
            {r.plans.map((p, i) => { const max = Math.max(1, ...r.plans.map((x) => x.count)); return <li key={p.name}><span>{p.name}</span><span className="bar-list__bar"><span style={{ width: `${(p.count / max) * 100}%`, background: paletteColor(i) }} /></span><b>{p.count}</b></li>; })}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ===================== security ===================== */
export function Security({ can }) {
  const { t, lang } = useLanguage();
  const d = useApi("/api/admin/security");
  const [ip, setIp] = useState({ ip: "", reason: "", days: "7" });
  const sub = useSubmit();
  const block = async (e, preset) => {
    e?.preventDefault();
    const body = preset || ip;
    if (await sub.run(() => apiRequest("/api/admin/blocked-ips", { method: "POST", body }))) { setIp({ ip: "", reason: "", days: "7" }); d.reload(); }
  };
  const unblock = async (x) => { await apiRequest(`/api/admin/blocked-ips/${x.id}`, { method: "DELETE" }); d.reload(); };
  if (!d.data) return <div className="page"><Loading /></div>;
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.security")}</h1>
      <p className="page-help"><Icon name="info" /> {fill(t("ui.platform.yourIp"), { ip: d.data.yourIp })}</p>
      <div className="adash-grid2">
        <section className="adash-card">
          <h2>{t("ui.platform.failedByIp")}</h2>
          {d.data.failedByIp.length === 0 ? <p className="adash-ok"><Icon name="check" /> {t("ui.platform.noFailed")}</p> : (
            <table className="table table--compact"><thead><tr><th>IP</th><th className="num">{t("ui.platform.tries")}</th><th>{t("ui.platform.last")}</th><th /></tr></thead>
              <tbody>{d.data.failedByIp.map((x) => (
                <tr key={x.ip} className={x.count >= 10 ? "is-danger" : ""}><td><code>{x.ip}</code>{x.adminTries > 0 && <small className="cell-sub is-neg">{fill(t("ui.platform.adminTries"), { n: x.adminTries })}</small>}</td>
                  <td className="num"><b>{x.count}</b></td><td>{date(x.last, lang, true)}</td>
                  <td>{x.blocked ? <span className="track-tag">{t("ui.platform.blocked")}</span> : can("security") && x.ip !== d.data.yourIp && <button type="button" className="btn btn--danger btn--sm" onClick={() => block(null, { ip: x.ip, reason: t("ui.platform.tooManyTries"), days: 7 })}>{t("ui.platform.block")}</button>}</td></tr>
              ))}</tbody></table>
          )}
        </section>
        <section className="adash-card">
          <h2>{t("ui.platform.blockedIps")}</h2>
          {can("security") && (
            <form onSubmit={block} className="block-form">
              <input className="input input--sm" value={ip.ip} onChange={(e) => setIp({ ...ip, ip: e.target.value })} placeholder="203.0.113.5" aria-label="IP" />
              <input className="input input--sm" value={ip.reason} onChange={(e) => setIp({ ...ip, reason: e.target.value })} placeholder={t("ui.common.reason")} />
              <select className="input input--sm" value={ip.days} onChange={(e) => setIp({ ...ip, days: e.target.value })}>{["1", "7", "30", ""].map((x) => <option key={x} value={x}>{x ? fill(t("ui.platform.forDays"), { n: x }) : t("ui.platform.forever")}</option>)}</select>
              <button type="submit" className="btn btn--danger btn--sm" disabled={sub.busy || !ip.ip}>{t("ui.platform.block")}</button>
            </form>
          )}
          {sub.fieldErrors.ip && <p className="form-status form-status--error">{t(`ui.errors.${sub.fieldErrors.ip}`)}</p>}
          {d.data.blocked.length === 0 ? <p className="muted">{t("ui.platform.noBlocked")}</p> : (
            <ul className="pay-list">{d.data.blocked.map((x) => (
              <li key={x.id} className={x.active ? "" : "is-muted"}><code>{x.ip}</code> · {x.reason || "—"} · {x.expiresAt ? fill(t("ui.platform.until"), { date: date(x.expiresAt, lang, true) }) : t("ui.platform.forever")}
                {can("security") && <button type="button" className="link-btn" onClick={() => unblock(x)}> {t("ui.platform.unblock")}</button>}</li>
            ))}</ul>
          )}
        </section>
      </div>
      <section className="adash-card">
        <h2>{t("ui.platform.recentFailed")}</h2>
        <div className="table-wrap"><table className="table table--compact"><thead><tr><th>{t("ui.audit.when")}</th><th>{t("ui.admin.username")}</th><th>{t("ui.admin.businessUser")}</th><th>IP</th></tr></thead>
          <tbody>{d.data.recentFailed.map((x, i) => <tr key={i}><td>{date(x.at, lang, true)}</td><td>{x.username || "—"}{x.admin && <span className="track-tag"> {t("ui.admin.title")}</span>}</td><td>{x.business || "—"}</td><td><code>{x.ip}</code></td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

/* ===================== super admins ===================== */
export function AdminsPage({ can }) {
  const { t, lang } = useLanguage();
  const d = useApi("/api/admin/admins");
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(null);
  const [error, setError] = useState(null);
  const change = async (a, patch) => { setError(null); try { await apiRequest(`/api/admin/admins/${a.id}`, { method: "PATCH", body: patch }); d.reload(); } catch (err) { setError(err?.data?.code || "failed"); } };
  const reset = async (a) => { if (!window.confirm(fill(t("ui.platform.resetConfirm"), { name: a.username }))) return; const r = await apiRequest(`/api/admin/admins/${a.id}/reset-password`, { method: "POST" }); setShown({ ...r, title: t("ui.platform.newPassword") }); };
  return (
    <div className="page">
      <div className="admin-head"><h1 className="admin-title">{t("ui.admin.menu.admins")}</h1>{can("admins") && <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /><span>{t("ui.platform.addAdmin")}</span></button>}</div>
      <div className="role-cards">{["owner", "admin", "support", "billing"].map((r) => <div key={r} className="role-card"><strong>{t(`ui.platform.roles.${r}`)}</strong><small>{t(`ui.platform.roleHelp.${r}`)}</small></div>)}</div>
      {error && <p className="form-status form-status--error">{t(`ui.errors.${error}`)}</p>}
      {!d.data ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.admin.username")}</th><th>{t("ui.admin.role")}</th><th>{t("ui.platform.twoStep")}</th><th>{t("ui.admin.lastLogin")}</th><th>{t("ui.common.status")}</th><th /></tr></thead>
          <tbody>{d.data.admins.map((a) => (
            <tr key={a.id}>
              <td><strong>{a.username}</strong>{a.me && <span className="track-tag"> {t("ui.admin.you")}</span>}<small className="cell-sub">{a.email || ""}</small></td>
              <td>{can("admins") && !a.me ? <select className="input input--sm" value={a.role} onChange={(e) => change(a, { role: e.target.value })}>{d.data.roles.map((r) => <option key={r} value={r}>{t(`ui.platform.roles.${r}`)}</option>)}</select> : t(`ui.platform.roles.${a.role}`)}</td>
              <td>{a.twoFactor ? <span className="badge-status badge-status--active">{t("ui.platform.on")}</span> : <span className="muted">{t("ui.platform.offShort")}</span>}</td>
              <td>{a.lastLoginAt ? date(a.lastLoginAt, lang, true) : t("ui.admin.never")}</td>
              <td><StatusBadge status={a.status === "active" ? "active" : "disabled"} /></td>
              <td className="row-actions">{can("admins") && !a.me && <>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => change(a, { status: a.status === "active" ? "disabled" : "active" })}>{t(a.status === "active" ? "ui.platform.disable" : "ui.platform.enable")}</button>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => reset(a)}>{t("ui.platform.resetPassword")}</button></>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {adding && <AddAdmin roles={d.data?.roles || []} onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setShown({ ...r, title: t("ui.platform.adminAdded") }); d.reload(); }} />}
      {shown && <ShownOnce title={shown.title} username={shown.username} password={shown.password} onClose={() => setShown(null)} />}
    </div>
  );
}
function AddAdmin({ roles, onClose, onDone }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ username: "", email: "", role: "support" });
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); const r = await sub.run(() => apiRequest("/api/admin/admins", { method: "POST", body: f })); if (r) onDone(r); };
  return (
    <Modal title={t("ui.platform.addAdmin")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.admin.username")} error={sub.fieldErrors.username} hint={t("ui.platform.usernameHint")}><input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></Field>
        <Field label={`${t("ui.admin.email")} ${t("ui.common.optional")}`} error={sub.fieldErrors.email}><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t("ui.admin.role")}><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{t(`ui.platform.roles.${r}`)}</option>)}</select></Field>
        <p className="muted">{t(`ui.platform.roleHelp.${f.role}`)}</p>
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.platform.addAdmin")}</button></div>
      </form>
    </Modal>
  );
}

/* ===================== system settings and export ===================== */
export function SettingsPage({ can }) {
  const { t } = useLanguage();
  const typeName = useTypeName();
  const d = useApi("/api/admin/settings");
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(false);
  const sub = useSubmit();
  useEffect(() => {
    if (!d.data) return;
    const s = d.data.settings;
    setF({ ...s, contact: { phones: (s.contact?.phones || []).join("\n"), emails: (s.contact?.emails || []).join("\n"), whatsapp: s.contact?.whatsapp || "", address: s.contact?.address || "" } });
  }, [d.data]);
  if (!f) return <div className="page"><Loading /></div>;
  const set = (k) => (e) => { setSaved(false); setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }); };
  const setC = (k) => (e) => { setSaved(false); setF({ ...f, contact: { ...f.contact, [k]: e.target.value } }); };
  const toggleType = (x) => { setSaved(false); setF({ ...f, disabledTypes: f.disabledTypes.includes(x) ? f.disabledTypes.filter((y) => y !== x) : [...f.disabledTypes, x] }); };
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/admin/settings", { method: "PUT", body: { ...f, trialDays: Number(f.trialDays), graceDays: Number(f.graceDays) } }))) { setSaved(true); d.reload(); } };
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.settings")}</h1>
      <form onSubmit={save} className="settings-sections">
        <section className="adash-card form-grid form-grid--2">
          <h2 className="ff--full"><Icon name="clock" /> {t("ui.platform.set.trialBilling")}</h2>
          <Field label={t("ui.platform.set.trialDays")} error={sub.fieldErrors.trialDays} hint={t("ui.platform.set.trialDaysHint")}><input className="input" type="number" min="0" max="365" value={f.trialDays} onChange={set("trialDays")} /></Field>
          <Field label={t("ui.platform.set.graceDays")} error={sub.fieldErrors.graceDays} hint={t("ui.platform.set.graceDaysHint")}><input className="input" type="number" min="0" max="90" value={f.graceDays} onChange={set("graceDays")} /></Field>
          <Field label={t("ui.platform.set.currency")}><select className="input" value={f.billingCurrency} onChange={set("billingCurrency")}>{["USD", "SOS", "EUR", "KES", "ETB", "AED"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <div className="ff ff--full">
            <label className="check-row"><input type="checkbox" checked={f.autoSuspend} onChange={set("autoSuspend")} /> {t("ui.platform.set.autoSuspend")}</label>
            <label className="check-row"><input type="checkbox" checked={f.suspendAfterTrial} onChange={set("suspendAfterTrial")} /> {t("ui.platform.set.suspendAfterTrial")}</label>
          </div>
        </section>
        <section className="adash-card form-grid form-grid--2">
          <h2 className="ff--full"><Icon name="phone" /> {t("ui.platform.set.contact")}</h2>
          <p className="muted ff--full">{t("ui.platform.set.contactHelp")}</p>
          <Field label={t("ui.platform.set.phones")} hint={t("ui.platform.set.onePerLine")}><textarea className="input" rows="2" value={f.contact.phones} onChange={setC("phones")} /></Field>
          <Field label={t("ui.platform.set.emails")} hint={t("ui.platform.set.onePerLine")}><textarea className="input" rows="2" value={f.contact.emails} onChange={setC("emails")} /></Field>
          <Field label="WhatsApp"><input className="input" value={f.contact.whatsapp} onChange={setC("whatsapp")} placeholder="+252…" /></Field>
          <Field label={t("ui.common.address")}><input className="input" value={f.contact.address} onChange={setC("address")} /></Field>
        </section>
        <section className="adash-card">
          <h2><Icon name="briefcase" /> {t("ui.platform.set.types")}</h2>
          <p className="muted">{t("ui.platform.set.typesHelp")}</p>
          <div className="type-toggles">{TYPES.map((x) => (
            <label key={x} className={"type-toggle" + (f.disabledTypes.includes(x) ? " is-off" : "")}><input type="checkbox" checked={!f.disabledTypes.includes(x)} onChange={() => toggleType(x)} /> {typeName(x)}</label>
          ))}</div>
        </section>
        <section className="adash-card form-grid form-grid--2">
          <h2 className="ff--full"><Icon name="hard-drive" /> {t("ui.tenancy.settings.backups")}</h2>
          <label className="check-row ff--full"><input type="checkbox" checked={Boolean(f.dailyBackups)} onChange={(e) => { setSaved(false); setF({ ...f, dailyBackups: e.target.checked }); }} /> {t("ui.tenancy.settings.daily")}</label>
          <Field label={t("ui.tenancy.settings.keep")}><input className="input" type="number" min="1" max="90" value={f.keepBackups ?? 14} onChange={(e) => { setSaved(false); setF({ ...f, keepBackups: e.target.value }); }} /></Field>
        </section>
        <FormError error={sub.formError} />
        {saved && <p className="form-status form-status--success" role="status"><Icon name="check" /> {t("ui.platform.saved")}</p>}
        {can("settings") && <div className="form-actions"><button type="submit" className="btn btn--navy btn--lg" disabled={sub.busy}>{t("ui.common.save")}</button></div>}
      </form>
    </div>
  );
}

export function ExportPage() {
  const { t } = useLanguage();
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.export")}</h1>
      <section className="adash-card export-card">
        <span className="export-card__icon"><Icon name="download" /></span>
        <div>
          <h2>{t("ui.platform.exportTitle")}</h2>
          <p>{t("ui.platform.exportHelp")}</p>
          <p className="form-status form-status--error"><Icon name="lock" /> {t("ui.platform.exportWarn")}</p>
          <a className="btn btn--navy" href="/api/admin/export" download><Icon name="download" /><span>{t("ui.platform.exportBtn")}</span></a>
        </div>
      </section>
    </div>
  );
}

/* ===================== my account: password and two-step sign-in ===================== */
export function AccountPage({ me, onChanged }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ current: "", next: "", repeat: "" });
  const [done, setDone] = useState(false);
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault(); setDone(false);
    if (f.next !== f.repeat) { sub.setFieldErrors({ repeat: "mismatch" }); return; }
    if (await sub.run(() => apiRequest("/api/admin/me/password", { method: "POST", body: { current: f.current, next: f.next } }))) { setDone(true); setF({ current: "", next: "", repeat: "" }); }
  };
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.account")}</h1>
      <div className="adash-grid2">
        <form onSubmit={save} className="adash-card form-grid">
          <h2><Icon name="lock" /> {t("ui.admin.menu.password")}</h2>
          <Field label={t("ui.admin.currentPassword")} error={sub.fieldErrors.current}><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
          <Field label={t("ui.admin.newPassword")} error={sub.fieldErrors.next} hint={t("ui.admin.passwordRules")}><input className="input" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
          <Field label={t("ui.admin.repeatPassword")} error={sub.fieldErrors.repeat}><input className="input" type="password" autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} /></Field>
          {sub.formError && sub.formError.code !== "validation" && <FormError error={sub.formError} />}
          {done && <p className="form-status form-status--success" role="status">{t("ui.admin.passwordSaved")}</p>}
          <div className="form-actions"><button type="submit" className="btn btn--navy" disabled={sub.busy || !f.current || !f.next}>{t("ui.common.save")}</button></div>
        </form>
        <TwoStep me={me} onChanged={onChanged} />
      </div>
    </div>
  );
}

function TwoStep({ me, onChanged }) {
  const { t } = useLanguage();
  const [setup, setSetup] = useState(null);   // { secret, url }
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const sub = useSubmit();
  const qr = useRef(null);
  useEffect(() => {
    if (!setup || !qr.current) return;
    qr.current.innerHTML = "";
    try { qr.current.appendChild(new BrowserQRCodeSvgWriter().write(setup.url, 200, 200)); } catch { /* the key below still works */ }
  }, [setup]);
  const start = async () => { const r = await sub.run(() => apiRequest("/api/admin/me/2fa/setup", { method: "POST" })); if (r) { setSetup(r); setCode(""); } };
  const enable = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/admin/me/2fa/enable", { method: "POST", body: { code } }))) { setSetup(null); onChanged(); } };
  const disable = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/admin/me/2fa/disable", { method: "POST", body: { password } }))) { setPassword(""); onChanged(); } };
  return (
    <section className="adash-card form-grid">
      <h2><Icon name="shield-check" /> {t("ui.platform.twoStep")} {me.twoFactor ? <span className="badge-status badge-status--active">{t("ui.platform.on")}</span> : <span className="track-tag">{t("ui.platform.offShort")}</span>}</h2>
      <p className="muted">{t("ui.platform.twoStepHelp")}</p>
      {me.twoFactor ? (
        <form onSubmit={disable} className="form-grid">
          <Field label={t("ui.platform.passwordToOff")} error={sub.fieldErrors.password}><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <div className="form-actions"><button type="submit" className="btn btn--outline" disabled={sub.busy || !password}>{t("ui.platform.turnOff")}</button></div>
        </form>
      ) : !setup ? (
        <div className="form-actions"><button type="button" className="btn btn--navy" onClick={start} disabled={sub.busy}><Icon name="shield-check" /><span>{t("ui.platform.turnOn")}</span></button></div>
      ) : (
        <form onSubmit={enable} className="form-grid two-step">
          <ol className="two-step__steps"><li>{t("ui.platform.step1")}</li><li>{t("ui.platform.step2")}</li><li>{t("ui.platform.step3")}</li></ol>
          <div className="two-step__qr" ref={qr} aria-label="QR" />
          <p className="two-step__key">{t("ui.platform.orKey")} <code>{setup.secret.match(/.{1,4}/g).join(" ")}</code></p>
          <Field label={t("ui.platform.code")} error={sub.fieldErrors.code}><input className="input input--big" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" /></Field>
          <div className="form-actions"><button type="button" className="btn btn--outline" onClick={() => setSetup(null)}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy || code.length !== 6}>{t("ui.platform.confirmOn")}</button></div>
        </form>
      )}
      {sub.formError && sub.formError.code !== "validation" && <FormError error={sub.formError} />}
    </section>
  );
}
