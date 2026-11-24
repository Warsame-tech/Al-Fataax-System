import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useMoney, useSubmit, Modal, Field, FormError, Loading, EmptyState, DateRange, PaymentFields, downloadCsv, isoDate } from "./ui.jsx";
import { date, fill } from "./format.js";
import { Expenses, Cashbook } from "./pages/MoneyPages.jsx";

/*
 * Accounting (server: routes/accounting.js, lib/accounting.js). One set of books for every business:
 *   Simple mode   Dashboard · Income · Expenses · Cash & bank · Customer debts · Supplier debts · Reports · Settings
 *   Advanced mode the same, plus the books: Balance sheet, Trial balance, General ledger, Chart of accounts
 * The mode is set by Faatix (Super admin → business → Modules). Sales, purchases, payments and stock are posted
 * automatically — nothing is typed twice; income and expenses use the same screens as Expenses & income.
 */
const SIMPLE = ["dashboard", "income", "expenses", "cash", "customers", "suppliers", "reports", "settings"];
const ADVANCED = ["books"];
const TAB_ICON = { dashboard: "chart-line", income: "arrow-down-left", expenses: "arrow-up-right", cash: "book-open", customers: "users", suppliers: "truck", reports: "file-chart", settings: "settings", books: "layers" };

/* ---------- date presets ---------- */
function presetRange(p) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const d = (yy, mm, dd) => isoDate(new Date(Date.UTC(yy, mm, dd)));
  const today = d(y, m, now.getDate());
  if (p === "today") return { from: today, to: today };
  if (p === "week") { const wd = (now.getDay() + 6) % 7; return { from: d(y, m, now.getDate() - wd), to: today }; }
  if (p === "quarter") { const q = Math.floor(m / 3) * 3; return { from: d(y, q, 1), to: today }; }
  if (p === "year") return { from: d(y, 0, 1), to: today };
  return { from: d(y, m, 1), to: today };   // month
}
function PeriodPicker({ value, onChange }) {
  const { t } = useLanguage();
  const [preset, setPreset] = useState("month");
  return (
    <div className="acc-period">
      <select className="input input--auto" value={preset} aria-label={t("ui.acc.period")}
        onChange={(e) => { setPreset(e.target.value); if (e.target.value !== "custom") onChange(presetRange(e.target.value)); }}>
        {["today", "week", "month", "quarter", "year", "custom"].map((p) => <option key={p} value={p}>{t(`ui.acc.periods.${p}`)}</option>)}
      </select>
      {preset === "custom" && <DateRange value={value} onChange={onChange} />}
    </div>
  );
}

export default function Accounting() {
  const { t } = useLanguage();
  const { accountingMode } = useAuth();
  const [params, setParams] = useSearchParams();
  const meta = useApi("/api/accounting/meta");
  const mode = meta.data?.mode || accountingMode || "simple";
  const tabs = [...SIMPLE, ...(mode === "advanced" ? ADVANCED : [])];
  const tab = tabs.includes(params.get("tab")) ? params.get("tab") : "dashboard";
  const go = (id) => setParams(id === "dashboard" ? {} : { tab: id }, { replace: true });
  return (
    <div className="page acc-page">
      <PageHeader icon="landmark" title={t("app.modules.accounting")} actions={<span className={`acc-mode is-${mode}`}>{t(`ui.acc.modes.${mode}`)}</span>} />
      <Tabs value={tab} onChange={go} tabs={tabs.map((id) => ({ id, label: t(`ui.acc.tabs.${id}`), icon: TAB_ICON[id] }))} />
      {tab === "dashboard" && <Dashboard go={go} />}
      {tab === "income" && <Expenses embedded kind="income" />}
      {tab === "expenses" && <Expenses embedded kind="expenses" />}
      {tab === "cash" && <Cashbook embedded />}
      {tab === "customers" && <Debts kind="customer" />}
      {tab === "suppliers" && <Debts kind="supplier" />}
      {tab === "reports" && <Reports advanced={mode === "advanced"} />}
      {tab === "settings" && <Settings meta={meta} />}
      {tab === "books" && <Books />}
    </div>
  );
}

