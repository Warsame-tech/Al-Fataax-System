import { useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, Loading, DateRange, daysAgo, isoDate } from "./ui.jsx";
import { fill } from "./format.js";

/*
 * Branches (routes/branches.js): each branch sells from its own stock location and keeps its own sales, orders,
 * expenses and shifts. Compare the branches (with the consolidated total), add / edit branches, and choose which
 * branch each staff member works in (staff tied to a branch only see that branch).
 */
export function BranchesPage() {
  const { t } = useLanguage();
  const can = usePerm();
  const { branches } = useAuth();
  const tabs = [
    !branches?.fixed && (can("reports.view") || can("dashboard.finance")) && { id: "compare", icon: "file-chart", label: t("ui.branches.compare") },
    { id: "list", icon: "store", label: t("ui.branches.list") },
    can("staff.manage") && { id: "staff", icon: "users", label: t("ui.branches.staff") }
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0].id);
  return (
    <div className="page">
      <PageHeader icon="store" title={t("app.modules.branches")} />
      <p className="page-help"><Icon name="info" /> {t("ui.branches.help")}</p>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "compare" && <Compare />}
      {tab === "list" && <BranchList />}
      {tab === "staff" && <BranchStaff />}
    </div>
  );
}

function Compare() {
  const { t } = useLanguage();
  const m = useMoney();
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const sum = useApi(`/api/branches/summary?${new URLSearchParams(range)}`);
  const d = sum.data;
  const cols = ["sales", "revenue", "cogs", "grossProfit", "expenses", "otherIncome", "netProfit"];
  const cell = (k, v) => (k === "sales" ? v : m(v));
  return (
    <>
      <div className="toolbar"><DateRange value={range} onChange={setRange} /></div>
      {!d ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.branches.branch")}</th>{cols.map((k) => <th key={k} className="num">{t(`ui.branches.cols.${k}`)}</th>)}</tr></thead>
          <tbody>
            {d.branches.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.name}</strong>{b.isMain && <small className="cell-sub">{t("ui.branches.main")}</small>}</td>
                {cols.map((k) => <td key={k} className={"num" + (k === "netProfit" && b[k] < 0 ? " is-neg" : "")}>{cell(k, b[k])}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th>{t("ui.branches.consolidated")}</th>{cols.map((k) => <th key={k} className="num">{cell(k, d.total[k])}</th>)}</tr></tfoot>
        </table></div>
      )}
    </>
  );
}

function BranchList() {
  const { t } = useLanguage();
  const can = usePerm();
  const { refresh } = useAuth();
  const list = useApi("/api/branches");
  const [editing, setEditing] = useState(null);
  const rows = list.data?.branches || [];
  return (
    <>
      {can("settings.edit") && <div className="toolbar"><button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.branches.add")}</span></button></div>}
      {!list.data ? <Loading /> : (
        <div className="role-cards">
          {rows.map((b) => (
            <article key={b.id} className={"role-card" + (b.isActive ? "" : " is-off")}>
              <div className="role-card__head"><strong>{b.name}</strong>{b.isMain && <span className="role-card__count">{t("ui.branches.main")}</span>}</div>
              {(b.address || b.phone) && <p className="muted">{[b.address, b.phone].filter(Boolean).join(" · ")}</p>}
              <div className="role-card__mods">
                {b.sellLocation && <span className="chip-mod"><Icon name="layers" /> {b.sellLocation}</span>}
                {!b.isActive && <span className="chip-mod chip-mod--off">{t("ui.payMethods.off")}</span>}
              </div>
              <small className="muted">{fill(t("ui.branches.counts"), { staff: b.staff, locations: b.locations })}</small>
              {can("settings.edit") && <div className="role-card__actions"><button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(b)}>{t("ui.common.edit")}</button></div>}
            </article>
          ))}
        </div>
      )}
      {editing && <BranchForm branch={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); refresh(); }} />}
    </>
  );
}

