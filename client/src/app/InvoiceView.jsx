import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { apiRequest, fileUrl } from "../services/api.js";
import usePageTitle from "../hooks/usePageTitle.js";
import { money, qty, date } from "./format.js";
import { usePerm, ReasonModal } from "./ui.jsx";
import { PaymentModal } from "./pages/Parties.jsx";

/*
 * Printable invoice (Print / Save as PDF from the browser).
 *   /app/invoices/:id      → a real invoice of the signed-in business (GET /api/invoices/:id)
 *   /app/invoices/preview  → layout preview with the business's real details and
 *                            clearly-labelled SAMPLE lines (no real figures).
 * "Powered by Faatix" is shown in the footer.
 */
export default function InvoiceView({ preview = false }) {
  const { id } = useParams();
  const { t, lang } = useLanguage();
  const { business } = useAuth();
  usePageTitle("meta.app");
  const [state, setState] = useState({ status: preview ? "ready" : "loading", data: null });
  const [modal, setModal] = useState(null);
  const [version, setVersion] = useState(0);
  const can = usePerm();

  useEffect(() => {
    if (preview) return;
    apiRequest(`/api/invoices/${id}`)
      .then((data) => setState({ status: "ready", data }))
      .catch(() => setState({ status: "notFound", data: null }));
  }, [id, preview, version]);

  if (state.status === "loading") return <div className="app-loading" role="status"><span className="app-spinner" /></div>;
  if (state.status === "notFound") {
    return (
      <div className="module-page">
        <Link className="auth__back" to="/app"><Icon name="arrow-left" /><span>{t("app.coming.back")}</span></Link>
        <div className="module-page__card"><h1>{t("invoice.notFound")}</h1></div>
      </div>
    );
  }

  const data = preview ? samplePreview(business, t) : state.data;
  const biz = data.business;
  const inv = data.invoice;
  const cur = biz.currency || "USD";
  const m = (v) => money(v, cur, lang);

  return (
    <div className="invoice-page">
      <div className="invoice-toolbar no-print">
        <Link className="auth__back" to="/app/m/invoices"><Icon name="arrow-left" /><span>{t("invoice.back")}</span></Link>
        <div className="form-actions">
          {!preview && can("invoices.cancel") && inv.status !== "cancelled" && inv.paid === 0 && (
            <button type="button" className="btn btn--danger" onClick={() => setModal("cancel")}><Icon name="x" /><span>{t("ui.invoices.cancelInvoice")}</span></button>
          )}
          {!preview && can("payments.receive") && ["unpaid", "partially_paid", "overdue"].includes(inv.status) && inv.balance > 0 && (
            <button type="button" className="btn btn--navy" onClick={() => setModal("pay")}><Icon name="wallet" /><span>{t("ui.invoices.recordPayment")}</span></button>
          )}
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            <Icon name="printer" /><span>{t("invoice.print")}</span>
          </button>
        </div>
      </div>

      {preview && <p className="invoice-sample no-print" role="note"><Icon name="info" />{t("invoice.sample")}</p>}

      <article className="invoice" aria-label={`${t("invoice.title")} ${inv.number}`}>
        {preview && <span className="invoice__watermark" aria-hidden="true">SAMPLE</span>}
        <div className="invoice__bar" aria-hidden="true" />

        {/* business: logo above the name, centred */}
        <header className="invoice__brand">
          {biz.logoPath && <img className="invoice__brand-logo" src={fileUrl(biz.logoPath)} alt="" />}
          <strong className="invoice__brand-name">{biz.name}</strong>
          <p className="invoice__brand-lines">
            {[biz.address, biz.phone, biz.email].filter(Boolean).map((v, i) => <span key={i} dir={v === biz.phone ? "ltr" : undefined}>{v}</span>)}
          </p>
        </header>

        <div className="invoice__titlebar invoice__titlebar--center">
          <h1>{t("invoice.title")}</h1>
          <span className={`invoice__status invoice__status--${inv.status}`}>{t(`invoice.statuses.${inv.status}`)}</span>
        </div>

        <section className="invoice__meta">
          <div className="invoice__to">
            <small>{t("invoice.billTo")}</small>
            <strong>{inv.customer.name}</strong>
            {inv.customer.address && <span>{inv.customer.address}</span>}
            {inv.customer.phone && <span dir="ltr">{inv.customer.phone}</span>}
            {inv.customer.email && <span>{inv.customer.email}</span>}
          </div>
          <dl className="invoice__facts">
            <div><dt>{t("invoice.number")}</dt><dd>{inv.number}</dd></div>
            <div><dt>{t("invoice.issueDate")}</dt><dd>{date(inv.issueDate, lang)}</dd></div>
            <div><dt>{t("invoice.dueDate")}</dt><dd>{date(inv.dueDate, lang)}</dd></div>
          </dl>
        </section>

        <table className="invoice__table">
          <thead>
            <tr>
              <th>#</th><th>{t("invoice.item")}</th><th className="num">{t("invoice.qty")}</th>
              <th className="num">{t("invoice.price")}</th><th className="num">{t("invoice.discount")}</th><th className="num">{t("invoice.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{it.name}{it.sku && <small>{it.sku}</small>}</td>
                <td className="num">{qty(it.qty)}</td>
                <td className="num">{m(it.unitPrice)}</td>
                <td className="num">{it.discount ? m(it.discount) : "—"}</td>
                <td className="num">{m(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="invoice__bottom">
          <div className="invoice__notes">
            {data.payments.length > 0 && (
              <>
                <small>{t("invoice.payments")}</small>
                <ul>
                  {data.payments.map((p, i) => (
                    <li key={i}>{date(p.at, lang)} · {t(`invoice.methods.${p.method}`)}{p.reference ? ` · ${p.reference}` : ""} — <strong>{m(p.amount)}</strong></li>
                  ))}
                </ul>
              </>
            )}
            {inv.notes && (<><small>{t("invoice.notes")}</small><p>{inv.notes}</p></>)}
            <p className="invoice__thanks">{biz.invoiceFooter || t("invoice.thanks")}</p>
          </div>
          <dl className="invoice__totals">
            <div><dt>{t("invoice.subtotal")}</dt><dd>{m(inv.subtotal)}</dd></div>
            {inv.discount > 0 && <div><dt>{t("invoice.discount")}{inv.discountLabel ? ` (${inv.discountLabel})` : ""}</dt><dd>− {m(inv.discount)}</dd></div>}
            <div className="is-total"><dt>{t("invoice.total")}</dt><dd>{m(inv.total)}</dd></div>
            <div><dt>{t("invoice.paid")}</dt><dd>{m(inv.paid)}</dd></div>
            <div className="is-balance"><dt>{t("invoice.balance")}</dt><dd>{m(inv.balance)}</dd></div>
          </dl>
        </section>

        {/* signature and company stamp */}
        <section className="invoice__sign">
          <div className="invoice__sign-box">
            <span className="invoice__sign-line" />
            <small>{t("invoice.signature")}</small>
          </div>
          <div className="invoice__sign-box">
            <span className="invoice__stamp" aria-hidden="true">{t("invoice.stampHere")}</span>
            <small>{t("invoice.stamp")}</small>
          </div>
        </section>

        <footer className="invoice__foot">
          <img src="/favicon.png" alt="" width="20" height="20" />
          <span>{t("invoice.poweredBy")}</span>
        </footer>
      </article>

      {modal === "pay" && <PaymentModal url={`/api/invoices/${inv.id}/payments`} max={inv.balance} title={t("ui.invoices.recordPayment")} onClose={() => setModal(null)} onSaved={() => { setModal(null); setVersion((v) => v + 1); }} />}
      {modal === "cancel" && <ReasonModal title={t("ui.invoices.cancelInvoice")} help={t("ui.invoices.cancelHelp")} confirmLabel={t("ui.invoices.cancelInvoice")}
        onConfirm={(reason) => apiRequest(`/api/invoices/${inv.id}/cancel`, { method: "POST", body: { reason } }).then(() => setVersion((v) => v + 1))} onClose={() => setModal(null)} />}
    </div>
  );
}

/* Layout preview: real business details, clearly-marked sample lines. */
function samplePreview(business, t) {
  const items = [
    { name: t("invoice.sampleItem1"), sku: "SAMPLE-1", qty: 10, unitPrice: 12.5, discount: 0, total: 125 },
    { name: t("invoice.sampleItem2"), sku: "SAMPLE-2", qty: 4, unitPrice: 30, discount: 10, total: 110 },
    { name: t("invoice.sampleItem3"), sku: "SAMPLE-3", qty: 25, unitPrice: 2, discount: 0, total: 50 }
  ];
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return {
    business: business || {},
    invoice: {
      number: `${business?.invoicePrefix || "INV-"}SAMPLE`, issueDate: today, dueDate: due, status: "partially_paid",
      subtotal, discount: 0, total: subtotal, paid: 100, balance: subtotal - 100, notes: null,
      customer: { name: t("invoice.sampleCustomer"), phone: null, email: null, address: null }
    },
    items,
    payments: []
  };
}
