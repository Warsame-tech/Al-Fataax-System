import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, EmptyState, Loading, DateRange, daysAgo, isoDate } from "./ui.jsx";
import { date, fill } from "./format.js";

/*
 * Cashier shifts (routes/shifts.js): open with the drawer cash, see what the shift took in and paid out, count the
 * drawer at closing (shortage / overage with an explanation), manager review. Mobile money and bank are reconciled apart.
 */
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;

/** On the POS: a reminder when sales need an open shift and there is none. */
export function ShiftBanner() {
  const { t } = useLanguage();
  const cur = useApi("/api/shifts/current");
  if (!cur.data?.requireShift || cur.data.shift) return null;
  return <p className="form-status form-status--error shift-banner"><Icon name="lock" /> {t("ui.shifts.needShift")} <Link to="/app/m/shifts">{t("ui.shifts.openShift")}</Link></p>;
}

export function ShiftsPage() {
  const { t } = useLanguage();
  const can = usePerm();
  const cur = useApi("/api/shifts/current");
  const [range, setRange] = useState({ from: daysAgo(13), to: isoDate(new Date()) });
  const [status, setStatus] = useState("");
  const list = useApi(`/api/shifts?${new URLSearchParams({ ...range, status })}`);
  const [open, setOpen] = useState(null);
  const reload = () => { cur.reload(); list.reload(); };
  const toggleRequire = async (on) => { await apiRequest("/api/shifts/settings", { method: "PUT", body: { requireShift: on } }); cur.reload(); };
  return (
    <div className="page">
      <PageHeader icon="wallet" title={t("app.modules.shifts")} />
      <p className="page-help"><Icon name="info" /> {t("ui.shifts.help")}</p>
      {can("settings.edit") && cur.data && (
        <label className="checkbox shift-require"><input type="checkbox" checked={cur.data.requireShift} onChange={(e) => toggleRequire(e.target.checked)} /><span>{t("ui.shifts.require")}</span></label>
      )}
      {!cur.data ? <Loading /> : cur.data.shift ? <MyShift shift={cur.data.shift} onDone={reload} /> : <OpenShift onDone={reload} />}
      <h2 className="list-title">{t(can("cash.view") ? "ui.shifts.allShifts" : "ui.shifts.myShifts")}</h2>
      <div className="toolbar">
        <DateRange value={range} onChange={setRange} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("ui.common.status")}>
          <option value="">{t("ui.common.all")}</option>
          {["open", "closed", "approved"].map((s) => <option key={s} value={s}>{t(`ui.shifts.status.${s}`)}</option>)}
        </select>
      </div>
      <ShiftList data={list.data} loading={list.loading} onOpen={setOpen} />
      {open && <ShiftDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function OpenShift({ onDone }) {
  const { t } = useLanguage();
  const [cash, setCash] = useState("");
  const [note, setNote] = useState("");
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/shifts/open", { method: "POST", body: { openingCash: cash, note } }))) onDone(); };
  return (
    <form onSubmit={save} className="panel-card form-grid form-grid--2 shift-card">
      <h2 className="panel-card__title ff--full"><Icon name="wallet" />{t("ui.shifts.openShift")}</h2>
      <Field label={t("ui.shifts.openingCash")} error={sub.fieldErrors.openingCash} hint={t("ui.shifts.openingHint")}><input className="input" type="number" min="0" step="any" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" /></Field>
      <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <FormError error={sub.formError} />
      <div className="form-actions ff--full"><button type="submit" className="btn btn--primary" disabled={sub.busy || cash === ""}>{t("ui.shifts.openShift")}</button></div>
    </form>
  );
}

/** The open shift: what it has taken so far, and closing with the counted drawer. */
function MyShift({ shift, onDone }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const [counted, setCounted] = useState("");
  const [why, setWhy] = useState("");
  const [result, setResult] = useState(null);
  const sub = useSubmit();
  const s = shift.totals;
  const diff = counted === "" ? null : r4(Number(counted) - s.expectedCash);
  const close = async (e) => {
    e.preventDefault();
    const r = await sub.run(() => apiRequest(`/api/shifts/${shift.id}/close`, { method: "POST", body: { countedCash: counted, explanation: why } }));
    if (r) { setResult(r); onDone(); }
  };
  return (
    <section className="panel-card form-grid shift-card">
      <h2 className="panel-card__title"><Icon name="clock" />{fill(t("ui.shifts.openSince"), { at: date(shift.openedAt, lang, true) })}</h2>
      <Totals shift={shift} />
      <form onSubmit={close} className="form-grid form-grid--2">
        <Field label={t("ui.shifts.countedCash")} error={sub.fieldErrors.countedCash} hint={t("ui.shifts.countHint")}><input className="input" type="number" min="0" step="any" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={m(s.expectedCash)} /></Field>
        <div className={"shift-diff " + (diff === null ? "" : diff < 0 ? "is-neg" : diff > 0 ? "is-pos" : "is-ok")}>
          {diff === null ? null : diff === 0 ? t("ui.shifts.balanced") : fill(t(diff < 0 ? "ui.shifts.shortage" : "ui.shifts.overage"), { amount: m(Math.abs(diff)) })}
        </div>
        {diff !== null && diff !== 0 && <Field label={t("ui.shifts.explanation")} error={sub.fieldErrors.explanation} full><textarea className="input" rows="2" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("ui.shifts.explanationPh")} /></Field>}
        <FormError error={sub.formError} />
        {result && <p className="form-status form-status--success ff--full">{t("ui.shifts.closedOk")}</p>}
        <div className="form-actions ff--full"><button type="submit" className="btn btn--primary" disabled={sub.busy || counted === ""}>{t("ui.shifts.closeShift")}</button></div>
      </form>
    </section>
  );
}

function Totals({ shift }) {
  const { t } = useLanguage();
  const m = useMoney();
  const s = shift.totals;
  if (!s) return null;
  return (
    <>
      <dl className="adj-preview shift-totals">
        <div><dt>{t("ui.shifts.openingCash")}</dt><dd>{m(shift.openingCash)}</dd></div>
        <div><dt>{t("ui.shifts.cashIn")}</dt><dd className="is-pos">+{m(s.cashIn)}</dd></div>
        <div><dt>{t("ui.shifts.cashOut")}</dt><dd className="is-neg">−{m(s.cashOut)}</dd></div>
        <div className="is-total"><dt>{t("ui.shifts.expected")}</dt><dd>{m(shift.expectedCash ?? s.expectedCash)}</dd></div>
      </dl>
      <dl className="adj-preview">
        <div><dt>{t("ui.shifts.sales")}</dt><dd>{fill(t("ui.shifts.salesN"), { n: s.sales.count })} · {m(s.sales.total)}</dd></div>
        <div><dt>{t("ui.shifts.mobile")}</dt><dd>{m(s.mobileIn)}{s.mobileOut ? ` / −${m(s.mobileOut)}` : ""}</dd></div>
        <div><dt>{t("ui.shifts.bank")}</dt><dd>{m(s.bankIn)}{s.bankOut ? ` / −${m(s.bankOut)}` : ""}</dd></div>
      </dl>
      <small className="muted">{t("ui.shifts.reconcileApart")}</small>
    </>
  );
}

function ShiftList({ data, loading, onOpen }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  if (loading && !data) return <Loading />;
  if (!data?.shifts.length) return <EmptyState icon="wallet" text={t("ui.shifts.none")} />;
  return (
    <>
      <div className="shift-summary">
        <span>{fill(t("ui.shifts.awaitingN"), { n: data.summary.awaiting })}</span>
        <span className="is-neg">{t("ui.shifts.shortages")}: {m(data.summary.shortages)}</span>
        <span className="is-pos">{t("ui.shifts.overages")}: {m(data.summary.overages)}</span>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t("ui.shifts.cashier")}</th><th>{t("ui.shifts.opened")}</th><th>{t("ui.shifts.closed")}</th><th className="num">{t("ui.shifts.openingCash")}</th>
          <th className="num">{t("ui.shifts.expected")}</th><th className="num">{t("ui.shifts.counted")}</th><th className="num">{t("ui.shifts.difference")}</th><th>{t("ui.common.status")}</th></tr></thead>
        <tbody>{data.shifts.map((s) => (
          <tr key={s.id} className="is-clickable" onClick={() => onOpen(s.id)}>
            <td><strong>{s.user}</strong></td><td>{date(s.openedAt, lang, true)}</td><td>{s.closedAt ? date(s.closedAt, lang, true) : "—"}</td>
            <td className="num">{m(s.openingCash)}</td><td className="num">{s.expectedCash === null ? "—" : m(s.expectedCash)}</td>
            <td className="num">{s.countedCash === null ? "—" : m(s.countedCash)}</td>
            <td className={"num" + (s.difference < 0 ? " is-neg" : s.difference > 0 ? " is-pos" : "")}>{s.difference === null ? "—" : m(s.difference)}</td>
            <td><span className={`shift-status is-${s.status}`}>{t(`ui.shifts.status.${s.status}`)}</span></td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

function ShiftDetail({ id, onClose, onChanged }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const d = useApi(`/api/shifts/${id}`);
  const [note, setNote] = useState("");
  const sub = useSubmit();
  const s = d.data?.shift;
  const approve = async () => { if (await sub.run(() => apiRequest(`/api/shifts/${id}/approve`, { method: "POST", body: { note } }))) { d.reload(); onChanged(); } };
  return (
    <Modal title={s ? `${s.user} · ${date(s.openedAt, lang, true)}` : t("ui.common.loading")} onClose={onClose} wide>
      {!s ? <Loading /> : (
        <div className="form-grid">
          <Totals shift={s} />
          {s.countedCash !== null && (
            <dl className="adj-preview">
              <div><dt>{t("ui.shifts.counted")}</dt><dd>{m(s.countedCash)}</dd></div>
              <div className="is-total"><dt>{t("ui.shifts.difference")}</dt><dd className={s.difference < 0 ? "is-neg" : s.difference > 0 ? "is-pos" : ""}>{m(s.difference)}</dd></div>
              <div><dt>{t("ui.common.status")}</dt><dd><span className={`shift-status is-${s.status}`}>{t(`ui.shifts.status.${s.status}`)}</span></dd></div>
            </dl>
          )}
          {s.explanation && <p><strong>{t("ui.shifts.explanation")}:</strong> {s.explanation}</p>}
          {s.approvedBy && <p className="muted">{fill(t("ui.shifts.approvedBy"), { name: s.approvedBy, at: date(s.approvedAt, lang, true) })}{s.reviewNote ? ` · ${s.reviewNote}` : ""}</p>}
          {s.status === "closed" && can("cash.edit") && (
            <div className="panel-card form-grid">
              <Field label={`${t("ui.shifts.reviewNote")} ${t("ui.common.optional")}`}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <FormError error={sub.formError} />
              <div className="form-actions"><button type="button" className="btn btn--primary" disabled={sub.busy} onClick={approve}><Icon name="check" /><span>{t("ui.shifts.approve")}</span></button></div>
            </div>
          )}
          <h3 className="panel-card__title"><Icon name="history" />{t("ui.shifts.moves")}</h3>
          {!d.data.moves.length ? <p className="muted">{t("ui.common.noResults")}</p> : (
            <table className="table table--compact"><tbody>{d.data.moves.map((x, i) => (
              <tr key={i}><td>{date(x.at, lang, true)}</td><td>{t(`ui.cash.types.${x.type}`).startsWith("ui.") ? x.type : t(`ui.cash.types.${x.type}`)}<small className="cell-sub">{x.description}</small></td><td>{x.account}</td>
                <td className={"num " + (x.direction === "in" ? "is-pos" : "is-neg")}>{x.direction === "in" ? "+" : "−"}{m(x.amount)}</td></tr>
            ))}</tbody></table>
          )}
        </div>
      )}
    </Modal>
  );
}
