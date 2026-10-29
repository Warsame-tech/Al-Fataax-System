import { useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, Modal, Field, FormError, EmptyState, Loading, StatusBadge } from "../ui.jsx";
import { fill, date, daysLeft } from "../format.js";

/* Business categories (same list as sign-up); a business registered under an older type keeps it in the list */
const TYPES = ["supermarket", "cosmetics", "fashion", "pharmacy", "electronics", "jewelry", "fabric"];
const CURRENCIES = ["USD", "SOS", "KES", "ETB", "DJF", "EUR", "GBP", "AED"];

function Saved({ show }) {
  const { t } = useLanguage();
  return show ? <p className="form-status form-status--success" role="status">{t("ui.common.saved")}</p> : null;
}

/* ===================== Staff & roles ===================== */
/*
 * Owner only. Three tabs:
 *   Staff          — register staff and give each one a role.
 *   Roles          — create roles first (name, description, what they can do, grouped by module).
 *   Module access  — one grid of modules × roles to switch whole modules on or off per role.
 * Staff, business info and settings stay with the owner and can't be given to a role.
 */
export function Staff() {
  const { t } = useLanguage();
  const [tab, setTab] = useState("staff");
  const rolesApi = useApi("/api/roles");
  return (
    <div className="page">
      <PageHeader icon="user-key" title={t("ui.staff.title")} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "staff", label: t("ui.staff.tabStaff"), icon: "users" },
        { id: "roles", label: t("ui.staff.tabRoles"), icon: "user-key" },
        { id: "access", label: t("ui.staff.tabAccess"), icon: "grid" }
      ]} />
      {tab === "staff" && <StaffList rolesApi={rolesApi} onManageRoles={() => setTab("roles")} />}
      {tab === "roles" && <RolesList rolesApi={rolesApi} />}
      {tab === "access" && <ModuleAccess rolesApi={rolesApi} />}
    </div>
  );
}

