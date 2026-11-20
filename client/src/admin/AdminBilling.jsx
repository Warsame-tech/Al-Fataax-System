import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { useApi, useSubmit, Field, FormError, Loading, EmptyState, StatusBadge, Modal, DateRange, daysAgo, isoDate, downloadCsv } from "../app/ui.jsx";
import { date, fill, money } from "../app/format.js";

/*
 * Subscriptions & billing (routes/adminPlatform.js): plans, each business's subscription, payments.
 *   /admin/subscriptions[?filter=due|overdue|cancelled|none]  /admin/payments  /admin/plans
 * A payment extends the subscription by its cycle; a business suspended for not paying comes back when it pays.
 */
const METHODS = ["cash", "mobile_money", "bank", "card", "other"];

export function Subscriptions({ can }) {
  const { t, lang } = useLanguage();
  const [params] = useSearchParams();
  const filter = params.get("filter") || "";
  const d = useApi(`/api/admin/subscriptions?filter=${filter}`);
  const plans = useApi("/api/admin/plans");
  const [giving, setGiving] = useState(null);     // { id, name } business to give a plan
  const [paying, setPaying] = useState(null);     // subscription row to record a payment for
  const [cancelling, setCancelling] = useState(null);
  const cur = plans.data?.currency || "USD";
  const m = (v) => money(v, cur, lang);
  const title = t(`ui.billing.filters.${filter || "active"}`);
  const done = () => { setGiving(null); setPaying(null); setCancelling(null); d.reload(); };
  return (
    <div className="page">
      <h1 className="admin-title">{title}</h1>
      <div className="seg seg--tabs">
        {["", "due", "overdue", "none", "cancelled"].map((f) => <Link key={f} to={`/admin/subscriptions${f ? `?filter=${f}` : ""}`} aria-current={filter === f ? "page" : undefined} className={filter === f ? "is-on" : ""}>{t(`ui.billing.filters.${f || "active"}`)}</Link>)}
      </div>
      {!d.data ? <Loading /> : filter === "none" ? (
        d.data.businesses.length === 0 ? <EmptyState icon="check" text={t("ui.billing.allHavePlan")} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t("ui.admin.businessUser")}</th><th>{t("ui.admin.owner")}</th><th>{t("ui.common.phone")}</th><th>{t("ui.admin.trial")}</th><th>{t("ui.common.status")}</th><th /></tr></thead>
            <tbody>{d.data.businesses.map((b) => (
              <tr key={b.id}>
                <td><Link to={`/admin/businesses/${b.id}`}><strong>{b.name}</strong></Link><small className="cell-sub">{t("ui.admin.registered")} {date(b.createdAt, lang)}</small></td>
                <td>{b.owner}</td><td>{b.phone}</td>
                <td>{b.trial ? `${t(`ui.status.${b.trial.status}`)} · ${date(b.trial.end, lang)}` : "—"}</td><td><StatusBadge status={b.status} /></td>
                <td>{can("billing") && <button type="button" className="btn btn--primary btn--sm" onClick={() => setGiving({ id: b.id, name: b.name })}>{t("ui.billing.givePlan")}</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )
      ) : d.data.subscriptions.length === 0 ? <EmptyState icon="credit-card" text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.admin.businessUser")}</th><th>{t("ui.billing.plan")}</th><th className="num">{t("ui.billing.price")}</th><th>{t("ui.billing.paidUntil")}</th><th>{t("ui.billing.lastPaid")}</th><th>{t("ui.common.status")}</th><th /></tr></thead>
          <tbody>{d.data.subscriptions.map((s) => (
            <tr key={s.businessId}>
              <td><Link to={`/admin/businesses/${s.businessId}`}><strong>{s.business}</strong></Link><small className="cell-sub">{s.phone}</small></td>
              <td>{s.plan}<small className="cell-sub">{t(`ui.billing.cycles.${s.cycle}`)}</small></td>
              <td className="num">{m(s.price)}</td>
              <td>{date(s.periodEnd, lang)}<small className={"cell-sub" + (s.daysLeft < 0 ? " is-neg" : s.daysLeft <= 7 ? " is-warn" : "")}>{s.daysLeft < 0 ? fill(t("ui.billing.daysLate"), { n: -s.daysLeft }) : fill(t("ui.billing.daysLeft"), { n: s.daysLeft })}</small></td>
              <td>{s.lastPaid ? date(s.lastPaid, lang) : "—"}</td>
              <td><span className={`badge-status badge-status--${s.status === "active" ? "paid" : s.status === "cancelled" ? "cancelled" : "overdue"}`}>{t(`ui.billing.statuses.${s.status}`)}</span></td>
              <td className="row-actions">
                {can("billing") && s.status !== "cancelled" && <button type="button" className="btn btn--primary btn--sm" onClick={() => setPaying(s)}><Icon name="wallet" /><span>{t("ui.billing.recordPayment")}</span></button>}
                {can("billing") && <button type="button" className="icon-btn" title={t("ui.billing.changePlan")} onClick={() => setGiving({ id: s.businessId, name: s.business, planId: s.planId, cycle: s.cycle })}><Icon name="settings" /></button>}
                {can("billing") && s.status !== "cancelled" && <button type="button" className="icon-btn" title={t("ui.billing.cancel")} onClick={() => setCancelling(s)}><Icon name="x" /></button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {giving && <GivePlan business={giving} plans={plans.data?.plans || []} currency={cur} onClose={() => setGiving(null)} onDone={done} />}
      {paying && <RecordPayment sub={paying} currency={cur} onClose={() => setPaying(null)} onDone={done} />}
      {cancelling && <CancelSub sub={cancelling} onClose={() => setCancelling(null)} onDone={done} />}
    </div>
  );
}

/* Give a business a plan (or switch it), optionally with its first payment */
export function GivePlan({ business, plans, currency, onClose, onDone }) {
  const { t, lang } = useLanguage();
  const active = plans.filter((p) => p.isActive);
  const [f, setF] = useState({ planId: String(business.planId || active[0]?.id || ""), cycle: business.cycle || "monthly", startDate: isoDate(new Date()), paid: !business.planId, method: "mobile_money", reference: "" });
  const plan = plans.find((p) => String(p.id) === f.planId);
  const price = plan ? (f.cycle === "yearly" ? plan.priceYearly : plan.priceMonthly) : 0;
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    const body = { businessId: business.id, planId: Number(f.planId), cycle: f.cycle, startDate: f.startDate, ...(f.paid && price > 0 ? { payment: { amount: price, method: f.method, reference: f.reference } } : {}) };
    if (await sub.run(() => apiRequest("/api/admin/subscriptions", { method: "POST", body }))) onDone();
  };
  return (
    <Modal title={fill(t("ui.billing.givePlanTo"), { name: business.name })} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid">
        <div className="plan-pick">
          {active.map((p) => (
            <button key={p.id} type="button" className={"plan-pick__card" + (String(p.id) === f.planId ? " is-on" : "")} onClick={() => setF({ ...f, planId: String(p.id) })} aria-pressed={String(p.id) === f.planId}>
              <strong>{p.name}</strong>
              <span className="plan-pick__price">{money(f.cycle === "yearly" ? p.priceYearly : p.priceMonthly, currency, lang)}<small>/ {t(`ui.billing.per.${f.cycle}`)}</small></span>
              <small>{p.description}</small>
            </button>
          ))}
        </div>
        <div className="form-grid form-grid--3">
          <Field label={t("ui.billing.cycle")}><div className="seg">{["monthly", "yearly"].map((c) => <button key={c} type="button" aria-pressed={f.cycle === c} onClick={() => setF({ ...f, cycle: c })}>{t(`ui.billing.cycles.${c}`)}</button>)}</div></Field>
          <Field label={t("ui.billing.start")}><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <label className="check-row ff"><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> {fill(t("ui.billing.paidNow"), { amount: money(price, currency, lang) })}</label>
        </div>
        {f.paid && price > 0 && (
          <div className="form-grid form-grid--2">
            <Field label={t("ui.billing.method")}><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map((x) => <option key={x} value={x}>{t(`ui.billing.methods.${x}`)}</option>)}</select></Field>
            <Field label={`${t("ui.billing.reference")} ${t("ui.common.optional")}`}><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="EVC / ref." /></Field>
          </div>
        )}
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy || !f.planId}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

/* A payment for one or more periods: the subscription runs on from where it ended */
export function RecordPayment({ sub: s, currency, onClose, onDone }) {
  const { t, lang } = useLanguage();
  const [f, setF] = useState({ periods: "1", amount: String(s.price), method: "mobile_money", reference: "", notes: "" });
  const sub = useSubmit();
  const setPeriods = (n) => setF({ ...f, periods: n, amount: String(Math.round(s.price * Number(n) * 100) / 100) });
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(`/api/admin/subscriptions/${s.businessId}/payments`, { method: "POST", body: { ...f, amount: Number(f.amount), periods: Number(f.periods) } }))) onDone();
  };
  return (
    <Modal title={fill(t("ui.billing.paymentFrom"), { name: s.business })} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <p className="modal__help">{s.plan} · {t(`ui.billing.cycles.${s.cycle}`)} · {t("ui.billing.paidUntil")} {date(s.periodEnd, lang)}</p>
        <Field label={t("ui.billing.periods")}><div className="seg">{["1", "3", "6", "12"].map((n) => <button key={n} type="button" aria-pressed={f.periods === n} onClick={() => setPeriods(n)}>{n}</button>)}</div></Field>
        <Field label={`${t("ui.common.amount")} (${currency})`} error={sub.fieldErrors.amount}><input className="input input--big" type="number" min="0" step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t("ui.billing.method")} error={sub.fieldErrors.method}><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map((x) => <option key={x} value={x}>{t(`ui.billing.methods.${x}`)}</option>)}</select></Field>
        <Field label={`${t("ui.billing.reference")} ${t("ui.common.optional")}`}><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}><Icon name="check" /><span>{t("ui.billing.recordPayment")}</span></button></div>
      </form>
    </Modal>
  );
}

