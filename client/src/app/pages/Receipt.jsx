import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { useApi, usePerm, Money, Loading, EmptyState, ReasonModal, StatusBadge } from "../ui.jsx";
import { qty, date } from "../format.js";
import faatixLogo from "../../assets/faatix-logo.png";

/** Printable POS receipt (narrow layout) with the Faatix logo. */
export default function Receipt() {
  const { id } = useParams();
  const { t, lang } = useLanguage();
  const can = usePerm();
  const r = useApi(`/api/sales/${id}`);
  const [cancelling, setCancelling] = useState(false);
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <EmptyState text={t("ui.errors.notFound")} />;
  const { business: b, sale: s, items, payments } = r.data;

  return (
    <div className="invoice-page receipt-page">
      <div className="invoice-toolbar no-print">
        <Link className="auth__back" to="/app/m/pos?tab=history"><Icon name="arrow-left" /><span>{t("ui.common.back")}</span></Link>
        <div className="form-actions">
          {can("sales.cancel") && s.status === "completed" && <button type="button" className="btn btn--danger" onClick={() => setCancelling(true)}><Icon name="x" /><span>{t("ui.pos.cancelSale")}</span></button>}
          <button type="button" className="btn btn--primary" onClick={() => window.print()}><Icon name="printer" /><span>{t("ui.common.print")}</span></button>
        </div>
      </div>

      <article className="receipt">
        <img className="receipt__faatix" src={faatixLogo} alt="Faatix" />
        <div className="receipt__biz">
          {b.logoPath && <img src={fileUrl(b.logoPath)} alt="" />}
          <strong>{b.name}</strong>
          {b.address && <span>{b.address}</span>}
          {b.phone && <span dir="ltr">{b.phone}</span>}
        </div>
        <div className="receipt__meta">
          <span>{t("ui.pos.receiptNo")}: <strong>{s.number}</strong></span>
          <span>{date(s.at, lang, true)}</span>
          <span>{t("ui.pos.cashier")}: {s.cashier}</span>
          {s.customer && <span>{t("ui.common.customer")}: {s.customer.name}</span>}
          {s.status !== "completed" && <StatusBadge status={s.status} />}
        </div>
        <table className="receipt__items">
          <tbody>
            {items.map((i, k) => (
              <tr key={k}><td>{i.name}<small>{qty(i.qty)} × <Money value={i.unitPrice} /></small></td><td className="num"><Money value={i.total} /></td></tr>
            ))}
          </tbody>
        </table>
        <dl className="receipt__totals">
          <div><dt>{t("ui.common.subtotal")}</dt><dd><Money value={s.subtotal} /></dd></div>
          {s.discount > 0 && <div><dt>{t("ui.common.discount")}</dt><dd>− <Money value={s.discount} /></dd></div>}
          <div className="is-total"><dt>{t("ui.common.total")}</dt><dd><Money value={s.total} /></dd></div>
          {payments.filter((p) => p.amount > 0).map((p, k) => <div key={k}><dt>{p.label || t(`ui.methods.${p.method}`)}</dt><dd><Money value={p.amount} /></dd></div>)}
          {s.balance > 0 && s.status === "completed" && <div className="is-balance"><dt>{t("ui.common.balance")}</dt><dd><Money value={s.balance} /></dd></div>}
        </dl>
        <p className="receipt__thanks">{t("ui.pos.thankYou")}</p>
        <p className="receipt__powered"><img src="/favicon.png" alt="" />{t("invoice.poweredBy")}</p>
      </article>

      {cancelling && <ReasonModal title={t("ui.pos.cancelSale")} help={t("ui.pos.cancelHelp")} confirmLabel={t("ui.pos.cancelSale")}
        onConfirm={(reason) => apiRequest(`/api/sales/${s.id}/cancel`, { method: "POST", body: { reason } }).then(() => r.reload())}
        onClose={() => setCancelling(false)} />}
    </div>
  );
}