/* ---------- Staff tab ---------- */
function StaffList({ rolesApi, onManageRoles }) {
  const { t, lang } = useLanguage();
  const list = useApi("/api/staff");
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const roles = rolesApi.data?.roles || [];
  const patch = async (u, body) => { try { await apiRequest(`/api/staff/${u.id}`, { method: "PATCH", body }); } finally { list.reload(); rolesApi.reload(); } };
  return (
    <>
      <div className="staff-bar">
        <p className="page-help">{t("ui.staff.help2")}</p>
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /><span>{t("ui.staff.add")}</span></button>
      </div>
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap table-wrap--stack"><table className="table table--stack">
          <thead><tr><th>{t("ui.common.name")}</th><th>{t("ui.staff.username")}</th><th>{t("ui.common.role")}</th><th>{t("ui.common.status")}</th><th>{t("ui.staff.lastLogin")}</th><th /></tr></thead>
          <tbody>
            {(list.data?.users || []).map((u) => {
              const locked = u.isMe || u.role === "owner";
              return (
                <tr key={u.id}>
                  <td data-label={t("ui.common.name")}><strong>{u.fullName}</strong>{u.isMe && <small className="cell-sub">{t("ui.staff.you")}</small>}</td>
                  <td data-label={t("ui.staff.username")}>{u.username}</td>
                  <td data-label={t("ui.common.role")}>{locked ? (u.roleName || t(`app.roles.${u.role}`)) : (
                    <select className="input input--auto" value={u.roleId || ""} onChange={(e) => patch(u, { roleId: e.target.value })} aria-label={t("ui.common.role")}>
                      {!u.roleId && <option value="">{t("ui.common.choose")}</option>}
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}</td>
                  <td data-label={t("ui.common.status")}><StatusBadge status={u.status} /></td>
                  <td data-label={t("ui.staff.lastLogin")}>{u.lastLoginAt ? date(u.lastLoginAt, lang, true) : t("ui.staff.never")}</td>
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
      {adding && <StaffForm roles={roles} groups={rolesApi.data?.catalog?.groups || []} onManageRoles={() => { setAdding(false); onManageRoles(); }} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); rolesApi.reload(); }} />}
      {resetting && <ResetForm user={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}

/* Permission keys contain dots ("sales.create"), so they are looked up in the ui.perms object directly. */
const permLabel = (t, key) => { const all = t("ui.perms"); return (all && typeof all === "object" && all[key]) || key; };

/* Modules a role can open, for short summaries ("POS, Invoices, Customers"). */
function roleModules(role, groups, t) {
  return groups.filter((g) => role.permissions.includes(g.perms[0])).map((g) => t(`app.modules.${g.module}`));
}

function StaffForm({ roles, groups, onManageRoles, onClose, onSaved }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ fullName: "", username: "", phone: "", email: "", roleId: roles[0]?.id || "", password: "" });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/staff", { method: "POST", body: f }))) onSaved(); };
  return (
    <Modal title={t("ui.staff.add")} onClose={onClose}>
      <form onSubmit={save} className="form-grid form-grid--2 sheet-form">
        <Field label={t("ui.staff.fullName")} error={sub.fieldErrors.fullName} full><input className="input" value={f.fullName} onChange={set("fullName")} autoComplete="off" /></Field>
        <Field label={t("ui.staff.username")} error={sub.fieldErrors.username}><input className="input" autoCapitalize="none" autoComplete="off" value={f.username} onChange={set("username")} /></Field>
        <Field label={t("ui.staff.password")} error={sub.fieldErrors.password} hint={t("register.passwordHint")}><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>
        <Field label={`${t("ui.common.phone")} ${t("ui.common.optional")}`} error={sub.fieldErrors.phone}><input className="input" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={`${t("ui.common.email")} ${t("ui.common.optional")}`} error={sub.fieldErrors.email}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <div className="ff ff--full">
          <span className="ff__label">{t("ui.common.role")}</span>
          {roles.length === 0 ? (
            <p className="page-help">{t("ui.staff.noRoles")} <button type="button" className="link-btn" onClick={onManageRoles}>{t("ui.staff.manageRoles")}</button></p>
          ) : (
            <div className="role-pick">
              {roles.map((r) => {
                const mods = roleModules(r, groups, t);
                return (
                  <button key={r.id} type="button" aria-pressed={String(f.roleId) === String(r.id)} onClick={() => setF({ ...f, roleId: r.id })}>
                    <strong>{r.name}</strong>
                    <small>{r.description || (mods.length ? mods.join(", ") : t("ui.staff.noModules"))}</small>
                  </button>
                );
              })}
            </div>
          )}
          {sub.fieldErrors.roleId && <span className="ff__error">{t("ui.errors.required")}</span>}
          {roles.length > 0 && <button type="button" className="link-btn staff-roles-link" onClick={onManageRoles}>{t("ui.staff.manageRoles")}</button>}
        </div>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Roles tab ---------- */
function RolesList({ rolesApi }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(null);   // role or {} for a new one
  const [notice, setNotice] = useState(null);
  const roles = rolesApi.data?.roles || [];
  const groups = rolesApi.data?.catalog?.groups || [];
  const remove = async (r) => {
    if (!window.confirm(fill(t("ui.staff.deleteRoleConfirm"), { name: r.name }))) return;
    setNotice(null);
    try { await apiRequest(`/api/roles/${r.id}`, { method: "DELETE" }); rolesApi.reload(); }
    catch (err) { setNotice(err.code === "roleInUse" ? fill(t("ui.staff.roleInUse"), { n: err.data?.count || "" }) : t("ui.errors.failed")); }
  };
  return (
    <>
      <div className="staff-bar">
        <p className="page-help">{t("ui.staff.rolesHelp2")}</p>
        <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.staff.newRole")}</span></button>
      </div>
      {notice && <p className="form-status form-status--error" role="alert">{notice}</p>}
      {rolesApi.loading && !rolesApi.data ? <Loading /> : (
        <div className="role-cards">
          <article className="role-card role-card--owner">
            <div className="role-card__head"><strong>{t("app.roles.owner")}</strong><span className="role-card__count"><Icon name="lock" />{t("ui.staff.fullAccess")}</span></div>
            <p className="muted">{t("ui.staff.ownerHelp")}</p>
          </article>
          {roles.map((r) => {
            const mods = roleModules(r, groups, t);
            return (
              <article key={r.id} className="role-card">
                <div className="role-card__head">
                  <strong>{r.name}</strong>
                  <span className="role-card__count"><Icon name="users" />{fill(t("ui.staff.staffCount"), { n: r.staffCount })}</span>
                </div>
                {r.description && <p className="muted">{r.description}</p>}
                <div className="role-card__mods">
                  {mods.length ? mods.map((m) => <span key={m} className="chip-mod">{m}</span>) : <span className="muted">{t("ui.staff.noModules")}</span>}
                </div>
                <small className="muted">{fill(t("ui.staff.permCount"), { n: r.permissions.length })}</small>
                <div className="role-card__actions">
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(r)}>{t("ui.common.edit")}</button>
                  <button type="button" className="btn btn--danger btn--sm" disabled={r.staffCount > 0} title={r.staffCount > 0 ? t("ui.staff.roleInUseShort") : undefined} onClick={() => remove(r)}>{t("ui.common.delete")}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing && <RoleForm role={editing} groups={groups} roles={roles} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); rolesApi.reload(); }} />}
    </>
  );
}

function RoleForm({ role, groups, roles, onClose, onSaved }) {
  const { t } = useLanguage();
  const isNew = !role.id;
  const [f, setF] = useState({ name: role.name || "", description: role.description || "" });
  const [perms, setPerms] = useState(new Set(role.permissions || []));
  const sub = useSubmit();
  const toggle = (p, on) => setPerms((s) => { const n = new Set(s); if (on) n.add(p); else n.delete(p); return n; });
  const setModule = (g, on) => setPerms((s) => { const n = new Set(s); g.perms.forEach((p) => (on ? n.add(p) : n.delete(p))); return n; });
  const openModule = (g, on) => setPerms((s) => { const n = new Set(s); if (on) n.add(g.perms[0]); else g.perms.forEach((p) => n.delete(p)); return n; });
  const copyFrom = (id) => { const src = roles.find((r) => String(r.id) === String(id)); if (src) setPerms(new Set(src.permissions)); };
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, permissions: [...perms] };
    if (await sub.run(() => apiRequest(isNew ? "/api/roles" : `/api/roles/${role.id}`, { method: isNew ? "POST" : "PUT", body }))) onSaved();
  };
  return (
    <Modal title={t(isNew ? "ui.staff.newRole" : "ui.staff.editRole")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid sheet-form">
        <div className="form-grid form-grid--2">
          <Field label={t("ui.staff.roleName")} error={sub.fieldErrors.name === "required" ? "required" : undefined}>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("ui.staff.roleNamePh")} autoFocus={isNew} />
          </Field>
          <Field label={`${t("ui.common.description")} ${t("ui.common.optional")}`}>
            <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t("ui.staff.roleDescPh")} />
          </Field>
        </div>
        {sub.fieldErrors.name === "roleNameTaken" && <p className="form-status form-status--error">{t("ui.staff.roleNameTaken")}</p>}
        <div className="perm-tools">
          <strong>{t("ui.staff.whatCanDo")}</strong>
          <div className="perm-tools__btns">
            {isNew && roles.length > 0 && (
              <select className="input input--auto" defaultValue="" onChange={(e) => copyFrom(e.target.value)} aria-label={t("ui.staff.copyFrom")}>
                <option value="">{t("ui.staff.copyFrom")}</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPerms(new Set(groups.flatMap((g) => g.perms)))}>{t("ui.staff.selectAll")}</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPerms(new Set())}>{t("ui.staff.clearAll")}</button>
          </div>
        </div>
        <div className="perm-groups">
          {groups.map((g) => {
            const open = perms.has(g.perms[0]);
            return (
              <fieldset key={g.module} className={"perm-group" + (open ? " is-open" : "")}>
                <legend className="perm-group__head">
                  <label className="perm-switch">
                    <input type="checkbox" checked={open} onChange={(e) => openModule(g, e.target.checked)} />
                    <span className="perm-switch__ui" aria-hidden="true" />
                    <strong>{t(`app.modules.${g.module}`)}</strong>
                  </label>
                  {g.perms.length > 1 && <button type="button" className="link-btn" onClick={() => setModule(g, !g.perms.every((p) => perms.has(p)))}>{g.perms.every((p) => perms.has(p)) ? t("ui.staff.none") : t("ui.staff.all")}</button>}
                </legend>
                <ul className="perm-list">
                  {g.perms.map((p, i) => (
                    <li key={p}>
                      <label className="checkbox">
                        <input type="checkbox" checked={perms.has(p)} disabled={i > 0 && !open && p !== "sales.view"}
                          onChange={(e) => (i === 0 ? openModule(g, e.target.checked) : toggle(p, e.target.checked))} />
                        <span>{permLabel(t, p)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}
          <fieldset className="perm-group perm-group--locked">
            <legend className="perm-group__head"><strong><Icon name="lock" />{t("ui.staff.ownerOnlyTitle")}</strong></legend>
            <p className="muted">{t("ui.staff.ownerOnlyHelp")}</p>
          </fieldset>
        </div>
        <FormError error={sub.fieldErrors.name === "roleNameTaken" ? null : sub.formError} />
        <div className="form-actions sheet-actions">
          <span className="muted perm-count">{fill(t("ui.staff.permCount"), { n: perms.size })}</span>
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t(sub.busy ? "ui.common.saving" : "ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Module access tab: modules × roles grid ---------- */
function ModuleAccess({ rolesApi }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const roles = rolesApi.data?.roles || [];
  const groups = rolesApi.data?.catalog?.groups || [];
  const flip = async (role, g, on) => {
    const set = new Set(role.permissions);
    if (on) set.add(g.perms[0]); else g.perms.forEach((p) => set.delete(p));
    setBusy(`${role.id}-${g.module}`); setError(null);
    try {
      await apiRequest(`/api/roles/${role.id}`, { method: "PUT", body: { name: role.name, description: role.description, permissions: [...set] } });
      rolesApi.reload();
    } catch { setError(t("ui.errors.failed")); } finally { setBusy(null); }
  };
  if (rolesApi.loading && !rolesApi.data) return <Loading />;
  return (
    <>
      <p className="page-help">{t("ui.staff.accessHelp")}</p>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      <div className="table-wrap access-wrap">
        <table className="table access-table">
          <thead>
            <tr>
              <th>{t("ui.staff.module")}</th>
              <th className="access-table__role">{t("app.roles.owner")}</th>
              {roles.map((r) => <th key={r.id} className="access-table__role">{r.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.module}>
                <th scope="row">{t(`app.modules.${g.module}`)}<small className="cell-sub">{permLabel(t, g.perms[0])}</small></th>
                <td className="access-table__cell"><Icon name="check" className="access-yes" /></td>
                {roles.map((r) => {
                  const on = r.permissions.includes(g.perms[0]);
                  return (
                    <td key={r.id} className="access-table__cell">
                      <button type="button" className={"pm-switch" + (on ? " is-on" : "")} role="switch" aria-checked={on}
                        aria-label={`${r.name} · ${t(`app.modules.${g.module}`)}`} disabled={busy === `${r.id}-${g.module}`} onClick={() => flip(r, g, !on)}>
                        <span />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {["staff", "business", "settings"].map((m) => (
              <tr key={m} className="is-muted">
                <th scope="row">{t(`app.modules.${m}`)}<small className="cell-sub">{t("ui.staff.ownerOnlyShort")}</small></th>
                <td className="access-table__cell"><Icon name="check" className="access-yes" /></td>
                {roles.map((r) => <td key={r.id} className="access-table__cell"><Icon name="lock" className="access-lock" /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">{t("ui.staff.accessDetail")}</p>
    </>
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
            <select className="input input--type" value={f.businessType} onChange={set("businessType")}>{(TYPES.includes(f.businessType) || !f.businessType ? TYPES : [f.businessType, ...TYPES]).map((x) => <option key={x} value={x}>{t(`register.types.${x}`)}</option>)}</select>
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
      {can("settings.edit") && <PaymentMethods />}
    </div>
  );
}

/*
 * Payment methods shown on the POS payment screen (e.g. "E-Dahab (136227)", "Salaam Bank").
 * The owner adds, renames, re-orders and switches them on / off. Each new method gets its
 * own money account, so its balance appears separately in Cash & bank.
 */
const PM_KINDS = ["cash", "mobile_money", "bank"];
const PM_ICON = { cash: "wallet", mobile_money: "smartphone", bank: "landmark" };

function PaymentMethods() {
  const { t } = useLanguage();
  const list = useApi("/api/payment-methods?all=1");
  const [editing, setEditing] = useState(null);   // method or {} for a new one
  const [busyId, setBusyId] = useState(null);
  const methods = list.data?.methods || [];

  const move = async (m, dir) => {
    setBusyId(m.id);
    try { await apiRequest(`/api/payment-methods/${m.id}/move`, { method: "PATCH", body: { dir } }); list.reload(); } finally { setBusyId(null); }
  };
  const toggle = async (m) => {
    setBusyId(m.id);
    try { await apiRequest(`/api/payment-methods/${m.id}`, { method: "PUT", body: { name: m.name, number: m.number || "", isActive: !m.isActive } }); list.reload(); } finally { setBusyId(null); }
  };

  return (
    <section className="panel-card pm-panel">
      <div className="pm-panel__head">
        <div>
          <h2 className="panel-card__title"><Icon name="credit-card" />{t("ui.payMethods.title")}</h2>
          <p className="muted">{t("ui.payMethods.help")}</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.payMethods.add")}</span></button>
      </div>
      {list.loading && !list.data ? <Loading /> : (
        <ul className="pm-list">
          {methods.map((m, i) => (
            <li key={m.id} className={m.isActive ? "" : "is-off"}>
              <span className={`pm-list__icon pm-list__icon--${m.kind}`}><Icon name={PM_ICON[m.kind]} /></span>
              <div className="pm-list__text">
                <strong>{m.label}</strong>
                <small>{t(`ui.payMethods.kinds.${m.kind}`)}{!m.isActive && ` · ${t("ui.payMethods.off")}`}</small>
              </div>
              <div className="pm-list__actions">
                <button type="button" className="icon-btn" disabled={i === 0 || busyId === m.id} onClick={() => move(m, "up")} aria-label={t("ui.payMethods.up")}><Icon name="chevron-up" /></button>
                <button type="button" className="icon-btn" disabled={i === methods.length - 1 || busyId === m.id} onClick={() => move(m, "down")} aria-label={t("ui.payMethods.down")}><Icon name="chevron-down" /></button>
                <button type="button" className={"pm-switch" + (m.isActive ? " is-on" : "")} role="switch" aria-checked={m.isActive} disabled={busyId === m.id} onClick={() => toggle(m)}>
                  <span />{m.isActive ? t("ui.payMethods.on") : t("ui.payMethods.off")}
                </button>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(m)}>{t("ui.common.edit")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <PaymentMethodForm method={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </section>
  );
}

function PaymentMethodForm({ method, onClose, onSaved }) {
  const { t } = useLanguage();
  const isNew = !method.id;
  const [f, setF] = useState({ name: method.name || "", number: method.number || "", kind: method.kind || "mobile_money", isActive: method.isActive ?? true });
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    const ok = await sub.run(() => apiRequest(isNew ? "/api/payment-methods" : `/api/payment-methods/${method.id}`, { method: isNew ? "POST" : "PUT", body: f }));
    if (ok) onSaved();
  };
  const preview = f.number.trim() ? `${f.name || "…"} (${f.number.trim()})` : (f.name || "…");
  return (
    <Modal title={t(isNew ? "ui.payMethods.add" : "ui.payMethods.edit")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.payMethods.name")} error={sub.fieldErrors.name}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="E-Dahab" autoFocus /></Field>
        <Field label={t("ui.payMethods.number")} hint={t("ui.payMethods.numberHint")}><input className="input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder="136227" /></Field>
        <Field label={t("ui.payMethods.kind")} error={sub.fieldErrors.kind} hint={isNew ? t("ui.payMethods.kindHint") : t("ui.payMethods.kindLocked")}>
          <div className="seg">
            {PM_KINDS.map((k) => <button key={k} type="button" disabled={!isNew} aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{t(`ui.payMethods.kinds.${k}`)}</button>)}
          </div>
        </Field>
        <label className="checkbox"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>{t("ui.payMethods.showOnPos")}</span></label>
        <p className="pm-preview"><small>{t("ui.payMethods.preview")}</small><strong>{preview}</strong></p>
        <FormError error={sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t(sub.busy ? "ui.common.saving" : "ui.common.save")}</button>
        </div>
      </form>
    </Modal>
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
          <p className="muted">{t("ui.profile.username")}: <strong>{p.data.profile.username}</strong> · {p.data.profile.roleName || t(`app.roles.${p.data.profile.role}`)}</p>
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
