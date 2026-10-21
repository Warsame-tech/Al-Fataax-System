import { useCallback, useEffect, useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader } from "../ui.jsx";
import { fill, money, qty, date } from "../format.js";

const PERIODS = ["today", "week", "month", "year", "custom"];
const KIND_ICON = { sale: "cart", invoice: "receipt", purchase: "truck", expense: "wallet", payment: "arrow-down-left" };
const MONEY_IN = new Set(["sale", "invoice", "payment"]);

/*
 * Business overview module: key figures for a period (today / week / month / year /
 * custom), recent activity, low stock and best sellers. All figures come from
 * GET /api/dashboard for this business only; empty data shows empty states.
 * Roles without finance access see only stock and best sellers (the API hides the rest).
 */
export default function Overview() {
  const { t, lang } = useLanguage();
  const { business } = useAuth();
  const [period, setPeriod] = useState("today");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [state, setState] = useState({ status: "loading", data: null });

  const load = useCallback(async (p = period, c = custom) => {
    if (p === "custom" && (!c.from || !c.to)) return;
    setState((s) => ({ status: "loading", data: s.data }));
    const qs = new URLSearchParams({ period: p, ...(p === "custom" ? c : {}) });
    try {
      setState({ status: "ready", data: await apiRequest(`/api/dashboard?${qs}`) });
    } catch {
      setState((s) => ({ status: "error", data: s.data }));
    }
  }, [period, custom]);

  useEffect(() => { if (period !== "custom") load(period); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = state.data;
  const cur = d?.currency || business?.currency || "USD";
  const m = (v) => money(v, cur, lang);
  const k = d?.kpis;

  const KPIS = k ? [
    { id: "sales", icon: "chart-line", tone: "orange", value: k.salesTotal, hint: fill(t("app.kpi.salesHint"), { n: k.salesCount }) },
    { id: "received", icon: "arrow-down-left", tone: "green", value: k.received, hint: t("app.kpi.receivedHint") },
    { id: "gross", icon: "chart-line", tone: "blue", value: k.grossProfit, hint: t("app.kpi.grossHint") },
    { id: "net", icon: "wallet", tone: "navy", value: k.netProfit, hint: t("app.kpi.netHint") },
    { id: "cash", icon: "wallet", tone: "orange", value: k.cash, hint: t("app.kpi.balanceHint") },
    { id: "bank", icon: "landmark", tone: "blue", value: k.bank, hint: t("app.kpi.balanceHint") },
    { id: "receivables", icon: "users", tone: "green", value: k.receivables, hint: t("app.kpi.openHint") },
    { id: "payables", icon: "truck", tone: "red", value: k.payables, hint: t("app.kpi.openHint") }
  ] : [];

  return (
    <div className="page">
      <PageHeader icon="chart-line" title={t("app.modules.overview")} />

      <div className="dash-period dash-period--light" role="group" aria-label={t("app.period.label")}>
        <div className="dash-period__tabs">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{t(`app.period.${p}`)}</button>
          ))}
        </div>
        {period === "custom" && (
          <form className="dash-period__custom" onSubmit={(e) => { e.preventDefault(); load("custom", custom); }}>
            <label>{t("app.period.from")}<input type="date" value={custom.from} max={custom.to || undefined} required onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
            <label>{t("app.period.to")}<input type="date" value={custom.to} min={custom.from || undefined} required onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
            <button type="submit" className="btn btn--primary">{t("app.period.apply")}</button>
          </form>
        )}
      </div>

      {state.status === "error" && (
        <div className="dash-error" role="alert">
          <Icon name="alert" /><span>{t("app.loadFailed")}</span>
          <button type="button" className="btn btn--navy" onClick={() => load()}>{t("app.retry")}</button>
        </div>
      )}

      {(!d || d.finance) && (
        <section className={"dash-kpis" + (state.status === "loading" ? " is-loading" : "")} aria-busy={state.status === "loading"}>
          {(KPIS.length ? KPIS : Array.from({ length: 8 }, (_, i) => ({ id: `s${i}` }))).map((c) => (
            <article key={c.id} className={`kpi kpi--${c.tone || "orange"}`}>
              {c.icon ? (
                <>
                  <div className="kpi__top">
                    <span className="kpi__icon"><Icon name={c.icon} /></span>
                    <h3>{t(`app.kpi.${c.id}`)}</h3>
                  </div>
                  <p className="kpi__value">{m(c.value)}</p>
                  <p className="kpi__hint">{c.hint}</p>
                </>
              ) : <div className="kpi__skeleton" />}
            </article>
          ))}
        </section>
      )}

      <section className="dash-panels">
        {(!d || d.finance) && (
          <article className="dash-card dash-card--wide">
            <h2 className="dash-card__title"><Icon name="clock" />{t("app.sections.recent")}</h2>
            {d && d.recent.length === 0 ? <p className="dash-empty">{t("app.empty.recent")}</p> : (
              <ul className="activity">
                {(d?.recent || []).map((r, i) => (
                  <li key={i} className={`activity__item activity__item--${r.kind}`}>
                    <span className="activity__icon"><Icon name={KIND_ICON[r.kind] || "receipt"} /></span>
                    <div className="activity__text">
                      <strong>{t(`app.kinds.${r.kind}`)}{r.ref ? ` · ${r.ref}` : ""}</strong>
                      <small>{date(r.at, lang, true)}</small>
                    </div>
                    <span className={"activity__amount" + (MONEY_IN.has(r.kind) ? " is-in" : " is-out")}>{m(r.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        )}

        <article className="dash-card">
          <h2 className="dash-card__title"><Icon name="alert" />{t("app.sections.lowStock")}</h2>
          {d && d.lowStock.length === 0 ? <p className="dash-empty">{t("app.empty.lowStock")}</p> : (
            <ul className="stock-list">
              {(d?.lowStock || []).map((p) => (
                <li key={p.id} className={p.qty <= 0 ? "is-out" : ""}>
                  <span className="stock-list__name">{p.name}</span>
                  <span className="stock-list__qty">
                    {p.qty <= 0 ? t("app.stock.out") : fill(t("app.stock.left"), { qty: qty(p.qty), unit: p.unit })}
                    <small>{fill(t("app.stock.min"), { min: qty(p.min) })}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="dash-card">
          <h2 className="dash-card__title"><Icon name="chart-line" />{t("app.sections.best")}</h2>
          {d && d.bestSellers.length === 0 ? <p className="dash-empty">{t("app.empty.best")}</p> : (
            <ol className="best-list">
              {(d?.bestSellers || []).map((b, i) => (
                <li key={b.id}>
                  <span className="best-list__rank">{i + 1}</span>
                  <span className="best-list__name">{b.name}<small>{fill(t("app.sold"), { qty: qty(b.qty) })}</small></span>
                  <span className="best-list__rev">{m(b.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>
    </div>
  );
}
