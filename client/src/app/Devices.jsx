import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, Modal, Field, FormError, EmptyState, Loading, SearchBox } from "./ui.jsx";
import { date, fill } from "./format.js";

/*
 * Serial number / IMEI devices (electronics):
 *   <DeviceEntry>   type the serial numbers / IMEIs of units coming in (one row per unit; scanner-friendly)
 *   <DevicePicker>  choose the exact units going out (sale, invoice, transfer, adjustment, supplier return)
 *   DevicesPage     search every device and see its history
 *   WarrantiesPage  search and update warranties
 */
const needsSerial = (t) => t === "serial" || t === "serial_imei";
const needsImei = (t) => t === "imei" || t === "serial_imei";
export const deviceText = (d) => [d.serial && `S/N ${d.serial}`, d.imei1 && `IMEI ${d.imei1}`, d.imei2 && `IMEI2 ${d.imei2}`].filter(Boolean).join(" · ");

/** Rows for qty units: [{ serial, imei1, imei2 }]. Enter moves to the next box (barcode scanners send Enter). */
export function DeviceEntry({ tracking, qty, value = [], onChange, errors = {}, field = "devices" }) {
  const { t } = useLanguage();
  const n = Math.max(0, Math.min(500, Math.floor(Number(qty) || 0)));
  const rows = Array.from({ length: n }, (_, i) => value[i] || { serial: "", imei1: "", imei2: "" });
  const boxRef = useRef(null);
  useEffect(() => { if (value.length !== n) onChange(rows); }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const next = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inputs = [...boxRef.current.querySelectorAll("input")];
    inputs[inputs.indexOf(e.target) + 1]?.focus();
  };
  if (!n) return null;
  const filled = rows.filter((r) => (needsSerial(tracking) ? r.serial.trim() : true) && (needsImei(tracking) ? r.imei1.trim() : true)).length;
  return (
    <div className="device-entry" ref={boxRef}>
      <p className="device-entry__head">{fill(t("ui.devices.enterNumbers"), { done: filled, n })}</p>
      {errors[field] && <span className="ff__error">{t(`ui.errors.${errors[field]}`)}</span>}
      {rows.map((r, i) => (
        <div key={i} className="device-entry__row">
          <span className="device-entry__no">{i + 1}</span>
          {needsSerial(tracking) && <input className={"input input--sm" + (errors[`${field}.${i}.serial`] ? " has-error" : "")} value={r.serial} onChange={(e) => set(i, "serial", e.target.value)} onKeyDown={next} placeholder={t("ui.devices.serial")} aria-label={t("ui.devices.serial")} />}
          {needsImei(tracking) && (
            <>
              <input className={"input input--sm" + (errors[`${field}.${i}.imei1`] ? " has-error" : "")} value={r.imei1} onChange={(e) => set(i, "imei1", e.target.value.replace(/\D/g, ""))} onKeyDown={next} placeholder="IMEI 1" inputMode="numeric" maxLength={15} aria-label="IMEI 1" />
              <input className={"input input--sm" + (errors[`${field}.${i}.imei2`] ? " has-error" : "")} value={r.imei2} onChange={(e) => set(i, "imei2", e.target.value.replace(/\D/g, ""))} onKeyDown={next} placeholder={t("ui.devices.imei2Ph")} inputMode="numeric" maxLength={15} aria-label="IMEI 2" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Choose devices of a product. Lists the product's devices (default: available at the location) with a search box
 * that also takes a scanned serial / IMEI. max = how many may be chosen (or null = any). filter(d) narrows the list.
 */
export function DevicePicker({ product, locationId, value = [], max = null, filter, onDone, onClose, title }) {
  const { t } = useLanguage();
  const params = new URLSearchParams({ productId: product.id, status: "available", ...(locationId === "default" ? { location: "default" } : locationId ? { locationId } : {}) });
  const list = useApi(`/api/devices?${params}`);
  const [chosen, setChosen] = useState(value);
  const [q, setQ] = useState("");
  const all = useMemo(() => (list.data?.devices || []).filter((d) => !filter || filter(d)), [list.data, filter]);
  const shown = all.filter((d) => !q || `${d.serial} ${d.imei1} ${d.imei2}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (d) => setChosen((c) => (c.includes(d.id) ? c.filter((x) => x !== d.id) : max !== null && c.length >= max ? c : [...c, d.id]));
  const onScan = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = q.trim();
    const d = all.find((x) => [x.serial, x.imei1, x.imei2].includes(code));
    if (d && !chosen.includes(d.id)) { toggle(d); setQ(""); }
  };
  const done = () => onDone(chosen, all.filter((d) => chosen.includes(d.id)));
  return (
    <Modal title={title || fill(t("ui.devices.choose"), { name: product.name })} onClose={onClose} wide>
      <div className="form-grid">
        <div className="device-picker__search">
          <Icon name="barcode" />
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onScan} placeholder={t("ui.devices.scanPh")} />
        </div>
        <p className="muted">{fill(max !== null ? t("ui.devices.chosenOf") : t("ui.devices.chosen"), { n: chosen.length, max })}</p>
        {list.loading && !list.data ? <Loading /> : all.length === 0 ? <EmptyState icon="smartphone" text={t("ui.devices.noneAvailable")} /> : (
          <ul className="device-picker__list">
            {shown.map((d) => (
              <li key={d.id}>
                <label className={"device-picker__item" + (chosen.includes(d.id) ? " is-on" : "")}>
                  <input type="checkbox" checked={chosen.includes(d.id)} onChange={() => toggle(d)} disabled={!chosen.includes(d.id) && max !== null && chosen.length >= max} />
                  <span>{deviceText(d)}</span>
                  {d.location && <small className="muted">{d.location}</small>}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="button" className="btn btn--primary" disabled={!chosen.length} onClick={done}><Icon name="check" /><span>{fill(t("ui.devices.useChosen"), { n: chosen.length })}</span></button>
        </div>
      </div>
    </Modal>
  );
}

const STATUSES = ["available", "sold", "defective", "lost", "returned_supplier", "removed"];

export function DevicesPage() {
  const { t, lang } = useLanguage();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useApi(`/api/devices?${new URLSearchParams({ q, status })}`);
  const [open, setOpen] = useState(null);
  const rows = list.data?.devices || [];
  return (
    <div className="page">
      <PageHeader icon="smartphone" title={t("app.modules.devices")} />
      <p className="page-help"><Icon name="info" /> {t("ui.devices.help")}</p>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t("ui.devices.searchPh")} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("ui.common.status")}>
          <option value="">{t("ui.common.all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`ui.devices.status.${s}`)}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="smartphone" text={t("ui.common.noResults")} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("ui.common.product")}</th><th>{t("ui.devices.serial")}</th><th>IMEI</th><th>{t("ui.common.status")}</th><th>{t("ui.stock.location")}</th><th>{t("ui.devices.soldOn")}</th><th>{t("ui.common.date")}</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="is-clickable" onClick={() => setOpen(d.id)}>
                  <td><strong>{d.product}</strong></td>
                  <td>{d.serial || "—"}</td>
                  <td>{[d.imei1, d.imei2].filter(Boolean).join(" / ") || "—"}</td>
                  <td><span className={`device-status is-${d.status}`}>{t(`ui.devices.status.${d.status}`)}</span></td>
                  <td>{d.location || "—"}</td>
                  <td>{d.soldRefNo ? `${d.soldRefNo}${d.customer ? ` · ${d.customer}` : ""}` : "—"}</td>
                  <td>{date(d.createdAt, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <DeviceHistory id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DeviceHistory({ id, onClose }) {
  const { t, lang } = useLanguage();
  const d = useApi(`/api/devices/${id}`);
  const dev = d.data?.device;
  const refLink = (e) => (e.refType === "sale" ? `/app/sales/${e.refId}` : e.refType === "invoice" ? `/app/invoices/${e.refId}` : null);
  return (
    <Modal title={dev ? `${dev.product} · ${deviceText(dev)}` : t("ui.common.loading")} onClose={onClose} wide>
      {!d.data ? <Loading /> : (
        <div className="form-grid">
          <dl className="adj-preview">
            <div><dt>{t("ui.common.status")}</dt><dd>{t(`ui.devices.status.${dev.status}`)}</dd></div>
            <div><dt>{t("ui.stock.location")}</dt><dd>{dev.location || "—"}</dd></div>
            <div><dt>{t("ui.common.supplier")}</dt><dd>{[dev.supplier, dev.purchaseNo].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt>{t("ui.devices.soldOn")}</dt><dd>{dev.soldRefNo ? `${dev.soldRefNo}${dev.customer ? ` · ${dev.customer}` : ""}` : "—"}</dd></div>
            {d.data.warranties[0] && <div><dt>{t("app.modules.warranties")}</dt><dd>{fill(t("ui.warranty.until"), { date: date(d.data.warranties[0].endDate, lang) })} · {t(`ui.warranty.status.${d.data.warranties[0].status}`)}</dd></div>}
          </dl>
          <h3 className="panel-card__title"><Icon name="history" />{t("ui.devices.history")}</h3>
          <ul className="timeline">
            {d.data.events.map((e, i) => (
              <li key={i}>
                <strong>{t(`ui.devices.events.${e.event}`)}</strong>
                <small>{date(e.at, lang, true)}{e.location ? ` · ${e.location}` : ""}{e.user ? ` · ${e.user}` : ""}</small>
                {e.note && <span>{e.note}</span>}
                {refLink(e) && <Link to={refLink(e)}>{t("ui.devices.openDoc")}</Link>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* ===================== Warranties ===================== */
const W_STATUSES = ["active", "expired", "under_review", "claim_submitted", "resolved", "rejected", "void"];

export function WarrantiesPage() {
  const { t, lang } = useLanguage();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useApi(`/api/warranties?${new URLSearchParams({ q, status })}`);
  const [open, setOpen] = useState(null);
  const rows = list.data?.warranties || [];
  return (
    <div className="page">
      <PageHeader icon="shield-check" title={t("app.modules.warranties")} />
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t("ui.warranty.searchPh")} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("ui.common.status")}>
          <option value="">{t("ui.common.all")}</option>
          {W_STATUSES.map((s) => <option key={s} value={s}>{t(`ui.warranty.status.${s}`)}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="shield-check" text={t("ui.warranty.empty")} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>{t("ui.common.product")}</th><th>{t("ui.devices.serialImei")}</th><th>{t("ui.common.customer")}</th><th>{t("ui.warranty.doc")}</th><th>{t("ui.warranty.period")}</th><th>{t("ui.common.status")}</th></tr></thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="is-clickable" onClick={() => setOpen(w.id)}>
                  <td>W-{String(w.id).padStart(5, "0")}</td>
                  <td><strong>{w.product}</strong></td>
                  <td>{deviceText(w) || (w.qty > 1 ? `× ${w.qty}` : "—")}</td>
                  <td>{w.customer || "—"}{w.customerPhone && <small className="cell-sub">{w.customerPhone}</small>}</td>
                  <td>{w.refNo}</td>
                  <td>{date(w.startDate, lang)} – {date(w.endDate, lang)}<small className="cell-sub">{fill(t("ui.warranty.months"), { n: w.months })}{w.provider ? ` · ${w.provider}` : ""}</small></td>
                  <td><span className={`warranty-status is-${w.status}`}>{t(`ui.warranty.status.${w.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <WarrantyModal id={open} onClose={() => setOpen(null)} onSaved={() => list.reload()} />}
    </div>
  );
}

function WarrantyModal({ id, onClose, onSaved }) {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const d = useApi(`/api/warranties/${id}`);
  const w = d.data?.warranty;
  const [f, setF] = useState(null);
  useEffect(() => { if (w) setF({ status: w.savedStatus, provider: w.provider, months: w.months, startDate: w.startDate, terms: w.terms, note: "" }); }, [w?.id, d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(`/api/warranties/${id}`, { method: "PUT", body: f }))) { d.reload(); onSaved(); setF((x) => ({ ...x, note: "" })); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const FIELD = { status: t("ui.common.status"), provider: t("ui.warranty.provider"), months: t("ui.warranty.duration"), startDate: t("ui.warranty.start"), terms: t("ui.warranty.terms") };
  const show = (field, v) => (field === "status" ? t(`ui.warranty.status.${v}`) : field === "startDate" ? date(v, lang) : v || "—");
  return (
    <Modal title={w ? `W-${String(w.id).padStart(5, "0")} · ${w.product}` : t("ui.common.loading")} onClose={onClose} wide>
      {!w || !f ? <Loading /> : (
        <div className="form-grid">
          <dl className="adj-preview">
            <div><dt>{t("ui.devices.serialImei")}</dt><dd>{deviceText(w) || "—"}</dd></div>
            <div><dt>{t("ui.common.customer")}</dt><dd>{w.customer || "—"}</dd></div>
            <div><dt>{t("ui.warranty.doc")}</dt><dd><Link to={w.refType === "sale" ? `/app/sales/${w.refId}` : `/app/invoices/${w.refId}`}>{w.refNo}</Link></dd></div>
            <div><dt>{t("ui.warranty.period")}</dt><dd>{date(w.startDate, lang)} – {date(w.endDate, lang)}</dd></div>
            <div><dt>{t("ui.common.status")}</dt><dd><span className={`warranty-status is-${w.status}`}>{t(`ui.warranty.status.${w.status}`)}</span></dd></div>
          </dl>
          {can("sales.create") && w.savedStatus !== "void" && (
            <form onSubmit={save} className="form-grid form-grid--2 panel-card">
              <Field label={t("ui.common.status")}>
                <select className="input" value={f.status} onChange={set("status")}>{W_STATUSES.filter((s) => s !== "expired").map((s) => <option key={s} value={s}>{t(`ui.warranty.status.${s}`)}</option>)}</select>
              </Field>
              <Field label={t("ui.warranty.provider")}><input className="input" value={f.provider} onChange={set("provider")} placeholder={t("ui.warranty.providerPh")} /></Field>
              <Field label={t("ui.warranty.duration")} error={sub.fieldErrors.months}><input className="input" type="number" min="1" max="240" value={f.months} onChange={set("months")} /></Field>
              <Field label={t("ui.warranty.start")} error={sub.fieldErrors.startDate}><input className="input" type="date" value={f.startDate} onChange={set("startDate")} /></Field>
              <Field label={t("ui.warranty.terms")} full><input className="input" value={f.terms} onChange={set("terms")} /></Field>
              <Field label={`${t("ui.warranty.note")} ${t("ui.common.optional")}`} full><input className="input" value={f.note} onChange={set("note")} placeholder={t("ui.warranty.notePh")} /></Field>
              <FormError error={sub.formError} />
              <div className="form-actions ff--full"><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
            </form>
          )}
          <h3 className="panel-card__title"><Icon name="history" />{t("ui.warranty.history")}</h3>
          <ul className="timeline">
            {d.data.history.map((h, i) => (
              <li key={i}>
                <strong>{h.changes.length ? h.changes.map((c) => `${FIELD[c.field] || c.field}: ${show(c.field, c.from)} → ${show(c.field, c.to)}`).join(" · ") : h.note === "created" ? t("ui.warranty.created") : t("ui.warranty.noteOnly")}</strong>
                <small>{date(h.at, lang, true)}{h.user ? ` · ${h.user}` : ""}</small>
                {h.note && h.note !== "created" && <span>{h.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
