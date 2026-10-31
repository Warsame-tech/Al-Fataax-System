import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, Field, FormError, Money, EmptyState, Loading, SearchBox, PaymentFields, StatusBadge, DateRange, daysAgo, isoDate, Modal, ReasonModal } from "../ui.jsx";
import LineItems from "./LineItems.jsx";
import SearchSelect from "../SearchSelect.jsx";
import { PaymentModal } from "./Parties.jsx";
import { qty, date, fill } from "../format.js";
import { useDraft, DraftBar } from "../Drafts.jsx";
import { useProfile } from "../profile.js";
import { BatchFields } from "./Stock.jsx";
import { DeviceEntry, DevicePicker, deviceText } from "../Devices.jsx";
import { isRoll, RollEntry, RollPicker, rollsPayload, rollsDeclared } from "../Fabric.jsx";

const tracked = (i) => ["serial", "imei", "serial_imei"].includes(i?.tracking);

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
  const [modal, setModal] = useState(null);          // cancel | close | receive | return
  const p = d.data?.purchase;
  const unitLabel = (u) => (t(`ui.products.units.${u}`).startsWith("ui.") ? u : t(`ui.products.units.${u}`));
  const run = (path, body) => apiRequest(`/api/purchases/${id}/${path}`, { method: "POST", body }).then(() => d.reload());
  const open = p && ["ordered", "partial"].includes(p.status);
  const received = p && ["received", "partial"].includes(p.status);
  const showQty = Boolean(d.data?.items.some((i) => i.received !== i.qty || i.damaged || i.returned)) || open;
  const cols = showQty ? 7 : 3;
  return (
    <Modal title={p ? `${p.number} · ${p.supplier?.name}` : t("ui.common.loading")} onClose={onClose} wide footer={p && (
      <div className="statement-foot">
        {["draft", "ordered"].includes(p.status) ? <span className="muted">{t(`ui.status.${p.status}`)}</span> : <span>{t("ui.common.balance")}: <Money value={p.balance} className="strong" /></span>}
        <div className="form-actions">
          {can("purchases.cancel") && ["draft", "ordered", "partial", "received"].includes(p.status) && p.paid === 0 && <button type="button" className="btn btn--danger" onClick={() => setModal("cancel")}>{t(["draft", "ordered"].includes(p.status) ? "ui.purchases.cancelOrder" : "ui.purchases.cancel")}</button>}
          {can("purchases.cancel") && received && <button type="button" className="btn btn--outline" onClick={() => setModal("return")}><Icon name="arrow-up-right" /><span>{t("ui.purchases.returnToSupplier")}</span></button>}
          {can("purchases.create") && p.status === "partial" && <button type="button" className="btn btn--outline" onClick={() => setModal("close")}>{t("ui.purchases.closeOrder")}</button>}
          {can("purchases.create") && p.status === "draft" && <button type="button" className="btn btn--primary" onClick={() => run("confirm")}><Icon name="check" /><span>{t("ui.purchases.confirmOrder")}</span></button>}
          {can("purchases.create") && open && <button type="button" className="btn btn--primary" onClick={() => setModal("receive")}><Icon name="check" /><span>{t("ui.purchases.receive")}</span></button>}
          {can("purchases.pay") && received && p.balance > 0 && <button type="button" className="btn btn--primary" onClick={() => setPaying(true)}><Icon name="wallet" /><span>{t("ui.purchases.pay")}</span></button>}
        </div>
      </div>
    )}>
      {!d.data ? <Loading /> : (
        <>
          <p className="modal__help">
            {date(p.at, lang, true)} · <StatusBadge status={p.status} />
            {p.receivedAt && !["draft", "ordered"].includes(p.status) ? <> · {t("ui.purchases.receivedOn")} {date(p.receivedAt, lang, true)}</> : null}
            {p.expectedDate ? <> · {t("ui.purchases.expected")} {date(p.expectedDate, lang)}</> : null}
            {p.paymentTerms ? <> · {t("ui.purchases.paymentTerms")}: {p.paymentTerms}</> : null}
            {p.location ? <> · {p.location}</> : null}
          </p>
          {p.status === "ordered" && <p className="page-help"><Icon name="info" /> {t("ui.purchases.orderedHelp")}</p>}
          {p.status === "draft" && <p className="page-help"><Icon name="info" /> {t("ui.purchases.draftHelp")}</p>}
          {p.status === "partial" && <p className="page-help"><Icon name="info" /> {t("ui.purchases.partialHelp")}</p>}
          {p.notes && <p className="muted">{p.notes}</p>}
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr>
              <th>{t("ui.common.product")}</th><th className="num">{t("ui.purchases.ordered")}</th>
              {showQty && <><th className="num">{t("ui.purchases.receivedQty")}</th><th className="num">{t("ui.purchases.outstanding")}</th><th className="num">{t("ui.purchases.damaged")}</th><th className="num">{t("ui.purchases.returnedQty")}</th></>}
              <th className="num">{t("ui.common.unitCost")}</th><th className="num">{t("ui.common.total")}</th>
            </tr></thead>
            <tbody>{d.data.items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}
                  {(i.batchNo || i.expiryDate) && <small className="cell-sub">{[i.batchNo, i.expiryDate].filter(Boolean).join(" · ")}</small>}
                  {i.devices.length > 0 && <ul className="pos2__devices">{i.devices.map((x) => <li key={x.id}>{x.label} · {t(`ui.devices.status.${x.status}`)}</li>)}</ul>}
                  {i.rolls?.length > 0 && <ul className="pos2__devices">{i.rolls.map((x) => <li key={x.id}>{x.code} · {fill(t("ui.fabric.rollLine"), { declared: qty(x.declared), verified: qty(x.verified), remaining: qty(x.remaining) })} · {t(`ui.fabric.status.${x.status}`)}</li>)}</ul>}
                </td>
                <td className="num">{qty(i.qty)} {i.unit || unitLabel(i.baseUnit)}{i.unit && <small className="cell-sub">= {qty(i.baseQty)} {unitLabel(i.baseUnit)}</small>}</td>
                {showQty && <><td className="num">{qty(i.received)}</td><td className={"num" + (i.outstanding > 0 ? " is-neg" : "")}>{qty(i.outstanding)}</td><td className="num">{i.damaged ? qty(i.damaged) : "—"}</td><td className="num">{i.returned ? qty(i.returned) : "—"}</td></>}
                <td className="num"><Money value={i.unitCost} /></td><td className="num"><Money value={i.total} /></td>
              </tr>
            ))}</tbody>
            <tfoot>
              {p.discount > 0 && <tr><td colSpan={cols} className="num">{t("ui.common.discount")}</td><td className="num">− <Money value={p.discount} /></td></tr>}
              {p.extraCosts > 0 && <tr><td colSpan={cols} className="num">{t("ui.purchases.extraCosts")}</td><td className="num"><Money value={p.extraCosts} /></td></tr>}
              <tr><td colSpan={cols} className="num"><strong>{["draft", "ordered"].includes(p.status) ? t("ui.purchases.orderTotal") : t("ui.purchases.owedTotal")}</strong></td><td className="num"><strong><Money value={["draft", "ordered"].includes(p.status) ? p.orderedTotal : p.total} /></strong></td></tr>
            </tfoot>
          </table></div>
          {d.data.payments.length > 0 && (
            <ul className="pay-list">{d.data.payments.map((x, k) => <li key={k}>{date(x.at, lang)} · {t(`ui.methods.${x.method}`)} · <Money value={x.amount} /></li>)}</ul>
          )}
        </>
      )}
      {paying && <PaymentModal url={`/api/purchases/${id}/payments`} max={p.balance} title={t("ui.purchases.pay")} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); d.reload(); }} />}
      {modal === "receive" && <ReceiveModal purchase={p} items={d.data.items} onClose={() => setModal(null)} onDone={() => { setModal(null); d.reload(); }} />}
      {modal === "return" && <ReturnModal purchase={p} items={d.data.items} onClose={() => setModal(null)} onDone={() => { setModal(null); d.reload(); }} />}
      {modal === "close" && <ReasonModal title={t("ui.purchases.closeOrder")} help={t("ui.purchases.closeHelp")} confirmLabel={t("ui.purchases.closeOrder")}
        onConfirm={(reason) => run("close", { reason })} onClose={() => setModal(null)} />}
      {modal === "cancel" && <ReasonModal title={t("ui.purchases.cancel")} help={t("ui.purchases.cancelHelp")} confirmLabel={t("ui.purchases.cancel")}
        onConfirm={(reason) => run("cancel", { reason })} onClose={() => setModal(null)} />}
    </Modal>
  );
}