/* ---------- dashboard ---------- */
function Change({ now, before }) {
  const { t } = useLanguage();
  if (before === undefined || before === null) return null;
  if (!before) return <small className="acc-card__change">{t("ui.acc.noPrevious")}</small>;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return <small className={`acc-card__change ${pct >= 0 ? "is-up" : "is-down"}`}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}% {t("ui.acc.vsPrevious")}</small>;
}
function Dashboard({ go }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const [range, setRange] = useState(presetRange("month"));
  const d = useApi(`/api/accounting/dashboard?${new URLSearchParams(range)}`);
  const [entry, setEntry] = useState(null);
  if (!d.data) return <><PeriodPicker value={range} onChange={setRange} /><Loading /></>;
  const c = d.data.cards;
  const cards = [
    ["income", "arrow-down-left", c.income, "reports"], ["expenses", "arrow-up-right", c.expenses, "expenses"], ["profit", "chart-line", c.profit, "reports"],
    ["cash", "book-open", c.cash, "cash"], ["customers", "users", c.customers, "customers"], ["suppliers", "truck", c.suppliers, "suppliers"]
  ];
  return (
    <>
      <div className="toolbar"><PeriodPicker value={range} onChange={setRange} />{d.data.method === "cash" && <span className="acc-basis">{t("ui.acc.cashBasis")}</span>}</div>
      <div className="acc-cards">
        {cards.map(([key, icon, v, tab]) => (
          <button key={key} type="button" className={`acc-card acc-card--${key}`} onClick={() => go(tab)}>
            <span className="acc-card__head"><Icon name={icon} /><span>{t(`ui.acc.cards.${key}`)}</span></span>
            <strong className={key === "profit" && v.now < 0 ? "is-neg" : ""}>{m(v.now)}</strong>
            {"before" in v ? <Change now={v.now} before={v.before} /> : v.overdue > 0 ? <small className="acc-card__change is-down">{fill(t("ui.acc.overdueAmount"), { amount: m(v.overdue) })}</small> : <small className="acc-card__change">&nbsp;</small>}
          </button>
        ))}
      </div>
      <div className="split-view">
        <section className="panel-card">
          <h2 className="panel-card__title">{t("ui.acc.chartTitle")}</h2>
          <IncomeChart data={d.data.chart} />
        </section>
        <section className="panel-card">
          <h2 className="panel-card__title">{t("ui.acc.tabs.cash")}</h2>
          <ul className="acc-accounts">
            {d.data.accounts.map((a) => <li key={a.id}><Icon name={a.kind === "bank" ? "landmark" : "wallet"} /><span>{a.name}</span><b className={a.balance < 0 ? "is-neg" : ""}>{m(a.balance)}</b></li>)}
            <li className="acc-accounts__total"><span>{t("ui.acc.total")}</span><b>{m(c.cash.now)}</b></li>
          </ul>
          <h2 className="panel-card__title acc-gap">{t("ui.acc.outstanding")}</h2>
          <dl className="sub-card__facts">
            <div><dt>{t("ui.acc.cards.customers")}</dt><dd>{m(c.customers.now)}{c.customers.overdue > 0 && <small className="cell-sub is-neg">{fill(t("ui.acc.overdueAmount"), { amount: m(c.customers.overdue) })}</small>}</dd></div>
            <div><dt>{t("ui.acc.cards.suppliers")}</dt><dd>{m(c.suppliers.now)}{c.suppliers.overdue > 0 && <small className="cell-sub is-warn">{fill(t("ui.acc.olderThan30"), { amount: m(c.suppliers.overdue) })}</small>}</dd></div>
          </dl>
        </section>
      </div>
      <section className="panel-card">
        <h2 className="panel-card__title">{t("ui.acc.recent")}</h2>
        <TxTable rows={d.data.recent} onOpen={setEntry} lang={lang} />
      </section>
      {entry && <EntryModal id={entry} onClose={() => setEntry(null)} />}
    </>
  );
}

/* income and expenses per day / month (bars side by side) */
function IncomeChart({ data }) {
  const { t } = useLanguage();
  const m = useMoney();
  if (!data.length) return <EmptyState icon="chart-line" text={t("ui.acc.noData")} />;
  const max = Math.max(1, ...data.flatMap((x) => [x.income, x.expenses]));
  const W = 640, H = 220, pad = 26, step = (W - pad * 2) / data.length, bw = Math.max(2, Math.min(18, step / 2 - 2));
  const y = (v) => H - pad - (Math.max(0, v) / max) * (H - pad * 2);
  return (
    <div className="acc-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("ui.acc.chartTitle")}>
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="acc-chart__axis" />
        {data.map((x, i) => {
          const cx = pad + step * i + step / 2;
          return (
            <g key={x.key}>
              <rect x={cx - bw - 1} y={y(x.income)} width={bw} height={H - pad - y(x.income)} rx="2" className="acc-chart__in"><title>{`${x.key} · ${t("ui.acc.cards.income")}: ${m(x.income)}`}</title></rect>
              <rect x={cx + 1} y={y(x.expenses)} width={bw} height={H - pad - y(x.expenses)} rx="2" className="acc-chart__out"><title>{`${x.key} · ${t("ui.acc.cards.expenses")}: ${m(x.expenses)}`}</title></rect>
              {(data.length <= 12 || i % Math.ceil(data.length / 10) === 0) && <text x={cx} y={H - 8} textAnchor="middle" className="acc-chart__label">{x.key.length > 7 ? x.key.slice(8) : x.key.slice(2)}</text>}
            </g>
          );
        })}
      </svg>
      <p className="acc-legend"><span className="is-in" />{t("ui.acc.cards.income")} <span className="is-out" />{t("ui.acc.cards.expenses")}</p>
    </div>
  );
}

