import { Fragment, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, Modal, Field, FormError, Money, EmptyState, Loading, SearchBox, PaymentFields, StatusBadge, useMoney, DateRange, downloadCsv } from "../ui.jsx";
import { date, fill } from "../format.js";
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
  const [history, setHistory] = useState(null);     // customer whose transaction history is open
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
                  <strong>{p.name}{p.priceTier === "wholesale" && <span className="track-tag tier-tag">{t("ui.pricing.tierShort.wholesale")}</span>}</strong>
                  <small>{[p.phone, p.email].filter(Boolean).join(" · ") || "—"}</small>
                </div>
              </div>
              <div className="party-card__bal">
                <small>{t(isCustomer ? "ui.parties.owesYou" : "ui.parties.youOwe")}</small>
                <Money value={p.balance} className={p.balance > 0 ? (isCustomer ? "is-pos" : "is-neg") : ""} />
                {p.overdue > 0 && <span className="badge-status badge-status--overdue">{t("ui.parties.overdue")}</span>}
              </div>
              <div className="party-card__actions">
                {isCustomer && <button type="button" className="btn btn--primary btn--sm" onClick={() => setHistory(p)}><Icon name="history" /><span>{t("ui.history.open")}</span></button>}
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setStatement(p)}><Icon name="file-chart" /><span>{t("ui.parties.statement")}</span></button>
                {can(editPerm) && <button type="button" className="icon-btn" title={t("ui.common.edit")} onClick={() => setEditing(p)}><Icon name="settings" /></button>}
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && <PartyForm kind={kind} party={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
      {statement && <Statement kind={kind} party={statement} onClose={() => { setStatement(null); list.reload(); }} />}
      {history && <CustomerHistory party={history} onClose={() => { setHistory(null); list.reload(); }} />}
    </div>
  );
}