function BranchForm({ branch, onClose, onSaved }) {
  const { t } = useLanguage();
  const locations = useApi("/api/stock/locations");
  const isNew = !branch.id;
  const [f, setF] = useState({ name: branch.name || "", address: branch.address || "", phone: branch.phone || "", sellLocationId: branch.sellLocationId || "", isActive: branch.isActive !== false });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, sellLocationId: f.sellLocationId || null };
    if (await sub.run(() => apiRequest(isNew ? "/api/branches" : `/api/branches/${branch.id}`, { method: isNew ? "POST" : "PUT", body }))) onSaved();
  };
  return (
    <Modal title={isNew ? t("ui.branches.add") : branch.name} onClose={onClose}>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.name")} error={sub.fieldErrors.name} full><input className="input" value={f.name} onChange={set("name")} maxLength={100} placeholder={t("ui.branches.namePh")} /></Field>
        <Field label={`${t("ui.common.address")} ${t("ui.common.optional")}`}><input className="input" value={f.address} onChange={set("address")} maxLength={200} /></Field>
        <Field label={`${t("ui.common.phone")} ${t("ui.common.optional")}`}><input className="input" value={f.phone} onChange={set("phone")} maxLength={30} /></Field>
        <Field label={t("ui.branches.sellLocation")} hint={isNew ? t("ui.branches.sellLocationNew") : t("ui.branches.sellLocationHint")} full>
          <select className="input" value={f.sellLocationId} onChange={set("sellLocationId")}>
            <option value="">{isNew ? t("ui.branches.newLocation") : t("ui.branches.keepLocation")}</option>
            {(locations.data?.locations || []).filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.name}{l.branch ? ` · ${l.branch}` : ""}</option>)}
          </select>
        </Field>
        {!isNew && !branch.isMain && (
          <label className="checkbox ff--full"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>{t("ui.branches.active")}</span></label>
        )}
        <FormError error={sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function BranchStaff() {
  const { t } = useLanguage();
  const staff = useApi("/api/branches/staff");
  const list = useApi("/api/branches");
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(null);
  const branches = (list.data?.branches || []).filter((b) => b.isActive);
  const assign = async (u, branchId) => {
    setErr(null); setSaved(null);
    try { await apiRequest(`/api/branches/staff/${u.id}`, { method: "PUT", body: { branchId: branchId || null } }); setSaved(u.id); staff.reload(); }
    catch (e) { setErr(e); }
  };
  return (
    <>
      <p className="muted">{t("ui.branches.staffHelp")}</p>
      <FormError error={err} />
      {!staff.data || !list.data ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.common.name")}</th><th>{t("ui.common.role")}</th><th>{t("ui.branches.worksIn")}</th></tr></thead>
          <tbody>{staff.data.staff.map((u) => (
            <tr key={u.id}>
              <td><strong>{u.name}</strong><small className="cell-sub">{u.username}</small></td>
              <td>{u.role === "owner" ? t("app.roles.owner") : u.role}</td>
              <td>
                {u.role === "owner" ? <span className="muted">{t("ui.branches.allBranches")}</span> : (
                  <select className="input input--auto" value={u.branchId || ""} onChange={(e) => assign(u, e.target.value)} aria-label={t("ui.branches.worksIn")}>
                    <option value="">{t("ui.branches.allBranches")}</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}
                {saved === u.id && <small className="cell-sub">{t("ui.common.saved")}</small>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

/** Header picker: which branch the screens show (all branches = consolidated). Hidden for staff tied to a branch. */
export function BranchSwitch() {
  const { t } = useLanguage();
  const { branches } = useAuth();
  if (!branches || branches.fixed || branches.list.filter((b) => b.isActive !== false).length < 2) return null;
  const change = (e) => {
    try { if (e.target.value) localStorage.setItem("faatix.branch", e.target.value); else localStorage.removeItem("faatix.branch"); } catch { /* storage blocked */ }
    window.location.reload();   // every screen reloads its data for the chosen branch
  };
  return (
    <label className="branch-switch" title={t("ui.branches.switch")}>
      <Icon name="store" />
      <select value={branches.current || ""} onChange={change} aria-label={t("ui.branches.switch")}>
        <option value="">{t("ui.branches.allBranches")}</option>
        {branches.list.filter((b) => b.isActive !== false).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}
