import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, Field, FormError, Money, EmptyState, Loading, SearchBox, PaymentFields, StatusBadge, DateRange, daysAgo, isoDate, Modal, ReasonModal } from "../ui.jsx";
import LineItems from "./LineItems.jsx";
import SearchSelect from "../SearchSelect.jsx";
import { PaymentModal } from "./Parties.jsx";
import { qty, date } from "../format.js";
import { useDraft, DraftBar } from "../Drafts.jsx";

export default function Purchases() {
  const { t } = useLanguage();
  const can = usePerm();
  const [tab, setTab] = useState("list");
  return (
    <div className="page">
      <PageHeader icon="truck" title={t("ui.purchases.title")} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "list", label: t("ui.purchases.title"), icon: "history" },
        ...(can("purchases.create") ? [{ id: "new", label: t("ui.purchases.new"), icon: "plus" }] : [])
      ]} />
      {tab === "new" ? <PurchaseForm onDone={() => setTab("list")} /> : <PurchaseList />}
    </div>
  );
}

function PurchaseList() {
  const { t, lang } = useLanguage();
  const [range, setRange] = useState({ from: daysAgo(89), to: isoDate(new Date()) });
  const [q, setQ] = useState("");
  const list = useApi(`/api/purchases?${new URLSearchParams({ ...range, q })}`);
  const [open, setOpen] = useState(null);
  const rows = list.data?.purchases || [];
  return (
    <>
      <div className="toolbar"><DateRange value={range} onChange={setRange} /><SearchBox value={q} onChange={setQ} /></div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="truck" text={t("ui.purchases.empty")} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>{t("ui.common.supplier")}</th><th>{t("ui.common.date")}</th><th className="num">{t("ui.common.total")}</th><th className="num">{t("ui.common.paid")}</th><th className="num">{t("ui.common.balance")}</th><th>{t("ui.common.status")}</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="is-clickable" onClick={() => setOpen(p.id)}>
                  <td><button type="button" className="link-btn">{p.number}</button></td>
                  <td>{p.supplier}</td>
                  <td>{date(p.at, lang)}</td>
                  <td className="num"><Money value={p.total} /></td>
                  <td className="num"><Money value={p.paid} /></td>
                  <td className="num"><Money value={p.balance} className={p.balance > 0 ? "is-neg" : ""} /></td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <PurchaseDetail id={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function PurchaseDetail({ id, onClose }) {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const d = useApi(`/api/purchases/${id}`);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const p = d.data?.purchase;
  return (
    <Modal title={p ? `${p.number} · ${p.supplier?.name}` : t("ui.common.loading")} onClose={onClose} wide footer={p && (
      <div className="statement-foot">
        <span>{t("ui.common.balance")}: <Money value={p.balance} className="strong" /></span>
        <div className="form-actions">
          {can("purchases.cancel") && p.status === "received" && p.paid === 0 && <button type="button" className="btn btn--danger" onClick={() => setCancelling(true)}>{t("ui.purchases.cancel")}</button>}
          {can("purchases.pay") && p.status === "received" && p.balance > 0 && <button type="button" className="btn btn--primary" onClick={() => setPaying(true)}><Icon name="wallet" /><span>{t("ui.purchases.pay")}</span></button>}
        </div>
      </div>
    )}>
      {!d.data ? <Loading /> : (
        <>
          <p className="modal__help">{date(p.at, lang, true)} · <StatusBadge status={p.status} /></p>
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>{t("ui.common.product")}</th><th className="num">{t("ui.common.qty")}</th><th className="num">{t("ui.common.unitCost")}</th><th className="num">{t("ui.common.total")}</th></tr></thead>
            <tbody>{d.data.items.map((i, k) => <tr key={k}><td>{i.name}</td><td className="num">{qty(i.qty)}</td><td className="num"><Money value={i.unitCost} /></td><td className="num"><Money value={i.total} /></td></tr>)}</tbody>
            <tfoot><tr><td colSpan="3" className="num"><strong>{t("ui.common.total")}</strong></td><td className="num"><strong><Money value={p.total} /></strong></td></tr></tfoot>
          </table></div>
          {d.data.payments.length > 0 && (
            <ul className="pay-list">{d.data.payments.map((x, k) => <li key={k}>{date(x.at, lang)} · {t(`ui.methods.${x.method}`)} · <Money value={x.amount} /></li>)}</ul>
          )}
        </>
      )}
      {paying && <PaymentModal url={`/api/purchases/${id}/payments`} max={p.balance} title={t("ui.purchases.pay")} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); d.reload(); }} />}
      {cancelling && <ReasonModal title={t("ui.purchases.cancel")} help={t("ui.purchases.cancelHelp")} confirmLabel={t("ui.purchases.cancel")}
        onConfirm={(reason) => apiRequest(`/api/purchases/${id}/cancel`, { method: "POST", body: { reason } }).then(() => d.reload())} onClose={() => setCancelling(false)} />}
    </Modal>
  );
}

