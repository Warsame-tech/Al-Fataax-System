import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { PageHeader, useApi, usePerm, Modal, SearchBox, EmptyState } from "./ui.jsx";
import { fill } from "./format.js";
import { useProfile, productLabel } from "./profile.js";

/*
 * Bulk product registration (Products → Bulk add): one spreadsheet-style table for 100+ products.
 * Rows can be added, duplicated, deleted and edited in place; several rows can be pasted from Excel into any cell
 * (tab-separated; a header row is recognised and its columns matched by name). Search / "rows with errors" filter the table.
 * Check (POST /api/products/bulk/check) marks every row with what to correct; Register shows how many products will be
 * created, then saves the rows without errors in one go (POST /api/products/bulk). Saved rows leave the table; rows with
 * errors stay to be corrected. The table is kept in this browser until it is registered or cleared.
 * variants: "S, M, L" makes one product per variant (one variant group). Cost price: costs.view to see, costs.edit to type.
 */
const COLS = ["name", "sku", "barcode", "category", "brand", "unit", "costPrice", "sellingPrice", "wholesalePrice", "minPrice", "supplier", "variants", "description"];
const NUMERIC = ["costPrice", "sellingPrice", "wholesalePrice", "minPrice"];
/* Excel header names recognised when a pasted block starts with a header row */
const ALIASES = {
  name: ["name", "product", "product name", "item", "item name", "magaca"], sku: ["sku", "code", "product code", "item code", "sku / code"],
  barcode: ["barcode", "bar code", "ean", "upc"], category: ["category", "group"], brand: ["brand", "make"],
  unit: ["unit", "uom", "unit of measurement", "unit of measure"], costPrice: ["cost", "cost price", "purchase cost", "purchase price", "buying price"],
  sellingPrice: ["retail", "retail price", "selling price", "price", "sale price"], wholesalePrice: ["wholesale", "wholesale price"],
  minPrice: ["min", "minimum", "minimum price", "minimum selling price", "min price"], supplier: ["supplier", "vendor"],
  variants: ["variant", "variants", "product variants", "sizes"], description: ["description", "details", "notes"]
};
const STORE = "faatix.bulkProducts";
const EMPTY_ROW = Object.fromEntries(COLS.map((k) => [k, ""]));
let seq = 0;
const newRow = ({ id: _, ...patch } = {}) => ({ id: `r${Date.now().toString(36)}${(seq++).toString(36)}`, ...EMPTY_ROW, ...patch });
const isBlank = (r) => COLS.every((k) => !String(r[k] ?? "").trim());
const norm = (s) => String(s || "").trim().toLowerCase().replace(/[_*:]/g, " ").replace(/\s+/g, " ");

