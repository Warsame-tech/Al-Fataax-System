import { useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, Modal, Field, FormError, EmptyState, Loading, StatusBadge } from "../ui.jsx";
import { fill, date, daysLeft } from "../format.js";

const TYPES = ["retail", "supermarket", "cosmetics", "fashion", "pharmacy", "electronics", "furniture", "hardware", "books", "bakery", "jewelry", "wholesale", "services", "other"];
const CURRENCIES = ["USD", "SOS", "KES", "ETB", "DJF", "EUR", "GBP", "AED"];

function Saved({ show }) {
  const { t } = useLanguage();
  return show ? <p className="form-status form-status--success" role="status">{t("ui.common.saved")}</p> : null;
}

/* ===================== Staff & roles ===================== */
export function Staff() {
  const { t, lang } = useLanguage();
  const list = useApi("/api/staff");
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const patch = async (u, body) => { try { await apiRequest(`/api/staff/${u.id}`, { method: "PATCH", body }); } finally { list.reload(); } };
  return (
    <div className="page">
      <PageHeader icon="user-key" title={t("ui.staff.title")} actions={<button type="button" className="btn btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /><span>{t("ui.staff.add")}</span></button>} />
      <p className="page-help">{t("ui.staff.help")}</p>
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.common.name")}</th><th>{t("ui.staff.username")}</th><th>{t("ui.common.role")}</th><th>{t("ui.common.status")}</th><th>{t("ui.staff.lastLogin")}</th><th /></tr></thead>
          <tbody>
            {(list.data?.users || []).map((u) => {
              const locked = u.isMe || u.role === "owner";
              return (
                <tr key={u.id}>
                  <td><strong>{u.fullName}</strong>{u.isMe && <small className="cell-sub">{t("ui.staff.you")}</small>}</td>
                  <td>{u.username}</td>
                  <td>{locked ? t(`app.roles.${u.role}`) : (
                    <select className="input input--auto" value={u.role} onChange={(e) => patch(u, { role: e.target.value })} aria-label={t("ui.common.role")}>
                      {["manager", "cashier", "stockkeeper"].map((r) => <option key={r} value={r}>{t(`app.roles.${r}`)}</option>)}
                    </select>
                  )}</td>
                  <td><StatusBadge status={u.status} /></td>
                  <td>{u.lastLoginAt ? date(u.lastLoginAt, lang, true) : t("ui.staff.never")}</td>
                  <td className="row-actions">
                    {!locked && <button type="button" className="btn btn--outline btn--sm" onClick={() => setResetting(u)}>{t("ui.staff.resetPassword")}</button>}
                    {!locked && <button type="button" className={"btn btn--sm " + (u.status === "active" ? "btn--danger" : "btn--primary")} onClick={() => patch(u, { status: u.status === "active" ? "disabled" : "active" })}>{t(u.status === "active" ? "ui.staff.disable" : "ui.staff.enable")}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      {adding && <StaffForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); }} />}
      {resetting && <ResetForm user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function StaffForm({ onClose, onSaved }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ fullName: "", username: "", phone: "", email: "", role: "cashier", password: "" });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/staff", { method: "POST", body: f }))) onSaved(); };
  return (
    <Modal title={t("ui.staff.add")} onClose={onClose}>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.staff.fullName")} error={sub.fieldErrors.fullName} full><input className="input" value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label={t("ui.staff.username")} error={sub.fieldErrors.username}><input className="input" autoCapitalize="none" value={f.username} onChange={set("username")} /></Field>
        <Field label={t("ui.staff.password")} error={sub.fieldErrors.password}><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>
        <Field label={`${t("ui.common.phone")} ${t("ui.common.optional")}`} error={sub.fieldErrors.phone}><input className="input" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={`${t("ui.common.email")} ${t("ui.common.optional")}`} error={sub.fieldErrors.email}><input className="input" value={f.email} onChange={set("email")} /></Field>
        <Field label={t("ui.common.role")} error={sub.fieldErrors.role} full>
          <div className="role-pick">
            {["manager", "cashier", "stockkeeper"].map((r) => (
              <button key={r} type="button" aria-pressed={f.role === r} onClick={() => setF({ ...f, role: r })}>
                <strong>{t(`app.roles.${r}`)}</strong><small>{t(`ui.staff.rolesHelp.${r}`)}</small>
              </button>
            ))}
          </div>
        </Field>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

function ResetForm({ user, onClose }) {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(`/api/staff/${user.id}`, { method: "PATCH", body: { password } }))) onClose(); };
  return (
    <Modal title={`${t("ui.staff.resetPassword")} · ${user.fullName}`} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.staff.newPassword")} error={sub.fieldErrors.password}><input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

/* ===================== Business info ===================== */
export function BusinessInfo() {
  const { t, lang } = useLanguage();
  const { refresh } = useAuth();
  const s = useApi("/api/settings");
  const [f, setF] = useState(null);
  const [logo, setLogo] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const sub = useSubmit();
  useEffect(() => { if (s.data) setF({ name: s.data.business.name, ownerName: s.data.business.ownerName, phone: s.data.business.phone, email: s.data.business.email || "", businessType: s.data.business.type, address: s.data.business.address || "" }); }, [s.data]);
  if (!s.data || !f) return <Loading />;
  const canEdit = s.data.canEdit;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const preview = logo ? URL.createObjectURL(logo) : !removeLogo && s.data.business.logoPath ? fileUrl(s.data.business.logoPath) : null;
  const save = async (e) => {
    e.preventDefault(); setSaved(false);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    if (logo) fd.append("logo", logo);
    if (removeLogo) fd.append("removeLogo", "true");
    if (await sub.run(() => apiRequest("/api/settings/business", { method: "PUT", body: fd }))) { setSaved(true); setLogo(null); setRemoveLogo(false); s.reload(); refresh(); }
  };
  return (
    <div className="page">
      <PageHeader icon="briefcase" title={t("ui.business.title")} />
      {!canEdit && <p className="page-help"><Icon name="lock" /> {t("ui.business.readonly")}</p>}
      <form onSubmit={save} className="panel-card form-grid form-grid--2">
        <div className="register__logo ff--full">
          <span className="logo-drop">{preview ? <img src={preview} alt="" /> : <Icon name="image" />}</span>
          {canEdit && (
            <div className="form-actions">
              <button type="button" className="btn btn--outline" onClick={() => fileRef.current?.click()}><Icon name="upload" /><span>{t("register.logoChoose")}</span></button>
              {preview && <button type="button" className="btn btn--outline" onClick={() => { setLogo(null); setRemoveLogo(true); }}>{t("ui.business.removeLogo")}</button>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { setLogo(e.target.files?.[0] || null); setRemoveLogo(false); }} />
              {sub.fieldErrors.logo && <span className="ff__error">{t(`ui.errors.${sub.fieldErrors.logo}`)}</span>}
            </div>
          )}
        </div>
        <fieldset disabled={!canEdit} className="form-grid form-grid--2 ff--full plain-fieldset">
          <Field label={t("register.businessName")} error={sub.fieldErrors.name}><input className="input" value={f.name} onChange={set("name")} /></Field>
          <Field label={t("ui.business.type")} error={sub.fieldErrors.businessType}>
            <select className="input" value={f.businessType} onChange={set("businessType")}>{TYPES.map((x) => <option key={x} value={x}>{t(`register.types.${x}`)}</option>)}</select>
          </Field>
          <Field label={t("ui.business.ownerName")} error={sub.fieldErrors.ownerName}><input className="input" value={f.ownerName} onChange={set("ownerName")} /></Field>
          <Field label={t("ui.common.phone")} error={sub.fieldErrors.phone}><input className="input" value={f.phone} onChange={set("phone")} /></Field>
          <Field label={t("ui.common.email")} error={sub.fieldErrors.email}><input className="input" value={f.email} onChange={set("email")} /></Field>
          <Field label={t("ui.common.address")}><input className="input" value={f.address} onChange={set("address")} /></Field>
        </fieldset>
        <p className="muted ff--full">{t("ui.business.created")}: {date(s.data.business.createdAt, lang)}</p>
        <FormError error={sub.formError} /><Saved show={saved} />
        {canEdit && <div className="form-actions ff--full"><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>}
      </form>
    </div>
  );
}

/* ===================== Settings ===================== */
export function Settings() {
  const { t } = useLanguage();
  const { refresh } = useAuth();
  const can = usePerm();
  const s = useApi("/api/settings");
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(false);
  const sub = useSubmit();
  useEffect(() => { if (s.data) setF({ ...s.data.settings, invoiceFooter: s.data.settings.invoiceFooter || "" }); }, [s.data]);
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); setSaved(false); if (await sub.run(() => apiRequest("/api/settings/preferences", { method: "PUT", body: f }))) { setSaved(true); refresh(); } };
  return (
    <div className="page">
      <PageHeader icon="settings" title={t("ui.settings.title")} />
      {!can("settings.edit") && <p className="page-help"><Icon name="lock" /> {t("ui.business.readonly")}</p>}
      <form onSubmit={save} className="panel-card">
        <fieldset disabled={!can("settings.edit")} className="form-grid form-grid--2 plain-fieldset">
          <Field label={t("ui.settings.currency")}><select className="input" value={f.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label={t("ui.settings.defaultLanguage")}><select className="input" value={f.defaultLanguage} onChange={set("defaultLanguage")}>{["en", "so"].map((l) => <option key={l} value={l}>{t(`ui.settings.languages.${l}`)}</option>)}</select></Field>
          <Field label={t("ui.settings.invoicePrefix")} error={sub.fieldErrors.invoicePrefix}><input className="input" value={f.invoicePrefix} onChange={set("invoicePrefix")} /></Field>
          <Field label={t("ui.settings.receiptPrefix")} error={sub.fieldErrors.receiptPrefix}><input className="input" value={f.receiptPrefix} onChange={set("receiptPrefix")} /></Field>
          <Field label={t("ui.settings.purchasePrefix")} error={sub.fieldErrors.purchasePrefix}><input className="input" value={f.purchasePrefix} onChange={set("purchasePrefix")} /></Field>
          <Field label={t("ui.settings.invoiceFooter")} full><input className="input" value={f.invoiceFooter} onChange={set("invoiceFooter")} /></Field>
        </fieldset>
        <FormError error={sub.formError} /><Saved show={saved} />
        {can("settings.edit") && <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>}
      </form>
    </div>
  );
}

/* ===================== My profile ===================== */
export function Profile() {
  const { t, lang } = useLanguage();
  const { refresh } = useAuth();
  const p = useApi("/api/profile");
  const [f, setF] = useState(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [saved, setSaved] = useState(null);
  const subA = useSubmit();
  const subB = useSubmit();
  useEffect(() => { if (p.data) setF({ fullName: p.data.profile.fullName, email: p.data.profile.email || "", phone: p.data.profile.phone || "" }); }, [p.data]);
  if (!f) return <Loading />;
  const saveA = async (e) => { e.preventDefault(); setSaved(null); if (await subA.run(() => apiRequest("/api/profile", { method: "PUT", body: f }))) { setSaved("a"); refresh(); } };
  const saveB = async (e) => {
    e.preventDefault(); setSaved(null);
    if (pw.newPassword !== pw.confirm) { subB.setFieldErrors({ confirm: "mismatch" }); return; }
    if (await subB.run(() => apiRequest("/api/profile/password", { method: "PUT", body: pw }))) { setSaved("b"); setPw({ currentPassword: "", newPassword: "", confirm: "" }); }
  };
  return (
    <div className="page">
      <PageHeader icon="user" title={t("ui.profile.title")} />
      <div className="split-view">
        <form onSubmit={saveA} className="panel-card form-grid">
          <h2 className="panel-card__title">{t("ui.profile.details")}</h2>
          <p className="muted">{t("ui.profile.username")}: <strong>{p.data.profile.username}</strong> · {t(`app.roles.${p.data.profile.role}`)}</p>
          <p className="muted">{t("ui.profile.lastLogin")}: {date(p.data.profile.lastLoginAt, lang, true)}</p>
          <Field label={t("ui.staff.fullName")} error={subA.fieldErrors.fullName}><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
          <Field label={t("ui.common.email")} error={subA.fieldErrors.email}><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={t("ui.common.phone")} error={subA.fieldErrors.phone}><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <FormError error={subA.formError} /><Saved show={saved === "a"} />
          <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={subA.busy}>{t("ui.common.save")}</button></div>
        </form>
        <form onSubmit={saveB} className="panel-card form-grid">
          <h2 className="panel-card__title">{t("ui.profile.password")}</h2>
          <Field label={t("ui.profile.currentPassword")} error={subB.fieldErrors.currentPassword}><input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label={t("ui.profile.newPassword")} error={subB.fieldErrors.newPassword} hint={t("register.passwordHint")}><input className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <Field label={t("ui.profile.confirmPassword")} error={subB.fieldErrors.confirm}><input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <FormError error={subB.formError} /><Saved show={saved === "b"} />
          <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={subB.busy}>{t("ui.profile.change")}</button></div>
        </form>
      </div>
    </div>
  );
}

/* ===================== Subscription ===================== */
export function Subscription() {
  const { t, lang } = useLanguage();
  const { trial } = useAuth();
  const left = daysLeft(trial?.end_date);
  return (
    <div className="page">
      <PageHeader icon="credit-card" title={t("ui.subscription.title")} />
      <section className="panel-card sub-card">
        <span className="sub-card__icon"><Icon name="clock" /></span>
        <div>
          <h2>{t("ui.subscription.trial")}</h2>
          {trial ? (
            <dl className="sub-card__facts">
              <div><dt>{t("ui.subscription.status")}</dt><dd><StatusBadge status={left !== null && left < 0 ? "expired" : trial.status} /></dd></div>
              <div><dt>{t("ui.subscription.started")}</dt><dd>{date(trial.start_date, lang)}</dd></div>
              <div><dt>{t("ui.subscription.ends")}</dt><dd>{date(trial.end_date, lang)}</dd></div>
              {left !== null && left >= 0 && <div><dt /><dd><strong>{fill(t("ui.subscription.daysLeft"), { days: left })}</strong></dd></div>}
            </dl>
          ) : <p>—</p>}
          <p className="sub-card__plan">{t("ui.subscription.plan")}</p>
          <p className="muted">{t("ui.subscription.note")}</p>
        </div>
      </section>
    </div>
  );
}

/* ===================== Activity log ===================== */
export function Audit() {
  const { t, lang } = useLanguage();
  const list = useApi("/api/audit");
  const logs = list.data?.logs || [];
  return (
    <div className="page">
      <PageHeader icon="activity" title={t("ui.audit.title")} />
      {list.loading && !list.data ? <Loading /> : logs.length === 0 ? <EmptyState icon="activity" text={t("ui.audit.empty")} /> : (
        <div className="table-wrap"><table className="table table--compact">
          <thead><tr><th>{t("ui.audit.when")}</th><th>{t("ui.common.user")}</th><th>{t("ui.audit.action")}</th><th>{t("ui.audit.details")}</th></tr></thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={i}>
                <td>{date(l.at, lang, true)}</td>
                <td>{l.user || "—"}</td>
                <td><code className="action-code">{l.action}</code></td>
                <td className="muted">{l.meta ? Object.entries(l.meta).map(([k, v]) => `${k}: ${v}`).join(" · ") : l.entity ? `${l.entity} #${l.entityId}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