function PurchaseForm({ onDone }) {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const suppliers = useApi("/api/suppliers");
  const [f, setF] = useState({ supplierId: "", amountPaid: "", method: "cash", bankAccountId: "", reference: "" });
  const [lines, setLines] = useState([]);
  const draft = useDraft("purchase");
  const sub = useSubmit();
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, items: lines.map((l) => ({ productId: l.product.id, qty: l.qty, unitCost: l.price, batchNo: l.batchNo || "", expiryDate: l.expiryDate || "" })) };
    if (await sub.run(() => apiRequest("/api/purchases", { method: "POST", body }))) { await draft.finish(); onDone(); }
  };
  return (
    <form onSubmit={save} className="doc-form">
      <DraftBar draft={draft} canSave={lines.length > 0 || Boolean(f.supplierId)}
        title={`${(suppliers.data?.suppliers || []).find((x) => String(x.id) === String(f.supplierId))?.name || t("ui.purchases.title")} · ${m(total)}`}
        getData={() => ({ f, lines })} onLoad={(d) => { setF((x) => ({ ...x, ...d.f })); setLines(d.lines || []); }} />
      <section className="panel-card form-grid form-grid--2">
        <div className="ff">
          <span className="ff__label">{t("ui.common.supplier")}</span>
          <SearchSelect value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} searchPlaceholder={t("ui.common.searchPh")} invalid={Boolean(sub.fieldErrors.supplierId)}
            options={(suppliers.data?.suppliers || []).map((s) => ({ value: s.id, label: s.name, sub: [s.phone, s.address].filter(Boolean).join(" · ") }))} />
          {sub.fieldErrors.supplierId && <span className="ff__error">{t("ui.errors.required")}</span>}
        </div>
        <p className="modal__help">{t("ui.purchases.note")}</p>
      </section>
      <section className="panel-card"><LineItems lines={lines} onChange={setLines} mode="buy" errors={sub.fieldErrors} /></section>
      {can("purchases.pay") && (
        <section className="panel-card form-grid form-grid--2">
          <Field label={t("ui.purchases.payNow")} error={sub.fieldErrors.amountPaid}><input className="input" type="number" min="0" step="any" max={total} value={f.amountPaid} onChange={(e) => setF({ ...f, amountPaid: e.target.value })} /></Field>
          {Number(f.amountPaid) > 0 && <div><PaymentFields method={f.method} onMethod={(v) => setF({ ...f, method: v })} bankId={f.bankAccountId} onBank={(v) => setF({ ...f, bankAccountId: v })} errors={sub.fieldErrors} /></div>}
        </section>
      )}
      <div className="doc-form__bar">
        <dl className="pos__totals pos__totals--inline">
          <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(total)}</dd></div>
          <div><dt>{t("ui.common.balance")}</dt><dd>{m(Math.max(0, total - (Number(f.amountPaid) || 0)))}</dd></div>
        </dl>
        <FormError error={sub.formError} />
        <button type="submit" className="btn btn--primary btn--lg" disabled={sub.busy || !lines.length}><Icon name="check" /><span>{t("ui.purchases.create")}</span></button>
      </div>
    </form>
  );
}
