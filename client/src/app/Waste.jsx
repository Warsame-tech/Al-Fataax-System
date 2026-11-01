import { useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, EmptyState, Loading, ReasonModal, DateRange, daysAgo, isoDate } from "./ui.jsx";
import { date, fill, qty } from "./format.js";
import SearchSelect from "./SearchSelect.jsx";

/*
 * Food waste and spoilage (routes/waste.js): record burnt food, expired / spilled ingredients, wrong orders, unsold food,
 * damaged packaging. Managers' records are approved at once; others wait for approval. Waste report by reason and item.
 */
export function WastePage() {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const list = useApi(`/api/waste?${new URLSearchParams({ ...range, status, reason })}`);
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const [err, setErr] = useState(null);
  const d = list.data;
  const approve = async (w) => { setErr(null); try { await apiRequest(`/api/waste/${w.id}/approve`, { method: "POST", body: {} }); list.reload(); } catch (e) { setErr(e); } };
  return (
    <div className="page">
      <PageHeader icon="trash" title={t("app.modules.waste")} actions={<button type="button" className="btn btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /><span>{t("ui.waste.record")}</span></button>} />
      <p className="page-help"><Icon name="info" /> {t("ui.waste.help")}</p>
      <div className="toolbar">
        <DateRange value={range} onChange={setRange} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("ui.common.status")}>
          <option value="">{t("ui.common.all")}</option>{["pending", "approved", "rejected"].map((s) => <option key={s} value={s}>{t(`ui.waste.status.${s}`)}</option>)}
        </select>
        <select className="input input--auto" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("ui.common.reason")}>
          <option value="">{t("ui.waste.allReasons")}</option>{(d?.reasons || []).map((r) => <option key={r} value={r}>{t(`ui.waste.reasons.${r}`)}</option>)}
        </select>
      </div>
      {err && <p className="form-status form-status--error">{err.message}</p>}
      {!d ? <Loading /> : (
        <>
          <div className="split-view split-view--even">
            <section className="panel-card">
              <h2 className="panel-card__title"><Icon name="file-chart" />{fill(t("ui.waste.totalCost"), { amount: m(d.summary.total) })}</h2>
              {d.summary.pending > 0 && <p className="muted">{fill(t("ui.waste.pendingN"), { n: d.summary.pending })}</p>}
              <table className="table table--compact"><tbody>{d.summary.byReason.map((x) => <tr key={x.reason}><td>{t(`ui.waste.reasons.${x.reason}`)}</td><td className="num">{x.count}</td><td className="num">{m(x.cost)}</td></tr>)}</tbody></table>
            </section>
            <section className="panel-card">
              <h2 className="panel-card__title"><Icon name="package" />{t("ui.waste.byItem")}</h2>
              <table className="table table--compact"><tbody>{d.summary.byItem.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{qty(x.qty)} {x.unit}</td><td className="num">{m(x.cost)}</td></tr>)}</tbody></table>
            </section>
          </div>
          {!d.records.length ? <EmptyState icon="trash" text={t("ui.waste.none")} /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.common.item")}</th><th className="num">{t("ui.common.qty")}</th><th>{t("ui.common.reason")}</th><th>{t("ui.waste.responsible")}</th><th className="num">{t("ui.waste.cost")}</th><th>{t("ui.common.status")}</th><th /></tr></thead>
              <tbody>{d.records.map((w) => (
                <tr key={w.id}>
                  <td>{date(w.date, lang)}<small className="cell-sub">{w.user}</small></td>
                  <td><strong>{w.product}</strong>{w.location && <small className="cell-sub">{w.location}</small>}</td>
                  <td className="num">{qty(w.qty)} {w.unit}</td>
                  <td>{t(`ui.waste.reasons.${w.reason}`)}{w.note && <small className="cell-sub">{w.note}</small>}</td>
                  <td>{w.responsible || "—"}</td>
                  <td className="num">{m(w.cost ?? w.estimatedCost)}{w.cost === null && <small className="cell-sub">{t("ui.waste.estimate")}</small>}</td>
                  <td><span className={`waste-status is-${w.status}`}>{t(`ui.waste.status.${w.status}`)}</span>
                    {w.approvedBy && <small className="cell-sub">{w.approvedBy}</small>}{w.rejectReason && <small className="cell-sub">{w.rejectReason}</small>}</td>
                  <td className="row-actions">{w.status === "pending" && can("stock.adjust") && <>
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => approve(w)}>{t("ui.waste.approve")}</button>
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => setRejecting(w)}>{t("ui.waste.reject")}</button></>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {adding && <RecordWaste onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
      {rejecting && <ReasonModal title={t("ui.waste.reject")} confirmLabel={t("ui.waste.reject")} onClose={() => setRejecting(null)}
        onConfirm={(r) => apiRequest(`/api/waste/${rejecting.id}/reject`, { method: "POST", body: { reason: r } }).then(() => list.reload())} />}
    </div>
  );
}

function RecordWaste({ onClose, onDone }) {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const items = useApi("/api/waste/items");
  const locations = useApi("/api/stock/locations");
  const [f, setF] = useState({ productId: "", qty: "", unit: "", reason: "", note: "", responsible: "", date: isoDate(new Date()), locationId: "" });
  const [done, setDone] = useState(null);
  const sub = useSubmit();
  const item = (items.data?.items || []).find((x) => String(x.id) === String(f.productId));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); const r = await sub.run(() => apiRequest("/api/waste", { method: "POST", body: { ...f, unit: f.unit || item?.unit } })); if (r) setDone(r); };
  return (
    <Modal title={t("ui.waste.record")} onClose={done ? onDone : onClose}>
      {done ? (
        <div className="form-grid">
          <p className="form-status form-status--success">{fill(t(done.status === "approved" ? "ui.waste.savedApproved" : "ui.waste.savedPending"), { amount: m(done.estimatedCost) })}</p>
          <div className="form-actions"><button type="button" className="btn btn--primary" onClick={onDone}>{t("ui.common.close")}</button></div>
        </div>
      ) : (
        <form onSubmit={save} className="form-grid form-grid--2">
          <div className="ff ff--full"><span className="ff__label">{t("ui.common.item")}</span>
            <SearchSelect value={f.productId} onChange={(v) => { const x = items.data.items.find((i) => String(i.id) === String(v)); setF({ ...f, productId: v, unit: x?.unit || "" }); }} invalid={Boolean(sub.fieldErrors.productId)}
              options={(items.data?.items || []).map((x) => ({ value: x.id, label: x.name, sub: `${t(`ui.food.kinds.${x.kind}`)} · ${x.unit}` }))} searchPlaceholder={t("ui.common.searchPh")} placeholder={t("ui.waste.chooseItem")} />
          </div>
          <Field label={t("ui.common.qty")} error={sub.fieldErrors.qty}>
            <div className="qty-unit">
              <input className="input" type="number" min="0" step="any" value={f.qty} onChange={set("qty")} />
              <select className="input input--auto" value={f.unit || item?.unit || ""} onChange={set("unit")} aria-label={t("ui.products.unit")}>{(item?.units || []).map((u) => <option key={u} value={u}>{u}</option>)}</select>
            </div>
          </Field>
          <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason}>
            <select className="input" value={f.reason} onChange={set("reason")}><option value="">{t("ui.common.choose")}</option>
              {["burnt", "expired", "spilled", "wrong_order", "unsold", "damaged_packaging", "other"].map((r) => <option key={r} value={r}>{t(`ui.waste.reasons.${r}`)}</option>)}</select>
          </Field>
          <Field label={`${t("ui.waste.responsible")} ${t("ui.common.optional")}`}><input className="input" value={f.responsible} onChange={set("responsible")} placeholder={t("ui.waste.responsiblePh")} /></Field>
          <Field label={t("ui.common.date")} error={sub.fieldErrors.date}><input className="input" type="date" value={f.date} max={isoDate(new Date())} onChange={set("date")} /></Field>
          <Field label={t("ui.stock.location")}>
            <select className="input" value={f.locationId} onChange={set("locationId")}><option value="">{t("ui.stock.default")}</option>
              {(locations.data?.locations || []).filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </Field>
          <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`} full><input className="input" value={f.note} onChange={set("note")} /></Field>
          <p className="muted ff--full">{t(can("stock.adjust") ? "ui.waste.willApprove" : "ui.waste.willWait")}</p>
          <FormError error={sub.formError} />
          <div className="form-actions ff--full sheet-actions">
            <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
            <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.waste.record")}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
