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
import { useProfile } from "../profile.js";
import { BatchFields } from "./Stock.jsx";

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
  const [receiving, setReceiving] = useState(false);
  const p = d.data?.purchase;
  const unitLabel = (u) => (t(`ui.products.units.${u}`).startsWith("ui.") ? u : t(`ui.products.units.${u}`));
  return (
    <Modal title={p ? `${p.number} · ${p.supplier?.name}` : t("ui.common.loading")} onClose={onClose} wide footer={p && (
      <div className="statement-foot">
        {p.status === "ordered" ? <span className="muted">{t("ui.status.ordered")}</span> : <span>{t("ui.common.balance")}: <Money value={p.balance} className="strong" /></span>}
        <div className="form-actions">
          {can("purchases.cancel") && ["received", "ordered"].includes(p.status) && p.paid === 0 && <button type="button" className="btn btn--danger" onClick={() => setCancelling(true)}>{t(p.status === "ordered" ? "ui.purchases.cancelOrder" : "ui.purchases.cancel")}</button>}
          {can("purchases.create") && p.status === "ordered" && <button type="button" className="btn btn--primary" onClick={() => setReceiving(true)}><Icon name="check" /><span>{t("ui.purchases.receive")}</span></button>}
          {can("purchases.pay") && p.status === "received" && p.balance > 0 && <button type="button" className="btn btn--primary" onClick={() => setPaying(true)}><Icon name="wallet" /><span>{t("ui.purchases.pay")}</span></button>}
        </div>
      </div>
    )}>
      {!d.data ? <Loading /> : (
        <>
          <p className="modal__help">{date(p.at, lang, true)} · <StatusBadge status={p.status} />{p.receivedAt && p.status === "received" ? <> · {t("ui.purchases.receivedOn")} {date(p.receivedAt, lang, true)}</> : null}</p>
          {p.status === "ordered" && <p className="page-help"><Icon name="info" /> {t("ui.purchases.orderedHelp")}</p>}
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>{t("ui.common.product")}</th><th className="num">{t("ui.common.qty")}</th><th className="num">{t("ui.common.unitCost")}</th><th className="num">{t("ui.common.total")}</th></tr></thead>
            <tbody>{d.data.items.map((i, k) => (
              <tr key={k}>
                <td>{i.name}{(i.batchNo || i.expiryDate) && <small className="cell-sub">{[i.batchNo, i.expiryDate].filter(Boolean).join(" · ")}</small>}</td>
                <td className="num">{qty(i.qty)} {i.unit || unitLabel(i.baseUnit)}{i.unit && <small className="cell-sub">= {qty(i.baseQty)} {unitLabel(i.baseUnit)}</small>}</td>
                <td className="num"><Money value={i.unitCost} /></td><td className="num"><Money value={i.total} /></td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan="3" className="num"><strong>{t("ui.common.total")}</strong></td><td className="num"><strong><Money value={p.total} /></strong></td></tr></tfoot>
          </table></div>
          {d.data.payments.length > 0 && (
            <ul className="pay-list">{d.data.payments.map((x, k) => <li key={k}>{date(x.at, lang)} · {t(`ui.methods.${x.method}`)} · <Money value={x.amount} /></li>)}</ul>
          )}
        </>
      )}
      {paying && <PaymentModal url={`/api/purchases/${id}/payments`} max={p.balance} title={t("ui.purchases.pay")} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); d.reload(); }} />}
      {receiving && <ReceiveModal purchase={p} items={d.data.items} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); d.reload(); }} />}
      {cancelling && <ReasonModal title={t("ui.purchases.cancel")} help={t("ui.purchases.cancelHelp")} confirmLabel={t("ui.purchases.cancel")}
        onConfirm={(reason) => apiRequest(`/api/purchases/${id}/cancel`, { method: "POST", body: { reason } }).then(() => d.reload())} onClose={() => setCancelling(false)} />}
    </Modal>
  );
}