/* what an entry is: its source, or for a money movement the kind of movement (expense, customer payment, transfer…) */
const kindLabel = (t, e) => { const src = e.type || e.source; const k = src === "money" ? String(e.ref || "").replace(/-\d+$/, "") : src; const l = t(`ui.acc.sources.${k}`); return l.startsWith("ui.") ? t(`ui.acc.sources.${src}`) : l; };
function TxTable({ rows, onOpen, lang }) {
  const { t } = useLanguage();
  const m = useMoney();
  if (!rows.length) return <EmptyState icon="book-open" text={t("ui.acc.noData")} />;
  return (
    <div className="table-wrap"><table className="table table--compact">
      <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.acc.reference")}</th><th>{t("ui.acc.description")}</th><th>{t("ui.acc.type")}</th><th className="num">{t("ui.acc.amount")}</th></tr></thead>
      <tbody>{rows.map((e) => (
        <tr key={e.id} className="is-clickable" onClick={() => onOpen(e.id)}>
          <td>{date(e.date, lang)}</td><td><code className="action-code">{e.ref || "—"}</code></td>
          <td>{e.description}{e.kind === "reversal" && <small className="cell-sub is-warn">{t("ui.acc.reversal")}</small>}</td>
          <td>{kindLabel(t, e)}</td><td className="num">{m(e.amount)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function EntryModal({ id, onClose }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const d = useApi(`/api/accounting/entries/${id}`);
  const e = d.data?.entry;
  return (
    <Modal title={e ? `${e.ref || "—"} · ${date(e.date, lang)}` : "…"} onClose={onClose} wide>
      {!d.data ? <Loading /> : (
        <>
          <p className="muted">{e.description} · {t(`ui.acc.sources.${e.source}`)}{e.kind === "reversal" ? ` · ${t("ui.acc.reversal")}` : ""}{e.revision > 1 ? ` · ${fill(t("ui.acc.revision"), { n: e.revision })}` : ""}</p>
          <table className="table table--compact">
            <thead><tr><th>{t("ui.acc.account")}</th><th className="num">{t("ui.acc.debit")}</th><th className="num">{t("ui.acc.credit")}</th></tr></thead>
            <tbody>{d.data.lines.map((l, i) => <tr key={i}><td><code className="action-code">{l.code}</code> {l.account}</td><td className="num">{l.debit ? m(l.debit) : ""}</td><td className="num">{l.credit ? m(l.credit) : ""}</td></tr>)}</tbody>
          </table>
          <p className="muted acc-note"><Icon name="lock" /> {t("ui.acc.postedNote")}</p>
        </>
      )}
    </Modal>
  );
}

/* ---------- customer / supplier debts ---------- */
function Debts({ kind }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const isC = kind === "customer";
  const d = useApi(`/api/accounting/${isC ? "receivables" : "payables"}`);
  const [open, setOpen] = useState(null);
  const [paying, setPaying] = useState(null);
  if (!d.data) return <Loading />;
  const docsOf = (pid) => d.data.documents.filter((x) => x.partyId === pid);
  const canPay = can(isC ? "payments.receive" : "purchases.pay");
  return (
    <>
      <div className="acc-cards acc-cards--3">
        <div className="acc-card is-static"><span className="acc-card__head"><Icon name={isC ? "users" : "truck"} /><span>{t(`ui.acc.cards.${isC ? "customers" : "suppliers"}`)}</span></span><strong>{m(d.data.total)}</strong>
          {Math.abs(d.data.books - d.data.total) > 0.01 && <small className="acc-card__change">{fill(t("ui.acc.booksNote"), { amount: m(d.data.books) })}</small>}</div>
        {isC && <div className="acc-card is-static"><span className="acc-card__head"><Icon name="alert" /><span>{t("ui.acc.overdue")}</span></span><strong className={d.data.overdue > 0 ? "is-neg" : ""}>{m(d.data.overdue)}</strong></div>}
        <div className="acc-card is-static acc-aging"><span className="acc-card__head"><Icon name="clock" /><span>{t("ui.acc.aging")}</span></span>
          <ul>{d.data.aging.map((a) => <li key={a.bucket}><span>{t(`ui.acc.buckets.${a.bucket}`)}</span><b>{m(a.amount)}</b></li>)}</ul></div>
      </div>
      {d.data.parties.length === 0 ? <EmptyState icon="check" text={t(isC ? "ui.acc.noCustomerDebts" : "ui.acc.noSupplierDebts")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t(isC ? "ui.common.customer" : "ui.common.supplier")}</th><th className="num">{t("ui.acc.documents")}</th><th className="num">{t("ui.acc.original")}</th><th className="num">{t("ui.acc.paid")}</th><th className="num">{t("ui.acc.remaining")}</th><th>{t("ui.acc.oldest")}</th><th /></tr></thead>
          <tbody>{d.data.parties.map((p) => (
            <FragmentRows key={p.id} open={open === p.id}
              row={(
                <tr>
                  <td><button type="button" className="link-btn acc-party" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    <Icon name={open === p.id ? "chevron-down" : "chevron-right"} /> <strong>{p.name}</strong></button>
                    {p.overdue > 0 && <small className="cell-sub is-neg">{fill(t("ui.acc.overdueAmount"), { amount: m(p.overdue) })}</small>}</td>
                  <td className="num">{p.documents}</td><td className="num">{m(p.total)}</td><td className="num">{m(p.paid)}</td><td className="num"><b>{m(p.balance)}</b></td>
                  <td>{date(p.oldest, lang)}</td>
                  <td className="row-actions">{canPay && <button type="button" className="btn btn--primary btn--sm" onClick={() => setPaying(p)}>{t(isC ? "ui.acc.receivePayment" : "ui.acc.makePayment")}</button>}</td>
                </tr>
              )}
              detail={(
                <tr className="acc-docs"><td colSpan={7}>
                  <table className="table table--compact">
                    <thead><tr><th>{t("ui.acc.reference")}</th><th>{t("ui.common.date")}</th>{isC && <th>{t("ui.acc.due")}</th>}<th className="num">{t("ui.acc.original")}</th><th className="num">{t("ui.acc.paid")}</th><th className="num">{t("ui.acc.remaining")}</th><th>{t("ui.common.status")}</th></tr></thead>
                    <tbody>{docsOf(p.id).map((x) => (
                      <tr key={`${x.kind}${x.id}`}>
                        <td>{x.kind === "invoice" ? <Link to={`/app/invoices/${x.id}`}>{x.ref}</Link> : x.kind === "sale" ? <Link to={`/app/sales/${x.id}`}>{x.ref}</Link> : x.ref}</td>
                        <td>{date(x.date, lang)}</td>{isC && <td>{date(x.due, lang)}</td>}<td className="num">{m(x.total)}</td><td className="num">{m(x.paid)}</td><td className="num">{m(x.balance)}</td>
                        <td><span className={`badge-status badge-status--${x.status}`}>{t(`ui.status.${x.status}`)}</span>{x.daysLate > 0 && isC && <small className="cell-sub is-neg">{fill(t("ui.acc.daysLate"), { n: x.daysLate })}</small>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </td></tr>
              )} />
          ))}</tbody>
        </table></div>
      )}
      <p className="muted acc-note"><Icon name="info" /> {t(isC ? "ui.acc.allocationNoteCustomer" : "ui.acc.allocationNoteSupplier")}</p>
      {paying && <PayModal kind={kind} party={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); d.reload(); }} />}
    </>
  );
}
const FragmentRows = ({ row, detail, open }) => <>{row}{open && detail}</>;

function PayModal({ kind, party, onClose, onDone }) {
  const { t } = useLanguage();
  const m = useMoney();
  const isC = kind === "customer";
  const [f, setF] = useState({ amount: String(party.balance), method: "cash", bankAccountId: "", reference: "" });
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    const body = { amount: Number(f.amount), method: f.method, bankAccountId: f.bankAccountId || null, reference: f.reference || null };
    if (await sub.run(() => apiRequest(`/api/${isC ? "customers" : "suppliers"}/${party.id}/payments`, { method: "POST", body }))) onDone();
  };
  return (
    <Modal title={`${t(isC ? "ui.acc.receivePayment" : "ui.acc.makePayment")} · ${party.name}`} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <p className="muted">{fill(t("ui.acc.owes"), { amount: m(party.balance) })}</p>
        <Field label={t("ui.acc.amount")} error={sub.fieldErrors.amount}><input className="input input--big" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <PaymentFields method={f.method} onMethod={(v) => setF({ ...f, method: v })} bankId={f.bankAccountId} onBank={(v) => setF({ ...f, bankAccountId: v })} errors={sub.fieldErrors} />
        <Field label={`${t("ui.acc.reference")} ${t("ui.common.optional")}`}><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} /></Field>
        <p className="muted">{t(isC ? "ui.acc.allocationNoteCustomer" : "ui.acc.allocationNoteSupplier")}</p>
        <FormError error={sub.formError?.errors ? null : sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy || !(Number(f.amount) > 0)}><Icon name="check" /><span>{t("ui.common.save")}</span></button></div>
      </form>
    </Modal>
  );
}

/* ---------- reports ---------- */
const SIMPLE_REPORTS = ["pnl", "income", "expenses", "cash", "receivables", "payables", "transactions"];
const ADVANCED_REPORTS = ["balance", "trial", "ledger"];
function Reports({ advanced }) {
  const { t } = useLanguage();
  const [type, setType] = useState("pnl");
  const [range, setRange] = useState(presetRange("month"));
  const list = [...SIMPLE_REPORTS, ...(advanced ? ADVANCED_REPORTS : [])];
  return (
    <div className="acc-reports">
      <nav className="acc-reports__nav" aria-label={t("ui.acc.tabs.reports")}>
        <ul className="group-links">
          {list.map((r) => (
            <li key={r}><button type="button" className={"group-link acc-report-link" + (type === r ? " is-current" : "")} aria-current={type === r ? "true" : undefined} onClick={() => setType(r)}>
              <span className="group-link__text"><strong>{t(`ui.acc.reports.${r}`)}</strong></span><Icon name="chevron-right" className="group-link__go" />
            </button></li>
          ))}
        </ul>
      </nav>
      <section className="panel-card acc-report">
        {/* a fresh view per report: one report's data is never drawn as another's while loading */}
        <ReportView key={type} type={type} range={range} setRange={setRange} />
      </section>
    </div>
  );
}

function ReportView({ type, range, setRange }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const [account, setAccount] = useState("");
  const [q, setQ] = useState("");
  const [entry, setEntry] = useState(null);
  const asAt = ["balance", "trial"].includes(type);
  const path = type === "receivables" || type === "payables" ? `/api/accounting/${type}`
    : `/api/accounting/reports/${type}?${new URLSearchParams({ ...range, ...(type === "ledger" ? { account } : {}), ...(type === "transactions" && q ? { q } : {}) })}`;
  const d = useApi(path);
  const chart = useApi(type === "ledger" ? "/api/accounting/chart" : null);
  const title = t(`ui.acc.reports.${type}`);
  const csv = useMemo(() => toCsv(type, d.data), [type, d.data]);
  return (
    <>
      <div className="acc-report__head">
        <h2>{title}</h2>
        <div className="acc-report__tools no-print">
          {asAt ? <label className="acc-asat"><span>{t("ui.acc.asAt")}</span><input className="input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
            : type !== "receivables" && type !== "payables" && <PeriodPicker value={range} onChange={setRange} />}
          {type === "ledger" && <select className="input input--auto" value={account} onChange={(e) => setAccount(e.target.value)} aria-label={t("ui.acc.account")}>
            <option value="">{t("ui.acc.chooseAccount")}</option>{(chart.data?.accounts || []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>}
          {type === "transactions" && <input className="input input--auto" placeholder={t("ui.common.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} />}
          <button type="button" className="link-btn" onClick={() => window.print()}><Icon name="printer" /> {t("ui.acc.print")}</button>
          {csv && <button type="button" className="link-btn" onClick={() => downloadCsv(`${type}-${range.from}-${range.to}.csv`, csv.head, csv.rows)}><Icon name="download" /> {t("ui.acc.excel")}</button>}
        </div>
      </div>
      <p className="muted acc-report__period">{asAt ? fill(t("ui.acc.asAtDate"), { date: date(range.to, lang) }) : type === "receivables" || type === "payables" ? fill(t("ui.acc.asAtDate"), { date: date(isoDate(new Date()), lang) }) : `${date(range.from, lang)} – ${date(range.to, lang)}`}</p>
      {!d.data ? <Loading /> : <ReportBody type={type} data={d.data} m={m} t={t} lang={lang} onOpen={setEntry} />}
      {entry && <EntryModal id={entry} onClose={() => setEntry(null)} />}
    </>
  );
}

const Rows = ({ rows, m, total, t, label }) => (
  <>
    {rows.map((r) => <tr key={r.id || r.name}><td className="acc-indent">{r.name}</td><td className="num">{m(r.balance)}</td></tr>)}
    {total !== undefined && <tr className="acc-subtotal"><td>{label || t("ui.acc.total")}</td><td className="num">{m(total)}</td></tr>}
  </>
);
function ReportBody({ type, data, m, t, lang, onOpen }) {
  if (type === "pnl") {
    if (data.method === "cash") {
      return (
        <table className="table acc-statement"><tbody>
          <tr className="acc-section"><td colSpan={2}>{t("ui.acc.cashBasis")}</td></tr>
          {data.lines.map((l) => <tr key={`${l.kind}${l.direction}`}><td className="acc-indent">{t(`ui.acc.sources.${l.kind}`)} · {t(`ui.acc.dir.${l.direction}`)}</td><td className="num">{m(l.amount)}</td></tr>)}
          <tr className="acc-subtotal"><td>{t("ui.acc.cards.income")}</td><td className="num">{m(data.income)}</td></tr>
          <tr className="acc-subtotal"><td>{t("ui.acc.cards.expenses")}</td><td className="num">{m(data.expenses)}</td></tr>
          <tr className="acc-total"><td>{t("ui.acc.netProfit")}</td><td className={`num ${data.profit < 0 ? "is-neg" : ""}`}>{m(data.profit)}</td></tr>
        </tbody></table>
      );
    }
    const s = data.totals;
    return (
      <table className="table acc-statement"><tbody>
        <tr className="acc-section"><td colSpan={2}>{t("ui.acc.revenue")}</td></tr>
        <Rows rows={data.revenue} m={m} t={t} total={s.revenue} label={t("ui.acc.totalRevenue")} />
        <tr className="acc-section"><td colSpan={2}>{t("ui.acc.cogs")}</td></tr>
        <Rows rows={data.cogs} m={m} t={t} total={s.cogs} label={t("ui.acc.totalCogs")} />
        <tr className="acc-total"><td>{t("ui.acc.grossProfit")}</td><td className="num">{m(s.gross)}</td></tr>
        <tr className="acc-section"><td colSpan={2}>{t("ui.acc.cards.expenses")}</td></tr>
        <Rows rows={data.expenses} m={m} t={t} total={s.expenses} label={t("ui.acc.totalExpenses")} />
        <tr className="acc-total"><td>{t("ui.acc.netProfit")}</td><td className={`num ${s.net < 0 ? "is-neg" : ""}`}>{m(s.net)}</td></tr>
      </tbody></table>
    );
  }
  if (type === "income" || type === "expenses") {
    return (
      <>
        <table className="table acc-statement"><tbody><Rows rows={data.accounts} m={m} t={t} total={data.total} /></tbody></table>
        {data.items.length > 0 && <>
          <h3 className="acc-h3">{t(type === "income" ? "ui.acc.otherIncomeList" : "ui.acc.expenseList")}</h3>
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.common.category")}</th><th>{t("ui.acc.description")}</th><th className="num">{t("ui.acc.amount")}</th></tr></thead>
            <tbody>{data.items.map((x) => <tr key={x.id}><td>{date(x.date, lang)}</td><td>{t(`ui.money.${type === "income" ? "incomeCategories" : "categories"}.${x.category}`)}</td><td>{x.description || "—"}</td><td className="num">{m(x.amount)}</td></tr>)}</tbody>
          </table></div>
        </>}
      </>
    );
  }
  if (type === "cash") {
    const sum = (k) => data.accounts.reduce((s, a) => s + a[k], 0);
    return (
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t("ui.acc.account")}</th><th className="num">{t("ui.acc.opening")}</th><th className="num">{t("ui.acc.moneyIn")}</th><th className="num">{t("ui.acc.moneyOut")}</th><th className="num">{t("ui.acc.closing")}</th></tr></thead>
        <tbody>{data.accounts.map((a) => <tr key={a.id}><td>{a.name}</td><td className="num">{m(a.opening)}</td><td className="num">{m(a.in)}</td><td className="num">{m(a.out)}</td><td className="num"><b>{m(a.closing)}</b></td></tr>)}</tbody>
        <tfoot className="table-summary"><tr><td>{t("ui.acc.total")}</td><td className="num">{m(sum("opening"))}</td><td className="num">{m(sum("in"))}</td><td className="num">{m(sum("out"))}</td><td className="num"><b>{m(sum("closing"))}</b></td></tr></tfoot>
      </table></div>
    );
  }
  if (type === "receivables" || type === "payables") {
    return (
      <>
        <div className="acc-aging-row">{data.aging.map((a) => <div key={a.bucket}><small>{t(`ui.acc.buckets.${a.bucket}`)}</small><b>{m(a.amount)}</b></div>)}</div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t(type === "receivables" ? "ui.common.customer" : "ui.common.supplier")}</th><th className="num">{t("ui.acc.original")}</th><th className="num">{t("ui.acc.paid")}</th><th className="num">{t("ui.acc.remaining")}</th><th className="num">{t("ui.acc.overdue")}</th></tr></thead>
          <tbody>{data.parties.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{m(p.total)}</td><td className="num">{m(p.paid)}</td><td className="num"><b>{m(p.balance)}</b></td><td className="num">{p.overdue ? m(p.overdue) : "—"}</td></tr>)}</tbody>
          <tfoot className="table-summary"><tr><td>{t("ui.acc.total")}</td><td /><td /><td className="num"><b>{m(data.total)}</b></td><td className="num">{m(data.overdue)}</td></tr></tfoot>
        </table></div>
      </>
    );
  }
  if (type === "transactions") return <TxTable rows={data.entries} onOpen={onOpen} lang={lang} />;
  if (type === "trial") {
    return (
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t("ui.acc.code")}</th><th>{t("ui.acc.account")}</th><th className="num">{t("ui.acc.debit")}</th><th className="num">{t("ui.acc.credit")}</th></tr></thead>
        <tbody>{data.accounts.map((a) => <tr key={a.id}><td><code className="action-code">{a.code}</code></td><td>{a.name}</td><td className="num">{a.debitBalance ? m(a.debitBalance) : ""}</td><td className="num">{a.creditBalance ? m(a.creditBalance) : ""}</td></tr>)}</tbody>
        <tfoot className="table-summary"><tr><td colSpan={2}>{t("ui.acc.total")} {Math.abs(data.totals.debit - data.totals.credit) < 0.01 ? <span className="badge-status badge-status--paid">{t("ui.acc.balanced")}</span> : <span className="badge-status badge-status--overdue">{t("ui.acc.notBalanced")}</span>}</td>
          <td className="num"><b>{m(data.totals.debit)}</b></td><td className="num"><b>{m(data.totals.credit)}</b></td></tr></tfoot>
      </table></div>
    );
  }
  if (type === "balance") {
    const s = data.totals;
    return (
      <table className="table acc-statement"><tbody>
        <tr className="acc-section"><td colSpan={2}>{t("ui.acc.assets")}</td></tr>
        <Rows rows={data.assets} m={m} t={t} total={s.assets} label={t("ui.acc.totalAssets")} />
        <tr className="acc-section"><td colSpan={2}>{t("ui.acc.liabilities")}</td></tr>
        <Rows rows={data.liabilities} m={m} t={t} total={s.liabilities} label={t("ui.acc.totalLiabilities")} />
        <tr className="acc-section"><td colSpan={2}>{t("ui.acc.equity")}</td></tr>
        <Rows rows={[...data.equity, { id: "p", name: t("ui.acc.profitToDate"), balance: data.profitToDate }]} m={m} t={t} total={s.equity} label={t("ui.acc.totalEquity")} />
        <tr className="acc-total"><td>{t("ui.acc.liabilitiesAndEquity")} {s.balanced ? <span className="badge-status badge-status--paid">{t("ui.acc.balanced")}</span> : <span className="badge-status badge-status--overdue">{t("ui.acc.notBalanced")}</span>}</td><td className="num">{m(s.liabilitiesAndEquity)}</td></tr>
      </tbody></table>
    );
  }
  if (type === "ledger") {
    if (!data.account) return <EmptyState icon="layers" text={t("ui.acc.chooseAccount")} />;
    return (
      <div className="table-wrap"><table className="table table--compact">
        <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.acc.reference")}</th><th>{t("ui.acc.description")}</th><th className="num">{t("ui.acc.debit")}</th><th className="num">{t("ui.acc.credit")}</th><th className="num">{t("ui.acc.balance")}</th></tr></thead>
        <tbody>
          <tr className="acc-subtotal"><td colSpan={5}>{t("ui.acc.opening")}</td><td className="num">{m(data.opening)}</td></tr>
          {data.lines.map((l, i) => <tr key={i} className="is-clickable" onClick={() => onOpen(l.entryId)}><td>{date(l.date, lang)}</td><td><code className="action-code">{l.ref || "—"}</code></td><td>{l.description}</td><td className="num">{l.debit ? m(l.debit) : ""}</td><td className="num">{l.credit ? m(l.credit) : ""}</td><td className="num">{m(l.balance)}</td></tr>)}
          <tr className="acc-total"><td colSpan={5}>{t("ui.acc.closing")}</td><td className="num">{m(data.closing)}</td></tr>
        </tbody>
      </table></div>
    );
  }
  return null;
}

function toCsv(type, d) {
  if (!d) return null;
  if (type === "pnl" && d.totals) return { head: ["section", "account", "amount"], rows: [...d.revenue.map((r) => ["revenue", r.name, r.balance]), ...d.cogs.map((r) => ["cost of goods", r.name, r.balance]), ...d.expenses.map((r) => ["expenses", r.name, r.balance]), ["", "net profit", d.totals.net]] };
  if (type === "pnl") return { head: ["kind", "direction", "amount"], rows: [...d.lines.map((l) => [l.kind, l.direction, l.amount]), ["", "profit", d.profit]] };
  if (type === "income" || type === "expenses") return { head: ["date", "category", "description", "amount"], rows: d.items.map((x) => [x.date, x.category, x.description || "", x.amount]) };
  if (type === "cash") return { head: ["account", "opening", "in", "out", "closing"], rows: d.accounts.map((a) => [a.name, a.opening, a.in, a.out, a.closing]) };
  if (type === "receivables" || type === "payables") return { head: ["party", "reference", "date", "due", "total", "paid", "balance", "status"], rows: d.documents.map((x) => [x.party, x.ref, x.date, x.due, x.total, x.paid, x.balance, x.status]) };
  if (type === "transactions") return { head: ["date", "reference", "description", "type", "amount"], rows: d.entries.map((e) => [e.date, e.ref, e.description, e.source, e.amount]) };
  if (type === "trial") return { head: ["code", "account", "debit", "credit"], rows: d.accounts.map((a) => [a.code, a.name, a.debitBalance, a.creditBalance]) };
  if (type === "balance") return { head: ["section", "account", "amount"], rows: [...d.assets.map((r) => ["assets", r.name, r.balance]), ...d.liabilities.map((r) => ["liabilities", r.name, r.balance]), ...d.equity.map((r) => ["equity", r.name, r.balance]), ["equity", "profit to date", d.profitToDate]] };
  if (type === "ledger" && d.account) return { head: ["date", "reference", "description", "debit", "credit", "balance"], rows: d.lines.map((l) => [l.date, l.ref, l.description, l.debit, l.credit, l.balance]) };
  return null;
}

/* ---------- books (Advanced): chart of accounts ---------- */
function Books() {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const d = useApi("/api/accounting/chart");
  const [editing, setEditing] = useState(null);
  if (!d.data) return <Loading />;
  const types = ["asset", "liability", "equity", "revenue", "cogs", "expense"];
  return (
    <>
      <p className="muted acc-note"><Icon name="info" /> {t("ui.acc.chartHelp")}</p>
      <div className="group-sections">
        {types.map((ty) => {
          const rows = d.data.accounts.filter((a) => a.type === ty);
          if (!rows.length) return null;
          return (
            <section key={ty} className="group-section">
              <h2 className="group-section__title">{t(`ui.acc.types.${ty}`)}</h2>
              <ul className="acc-chart-list">{rows.map((a) => (
                <li key={a.id}><code className="action-code">{a.code}</code><span>{a.name}</span><b>{m(a.balance)}</b>
                  {can("accounting.manage") && <button type="button" className="icon-btn" title={t("ui.acc.rename")} aria-label={t("ui.acc.rename")} onClick={() => setEditing(a)}><Icon name="pencil" /></button>}</li>
              ))}</ul>
            </section>
          );
        })}
      </div>
      {editing && <RenameAccount account={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); d.reload(); }} />}
    </>
  );
}
function RenameAccount({ account, onClose, onDone }) {
  const { t } = useLanguage();
  const [name, setName] = useState(account.name);
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(`/api/accounting/chart/${account.id}`, { method: "PATCH", body: { name } }))) onDone(); };
  return (
    <Modal title={`${account.code} · ${t("ui.acc.rename")}`} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.common.name")} error={sub.fieldErrors.name}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></Field>
        <p className="muted">{t("ui.acc.renameNote")}</p>
        <FormError error={sub.formError?.errors ? null : sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

/* ---------- settings ---------- */
function Settings({ meta }) {
  const { t } = useLanguage();
  const s = useApi("/api/accounting/settings");
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(false);
  const sub = useSubmit();
  const canManage = meta.data?.canManage;
  if (!s.data) return <Loading />;
  const v = f || s.data;
  const save = async (e) => { e.preventDefault(); setSaved(false); if (await sub.run(() => apiRequest("/api/accounting/settings", { method: "PUT", body: v }))) { setSaved(true); s.reload(); } };
  const months = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleString(undefined, { month: "long" }));
  return (
    <form onSubmit={save} className="acc-settings">
      <section className="panel-card">
        <h2 className="panel-card__title">{t("ui.acc.method")}</h2>
        {["accrual", "cash"].map((mth) => (
          <label key={mth} className={"db-choice__opt" + (v.method === mth ? " is-on" : "")}>
            <input type="radio" name="method" value={mth} checked={v.method === mth} disabled={!canManage} onChange={() => setF({ ...v, method: mth })} />
            <span><strong>{t(`ui.acc.methods.${mth}`)}</strong><small>{t(`ui.acc.methodHelp.${mth}`)}</small></span>
          </label>
        ))}
      </section>
      <section className="panel-card">
        <h2 className="panel-card__title">{t("ui.acc.financialYear")}</h2>
        <Field label={t("ui.acc.fyStart")}><select className="input" value={v.fyStartMonth} disabled={!canManage} onChange={(e) => setF({ ...v, fyStartMonth: Number(e.target.value) })}>{months.map((mn, i) => <option key={i} value={i + 1}>{mn}</option>)}</select></Field>
        <dl className="sub-card__facts">
          <div><dt>{t("ui.acc.modeLabel")}</dt><dd>{t(`ui.acc.modes.${meta.data?.mode || "simple"}`)} <small className="muted">· {t("ui.acc.modeByFaatix")}</small></dd></div>
          <div><dt>{t("ui.acc.currency")}</dt><dd>{meta.data?.currency}</dd></div>
        </dl>
      </section>
      <FormError error={sub.formError} />
      {canManage ? <div className="form-actions"><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>{saved && <span className="slug-ok"><Icon name="check" /> {t("ui.common.saved")}</span>}</div>
        : <p className="muted">{t("ui.acc.ownerOnly")}</p>}
    </form>
  );
}