/* clipboard text from Excel / Sheets → rows of cells (quoted cells may hold tabs / new lines) */
function parseClipboard(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = String(text).replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === "\t") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export default function BulkProducts() {
  const { t } = useLanguage();
  const can = usePerm();
  const profile = useProfile();
  const L = (k) => productLabel(t, profile, k);
  const costView = can("costs.view");
  const costEdit = can("costs.edit");
  const cols = useMemo(() => COLS.filter((k) => k !== "costPrice" || costView), [costView]);
  const label = (k) => ({
    name: t("ui.common.name"), sku: t("ui.products.sku"), barcode: t("ui.products.barcode"), category: L("category"), brand: L("brand"), unit: L("unit"),
    costPrice: L("costPrice"), sellingPrice: L("sellingPrice"), wholesalePrice: t("ui.products.wholesalePrice"), minPrice: t("ui.products.minPrice"),
    supplier: t("ui.bulk.supplier"), variants: t("ui.bulk.variants"), description: t("ui.common.description")
  })[k];

  const [rows, setRows] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(STORE) || "null"); if (Array.isArray(saved) && saved.length) return saved.map((r) => newRow(r)); } catch { /* none */ }
    return Array.from({ length: 10 }, () => newRow({ unit: profile.units?.[0] || "pcs" }));
  });
  // kept in this browser until registered (try/catch: private windows can refuse storage)
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(rows.filter((r) => !isBlank(r)).map(({ id, ...r }) => r))); } catch { /* not kept */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [rows]);

  const [errors, setErrors] = useState({});         // row id → { errors, usedBy, dupOf }
  const [q, setQ] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);     // { summary } before saving
  const [notice, setNotice] = useState(null);       // { kind, text }
  const [pasting, setPasting] = useState(false);

  const lists = useApi("/api/products/filters");
  const suppliers = useApi("/api/suppliers");
  const unitOptions = [...new Set([...(profile.units || ["pcs", "kg", "g", "liter", "ml", "box", "pack", "carton", "bottle", "meter", "pair", "dozen"]), ...rows.map((r) => r.unit).filter(Boolean)])];

  /* ---------- editing ---------- */
  const setCell = useCallback((id, key, value) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    setErrors((e) => (e[id] ? { ...e, [id]: { ...e[id], stale: true } } : e));   // changed after the check
  }, []);
  const addRows = (n) => setRows((rs) => [...rs, ...Array.from({ length: n }, () => newRow({ unit: profile.units?.[0] || "pcs" }))]);
  const duplicate = useCallback((id) => setRows((rs) => {
    const i = rs.findIndex((r) => r.id === id);
    // a copy keeps everything except the codes, which must be different
    return i < 0 ? rs : [...rs.slice(0, i + 1), newRow({ ...rs[i], sku: "", barcode: "" }), ...rs.slice(i + 1)];
  }), []);
  const remove = useCallback((id) => { setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : [newRow()])); setErrors((e) => { const { [id]: _, ...rest } = e; return rest; }); }, []);
  const clearAll = () => { if (window.confirm(t("ui.bulk.clearConfirm"))) { setRows(Array.from({ length: 10 }, () => newRow({ unit: profile.units?.[0] || "pcs" }))); setErrors({}); setNotice(null); } };

  /* ---------- paste from Excel: into the focused cell and the cells to its right / below (new rows as needed) ---------- */
  const pasteBlock = useCallback((text, startId, startKey) => {
    let grid = parseClipboard(text);
    if (!grid.length) return false;
    let keys = null;
    // a header row: match its columns by name
    const head = grid[0].map((h) => Object.keys(ALIASES).find((k) => ALIASES[k].includes(norm(h))) || null);
    if (head.filter(Boolean).length >= 2) { keys = head.map((k) => (k === "costPrice" && !costView ? null : k)); grid = grid.slice(1); }
    setRows((rs) => {
      const list = [...rs];
      let at = startId ? list.findIndex((r) => r.id === startId) : list.findIndex(isBlank);
      if (at < 0) at = list.length;
      const from = keys ? 0 : Math.max(0, cols.indexOf(startKey || "name"));
      grid.forEach((cells, gi) => {
        const i = at + gi;
        if (!list[i]) list[i] = newRow({ unit: profile.units?.[0] || "pcs" });
        const patch = {};
        cells.forEach((v, ci) => {
          const k = keys ? keys[ci] : cols[from + ci];
          if (k) patch[k] = String(v).trim();
        });
        list[i] = { ...list[i], ...patch };
      });
      return list;
    });
    setNotice({ kind: "info", text: fill(t("ui.bulk.pasted"), { n: grid.length }) });
    return true;
  }, [cols, costView, profile.units, t]);
  const onPaste = useCallback((e, id, key) => {
    const text = e.clipboardData?.getData("text/plain") || "";
    if (!/[\t\n]/.test(text.trim())) return;          // one value: a normal paste into the cell
    e.preventDefault();
    pasteBlock(text, id, key);
  }, [pasteBlock]);

  /* ---------- check and save ---------- */
  const filled = rows.filter((r) => !isBlank(r));
  const payload = (list) => list.map(({ id, ...r }) => ({ ...r, ...(costEdit ? {} : { costPrice: "" }) }));
  const applyResults = (sent, results) => {
    const next = {};
    for (const r of results) if (Object.keys(r.errors || {}).length) next[sent[r.row].id] = r;
    setErrors(next);
    return next;
  };
  const check = async (andConfirm) => {
    if (!filled.length) { setNotice({ kind: "error", text: t("ui.bulk.nothing") }); return; }
    setBusy(true); setNotice(null);
    try {
      const sent = filled;
      const r = await apiRequest("/api/products/bulk/check", { method: "POST", body: { rows: payload(sent) } });
      const bad = applyResults(sent, r.rows);
      if (andConfirm) setConfirm(r.summary);
      else setNotice(Object.keys(bad).length ? { kind: "error", text: fill(t("ui.bulk.checkErrors"), { n: Object.keys(bad).length }) } : { kind: "ok", text: fill(t("ui.bulk.checkOk"), { n: r.summary.products }) });
      if (Object.keys(bad).length) setOnlyErrors(false);
    } catch (err) { setNotice({ kind: "error", text: err.data?.errors?.rows === "tooMany" ? fill(t("ui.bulk.tooMany"), { max: err.data.max || 1000 }) : t("ui.errors.failed") }); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      const sent = filled;
      const r = await apiRequest("/api/products/bulk", { method: "POST", body: { rows: payload(sent) } });
      const saved = new Set(r.saved.map((i) => sent[i].id));
      const bad = {};
      for (const x of r.rows) bad[sent[x.row].id] = x;
      setRows((rs) => { const left = rs.filter((x) => !saved.has(x.id) && !isBlank(x)); return left.length ? left : Array.from({ length: 10 }, () => newRow({ unit: profile.units?.[0] || "pcs" })); });
      setErrors(bad);
      setConfirm(null);
      setNotice(Object.keys(bad).length
        ? { kind: "ok", text: `${fill(t("ui.bulk.savedSome"), { n: r.created })} ${fill(t("ui.bulk.checkErrors"), { n: Object.keys(bad).length })}` }
        : { kind: "ok", text: fill(t("ui.bulk.savedAll"), { n: r.created }), link: true });
    } catch { setNotice({ kind: "error", text: t("ui.errors.failed") }); setConfirm(null); }
    setBusy(false);
  };

  /* ---------- search / filter ---------- */
  const needle = q.trim().toLowerCase();
  const shown = rows.map((r, i) => ({ r, n: i + 1 })).filter(({ r }) =>
    (!onlyErrors || errors[r.id]) && (!needle || ["name", "sku", "barcode", "category", "brand", "supplier", "variants"].some((k) => String(r[k] || "").toLowerCase().includes(needle))));
  const errorCount = Object.keys(errors).length;
  const errorText = (k, code, e) => {
    if (code === "duplicateInList") return fill(t("ui.bulk.err.duplicateInList"), { row: e.dupOf || "?" });
    if ((code === "duplicate" || code === "barcodeTaken") && e.usedBy) return fill(t("ui.bulk.err.usedBy"), { name: e.usedBy });
    const own = t(`ui.bulk.err.${code}`);
    return own.startsWith("ui.") ? t(`ui.errors.${code}`) : own;
  };

  return (
    <div className="page bulk-page">
      <PageHeader icon="package" title={t("ui.bulk.title")} back="/app/m/products" actions={
        <>
          <button type="button" className="btn btn--outline" onClick={() => check(false)} disabled={busy}><Icon name="check" /><span>{t("ui.bulk.check")}</span></button>
          <button type="button" className="btn btn--primary" onClick={() => check(true)} disabled={busy}><Icon name="upload" /><span>{t("ui.bulk.register")}</span></button>
        </>
      } />
      <p className="muted bulk-help"><Icon name="info" /> {t("ui.bulk.help")}</p>

      <div className="toolbar bulk-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t("ui.bulk.searchPh")} />
        <label className="vat-switch"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} disabled={!errorCount} />{fill(t("ui.bulk.onlyErrors"), { n: errorCount })}</label>
        <span className="bulk-count">{fill(t("ui.bulk.count"), { n: filled.length })}</span>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setPasting(true)}><Icon name="copy" /><span>{t("ui.bulk.pasteExcel")}</span></button>
        <button type="button" className="btn btn--outline btn--sm" onClick={clearAll}><Icon name="trash" /><span>{t("ui.bulk.clear")}</span></button>
      </div>
      {notice && (
        <p className={"form-status " + (notice.kind === "error" ? "form-status--error" : notice.kind === "ok" ? "form-status--success" : "form-status--info")} role="status">
          {notice.text}{notice.link && <> <Link to="/app/m/products">{t("ui.bulk.openProducts")}</Link></>}
        </p>
      )}

      <datalist id="bulk-categories">{(lists.data?.categories || []).map((c) => <option key={c.id} value={c.name} />)}{Object.keys(profile.categories || {}).map((c) => <option key={`p-${c}`} value={c} />)}</datalist>
      <datalist id="bulk-brands">{(lists.data?.brands || []).map((b) => <option key={b.id} value={b.name} />)}</datalist>
      <datalist id="bulk-units">{unitOptions.map((u) => <option key={u} value={u} />)}</datalist>
      <datalist id="bulk-suppliers">{(suppliers.data?.suppliers || []).map((s) => <option key={s.id} value={s.name} />)}</datalist>

      <div className="table-wrap bulk-wrap">
        <table className="table table--compact bulk-table">
          <thead><tr>
            <th className="bulk-num">#</th>
            {cols.map((k) => <th key={k} className={NUMERIC.includes(k) ? "num" : ""}>{label(k)}{["name", "sellingPrice"].includes(k) && <span className="bulk-req"> *</span>}</th>)}
            <th />
          </tr></thead>
          <tbody>
            {shown.map(({ r, n }) => (
              <BulkRow key={r.id} row={r} n={n} cols={cols} err={errors[r.id]} costEdit={costEdit} setCell={setCell} onPaste={onPaste}
                duplicate={duplicate} remove={remove} errorText={errorText} label={label} t={t} />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <EmptyState icon="search-glass" text={t("ui.common.noResults")} />}
      </div>
      <div className="lines__actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => addRows(1)}><Icon name="plus" /><span>{t("ui.bulk.addRow")}</span></button>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => addRows(10)}><Icon name="plus" /><span>{fill(t("ui.bulk.addRows"), { n: 10 })}</span></button>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => addRows(50)}><Icon name="plus" /><span>{fill(t("ui.bulk.addRows"), { n: 50 })}</span></button>
      </div>

      {pasting && <PasteModal onClose={() => setPasting(false)} onPaste={(text) => { if (pasteBlock(text, null, "name")) setPasting(false); }} cols={cols} label={label} t={t} />}

      {confirm && (
        <Modal title={t("ui.bulk.confirmTitle")} onClose={() => setConfirm(null)}>
          <div className="bulk-confirm">
            {confirm.products > 0 ? (
              <>
                <p className="bulk-confirm__big">{fill(t("ui.bulk.willRegister"), { n: confirm.products })}</p>
                <p className="muted">{fill(t("ui.bulk.fromRows"), { rows: confirm.okRows })}</p>
              </>
            ) : <p className="bulk-confirm__big">{t("ui.bulk.noneValid")}</p>}
            {confirm.errorRows > 0 && <p className="form-status form-status--error">{fill(t("ui.bulk.errorRowsStay"), { n: confirm.errorRows })}</p>}
            <div className="form-actions">
              <button type="button" className="btn btn--outline" onClick={() => setConfirm(null)}>{t(confirm.products ? "ui.common.cancel" : "ui.common.close")}</button>
              {confirm.products > 0 && <button type="button" className="btn btn--primary" onClick={save} disabled={busy}><Icon name="check" /><span>{busy ? t("ui.common.saving") : fill(t("ui.bulk.registerN"), { n: confirm.products })}</span></button>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* One table row (memoised: a 100+ row table stays quick while typing). */
const BulkRow = memo(function BulkRow({ row, n, cols, err, costEdit, setCell, onPaste, duplicate, remove, errorText, label, t }) {
  const bad = err && !err.stale ? err.errors || {} : {};
  const list = { category: "bulk-categories", brand: "bulk-brands", unit: "bulk-units", supplier: "bulk-suppliers" };
  return (
    <>
      <tr className={err ? (err.stale ? "bulk-row is-stale" : "bulk-row has-errors") : "bulk-row"}>
        <td className="bulk-num">{n}</td>
        {cols.map((k) => (
          <td key={k} className={"bulk-cell bulk-cell--" + k}>
            <input className={"bulk-input" + (bad[k] ? " has-error" : "") + (NUMERIC.includes(k) ? " num" : "")} value={row[k] ?? ""} list={list[k]}
              inputMode={NUMERIC.includes(k) ? "decimal" : undefined} disabled={k === "costPrice" && !costEdit} aria-label={`${label(k)} ${n}`}
              placeholder={k === "variants" ? "S, M, L" : undefined}
              onChange={(e) => setCell(row.id, k, e.target.value)} onPaste={(e) => onPaste(e, row.id, k)} />
          </td>
        ))}
        <td className="row-actions">
          <button type="button" className="icon-btn" title={t("ui.bulk.duplicate")} onClick={() => duplicate(row.id)}><Icon name="copy" /></button>
          <button type="button" className="icon-btn" title={t("ui.common.delete")} onClick={() => remove(row.id)}><Icon name="trash" /></button>
        </td>
      </tr>
      {err && !err.stale && (
        <tr className="bulk-errors"><td />
          <td colSpan={cols.length + 1}>
            <Icon name="alert" /> {Object.entries(err.errors).map(([k, code]) => `${label(k) || k}: ${errorText(k, code, err)}`).join(" · ")}
          </td>
        </tr>
      )}
    </>
  );
});

/* Paste a block copied from Excel / Google Sheets (with or without a header row). */
function PasteModal({ onClose, onPaste, cols, label, t }) {
  const [text, setText] = useState("");
  return (
    <Modal title={t("ui.bulk.pasteExcel")} onClose={onClose} wide>
      <div className="form-grid">
        <p className="modal__help">{t("ui.bulk.pasteHelp")}</p>
        <p className="muted bulk-order">{cols.map(label).join(" · ")}</p>
        <textarea className="input bulk-paste" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("ui.bulk.pastePh")} autoFocus />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="button" className="btn btn--primary" onClick={() => onPaste(text)} disabled={!text.trim()}><Icon name="copy" /><span>{t("ui.bulk.addToTable")}</span></button>
        </div>
      </div>
    </Modal>
  );
}
