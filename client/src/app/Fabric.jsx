import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, useMoney, useErrorText, Modal, Field, FormError, EmptyState, Loading, SearchBox, PaymentFields } from "./ui.jsx";
import { date, fill, qty } from "./format.js";
import { useAuth } from "../auth/AuthContext.jsx";

/*
 * Fabric businesses:
 *   <RollEntry>    rolls coming in (purchase receipt, stock in, opening stock): roll ID, declared and verified length
 *   <RollPicker>   choose the roll a cut is sold from (POS, invoices), or rolls to move / return
 *   RollsPage      every roll, what is left on it and its history; waste, damage, re-measuring, inspection of returns
 *   TailoringPage  tailoring orders: measurements, design, fabric (bought here or the customer's own), stages, payments
 * Lengths: stock is kept in meters; 1 yd = 0.9144 m (the server converts exactly, lib/rolls.js).
 */
export const isRoll = (p) => p?.tracking === "roll";
export const YARD = 0.9144;
const q4 = (v) => Math.round(Number(v) * 10000) / 10000;
export const toMeters = (v, unit) => (unit === "yard" ? q4(Number(v) * YARD) : q4(Number(v)));
export const toYards = (m) => q4(Number(m) / YARD);
/** "45 m · 49.2126 yd" */
export const lengthText = (m) => `${qty(m)} m · ${qty(toYards(m))} yd`;

/* ===================== Rolls coming in ===================== */
/**
 * value: { unit: "meter" | "yard", rolls: [{ code, declared, verified }] }. unitFixed: the unit comes from the line (purchases).
 * Quick fill: the same declared / verified length for n rolls (e.g. 10 rolls, 50 declared, 48.5 verified).
 */
export function RollEntry({ value, onChange, unitFixed = null, errors = {}, field = "rolls" }) {
  const { t } = useLanguage();
  const unit = unitFixed || value.unit || "meter";
  const rows = value.rolls || [];
  const [quick, setQuick] = useState({ n: "", declared: "", verified: "" });
  const boxRef = useRef(null);
  const set = (patch) => onChange({ unit, rolls: rows, ...patch });
  const setRow = (i, k, v) => set({ rolls: rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  const fillRows = () => {
    const n = Math.min(200, Math.max(0, Math.floor(Number(quick.n) || 0)));
    if (!n) return;
    set({ rolls: [...rows.filter((r) => String(r.code || r.declared || r.verified).trim()), ...Array.from({ length: n }, () => ({ code: "", declared: quick.declared, verified: quick.verified || quick.declared }))] });
  };
  const next = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inputs = [...boxRef.current.querySelectorAll(".roll-entry__row input")];
    inputs[inputs.indexOf(e.target) + 1]?.focus();
  };
  const sum = (k) => q4(rows.reduce((s, r) => s + (Number(k === "declared" ? r.declared || r.verified : r.verified) || 0), 0));
  const u = unit === "yard" ? "yd" : "m";
  return (
    <div className="roll-entry" ref={boxRef}>
      <div className="roll-entry__top">
        <strong><Icon name="roll" /> {t("ui.fabric.rolls")}</strong>
        {!unitFixed && (
          <div className="seg seg--sm">{["meter", "yard"].map((x) => <button key={x} type="button" aria-pressed={unit === x} onClick={() => set({ unit: x })}>{t(`ui.fabric.unitsLong.${x}`)}</button>)}</div>
        )}
      </div>
      <div className="roll-entry__quick">
        <input className="input input--sm" type="number" min="1" step="1" value={quick.n} onChange={(e) => setQuick({ ...quick, n: e.target.value })} placeholder={t("ui.fabric.count")} aria-label={t("ui.fabric.count")} />
        <input className="input input--sm" type="number" min="0" step="any" value={quick.declared} onChange={(e) => setQuick({ ...quick, declared: e.target.value })} placeholder={`${t("ui.fabric.declared")} (${u})`} aria-label={t("ui.fabric.declared")} />
        <input className="input input--sm" type="number" min="0" step="any" value={quick.verified} onChange={(e) => setQuick({ ...quick, verified: e.target.value })} placeholder={`${t("ui.fabric.verified")} (${u})`} aria-label={t("ui.fabric.verified")} />
        <button type="button" className="btn btn--outline btn--sm" onClick={fillRows} disabled={!(Number(quick.n) > 0) || !(Number(quick.declared || quick.verified) > 0)}><Icon name="copy" /><span>{fill(t("ui.fabric.fillN"), { n: Number(quick.n) || 0 })}</span></button>
      </div>
      {errors[field] && <span className="ff__error">{t(`ui.errors.${errors[field]}`)}</span>}
      {rows.length > 0 && (
        <div className="roll-entry__rows">
          <div className="roll-entry__row roll-entry__row--head" aria-hidden="true"><span>#</span><span>{t("ui.fabric.rollId")}</span><span>{t("ui.fabric.declared")} ({u})</span><span>{t("ui.fabric.verified")} ({u})</span><span /></div>
          {rows.map((r, i) => {
            const short = Number(r.declared) > 0 && Number(r.verified) > 0 ? q4(Number(r.declared) - Number(r.verified)) : 0;
            return (
              <div key={i} className="roll-entry__row">
                <span className="roll-entry__no">{i + 1}</span>
                <input className={"input input--sm" + (errors[`${field}.${i}.code`] ? " has-error" : "")} value={r.code} onChange={(e) => setRow(i, "code", e.target.value)} onKeyDown={next} placeholder={t("ui.fabric.auto")} aria-label={t("ui.fabric.rollId")} maxLength={40} />
                <input className={"input input--sm" + (errors[`${field}.${i}.declared`] ? " has-error" : "")} type="number" min="0" step="any" value={r.declared} onChange={(e) => setRow(i, "declared", e.target.value)} onKeyDown={next} placeholder={t("ui.fabric.declared")} aria-label={t("ui.fabric.declared")} />
                <span className="roll-entry__verified">
                  <input className={"input input--sm" + (errors[`${field}.${i}.verified`] ? " has-error" : "")} type="number" min="0" step="any" value={r.verified} onChange={(e) => setRow(i, "verified", e.target.value)} onKeyDown={next} placeholder={t("ui.fabric.verified")} aria-label={t("ui.fabric.verified")} />
                  {short !== 0 && <small className={short > 0 ? "is-neg" : "is-pos"}>{short > 0 ? "−" : "+"}{qty(Math.abs(short))}</small>}
                </span>
                <button type="button" className="icon-btn" onClick={() => set({ rolls: rows.filter((_, j) => j !== i) })} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
              </div>
            );
          })}
        </div>
      )}
      <div className="roll-entry__foot">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => set({ rolls: [...rows, { code: "", declared: "", verified: "" }] })}><Icon name="plus" /><span>{t("ui.fabric.addRoll")}</span></button>
        {rows.length > 0 && <span className="muted">{fill(t("ui.fabric.entryTotals"), { n: rows.length, declared: `${qty(sum("declared"))} ${u}`, verified: `${qty(sum("verified"))} ${u}` })}
          {unit === "yard" && ` = ${qty(toMeters(sum("verified"), "yard"))} m`}</span>}
      </div>
      <small className="ff__hint">{t("ui.fabric.entryHelp")}</small>
    </div>
  );
}
/** RollEntry value → what the API takes */
export const rollsPayload = (v) => (v?.rolls || []).filter((r) => String(r.code || "").trim() || String(r.declared || "").trim() || String(r.verified || "").trim())
  .map((r) => ({ code: String(r.code || "").trim(), declared: r.declared === "" ? null : r.declared, verified: r.verified === "" ? r.declared : r.verified }));