/*
 * Goods receipt of a purchase order: how many arrived (partial is fine — the rest stays outstanding), how many are
 * damaged (not added to stock), the actual cost, batch / expiry, and the serial numbers / IMEIs of tracked products.
 */
function ReceiveModal({ purchase, items, onClose, onDone }) {
  const { t } = useLanguage();
  const locations = useApi("/api/stock/locations");
  const open = items.filter((i) => i.outstanding > 0);
  const [lines, setLines] = useState(() => open.map((i) => ({ id: i.id, qty: String(i.outstanding), damaged: "", unitCost: String(i.unitCost), batchNo: i.batchNo || "", expiryDate: i.expiryDate || "", devices: [],
    ...(isRoll(i) ? { rolls: { unit: i.unit === "yard" ? "yard" : "meter", rolls: [] } } : {}) })));
  const [locationId, setLocationId] = useState(purchase.locationId ? String(purchase.locationId) : "");
  const [note, setNote] = useState("");
  const sub = useSubmit();
  const unitLabel = (u) => (t(`ui.products.units.${u}`).startsWith("ui.") ? u : t(`ui.products.units.${u}`));
  const set = (k, patch) => setLines((ls) => ls.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  const save = async () => {
    const body = { locationId: locationId || undefined, note, items: lines.map((l) => ({ ...l, devices: l.devices.length ? l.devices : undefined, rolls: l.rolls ? rollsPayload(l.rolls) : undefined })) };
    if (await sub.run(() => apiRequest(`/api/purchases/${purchase.id}/receive`, { method: "POST", body }))) onDone();
  };
  // server errors name a line by its position in the whole purchase; the form shows only open lines
  const errFor = (i, k) => {
    const at = items.indexOf(i);
    return Object.fromEntries(Object.entries(sub.fieldErrors).filter(([key]) => key.startsWith(`items.${at}.`)).map(([key, v]) => [key.replace(`items.${at}.`, `items.${k}.`), v]));
  };
  return (
    <Modal title={`${t("ui.purchases.receive")} · ${purchase.number}`} onClose={onClose} wide>
      <div className="form-grid">
        <p className="modal__help">{t("ui.purchases.receiveHelpFull")}</p>
        <Field label={t("ui.purchases.receivingLocation")}>
          <select className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {!locationId && <option value="">{t("ui.stock.default")}</option>}
            {(locations.data?.locations || []).filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.name}{l.isDefault ? ` · ${t("ui.stock.default")}` : ""}</option>)}
          </select>
        </Field>
        <ul className="receive-list">
          {open.map((i, k) => {
            const isTracked = tracked(i);
            const e = errFor(i, k);
            const roll = isRoll(i);
            // rolls: what they declare is received (and billed); the verified length goes into stock
            const got = roll ? rollsDeclared(lines[k].rolls) : Number(lines[k].qty) || 0;
            const left = i.outstanding - got - (Number(lines[k].damaged) || 0);
            return (
              <li key={i.id}>
                <strong>{i.name}</strong>
                <span>{fill(t("ui.purchases.outstandingOf"), { n: qty(i.outstanding), ordered: qty(i.qty), unit: i.unit || unitLabel(i.baseUnit) })}</span>
                {roll ? (
                  <div className="receive-grid">
                    <label><span>{t("ui.purchases.actualCost")}</span><input className={"input input--sm" + (e[`items.${k}.unitCost`] ? " has-error" : "")} type="number" min="0" step="any" value={lines[k].unitCost} onChange={(ev) => set(k, { unitCost: ev.target.value })} /></label>
                  </div>
                ) : <div className="receive-grid">
                  <label><span>{t("ui.purchases.receivedNow")}</span><input className={"input input--sm" + (e[`items.${k}.qty`] ? " has-error" : "")} type="number" min="0" step={isTracked ? "1" : "any"} max={i.outstanding} value={lines[k].qty} onChange={(ev) => set(k, { qty: ev.target.value })} /></label>
                  <label><span>{t("ui.purchases.damaged")}</span><input className="input input--sm" type="number" min="0" step="any" value={lines[k].damaged} onChange={(ev) => set(k, { damaged: ev.target.value })} placeholder="0" /></label>
                  <label><span>{t("ui.purchases.actualCost")}</span><input className={"input input--sm" + (e[`items.${k}.unitCost`] ? " has-error" : "")} type="number" min="0" step="any" value={lines[k].unitCost} onChange={(ev) => set(k, { unitCost: ev.target.value })} /></label>
                </div>}
                {roll && <RollEntry value={lines[k].rolls} unitFixed={i.unit === "yard" ? "yard" : "meter"} onChange={(rolls) => set(k, { rolls })} errors={e} field={`items.${k}.rolls`} />}
                {left > 0 && <small className="muted">{fill(t("ui.purchases.leftOutstanding"), { n: qty(left) })}</small>}
                {e[`items.${k}.qty`] && <span className="ff__error">{t(`ui.errors.${e[`items.${k}.qty`]}`)}</span>}
                {i.trackBatches && <BatchFields compact value={lines[k]} onChange={(patch) => set(k, patch)} />}
                {isTracked && <DeviceEntry tracking={i.tracking} qty={Number.isInteger(Number(lines[k].qty)) ? Number(lines[k].qty) : 0} value={lines[k].devices} onChange={(devices) => set(k, { devices })} errors={e} field={`items.${k}.devices`} />}
              </li>
            );
          })}
        </ul>
        <Field label={`${t("ui.purchases.discrepancyNote")} ${t("ui.common.optional")}`}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ui.purchases.discrepancyPh")} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}><Icon name="check" /><span>{t(sub.busy ? "ui.common.saving" : "ui.purchases.confirmReceive")}</span></button>
        </div>
      </div>
    </Modal>
  );
}

