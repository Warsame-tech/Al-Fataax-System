import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { fileUrl } from "../services/api.js";
import { useApi, Loading, StatusBadge } from "../app/ui.jsx";
import { date, fill, money } from "../app/format.js";
import { AreaChart, BarChart, Donut, Sparkline, paletteColor } from "./Charts.jsx";

/*
 * Super admin overview (GET /api/admin/dashboard): a greeting with quick actions, the four numbers that matter
 * (businesses, monthly recurring revenue, paying businesses, users) with their trend, what needs attention now,
 * revenue and sign-ups over 12 months, business types, the newest businesses, trials ending, and system health.
 */
export default function AdminDashboard({ can }) {
  const { t, lang } = useLanguage();
  const d = useApi("/api/admin/dashboard");
  if (!d.data) return <Loading />;
  const { counts: c, money: mo, signups, revenue, types, recent, endingTrials, health, admin } = d.data;
  const m = (v) => money(v, mo.currency, lang);
  const hour = new Date().getHours();
  const greet = t(`ui.adminDash.greet.${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}`);
  const delta = mo.lastMonth > 0 ? Math.round(((mo.thisMonth - mo.lastMonth) / mo.lastMonth) * 100) : null;
  const typeName = (x) => (t(`register.types.${x}`).startsWith("register.") ? x : t(`register.types.${x}`));
  // things waiting for the super admin, most urgent first; only the ones that need something
  const attention = [
    { key: "overdue", n: c.overdue, icon: "credit-card", tone: "red", to: "/admin/subscriptions?filter=overdue" },
    { key: "waitingTickets", n: c.waitingTickets, icon: "message", tone: "orange", to: "/admin/tickets?status=waiting" },
    { key: "newMessages", n: c.newMessages, icon: "mail", tone: "blue", to: "/admin/messages?status=new" },
    { key: "trialsEnding", n: c.trialsEnding, icon: "clock", tone: "amber", to: "/admin/trials?filter=ending" },
    { key: "failedLogins", n: c.failedLogins, icon: "shield-check", tone: "red", to: "/admin/security" },
    { key: "suspended", n: c.suspended, icon: "lock", tone: "slate", to: "/admin/businesses?status=suspended" }
  ].filter((x) => x.n > 0);
  const kpis = [
    { key: "businesses", icon: "briefcase", value: c.businesses, sub: fill(t("ui.adminDash.activeOf"), { n: c.active }), spark: signups, color: "var(--blue)", to: "/admin/businesses" },
    { key: "mrr", icon: "chart-line", value: m(mo.mrr), sub: delta === null ? fill(t("ui.adminDash.thisMonth"), { amount: m(mo.thisMonth) }) : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% ${t("ui.adminDash.vsLast")}`,
      subTone: delta === null ? "" : delta >= 0 ? "up" : "down", spark: revenue, color: "var(--orange)", to: "/admin/payments" },
    { key: "paying", icon: "credit-card", value: c.subscribed, sub: fill(t("ui.adminDash.onTrial"), { n: c.trials }), color: "#1f9d61", to: "/admin/subscriptions" },
    { key: "users", icon: "users", value: c.users, sub: fill(t("ui.adminDash.docs"), { sales: c.sales, invoices: c.invoices }), color: "#7c3aed", to: "/admin/users" }
  ];
  return (
    <div className="page adash">
      <section className="adash-hero">
        <div className="adash-hero__text">
          <span className="adash-hero__date">{date(new Date(), lang)}</span>
          <h1>{greet}, {admin.username}</h1>
          <p>{attention.length ? fill(t("ui.adminDash.needs"), { n: attention.reduce((s, x) => s + x.n, 0) }) : t("ui.adminDash.allGood")}</p>
        </div>
        <div className="adash-hero__actions">
          {can("billing") && <Link className="adash-hero__btn" to="/admin/subscriptions?filter=none"><Icon name="credit-card" /><span>{t("ui.adminDash.actions.plan")}</span></Link>}
          {can("announcements") && <Link className="adash-hero__btn" to="/admin/announcements"><Icon name="bell" /><span>{t("ui.adminDash.actions.announce")}</span></Link>}
          {can("support") && <Link className="adash-hero__btn" to="/admin/tickets?status=waiting"><Icon name="message" /><span>{t("ui.adminDash.actions.tickets")}</span></Link>}
          {can("reports") && <Link className="adash-hero__btn" to="/admin/reports"><Icon name="file-chart" /><span>{t("ui.adminDash.actions.reports")}</span></Link>}
        </div>
      </section>

      <div className="adash-kpis">
        {kpis.map((k) => (
          <Link key={k.key} to={k.to} className="adash-kpi" style={{ "--c": k.color }}>
            <span className="adash-kpi__icon"><Icon name={k.icon} /></span>
            <span className="adash-kpi__label">{t(`ui.adminDash.kpi.${k.key}`)}</span>
            <strong className="adash-kpi__value">{k.value}</strong>
            <small className={"adash-kpi__sub" + (k.subTone ? ` is-${k.subTone}` : "")}>{k.sub}</small>
            {k.spark && <Sparkline data={k.spark} color={k.color} />}
          </Link>
        ))}
      </div>

      <section className="adash-card adash-attention">
        <h2><Icon name="alert" /> {t("ui.adminDash.attention")}</h2>
        {attention.length === 0 ? <p className="adash-ok"><Icon name="check" /> {t("ui.adminDash.allGood")}</p> : (
          <div className="adash-attention__grid">
            {attention.map((a) => (
              <Link key={a.key} to={a.to} className={`adash-alert is-${a.tone}`}>
                <span className="adash-alert__icon"><Icon name={a.icon} /></span>
                <strong>{a.n}</strong><span>{t(`ui.adminDash.alerts.${a.key}`)}</span>
                <Icon name="arrow-right" className="adash-alert__go" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="adash-grid2">
        <section className="adash-card">
          <div className="adash-card__head">
            <h2>{t("ui.adminDash.revenue")}</h2>
            <span className="adash-card__big">{m(mo.total)}<small>{t("ui.adminDash.allTime")}</small></span>
          </div>
          <AreaChart data={revenue} lang={lang} color="#ff8a4c" format={m} label={t("ui.adminDash.revenue")} />
        </section>
        <section className="adash-card">
          <div className="adash-card__head">
            <h2>{t("ui.adminDash.signups")}</h2>
            <span className="adash-card__big">{c.new30}<small>{t("ui.adminDash.last30")}</small></span>
          </div>
          <BarChart data={signups} lang={lang} color="#2373f4" label={t("ui.adminDash.signups")} />
        </section>
      </div>

      <div className="adash-grid3">
        <section className="adash-card">
          <h2>{t("ui.adminDash.types")}</h2>
          {types.length === 0 ? <p className="muted">—</p> : (
            <div className="adash-types">
              <Donut items={types.slice(0, 8).map((x) => ({ label: typeName(x.type), value: x.count }))} center={c.businesses} sub={t("ui.adminDash.kpi.businesses")} />
              <ul className="adash-legend">
                {types.slice(0, 8).map((x, i) => (
                  <li key={x.type}><Link to={`/admin/businesses?type=${x.type}`}><span className="adash-legend__dot" style={{ background: paletteColor(i) }} />{typeName(x.type)}<b>{x.count}</b></Link></li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="adash-card">
          <div className="adash-card__head"><h2>{t("ui.adminDash.recent")}</h2><Link to="/admin/businesses" className="adash-more">{t("ui.adminDash.seeAll")}</Link></div>
          <ul className="adash-list">
            {recent.map((b) => (
              <li key={b.id}>
                <Link to={`/admin/businesses/${b.id}`}>
                  {b.logoPath ? <img src={fileUrl(b.logoPath)} alt="" className="adash-list__logo" /> : <span className="adash-list__logo">{b.name.slice(0, 1)}</span>}
                  <span className="adash-list__text"><strong>{b.name}</strong><small>{typeName(b.type)} · {date(b.createdAt, lang)}</small></span>
                  <StatusBadge status={b.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="adash-card">
          <div className="adash-card__head"><h2>{t("ui.adminDash.ending")}</h2><Link to="/admin/trials" className="adash-more">{t("ui.adminDash.seeAll")}</Link></div>
          {endingTrials.length === 0 ? <p className="muted">{t("ui.admin.noTrials")}</p> : (
            <ul className="adash-list">
              {endingTrials.map((x) => (
                <li key={x.id}>
                  <Link to={`/admin/businesses/${x.id}`}>
                    <span className={"adash-days" + (x.daysLeft <= 3 ? " is-soon" : "")}><b>{x.daysLeft}</b><small>{t("ui.adminDash.days")}</small></span>
                    <span className="adash-list__text"><strong>{x.name}</strong><small>{t("ui.admin.ends")} {date(x.end, lang)}</small></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="adash-health">
            <span className={"adash-health__dot" + (health.database === "connected" ? " is-ok" : "")} />
            <span>{t("ui.admin.database")}: <b>{health.database === "connected" ? t("ui.adminDash.ok") : t("ui.adminDash.down")}</b></span>
            <span>{health.sizeMb} MB</span>
            <Link to="/admin/health">{t("ui.admin.menu.health")}</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
