import { useRef, useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { PageHeader, useApi, useMoney, Loading, EmptyState, DateRange, daysAgo, isoDate, downloadCsv } from "../ui.jsx";
import { qty, date } from "../format.js";
import { savePdf } from "../pdf.js";

const TYPES = ["sales", "profit", "inventory", "lowStock", "receivables", "payables", "purchases", "expenses", "cashflow", "bestSellers"];
const TYPE_ICON = { sales: "chart-line", profit: "wallet", inventory: "package", lowStock: "alert", receivables: "users", payables: "truck", purchases: "truck", expenses: "wallet", cashflow: "book-open", bestSellers: "chart-line" };
const NO_DATES = new Set(["inventory", "lowStock", "receivables", "payables"]);
const PERCENT = new Set(["margin"]);
const COUNTS = new Set(["documents", "products", "customers", "suppliers", "outOfStock", "lowStock"]);

export default function Reports() {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const [type, setType] = useState("sales");
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const r = useApi(`/api/reports/${type}?${new URLSearchParams(range)}`);
  const d = r.data;
  const reportRef = useRef(null);
  const [savingPdf, setSavingPdf] = useState(false);
  const exportPdf = async () => {
    if (savingPdf) return;
    setSavingPdf(true);
    try { await savePdf(reportRef.current, NO_DATES.has(type) ? `${type}.pdf` : `${type}-${range.from}-${range.to}.pdf`); }
    finally { setSavingPdf(false); }
  };

  const cell = (col, kind, row) => {
    const v = row[col];
    if (kind === "money") return m(v);
    if (kind === "qty") return qty(v);
    if (kind === "date") return date(v, lang);
    if (kind === "label") return t(`ui.reports.lines.${v}`);
    if (kind === "category") return t(`ui.money.categories.${v}`);
    if (kind === "status") return t(`ui.reports.stockStatus.${v}`);
    return v ?? "—";
  };
  const exportCsv = () => d && downloadCsv(`${type}-${range.from}-${range.to}.csv`,
    d.columns.map(([c]) => t(`ui.reports.cols.${c}`)),
    d.rows.map((row) => d.columns.map(([c, kind]) => (kind === "label" ? t(`ui.reports.lines.${row[c]}`) : row[c] ?? ""))));

  return (
    <div className="page">
      <PageHeader icon="file-chart" title={t("ui.reports.title")} actions={
        <>
          <button type="button" className="btn btn--outline" onClick={exportCsv} disabled={!d}><Icon name="download" /><span>{t("ui.common.exportCsv")}</span></button>
          <button type="button" className="btn btn--outline" onClick={() => window.print()}><Icon name="printer" /><span>{t("invoice.printOnly")}</span></button>
          <button type="button" className="btn btn--outline" onClick={exportPdf} disabled={!d || savingPdf}><Icon name="download" /><span>{t(savingPdf ? "invoice.savingPdf" : "invoice.savePdf")}</span></button>
        </>
      } />
      <div className="report-types no-print">
        {TYPES.map((x) => (
          <button key={x} type="button" aria-pressed={type === x} onClick={() => setType(x)}><Icon name={TYPE_ICON[x]} /><span>{t(`ui.reports.types.${x}`)}</span></button>
        ))}
      </div>
      {!NO_DATES.has(type) && <div className="toolbar no-print"><DateRange value={range} onChange={setRange} /></div>}

      <section className="panel-card report" ref={reportRef}>
        <h2 className="report__title">{t(`ui.reports.types.${type}`)}{!NO_DATES.has(type) && <small> · {date(range.from, lang)} – {date(range.to, lang)}</small>}</h2>
        {r.loading && !d ? <Loading /> : !d ? <EmptyState text={t("ui.errors.failed")} /> : (
          <>
            <div className="report__summary">
              {Object.entries(d.summary).map(([k, v]) => (
                <div key={k}><small>{t(`ui.reports.summary.${k}`)}</small><strong>{PERCENT.has(k) ? `${v}%` : COUNTS.has(k) ? v : m(v)}</strong></div>
              ))}
            </div>
            {d.rows.length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
              <div className="table-wrap"><table className="table table--compact">
                <thead><tr>{d.columns.map(([c, kind]) => <th key={c} className={["money", "qty", "number"].includes(kind) ? "num" : ""}>{t(`ui.reports.cols.${c}`)}</th>)}</tr></thead>
                <tbody>
                  {d.rows.map((row, i) => (
                    <tr key={i} className={type === "profit" && ["grossProfit", "netProfit", "netSales"].includes(row.label) ? "is-strong" : ""}>
                      {d.columns.map(([c, kind]) => <td key={c} className={(["money", "qty", "number"].includes(kind) ? "num" : "") + (kind === "money" && row[c] < 0 ? " is-neg" : "")}>{cell(c, kind, row)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {(type === "profit" || type === "sales") && <p className="report__note"><Icon name="info" />{t("ui.reports.note")}</p>}
          </>
        )}
      </section>
    </div>
  );
}