/* Goods receipt of a purchase order: confirm the goods arrived (batch / expiry per line) → stock is added. */
function ReceiveModal({ purchase, items, onClose, onDone }) {
  const { t } = useLanguage();
  const [lines, setLines] = useState(() => items.map((i) => ({ id: i.id, batchNo: i.batchNo || "", expiryDate: i.expiryDate || "" })));
  const sub = useSubmit();
  const unitLabel = (u) => (t(`ui.products.units.${u}`).startsWith("ui.") ? u : t(`ui.products.units.${u}`));
  const save = async () => {
    if (await sub.run(() => apiRequest(`/api/purchases/${purchase.id}/receive`, { method: "POST", body: { items: lines } }))) onDone();
  };
  return (
    <Modal title={`${t("ui.purchases.receive")} · ${purchase.number}`} onClose={onClose} wide>
      <div className="form-grid">
        <p className="modal__help">{t("ui.purchases.receiveHelp")}</p>
        <ul className="receive-list">
          {items.map((i, k) => (
            <li key={i.id}>
              <strong>{i.name}</strong>
              <span>{qty(i.qty)} {i.unit || unitLabel(i.baseUnit)}{i.unit ? ` = ${qty(i.baseQty)} ${unitLabel(i.baseUnit)}` : ""}</span>
              {i.trackBatches && <BatchFields compact value={lines[k]} onChange={(patch) => setLines((ls) => ls.map((x, j) => (j === k ? { ...x, ...patch } : x)))} />}
            </li>
          ))}
        </ul>
        <FormError error={sub.formError} />
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}><Icon name="check" /><span>{t(sub.busy ? "ui.common.saving" : "ui.purchases.confirmReceive")}</span></button>
        </div>
      </div>
    </Modal>
  );
}

function PurchaseForm({ onDone }) {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const suppliers = useApi("/api/suppliers");
  const profile = useProfile();
  const [f, setF] = useState({ supplierId: "", amountPaid: "", method: "cash", bankAccountId: "", reference: "", receive: true });
  const [lines, setLines] = useState([]);
  const draft = useDraft("purchase");
  const ordering = profile.purchaseOrders && !f.receive;
  const sub = useSubmit();
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, ...(ordering ? { amountPaid: "" } : {}), items: lines.map((l) => ({ productId: l.product.id, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), unitCost: l.price, batchNo: l.batchNo || "", expiryDate: l.expiryDate || "" })) };
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
        {profile.purchaseOrders ? (
          <div className="ff">
            <span className="ff__label">{t("ui.purchases.mode")}</span>
            <div className="seg">
              <button type="button" aria-pressed={f.receive} onClick={() => setF({ ...f, receive: true })}>{t("ui.purchases.receiveNow")}</button>
              <button type="button" aria-pressed={!f.receive} onClick={() => setF({ ...f, receive: false })}>{t("ui.purchases.orderOnly")}</button>
            </div>
            <small className="ff__hint">{t(ordering ? "ui.purchases.orderOnlyHint" : "ui.purchases.receiveNowHint")}</small>
          </div>
        ) : <p className="modal__help">{t("ui.purchases.note")}</p>}
      </section>
      <section className="panel-card"><LineItems lines={lines} onChange={setLines} mode="buy" errors={sub.fieldErrors} /></section>
      {can("purchases.pay") && !ordering && (
        <section className="panel-card form-grid form-grid--2">
          <Field label={t("ui.purchases.payNow")} error={sub.fieldErrors.amountPaid}><input className="input" type="number" min="0" step="any" max={total} value={f.amountPaid} onChange={(e) => setF({ ...f, amountPaid: e.target.value })} /></Field>
          {Number(f.amountPaid) > 0 && <div><PaymentFields method={f.method} onMethod={(v) => setF({ ...f, method: v })} bankId={f.bankAccountId} onBank={(v) => setF({ ...f, bankAccountId: v })} errors={sub.fieldErrors} /></div>}
        </section>
      )}
      <div className="doc-form__bar">
        <dl className="pos__totals pos__totals--inline">
          <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(total)}</dd></div>
          {!ordering && <div><dt>{t("ui.common.balance")}</dt><dd>{m(Math.max(0, total - (Number(f.amountPaid) || 0)))}</dd></div>}
        </dl>
        <FormError error={sub.formError} />
        <button type="submit" className="btn btn--primary btn--lg" disabled={sub.busy || !lines.length}><Icon name="check" /><span>{t(ordering ? "ui.purchases.createOrder" : "ui.purchases.create")}</span></button>
      </div>
    </form>
  );
}
