import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { useApi, usePerm, useMoney, Loading, EmptyState, ReasonModal, StatusBadge } from "../ui.jsx";
import { qty, date, fill } from "../format.js";
import { savePdf } from "../pdf.js";

const PAPER_KEY = "faatix.receiptPaper";

/*
 * Printable POS receipt for thermal printers (58 mm or 80 mm paper), black and white.
 * Everything comes from the saved sale (GET /api/sales/:id) and the business settings:
 * header (logo, name, address, phone, email) · sale details · items · totals · payments · footer.
 */
export default function Receipt() {
  const { id } = useParams();
  const { t, lang } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const r = useApi(`/api/sales/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const sheetRef = useRef(null);
  const [paper, setPaper] = useState(() => { try { return localStorage.getItem(PAPER_KEY) === "58" ? "58" : "80"; } catch { return "80"; } });
  const choosePaper = (v) => { setPaper(v); try { localStorage.setItem(PAPER_KEY, v); } catch { /* optional */ } };

  // printer page size follows the chosen paper width
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-receipt-page", "");
    style.textContent = `@media print { @page { size: ${paper}mm auto; margin: 0; } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [paper]);

  /* PDF the same width as the receipt paper (58 / 80 mm), as long as the receipt */
  const exportPdf = async () => {
    if (savingPdf) return;
    setSavingPdf(true);
    try { await savePdf(sheetRef.current, `${r.data.sale.number}.pdf`, { paperWidth: Number(paper) }); }
    finally { setSavingPdf(false); }
  };

  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <EmptyState text={t("ui.errors.notFound")} />;
  const { business: b, sale: s, items, payments } = r.data;
  const paid = payments.filter((p) => p.amount > 0);
  const refunds = payments.filter((p) => p.amount < 0);
  const amountPaid = Math.round(paid.reduce((t2, p) => t2 + p.amount, 0) * 10000) / 10000;
  const tendered = Math.round((amountPaid + (s.change || 0)) * 10000) / 10000;
  const discountPct = s.discount > 0 && s.subtotal > 0 ? Math.round((s.discount / s.subtotal) * 1000) / 10 : 0;
  const itemCount = items.reduce((t2, i) => t2 + i.qty, 0);

  return (
    <div className="invoice-page receipt-page">
      <div className="invoice-toolbar no-print">
        <Link className="auth__back" to="/app/m/pos?tab=history"><Icon name="arrow-left" /><span>{t("ui.common.back")}</span></Link>
        <div className="form-actions">
          <div className="seg" role="group" aria-label={t("ui.receipt.paper")}>
            {["58", "80"].map((w) => <button key={w} type="button" aria-pressed={paper === w} onClick={() => choosePaper(w)}>{w} mm</button>)}
          </div>
          {can("sales.cancel") && s.status === "completed" && <button type="button" className="btn btn--danger" onClick={() => setCancelling(true)}><Icon name="x" /><span>{t("ui.pos.cancelSale")}</span></button>}
          <button type="button" className="btn btn--outline" onClick={() => window.print()}><Icon name="printer" /><span>{t("invoice.printOnly")}</span></button>
          <button type="button" className="btn btn--primary" onClick={exportPdf} disabled={savingPdf}><Icon name="download" /><span>{t(savingPdf ? "invoice.savingPdf" : "invoice.savePdf")}</span></button>
        </div>
      </div>

      <article ref={sheetRef} className={`thermal thermal--${paper}`} aria-label={`${t("ui.pos.receipt")} ${s.number}`}>
        {/* header */}
        <header className="thermal__head">
          {b.logoPath && <img className="thermal__logo" src={fileUrl(b.logoPath)} alt="" />}
          <h1>{b.name}</h1>
          {b.address && <p>{b.address}</p>}
          {b.phone && <p dir="ltr">{t("ui.common.phone")}: {b.phone}</p>}
          {b.email && <p>{t("ui.common.email")}: {b.email}</p>}
        </header>

        {/* sale details */}
        <section className="thermal__info">
          <p className="thermal__no">{t("ui.receipt.receipt")}: {s.number}</p>
          <p>{t("ui.common.date")}: {date(s.at, lang, true)}</p>
          <p>{t("ui.receipt.servedBy")}: {s.cashier}</p>
          {s.customer && <p>{t("ui.common.customer")}: {s.customer.name}{s.customer.phone ? ` · ${s.customer.phone}` : ""}</p>}
          {s.status !== "completed" && <p className="thermal__status"><StatusBadge status={s.status} /></p>}
        </section>

        {/* items */}
        <div className="thermal__items" role="table">
          <div className="thermal__row thermal__row--head" role="row">
            <span role="columnheader">{t("ui.receipt.item")}</span>
            <span role="columnheader" className="num">{t("ui.common.qty")}</span>
            <span role="columnheader" className="num">{t("ui.common.price")}</span>
            <span role="columnheader" className="num">{t("ui.common.total")}</span>
          </div>
          {items.map((i, k) => (
            <div key={k} className="thermal__row" role="row">
              <span role="cell" className="thermal__name">{i.name}</span>
              <span role="cell" className="num">{qty(i.qty)}{i.unit ? ` ${i.unit}` : ""}</span>
              <span role="cell" className="num">{m(i.unitPrice)}</span>
              <span role="cell" className="num">{m(i.total)}</span>
            </div>
          ))}
        </div>

        {/* totals */}
        <dl className="thermal__totals">
          <div><dt>{t("ui.receipt.items")} ({qty(itemCount)})</dt><dd /></div>
          <div><dt>{t("ui.common.subtotal")}:</dt><dd>{m(s.subtotal)}</dd></div>
          {s.discount > 0 && <div><dt>{t("ui.receipt.totalDiscount")}{discountPct ? ` (${discountPct}%)` : ""}:</dt><dd>−{m(s.discount)}</dd></div>}
          {s.vat > 0 && <div><dt>{fill(t("ui.pos.vatLine"), { rate: s.vatRate })}:</dt><dd>{m(s.vat)}</dd></div>}
          <div className="is-total"><dt>{t("ui.common.total")}:</dt><dd>{m(s.total)}</dd></div>
        </dl>

        {/* payments */}
        <section className="thermal__pay">
          <p className="thermal__label">{t("ui.receipt.payments")}:</p>
          {paid.length === 0 && <div className="thermal__line"><span>{t("ui.methods.credit")}</span><span>{m(0)}</span></div>}
          {paid.map((p, k) => <div key={k} className="thermal__line"><span>{p.label || t(`ui.methods.${p.method}`)}</span><span>{m(p.amount)}</span></div>)}
          {s.change > 0 && <div className="thermal__line"><span>{t("ui.receipt.tendered")}</span><span>{m(tendered)}</span></div>}
          <div className="thermal__line"><span>{t("ui.receipt.amountPaid")}</span><span>{m(amountPaid)}</span></div>
          {s.change > 0 && <div className="thermal__line is-strong"><span>{t("ui.pos.change")}</span><span>{m(s.change)}</span></div>}
          {s.balance > 0 && s.status === "completed" && <div className="thermal__line is-strong"><span>{t("ui.receipt.balanceDue")}</span><span>{m(s.balance)}</span></div>}
          {refunds.map((p, k) => <div key={`r${k}`} className="thermal__line"><span>{t("ui.receipt.refund")} · {p.label || t(`ui.methods.${p.method}`)}</span><span>{m(p.amount)}</span></div>)}
        </section>

        {/* footer */}
        <footer className="thermal__foot">
          <p className="thermal__thanks">{t("ui.receipt.thanks")}</p>
          {b.invoiceFooter && <p>{b.invoiceFooter}</p>}
          <p className="thermal__ref">{t("ui.receipt.verify")}: {s.number}-{String(s.id).padStart(5, "0")}</p>
          <p className="thermal__powered">{t("invoice.poweredBy")}</p>
        </footer>
      </article>

      {cancelling && <ReasonModal title={t("ui.pos.cancelSale")} help={t("ui.pos.cancelHelp")} confirmLabel={t("ui.pos.cancelSale")}
        onConfirm={(reason) => apiRequest(`/api/sales/${s.id}/cancel`, { method: "POST", body: { reason } }).then(() => r.reload())}
        onClose={() => setCancelling(false)} />}
    </div>
  );
}
