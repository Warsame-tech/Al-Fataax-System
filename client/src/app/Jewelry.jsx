import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, useMoney, useErrorText, Modal, Field, FormError, EmptyState, Loading, SearchBox, PaymentFields, ReasonModal } from "./ui.jsx";
import { date, fill, qty } from "./format.js";
import { useProfile } from "./profile.js";
import { useCatalog } from "./catalog.js";
import { useAuth } from "../auth/AuthContext.jsx";

/** Weight in grams with the business's weight precision (Gold & silver rates → Weight precision). */
export function useWeight() {
  const { business } = useAuth();
  const d = business?.weightDecimals ?? 3;
  return (v) => (v === null || v === undefined || v === "" ? "—" : `${Number(v).toFixed(d)} g`);
}

/*
 * Jewelry: metal rates (per gram of metal + purity, with history), used gold bought from customers
 * (received → inspected / valued → approved → paid & held → for resale or scrap), and the price line
 * shown on receipts / invoices (rate, purity and weights a sale used).
 */
export const metalName = (t, m) => (t(`ui.jewelry.metals.${m}`).startsWith("ui.") ? m : t(`ui.jewelry.metals.${m}`));

/** Purities offered for a metal: the business type's + the business's own (Product lists). */
export function usePurities() {
  const profile = useProfile();
  const cat = useCatalog();
  const own = cat.raw.options?.purity || [];
  return (metal) => [...new Set([...(profile.purities?.[metal] || []), ...own.filter((p) => p.parent === metal).map((p) => p.name)])];
}

/** "22K · 9.900 g × $65.20 + making $44.55 + $2.00" for a sale line priced by weight */
export function PriceDetailLine({ detail, className }) {
  const { t } = useLanguage();
  const m = useMoney();
  const fmtW = useWeight();
  if (!detail) return null;
  return (
    <small className={className}>
      {metalName(t, detail.metal)} {detail.purity} · {fmtW(detail.netWeight)} × {m(detail.rate)}
      {detail.making ? ` + ${t("ui.jewelry.making")} ${m(detail.making)}` : ""}{detail.extra ? ` + ${m(detail.extra)}` : ""}
    </small>
  );
}

