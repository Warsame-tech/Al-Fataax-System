import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, EmptyState, Loading, SearchBox, DateRange, daysAgo, isoDate } from "./ui.jsx";
import { date, fill } from "./format.js";

/*
 * Promotions (lib/promotions.js): % or amount off items, special price, buy N get M free, order discounts from a total;
 * eligible products / categories, dates and weekdays. Discount rules: approval level and maximum for manual discounts.
 * Discount history: who gave each discount, who approved it, which promotions a sale used.
 */
const KINDS = ["percent", "amount", "price", "bogo", "order_percent", "order_amount"];
const DAYS = [1, 2, 3, 4, 5, 6, 7];   // Sunday = 1

export function PromotionsPage() {
  const { t } = useLanguage();
  const can = usePerm();
  const [tab, setTab] = useState("list");
  return (
    <div className="page">
      <PageHeader icon="percent" title={t("app.modules.promotions")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "list", label: t("ui.promo.title"), icon: "percent" }, { id: "history", label: t("ui.promo.history"), icon: "history" },
        ...(can("settings.edit") ? [{ id: "rules", label: t("ui.promo.rules"), icon: "lock" }] : [])]} />
      {tab === "list" ? <PromoList /> : tab === "history" ? <DiscountHistory /> : <DiscountRules />}
    </div>
  );
}

function promoText(t, m, p) {
  if (p.kind === "percent") return fill(t("ui.promo.describe.percent"), { v: p.value });
  if (p.kind === "amount") return fill(t("ui.promo.describe.amount"), { v: m(p.value) });
  if (p.kind === "price") return fill(t("ui.promo.describe.price"), { v: m(p.value) });
  if (p.kind === "bogo") return fill(t("ui.promo.describe.bogo"), { buy: p.buyQty, get: p.getQty });
  if (p.kind === "order_percent") return fill(t("ui.promo.describe.order_percent"), { v: p.value, min: m(p.minTotal) });
  return fill(t("ui.promo.describe.order_amount"), { v: m(p.value), min: m(p.minTotal) });
}

