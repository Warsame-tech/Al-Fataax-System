import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, Modal, Field, FormError, Money, EmptyState, Loading, SearchBox, downloadCsv, parseCsv } from "../ui.jsx";
import { fill, qty, date } from "../format.js";

export const EMPTY = { name: "", sku: "", barcode: "", category: "", brand: "", unit: "pcs", costPrice: "", sellingPrice: "", wholesalePrice: "", minStock: "", openingStock: "", isActive: true };

export default function Products() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const [q, setQ] = useState("");
  const [low, setLow] = useState(false);
  const [all, setAll] = useState(false);
  const path = `/api/products?${new URLSearchParams({ q, ...(low ? { low: "1" } : {}), ...(all ? { active: "all" } : {}) })}`;
  const list = useApi(path);
  const [editing, setEditing] = useState(null);   // product or EMPTY
  const [adjusting, setAdjusting] = useState(null);
  const [history, setHistory] = useState(null);
  const [importing, setImporting] = useState(false);
  const products = list.data?.products || [];

  const exportCsv = () => downloadCsv("products.csv",
    ["name", "sku", "barcode", "category", "unit", "costPrice", "sellingPrice", "wholesalePrice", "minStock", "stock"],
    products.map((p) => [p.name, p.sku, p.barcode, p.category, p.unit, p.costPrice, p.sellingPrice, p.wholesalePrice ?? "", p.minStock, p.stock]));

  return (
    <div className="page">
      <PageHeader icon="package" title={t("ui.products.title")} actions={
        <>
          <button type="button" className="btn btn--outline" onClick={exportCsv}><Icon name="download" /><span>{t("ui.common.exportCsv")}</span></button>
          {can("products.edit") && <button type="button" className="btn btn--outline" onClick={() => setImporting(true)}><Icon name="upload" /><span>{t("ui.products.import")}</span></button>}
          {can("products.edit") && <button type="button" className="btn btn--primary" onClick={() => setEditing(EMPTY)}><Icon name="plus" /><span>{t("ui.products.add")}</span></button>}
        </>
      } />

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} />
        <label className="checkbox"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /><span>{t("ui.products.lowOnly")}</span></label>
        <label className="checkbox"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>{t("ui.products.showInactive")}</span></label>
      </div>

      {list.loading && !list.data ? <Loading /> : products.length === 0 ? (
        <EmptyState icon="package" text={t("ui.products.empty")} action={can("products.edit") && <button className="btn btn--primary" onClick={() => setEditing(EMPTY)}><Icon name="plus" /><span>{t("ui.products.add")}</span></button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th>{t("ui.common.name")}</th><th>{t("ui.products.sku")}</th><th>{t("ui.common.category")}</th>
              <th className="num">{t("ui.products.costPrice")}</th><th className="num">{t("ui.products.sellingPrice")}</th>
              <th className="num">{t("ui.products.wholesalePrice")}</th><th className="num">{t("ui.products.stock")}</th><th />
            </tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={!p.isActive ? "is-muted" : ""}>
                  <td>
                    <div className="prod-cell">
                      <span className="prod-thumb">{p.imagePath ? <img src={fileUrl(p.imagePath)} alt="" loading="lazy" /> : <Icon name="package" />}</span>
                      <div><strong>{p.name}</strong>{p.barcode && <small className="cell-sub"><Icon name="barcode" /> {p.barcode}</small>}</div>
                    </div>
                  </td>
                  <td>{p.sku || "—"}</td>
                  <td>{p.category || "—"}</td>
                  <td className="num"><Money value={p.costPrice} /></td>
                  <td className="num"><Money value={p.sellingPrice} /></td>
                  <td className="num">{p.wholesalePrice === null ? "—" : <Money value={p.wholesalePrice} />}</td>
                  <td className="num"><span className={"stock-pill" + (p.stock <= 0 ? " is-out" : p.stock <= p.minStock ? " is-low" : "")}>{qty(p.stock)} {p.unit}</span></td>
                  <td className="row-actions">
                    <button type="button" className="icon-btn" title={t("ui.products.history")} onClick={() => setHistory(p)}><Icon name="history" /></button>
                    {can("stock.adjust") && <button type="button" className="icon-btn" title={t("ui.products.adjust")} onClick={() => setAdjusting(p)}><Icon name="swap" /></button>}
                    {can("products.edit") && <button type="button" className="icon-btn" title={t("ui.common.edit")} onClick={() => setEditing(p)}><Icon name="settings" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
      {adjusting && <AdjustForm product={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); list.reload(); }} />}
      {history && <HistoryModal product={history} lang={lang} onClose={() => setHistory(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); }} />}
    </div>
  );
}