/** verified meters in a RollEntry value */
export const rollsVerified = (v) => q4((v?.rolls || []).reduce((s, r) => s + toMeters(Number(r.verified || r.declared) || 0, v.unit), 0));
export const rollsDeclared = (v) => q4((v?.rolls || []).reduce((s, r) => s + (Number(r.declared || r.verified) || 0), 0));

/* ===================== Choosing rolls ===================== */
/**
 * Lists a product's rolls: sellable (available at the POS location) by default, or { locationId, statuses } for transfers;
 * filter(r) narrows (e.g. rolls of one purchase). multi: tick several; otherwise a click picks one.
 */
export function RollPicker({ product, multi = false, value = [], locationId = null, sellable = true, filter, onDone, onClose, title, list: given }) {
  const { t, lang } = useLanguage();
  const params = new URLSearchParams({ productId: product.id, ...(sellable ? { sellable: "1" } : { status: "in_stock" }), ...(locationId ? { locationId } : {}) });
  const res = useApi(given ? null : `/api/rolls?${params}`);
  const [chosen, setChosen] = useState(value);
  const [q, setQ] = useState("");
  const all = useMemo(() => (given || res.data?.rolls || []).filter((r) => !filter || filter(r)), [given, res.data, filter]);
  const shown = all.filter((r) => !q || r.code.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (r) => {
    if (!multi) return onDone([r.id], [r]);
    setChosen((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id]));
  };
  const onScan = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const r = all.find((x) => x.code.toLowerCase() === q.trim().toLowerCase());
    if (r) { pick(r); setQ(""); }
  };
  return (
    <Modal title={title || fill(t("ui.fabric.choose"), { name: product.name })} onClose={onClose} wide>
      <div className="form-grid">
        <div className="device-picker__search">
          <Icon name="barcode" />
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onScan} placeholder={t("ui.fabric.scanPh")} />
        </div>
        {multi && <p className="muted">{fill(t("ui.devices.chosen"), { n: chosen.length })}</p>}
        {!given && res.loading && !res.data ? <Loading /> : all.length === 0 ? <EmptyState icon="roll" text={t("ui.fabric.noneAvailable")} /> : (
          <ul className="device-picker__list roll-picker">
            {shown.map((r) => (
              <li key={r.id}>
                <label className={"device-picker__item" + (chosen.includes(r.id) ? " is-on" : "")} onClick={multi ? undefined : (e) => { e.preventDefault(); pick(r); }}>
                  {multi ? <input type="checkbox" checked={chosen.includes(r.id)} onChange={() => pick(r)} /> : <Icon name="roll" />}
                  <span><strong>{r.code}</strong> · {lengthText(r.remaining)}
                    {r.status !== "available" && <> · <span className={`roll-status is-${r.status}`}>{t(`ui.fabric.status.${r.status}`)}</span></>}</span>
                  <small className="muted">{[r.location, r.verified !== r.remaining ? fill(t("ui.fabric.ofVerified"), { m: qty(r.verified) }) : null, r.receivedAt ? date(r.receivedAt, lang) : null].filter(Boolean).join(" · ")}</small>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          {multi && <button type="button" className="btn btn--primary" disabled={!chosen.length} onClick={() => onDone(chosen, all.filter((r) => chosen.includes(r.id)))}><Icon name="check" /><span>{fill(t("ui.fabric.useChosen"), { n: chosen.length })}</span></button>}
        </div>
      </div>
    </Modal>
  );
}

/* ===================== Rolls page ===================== */
const STATUSES = ["available", "pending_inspection", "finished", "damaged", "returned_supplier"];

export function RollsPage() {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("in_stock");
  const [productId, setProductId] = useState("");
  const list = useApi(`/api/rolls?${new URLSearchParams({ q, status, productId })}`);
  const [open, setOpen] = useState(null);
  const rows = list.data?.rolls || [];
  const totals = list.data?.products || [];
  return (
    <div className="page">
      <PageHeader icon="roll" title={t("app.modules.rolls")} actions={can("stock.add") && <Link className="btn btn--primary" to="/app/m/stock?tab=add"><Icon name="plus" /><span>{t("ui.fabric.receiveRolls")}</span></Link>} />
      <p className="page-help"><Icon name="info" /> {t("ui.fabric.help")}</p>
      {totals.length > 0 && (
        <div className="roll-totals">
          {totals.map((x) => (
            <button key={x.productId} type="button" className={"roll-total" + (String(x.productId) === productId ? " is-on" : "")} onClick={() => setProductId(String(x.productId) === productId ? "" : String(x.productId))}>
              <strong>{x.product}</strong>
              <span>{fill(t("ui.fabric.rollsCount"), { n: x.rolls })} · {lengthText(x.meters)}</span>
              {x.pending > 0 && <small className="roll-status is-pending_inspection">{fill(t("ui.fabric.pendingM"), { m: qty(x.pending) })}</small>}
            </button>
          ))}
        </div>
      )}
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t("ui.fabric.searchPh")} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("ui.common.status")}>
          <option value="in_stock">{t("ui.fabric.inStock")}</option>
          <option value="">{t("ui.common.all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`ui.fabric.status.${s}`)}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="roll" text={t("ui.fabric.noRolls")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.fabric.rollId")}</th><th>{t("ui.common.product")}</th><th className="num">{t("ui.fabric.remaining")}</th><th className="num">{t("ui.fabric.verified")}</th><th className="num">{t("ui.fabric.declared")}</th>
            <th className="num">{t("ui.fabric.costPerMeter")}</th><th>{t("ui.stock.location")}</th><th>{t("ui.common.status")}</th><th>{t("ui.fabric.receivedOn")}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="is-clickable" onClick={() => setOpen(r.id)}>
              <td><strong>{r.code}</strong>{r.supplier && <small className="cell-sub">{r.supplier}{r.purchaseNo ? ` · ${r.purchaseNo}` : ""}</small>}</td>
              <td>{r.product}</td>
              <td className="num"><strong>{qty(r.remaining)} m</strong><small className="cell-sub">{qty(r.remainingYards)} yd</small></td>
              <td className="num">{qty(r.verified)} m</td>
              <td className="num">{r.declared === null ? "—" : `${qty(r.declared)} m`}{r.shortage > 0 && <small className="cell-sub is-neg">−{qty(r.shortage)} m</small>}</td>
              <td className="num">{r.costPerMeter === null ? "—" : m(r.costPerMeter)}</td>
              <td>{r.location || "—"}</td>
              <td><span className={`roll-status is-${r.status}`}>{t(`ui.fabric.status.${r.status}`)}</span></td>
              <td>{date(r.receivedAt, lang)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {open && <RollDetail id={open} onClose={() => setOpen(null)} onChanged={() => list.reload()} />}
    </div>
  );
}

const KINDS = ["waste", "damaged", "measured", "found"];

function RollDetail({ id, onClose, onChanged }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const errText = useErrorText();
  const d = useApi(`/api/rolls/${id}`);
  const r = d.data?.roll;
  const [f, setF] = useState({ kind: "waste", length: "", lengthUnit: "meter", reason: "", notes: "" });
  const [note, setNote] = useState("");
  const sub = useSubmit();
  const after = (ok) => { if (ok) { d.reload(); onChanged(); setF((x) => ({ ...x, length: "", reason: "", notes: "" })); setNote(""); } return ok; };
  const adjust = (e) => { e.preventDefault(); sub.run(() => apiRequest(`/api/rolls/${id}/adjust`, { method: "POST", body: f })).then(after); };
  const inspect = (result) => sub.run(() => apiRequest(`/api/rolls/${id}/inspect`, { method: "POST", body: { result, notes: note } })).then(after);
  const preview = r && f.length !== "" && Number(f.length) >= 0 ? (() => {
    const len = toMeters(Number(f.length), f.lengthUnit);
    return f.kind === "measured" ? len : f.kind === "found" ? q4(r.remaining + len) : q4(r.remaining - len);
  })() : null;
  return (
    <Modal title={r ? `${r.code} · ${r.product}` : t("ui.common.loading")} onClose={onClose} wide>
      {!r ? <Loading /> : (
        <div className="form-grid">
          <dl className="adj-preview">
            <div className="is-total"><dt>{t("ui.fabric.remaining")}</dt><dd>{qty(r.remaining)} m<small className="cell-sub">{qty(r.remainingYards)} yd</small></dd></div>
            <div><dt>{t("ui.fabric.verified")}</dt><dd>{qty(r.verified)} m</dd></div>
            <div><dt>{t("ui.fabric.declared")}</dt><dd>{r.declared === null ? "—" : `${qty(r.declared)} m`}{r.shortage > 0 && <small className="cell-sub is-neg">−{qty(r.shortage)} m</small>}</dd></div>
            <div><dt>{t("ui.fabric.costPerMeter")}</dt><dd>{r.costPerMeter === null ? "—" : m(r.costPerMeter)}</dd></div>
            <div><dt>{t("ui.stock.location")}</dt><dd>{r.location || "—"}</dd></div>
            <div><dt>{t("ui.common.status")}</dt><dd><span className={`roll-status is-${r.status}`}>{t(`ui.fabric.status.${r.status}`)}</span></dd></div>
          </dl>
          {(r.supplier || r.purchaseNo) && <p className="muted">{[r.supplier, r.purchaseNo, date(r.receivedAt, lang)].filter(Boolean).join(" · ")}</p>}

          {r.status === "pending_inspection" && can("stock.adjust") && (
            <section className="panel-card form-grid">
              <h3 className="panel-card__title"><Icon name="search-glass" />{t("ui.fabric.inspectTitle")}</h3>
              <p className="modal__help">{t("ui.fabric.inspectHelp")}</p>
              <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ui.common.notes")} /></Field>
              <div className="form-actions">
                <button type="button" className="btn btn--danger" disabled={sub.busy} onClick={() => inspect("damaged")}>{t("ui.fabric.writeOff")}</button>
                <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={() => inspect("approve")}><Icon name="check" /><span>{t("ui.fabric.approveSale")}</span></button>
              </div>
            </section>
          )}
          {["available", "finished"].includes(r.status) && can("stock.adjust") && (
            <form onSubmit={adjust} className="panel-card form-grid form-grid--2">
              <h3 className="panel-card__title ff--full"><Icon name="scissors" />{t("ui.fabric.adjustTitle")}</h3>
              <div className="ff ff--full">
                <div className="seg">{KINDS.filter((k) => r.status === "available" || ["measured", "found"].includes(k)).map((k) => (
                  <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{t(`ui.fabric.kinds.${k}`)}</button>
                ))}</div>
                <small className="ff__hint">{t(`ui.fabric.kindHelp.${f.kind}`)}</small>
              </div>
              <Field label={t(f.kind === "measured" ? "ui.fabric.measuredLength" : "ui.fabric.length")} error={sub.fieldErrors.length}>
                <div className="qty-unit">
                  <input className="input" type="number" min="0" step="any" value={f.length} onChange={(e) => setF({ ...f, length: e.target.value })} placeholder={t("ui.fabric.length")} />
                  <select className="input input--auto" value={f.lengthUnit} onChange={(e) => setF({ ...f, lengthUnit: e.target.value })} aria-label={t("ui.fabric.lengthUnit")}>
                    <option value="meter">m</option><option value="yard">yd</option>
                  </select>
                </div>
              </Field>
              <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason}><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={t(`ui.fabric.reasonPh.${f.kind}`)} /></Field>
              <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`} full><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t("ui.common.notes")} /></Field>
              {preview !== null && <p className={"ff--full " + (preview < 0 ? "form-status form-status--error" : "muted")}>{fill(t("ui.fabric.willBe"), { before: qty(r.remaining), after: qty(preview) })}</p>}
              <div className="form-actions ff--full"><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.fabric.saveAdjust")}</button></div>
            </form>
          )}
          {sub.formError && !sub.formError.errors && <p className="form-status form-status--error">{errText(sub.formError)}</p>}

          <h3 className="panel-card__title"><Icon name="history" />{t("ui.fabric.history")}</h3>
          <ul className="timeline">{d.data.events.map((e) => (
            <li key={e.id}>
              <strong>{t(`ui.fabric.events.${e.event}`)}{e.change !== 0 && <span className={e.change < 0 ? "is-neg" : "is-pos"}> {e.change > 0 ? "+" : "−"}{qty(Math.abs(e.change))} m</span>} → {qty(e.remaining)} m</strong>
              <small>{date(e.at, lang, true)}{e.user ? ` · ${e.user}` : ""}{e.refNo ? ` · ${e.refNo}` : ""}{e.location ? ` · ${e.location}` : ""}</small>
              {e.note && <span>{e.note}</span>}
            </li>
          ))}</ul>
        </div>
      )}
    </Modal>
  );
}

/* ===================== Tailoring orders ===================== */
const GARMENTS = ["Dirac", "Garbasaar", "Abaya", "Jilbab", "Kamis / Thobe", "Macawis", "Suit", "Shirt", "Trousers", "Dress", "Skirt", "School uniform", "Alteration"];
const MEASURES = ["Chest / Bust", "Waist", "Hips", "Shoulder", "Sleeve length", "Length", "Neck", "Inseam"];

export function TailoringPage() {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("open");
  const [stage, setStage] = useState("");
  const list = useApi(`/api/tailoring?${new URLSearchParams({ q, status, stage })}`);
  const [editing, setEditing] = useState(null);       // {} new, order to edit
  const [open, setOpen] = useState(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const rows = list.data?.orders || [];
  const stages = list.data?.stages || [];
  return (
    <div className="page">
      <PageHeader icon="scissors" title={t("app.modules.tailoring")} actions={<>
        {can("settings.edit") && <button type="button" className="btn btn--outline" onClick={() => setStagesOpen(true)}><Icon name="settings" /><span>{t("ui.tailoring.stages")}</span></button>}
        {can("sales.create") && <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.tailoring.newOrder")}</span></button>}
      </>} />
      <p className="page-help"><Icon name="info" /> {t("ui.tailoring.help")}</p>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t("ui.tailoring.searchPh")} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("ui.common.status")}>
          {["open", "delivered", "cancelled"].map((s) => <option key={s} value={s}>{t(`ui.tailoring.status.${s}`)}</option>)}
          <option value="">{t("ui.common.all")}</option>
        </select>
        <select className="input input--auto" value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t("ui.tailoring.stage")}>
          <option value="">{t("ui.tailoring.allStages")}</option>
          {stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="scissors" text={t("ui.tailoring.none")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.tailoring.number")}</th><th>{t("ui.common.customer")}</th><th>{t("ui.tailoring.garment")}</th><th>{t("ui.tailoring.stage")}</th><th>{t("ui.tailoring.promised")}</th>
            <th>{t("ui.tailoring.worker")}</th><th className="num">{t("ui.tailoring.quoted")}</th><th className="num">{t("ui.common.balance")}</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id} className="is-clickable" onClick={() => setOpen(o.id)}>
              <td><strong>{o.number}</strong><small className="cell-sub">{date(o.createdAt, lang)}</small></td>
              <td>{o.customer || "—"}{o.phone && <small className="cell-sub">{o.phone}</small>}</td>
              <td>{o.garmentType}<small className="cell-sub">{t(`ui.tailoring.sources.${o.fabricSource}`)}</small></td>
              <td>{o.status === "open" ? <span className="stage-tag">{o.stage}</span> : <span className={`roll-status is-${o.status}`}>{t(`ui.tailoring.status.${o.status}`)}</span>}</td>
              <td className={o.late ? "is-neg" : ""}>{o.promisedDate ? date(o.promisedDate, lang) : "—"}{o.late && <small className="cell-sub">{t("ui.tailoring.late")}</small>}</td>
              <td>{o.assignedWorker || "—"}</td>
              <td className="num">{m(o.quotedPrice)}</td>
              <td className="num">{o.balance > 0 ? <strong>{m(o.balance)}</strong> : m(0)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <TailoringForm order={editing} onClose={() => setEditing(null)} onSaved={(r) => { setEditing(null); list.reload(); if (r?.id) setOpen(r.id); }} />}
      {open && !editing && <TailoringDetail id={open} onClose={() => { setOpen(null); list.reload(); }} onEdit={(o) => setEditing(o)} />}
      {stagesOpen && <StagesModal onClose={() => setStagesOpen(false)} onSaved={() => { setStagesOpen(false); list.reload(); }} />}
    </div>
  );
}

function TailoringForm({ order, onClose, onSaved }) {
  const { t } = useLanguage();
  const isNew = !order.id;
  const customers = useApi("/api/customers");
  const [f, setF] = useState(() => ({
    customerId: order.customerId ? String(order.customerId) : "", customerName: order.customerId ? "" : order.customer || "", customerPhone: order.customerId ? "" : order.phone || "",
    garmentType: order.garmentType || "", designNotes: order.designNotes || "", fabricSource: order.fabricSource || "store", customerFabric: order.customerFabric || "",
    linkedReceipt: order.linkedReceipt || "", quotedPrice: order.quotedPrice ?? "", deposit: "", method: "cash", bankAccountId: "",
    laborCost: order.laborCost || "", materialCost: order.materialCost || "", extraCost: order.extraCost || "",
    promisedDate: order.promisedDate ? String(order.promisedDate).slice(0, 10) : "", assignedWorker: order.assignedWorker || ""
  }));
  const [measures, setMeasures] = useState(() => {
    const saved = Object.entries(order.measurements || {}).map(([name, value]) => ({ name, value }));
    return saved.length ? saved : MEASURES.slice(0, 6).map((name) => ({ name, value: "" }));
  });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setM = (i, k, v) => setMeasures((list) => list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, measurements: Object.fromEntries(measures.filter((x) => x.name.trim() && String(x.value).trim()).map((x) => [x.name.trim(), String(x.value).trim()])) };
    if (!isNew) { delete body.deposit; delete body.method; }
    const r = await sub.run(() => apiRequest(isNew ? "/api/tailoring" : `/api/tailoring/${order.id}`, { method: isNew ? "POST" : "PUT", body }));
    if (r) onSaved(isNew ? r : { id: order.id });
  };
  const err = sub.fieldErrors;
  return (
    <Modal title={isNew ? t("ui.tailoring.newOrder") : fill(t("ui.tailoring.editOrder"), { n: order.number })} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2 sheet-form">
        <Field label={`${t("ui.common.customer")} ${t("ui.common.optional")}`}>
          <select className="input" value={f.customerId} onChange={set("customerId")}>
            <option value="">{t("ui.jewelry.walkIn")}</option>
            {(customers.data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </Field>
        {!f.customerId && <Field label={t("ui.jewelry.customerName")} error={err.customerName}><input className="input" value={f.customerName} onChange={set("customerName")} placeholder={t("ui.jewelry.customerName")} /></Field>}
        {!f.customerId && <Field label={`${t("ui.common.phone")} ${t("ui.common.optional")}`}><input className="input" type="tel" value={f.customerPhone} onChange={set("customerPhone")} placeholder={t("ui.common.phone")} /></Field>}
        <Field label={t("ui.tailoring.garment")} error={err.garmentType}>
          <input className="input" list="garment-types" value={f.garmentType} onChange={set("garmentType")} placeholder={t("ui.tailoring.garment")} />
          <datalist id="garment-types">{GARMENTS.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>

        <div className="ff ff--full measures">
          <span className="ff__label"><Icon name="ruler" /> {t("ui.tailoring.measurements")}</span>
          <div className="measures__grid">
            {measures.map((x, i) => (
              <div key={i} className="measures__row">
                <input className="input input--sm" list="measure-names" value={x.name} onChange={(e) => setM(i, "name", e.target.value)} placeholder={t("ui.tailoring.measurementName")} aria-label={t("ui.tailoring.measurementName")} />
                <input className="input input--sm" value={x.value} onChange={(e) => setM(i, "value", e.target.value)} placeholder={t("ui.tailoring.measurementPh")} aria-label={x.name || t("ui.tailoring.measurementName")} />
                <button type="button" className="icon-btn" onClick={() => setMeasures((list) => list.filter((_, j) => j !== i))} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
              </div>
            ))}
          </div>
          <datalist id="measure-names">{MEASURES.map((x) => <option key={x} value={x} />)}</datalist>
          <div><button type="button" className="btn btn--outline btn--sm" onClick={() => setMeasures((list) => [...list, { name: "", value: "" }])}><Icon name="plus" /><span>{t("ui.tailoring.addMeasurement")}</span></button></div>
        </div>
        <Field label={`${t("ui.tailoring.design")} ${t("ui.common.optional")}`} full><textarea className="input" rows={2} value={f.designNotes} onChange={set("designNotes")} placeholder={t("ui.tailoring.designPh")} /></Field>

        <Field label={t("ui.tailoring.fabricSource")} full>
          <div className="seg">{["store", "customer"].map((s) => <button key={s} type="button" aria-pressed={f.fabricSource === s} onClick={() => setF({ ...f, fabricSource: s })}>{t(`ui.tailoring.sources.${s}`)}</button>)}</div>
        </Field>
        {f.fabricSource === "customer"
          ? <Field label={t("ui.tailoring.customerFabric")} error={err.customerFabric} hint={t("ui.tailoring.customerFabricHint")} full><input className="input" value={f.customerFabric} onChange={set("customerFabric")} placeholder={t("ui.tailoring.customerFabricPh")} /></Field>
          : <Field label={`${t("ui.tailoring.linkedReceipt")} ${t("ui.common.optional")}`} error={err.linkedReceipt} hint={t("ui.tailoring.linkedReceiptHint")} full><input className="input" value={f.linkedReceipt} onChange={set("linkedReceipt")} placeholder={t("ui.tailoring.linkedReceiptPh")} /></Field>}

        <Field label={t("ui.tailoring.quoted")} error={err.quotedPrice}><input className="input" type="number" min="0" step="any" value={f.quotedPrice} onChange={set("quotedPrice")} placeholder={t("ui.tailoring.quoted")} /></Field>
        <Field label={`${t("ui.tailoring.promised")} ${t("ui.common.optional")}`}><input className="input" type="date" value={f.promisedDate} onChange={set("promisedDate")} /></Field>
        {isNew && <Field label={`${t("ui.tailoring.deposit")} ${t("ui.common.optional")}`} error={err.deposit}><input className="input" type="number" min="0" step="any" value={f.deposit} onChange={set("deposit")} placeholder={t("ui.tailoring.deposit")} /></Field>}
        {isNew && Number(f.deposit) > 0 && <div className="ff ff--full"><PaymentFields method={f.method} onMethod={(v) => setF({ ...f, method: v })} bankId={f.bankAccountId} onBank={(v) => setF({ ...f, bankAccountId: v })} errors={err} /></div>}
        <Field label={`${t("ui.tailoring.worker")} ${t("ui.common.optional")}`}><input className="input" value={f.assignedWorker} onChange={set("assignedWorker")} placeholder={t("ui.tailoring.worker")} /></Field>
        <p className="form-sub ff--full"><Icon name="wallet" /> {t("ui.tailoring.costs")}</p>
        <Field label={`${t("ui.tailoring.labor")} ${t("ui.common.optional")}`} error={err.laborCost}><input className="input" type="number" min="0" step="any" value={f.laborCost} onChange={set("laborCost")} placeholder={t("ui.tailoring.labor")} /></Field>
        <Field label={`${t("ui.tailoring.material")} ${t("ui.common.optional")}`} error={err.materialCost} hint={t("ui.tailoring.materialHint")}><input className="input" type="number" min="0" step="any" value={f.materialCost} onChange={set("materialCost")} placeholder={t("ui.tailoring.material")} /></Field>
        <Field label={`${t("ui.tailoring.extra")} ${t("ui.common.optional")}`} error={err.extraCost}><input className="input" type="number" min="0" step="any" value={f.extraCost} onChange={set("extraCost")} placeholder={t("ui.tailoring.extra")} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t(sub.busy ? "ui.common.saving" : "ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function TailoringDetail({ id, onClose, onEdit }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const errText = useErrorText();
  const { business } = useAuth();
  const d = useApi(`/api/tailoring/${id}`);
  const o = d.data?.order;
  const [note, setNote] = useState("");
  const [pay, setPay] = useState({ amount: "", method: "cash", bankAccountId: "" });
  const [cancelling, setCancelling] = useState(false);
  const sub = useSubmit();
  useEffect(() => { if (o) setPay((x) => ({ ...x, amount: o.balance > 0 ? String(o.balance) : "" })); }, [o?.balance]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = (path, body) => sub.run(() => apiRequest(`/api/tailoring/${id}/${path}`, { method: "POST", body })).then((ok) => { if (ok) { d.reload(); setNote(""); } return ok; });
  const stages = d.data?.stages || [];
  const at = o ? stages.indexOf(o.stage) : -1;
  const nextStage = at >= 0 && at < stages.length - 2 ? stages[at + 1] : null;
  return (
    <Modal title={o ? `${o.number} · ${o.garmentType}` : t("ui.common.loading")} onClose={onClose} wide footer={o && (
      <div className="statement-foot">
        <span className={o.status === "open" ? "stage-tag" : `roll-status is-${o.status}`}>{o.status === "open" ? o.stage : t(`ui.tailoring.status.${o.status}`)}</span>
        <div className="form-actions">
          {o.status === "open" && can("sales.cancel") && <button type="button" className="btn btn--danger" onClick={() => setCancelling(true)}>{t("ui.tailoring.cancel")}</button>}
          {o.status === "open" && can("sales.create") && <button type="button" className="btn btn--outline" onClick={() => onEdit(o)}><Icon name="pencil" /><span>{t("ui.common.edit")}</span></button>}
          <button type="button" className="btn btn--outline" onClick={() => window.print()}><Icon name="printer" /><span>{t("invoice.printOnly")}</span></button>
        </div>
      </div>
    )}>
      {!o ? <Loading /> : (
        <div className="form-grid gb-detail">
          <div className="gb-receipt">
            <h3>{business?.name} · {t("ui.tailoring.ticket")} · {o.number}</h3>
            <dl className="adj-preview">
              <div><dt>{t("ui.common.customer")}</dt><dd>{o.customer || "—"}{o.phone ? ` · ${o.phone}` : ""}</dd></div>
              <div><dt>{t("ui.common.date")}</dt><dd>{date(o.createdAt, lang)}</dd></div>
              <div><dt>{t("ui.tailoring.promised")}</dt><dd className={o.late ? "is-neg" : ""}>{o.promisedDate ? date(o.promisedDate, lang) : "—"}</dd></div>
              <div><dt>{t("ui.tailoring.worker")}</dt><dd>{o.assignedWorker || "—"}</dd></div>
              <div><dt>{t("ui.tailoring.quoted")}</dt><dd>{m(o.quotedPrice)}</dd></div>
              <div><dt>{t("ui.common.paid")}</dt><dd>{m(o.paid)}</dd></div>
              <div className="is-total"><dt>{t("ui.common.balance")}</dt><dd className={o.balance > 0 ? "is-neg" : "is-pos"}>{m(o.balance)}</dd></div>
            </dl>
            {Object.keys(o.measurements).length > 0 && (
              <div className="measures-sheet"><strong>{t("ui.tailoring.measurements")}</strong>
                <ul>{Object.entries(o.measurements).map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}</ul></div>
            )}
            {o.designNotes && <p><strong>{t("ui.tailoring.design")}:</strong> {o.designNotes}</p>}
            <p><strong>{t("ui.tailoring.fabricSource")}:</strong> {o.fabricSource === "customer"
              ? <>{t("ui.tailoring.sources.customer")} — {o.customerFabric} <small className="muted">({t("ui.tailoring.notInStock")})</small></>
              : <>{t("ui.tailoring.sources.store")}{o.linkedReceipt ? ` · ${fill(t("ui.tailoring.onReceipt"), { n: o.linkedReceipt })}` : ""}</>}</p>
            {d.data.fabric.length > 0 && <ul className="tail-fabric">{d.data.fabric.map((x, i) => <li key={i}>{x.name} · {qty(x.qty)} {x.unit} · {m(x.total)}</li>)}</ul>}
            {can("dashboard.finance") && o.costs > 0 && <p className="muted no-print">{fill(t("ui.tailoring.costLine"), { labor: m(o.laborCost), material: m(o.materialCost), extra: m(o.extraCost), profit: m(o.profit) })}</p>}
          </div>

          {o.status === "open" && can("sales.create") && (
            <section className="panel-card form-grid no-print">
              <h3 className="panel-card__title"><Icon name="layers" />{t("ui.tailoring.progress")}</h3>
              <ol className="stage-steps">{stages.map((s, i) => <li key={s} className={i < at ? "is-done" : i === at ? "is-now" : ""}>{s}</li>)}</ol>
              <Field label={`${t("ui.tailoring.stageNote")} ${t("ui.common.optional")}`}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ui.tailoring.stageNotePh")} /></Field>
              <div className="form-actions">
                <select className="input input--auto" value="" onChange={(e) => e.target.value && post("stage", { stage: e.target.value, note })} aria-label={t("ui.tailoring.stage")}>
                  <option value="">{t("ui.tailoring.moveTo")}</option>
                  {stages.slice(0, -1).filter((s) => s !== o.stage).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {nextStage && <button type="button" className="btn btn--outline" disabled={sub.busy} onClick={() => post("stage", { stage: nextStage, note })}><span>{fill(t("ui.tailoring.next"), { stage: nextStage })}</span><Icon name="arrow-right" /></button>}
                <button type="button" className="btn btn--primary" disabled={sub.busy || o.balance > 0} title={o.balance > 0 ? t("ui.tailoring.payFirst") : undefined} onClick={() => post("deliver", { note })}><Icon name="check" /><span>{t("ui.tailoring.deliver")}</span></button>
              </div>
              {o.balance > 0 && <small className="ff__hint">{t("ui.tailoring.payFirst")}</small>}
            </section>
          )}
          {o.status !== "cancelled" && o.balance > 0 && can("payments.receive") && (
            <section className="panel-card form-grid form-grid--2 no-print">
              <h3 className="panel-card__title ff--full"><Icon name="wallet" />{t("ui.tailoring.pay")}</h3>
              <Field label={t("ui.common.amount")} error={sub.fieldErrors.amount}><input className="input" type="number" min="0" step="any" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
              <div className="ff ff--full"><PaymentFields method={pay.method} onMethod={(v) => setPay({ ...pay, method: v })} bankId={pay.bankAccountId} onBank={(v) => setPay({ ...pay, bankAccountId: v })} errors={sub.fieldErrors} /></div>
              <div className="form-actions ff--full"><button type="button" className="btn btn--primary" disabled={sub.busy} onClick={() => post("payments", pay)}>{t("ui.tailoring.receive")}</button></div>
            </section>
          )}
          {sub.formError && <p className="form-status form-status--error no-print">{errText(sub.formError.errors ? "validation" : sub.formError)}</p>}

          <h3 className="panel-card__title no-print"><Icon name="history" />{t("ui.tailoring.history")}</h3>
          <ul className="timeline no-print">{d.data.events.map((e) => (
            <li key={e.id}>
              <strong>{t(`ui.tailoring.events.${e.event}`)}{e.stage ? ` · ${e.stage}` : ""}{e.amount !== null ? ` · ${m(e.amount)}${e.method ? ` (${t(`ui.methods.${e.method}`)})` : ""}` : ""}</strong>
              <small>{date(e.at, lang, true)}{e.user ? ` · ${e.user}` : ""}</small>
              {e.note && e.event !== "payment" && <span>{e.note}</span>}
            </li>
          ))}</ul>
        </div>
      )}
      {cancelling && o && <CancelOrder order={o} onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); d.reload(); }} />}
    </Modal>
  );
}

function CancelOrder({ order, onClose, onDone }) {
  const { t } = useLanguage();
  const m = useMoney();
  const [f, setF] = useState({ reason: "", refund: "", method: "cash", bankAccountId: "" });
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(`/api/tailoring/${order.id}/cancel`, { method: "POST", body: f }))) onDone();
  };
  return (
    <Modal title={t("ui.tailoring.cancel")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <p className="modal__help">{t("ui.tailoring.cancelHelp")}</p>
        <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason}><textarea className="input" rows="2" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={t("ui.common.reasonPh")} /></Field>
        {order.paid > 0 && <Field label={`${t("ui.tailoring.refund")} ${t("ui.common.optional")}`} error={sub.fieldErrors.refund} hint={fill(t("ui.tailoring.paidSoFar"), { amount: m(order.paid) })}>
          <input className="input" type="number" min="0" step="any" value={f.refund} onChange={(e) => setF({ ...f, refund: e.target.value })} /></Field>}
        {Number(f.refund) > 0 && <PaymentFields method={f.method} onMethod={(v) => setF({ ...f, method: v })} bankId={f.bankAccountId} onBank={(v) => setF({ ...f, bankAccountId: v })} errors={sub.fieldErrors} />}
        <FormError error={sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.close")}</button>
          <button type="submit" className="btn btn--danger" disabled={sub.busy}>{t("ui.tailoring.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* Owner: the work stages of a tailoring order (the last one is delivery). */
function StagesModal({ onClose, onSaved }) {
  const { t } = useLanguage();
  const d = useApi("/api/tailoring/stages");
  const [list, setList] = useState(null);
  useEffect(() => { if (d.data && !list) setList(d.data.stages); }, [d.data, list]);
  const sub = useSubmit();
  const move = (i, by) => setList((l) => { const x = [...l]; [x[i], x[i + by]] = [x[i + by], x[i]]; return x; });
  const save = async () => { if (await sub.run(() => apiRequest("/api/tailoring/stages", { method: "PUT", body: { stages: list.map((s) => s.trim()).filter(Boolean) } }))) onSaved(); };
  return (
    <Modal title={t("ui.tailoring.stages")} onClose={onClose}>
      {!list ? <Loading /> : (
        <div className="form-grid">
          <p className="modal__help">{t("ui.tailoring.stagesHelp")}</p>
          <ol className="stage-edit">{list.map((s, i) => (
            <li key={i}>
              <input className="input input--sm" value={s} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? e.target.value : x)))} aria-label={t("ui.tailoring.stage")} maxLength={60} />
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><Icon name="chevron-up" /></button>
              <button type="button" className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Down"><Icon name="chevron-down" /></button>
              <button type="button" className="icon-btn" disabled={list.length <= 2} onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
            </li>
          ))}</ol>
          <div className="form-actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setList((l) => [...l.slice(0, -1), "", l[l.length - 1]])}><Icon name="plus" /><span>{t("ui.tailoring.addStage")}</span></button>
            <button type="button" className="link-btn" onClick={() => setList(d.data.defaults)}>{t("ui.tailoring.resetStages")}</button>
          </div>
          {sub.fieldErrors.stages && <p className="form-status form-status--error">{t(`ui.errors.${sub.fieldErrors.stages}`)}</p>}
          <div className="form-actions sheet-actions">
            <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
            <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}>{t("ui.common.save")}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}