function PartyForm({ kind, party, onClose, onSaved }) {
  const { t } = useLanguage();
  const can = usePerm();
  const isNew = !party.id;
  const isCustomer = kind === "customers";
  const [f, setF] = useState({ name: party.name || "", phone: party.phone || "", email: party.email || "", address: party.address || "", notes: party.notes || "",
    ...(isCustomer ? { priceTier: party.priceTier || "retail" } : {}) });
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
        {isCustomer && (
          // the price type picks retail or wholesale prices on this customer's sales and invoices (changing it: prices.edit)
          <Field label={t("ui.pricing.priceTier")} error={sub.fieldErrors.priceTier} full hint={can("prices.edit") ? t("ui.pricing.priceTierHint") : t("ui.pricing.tierLocked")}>
            <div className="seg">{["retail", "wholesale"].map((x) => (
              <button key={x} type="button" aria-pressed={f.priceTier === x} disabled={!can("prices.edit")} onClick={() => setF((v) => ({ ...v, priceTier: x }))}>{t(`ui.pricing.tiers.${x}`)}</button>
            ))}</div>
          </Field>
        )}
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

/*
 * Customer history (GET /api/customers/:id/history): the financial summary at the top (all their transactions), then every
 * POS sale and invoice — date, number (links to the original), retail / wholesale, branch, total, paid, outstanding,
 * payment status — with its payment history and returns / refunds under it. Filters: dates, number, branch, type, status.
 * The account statement (print / PDF) opens from here.
 */
const PAY_STATUSES = ["paid", "partially_paid", "unpaid", "overdue", "cancelled", "returned"];
function CustomerHistory({ party, onClose }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const branches = useApi("/api/branches");
  const [f, setF] = useState({ from: "", to: "", q: "", branchId: "", type: "", status: "" });
  const h = useApi(`/api/customers/${party.id}/history?${new URLSearchParams(f)}`);
  const [open, setOpen] = useState(null);           // "kind-id" of the transaction showing its payments / returns
  const [statement, setStatement] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const s = h.data?.summary;
  const rows = h.data?.transactions || [];
  const branchList = branches.data?.branches || [];
  const linkFor = (x) => (x.kind === "invoice" ? `/app/invoices/${x.id}` : `/app/sales/${x.id}`);
  const exportCsv = () => downloadCsv(`${party.name} - transactions.csv`, ["date", "number", "document", "type", "branch", "total", "paid", "outstanding", "status", "returned", "refunded"],
    rows.map((x) => [String(x.at).slice(0, 10), x.number, x.kind, x.type, x.branch || "", x.total, x.paid, x.balance, x.status, x.returned, x.refunded]));

  return (
    <Modal title={`${t("ui.history.title")} · ${party.name}`} onClose={onClose} wide footer={
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={exportCsv} disabled={!rows.length}><Icon name="download" /><span>{t("ui.history.exportCsv")}</span></button>
        <button type="button" className="btn btn--primary" onClick={() => setStatement(true)}><Icon name="file-chart" /><span>{t("ui.parties.statement")}</span></button>
      </div>
    }>
      {h.loading && !h.data ? <Loading /> : !h.data ? null : (
        <>
          <p className="history-who">
            {[party.phone, party.email, party.address].filter(Boolean).join(" · ") || "—"}
            <span className={"track-tag" + (party.priceTier === "wholesale" ? " tier-tag" : "")}>{t(`ui.pricing.tiers.${party.priceTier || "retail"}`)}</span>
          </p>
          <div className="acct-grid history-summary">
            <div className="acct-card"><small>{t("ui.history.totalPurchases")}</small><span className="money">{m(s.totalPurchases)}</span><small>{fill(t("ui.history.typesLine"), s)}</small></div>
            <div className="acct-card"><small>{t("ui.history.totalPaid")}</small><span className="money">{m(s.totalPaid)}</span></div>
            <div className={"acct-card" + (s.outstanding > 0 ? " acct-card--total" : "")}><small>{t("ui.history.outstanding")}</small><span className="money">{m(s.outstanding)}</span></div>
            <div className="acct-card"><small>{t("ui.history.transactions")}</small><span className="money">{s.transactions}</span>
              {(s.returned > 0 || s.refunded > 0) && <small>{fill(t("ui.history.returnsLine"), { amount: m(s.returned), refund: m(s.refunded) })}</small>}</div>
            <div className="acct-card"><small>{t("ui.history.lastPurchase")}</small><span className="money history-date">{s.lastPurchase ? date(s.lastPurchase, lang) : t("ui.history.never")}</span></div>
          </div>

          <div className="toolbar history-filters">
            <DateRange value={{ from: f.from, to: f.to }} onChange={(r) => setF((x) => ({ ...x, ...r }))} />
            <SearchBox value={f.q} onChange={set("q")} placeholder={t("ui.history.searchPh")} />
            {branchList.length > 1 && (
              <select className="input input--auto" value={f.branchId} onChange={(e) => set("branchId")(e.target.value)} aria-label={t("ui.history.branch")}>
                <option value="">{t("ui.history.allBranches")}</option>
                {branchList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <select className="input input--auto" value={f.type} onChange={(e) => set("type")(e.target.value)} aria-label={t("ui.history.type")}>
              <option value="">{t("ui.history.allTypes")}</option>
              {["retail", "wholesale"].map((x) => <option key={x} value={x}>{t(`ui.history.types.${x}`)}</option>)}
            </select>
            <select className="input input--auto" value={f.status} onChange={(e) => set("status")(e.target.value)} aria-label={t("ui.history.status")}>
              <option value="">{t("ui.history.allStatuses")}</option>
              {PAY_STATUSES.map((x) => <option key={x} value={x}>{t(`ui.history.statuses.${x}`)}</option>)}
            </select>
          </div>

          {rows.length === 0 ? <EmptyState icon="receipt" text={t("ui.history.empty")} /> : (
            <div className="table-wrap">
              <table className="table table--compact history-table">
                <thead><tr>
                  <th>{t("ui.common.date")}</th><th>{t("ui.history.number")}</th><th>{t("ui.history.type")}</th><th>{t("ui.history.branch")}</th>
                  <th className="num">{t("ui.history.total")}</th><th className="num">{t("ui.history.paid")}</th><th className="num">{t("ui.history.balance")}</th><th>{t("ui.history.status")}</th><th />
                </tr></thead>
                <tbody>
                  {rows.map((x) => {
                    const key = `${x.kind}-${x.id}`;
                    return (
                      <Fragment key={key}>
                        <tr className={x.cancelled ? "is-muted" : ""}>
                          <td>{date(x.at, lang)}</td>
                          <td><Link to={linkFor(x)}>{x.number}</Link><small className="cell-sub">{t(`ui.history.docs.${x.kind}`)}</small></td>
                          <td><span className={"track-tag" + (x.type === "wholesale" ? " tier-tag" : "")}>{t(`ui.history.types.${x.type}`)}</span></td>
                          <td>{x.branch || "—"}</td>
                          <td className="num"><Money value={x.total} /></td>
                          <td className="num"><Money value={x.paid} /></td>
                          <td className="num"><Money value={x.balance} className={x.balance > 0 ? "is-pos" : ""} /></td>
                          <td><span className={`badge-status badge-status--${x.status}`}>{t(`ui.history.statuses.${x.status}`)}</span>
                            {x.returns.length > 0 && <small className="cell-sub">{t("ui.history.returnedTag")}</small>}</td>
                          <td><button type="button" className="icon-btn" aria-expanded={open === key} title={t("ui.history.showDetails")} onClick={() => setOpen(open === key ? null : key)}><Icon name={open === key ? "minus" : "plus"} /></button></td>
                        </tr>
                        {open === key && (
                          <tr className="history-detail"><td colSpan="9">
                            <div className="history-detail__grid">
                              <div>
                                <strong>{t("ui.history.payments")}</strong>
                                {x.payments.length === 0 ? <p className="muted">{t("ui.history.noPayments")}</p> : (
                                  <ul>{x.payments.map((p) => (
                                    <li key={p.id} className={p.refund ? "is-neg" : ""}>
                                      {date(p.at, lang, true)} · {p.label || t(`ui.methods.${p.method}`)} · <strong>{m(p.amount)}</strong>
                                      {p.refund && <> · {t("ui.history.refundTag")}</>}{p.reference && p.reference !== "REFUND" ? ` · ${p.reference}` : ""}{p.user ? ` · ${p.user}` : ""}
                                    </li>
                                  ))}</ul>
                                )}
                              </div>
                              {x.returns.length > 0 && (
                                <div>
                                  <strong>{t("ui.history.returns")}</strong>
                                  <ul>{x.returns.map((r) => (
                                    <li key={r.id}>{date(r.at, lang, true)} · {fill(t("ui.history.returnLine"), { amount: m(r.amount), refund: m(r.refund) })}{r.reason ? ` · ${r.reason}` : ""}{r.user ? ` · ${r.user}` : ""}</li>
                                  ))}</ul>
                                </div>
                              )}
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {statement && <Statement kind="customers" party={party} onClose={() => { setStatement(false); h.reload(); }} />}
    </Modal>
  );
}

/*
 * Account statement: documents, payments (customers: refunds, returns and cancelled sales too) with the running balance,
 * for all time or a period (opening balance first). Print or save as PDF; each line links to its sale / invoice.
 */
function Statement({ kind, party, onClose }) {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const isCustomer = kind === "customers";
  const [range, setRange] = useState({ from: "", to: "" });
  const st = useApi(`/api/${kind}/${party.id}/statement?${new URLSearchParams(range)}`);
  const period = st.data?.period;
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
  // every line links to its original document (payments, refunds and returns to the sale / invoice they belong to)
  const linkFor = (l) => {
    const k = l.docKind || l.kind;
    const docId = l.docId || l.id;
    return k === "invoice" ? `/app/invoices/${docId}` : k === "sale" || k === "cancelled" ? `/app/sales/${docId}` : null;
  };
  const periodText = range.from || range.to ? `${range.from ? date(range.from, lang) : "…"} – ${range.to ? date(range.to, lang) : date(new Date(), lang)}` : t("ui.parties.allTime");

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
      <div className="toolbar"><DateRange value={range} onChange={setRange} />{(range.from || range.to) && <button type="button" className="btn btn--outline btn--sm" onClick={() => setRange({ from: "", to: "" })}>{t("ui.parties.allTime")}</button>}</div>
      {st.loading && !st.data ? <Loading /> : (st.data?.lines || []).length === 0 && !period?.opening ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="table-wrap pdf-sheet" ref={sheetRef}>
          <div className="pdf-only pdf-sheet__head">
            <strong>{t("ui.parties.statement")} · {party.name}</strong>
            <span>{[party.phone, party.address].filter(Boolean).join(" · ")}</span>
            <span>{t("ui.parties.period")}: {periodText}</span>
            <span>{t(isCustomer ? "ui.parties.owesYou" : "ui.parties.youOwe")}: <Money value={balance} /> · {date(new Date(), lang)}</span>
          </div>
          <table className="table table--compact">
            <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.common.description")}</th><th className="num">{t("ui.parties.debit")}</th><th className="num">{t("ui.parties.credit")}</th><th className="num">{t("ui.parties.runningBalance")}</th></tr></thead>
            <tbody>
              {range.from && <tr className="statement-opening"><td>{date(range.from, lang)}</td><td colSpan="3"><strong>{t("ui.parties.opening")}</strong></td><td className="num"><Money value={period?.opening || 0} /></td></tr>}
              {st.data.lines.map((l, i) => (
                <tr key={i} className={["return", "cancelled"].includes(l.kind) ? "is-muted" : ""}>
                  <td>{date(l.at, lang)}</td>
                  <td>
                    {linkFor(l) ? <Link to={linkFor(l)}>{t(`ui.parties.kinds.${l.kind}`)} {l.ref}</Link> : <>{t(`ui.parties.kinds.${l.kind}`)} {l.ref}</>}
                    {(l.kind === "payment" || l.kind === "refund") && <small className="cell-sub">{t(`ui.methods.${l.status}`)}</small>}
                    {l.kind === "invoice" && l.dueDate && <small className="cell-sub">{t("ui.invoices.dueDate")}: {date(l.dueDate, lang)}</small>}
                    {["return", "cancelled"].includes(l.kind) && <small className="cell-sub">{m(l.amount || 0)} · {t("ui.parties.noBalanceEffect")}</small>}
                  </td>
                  <td className="num">{l.debit ? <Money value={l.debit} /> : ""}</td>
                  <td className="num">{l.credit ? <Money value={l.credit} /> : ""}</td>
                  <td className="num"><Money value={l.balance} /></td>
                </tr>
              ))}
            </tbody>
            {period && (range.from || range.to) && (
              <tfoot><tr><td colSpan="2"><strong>{t("ui.parties.closing")}</strong></td><td className="num"><Money value={period.debit} /></td><td className="num"><Money value={period.credit} /></td><td className="num"><strong><Money value={period.closing} /></strong></td></tr></tfoot>
            )}
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
