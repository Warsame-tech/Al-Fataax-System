import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, Money, EmptyState, Loading, SearchBox, PaymentFields, StatusBadge, DateRange, daysAgo, isoDate } from "../ui.jsx";
import LineItems from "./LineItems.jsx";
import { date, fill } from "../format.js";
import SearchSelect from "../SearchSelect.jsx";

const STATUSES = ["", "unpaid", "partially_paid", "overdue", "paid", "cancelled"];

export default function Invoices() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const [range, setRange] = useState({ from: daysAgo(89), to: isoDate(new Date()) });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useApi(`/api/invoices?${new URLSearchParams({ ...range, q, status })}`);
  const rows = list.data?.invoices || [];

  return (
    <div className="page">
      <PageHeader icon="receipt" title={t("ui.invoices.title")} actions={
        can("invoices.create") && <Link className="btn btn--primary" to="/app/invoices/new"><Icon name="plus" /><span>{t("ui.invoices.new")}</span></Link>
      } />
      <div className="toolbar">
        <DateRange value={range} onChange={setRange} />
        <SearchBox value={q} onChange={setQ} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("ui.common.status")}>
          {STATUSES.map((s) => <option key={s} value={s}>{s ? t(`ui.status.${s}`) : t("ui.common.all")}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="receipt" text={t("ui.invoices.empty")} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>{t("ui.common.customer")}</th><th>{t("ui.invoices.issueDate")}</th><th>{t("ui.invoices.dueDate")}</th><th className="num">{t("ui.common.total")}</th><th className="num">{t("ui.common.balance")}</th><th>{t("ui.common.status")}</th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td><Link to={`/app/invoices/${i.id}`}>{i.number}</Link></td>
                  <td>{i.customer}</td>
                  <td>{date(i.issueDate, lang)}</td>
                  <td>{date(i.dueDate, lang)}</td>
                  <td className="num"><Money value={i.total} /></td>
                  <td className="num"><Money value={i.balance} className={i.balance > 0 ? "is-pos" : ""} /></td>
                  <td><StatusBadge status={i.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* Discount typed as an amount ("5") or a percentage ("10%"); empty = none. Mirrors the server rule. */
function discountOf(value, subtotal) {
  const raw = String(value || "").trim().replace(",", ".");
  if (!raw) return { amount: 0 };
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(raw);
  if (pct) return Number(pct[1]) <= 100 ? { amount: Math.round(subtotal * Number(pct[1])) / 100, percent: Number(pct[1]) } : { error: true };
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? { amount: Math.round(n * 100) / 100 } : { error: true };
}

export function InvoiceForm() {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const navigate = useNavigate();
  const customers = useApi("/api/customers");
  const [f, setF] = useState({ customerId: "", billPhone: "", billAddress: "", priceList: "wholesale", issueDate: isoDate(new Date()), dueDate: isoDate(new Date(Date.now() + 14 * 86400000)), discount: "", discountLabel: "", notes: "", amountPaid: "", method: "cash", bankAccountId: "" });
  const [lines, setLines] = useState([]);
  const [newCustomer, setNewCustomer] = useState(null);   // typed name for the "New customer" form
  const sub = useSubmit();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const list = customers.data?.customers || [];

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const disc = discountOf(f.discount, subtotal);
  const total = Math.max(0, subtotal - (disc.amount || 0));
  const allowPrice = can("sales.discount");

  /* choosing a customer fills their business phone and address (editable for this invoice) */
  const pickCustomer = (cid, fromList = list) => {
    const c = fromList.find((x) => String(x.id) === String(cid));
    setF((x) => ({ ...x, customerId: cid, billPhone: c?.phone || "", billAddress: c?.address || "" }));
  };
  const changePriceList = (pl) => {
    setF((x) => ({ ...x, priceList: pl }));
    setLines((ls) => ls.map((l) => ({ ...l, price: pl === "wholesale" && l.product.wholesalePrice !== null ? l.product.wholesalePrice : l.product.sellingPrice })));
  };

  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, items: lines.map((l) => ({ productId: l.product.id, qty: l.qty, ...(allowPrice ? { unitPrice: l.price } : {}) })) };
    const r = await sub.run(() => apiRequest("/api/invoices", { method: "POST", body }));
    if (r) navigate(`/app/invoices/${r.id}`, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader icon="receipt" title={t("ui.invoices.new")} back="/app/m/invoices" />
      <form onSubmit={save} className="doc-form">
        <section className="panel-card form-grid form-grid--3">
          <div className="ff">
            <span className="ff__label">{t("ui.common.customer")}</span>
            <SearchSelect value={f.customerId} onChange={(v) => pickCustomer(v)} placeholder={t("ui.invoices.chooseCustomer")} searchPlaceholder={t("ui.invoices.searchCustomer")}
              options={list.map((c) => ({ value: c.id, label: c.name, sub: [c.phone, c.address].filter(Boolean).join(" · ") }))}
              onCreate={can("customers.edit") ? (text) => setNewCustomer(text) : undefined} createLabel={t("ui.invoices.newCustomer")} invalid={Boolean(sub.fieldErrors.customerId)} />
            {sub.fieldErrors.customerId && <span className="ff__error">{t("ui.errors.required")}</span>}
          </div>
          <Field label={t("ui.invoices.issueDate")}><input className="input" type="date" value={f.issueDate} onChange={set("issueDate")} /></Field>
          <Field label={t("ui.invoices.dueDate")} error={sub.fieldErrors.dueDate}><input className="input" type="date" value={f.dueDate} min={f.issueDate} onChange={set("dueDate")} /></Field>
          <Field label={`${t("ui.invoices.businessPhone")} ${t("ui.common.optional")}`}><input className="input" type="tel" value={f.billPhone} onChange={set("billPhone")} placeholder={t("ui.invoices.phonePh")} /></Field>
          <Field label={`${t("ui.invoices.businessAddress")} ${t("ui.common.optional")}`}><input className="input" value={f.billAddress} onChange={set("billAddress")} placeholder={t("ui.invoices.addressPh")} /></Field>
          <Field label={t("ui.invoices.priceList")}>
            <div className="seg">{["retail", "wholesale"].map((pl) => <button key={pl} type="button" aria-pressed={f.priceList === pl} onClick={() => changePriceList(pl)}>{t(`ui.invoices.${pl}`)}</button>)}</div>
          </Field>
        </section>

        <section className="panel-card">
          <LineItems lines={lines} onChange={setLines} mode="sell" priceList={f.priceList} allowPrice={allowPrice} errors={sub.fieldErrors} />
        </section>

        <section className="panel-card form-grid form-grid--2">
          <Field label={`${t("ui.common.discount")} ${t("ui.common.optional")}`} error={sub.fieldErrors.discount === "invalidDiscount" ? undefined : sub.fieldErrors.discount}
            hint={!allowPrice ? t("ui.pos.noDiscount") : disc.error ? null : disc.percent !== undefined ? fill(t("ui.invoices.discountIs"), { amount: m(disc.amount) }) : t("ui.invoices.discountHint")}>
            <input className={"input" + (disc.error ? " has-error" : "")} value={f.discount} disabled={!allowPrice} onChange={set("discount")} placeholder={t("ui.invoices.discountPh")} inputMode="decimal" />
          </Field>
          <Field label={`${t("ui.invoices.discountLabel")} ${t("ui.common.optional")}`}>
            <input className="input" value={f.discountLabel} disabled={!allowPrice || !f.discount} onChange={set("discountLabel")} placeholder={t("ui.invoices.discountLabelPh")} maxLength={80} />
          </Field>
          {(disc.error || sub.fieldErrors.discount === "invalidDiscount") && <p className="form-status form-status--error ff--full">{t("ui.errors.invalidDiscount")}</p>}
          <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={set("notes")} /></Field>
          <Field label={t("ui.invoices.payNow")} error={sub.fieldErrors.amountPaid}><input className="input" type="number" min="0" step="0.01" max={total} value={f.amountPaid} onChange={set("amountPaid")} /></Field>
          {Number(f.amountPaid) > 0 && <div className="ff--full"><PaymentFields method={f.method} onMethod={(v) => setF((x) => ({ ...x, method: v }))} bankId={f.bankAccountId} onBank={(v) => setF((x) => ({ ...x, bankAccountId: v }))} errors={sub.fieldErrors} /></div>}
        </section>

        <div className="doc-form__bar">
          <dl className="pos__totals pos__totals--inline">
            <div><dt>{t("ui.common.subtotal")}</dt><dd>{m(subtotal)}</dd></div>
            {disc.amount > 0 && <div><dt>{t("ui.common.discount")}</dt><dd>− {m(disc.amount)}</dd></div>}
            <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(total)}</dd></div>
            <div><dt>{t("ui.common.balance")}</dt><dd>{m(Math.max(0, total - (Number(f.amountPaid) || 0)))}</dd></div>
          </dl>
          <FormError error={sub.formError} />
          <button type="submit" className="btn btn--primary btn--lg" disabled={sub.busy || !lines.length || disc.error}><Icon name="check" /><span>{t("ui.invoices.create")}</span></button>
        </div>
      </form>
      {newCustomer !== null && (
        <NewCustomerForm name={newCustomer} onClose={() => setNewCustomer(null)} onSaved={async (created) => {
          setNewCustomer(null);
          const d = await customers.reload();
          const fresh = d?.customers || [...list, created];
          pickCustomer(created.id, fresh.some((c) => c.id === created.id) ? fresh : [...fresh, created]);
        }} />
      )}
    </div>
  );
}

/* Register a customer without leaving the invoice. */
function NewCustomerForm({ name, onClose, onSaved }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ name: name || "", phone: "", address: "", email: "" });
  const sub = useSubmit();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const r = await sub.run(() => apiRequest("/api/customers", { method: "POST", body: f }));
    if (r) onSaved({ id: r.id, ...f, balance: 0, overdue: 0 });
  };
  return (
    <Modal title={t("ui.invoices.newCustomer")} onClose={onClose}>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.name")} error={sub.fieldErrors.name} full><input className="input" value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label={`${t("ui.invoices.businessPhone")} ${t("ui.common.optional")}`}><input className="input" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={`${t("ui.common.email")} ${t("ui.common.optional")}`} error={sub.fieldErrors.email}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={`${t("ui.invoices.businessAddress")} ${t("ui.common.optional")}`} full><input className="input" value={f.address} onChange={set("address")} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t(sub.busy ? "ui.common.saving" : "ui.invoices.saveCustomer")}</button>
        </div>
      </form>
    </Modal>
  );
}
