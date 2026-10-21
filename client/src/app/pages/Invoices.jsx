import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, useMoney, Field, FormError, Money, EmptyState, Loading, SearchBox, PaymentFields, StatusBadge, DateRange, daysAgo, isoDate } from "../ui.jsx";
import LineItems from "./LineItems.jsx";
import { date } from "../format.js";

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

export function InvoiceForm() {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const navigate = useNavigate();
  const customers = useApi("/api/customers");
  const [f, setF] = useState({ customerId: "", priceList: "wholesale", issueDate: isoDate(new Date()), dueDate: isoDate(new Date(Date.now() + 14 * 86400000)), discount: "", notes: "", amountPaid: "", method: "cash", bankAccountId: "" });
  const [lines, setLines] = useState([]);
  const sub = useSubmit();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const total = Math.max(0, subtotal - (Number(f.discount) || 0));
  const allowPrice = can("sales.discount");

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
          <Field label={t("ui.common.customer")} error={sub.fieldErrors.customerId}>
            <select className="input" value={f.customerId} onChange={set("customerId")}>
              <option value="">{t("ui.common.choose")}</option>
              {(customers.data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={t("ui.invoices.issueDate")}><input className="input" type="date" value={f.issueDate} onChange={set("issueDate")} /></Field>
          <Field label={t("ui.invoices.dueDate")} error={sub.fieldErrors.dueDate}><input className="input" type="date" value={f.dueDate} min={f.issueDate} onChange={set("dueDate")} /></Field>
          <Field label={t("ui.invoices.priceList")} full>
            <div className="seg">{["retail", "wholesale"].map((pl) => <button key={pl} type="button" aria-pressed={f.priceList === pl} onClick={() => changePriceList(pl)}>{t(`ui.invoices.${pl}`)}</button>)}</div>
          </Field>
        </section>

        <section className="panel-card">
          <LineItems lines={lines} onChange={setLines} mode="sell" priceList={f.priceList} allowPrice={allowPrice} errors={sub.fieldErrors} />
        </section>

        <section className="panel-card form-grid form-grid--2">
          <Field label={t("ui.common.discount")} error={sub.fieldErrors.discount} hint={!allowPrice ? t("ui.pos.noDiscount") : null}>
            <input className="input" type="number" min="0" step="0.01" value={f.discount} disabled={!allowPrice} onChange={set("discount")} />
          </Field>
          <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={set("notes")} /></Field>
          <Field label={t("ui.invoices.payNow")} error={sub.fieldErrors.amountPaid}><input className="input" type="number" min="0" step="0.01" max={total} value={f.amountPaid} onChange={set("amountPaid")} /></Field>
          {Number(f.amountPaid) > 0 && <div><PaymentFields method={f.method} onMethod={(v) => setF((x) => ({ ...x, method: v }))} bankId={f.bankAccountId} onBank={(v) => setF((x) => ({ ...x, bankAccountId: v }))} errors={sub.fieldErrors} /></div>}
        </section>

        <div className="doc-form__bar">
          <dl className="pos__totals pos__totals--inline">
            <div><dt>{t("ui.common.subtotal")}</dt><dd>{m(subtotal)}</dd></div>
            <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(total)}</dd></div>
            <div><dt>{t("ui.common.balance")}</dt><dd>{m(Math.max(0, total - (Number(f.amountPaid) || 0)))}</dd></div>
          </dl>
          <FormError error={sub.formError} />
          <button type="submit" className="btn btn--primary btn--lg" disabled={sub.busy || !lines.length}><Icon name="check" /><span>{t("ui.invoices.create")}</span></button>
        </div>
      </form>
    </div>
  );
}