/* ===================== Metal rates ===================== */
export function MetalRatesPage() {
  const { t, lang } = useLanguage();
  const { refresh } = useAuth();
  const can = usePerm();
  const profile = useProfile();
  const purities = usePurities();
  const m = useMoney();
  const d = useApi("/api/jewelry/rates");
  const [form, setForm] = useState({});
  const [wd, setWd] = useState(3);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!d.data) return;
    setForm(Object.fromEntries(d.data.rates.map((r) => [`${r.metal}|${r.purity}`, String(r.rate)])));
    setWd(d.data.weightDecimals);
  }, [d.data]);
  const sub = useSubmit();
  const rows = (profile.metals || ["gold", "silver"]).flatMap((metal) => purities(metal).map((purity) => ({ metal, purity, key: `${metal}|${purity}` })));
  const current = new Map((d.data?.rates || []).map((r) => [`${r.metal}|${r.purity}`, r.rate]));
  const save = async (e) => {
    e.preventDefault();
    const rates = rows.map((r) => ({ metal: r.metal, purity: r.purity, rate: form[r.key] ?? "" }));
    if (await sub.run(() => apiRequest("/api/jewelry/rates", { method: "POST", body: { rates, weightDecimals: Number(wd) } }))) { setSaved(true); d.reload(); refresh(); setTimeout(() => setSaved(false), 2500); }
  };
  return (
    <div className="page">
      <PageHeader icon="chart-line" title={t("app.modules.metalRates")} />
      <p className="page-help"><Icon name="info" /> {t("ui.jewelry.ratesHelp")}</p>
      {!d.data ? <Loading /> : (
        <div className="split-view">
          <form onSubmit={save} className="panel-card form-grid">
            <h2 className="panel-card__title"><Icon name="chart-line" />{t("ui.jewelry.todayRates")}</h2>
            <div className="table-wrap"><table className="table table--compact">
              <thead><tr><th>{t("ui.jewelry.metal")}</th><th>{t("ui.jewelry.purity")}</th><th className="num">{t("ui.jewelry.current")}</th><th className="num">{t("ui.jewelry.newRate")}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key}>
                  <td>{metalName(t, r.metal)}</td><td><strong>{r.purity}</strong></td>
                  <td className="num">{current.has(r.key) ? m(current.get(r.key)) : "—"}</td>
                  <td className="num"><input className="input input--sm" type="number" min="0" step="any" value={form[r.key] ?? ""} disabled={!can("products.edit")}
                    onChange={(e) => setForm((x) => ({ ...x, [r.key]: e.target.value }))} placeholder={t("ui.jewelry.perGram")} aria-label={`${r.metal} ${r.purity}`} /></td>
                </tr>
              ))}</tbody>
            </table></div>
            <small className="muted">{t("ui.jewelry.addPurityHint")}</small>
            <Field label={t("ui.jewelry.weightDecimals")} hint={fill(t("ui.jewelry.weightDecimalsHint"), { example: (1.23456).toFixed(Number(wd)) })}>
              <select className="input" value={wd} onChange={(e) => setWd(e.target.value)} disabled={!can("products.edit")}>{[0, 1, 2, 3, 4].map((x) => <option key={x} value={x}>{x}</option>)}</select>
            </Field>
            <FormError error={sub.formError} />
            {saved && <p className="form-status form-status--success">{t("ui.jewelry.ratesSaved")}</p>}
            {can("products.edit") && <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.jewelry.saveRates")}</button></div>}
          </form>
          <section className="panel-card">
            <h2 className="panel-card__title"><Icon name="history" />{t("ui.jewelry.rateHistory")}</h2>
            {d.data.history.length === 0 ? <EmptyState text={t("ui.jewelry.noRates")} /> : (
              <ul className="timeline">{d.data.history.map((h, i) => (
                <li key={i}><strong>{metalName(t, h.metal)} {h.purity}: {m(h.rate)} / g</strong><small>{date(h.at, lang, true)}{h.user ? ` · ${h.user}` : ""}</small></li>
              ))}</ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/* ===================== Used gold from customers ===================== */
const GB_STATUSES = ["pending_inspection", "offered", "approved", "paid", "for_resale", "scrap", "rejected"];

export function UsedGoldPage() {
  const { t, lang } = useLanguage();
  const fmtW = useWeight();
  const can = usePerm();
  const m = useMoney();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = useApi(`/api/jewelry/gold-buys?${new URLSearchParams({ q, status })}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const rows = list.data?.goldBuys || [];
  return (
    <div className="page">
      <PageHeader icon="gem" title={t("app.modules.usedGold")} actions={can("purchases.create") && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" /><span>{t("ui.jewelry.newBuy")}</span></button>} />
      <p className="page-help"><Icon name="info" /> {t("ui.jewelry.buyHelp")}</p>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t("ui.jewelry.searchPh")} />
        <select className="input input--auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("ui.common.status")}>
          <option value="">{t("ui.common.all")}</option>
          {GB_STATUSES.map((s) => <option key={s} value={s}>{t(`ui.jewelry.status.${s}`)}</option>)}
        </select>
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="gem" text={t("ui.jewelry.noBuys")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>#</th><th>{t("ui.common.date")}</th><th>{t("ui.common.customer")}</th><th>{t("ui.common.description")}</th><th className="num">{t("ui.jewelry.netWeight")}</th><th>{t("ui.jewelry.purity")}</th><th className="num">{t("ui.jewelry.price")}</th><th>{t("ui.common.status")}</th></tr></thead>
          <tbody>{rows.map((g) => (
            <tr key={g.id} className="is-clickable" onClick={() => setOpen(g.id)}>
              <td>{g.refNo}</td><td>{date(g.at, lang)}</td><td>{g.customerName || "—"}{g.customerPhone && <small className="cell-sub">{g.customerPhone}</small>}</td>
              <td>{g.description}<small className="cell-sub">{metalName(t, g.metal)}</small></td><td className="num">{fmtW(g.netWeight)}</td>
              <td>{g.testedPurity || g.declaredPurity || "—"}{g.testedPurity && g.declaredPurity && g.testedPurity !== g.declaredPurity && <small className="cell-sub">{fill(t("ui.jewelry.declared"), { p: g.declaredPurity })}</small>}</td>
              <td className="num">{g.agreedPrice !== null ? m(g.agreedPrice) : g.offerAmount !== null ? <span className="muted">{m(g.offerAmount)}</span> : "—"}</td>
              <td><span className={`gb-status is-${g.status}`}>{t(`ui.jewelry.status.${g.status}`)}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {creating && <NewBuy onClose={() => setCreating(false)} onDone={(r) => { setCreating(false); list.reload(); setOpen(r.id); }} />}
      {open && <BuyDetail id={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </div>
  );
}

function NewBuy({ onClose, onDone }) {
  const { t } = useLanguage();
  const fmtW = useWeight();
  const profile = useProfile();
  const purities = usePurities();
  const customers = useApi("/api/customers");
  const [f, setF] = useState({ customerId: "", customerName: "", customerPhone: "", idDocument: "", description: "", metal: (profile.metals || ["gold"])[0], grossWeight: "", stoneWeight: "", declaredPurity: "" });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); const r = await sub.run(() => apiRequest("/api/jewelry/gold-buys", { method: "POST", body: f })); if (r) onDone(r); };
  const net = Math.max(0, (Number(f.grossWeight) || 0) - (Number(f.stoneWeight) || 0));
  return (
    <Modal title={t("ui.jewelry.newBuy")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2">
        <p className="modal__help ff--full">{t("ui.jewelry.newBuyHelp")}</p>
        <Field label={`${t("ui.common.customer")} ${t("ui.common.optional")}`}>
          <select className="input" value={f.customerId} onChange={set("customerId")}>
            <option value="">{t("ui.jewelry.walkIn")}</option>
            {(customers.data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {!f.customerId && <Field label={t("ui.jewelry.customerName")}><input className="input" value={f.customerName} onChange={set("customerName")} placeholder={t("ui.jewelry.customerName")} /></Field>}
        {!f.customerId && <Field label={`${t("ui.common.phone")} ${t("ui.common.optional")}`}><input className="input" type="tel" value={f.customerPhone} onChange={set("customerPhone")} placeholder={t("ui.common.phone")} /></Field>}
        <Field label={`${t("ui.jewelry.idDocument")} ${t("ui.common.optional")}`}><input className="input" value={f.idDocument} onChange={set("idDocument")} placeholder={t("ui.jewelry.idDocument")} /></Field>
        <Field label={t("ui.common.description")} error={sub.fieldErrors.description} full><input className="input" value={f.description} onChange={set("description")} placeholder={t("ui.jewelry.itemDescription")} /></Field>
        <Field label={t("ui.jewelry.metal")}>
          <select className="input" value={f.metal} onChange={set("metal")}>{(profile.metals || ["gold", "silver"]).map((x) => <option key={x} value={x}>{metalName(t, x)}</option>)}</select>
        </Field>
        <Field label={`${t("ui.jewelry.declaredPurity")} ${t("ui.common.optional")}`}>
          <select className="input" value={f.declaredPurity} onChange={set("declaredPurity")}><option value="">—</option>{purities(f.metal).map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </Field>
        <Field label={t("ui.jewelry.grossWeight")} error={sub.fieldErrors.grossWeight}><input className="input" type="number" min="0" step="any" value={f.grossWeight} onChange={set("grossWeight")} placeholder={t("ui.jewelry.grams")} /></Field>
        <Field label={`${t("ui.jewelry.stoneWeight")} ${t("ui.common.optional")}`} error={sub.fieldErrors.stoneWeight}><input className="input" type="number" min="0" step="any" value={f.stoneWeight} onChange={set("stoneWeight")} placeholder={t("ui.jewelry.grams")} /></Field>
        <p className="ff--full muted">{t("ui.jewelry.netWeight")}: <strong>{fmtW(net)}</strong></p>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.jewelry.receiveItem")}</button>
        </div>
      </form>
    </Modal>
  );
}

function BuyDetail({ id, onClose }) {
  const { t, lang } = useLanguage();
  const fmtW = useWeight();
  const can = usePerm();
  const m = useMoney();
  const errText = useErrorText();
  const purities = usePurities();
  const d = useApi(`/api/jewelry/gold-buys/${id}`);
  const g = d.data?.goldBuy;
  const [insp, setInsp] = useState({ testedPurity: "", inspection: "", valuation: "weight", deductionPct: "", offerAmount: "" });
  const [agreed, setAgreed] = useState("");
  const [pay, setPay] = useState({ method: "cash", bankAccountId: "" });
  const [resale, setResale] = useState({ name: "", pricingMode: "weight", sellingPrice: "" });
  const [rejecting, setRejecting] = useState(false);
  const sub = useSubmit();
  useEffect(() => {
    if (!g) return;
    setInsp((x) => ({ ...x, testedPurity: g.testedPurity || g.declaredPurity || "" }));
    setAgreed(g.offerAmount !== null ? String(g.offerAmount) : "");
    setResale((x) => ({ ...x, name: g.description }));
  }, [g?.id, g?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (path, body) => sub.run(() => apiRequest(`/api/jewelry/gold-buys/${id}/${path}`, { method: "POST", body })).then((ok) => { if (ok) d.reload(); return ok; });
  const rate = g && (d.data.rates || []).find((r) => r.metal === g.metal && r.purity === insp.testedPurity)?.rate;
  const preview = g && rate !== undefined && insp.valuation === "weight" ? Math.round(g.netWeight * rate * (1 - (Number(insp.deductionPct) || 0) / 100) * 100) / 100 : null;
  const EVENT = (e) => t(`ui.jewelry.events.${e}`);
  return (
    <Modal title={g ? `${g.refNo} · ${g.description}` : t("ui.common.loading")} onClose={onClose} wide footer={g && (
      <div className="statement-foot">
        <span className={`gb-status is-${g.status}`}>{t(`ui.jewelry.status.${g.status}`)}</span>
        <div className="form-actions">
          {["pending_inspection", "offered", "approved"].includes(g.status) && can("purchases.create") && <button type="button" className="btn btn--danger" onClick={() => setRejecting(true)}>{t("ui.jewelry.reject")}</button>}
          <button type="button" className="btn btn--outline" onClick={() => window.print()}><Icon name="printer" /><span>{t("invoice.printOnly")}</span></button>
        </div>
      </div>
    )}>
      {!g ? <Loading /> : (
        <div className="form-grid gb-detail">
          <div className="gb-receipt">
            <h3>{d.data.business.name} · {t("ui.jewelry.receiptTitle")}</h3>
            <dl className="adj-preview">
              <div><dt>{t("ui.jewelry.ref")}</dt><dd>{g.refNo}</dd></div>
              <div><dt>{t("ui.common.date")}</dt><dd>{date(g.at, lang, true)}</dd></div>
              <div><dt>{t("ui.common.customer")}</dt><dd>{g.customerName || "—"}{g.customerPhone ? ` · ${g.customerPhone}` : ""}{g.idDocument ? ` · ${g.idDocument}` : ""}</dd></div>
              <div><dt>{t("ui.jewelry.weights")}</dt><dd>{fmtW(g.grossWeight)} − {fmtW(g.stoneWeight)} = <strong>{fmtW(g.netWeight)}</strong></dd></div>
              <div><dt>{t("ui.jewelry.purity")}</dt><dd>{metalName(t, g.metal)} · {fill(t("ui.jewelry.declared"), { p: g.declaredPurity || "—" })}{g.testedPurity ? ` · ${fill(t("ui.jewelry.tested"), { p: g.testedPurity })}` : ""}</dd></div>
              {g.suggestedValue !== null && <div><dt>{t("ui.jewelry.suggested")}</dt><dd>{m(g.suggestedValue)}<small className="cell-sub">{fmtW(g.netWeight)} × {m(g.rateUsed)}{g.deductionPct ? ` − ${g.deductionPct}%` : ""}</small></dd></div>}
              {g.agreedPrice !== null && <div><dt>{t("ui.jewelry.agreed")}</dt><dd><strong>{m(g.agreedPrice)}</strong>{g.approvedBy ? <small className="cell-sub">{fill(t("ui.jewelry.approvedBy"), { name: g.approvedBy })}</small> : null}</dd></div>}
              {g.paidAmount > 0 && <div><dt>{t("ui.jewelry.paid")}</dt><dd>{m(g.paidAmount)} · {t(`ui.methods.${g.paymentMethod}`)}</dd></div>}
            </dl>
            {g.inspection && <p className="muted">{t("ui.jewelry.findings")}: {g.inspection}</p>}
          </div>

          {/* 2. inspection + valuation */}
          {["pending_inspection", "offered"].includes(g.status) && can("purchases.create") && (
            <section className="panel-card form-grid form-grid--2 no-print">
              <h3 className="panel-card__title ff--full"><Icon name="search-glass" />{t("ui.jewelry.stepInspect")}</h3>
              <Field label={t("ui.jewelry.testedPurity")} error={sub.fieldErrors.testedPurity && (sub.fieldErrors.testedPurity === "noRate" ? "noRate" : "required")}>
                <select className="input" value={insp.testedPurity} onChange={(e) => setInsp({ ...insp, testedPurity: e.target.value })}><option value="">—</option>{purities(g.metal).map((p) => <option key={p} value={p}>{p}</option>)}</select>
              </Field>
              <Field label={t("ui.jewelry.valuation")}>
                <div className="seg">{["weight", "manual"].map((v) => <button key={v} type="button" aria-pressed={insp.valuation === v} onClick={() => setInsp({ ...insp, valuation: v })}>{t(`ui.jewelry.valuations.${v}`)}</button>)}</div>
              </Field>
              <Field label={t("ui.jewelry.findings")} full><input className="input" value={insp.inspection} onChange={(e) => setInsp({ ...insp, inspection: e.target.value })} placeholder={t("ui.jewelry.findings")} /></Field>
              {insp.valuation === "weight" && <Field label={t("ui.jewelry.deduction")} hint={t("ui.jewelry.deductionHint")}><input className="input" type="number" min="0" max="100" step="any" value={insp.deductionPct} onChange={(e) => setInsp({ ...insp, deductionPct: e.target.value })} placeholder="0" /></Field>}
              <Field label={t("ui.jewelry.offer")} error={sub.fieldErrors.offerAmount} hint={preview !== null ? fill(t("ui.jewelry.suggestedIs"), { amount: m(preview), rate: m(rate) }) : insp.valuation === "weight" && insp.testedPurity ? t("ui.jewelry.noRateHint") : undefined}>
                <input className="input" type="number" min="0" step="any" value={insp.offerAmount} onChange={(e) => setInsp({ ...insp, offerAmount: e.target.value })} placeholder={preview !== null ? String(preview) : t("ui.jewelry.offer")} />
              </Field>
              <div className="form-actions ff--full"><button type="button" className="btn btn--primary" disabled={sub.busy} onClick={() => step("inspect", insp)}>{t("ui.jewelry.saveInspection")}</button></div>
            </section>
          )}
          {/* 3. approval */}
          {g.status === "offered" && can("purchases.pay") && (
            <section className="panel-card form-grid form-grid--2 no-print">
              <h3 className="panel-card__title ff--full"><Icon name="check" />{t("ui.jewelry.stepApprove")}</h3>
              <Field label={t("ui.jewelry.agreed")} error={sub.fieldErrors.agreedPrice}><input className="input" type="number" min="0" step="any" value={agreed} onChange={(e) => setAgreed(e.target.value)} /></Field>
              <div className="form-actions"><button type="button" className="btn btn--primary" disabled={sub.busy} onClick={() => step("approve", { agreedPrice: agreed })}>{t("ui.jewelry.approve")}</button></div>
            </section>
          )}
          {/* 4. payment */}
          {g.status === "approved" && can("purchases.pay") && (
            <section className="panel-card form-grid form-grid--2 no-print">
              <h3 className="panel-card__title ff--full"><Icon name="wallet" />{fill(t("ui.jewelry.stepPay"), { amount: m(g.agreedPrice) })}</h3>
              <div className="ff--full"><PaymentFields method={pay.method} onMethod={(v) => setPay({ ...pay, method: v })} bankId={pay.bankAccountId} onBank={(v) => setPay({ ...pay, bankAccountId: v })} errors={sub.fieldErrors} /></div>
              <div className="form-actions ff--full"><button type="button" className="btn btn--primary" disabled={sub.busy} onClick={() => step("pay", pay)}>{t("ui.jewelry.payCustomer")}</button></div>
            </section>
          )}
          {/* 5. decision after holding */}
          {g.status === "paid" && can("purchases.pay") && (
            <section className="panel-card form-grid form-grid--2 no-print">
              <h3 className="panel-card__title ff--full"><Icon name="layers" />{t("ui.jewelry.stepDecide")}</h3>
              <p className="modal__help ff--full">{t("ui.jewelry.holdHelp")}</p>
              <Field label={t("ui.common.name")}><input className="input" value={resale.name} onChange={(e) => setResale({ ...resale, name: e.target.value })} placeholder={t("ui.common.name")} /></Field>
              <Field label={t("ui.jewelry.pricing")}>
                <div className="seg">{["weight", "fixed"].map((v) => <button key={v} type="button" aria-pressed={resale.pricingMode === v} onClick={() => setResale({ ...resale, pricingMode: v })}>{t(`ui.jewelry.pricingModes.${v}`)}</button>)}</div>
              </Field>
              {resale.pricingMode === "fixed" && <Field label={t("ui.products.sellingPrice")}><input className="input" type="number" min="0" step="any" value={resale.sellingPrice} onChange={(e) => setResale({ ...resale, sellingPrice: e.target.value })} /></Field>}
              <div className="form-actions ff--full">
                <button type="button" className="btn btn--outline" disabled={sub.busy} onClick={() => step("decide", { action: "scrap" })}>{t("ui.jewelry.toScrap")}</button>
                <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={() => step("decide", { action: "resale", ...resale })}>{t("ui.jewelry.toResale")}</button>
              </div>
            </section>
          )}
          {g.status === "for_resale" && g.productId && <p className="form-status form-status--success no-print">{t("ui.jewelry.inStockNow")} <Link to="/app/m/products">{t("app.modules.products")}</Link></p>}
          {sub.formError && <p className="form-status form-status--error no-print">{errText(sub.formError)}</p>}

          <h3 className="panel-card__title no-print"><Icon name="history" />{t("ui.jewelry.history")}</h3>
          <ul className="timeline no-print">{d.data.history.map((h, i) => (
            <li key={i}>
              <strong>{EVENT(h.event)}</strong>
              <small>{date(h.at, lang, true)}{h.user ? ` · ${h.user}` : ""}</small>
              {h.detail?.reason && <span>{h.detail.reason}</span>}
              {h.detail?.inspection && <span>{h.detail.inspection}</span>}
              {h.detail?.agreedPrice !== undefined && <span>{m(h.detail.agreedPrice)}</span>}
              {h.detail?.amount !== undefined && <span>{m(h.detail.amount)} · {t(`ui.methods.${h.detail.method}`)}</span>}
            </li>
          ))}</ul>
        </div>
      )}
      {rejecting && <ReasonModal title={t("ui.jewelry.reject")} help={t("ui.jewelry.rejectHelp")} confirmLabel={t("ui.jewelry.reject")}
        onConfirm={(reason) => step("reject", { reason })} onClose={() => setRejecting(false)} />}
    </Modal>
  );
}