/* Supplier return of received goods: quantities per line; serial / IMEI products return the exact devices. */
function ReturnModal({ purchase, items, onClose, onDone }) {
  const { t } = useLanguage();
  const back = items.filter((i) => i.received - i.returned > 0);
  const [lines, setLines] = useState(() => back.map((i) => ({ id: i.id, qty: "", deviceIds: [], devices: [], rollIds: [], rolls: [] })));
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState(null);
  const sub = useSubmit();
  const set = (k, patch) => setLines((ls) => ls.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  const save = async () => {
    const body = { reason, items: lines.filter((l) => Number(l.qty) > 0 || l.rollIds.length).map((l) => ({ id: l.id, qty: Number(l.qty) || 0, deviceIds: l.deviceIds, ...(l.rollIds.length ? { rollIds: l.rollIds } : {}) })) };
    if (await sub.run(() => apiRequest(`/api/purchases/${purchase.id}/return`, { method: "POST", body }))) onDone();
  };
  return (
    <Modal title={`${t("ui.purchases.returnToSupplier")} · ${purchase.number}`} onClose={onClose} wide>
      <div className="form-grid">
        <p className="modal__help">{t("ui.purchases.returnHelp")}</p>
        <ul className="receive-list">
          {back.map((i, k) => {
            const isTracked = tracked(i);
            return (
              <li key={i.id}>
                <strong>{i.name}</strong>
                <span>{fill(t("ui.purchases.canReturn"), { n: qty(i.received - i.returned) })}</span>
                {isRoll(i) ? (
                  <div>
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => setPicking(k)}><Icon name="roll" /><span>{fill(t("ui.fabric.rollsChosen"), { n: lines[k].rollIds.length })}</span></button>
                    {lines[k].rolls.length > 0 && <ul className="pos2__devices">{lines[k].rolls.map((x) => <li key={x.id}>{x.code} · {qty(x.remaining)} m</li>)}</ul>}
                  </div>
                ) : isTracked ? (
                  <div>
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => setPicking(k)}><Icon name="smartphone" /><span>{fill(t("ui.devices.count"), { n: lines[k].deviceIds.length })}</span></button>
                    {lines[k].devices.length > 0 && <ul className="pos2__devices">{lines[k].devices.map((x) => <li key={x.id}>{deviceText(x)}</li>)}</ul>}
                  </div>
                ) : (
                  <input className="input input--sm" type="number" min="0" step="any" max={i.received - i.returned} value={lines[k].qty} onChange={(e) => set(k, { qty: e.target.value })} placeholder="0" aria-label={t("ui.common.qty")} />
                )}
                {picking === k && isRoll(i) && (
                  <RollPicker product={{ id: i.productId, name: i.name }} multi value={lines[k].rollIds} list={i.rolls.filter((x) => ["available", "pending_inspection"].includes(x.status))}
                    onClose={() => setPicking(null)} onDone={(ids, rolls) => { set(k, { rollIds: ids, rolls }); setPicking(null); }} />
                )}
                {picking === k && !isRoll(i) && (
                  <DevicePicker product={{ id: i.productId, name: i.name }} max={i.received - i.returned} value={lines[k].deviceIds}
                    filter={(x) => x.purchaseId === purchase.id} onClose={() => setPicking(null)}
                    onDone={(ids, devices) => { set(k, { deviceIds: ids, devices, qty: String(ids.length) }); setPicking(null); }} />
                )}
              </li>
            );
          })}
        </ul>
        <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ui.purchases.returnReasonPh")} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="button" className="btn btn--primary" disabled={sub.busy || !reason.trim() || !lines.some((l) => Number(l.qty) > 0 || l.rollIds.length)} onClick={save}>{t(sub.busy ? "ui.common.saving" : "ui.purchases.confirmReturn")}</button>
        </div>
      </div>
    </Modal>
  );
}

