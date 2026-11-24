import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { apiRequest, fileUrl } from "../services/api.js";
import { PageHeader, Tabs, useApi, Loading, EmptyState, DateRange, isoDate, useErrorText } from "./ui.jsx";
import { date, money } from "./format.js";
import { buildReportPdf, imageData } from "./reportPdf.js";

/*
 * Report center (server: routes/pdfReports.js; PDF: reportPdf.js).
 *   Individual reports   one customer, supplier, product, invoice, purchase, branch… (pick it, then the period)
 *   Summary reports      overviews across the business: performance, directories, inventory, sales, finance, branches
 * Every report: preview here, download as PDF, or print. The list only holds what this user may see.
 * Other screens open a report directly: /app/m/pdfReports?report=product_details&product=12
 */
const GROUP_ORDER = ["customers", "suppliers", "products", "documents", "business", "sales", "purchasing", "finance", "branches"];
const GROUP_ICON = { customers: "users", suppliers: "store", products: "package", documents: "receipt", business: "chart-line", sales: "cart", purchasing: "truck", finance: "landmark", branches: "branch" };
const VALUE_COLS = new Set(["type", "status", "method", "bucket", "direction", "line", "account", "category"]);

function presetRange(p) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const d = (yy, mm, dd) => isoDate(new Date(Date.UTC(yy, mm, dd)));
  const today = d(y, m, now.getDate());
  if (p === "today") return { from: today, to: today };
  if (p === "week") { const wd = (now.getDay() + 6) % 7; return { from: d(y, m, now.getDate() - wd), to: today }; }
  if (p === "quarter") return { from: d(y, Math.floor(m / 3) * 3, 1), to: today };
  if (p === "year") return { from: d(y, 0, 1), to: today };
  if (p === "all") return { from: "2000-01-01", to: today };
  return { from: d(y, m, 1), to: today };
}

/* labels and cell formatting shared by the preview and the PDF */
function useReportText() {
  const { t, lang } = useLanguage();
  const { business } = useAuth();
  const has = (k) => !t(k).startsWith("ui.");
  const human = (k) => String(k).replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const labelOf = (kind, key) => (has(`ui.rpt.${kind}.${key}`) ? t(`ui.rpt.${kind}.${key}`) : human(key));
  const value = (v) => {
    const s = String(v);
    if (has(`ui.rpt.v.${s}`)) return t(`ui.rpt.v.${s}`);
    if (s.startsWith("expense:")) { const c = s.slice(8); return has(`ui.money.categories.${c}`) ? t(`ui.money.categories.${c}`) : human(c); }
    if (/^[a-z_]+:(in|out)$/.test(s)) { const [k, dir] = s.split(":"); return `${has(`ui.acc.sources.${k}`) ? t(`ui.acc.sources.${k}`) : human(k)} · ${t(`ui.acc.dir.${dir}`)}`; }
    if (has(`ui.money.categories.${s}`)) return t(`ui.money.categories.${s}`);
    if (has(`ui.acc.buckets.${s}`)) return t(`ui.acc.buckets.${s}`);
    return s;
  };
  const qty = (v) => Number(v).toLocaleString(lang === "so" ? "so-SO" : "en-US", { maximumFractionDigits: 4 });
  const fmt = (c, v) => {
    if (v === null || v === undefined || v === "") return c.type === "text" || !c.type ? "—" : "";
    switch (c.type) {
      case "money": return money(v, business?.currency || "USD", lang);
      case "qty": return qty(v);
      case "int": return String(Math.round(Number(v)));
      case "pct": return `${Number(v).toFixed(1)}%`;
      case "date": return date(v, lang);
      default: return VALUE_COLS.has(c.key) || c.key === "balanced" ? value(v) : String(v);
    }
  };
  return { t, lang, labelOf, fmt, L: (k) => t(`ui.rpt.${k}`) };
}

