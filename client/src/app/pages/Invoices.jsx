import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, Money, EmptyState, Loading, SearchBox, PaymentFields, StatusBadge, DateRange, daysAgo, isoDate } from "../ui.jsx";
import LineItems, { sellItems, linesBelowMin } from "./LineItems.jsx";
import { ManagerApproval, BelowCostAlert } from "./Pos.jsx";
import { canChangePrice } from "../pricing.js";
import { date, fill } from "../format.js";
import SearchSelect from "../SearchSelect.jsx";
import { VAT_RATE, vatOf } from "../vat.js";
import { useDraft, DraftBar } from "../Drafts.jsx";
import { unitsPer, packPrice } from "../packaging.js";

const STATUSES = ["", "draft", "unpaid", "partially_paid", "overdue", "paid", "cancelled"];

export default function Invoices() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: daysAgo(89), to: isoDate(new Date()) });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rules, setRules] = useState(false);   // owner: which invoice changes need a manager's approval
  const list = useApi(`/api/invoices?${new URLSearchParams({ ...range, q, status })}`);
  const rows = list.data?.invoices || [];

  return (
    <div className="page">
      <PageHeader icon="receipt" title={t("ui.invoices.title")} actions={
        <>
          {can("settings.edit") && <button type="button" className="btn btn--outline" onClick={() => setRules(true)}><Icon name="lock" /><span>{t("ui.invEdit.rules")}</span></button>}
          {can("invoices.create") && <Link className="btn btn--primary" to="/app/invoices/new"><Icon name="plus" /><span>{t("ui.invoices.new")}</span></Link>}
        </>
      } />
      {rules && <EditRules onClose={() => setRules(false)} />}
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
                <tr key={i.id} className="is-clickable" onClick={() => navigate(`/app/invoices/${i.id}`)}>
                  <td><Link to={`/app/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}>{i.number}</Link></td>
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

/* Owner setting: which changes to a posted / paid invoice need a manager's approval (PUT /api/invoices/edit-rules). */
const RULES = ["prices", "quantities", "items", "discount", "customer"];
function EditRules({ onClose }) {
  const { t } = useLanguage();
  const r = useApi("/api/invoices/edit-rules");
  const [v, setV] = useState(null);
  const sub = useSubmit();
  const rules = v || r.data?.rules;
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/invoices/edit-rules", { method: "PUT", body: { rules } }))) onClose(); };
  return (
    <Modal title={t("ui.invEdit.rulesTitle")} onClose={onClose}>
      {!rules ? <Loading /> : (
        <form onSubmit={save} className="form-grid">
          <p className="modal__help">{t("ui.invEdit.rulesHelp")}</p>
          {RULES.map((k) => (
            <label key={k} className="check-row"><input type="checkbox" checked={Boolean(rules[k])} onChange={(e) => setV({ ...rules, [k]: e.target.checked })} /> {t(`ui.invEdit.ruleNames.${k}`)}</label>
          ))}
          <FormError error={sub.formError} />
          <div className="form-actions">
            <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
            <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* Discount typed as an amount ("5") or a percentage ("10%"); empty = none. Mirrors the server rule. */
function discountOf(value, subtotal) {
  const raw = String(value || "").trim().replace(",", ".");
  if (!raw) return { amount: 0 };
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(raw);
  if (pct) return Number(pct[1]) <= 100 ? { amount: Math.round(subtotal * Number(pct[1]) * 100) / 10000, percent: Number(pct[1]) } : { error: true };
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? { amount: Math.round(n * 10000) / 10000 } : { error: true };
}

/*
 * New invoice (/app/invoices/new) and edit invoice (/app/invoices/:id/edit, server rules: lib/invoiceEdits.js).
 * Editing: the invoice's lines are loaded (locked ones — serial / IMEI, roll, recipe — can't change), a reason is asked for
 * posted invoices, changes in the business's rules need a manager's approval, and a total below what was paid asks how
 * the difference is refunded. New invoices can be saved as a draft.
 */
export function InvoiceForm() {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const editing = Boolean(editId);
  const customers = useApi("/api/customers");
  const ed = useApi(editing ? `/api/invoices/${editId}/edit` : null);
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState({ method: "cash", bankAccountId: "" });
  const [editApproval, setEditApproval] = useState(null);   // { token, approver } a manager approved the changes
  const [askingEdit, setAskingEdit] = useState(false);
  const [loaded, setLoaded] = useState(!editing);
  const [f, setF] = useState({ vat: false, customerId: "", billPhone: "", billAddress: "", priceList: "retail", issueDate: isoDate(new Date()), dueDate: isoDate(new Date(Date.now() + 14 * 86400000)), discount: "", discountLabel: "", notes: "", amountPaid: "", method: "cash", bankAccountId: "" });
  const [lines, setLines] = useState([]);
  const [newCustomer, setNewCustomer] = useState(null);   // typed name for the "New customer" form
  const draft = useDraft("invoice");
  const sub = useSubmit();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const list = customers.data?.customers || [];

  /* editing: the form starts from the invoice as it is (each line keeps its row, its quantity counts as available stock) */
  useEffect(() => {
    if (!editing || loaded || !ed.data) return;
    const inv = ed.data.invoice;
    apiRequest("/api/products?location=default&active=all").then(async ({ products }) => {
      const byId = new Map(products.map((x) => [x.id, x]));
      for (const it of ed.data.items) {
        if (!byId.has(it.productId)) { try { const r = await apiRequest(`/api/products?active=all&id=${it.productId}`); if (r.products[0]) byId.set(it.productId, r.products[0]); } catch { /* left out */ } }
      }
      setF((x) => ({ ...x, customerId: String(inv.customerId), billPhone: inv.billPhone, billAddress: inv.billAddress, priceList: inv.priceList, issueDate: inv.issueDate || "",
        dueDate: inv.dueDate || "", discount: inv.discount ? String(inv.discount) : "", discountLabel: inv.discountLabel || "", notes: inv.notes || "", vat: Boolean(inv.vat) }));
      setLines(ed.data.items.filter((it) => byId.has(it.productId)).map((it) => {
        const product = byId.get(it.productId);
        return { product, itemId: it.itemId, qty: it.qty, unit: it.unit && it.unit !== product.unit ? it.unit : null, price: it.unitPrice, locked: it.locked, held: it.baseQty };
      }));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [ed.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const disc = discountOf(f.discount, subtotal);
  const vat = vatOf(f.vat, Math.max(0, subtotal - (disc.amount || 0)));
  const total = Math.max(0, subtotal - (disc.amount || 0)) + vat;
  const allowDiscount = can("sales.discount");
  // a line's price may be changed by the product's price mode (app/pricing.js); below the minimum needs a manager
  const allowPrice = (p) => canChangePrice(can, p);
  const [approval, setApproval] = useState(null);   // { token, approver } prices below the minimum approved
  const [asking, setAsking] = useState(false);
  const below = linesBelowMin(lines);
  const needsApproval = below.length > 0 && !can("prices.approve") && !approval;
  const customer = list.find((c) => String(c.id) === String(f.customerId)) || null;
  // never below the cost price: the server says which lines (or the discount) would sell below cost, without showing the cost
  // (editing: kept lines keep the price they were sold at, so only the server checks them)
  const [costCheck, setCostCheck] = useState({ lines: [], bill: false });
  const costKey = JSON.stringify([sellItems(lines, allowPrice), f.priceList, f.customerId, disc.amount || 0]);
  useEffect(() => {
    if (!lines.length || editing) { setCostCheck({ lines: [], bill: false }); return undefined; }
    const timer = setTimeout(() => {
      apiRequest("/api/sales/price-check", { method: "POST", body: { items: sellItems(lines, allowPrice), customerId: f.customerId || null, priceList: f.priceList, discount: disc.amount || 0 } })
        .then((r) => { setCostCheck(r); if (r.lines.length || r.bill) setCostAlert(true); }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [costKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const belowCost = costCheck.lines.length > 0 || costCheck.bill;
  const [costAlert, setCostAlert] = useState(false);   // the "can't sell below cost" pop-up
  useEffect(() => { if (Object.values(sub.fieldErrors || {}).includes("belowCost")) setCostAlert(true); }, [sub.fieldErrors]);

  /* choosing a customer fills their business phone and address (editable for this invoice) and their price type's prices */
  const pickCustomer = (cid, fromList = list) => {
    const c = fromList.find((x) => String(x.id) === String(cid));
    setF((x) => ({ ...x, customerId: cid, billPhone: c?.phone || "", billAddress: c?.address || "" }));
    if (!editing) changePriceList(c?.priceTier === "wholesale" ? "wholesale" : "retail");   // an edit keeps the invoice's price list
  };
  const changePriceList = (pl) => {
    setF((x) => ({ ...x, priceList: pl }));
    setLines((ls) => ls.map((l) => {
      const base = pl === "wholesale" && l.product.wholesalePrice !== null ? l.product.wholesalePrice : l.product.sellingPrice;
      if (!l.unit) return { ...l, price: base };
      return { ...l, price: pl === "wholesale" && l.product.wholesalePrice !== null ? Math.round(base * (unitsPer(l.product, l.unit) || 1) * 10000) / 10000 : packPrice(l.product, l.unit, base) };
    }));
  };

  /* editing: what the invoice is, what was paid, and what the change needs */
  const edInv = ed.data?.invoice;
  const status = edInv?.status;
  const posted = editing && status && status !== "draft";
  const paidSoFar = edInv?.paid || 0;
  const excess = posted ? Math.round((paidSoFar - total) * 10000) / 10000 : 0;
  const needsEditApproval = sub.formError?.code === "invoiceEditNeedsApproval" && !editApproval ? sub.formError.data?.groups || [] : [];

  const save = async (e, asDraft = false) => {
    e?.preventDefault();
    if (belowCost) { setCostAlert(true); return; }
    if (editing) {
      if (posted && !reason.trim()) { sub.setFieldErrors({ reason: "required" }); return; }
      const body = {
        revision: ed.data.revision, reason: reason.trim(), customerId: f.customerId, billPhone: f.billPhone, billAddress: f.billAddress, issueDate: f.issueDate, dueDate: f.dueDate,
        notes: f.notes, priceList: f.priceList, discount: f.discount, discountLabel: f.discountLabel, vat: f.vat,
        items: lines.map((l) => ({ ...(l.itemId ? { itemId: l.itemId } : {}), productId: l.product.id, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), unitPrice: l.price })),
        ...(editApproval ? { approvalToken: editApproval.token } : {}), ...(approval ? { priceApprovalToken: approval.token } : {}), ...(excess > 0 ? { refund } : {})
      };
      const r = await sub.run(() => apiRequest(`/api/invoices/${editId}`, { method: "PUT", body }));
      if (r) navigate(`/app/invoices/${editId}`, { replace: true });
      return;
    }
    const body = { ...f, items: sellItems(lines, allowPrice), ...(approval ? { priceApprovalToken: approval.token } : {}), ...(asDraft ? { draft: true, amountPaid: "" } : {}) };
    const r = await sub.run(() => apiRequest("/api/invoices", { method: "POST", body }));
    if (r) { await draft.finish(); navigate(`/app/invoices/${r.id}`, { replace: true }); }
  };

  if (editing && (ed.loading || !loaded)) return <div className="page"><Loading /></div>;
  if (editing && ed.data && (!ed.data.needs || !ed.data.canEdit)) {
    return (
      <div className="page">
        <PageHeader icon="receipt" title={fill(t("ui.invEdit.editTitle"), { number: edInv.number })} back={`/app/invoices/${editId}`} />
        <p className="form-status form-status--error">{t(ed.data.needs ? "ui.invEdit.noPermission" : "ui.invEdit.noEdit")}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader icon="receipt" title={editing ? fill(t("ui.invEdit.editTitle"), { number: edInv?.number }) : t("ui.invoices.new")} back={editing ? `/app/invoices/${editId}` : "/app/m/invoices"} actions={
        !editing && <DraftBar draft={draft} canSave={lines.length > 0 || Boolean(f.customerId)}
          title={`${list.find((c) => String(c.id) === String(f.customerId))?.name || t("ui.invoices.title")} · ${m(total)}`}
          getData={() => ({ f, lines })} onLoad={(d) => { setF((x) => ({ ...x, ...d.f })); setLines(d.lines || []); }} />
      } />
      <form onSubmit={save} className="doc-form">
        {editing && <p className={"form-status " + (posted ? "form-status--info" : "form-status--success") + " inv-edit-rule"}><Icon name="info" /> {t(`ui.invEdit.statusRules.${status}`)}{paidSoFar > 0 && <> · {fill(t("ui.invEdit.paidSoFar"), { amount: m(paidSoFar) })}</>}</p>}
        <section className="panel-card form-grid form-grid--3">
          <div className="ff">
            <span className="ff__label">{t("ui.common.customer")}</span>
            <SearchSelect value={f.customerId} onChange={(v) => pickCustomer(v)} placeholder={t("ui.invoices.chooseCustomer")} searchPlaceholder={t("ui.invoices.searchCustomer")}
              options={list.map((c) => ({ value: c.id, label: c.name, sub: [c.phone, c.address].filter(Boolean).join(" · ") }))}
              onCreate={can("customers.edit") ? (text) => setNewCustomer(text) : undefined} createLabel={t("ui.invoices.newCustomer")} invalid={Boolean(sub.fieldErrors.customerId)} />
            {sub.fieldErrors.customerId && <span className="ff__error">{t("ui.errors.required")}</span>}
          </div>
          <Field label={t("ui.invoices.issueDate")}><input className="input" type="date" value={f.issueDate} onChange={set("issueDate")} /></Field>
          <Field label={t("ui.invoices.dueDate")} error={sub.fieldErrors.dueDate}><input className="input" type="date" value={f.dueDate} min={f.issueDate} onChange={set("dueDate")} /></Field>
          <Field label={`${t("ui.invoices.businessPhone")} ${t("ui.common.optional")}`}><input className="input" type="tel" value={f.billPhone} onChange={set("billPhone")} placeholder={t("ui.invoices.phonePh")} /></Field>
          <Field label={`${t("ui.invoices.businessAddress")} ${t("ui.common.optional")}`}><input className="input" value={f.billAddress} onChange={set("billAddress")} placeholder={t("ui.invoices.addressPh")} /></Field>
          {/* the customer's price type picks the list; using the other one is a price change (prices.edit) */}
          <Field label={t("ui.invoices.priceList")} hint={customer ? `${t("ui.pricing.fromCustomer")}: ${t(`ui.pricing.tiers.${customer.priceTier || "retail"}`)}` : undefined} error={sub.fieldErrors.priceList}>
            <div className="seg">{["retail", "wholesale"].map((pl) => <button key={pl} type="button" aria-pressed={f.priceList === pl} disabled={!can("prices.edit") && f.priceList !== pl} onClick={() => changePriceList(pl)}>{t(`ui.invoices.${pl}`)}</button>)}</div>
          </Field>
        </section>

        <section className="panel-card">
          <LineItems lines={lines} onChange={setLines} mode="sell" priceList={f.priceList} allowPrice={allowPrice} errors={sub.fieldErrors} />
          {below.length > 0 && (
            <p className={"form-status " + (needsApproval ? "form-status--error" : "form-status--info")} role="status">
              {approval ? <><Icon name="check" /> {fill(t("ui.pricing.approvedBy"), { name: approval.approver })}</> : needsApproval ? t("ui.pricing.needsApproval") : null}
              {needsApproval && <> <button type="button" className="btn btn--outline btn--sm" onClick={() => setAsking(true)}><Icon name="lock" /><span>{t("ui.pricing.askApproval")}</span></button></>}
            </p>
          )}
        </section>

        <section className="panel-card form-grid form-grid--2">
          <Field label={`${t("ui.common.discount")} ${t("ui.common.optional")}`} error={sub.fieldErrors.discount === "invalidDiscount" ? undefined : sub.fieldErrors.discount}
            hint={!allowDiscount ? t("ui.pos.noDiscount") : disc.error ? null : disc.percent !== undefined ? fill(t("ui.invoices.discountIs"), { amount: m(disc.amount) }) : t("ui.invoices.discountHint")}>
            <input className={"input" + (disc.error ? " has-error" : "")} value={f.discount} disabled={!allowDiscount} onChange={set("discount")} placeholder={t("ui.invoices.discountPh")} inputMode="decimal" />
          </Field>
          <Field label={`${t("ui.invoices.discountLabel")} ${t("ui.common.optional")}`}>
            <input className="input" value={f.discountLabel} disabled={!allowDiscount || !f.discount} onChange={set("discountLabel")} placeholder={t("ui.invoices.discountLabelPh")} maxLength={80} />
          </Field>
          {(disc.error || sub.fieldErrors.discount === "invalidDiscount") && <p className="form-status form-status--error ff--full">{t("ui.errors.invalidDiscount")}</p>}
          <div className="ff ff--full">
            <label className="vat-switch">
              <input type="checkbox" checked={f.vat} onChange={(e) => setF((x) => ({ ...x, vat: e.target.checked }))} />
              {fill(t("ui.pos.addVat"), { rate: VAT_RATE })}
            </label>
            <span className="ff__hint">{t("ui.invoices.vatHint")}</span>
          </div>
          <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={set("notes")} /></Field>
          {!editing && <Field label={t("ui.invoices.payNow")} error={sub.fieldErrors.amountPaid}><input className="input" type="number" min="0" step="any" max={total} value={f.amountPaid} onChange={set("amountPaid")} /></Field>}
          {!editing && Number(f.amountPaid) > 0 && <div className="ff--full"><PaymentFields method={f.method} onMethod={(v) => setF((x) => ({ ...x, method: v }))} bankId={f.bankAccountId} onBank={(v) => setF((x) => ({ ...x, bankAccountId: v }))} errors={sub.fieldErrors} /></div>}
        </section>

        {editing && (
          <section className="panel-card form-grid form-grid--2">
            <Field label={posted ? t("ui.invEdit.reason") : `${t("ui.invEdit.reason")} ${t("ui.common.optional")}`} error={sub.fieldErrors.reason} full hint={posted ? t("ui.invEdit.reasonNeeded") : undefined}>
              <textarea className="input" rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ui.invEdit.reasonPh")} maxLength={255} />
            </Field>
            {excess > 0 && (
              <div className="ff ff--full inv-edit-refund">
                <strong>{t("ui.invEdit.refundTitle")}</strong>
                <span className="ff__hint">{fill(t("ui.invEdit.refundHelp"), { amount: m(excess) })}</span>
                <PaymentFields method={refund.method} onMethod={(v) => setRefund((x) => ({ ...x, method: v }))} bankId={refund.bankAccountId} onBank={(v) => setRefund((x) => ({ ...x, bankAccountId: v }))} errors={sub.fieldErrors} />
              </div>
            )}
            {needsEditApproval.length > 0 && (
              <p className="form-status form-status--error ff--full">
                {fill(t("ui.invEdit.needsApproval"), { groups: needsEditApproval.map((g) => t(`ui.invEdit.groups.${g}`)).join(", ") })}{" "}
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setAskingEdit(true)}><Icon name="lock" /><span>{t("ui.invEdit.approve")}</span></button>
              </p>
            )}
            {editApproval && <p className="form-status form-status--success ff--full"><Icon name="check" /> {fill(t("ui.invEdit.approvedBy"), { name: editApproval.approver })}</p>}
          </section>
        )}

        <div className="doc-form__bar">
          <dl className="pos__totals pos__totals--inline">
            <div><dt>{t("ui.common.subtotal")}</dt><dd>{m(subtotal)}</dd></div>
            {disc.amount > 0 && <div><dt>{t("ui.common.discount")}</dt><dd>− {m(disc.amount)}</dd></div>}
            {vat > 0 && <div><dt>{fill(t("ui.pos.vatLine"), { rate: VAT_RATE })}</dt><dd>{m(vat)}</dd></div>}
            <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(total)}</dd></div>
            <div><dt>{t("ui.common.balance")}</dt><dd>{m(Math.max(0, total - (editing ? paidSoFar : Number(f.amountPaid) || 0)))}</dd></div>
          </dl>
          {!(sub.formError?.code === "invoiceEditNeedsApproval") && <FormError error={sub.formError} />}
          {sub.formError?.code === "invoiceChanged" && <button type="button" className="btn btn--outline btn--sm" onClick={() => window.location.reload()}>{t("ui.invEdit.reload")}</button>}
          {costCheck.lines.length > 0 && <p className="form-status form-status--error" role="alert">{fill(t("ui.pricing.belowCostLines"), { names: costCheck.lines.map((i) => lines[i]?.product.name).filter(Boolean).join(", ") })}</p>}
          {costCheck.bill && <p className="form-status form-status--error" role="alert">{t("ui.pricing.belowCostBill")}</p>}
          {!editing && <button type="button" className="btn btn--outline btn--lg" disabled={sub.busy || !lines.length || disc.error} onClick={(e) => save(e, true)} title={t("ui.invEdit.draftNote")}><Icon name="file-chart" /><span>{t("ui.invEdit.saveDraft")}</span></button>}
          <button type="submit" className="btn btn--primary btn--lg" disabled={sub.busy || !lines.length || disc.error || needsApproval}><Icon name="check" /><span>{editing ? t(sub.busy ? "ui.invEdit.saving" : "ui.invEdit.save") : t("ui.invoices.create")}</span></button>
        </div>
      </form>
      {askingEdit && <ManagerApproval what="invoiceEdit" onClose={() => setAskingEdit(false)} onApproved={(a) => { setEditApproval(a); setAskingEdit(false); sub.setFormError?.(null); }} />}
      {costAlert && (
        <BelowCostAlert onClose={() => setCostAlert(false)} bill={costCheck.bill || sub.fieldErrors?.discount === "belowCost"}
          names={(costCheck.lines.length ? costCheck.lines : Object.keys(sub.fieldErrors || {}).filter((k) => sub.fieldErrors[k] === "belowCost" && k.startsWith("items.")).map((k) => Number(k.split(".")[1])))
            .map((i) => lines[i]?.product.name).filter(Boolean)} />
      )}
      {asking && <ManagerApproval what="price" onClose={() => setAsking(false)} onApproved={(a) => { setApproval(a); setAsking(false); }} />}
      {newCustomer !== null && (
        <NewCustomerForm name={newCustomer} onClose={() => setNewCustomer(null)} onSaved={async (created) => {
          setNewCustomer(null);
          const d = await customers.reload();
          const fresh = d?.customers || [...list, created];
          pickCustomer(created.id, fresh.some((c) => c.id === created.id) ? fresh : [...fresh, created]);
        }} />
      )}
    </div>
  );
}

/* Register a customer without leaving the invoice. */
function NewCustomerForm({ name, onClose, onSaved }) {
  const { t } = useLanguage();
  const can = usePerm();
  const [f, setF] = useState({ name: name || "", phone: "", address: "", email: "", priceTier: "retail" });
  const sub = useSubmit();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const r = await sub.run(() => apiRequest("/api/customers", { method: "POST", body: f }));
    if (r) onSaved({ id: r.id, ...f, balance: 0, overdue: 0 });
  };
  return (
    <Modal title={t("ui.invoices.newCustomer")} onClose={onClose}>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.name")} error={sub.fieldErrors.name} full><input className="input" value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label={`${t("ui.invoices.businessPhone")} ${t("ui.common.optional")}`}><input className="input" type="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={`${t("ui.common.email")} ${t("ui.common.optional")}`} error={sub.fieldErrors.email}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={`${t("ui.invoices.businessAddress")} ${t("ui.common.optional")}`} full><input className="input" value={f.address} onChange={set("address")} /></Field>
        {can("prices.edit") && (
          <Field label={t("ui.pricing.priceTier")} error={sub.fieldErrors.priceTier} full hint={t("ui.pricing.priceTierHint")}>
            <div className="seg">{["retail", "wholesale"].map((x) => <button key={x} type="button" aria-pressed={f.priceTier === x} onClick={() => setF((v) => ({ ...v, priceTier: x }))}>{t(`ui.pricing.tiers.${x}`)}</button>)}</div>
          </Field>
        )}
        <FormError error={sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t(sub.busy ? "ui.common.saving" : "ui.invoices.saveCustomer")}</button>
        </div>
      </form>
    </Modal>
  );
}