function CancelSub({ sub: s, onClose, onDone }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState("");
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(`/api/admin/subscriptions/${s.businessId}`, { method: "PATCH", body: { status: "cancelled", reason } }))) onDone(); };
  return (
    <Modal title={fill(t("ui.billing.cancelTitle"), { name: s.business })} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <p className="modal__help">{t("ui.billing.cancelHelp")}</p>
        <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason}><textarea className="input" rows="2" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.close")}</button><button type="submit" className="btn btn--danger" disabled={sub.busy}>{t("ui.billing.cancel")}</button></div>
      </form>
    </Modal>
  );
}

export function Payments() {
  const { t, lang } = useLanguage();
  const [range, setRange] = useState({ from: daysAgo(89), to: isoDate(new Date()) });
  const d = useApi(`/api/admin/payments?${new URLSearchParams(range)}`);
  const m = (v) => money(v, d.data?.currency || "USD", lang);
  const rows = d.data?.payments || [];
  const csv = () => downloadCsv("faatix-payments.csv", ["date", "business", "plan", "amount", "method", "reference", "from", "to", "by"],
    rows.map((x) => [String(x.paidAt).slice(0, 10), x.business, x.plan, x.amount, x.method, x.reference, x.periodStart, x.periodEnd, x.admin]));
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.payments")}</h1>
      <div className="toolbar"><DateRange value={range} onChange={setRange} /><button type="button" className="btn btn--outline" onClick={csv} disabled={!rows.length}><Icon name="download" /><span>{t("ui.common.exportCsv")}</span></button></div>
      {d.data && <div className="adash-kpis adash-kpis--slim"><div className="adash-kpi" style={{ "--c": "var(--orange)" }}><span className="adash-kpi__label">{t("ui.billing.received")}</span><strong className="adash-kpi__value">{m(d.data.total)}</strong><small className="adash-kpi__sub">{fill(t("ui.billing.paymentsN"), { n: rows.length })}</small></div></div>}
      {!d.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="wallet" text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.admin.businessUser")}</th><th>{t("ui.billing.plan")}</th><th>{t("ui.billing.period")}</th><th>{t("ui.billing.method")}</th><th className="num">{t("ui.common.amount")}</th><th>{t("ui.billing.by")}</th></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id}>
              <td>{date(x.paidAt, lang)}</td><td><Link to={`/admin/businesses/${x.businessId}`}>{x.business}</Link></td><td>{x.plan || "—"}</td>
              <td>{x.periodStart ? `${date(x.periodStart, lang)} – ${date(x.periodEnd, lang)}` : "—"}</td>
              <td>{t(`ui.billing.methods.${x.method}`)}{x.reference && <small className="cell-sub">{x.reference}</small>}</td>
              <td className="num"><strong>{m(x.amount)}</strong></td><td>{x.admin || "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

/* Plans: price per month / year, limits (empty = no limit), features; businesses on each */
export function Plans({ can }) {
  const { t, lang } = useLanguage();
  const d = useApi("/api/admin/plans");
  const [editing, setEditing] = useState(null);
  const cur = d.data?.currency || "USD";
  const lim = (v) => (v === null || v === undefined ? t("ui.billing.unlimited") : v);
  return (
    <div className="page">
      <div className="admin-head"><h1 className="admin-title">{t("ui.admin.menu.plans")}</h1>{can("billing") && <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.billing.newPlan")}</span></button>}</div>
      {!d.data ? <Loading /> : (
        <div className="plan-cards">
          {d.data.plans.map((p, i) => (
            <article key={p.id} className={"plan-card" + (i === 1 ? " is-featured" : "") + (p.isActive ? "" : " is-off")}>
              <header><h2>{p.name}</h2>{!p.isActive && <span className="track-tag">{t("ui.billing.hidden")}</span>}</header>
              <p className="plan-card__price">{money(p.priceMonthly, cur, lang)}<small>/ {t("ui.billing.per.monthly")}</small></p>
              <p className="muted plan-card__year">{money(p.priceYearly, cur, lang)} / {t("ui.billing.per.yearly")}</p>
              <p className="plan-card__desc">{p.description}</p>
              <ul className="plan-card__limits">
                <li><Icon name="users" /> {t("ui.billing.limits.users")}: <b>{lim(p.maxUsers)}</b></li>
                <li><Icon name="store" /> {t("ui.billing.limits.branches")}: <b>{lim(p.maxBranches)}</b></li>
                <li><Icon name="package" /> {t("ui.billing.limits.products")}: <b>{lim(p.maxProducts)}</b></li>
              </ul>
              <ul className="plan-card__features">{p.features.map((f) => <li key={f}><Icon name="check" /> {f}</li>)}</ul>
              <footer><span className="muted">{fill(t("ui.billing.subscribers"), { n: p.subscribers })}</span>{can("billing") && <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(p)}>{t("ui.common.edit")}</button>}</footer>
            </article>
          ))}
        </div>
      )}
      {editing && <PlanForm plan={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); d.reload(); }} />}
    </div>
  );
}

function PlanForm({ plan, onClose, onDone }) {
  const { t } = useLanguage();
  const isNew = !plan.id;
  const [f, setF] = useState({ name: plan.name || "", code: plan.code || "", description: plan.description || "", priceMonthly: plan.priceMonthly ?? "", priceYearly: plan.priceYearly ?? "",
    maxUsers: plan.maxUsers ?? "", maxBranches: plan.maxBranches ?? "", maxProducts: plan.maxProducts ?? "", features: (plan.features || []).join("\n"), isActive: plan.isActive !== false, sortOrder: plan.sortOrder ?? 0 });
  const sub = useSubmit();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(isNew ? "/api/admin/plans" : `/api/admin/plans/${plan.id}`, { method: isNew ? "POST" : "PUT", body: f }))) onDone(); };
  const err = sub.fieldErrors;
  return (
    <Modal title={isNew ? t("ui.billing.newPlan") : fill(t("ui.billing.editPlan"), { name: plan.name })} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.name")} error={err.name}><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label={t("ui.billing.code")} error={err.code} hint={t("ui.billing.codeHint")}><input className="input" value={f.code} onChange={set("code")} /></Field>
        <Field label={t("ui.common.description")} full><input className="input" value={f.description} onChange={set("description")} /></Field>
        <Field label={t("ui.billing.priceMonthly")} error={err.priceMonthly}><input className="input" type="number" min="0" step="any" value={f.priceMonthly} onChange={set("priceMonthly")} /></Field>
        <Field label={t("ui.billing.priceYearly")} error={err.priceYearly}><input className="input" type="number" min="0" step="any" value={f.priceYearly} onChange={set("priceYearly")} /></Field>
        {["maxUsers", "maxBranches", "maxProducts"].map((k) => (
          <Field key={k} label={t(`ui.billing.limits.${k.slice(3).toLowerCase()}`)} error={err[k]} hint={t("ui.billing.emptyUnlimited")}><input className="input" type="number" min="1" step="1" value={f[k]} onChange={set(k)} /></Field>
        ))}
        <Field label={t("ui.billing.order")}><input className="input" type="number" step="1" value={f.sortOrder} onChange={set("sortOrder")} /></Field>
        <Field label={t("ui.billing.features")} full hint={t("ui.billing.featuresHint")}><textarea className="input" rows="4" value={f.features} onChange={set("features")} /></Field>
        <label className="check-row ff--full"><input type="checkbox" checked={f.isActive} onChange={set("isActive")} /> {t("ui.billing.offered")}</label>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}
