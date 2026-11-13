import { Fragment, useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { useApi, useMoney, useSubmit, Modal, Field, FormError, Loading, EmptyState, PaymentFields } from "./ui.jsx";
import { date, fill, qty } from "./format.js";

/*
 * An invoice's modification history (GET /api/invoices/:id/history): every version — created, edited, posted, cancelled —
 * with who, when, why, who approved, what changed, and the whole invoice before and after; then every payment and refund.
 * Rows are only ever added, so this is the invoice's complete record.
 */
export function InvoiceHistory({ invoiceId, onClose }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const h = useApi(`/api/invoices/${invoiceId}/history`);
  const [open, setOpen] = useState(null);   // revision whose before / after is shown
  const field = (k) => t(`ui.invEdit.fields.${k}`);
  const value = (c, v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "object") return `${qty(v.qty)} ${v.unit || ""} × ${m(v.unitPrice)}`;
    if (["price", "discount", "total", "refund"].includes(c.kind) && c.field !== "priceList") return m(v);
    if (c.field === "vat") return `${v}%`;
    if (c.field === "priceList") return t(`ui.history.types.${v}`);
    return String(v);
  };
  const changeText = (c) => {
    const what = c.kind === "details" ? field(c.field) : `${t(`ui.invEdit.kinds.${c.kind}`)}${c.name ? ` · ${c.name}` : ""}`;
    if (c.kind === "added") return `${what}: ${value(c, c.to)}`;
    if (c.kind === "removed") return `${what}: ${value(c, c.from)}`;
    if (c.kind === "refund") return `${what}: ${m(c.to)}${c.method ? ` (${t(`ui.methods.${c.method}`)})` : ""}`;
    return `${what}: ${value(c, c.from)} → ${value(c, c.to)}`;
  };
  return (
    <Modal title={`${t("ui.invEdit.history")} · ${h.data?.number || ""}`} onClose={onClose} wide>
      {h.loading && !h.data ? <Loading /> : !h.data ? null : (
        <>
          {h.data.revisions.length === 0 ? <EmptyState icon="history" text={t("ui.invEdit.noHistory")} /> : (
            <ol className="inv-history">
              {h.data.revisions.map((r) => (
                <li key={r.revision} className={`inv-history__item is-${r.action}`}>
                  <div className="inv-history__head">
                    <span className={`badge-status badge-status--${r.action === "cancelled" ? "cancelled" : r.action === "edited" ? "partially_paid" : "paid"}`}>{t(`ui.invEdit.actions.${r.action}`)}</span>
                    <strong>{fill(t("ui.invEdit.revision"), { n: r.revision })}</strong>
                    <span className="muted">{date(r.at, lang, true)} · {r.user || "—"}</span>
                    {r.approvedBy && <span className="inv-history__ok"><Icon name="shield-check" /> {fill(t("ui.invEdit.approvedBy"), { name: r.approvedBy })}</span>}
                  </div>
                  {r.reason && <p className="inv-history__reason">“{r.reason}”</p>}
                  {r.changes.length > 0 && <ul className="inv-history__changes">{r.changes.map((c, i) => <li key={i}>{changeText(c)}</li>)}</ul>}
                  {(r.before || r.after) && (
                    <button type="button" className="link-btn" onClick={() => setOpen(open === r.revision ? null : r.revision)}>
                      <Icon name={open === r.revision ? "minus" : "plus"} /> {t("ui.invEdit.showVersions")}
                    </button>
                  )}
                  {open === r.revision && (
                    <div className="inv-history__versions">
                      {[["before", r.before], ["after", r.after]].filter(([, v]) => v).map(([k, v]) => <Version key={k} title={t(`ui.invEdit.${k}`)} v={v} m={m} t={t} lang={lang} />)}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <h3 className="inv-history__sub">{t("ui.invEdit.payments")}</h3>
          {h.data.payments.length === 0 ? <p className="muted">{t("ui.history.noPayments")}</p> : (
            <table className="table table--compact">
              <tbody>{h.data.payments.map((p) => (
                <tr key={p.id} className={p.refund ? "is-neg" : ""}>
                  <td>{date(p.at, lang, true)}</td><td>{t(`ui.methods.${p.method}`)}{p.refund && <> · <strong>{t("ui.invEdit.refundTag")}</strong></>}</td>
                  <td>{p.reference && p.reference !== "REFUND" ? p.reference : ""}</td><td>{p.user || ""}</td><td className="num">{m(p.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  );
}

/* One whole version of the invoice (header + lines), as kept in the history. */
function Version({ title, v, m, t, lang }) {
  return (
    <div className="inv-version">
      <strong>{title}</strong>
      <p className="muted">{v.customer} · {date(v.issueDate, lang)}{v.dueDate ? ` → ${date(v.dueDate, lang)}` : ""} · {t(`ui.status.${v.status}`)}</p>
      <table className="table table--compact">
        <tbody>
          {v.items.map((x, i) => (
            <Fragment key={i}><tr><td>{x.name}</td><td className="num">{qty(x.qty)} {x.unit}</td><td className="num">{m(x.unitPrice)}</td><td className="num">{m(x.lineTotal)}</td></tr></Fragment>
          ))}
        </tbody>
        <tfoot>
          {v.discount > 0 && <tr><td colSpan="3">{t("ui.common.discount")}</td><td className="num">− {m(v.discount)}</td></tr>}
          {v.vat > 0 && <tr><td colSpan="3">VAT</td><td className="num">{m(v.vat)}</td></tr>}
          <tr><td colSpan="3"><strong>{t("ui.common.total")}</strong></td><td className="num"><strong>{m(v.total)}</strong></td></tr>
          <tr><td colSpan="3">{t("ui.history.paid")}</td><td className="num">{m(v.paid)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

/* Cancelling an invoice that has payments: a reason and how the money is given back (refund payments, recorded). */
export function CancelWithRefund({ invoice, onClose, onDone }) {
  const { t } = useLanguage();
  const m = useMoney();
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState({ method: "cash", bankAccountId: "" });
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { sub.setFieldErrors({ reason: "required" }); return; }
    if (await sub.run(() => apiRequest(`/api/invoices/${invoice.id}/cancel`, { method: "POST", body: { reason: reason.trim(), refund } }))) onDone();
  };
  return (
    <Modal title={t("ui.invoices.cancelInvoice")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <p className="modal__help">{fill(t("ui.invEdit.cancelRefundHelp"), { amount: m(invoice.paid) })}</p>
        <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason} full>
          <textarea className="input" rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ui.common.reasonPh")} />
        </Field>
        <PaymentFields method={refund.method} onMethod={(v) => setRefund((x) => ({ ...x, method: v }))} bankId={refund.bankAccountId} onBank={(v) => setRefund((x) => ({ ...x, bankAccountId: v }))} errors={sub.fieldErrors} />
        <FormError error={sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.close")}</button>
          <button type="submit" className="btn btn--danger" disabled={sub.busy}>{t("ui.invoices.cancelInvoice")}</button>
        </div>
      </form>
    </Modal>
  );
}
