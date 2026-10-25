import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, Modal, Field, FormError, Money, EmptyState, Loading, SearchBox, PaymentFields, StatusBadge } from "../ui.jsx";
import { date } from "../format.js";
import { savePdf } from "../pdf.js";

/** Customers (kind="customers") and suppliers (kind="suppliers") share this screen. */
export default function Parties({ kind }) {
  const { t } = useLanguage();
  const can = usePerm();
  const isCustomer = kind === "customers";
  const [q, setQ] = useState("");
  const list = useApi(`/api/${kind}?q=${encodeURIComponent(q)}`);
  const [editing, setEditing] = useState(null);
  const [statement, setStatement] = useState(null);
  const rows = list.data?.[kind] || [];
  const editPerm = isCustomer ? "customers.edit" : "suppliers.edit";

  return (
    <div className="page">
      <PageHeader icon={isCustomer ? "users" : "store"} title={t(`ui.parties.${kind}`)} actions={
        can(editPerm) && <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t(isCustomer ? "ui.parties.addCustomer" : "ui.parties.addSupplier")}</span></button>
      } />
      <div className="toolbar"><SearchBox value={q} onChange={setQ} /></div>

      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? (
        <EmptyState icon={isCustomer ? "users" : "store"} text={t(isCustomer ? "ui.parties.emptyCustomers" : "ui.parties.emptySuppliers")} />
      ) : (
        <div className="cards-list">
          {rows.map((p) => (
            <article key={p.id} className="party-card">
              <div className="party-card__main">
                <span className="party-card__avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{p.name}</strong>
                  <small>{[p.phone, p.email].filter(Boolean).join(" · ") || "—"}</small>
                </div>
              </div>
              <div className="party-card__bal">
                <small>{t(isCustomer ? "ui.parties.owesYou" : "ui.parties.youOwe")}</small>
                <Money value={p.balance} className={p.balance > 0 ? (isCustomer ? "is-pos" : "is-neg") : ""} />
                {p.overdue > 0 && <span className="badge-status badge-status--overdue">{t("ui.parties.overdue")}</span>}
              </div>
              <div className="party-card__actions">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setStatement(p)}><Icon name="file-chart" /><span>{t("ui.parties.statement")}</span></button>
                {can(editPerm) && <button type="button" className="icon-btn" title={t("ui.common.edit")} onClick={() => setEditing(p)}><Icon name="settings" /></button>}
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && <PartyForm kind={kind} party={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
      {statement && <Statement kind={kind} party={statement} onClose={() => { setStatement(null); list.reload(); }} />}
    </div>
  );
}

function PartyForm({ kind, party, onClose, onSaved }) {
  const { t } = useLanguage();
  const isNew = !party.id;
  const isCustomer = kind === "customers";
  const [f, setF] = useState({ name: party.name || "", phone: party.phone || "", email: party.email || "", address: party.address || "", notes: party.notes || "" });
  const sub = useSubmit();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(isNew ? `/api/${kind}` : `/api/${kind}/${party.id}`, { method: isNew ? "POST" : "PUT", body: f }))) onSaved();
  };
  const title = isCustomer ? (isNew ? "ui.parties.addCustomer" : "ui.parties.editCustomer") : (isNew ? "ui.parties.addSupplier" : "ui.parties.editSupplier");
  return (
    <Modal title={t(title)} onClose={onClose}>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.name")} error={sub.fieldErrors.name} full><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label={t("ui.common.phone")}><input className="input" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={t("ui.common.email")} error={sub.fieldErrors.email}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={t("ui.common.address")} full><input className="input" value={f.address} onChange={set("address")} /></Field>
        {isCustomer && <Field label={t("ui.common.notes")} full><input className="input" value={f.notes} onChange={set("notes")} /></Field>}
        <FormError error={sub.formError} />
        <div className="form-actions ff--full">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function Statement({ kind, party, onClose }) {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const isCustomer = kind === "customers";
  const st = useApi(`/api/${kind}/${party.id}/statement`);
  const [paying, setPaying] = useState(false);
  const canPay = can(isCustomer ? "payments.receive" : "purchases.pay");
  const balance = st.data?.balance || 0;
  const sheetRef = useRef(null);
  const [savingPdf, setSavingPdf] = useState(false);
  const exportPdf = async () => {
    if (savingPdf) return;
    setSavingPdf(true);
    try { await savePdf(sheetRef.current, `${t("ui.parties.statement")} - ${party.name}.pdf`); }
    finally { setSavingPdf(false); }
  };
  const linkFor = (l) => (l.kind === "invoice" ? `/app/invoices/${l.id}` : l.kind === "sale" ? `/app/sales/${l.id}` : null);

  return (
    <Modal title={`${t("ui.parties.statement")} · ${party.name}`} onClose={onClose} wide footer={
      <div className="statement-foot">
        <span>{t(isCustomer ? "ui.parties.owesYou" : "ui.parties.youOwe")}: <Money value={balance} className="strong" /></span>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={() => window.print()}><Icon name="printer" /><span>{t("invoice.printOnly")}</span></button>
          <button type="button" className="btn btn--outline" onClick={exportPdf} disabled={savingPdf || !(st.data?.lines || []).length}><Icon name="download" /><span>{t(savingPdf ? "invoice.savingPdf" : "invoice.savePdf")}</span></button>
          {canPay && balance > 0 && <button type="button" className="btn btn--primary" onClick={() => setPaying(true)}><Icon name="wallet" /><span>{t(isCustomer ? "ui.parties.receivePayment" : "ui.parties.paySupplier")}</span></button>}
        </div>
      </div>
    }>
      {st.loading && !st.data ? <Loading /> : (st.data?.lines || []).length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="table-wrap pdf-sheet" ref={sheetRef}>
          <div className="pdf-only pdf-sheet__head">
            <strong>{t("ui.parties.statement")} · {party.name}</strong>
            <span>{[party.phone, party.address].filter(Boolean).join(" · ")}</span>
            <span>{t(isCustomer ? "ui.parties.owesYou" : "ui.parties.youOwe")}: <Money value={balance} /> · {date(new Date(), lang)}</span>
          </div>
          <table className="table table--compact">
            <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.common.description")}</th><th className="num">{t("ui.parties.debit")}</th><th className="num">{t("ui.parties.credit")}</th><th className="num">{t("ui.parties.runningBalance")}</th></tr></thead>
            <tbody>
              {st.data.lines.map((l, i) => (
                <tr key={i}>
                  <td>{date(l.at, lang)}</td>
                  <td>
                    {linkFor(l) ? <Link to={linkFor(l)}>{t(`ui.parties.kinds.${l.kind}`)} {l.ref}</Link> : <>{t(`ui.parties.kinds.${l.kind}`)} {l.ref}</>}
                    {l.kind === "payment" && <small className="cell-sub">{t(`ui.methods.${l.status}`)}</small>}
                    {l.kind === "invoice" && l.dueDate && <small className="cell-sub">{t("ui.invoices.dueDate")}: {date(l.dueDate, lang)}</small>}
                  </td>
                  <td className="num">{l.debit ? <Money value={l.debit} /> : ""}</td>
                  <td className="num">{l.credit ? <Money value={l.credit} /> : ""}</td>
                  <td className="num"><Money value={l.balance} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && <PaymentModal url={`/api/${kind}/${party.id}/payments`} max={balance} title={t(isCustomer ? "ui.parties.receivePayment" : "ui.parties.paySupplier")} help={t("ui.parties.paymentHelp")}
        onClose={() => setPaying(false)} onSaved={() => { setPaying(false); st.reload(); }} />}
    </Modal>
  );
}

/** Generic "take / make a payment" form (customers, suppliers, invoices, purchases). */
export function PaymentModal({ url, max, title, help, onClose, onSaved }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ amount: max ? String(max) : "", method: "cash", bankAccountId: "", reference: "" });
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(url, { method: "POST", body: f }))) onSaved();
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        {help && <p className="modal__help">{help}</p>}
        <Field label={t("ui.common.amount")} error={sub.fieldErrors.amount}>
          <input className="input input--big" type="number" min="0.0001" step="any" max={max || undefined} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <PaymentFields method={f.method} onMethod={(m) => setF({ ...f, method: m })} bankId={f.bankAccountId} onBank={(b) => setF({ ...f, bankAccountId: b })} errors={sub.fieldErrors} />
        <Field label={`${t("ui.common.reference")} ${t("ui.common.optional")}`}><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

export { StatusBadge };
