/*
 * Shared building blocks for the business application screens.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { apiRequest } from "../services/api.js";
import { fill, money } from "./format.js";

/* ---------- data ---------- */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try { const data = await apiRequest(path); setState({ data, error: null, loading: false }); return data; }
    catch (err) { setState({ data: null, error: err, loading: false }); return null; }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export function usePerm() {
  const { permissions = [] } = useAuth();
  return (perm) => permissions.includes(perm);
}

export function useMoney() {
  const { lang } = useLanguage();
  const { business } = useAuth();
  return (v) => money(v, business?.currency || "USD", lang);
}

/** Translates an API error code (with extra details) into a message. */
export function useErrorText() {
  const { t } = useLanguage();
  return (err) => {
    if (!err) return null;
    const code = typeof err === "string" ? err : err.code;
    if (code === "insufficientStock") return fill(t("ui.errors.insufficientStock"), { product: err.data?.product, available: err.data?.available });
    const msg = t(`ui.errors.${code}`);
    return msg.startsWith("ui.errors.") ? t("ui.errors.failed") : fill(msg, (typeof err === "object" && err.data) || {});
  };
}

/** Form submission with field errors, a form-level error and a busy flag. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true); setFormError(null); setFieldErrors({});
    try { const r = await fn(); return r ?? true; }
    catch (err) {
      if (err.errors) setFieldErrors(err.errors);
      setFormError(err);
      return false;
    } finally { setBusy(false); }
  }, []);
  return { busy, fieldErrors, formError, run, setFieldErrors, setFormError };
}

/* ---------- layout ---------- */
export function PageHeader({ icon, title, actions, back = "/app" }) {
  const { t } = useLanguage();
  return (
    <header className="page-head">
      <div className="page-head__left">
        {back && <Link className="page-head__back" to={back} aria-label={t("ui.common.back")}><Icon name="arrow-left" /></Link>}
        {icon && <span className="page-head__icon"><Icon name={icon} /></span>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.id} type="button" role="tab" aria-selected={value === tb.id} className={value === tb.id ? "is-active" : ""} onClick={() => onChange(tb.id)}>
          {tb.icon && <Icon name={tb.icon} />}{tb.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector("input, select, textarea, button");
    first?.focus();
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"modal__box" + (wide ? " modal__box--wide" : "")} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, error, hint, children, full = false }) {
  const { t } = useLanguage();
  return (
    <label className={"ff" + (full ? " ff--full" : "") + (error ? " has-error" : "")}>
      <span className="ff__label">{label}</span>
      {children}
      {error ? <span className="ff__error">{t(`ui.errors.${error}`).startsWith("ui.") ? t("ui.errors.required") : t(`ui.errors.${error}`)}</span>
        : hint ? <span className="ff__hint">{hint}</span> : null}
    </label>
  );
}

export function FormError({ error }) {
  const errText = useErrorText();
  if (!error) return null;
  return <p className="form-status form-status--error" role="alert">{errText(error.code === "validation" && error.errors ? "validation" : error)}</p>;
}

export function Money({ value, className = "" }) {
  const m = useMoney();
  return <span className={"money " + className}>{m(value)}</span>;
}

export function StatusBadge({ status }) {
  const { t } = useLanguage();
  return <span className={`badge-status badge-status--${status}`}>{t(`ui.status.${status}`)}</span>;
}

export function EmptyState({ icon = "info", text, action }) {
  return (
    <div className="empty">
      <span className="empty__icon"><Icon name={icon} /></span>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Loading() {
  return <div className="app-loading app-loading--inline" role="status"><span className="app-spinner" /></div>;
}

export function SearchBox({ value, onChange, placeholder }) {
  const { t } = useLanguage();
  return (
    <div className="search-box">
      <Icon name="search-glass" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || t("ui.common.searchPh")} aria-label={t("ui.common.search")} />
    </div>
  );
}

export const isoDate = (d) => d.toISOString().slice(0, 10);
export const daysAgo = (n) => isoDate(new Date(Date.now() - n * 86400000));

export function DateRange({ value, onChange }) {
  const { t } = useLanguage();
  return (
    <div className="date-range">
      <label><span>{t("ui.common.from")}</span><input type="date" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
      <label><span>{t("ui.common.to")}</span><input type="date" value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
    </div>
  );
}

/** Payment method selector (+ bank account when "bank"). */
export function PaymentFields({ method, onMethod, bankId, onBank, errors = {}, allowCredit = false, label }) {
  const { t } = useLanguage();
  const banks = useApi("/api/accounts/banks");
  const methods = ["cash", "mobile_money", "bank", ...(allowCredit ? ["credit"] : [])];
  return (
    <>
      <Field label={label || t("ui.common.method")} error={errors.method || errors.paymentMethod}>
        <div className="seg">
          {methods.map((m) => (
            <button key={m} type="button" aria-pressed={method === m} onClick={() => onMethod(m)}>{t(`ui.methods.${m}`)}</button>
          ))}
        </div>
      </Field>
      {method === "bank" && (
        <Field label={t("ui.common.bankAccount")} error={errors.bankAccountId} hint={banks.data?.banks?.length === 0 ? t("ui.common.noBank") : null}>
          <select className="input" value={bankId || ""} onChange={(e) => onBank(e.target.value)}>
            <option value="">{t("ui.common.choose")}</option>
            {(banks.data?.banks || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      )}
    </>
  );
}

/** Asks for a reason, then calls onConfirm(reason). */
export function ReasonModal({ title, help, confirmLabel, onConfirm, onClose, danger = true }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");
  const sub = useSubmit();
  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { sub.setFieldErrors({ reason: "required" }); return; }
    if (await sub.run(() => onConfirm(reason.trim()))) onClose();
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        {help && <p className="modal__help">{help}</p>}
        <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason} full>
          <textarea className="input" rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ui.common.reasonPh")} />
        </Field>
        <FormError error={sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.close")}</button>
          <button type="submit" className={"btn " + (danger ? "btn--danger" : "btn--primary")} disabled={sub.busy}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Downloads rows as a CSV file (opens in Excel). */
export function downloadCsv(filename, headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Minimal CSV parser (quoted fields, commas, CRLF). */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}