/* Add / edit product form (also opened from the POS "New product" button). onSaved(result, fields): result is { id } when created. */
export function ProductForm({ product, onClose, onSaved }) {
  const { t } = useLanguage();
  const isNew = !product.id;
  const [f, setF] = useState(isNew ? EMPTY : {
    ...EMPTY, ...product, category: product.category || "", brand: product.brand || "", sku: product.sku || "", barcode: product.barcode || "",
    wholesalePrice: product.wholesalePrice ?? "", minStock: product.minStock
  });
  const sub = useSubmit();
  const [image, setImage] = useState(null);            // newly chosen File
  const [preview, setPreview] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const pick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImage(file); setPreview(URL.createObjectURL(file)); setRemoveImage(false);
  };
  const shown = preview || (!removeImage && product.imagePath ? fileUrl(product.imagePath) : null);
  const save = async (e) => {
    e.preventDefault();
    // multipart so the photo can travel with the product fields
    const fd = new FormData();
    Object.keys(EMPTY).forEach((k) => fd.append(k, f[k] === null || f[k] === undefined ? "" : String(f[k])));
    if (image) fd.append("image", image);
    if (removeImage) fd.append("removeImage", "true");
    const ok = await sub.run(() => apiRequest(isNew ? "/api/products" : `/api/products/${product.id}`, { method: isNew ? "POST" : "PUT", body: fd }));
    if (ok) onSaved(ok, f);
  };
  const err = sub.fieldErrors;
  return (
    <Modal title={t(isNew ? "ui.products.add" : "ui.products.edit")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2">
        <div className="ff ff--full prod-photo">
          <span className="ff__label">{t("ui.products.image")}</span>
          <div className="prod-photo__row">
            <button type="button" className="prod-photo__drop" onClick={() => fileRef.current?.click()} aria-label={t(shown ? "ui.products.imageChange" : "ui.products.imageChoose")}>
              {shown ? <img src={shown} alt="" /> : <Icon name="image" />}
            </button>
            <div className="prod-photo__actions">
              <button type="button" className="btn btn--outline btn--sm" onClick={() => fileRef.current?.click()}><Icon name="upload" /><span>{t(shown ? "ui.products.imageChange" : "ui.products.imageChoose")}</span></button>
              {shown && <button type="button" className="link-btn" onClick={() => { setImage(null); setPreview(null); setRemoveImage(true); }}>{t("ui.products.imageRemove")}</button>}
              <small className="ff__hint">{t("ui.products.imageHint")}</small>
              {err.image && <span className="ff__error">{t(`ui.errors.${err.image}`)}</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
          </div>
        </div>
        <Field label={t("ui.common.name")} error={err.name} full><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label={t("ui.products.sku")} error={err.sku}><input className="input" value={f.sku} onChange={set("sku")} /></Field>
        <Field label={t("ui.products.barcode")} error={err.barcode}><input className="input" value={f.barcode} onChange={set("barcode")} /></Field>
        <Field label={t("ui.common.category")}><input className="input" value={f.category} onChange={set("category")} /></Field>
        <Field label={t("ui.products.brand")}><input className="input" value={f.brand} onChange={set("brand")} /></Field>
        <Field label={t("ui.products.costPrice")} error={err.costPrice}><input className="input" type="number" min="0" step="0.01" value={f.costPrice} onChange={set("costPrice")} /></Field>
        <Field label={t("ui.products.sellingPrice")} error={err.sellingPrice}><input className="input" type="number" min="0" step="0.01" value={f.sellingPrice} onChange={set("sellingPrice")} /></Field>
        <Field label={`${t("ui.products.wholesalePrice")} ${t("ui.common.optional")}`} error={err.wholesalePrice}><input className="input" type="number" min="0" step="0.01" value={f.wholesalePrice} onChange={set("wholesalePrice")} /></Field>
        <Field label={t("ui.products.unit")}><input className="input" value={f.unit} onChange={set("unit")} /></Field>
        <Field label={t("ui.products.minStock")} error={err.minStock}><input className="input" type="number" min="0" step="any" value={f.minStock} onChange={set("minStock")} /></Field>
        {isNew && <Field label={t("ui.products.openingStock")} error={err.openingStock}><input className="input" type="number" min="0" step="any" value={f.openingStock} onChange={set("openingStock")} /></Field>}
        {!isNew && <label className="checkbox ff--full"><input type="checkbox" checked={f.isActive} onChange={set("isActive")} /><span>{t("ui.products.active")}</span></label>}
        <FormError error={sub.formError} />
        <div className="form-actions ff--full">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t(sub.busy ? "ui.common.saving" : "ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustForm({ product, onClose, onSaved }) {
  const { t } = useLanguage();
  const [change, setChange] = useState("");
  const [reason, setReason] = useState("");
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(`/api/products/${product.id}/adjust`, { method: "POST", body: { qtyChange: change, reason } }))) onSaved();
  };
  return (
    <Modal title={`${t("ui.products.adjust")} · ${product.name}`} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <p className="modal__help">{t("ui.products.adjustHelp")}</p>
        <p className="modal__help"><strong>{t("ui.products.stock")}:</strong> {qty(product.stock)} {product.unit}</p>
        <Field label={t("ui.products.qtyChange")} error={sub.fieldErrors.qtyChange}><input className="input" type="number" step="any" value={change} onChange={(e) => setChange(e.target.value)} /></Field>
        <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("ui.common.reasonPh")} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({ product, lang, onClose }) {
  const { t } = useLanguage();
  const h = useApi(`/api/products/${product.id}/movements`);
  return (
    <Modal title={`${t("ui.products.history")} · ${product.name}`} onClose={onClose} wide>
      {h.loading ? <Loading /> : (h.data?.movements || []).length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.audit.action")}</th><th className="num">{t("ui.common.qty")}</th><th>{t("ui.common.notes")}</th><th>{t("ui.common.user")}</th></tr></thead>
            <tbody>
              {h.data.movements.map((m, i) => (
                <tr key={i}>
                  <td>{date(m.at, lang, true)}</td>
                  <td>{t(`ui.products.moveTypes.${m.type}`)}</td>
                  <td className={"num " + (m.change < 0 ? "is-neg" : "is-pos")}>{m.change > 0 ? "+" : ""}{qty(m.change)}</td>
                  <td>{m.note || "—"}</td>
                  <td>{m.user || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function ImportModal({ onClose, onDone }) {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [rowErrors, setRowErrors] = useState([]);
  const sub = useSubmit();
  const fileRef = useRef(null);
  const read = async (file) => {
    const parsed = parseCsv(await file.text());
    const [head, ...body] = parsed;
    const keys = head.map((h) => h.trim());
    setRows(body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()]))));
    setRowErrors([]); setResult(null);
  };
  const preview = useMemo(() => (rows || []).slice(0, 5), [rows]);
  const send = async () => {
    const ok = await sub.run(async () => {
      try { return await apiRequest("/api/products/import", { method: "POST", body: { rows } }); }
      catch (err) { if (err.data?.rows) setRowErrors(err.data.rows); throw err; }
    });
    if (ok) { setResult(ok.created); setTimeout(onDone, 1200); }
  };
  return (
    <Modal title={t("ui.products.import")} onClose={onClose} wide>
      <div className="form-grid">
        <p className="modal__help">{t("ui.products.importHelp")}</p>
        <div>
          <button type="button" className="btn btn--outline" onClick={() => fileRef.current?.click()}><Icon name="upload" /><span>CSV</span></button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
          {rows && <span className="muted"> · {rows.length} rows</span>}
        </div>
        {preview.length > 0 && (
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr>{Object.keys(preview[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>{preview.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
          </table></div>
        )}
        {rowErrors.length > 0 && <ul className="error-list">{rowErrors.map((r) => <li key={r.row}>Row {r.row}: {Object.keys(r.errors || {}).join(", ")}</li>)}</ul>}
        {result !== null && <p className="form-status form-status--success">{fill(t("ui.products.importDone"), { n: result })}</p>}
        <FormError error={rowErrors.length ? { code: "importErrors" } : sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.close")}</button>
          <button type="button" className="btn btn--primary" disabled={!rows?.length || sub.busy} onClick={send}>{t("ui.products.import")}</button>
        </div>
      </div>
    </Modal>
  );
}