function PromoList() {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const list = useApi("/api/promotions");
  const [editing, setEditing] = useState(null);
  const rows = list.data?.promotions || [];
  return (
    <>
      <div className="toolbar"><p className="page-help"><Icon name="info" /> {t("ui.promo.help")}</p>
        <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.promo.add")}</span></button></div>
      {list.loading && !list.data ? <Loading /> : !rows.length ? <EmptyState icon="percent" text={t("ui.promo.none")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.common.name")}</th><th>{t("ui.promo.offer")}</th><th>{t("ui.promo.appliesTo")}</th><th>{t("ui.promo.when")}</th><th>{t("ui.common.status")}</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className="is-clickable" onClick={() => setEditing(p)}>
              <td><strong>{p.name}</strong></td><td>{promoText(t, m, p)}</td>
              <td>{p.kind.startsWith("order_") ? t("ui.promo.wholeOrder") : !p.productIds.length && !p.categoryIds.length ? t("ui.promo.allItems") : fill(t("ui.promo.chosenN"), { n: p.productIds.length + p.categoryIds.length })}</td>
              <td>{p.startsAt || p.endsAt ? `${p.startsAt ? date(p.startsAt, lang) : "…"} → ${p.endsAt ? date(p.endsAt, lang) : "…"}` : t("ui.promo.always")}
                {p.days.length > 0 && <small className="cell-sub">{p.days.map((d) => t(`ui.promo.days.${d}`)).join(", ")}</small>}</td>
              <td><span className={`promo-status ${p.runningNow ? "is-on" : ""}`}>{t(!p.isActive ? "ui.promo.off" : p.runningNow ? "ui.promo.running" : "ui.promo.notNow")}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <PromoForm promo={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function PromoForm({ promo, onClose, onSaved }) {
  const { t } = useLanguage();
  const isNew = !promo.id;
  const products = useApi("/api/products");
  const filters = useApi("/api/products/filters");
  const [f, setF] = useState(() => ({ name: promo.name || "", kind: promo.kind || "percent", value: promo.value ?? "", buyQty: promo.buyQty ?? 1, getQty: promo.getQty ?? 1, minTotal: promo.minTotal || "",
    productIds: promo.productIds || [], categoryIds: promo.categoryIds || [], days: promo.days || [], startsAt: promo.startsAt ? String(promo.startsAt).slice(0, 16).replace(" ", "T") : "",
    endsAt: promo.endsAt ? String(promo.endsAt).slice(0, 16).replace(" ", "T") : "", isActive: promo.isActive ?? true }));
  const [q, setQ] = useState("");
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const order = f.kind.startsWith("order_");
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(isNew ? "/api/promotions" : `/api/promotions/${promo.id}`, { method: isNew ? "POST" : "PUT", body: f }))) onSaved();
  };
  const err = sub.fieldErrors;
  const shown = (products.data?.products || []).filter((p) => f.productIds.includes(p.id) || (q && p.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 40);
  return (
    <Modal title={isNew ? t("ui.promo.add") : promo.name} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.name")} error={err.name}><input className="input" value={f.name} onChange={set("name")} placeholder={t("ui.promo.namePh")} /></Field>
        <Field label={t("ui.promo.offer")} error={err.kind}>
          <select className="input" value={f.kind} onChange={set("kind")}>{KINDS.map((k) => <option key={k} value={k}>{t(`ui.promo.kinds.${k}`)}</option>)}</select>
        </Field>
        {f.kind === "bogo" ? (
          <>
            <Field label={t("ui.promo.buy")} error={err.buyQty}><input className="input" type="number" min="1" step="1" value={f.buyQty} onChange={set("buyQty")} /></Field>
            <Field label={t("ui.promo.getFree")}><input className="input" type="number" min="1" step="1" value={f.getQty} onChange={set("getQty")} /></Field>
          </>
        ) : <Field label={t(`ui.promo.valueLabel.${f.kind}`)} error={err.value}><input className="input" type="number" min="0" step="any" value={f.value} onChange={set("value")} /></Field>}
        {order && <Field label={t("ui.promo.minTotal")} error={err.minTotal}><input className="input" type="number" min="0" step="any" value={f.minTotal} onChange={set("minTotal")} /></Field>}
        <Field label={`${t("ui.promo.starts")} ${t("ui.common.optional")}`}><input className="input" type="datetime-local" value={f.startsAt} onChange={set("startsAt")} /></Field>
        <Field label={`${t("ui.promo.ends")} ${t("ui.common.optional")}`} error={err.endsAt}><input className="input" type="datetime-local" value={f.endsAt} onChange={set("endsAt")} /></Field>
        <div className="ff ff--full"><span className="ff__label">{t("ui.promo.daysLabel")}</span>
          <div className="chip-pick">{DAYS.map((d) => <button key={d} type="button" aria-pressed={f.days.includes(d)} onClick={() => toggle("days", d)}>{t(`ui.promo.days.${d}`)}</button>)}</div>
          <small className="ff__hint">{t("ui.promo.daysHint")}</small>
        </div>
        {!order && (
          <>
            <div className="ff ff--full"><span className="ff__label">{t("ui.promo.categories")}</span>
              <div className="chip-pick">{(filters.data?.categories || []).map((c) => <button key={c.id} type="button" aria-pressed={f.categoryIds.includes(c.id)} onClick={() => toggle("categoryIds", c.id)}>{c.name}</button>)}</div>
            </div>
            <div className="ff ff--full"><span className="ff__label">{t("ui.promo.products")}</span>
              <SearchBox value={q} onChange={setQ} placeholder={t("ui.promo.findProduct")} />
              <div className="chip-pick">{shown.map((p) => <button key={p.id} type="button" aria-pressed={f.productIds.includes(p.id)} onClick={() => toggle("productIds", p.id)}>{p.name}</button>)}</div>
              <small className="ff__hint">{t("ui.promo.eligibleHint")}</small>
            </div>
          </>
        )}
        {!isNew && <div className="ff"><label className="checkbox"><input type="checkbox" checked={f.isActive} onChange={set("isActive")} /><span>{t("ui.promo.active")}</span></label></div>}
        <FormError error={sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function DiscountRules() {
  const { t } = useLanguage();
  const d = useApi("/api/promotions/rules");
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(false);
  const sub = useSubmit();
  if (d.data && !f) setF({ maxPct: String(d.data.maxPct), approvalPct: String(d.data.approvalPct) });
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/promotions/rules", { method: "PUT", body: f }))) { setSaved(true); setTimeout(() => setSaved(false), 2500); } };
  if (!f) return <Loading />;
  return (
    <form onSubmit={save} className="panel-card form-grid form-grid--2 stock-form">
      <p className="modal__help ff--full">{t("ui.promo.rulesHelp")}</p>
      <Field label={t("ui.promo.approvalPct")} error={sub.fieldErrors.approvalPct} hint={t("ui.promo.approvalPctHint")}><input className="input" type="number" min="0" max="100" step="any" value={f.approvalPct} onChange={(e) => setF({ ...f, approvalPct: e.target.value })} /></Field>
      <Field label={t("ui.promo.maxPct")} error={sub.fieldErrors.maxPct} hint={t("ui.promo.maxPctHint")}><input className="input" type="number" min="0" max="100" step="any" value={f.maxPct} onChange={(e) => setF({ ...f, maxPct: e.target.value })} /></Field>
      <p className="muted ff--full">{t("ui.promo.whoCan")} <Link to="/app/m/staff">{t("app.modules.staff")}</Link></p>
      {saved && <p className="form-status form-status--success ff--full">{t("ui.common.saved")}</p>}
      <div className="form-actions ff--full"><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
    </form>
  );
}

function DiscountHistory() {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const d = useApi(`/api/promotions/discounts?${new URLSearchParams(range)}`);
  return (
    <>
      <div className="toolbar"><DateRange value={range} onChange={setRange} /></div>
      {!d.data ? <Loading /> : (
        <>
          <div className="shift-summary"><span>{t("ui.promo.manualTotal")}: {m(d.data.summary.manual)}</span><span>{t("ui.promo.promoTotal")}: {m(d.data.summary.promotions)}</span><span>{fill(t("ui.promo.approvedN"), { n: d.data.summary.approved })}</span></div>
          {!d.data.discounts.length ? <EmptyState icon="percent" text={t("ui.common.noResults")} /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t("ui.pos.receiptNo")}</th><th>{t("ui.common.date")}</th><th>{t("ui.shifts.cashier")}</th><th className="num">{t("ui.promo.manual")}</th><th>{t("ui.promo.approvedByCol")}</th><th className="num">{t("ui.promo.promotions")}</th><th className="num">{t("ui.common.total")}</th></tr></thead>
              <tbody>{d.data.discounts.map((x) => (
                <tr key={x.id} className={x.status !== "completed" ? "is-muted" : ""}>
                  <td><Link to={`/app/sales/${x.id}`}>{x.number}</Link></td><td>{date(x.at, lang, true)}</td><td>{x.user}</td>
                  <td className="num">{x.manual ? m(x.manual) : "—"}</td><td>{x.approvedBy || "—"}</td>
                  <td className="num">{x.promoItems + (x.promoOrder?.amount || 0) ? m(x.promoItems + (x.promoOrder?.amount || 0)) : "—"}{x.promoOrder && <small className="cell-sub">{x.promoOrder.name}</small>}</td>
                  <td className="num">{m(x.total)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </>
  );
}