export default function PdfReports() {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const d = useApi("/api/pdf-reports");
  const preset = params.get("report");
  const list = d.data?.reports || [];
  const initialCat = list.find((r) => r.key === preset)?.category || "individual";
  const [cat, setCat] = useState(null);
  const category = cat || initialCat;
  const [key, setKey] = useState(preset || null);
  const reports = list.filter((r) => r.category === category);
  const current = list.find((r) => r.key === key && r.category === category) || reports[0] || null;
  const groups = GROUP_ORDER.map((g) => ({ g, items: reports.filter((r) => r.group === g) })).filter((x) => x.items.length);
  const initial = useMemo(() => Object.fromEntries([...params.entries()].filter(([k]) => k !== "report")), []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d.data) return <div className="page"><PageHeader icon="file-chart" title={t("app.modules.pdfReports")} /><Loading /></div>;
  return (
    <div className="page rpt-page">
      <PageHeader icon="file-chart" title={t("app.modules.pdfReports")} />
      <Tabs value={category} onChange={(c) => { setCat(c); setKey(null); setParams({}, { replace: true }); }}
        tabs={[{ id: "individual", label: t("ui.rpt.individual"), icon: "user" }, { id: "summary", label: t("ui.rpt.summary"), icon: "layers" }]} />
      {!current ? <EmptyState icon="file-chart" text={t("ui.rpt.none")} /> : (
        <div className="acc-reports rpt-layout">
          <nav className="acc-reports__nav rpt-nav" aria-label={t("ui.rpt.listLabel")}>
            {groups.map(({ g, items }) => (
              <section key={g} className="rpt-nav__group">
                <h2 className="group-section__title"><Icon name={GROUP_ICON[g]} /> {t(`ui.rpt.g.${g}`)}</h2>
                <ul className="group-links">
                  {items.map((r) => (
                    <li key={r.key}><button type="button" className={"group-link acc-report-link" + (current.key === r.key ? " is-current" : "")} aria-current={current.key === r.key ? "true" : undefined} onClick={() => setKey(r.key)}>
                      <span className="group-link__text"><strong>{t(`ui.rpt.r.${r.key}`)}</strong></span><Icon name="chevron-right" className="group-link__go" />
                    </button></li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          <ReportRunner key={current.key} rep={current} branches={d.data.branches} initial={current.key === preset ? initial : {}} />
        </div>
      )}
    </div>
  );
}

/* ---------- one report: filters, preview, PDF, print ---------- */
function ReportRunner({ rep, branches, initial }) {
  const { t, lang, labelOf, fmt, L } = useReportText();
  const { business } = useAuth();
  const errText = useErrorText();
  const needs = (f) => rep.filters.includes(f);
  const [preset, setPreset] = useState(initial.from ? "custom" : "month");
  const [f, setF] = useState({ ...presetRange("month"), granularity: "day", limit: "20", ...initial });
  const [data, setData] = useState(null);
  const [state, setState] = useState({ busy: null, error: null });
  const required = ["customer", "supplier", "product", "invoice", "purchase", "account"].filter(needs).concat(rep.key === "branch_report" ? ["branch"] : []);
  const ready = required.every((k) => f[k]);
  const query = () => new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([k, v]) => v && (needs(k) || ["from", "to"].includes(k) && (needs("from") || needs("to")))))).toString();
  const load = async () => { const r = await apiRequest(`/api/pdf-reports/${rep.key}?${query()}`); setData(r); return r; };
  const run = async (what) => {
    setState({ busy: what, error: null });
    try {
      const r = await load();
      if (what === "pdf" || what === "print") {
        const doc = await buildReportPdf({
          business, logo: await imageData(business?.logoPath ? fileUrl(business.logoPath) : null), report: r, title: t(`ui.rpt.r.${rep.key}`), subtitle: r.subject || r.branch || "",
          periodText: periodOf(r), generatedText: `${L("generated")} ${new Date(r.generatedAt).toLocaleString(lang === "so" ? "so-SO" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}`, L, fmt, labelOf
        });
        const file = `${t(`ui.rpt.r.${rep.key}`)}${r.subject ? ` - ${r.subject}` : ""} ${isoDate(new Date())}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
        if (what === "pdf") doc.save(file);
        else printPdf(doc);
      }
      setState({ busy: null, error: null });
    } catch (err) { setState({ busy: null, error: errText(err) }); }
  };
  const periodOf = (r) => (r.asAt ? `${L("asAt")} ${date(r.asAt, lang)}` : r.period ? `${date(r.period.from, lang)} – ${date(r.period.to, lang)}` : `${L("asAt")} ${date(isoDate(new Date()), lang)}`);
  const set = (k) => (v) => { setData(null); setF((x) => ({ ...x, [k]: v })); };
  return (
    <section className="panel-card acc-report rpt-runner">
      <div className="acc-report__head"><h2>{t(`ui.rpt.r.${rep.key}`)}</h2></div>
      <p className="muted rpt-desc">{t(`ui.rpt.d.${rep.key}`).startsWith("ui.") ? "" : t(`ui.rpt.d.${rep.key}`)}</p>
      <div className="rpt-filters">
        {["customer", "supplier", "product", "invoice", "purchase", "account"].filter(needs).map((k) => <Picker key={k} kind={k} value={f[k]} onChange={set(k)} />)}
        {(needs("from") || needs("to")) && (
          <label className="rpt-field"><span>{L("filter.period")}</span>
            <span className="rpt-period">
              {needs("from") && <select className="input input--auto" value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value !== "custom") { setData(null); setF((x) => ({ ...x, ...presetRange(e.target.value) })); } }}>
                {["today", "week", "month", "quarter", "year", "all", "custom"].map((p) => <option key={p} value={p}>{L(`periods.${p}`)}</option>)}</select>}
              {needs("from") && preset === "custom" && <DateRange value={{ from: f.from, to: f.to }} onChange={(v) => { setData(null); setF((x) => ({ ...x, ...v })); }} />}
              {!needs("from") && <input className="input" type="date" value={f.to} onChange={(e) => set("to")(e.target.value)} />}
            </span>
          </label>
        )}
        {needs("category") && <OptionSelect kind="category" label={L("filter.category")} value={f.category} onChange={set("category")} />}
        {(needs("branch") || rep.key === "branch_report") && branches.length > 1 && (
          <label className="rpt-field"><span>{L("filter.branch")}</span>
            <select className="input" value={f.branch || ""} onChange={(e) => set("branch")(e.target.value)}>
              {rep.key !== "branch_report" && <option value="">{L("allBranches")}</option>}
              {rep.key === "branch_report" && <option value="">{L("choose")}</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
        )}
        {needs("method") && <label className="rpt-field"><span>{L("filter.method")}</span><select className="input" value={f.method || ""} onChange={(e) => set("method")(e.target.value)}>
          <option value="">{L("all")}</option>{["cash", "mobile_money", "bank"].map((m) => <option key={m} value={m}>{labelOf("v", m)}</option>)}</select></label>}
        {needs("stockStatus") && <label className="rpt-field"><span>{L("filter.stockStatus")}</span><select className="input" value={f.stockStatus || ""} onChange={(e) => set("stockStatus")(e.target.value)}>
          <option value="">{L("all")}</option>{["in", "low", "out"].map((m) => <option key={m} value={m}>{labelOf("v", m)}</option>)}</select></label>}
        {needs("status") && <label className="rpt-field"><span>{L("filter.status")}</span><select className="input" value={f.status || ""} onChange={(e) => set("status")(e.target.value)}>
          <option value="">{L("all")}</option>{(rep.group === "purchasing" ? ["ordered", "partial", "received", "returned", "cancelled"] : ["cancelled"]).map((m) => <option key={m} value={m}>{labelOf("v", m)}</option>)}</select></label>}
        {needs("granularity") && <label className="rpt-field"><span>{L("filter.granularity")}</span><select className="input" value={f.granularity} onChange={(e) => set("granularity")(e.target.value)}>
          {["day", "week", "month", "year"].map((m) => <option key={m} value={m}>{L(`gran.${m}`)}</option>)}</select></label>}
        {needs("limit") && <label className="rpt-field"><span>{L("filter.limit")}</span><select className="input" value={f.limit} onChange={(e) => set("limit")(e.target.value)}>{["10", "20", "50"].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      </div>
      <div className="rpt-actions">
        <button type="button" className="btn btn--outline" disabled={!ready || !!state.busy} onClick={() => run("preview")}><Icon name="eye" /><span>{L("preview")}</span></button>
        <button type="button" className="btn btn--primary" disabled={!ready || !!state.busy} onClick={() => run("pdf")}><Icon name="download" /><span>{state.busy === "pdf" ? L("making") : L("download")}</span></button>
        <button type="button" className="link-btn" disabled={!ready || !!state.busy} onClick={() => run("print")}><Icon name="printer" /> {L("print")}</button>
        {!ready && <small className="muted">{L("chooseFirst")}</small>}
      </div>
      {state.error && <p className="form-status form-status--error">{state.error}</p>}
      {state.busy === "preview" && <Loading />}
      {data && <Preview data={data} title={t(`ui.rpt.r.${rep.key}`)} period={periodOf(data)} />}
    </section>
  );
}

/* the PDF in a hidden frame, then the browser's print window */
function printPdf(doc) {
  const url = URL.createObjectURL(doc.output("blob"));
  const frame = document.createElement("iframe");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  frame.src = url;
  frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url); } setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000); };
  document.body.appendChild(frame);
}

/* ---------- the preview: the same report, as it will be printed ---------- */
function Preview({ data, title, period }) {
  const { labelOf, fmt, L } = useReportText();
  const { business } = useAuth();
  const num = (c) => ["money", "qty", "int", "pct"].includes(c.type);
  return (
    <article className="rpt-preview" aria-label={L("preview")}>
      <header className="rpt-preview__head">
        <div className="rpt-preview__biz">
          {business?.logoPath && <img src={fileUrl(business.logoPath)} alt="" />}
          <div><strong>{business?.name}</strong><small>{[business?.phone, business?.email].filter(Boolean).join(" · ")}</small>{business?.address && <small>{business.address}</small>}</div>
        </div>
        <div className="rpt-preview__title"><strong>{title}</strong>{(data.subject || data.branch) && <span>{data.subject || data.branch}</span>}<small>{period}</small></div>
      </header>
      {data.stats?.length > 0 && <div className="rpt-stats">{data.stats.filter((s) => s.value !== null && s.value !== undefined).map((s) => <div key={s.key}><small>{labelOf("f", s.key)}</small><b>{fmt({ type: s.type, key: s.key }, s.value)}</b></div>)}</div>}
      {data.details?.length > 0 && <dl className="rpt-details">{data.details.map(([k, v, type]) => <div key={k}><dt>{labelOf("f", k)}</dt><dd>{fmt({ type: type || "text", key: k }, v)}</dd></div>)}</dl>}
      {data.sections.map((sec, si) => (
        <section key={si} className="rpt-section">
          {sec.title && <h3>{labelOf("sec", sec.title)}</h3>}
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr>{sec.columns.map((c) => <th key={c.key} className={num(c) ? "num" : ""}>{c.label || labelOf("f", c.key)}</th>)}</tr></thead>
            <tbody>{sec.rows.length === 0 ? <tr><td colSpan={sec.columns.length} className="muted">{L("noRows")}</td></tr>
              : sec.rows.slice(0, 300).map((r, i) => <tr key={i} className={r._strong ? "rpt-strong" : r._muted ? "muted" : ""}>{sec.columns.map((c) => <td key={c.key} className={num(c) ? "num" : ""}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody>
            {sec.totals && <tfoot className="table-summary"><tr>{sec.columns.map((c, i) => <td key={c.key} className={num(c) ? "num" : ""}>{c.key in sec.totals ? fmt(c, sec.totals[c.key]) : i === 0 ? L("total") : ""}</td>)}</tr></tfoot>}
          </table></div>
          {sec.rows.length > 300 && <p className="muted">{L("previewLimit").replace("{n}", sec.rows.length)}</p>}
        </section>
      ))}
    </article>
  );
}

/* ---------- pickers ---------- */
function Picker({ kind, value, onChange }) {
  const { L } = useReportText();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState([]);
  const [label, setLabel] = useState("");
  const box = useRef(null);
  useEffect(() => {
    const timer = setTimeout(() => apiRequest(`/api/pdf-reports/options?kind=${kind}&q=${encodeURIComponent(q)}`).then((r) => {
      setOpts(r.options);
      if (value && !label) { const hit = r.options.find((o) => String(o.id) === String(value)); if (hit) setLabel(hit.name); }
    }).catch(() => setOpts([])), 200);
    return () => clearTimeout(timer);
  }, [q, kind]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <label className="rpt-field rpt-picker" ref={box}><span>{L(`filter.${kind}`)}</span>
      <input className="input" value={open ? q : label} placeholder={L("search")} onFocus={() => { setOpen(true); setQ(""); }} onChange={(e) => setQ(e.target.value)} />
      {open && (
        <ul className="rpt-picker__list" role="listbox">
          {opts.length === 0 ? <li className="muted">{L("noMatches")}</li> : opts.map((o) => (
            <li key={o.id}><button type="button" role="option" aria-selected={String(o.id) === String(value)} onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(String(o.id)); setLabel(o.name); setOpen(false); }}><b>{o.name}</b>{o.sub && <small>{o.sub}</small>}</button></li>
          ))}
        </ul>
      )}
    </label>
  );
}
function OptionSelect({ kind, label, value, onChange }) {
  const { L } = useReportText();
  const d = useApi(`/api/pdf-reports/options?kind=${kind}&q=`);
  return (
    <label className="rpt-field"><span>{label}</span>
      <select className="input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{L("all")}</option>{(d.data?.options || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select></label>
  );
}
