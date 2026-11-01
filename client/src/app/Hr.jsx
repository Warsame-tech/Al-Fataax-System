import { useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, EmptyState, Loading, DateRange, PaymentFields, daysAgo, isoDate } from "./ui.jsx";
import { date, fill } from "./format.js";

/*
 * Employees & payroll (routes/hr.js): attendance (clock in / out, manager entries and corrections), work shifts,
 * employees and pay, payroll runs (paid as a Salaries expense) and performance. ClockCard: an employee's own clock in / out.
 */
const toLocal = (iso) => { if (!iso) return ""; const s = String(iso); const d = new Date(s.includes("T") || s.endsWith("Z") ? s : `${s.replace(" ", "T")}Z`); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const hours = (min) => (min === null || min === undefined ? "—" : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`);

/** Dashboard card: clock in / out for staff who are employees. */
export function ClockCard() {
  const { t, lang } = useLanguage();
  const me = useApi("/api/hr/me");
  const [busy, setBusy] = useState(false);
  if (!me.data?.employee) return null;
  const open = me.data.open;
  const clock = async (action) => { setBusy(true); try { await apiRequest("/api/hr/clock", { method: "POST", body: { action } }); await me.reload(); } finally { setBusy(false); } };
  return (
    <div className="clock-card">
      <Icon name="clock" />
      <div><strong>{open ? fill(t("ui.hr.inSince"), { at: date(open.clockIn, lang, true) }) : t("ui.hr.notIn")}</strong>
        {me.data.shifts.length > 0 && <small>{fill(t("ui.hr.todayShift"), { from: String(me.data.shifts[0].start).slice(0, 5), to: String(me.data.shifts[0].end).slice(0, 5) })}</small>}</div>
      <button type="button" className={"btn " + (open ? "btn--outline" : "btn--primary")} disabled={busy} onClick={() => clock(open ? "out" : "in")}>{t(open ? "ui.hr.clockOut" : "ui.hr.clockIn")}</button>
    </div>
  );
}

export function HrPage() {
  const { t } = useLanguage();
  const can = usePerm();
  const tabs = [
    ...(can("hr.view") ? [{ id: "attendance", label: t("ui.hr.attendance"), icon: "clock" }, { id: "schedule", label: t("ui.hr.schedule"), icon: "calendar" }, { id: "performance", label: t("ui.hr.performance"), icon: "chart-line" }] : []),
    ...(can("hr.view") ? [{ id: "employees", label: t("ui.hr.employees"), icon: "users" }] : []),
    ...(can("hr.payroll") ? [{ id: "payroll", label: t("ui.hr.payroll"), icon: "wallet" }] : [])
  ];
  const [tab, setTab] = useState(tabs[0]?.id || "attendance");
  return (
    <div className="page">
      <PageHeader icon="users" title={t("app.modules.hr")} />
      <ClockCard />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "attendance" ? <Attendance /> : tab === "schedule" ? <Schedule /> : tab === "performance" ? <Performance /> : tab === "employees" ? <Employees /> : <Payroll />}
    </div>
  );
}

function useEmployees() { return useApi("/api/hr/employees"); }

function Attendance() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const [range, setRange] = useState({ from: daysAgo(6), to: isoDate(new Date()) });
  const [emp, setEmp] = useState("");
  const emps = useEmployees();
  const list = useApi(`/api/hr/attendance?${new URLSearchParams({ ...range, employeeId: emp })}`);
  const [editing, setEditing] = useState(null);
  const rows = list.data?.attendance || [];
  const total = rows.reduce((s, a) => s + (a.minutes || 0), 0);
  return (
    <>
      <div className="toolbar">
        <DateRange value={range} onChange={setRange} />
        <select className="input input--auto" value={emp} onChange={(e) => setEmp(e.target.value)} aria-label={t("ui.hr.employee")}>
          <option value="">{t("ui.hr.allEmployees")}</option>{(emps.data?.employees || []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {can("hr.manage") && <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.hr.addEntry")}</span></button>}
      </div>
      <p className="muted">{fill(t("ui.hr.totalHours"), { h: hours(total) })}</p>
      {list.loading && !list.data ? <Loading /> : !rows.length ? <EmptyState icon="clock" text={t("ui.hr.noAttendance")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.hr.employee")}</th><th>{t("ui.hr.in")}</th><th>{t("ui.hr.out")}</th><th className="num">{t("ui.hr.worked")}</th><th>{t("ui.common.notes")}</th><th /></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}>
              <td><strong>{a.employee}</strong></td><td>{date(a.clockIn, lang, true)}</td><td>{a.clockOut ? date(a.clockOut, lang, true) : <span className="hr-open">{t("ui.hr.stillIn")}</span>}</td>
              <td className="num">{hours(a.minutes)}</td>
              <td>{a.note}{a.source === "manager" && <small className="cell-sub">{fill(t("ui.hr.enteredBy"), { name: a.by })}</small>}{a.editedBy && <small className="cell-sub">{fill(t("ui.hr.correctedBy"), { name: a.editedBy })}</small>}</td>
              <td>{can("hr.manage") && <button type="button" className="link-btn" onClick={() => setEditing(a)}>{t("ui.common.edit")}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <AttendanceForm entry={editing} employees={emps.data?.employees || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function AttendanceForm({ entry, employees, onClose, onSaved }) {
  const { t } = useLanguage();
  const isNew = !entry.id;
  const [f, setF] = useState({ employeeId: entry.employeeId ? String(entry.employeeId) : "", clockIn: toLocal(entry.clockIn), clockOut: toLocal(entry.clockOut), note: "" });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, clockIn: f.clockIn ? new Date(f.clockIn).toISOString() : "", clockOut: f.clockOut ? new Date(f.clockOut).toISOString() : "" };
    if (await sub.run(() => apiRequest(isNew ? "/api/hr/attendance" : `/api/hr/attendance/${entry.id}`, { method: isNew ? "POST" : "PUT", body }))) onSaved();
  };
  const err = sub.fieldErrors;
  return (
    <Modal title={t(isNew ? "ui.hr.addEntry" : "ui.hr.correctEntry")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        {isNew ? <Field label={t("ui.hr.employee")} error={err.employeeId}><select className="input" value={f.employeeId} onChange={set("employeeId")}><option value="">{t("ui.common.choose")}</option>{employees.filter((e) => e.isActive).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
          : <p><strong>{entry.employee}</strong></p>}
        <Field label={t("ui.hr.in")} error={err.clockIn}><input className="input" type="datetime-local" value={f.clockIn} onChange={set("clockIn")} /></Field>
        <Field label={`${t("ui.hr.out")} ${t("ui.common.optional")}`} error={err.clockOut}><input className="input" type="datetime-local" value={f.clockOut} onChange={set("clockOut")} /></Field>
        <Field label={t("ui.hr.why")} error={err.note}><input className="input" value={f.note} onChange={set("note")} placeholder={t("ui.hr.whyPh")} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

/* a week of shifts: employees × days */
function Schedule() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d); });
  const days = Array.from({ length: 7 }, (_, i) => isoDate(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000)));
  const emps = useEmployees();
  const list = useApi(`/api/hr/shifts?from=${days[0]}&to=${days[6]}`);
  const [adding, setAdding] = useState(null);
  const shifts = list.data?.shifts || [];
  const move = (n) => setStart(isoDate(new Date(Date.parse(`${start}T00:00:00Z`) + n * 7 * 86400000)));
  const remove = async (s) => { await apiRequest(`/api/hr/shifts/${s.id}`, { method: "DELETE" }); list.reload(); };
  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => move(-1)} aria-label="−"><Icon name="chevron-left" /></button>
        <strong>{date(days[0], lang)} – {date(days[6], lang)}</strong>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => move(1)} aria-label="+"><Icon name="chevron-right" /></button>
      </div>
      {!emps.data ? <Loading /> : !emps.data.employees.length ? <EmptyState icon="users" text={t("ui.hr.noEmployees")} /> : (
        <div className="table-wrap"><table className="table table--compact schedule">
          <thead><tr><th>{t("ui.hr.employee")}</th>{days.map((d) => <th key={d}>{date(d, lang).replace(/, \d{4}$/, "")}</th>)}</tr></thead>
          <tbody>{emps.data.employees.filter((e) => e.isActive).map((e) => (
            <tr key={e.id}><td><strong>{e.name}</strong><small className="cell-sub">{e.position}</small></td>
              {days.map((d) => {
                const mine = shifts.filter((s) => s.employeeId === e.id && String(s.date).slice(0, 10) === d);
                return (
                  <td key={d}>
                    {mine.map((s) => <span key={s.id} className="shift-chip">{s.start}–{s.end}{can("hr.manage") && <button type="button" onClick={() => remove(s)} aria-label={t("ui.common.remove")}>×</button>}</span>)}
                    {can("hr.manage") && <button type="button" className="shift-add" onClick={() => setAdding({ employeeId: e.id, date: d })} aria-label={t("ui.hr.addShift")}>+</button>}
                  </td>
                );
              })}</tr>
          ))}</tbody>
        </table></div>
      )}
      {adding && <ShiftForm init={adding} days={days} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); list.reload(); }} />}
    </>
  );
}

function ShiftForm({ init, days, onClose, onSaved }) {
  const { t, lang } = useLanguage();
  const [f, setF] = useState({ start: "08:00", end: "16:00", note: "", dates: [init.date] });
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/hr/shifts", { method: "POST", body: { employeeId: init.employeeId, ...f } }))) onSaved(); };
  return (
    <Modal title={t("ui.hr.addShift")} onClose={onClose}>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.hr.start")} error={sub.fieldErrors.start}><input className="input" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label={t("ui.hr.end")} error={sub.fieldErrors.end} hint={t("ui.hr.overnight")}><input className="input" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <div className="ff ff--full"><span className="ff__label">{t("ui.hr.days")}</span>
          <div className="chip-pick">{days.map((d) => <button key={d} type="button" aria-pressed={f.dates.includes(d)} onClick={() => setF({ ...f, dates: f.dates.includes(d) ? f.dates.filter((x) => x !== d) : [...f.dates, d] })}>{date(d, lang).replace(/, \d{4}$/, "")}</button>)}</div></div>
        <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`} full><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy || !f.dates.length}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