/* New purchase: receive the goods now, or a purchase order / draft (stock comes in with the goods receipt). */
function PurchaseForm({ onDone }) {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const suppliers = useApi("/api/suppliers");
  const profile = useProfile();
  const locations = useApi(profile.purchaseOrders ? "/api/stock/locations" : null);
  const [f, setF] = useState({ supplierId: "", amountPaid: "", method: "cash", bankAccountId: "", reference: "", mode: "receive",
    expectedDate: "", paymentTerms: "", discount: "", extraCosts: "", notes: "", locationId: "" });
  const [lines, setLines] = useState([]);
  const draft = useDraft("purchase");
  const mode = profile.purchaseOrders ? f.mode || "receive" : "receive";
  const ordering = mode !== "receive";
  const sub = useSubmit();
  const goods = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const total = Math.max(0, goods - (Number(f.discount) || 0) + (Number(f.extraCosts) || 0));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const body = { ...f, mode, ...(ordering ? { amountPaid: "" } : {}), locationId: f.locationId || undefined,
      items: lines.map((l) => ({ productId: l.product.id, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), unitCost: l.price, batchNo: l.batchNo || "", expiryDate: l.expiryDate || "",
        ...(!ordering && l.devices?.length ? { devices: l.devices } : {}), ...(!ordering && isRoll(l.product) ? { rolls: rollsPayload(l.rolls) } : {}) })) };
    if (await sub.run(() => apiRequest("/api/purchases", { method: "POST", body }))) { await draft.finish(); onDone(); }
  };
  return (
    <form onSubmit={save} className="doc-form">
      <DraftBar draft={draft} canSave={lines.length > 0 || Boolean(f.supplierId)}
        title={`${(suppliers.data?.suppliers || []).find((x) => String(x.id) === String(f.supplierId))?.name || t("ui.purchases.title")} · ${m(total)}`}
        getData={() => ({ f, lines })} onLoad={(d) => { setF((x) => ({ ...x, ...d.f, mode: d.f?.mode || (d.f?.receive === false ? "order" : "receive") })); setLines(d.lines || []); }} />
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
              <button type="button" aria-pressed={mode === "receive"} onClick={() => setF({ ...f, mode: "receive" })}>{t("ui.purchases.receiveNow")}</button>
              <button type="button" aria-pressed={mode === "order"} onClick={() => setF({ ...f, mode: "order" })}>{t("ui.purchases.orderOnly")}</button>
              <button type="button" aria-pressed={mode === "draft"} onClick={() => setF({ ...f, mode: "draft" })}>{t("ui.purchases.draftMode")}</button>
            </div>
            <small className="ff__hint">{t(mode === "draft" ? "ui.purchases.draftHint" : ordering ? "ui.purchases.orderOnlyHint" : "ui.purchases.receiveNowHint")}</small>
          </div>
        ) : <p className="modal__help">{t("ui.purchases.note")}</p>}
        {profile.purchaseOrders && (
          <>
            {ordering && <Field label={`${t("ui.purchases.expected")} ${t("ui.common.optional")}`}><input className="input" type="date" value={f.expectedDate} onChange={set("expectedDate")} /></Field>}
            <Field label={`${t("ui.purchases.paymentTerms")} ${t("ui.common.optional")}`}><input className="input" value={f.paymentTerms} onChange={set("paymentTerms")} placeholder={t("ui.purchases.paymentTermsPh")} /></Field>
            <Field label={t("ui.purchases.receivingLocation")}>
              <select className="input" value={f.locationId} onChange={set("locationId")}>
                <option value="">{t("ui.stock.default")}</option>
                {(locations.data?.locations || []).filter((l) => l.isActive && !l.isDefault).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={set("notes")} /></Field>
          </>
        )}
      </section>
      <section className="panel-card"><LineItems lines={lines} onChange={setLines} mode="buy" errors={sub.fieldErrors} deviceEntry={!ordering} /></section>
      {profile.purchaseOrders && (
        <section className="panel-card form-grid form-grid--2">
          <Field label={`${t("ui.common.discount")} ${t("ui.common.optional")}`} error={sub.fieldErrors.discount}><input className="input" type="number" min="0" step="any" value={f.discount} onChange={set("discount")} /></Field>
          <Field label={`${t("ui.purchases.extraCosts")} ${t("ui.common.optional")}`} error={sub.fieldErrors.extraCosts} hint={t("ui.purchases.extraCostsHint")}><input className="input" type="number" min="0" step="any" value={f.extraCosts} onChange={set("extraCosts")} /></Field>
        </section>
      )}
      {can("purchases.pay") && !ordering && (
        <section className="panel-card form-grid form-grid--2">
          <Field label={t("ui.purchases.payNow")} error={sub.fieldErrors.amountPaid}><input className="input" type="number" min="0" step="any" max={total} value={f.amountPaid} onChange={set("amountPaid")} /></Field>
          {Number(f.amountPaid) > 0 && <div><PaymentFields method={f.method} onMethod={(v) => setF({ ...f, method: v })} bankId={f.bankAccountId} onBank={(v) => setF({ ...f, bankAccountId: v })} errors={sub.fieldErrors} /></div>}
        </section>
      )}
      <div className="doc-form__bar">
        <dl className="pos__totals pos__totals--inline">
          {(Number(f.discount) > 0 || Number(f.extraCosts) > 0) && <div><dt>{t("ui.purchases.orderValue")}</dt><dd>{m(goods)}</dd></div>}
          <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(total)}</dd></div>
          {!ordering && <div><dt>{t("ui.common.balance")}</dt><dd>{m(Math.max(0, total - (Number(f.amountPaid) || 0)))}</dd></div>}
        </dl>
        <FormError error={sub.formError} />
        <button type="submit" className="btn btn--primary btn--lg" disabled={sub.busy || !lines.length}><Icon name="check" /><span>{t(mode === "draft" ? "ui.purchases.saveDraftOrder" : ordering ? "ui.purchases.createOrder" : "ui.purchases.create")}</span></button>
      </div>
    </form>
  );
}