function Performance() {
  const { t } = useLanguage();
  const m = useMoney();
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const d = useApi(`/api/hr/performance?${new URLSearchParams(range)}`);
  return (
    <>
      <div className="toolbar"><DateRange value={range} onChange={setRange} /></div>
      {!d.data ? <Loading /> : !d.data.employees.length ? <EmptyState icon="users" text={t("ui.hr.noEmployees")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.hr.employee")}</th><th className="num">{t("ui.hr.scheduled")}</th><th className="num">{t("ui.hr.worked")}</th><th className="num">{t("ui.hr.daysWorked")}</th>
            <th className="num">{t("ui.hr.late")}</th><th className="num">{t("ui.hr.absent")}</th><th className="num">{t("ui.hr.salesCol")}</th><th className="num">{t("ui.hr.ordersCol")}</th></tr></thead>
          <tbody>{d.data.employees.map((e) => (
            <tr key={e.employeeId}><td><strong>{e.name}</strong><small className="cell-sub">{e.position}</small></td>
              <td className="num">{e.scheduledHours}</td><td className="num">{e.workedHours}</td><td className="num">{e.daysWorked}</td>
              <td className={"num" + (e.late ? " is-neg" : "")}>{e.late}</td><td className={"num" + (e.absent ? " is-neg" : "")}>{e.absent}</td>
              <td className="num">{e.sales ? `${e.sales} · ${m(e.salesTotal)}` : "—"}</td><td className="num">{e.orders || "—"}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted">{t("ui.hr.performanceHelp")}</p>
    </>
  );
}

function Employees() {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const d = useEmployees();
  const [editing, setEditing] = useState(null);
  return (
    <>
      {can("hr.manage") && <div className="toolbar"><button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.hr.addEmployee")}</span></button></div>}
      {!d.data ? <Loading /> : !d.data.employees.length ? <EmptyState icon="users" text={t("ui.hr.noEmployees")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.common.name")}</th><th>{t("ui.hr.position")}</th><th>{t("ui.hr.pay")}</th><th>{t("ui.hr.login")}</th><th>{t("ui.common.status")}</th></tr></thead>
          <tbody>{d.data.employees.map((e) => (
            <tr key={e.id} className={can("hr.manage") ? "is-clickable" : ""} onClick={() => can("hr.manage") && setEditing(e)}>
              <td><strong>{e.name}</strong>{e.phone && <small className="cell-sub">{e.phone}</small>}</td><td>{e.position || "—"}</td>
              <td>{m(e.payRate)} {t(`ui.hr.per.${e.payType}`)}</td><td>{e.username || "—"}</td><td>{t(e.isActive ? "ui.products.statusValues.active" : "ui.products.statusValues.archived")}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <EmployeeForm emp={editing} logins={d.data?.logins || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); d.reload(); }} />}
    </>
  );
}

function EmployeeForm({ emp, logins, onClose, onSaved }) {
  const { t } = useLanguage();
  const isNew = !emp.id;
  const [f, setF] = useState({ name: emp.name || "", phone: emp.phone || "", position: emp.position || "", payType: emp.payType || "monthly", payRate: emp.payRate ?? "", hiredOn: emp.hiredOn ? String(emp.hiredOn).slice(0, 10) : "",
    userId: emp.userId ? String(emp.userId) : "", notes: emp.notes || "", isActive: emp.isActive ?? true });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(isNew ? "/api/hr/employees" : `/api/hr/employees/${emp.id}`, { method: isNew ? "POST" : "PUT", body: { ...f, userId: f.userId || null } }))) onSaved(); };
  const err = sub.fieldErrors;
  return (
    <Modal title={t(isNew ? "ui.hr.addEmployee" : "ui.hr.editEmployee")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.name")} error={err.name}><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label={`${t("ui.common.phone")} ${t("ui.common.optional")}`}><input className="input" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={`${t("ui.hr.position")} ${t("ui.common.optional")}`}><input className="input" value={f.position} onChange={set("position")} placeholder={t("ui.hr.positionPh")} /></Field>
        <Field label={`${t("ui.hr.hiredOn")} ${t("ui.common.optional")}`}><input className="input" type="date" value={f.hiredOn} onChange={set("hiredOn")} /></Field>
        <Field label={t("ui.hr.payType")} error={err.payType}><select className="input" value={f.payType} onChange={set("payType")}>{["monthly", "daily", "hourly"].map((x) => <option key={x} value={x}>{t(`ui.hr.payTypes.${x}`)}</option>)}</select></Field>
        <Field label={t("ui.hr.payRate")} error={err.payRate}><input className="input" type="number" min="0" step="any" value={f.payRate} onChange={set("payRate")} /></Field>
        <Field label={`${t("ui.hr.login")} ${t("ui.common.optional")}`} error={err.userId} hint={t("ui.hr.loginHint")}>
          <select className="input" value={f.userId} onChange={set("userId")}><option value="">—</option>{logins.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select>
        </Field>
        <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={set("notes")} /></Field>
        {!isNew && <div className="ff"><label className="checkbox"><input type="checkbox" checked={f.isActive} onChange={set("isActive")} /><span>{t("ui.hr.stillWorks")}</span></label></div>}
        <FormError error={sub.formError} />
        <div className="form-actions ff--full sheet-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

function Payroll() {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const list = useApi("/api/hr/payroll");
  const [f, setF] = useState(() => { const d = new Date(); return { from: isoDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1))), to: isoDate(new Date()) }; });
  const [open, setOpen] = useState(null);
  const sub = useSubmit();
  const make = async () => { const r = await sub.run(() => apiRequest("/api/hr/payroll", { method: "POST", body: f })); if (r) { list.reload(); setOpen(r.id); } };
  return (
    <>
      <div className="toolbar">
        <DateRange value={f} onChange={setF} />
        <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={make}><Icon name="plus" /><span>{t("ui.hr.newPayroll")}</span></button>
      </div>
      <p className="muted">{t("ui.hr.payrollHelp")}</p>
      <FormError error={sub.formError} />
      {!list.data ? <Loading /> : !list.data.runs.length ? <EmptyState icon="wallet" text={t("ui.hr.noPayroll")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.hr.period")}</th><th className="num">{t("ui.common.total")}</th><th>{t("ui.common.status")}</th><th>{t("ui.common.user")}</th></tr></thead>
          <tbody>{list.data.runs.map((r) => (
            <tr key={r.id} className="is-clickable" onClick={() => setOpen(r.id)}>
              <td><strong>{date(r.from, lang)} – {date(r.to, lang)}</strong></td><td className="num">{m(r.total)}</td>
              <td><span className={`shift-status ${r.status === "paid" ? "is-approved" : "is-closed"}`}>{t(`ui.hr.runStatus.${r.status}`)}</span>{r.paidAt && <small className="cell-sub">{date(r.paidAt, lang)}</small>}</td><td>{r.user}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {open && <PayrollRun id={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function PayrollRun({ id, onClose }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const d = useApi(`/api/hr/payroll/${id}`);
  const [edits, setEdits] = useState({});
  const [pay, setPay] = useState({ method: "cash", bankAccountId: "" });
  const sub = useSubmit();
  const run = d.data?.run;
  const draft = run?.status === "draft";
  const saveLine = async (l) => {
    const e = edits[l.id];
    if (!e) return;
    if (await sub.run(() => apiRequest(`/api/hr/payroll/${id}/lines/${l.id}`, { method: "PUT", body: e }))) { setEdits((x) => { const n = { ...x }; delete n[l.id]; return n; }); d.reload(); }
  };
  const payNow = async () => { if (await sub.run(() => apiRequest(`/api/hr/payroll/${id}/pay`, { method: "POST", body: pay }))) d.reload(); };
  const discard = async () => { if (await sub.run(() => apiRequest(`/api/hr/payroll/${id}`, { method: "DELETE" }))) onClose(); };
  const val = (l, k) => edits[l.id]?.[k] ?? (k === "note" ? l.note : String(l[k] || ""));
  const set = (l, k, v) => setEdits((x) => ({ ...x, [l.id]: { additions: val(l, "additions"), deductions: val(l, "deductions"), note: val(l, "note"), ...x[l.id], [k]: v } }));
  return (
    <Modal title={run ? `${t("ui.hr.payroll")} · ${date(run.from, lang)} – ${date(run.to, lang)}` : t("ui.common.loading")} onClose={onClose} wide>
      {!run ? <Loading /> : (
        <div className="form-grid">
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>{t("ui.hr.employee")}</th><th>{t("ui.hr.basis")}</th><th className="num">{t("ui.hr.base")}</th><th className="num">{t("ui.hr.additions")}</th><th className="num">{t("ui.hr.deductions")}</th><th>{t("ui.common.notes")}</th><th className="num">{t("ui.hr.net")}</th></tr></thead>
            <tbody>{d.data.lines.map((l) => (
              <tr key={l.id}><td><strong>{l.name}</strong><small className="cell-sub">{l.position}</small></td>
                <td>{l.payType === "monthly" ? fill(t("ui.hr.basisMonthly"), { rate: m(l.rate) }) : l.payType === "daily" ? fill(t("ui.hr.basisDaily"), { n: l.days, rate: m(l.rate) }) : fill(t("ui.hr.basisHourly"), { n: l.hours, rate: m(l.rate) })}</td>
                <td className="num">{m(l.base)}</td>
                {draft ? <>
                  <td className="num"><input className="input input--sm" type="number" min="0" step="any" value={val(l, "additions")} onChange={(e) => set(l, "additions", e.target.value)} onBlur={() => saveLine(l)} /></td>
                  <td className="num"><input className="input input--sm" type="number" min="0" step="any" value={val(l, "deductions")} onChange={(e) => set(l, "deductions", e.target.value)} onBlur={() => saveLine(l)} /></td>
                  <td><input className="input input--sm" value={val(l, "note")} onChange={(e) => set(l, "note", e.target.value)} onBlur={() => saveLine(l)} placeholder={t("ui.hr.notePh")} /></td>
                </> : <><td className="num">{m(l.additions)}</td><td className="num">{m(l.deductions)}</td><td>{l.note}</td></>}
                <td className="num"><strong>{m(l.net)}</strong></td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan="6" className="num"><strong>{t("ui.common.total")}</strong></td><td className="num"><strong>{m(run.total)}</strong></td></tr></tfoot>
          </table></div>
          <FormError error={sub.formError} />
          {draft ? (
            <section className="panel-card form-grid">
              <h3 className="panel-card__title"><Icon name="wallet" />{fill(t("ui.hr.payTotal"), { amount: m(run.total) })}</h3>
              <PaymentFields method={pay.method} onMethod={(v) => setPay({ ...pay, method: v })} bankId={pay.bankAccountId} onBank={(v) => setPay({ ...pay, bankAccountId: v })} errors={sub.fieldErrors} />
              <small className="ff__hint">{t("ui.hr.payHint")}</small>
              <div className="form-actions"><button type="button" className="btn btn--outline" disabled={sub.busy} onClick={discard}>{t("ui.hr.discard")}</button><button type="button" className="btn btn--primary" disabled={sub.busy || Object.keys(edits).length > 0} onClick={payNow}>{t("ui.hr.payNow")}</button></div>
            </section>
          ) : <p className="form-status form-status--success">{fill(t("ui.hr.paidOn"), { at: date(run.paidAt, lang, true), method: t(`ui.methods.${run.method}`) })}</p>}
        </div>
      )}
    </Modal>
  );
}
