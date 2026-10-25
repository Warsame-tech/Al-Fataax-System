import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, useApi, usePerm, useSubmit, Modal, Field, FormError, Money, EmptyState, Loading, SearchBox, downloadCsv, parseCsv } from "../ui.jsx";
import { fill, qty, date } from "../format.js";
import CameraScanner from "../CameraScanner.jsx";
import { FoundCard } from "../ProductPicker.jsx";

/* Product master data only — stock quantities are entered in the Stock module (opening stock, add stock). */
export const EMPTY = { name: "", size: "", description: "", sku: "", barcode: "", category: "", subcategory: "", brand: "", unit: "pcs", costPrice: "", sellingPrice: "", wholesalePrice: "", minStock: "", isActive: true };

/* Units of measurement offered in the product form (a unit already saved on a product stays selectable). */
export const UNITS = ["pcs", "bottle", "box", "pack", "carton", "kg", "g", "liter", "ml", "meter", "yard", "roll", "pair", "dozen"];

const NO_FILTERS = { q: "", brandId: "", categoryId: "", subcategory: "", status: "", stockAt: "", supplierId: "", active: "" };
const PAGE_SIZE = 25;

export default function Products() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const [f, setF] = useState(NO_FILTERS);
  const [sort, setSort] = useState({ by: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const options = useApi("/api/products/filters");
  const query = useMemo(() => {
    const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    return new URLSearchParams({ ...params, sort: sort.by, dir: sort.dir, page, pageSize: PAGE_SIZE });
  }, [f, sort, page]);
  const list = useApi(`/api/products?${query}`);
  const [editing, setEditing] = useState(null);   // product or EMPTY
  const [history, setHistory] = useState(null);
  const [importing, setImporting] = useState(false);
  const products = list.data?.products || [];
  const o = options.data || {};
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const active = Object.entries(f).filter(([, v]) => v).length;
  const sortBy = (by) => { setSort((s) => ({ by, dir: s.by === by && s.dir === "asc" ? "desc" : "asc" })); setPage(1); };
  const Th = ({ by, children, num }) => (
    <th className={(num ? "num " : "") + "th-sort"} aria-sort={sort.by === by ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => sortBy(by)}>{children}<span aria-hidden="true">{sort.by === by ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span></button>
    </th>
  );

  const exportCsv = () => downloadCsv("products.csv",
    ["name", "size", "sku", "barcode", "brand", "category", "subcategory", "unit", "costPrice", "sellingPrice", "wholesalePrice", "lowStockAlertLevel", "stock"],
    products.map((p) => [p.baseName ?? p.name, p.size, p.sku, p.barcode, p.brand, p.category, p.subcategory, p.unit, p.costPrice, p.sellingPrice, p.wholesalePrice ?? "", p.minStock, p.stock]));

  return (
    <div className="page">
      <PageHeader icon="package" title={t("ui.products.title")} actions={
        <>
          <button type="button" className="btn btn--outline" onClick={exportCsv}><Icon name="download" /><span>{t("ui.common.exportCsv")}</span></button>
          {can("products.edit") && <button type="button" className="btn btn--outline" onClick={() => setImporting(true)}><Icon name="upload" /><span>{t("ui.products.import")}</span></button>}
          {can("products.edit") && <button type="button" className="btn btn--primary" onClick={() => setEditing(EMPTY)}><Icon name="plus" /><span>{t("ui.products.add")}</span></button>}
        </>
      } />

      <div className="filters">
        <SearchBox value={f.q} onChange={(v) => set("q", v)} placeholder={t("ui.products.searchPh")} />
        <select className="input input--auto" value={f.brandId} onChange={(e) => set("brandId", e.target.value)} aria-label={t("ui.products.brand")}>
          <option value="">{t("ui.products.allBrands")}</option>
          {(o.brands || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input input--auto" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} aria-label={t("ui.common.category")}>
          <option value="">{t("ui.products.allCategories")}</option>
          {(o.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input input--auto" value={f.subcategory} onChange={(e) => set("subcategory", e.target.value)} aria-label={t("ui.products.subcategory")}>
          <option value="">{t("ui.products.allSubcategories")}</option>
          {(o.subcategories || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input input--auto" value={f.status} onChange={(e) => set("status", e.target.value)} aria-label={t("ui.stock.stockStatus")}>
          <option value="">{t("ui.stock.allStatuses")}</option>
          {["in", "low", "out", "negative"].map((s) => <option key={s} value={s}>{t(`ui.stock.status.${s}`)}</option>)}
        </select>
        {(o.locations || []).length > 1 && (
          <select className="input input--auto" value={f.stockAt} onChange={(e) => set("stockAt", e.target.value)} aria-label={t("ui.stock.location")}>
            <option value="">{t("ui.products.anyLocation")}</option>
            {o.locations.map((l) => <option key={l.id} value={l.id}>{fill(t("ui.products.stockAt"), { location: l.name })}</option>)}
          </select>
        )}
        <select className="input input--auto" value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)} aria-label={t("ui.common.supplier")}>
          <option value="">{t("ui.products.allSuppliers")}</option>
          {(o.suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="checkbox"><input type="checkbox" checked={f.active === "all"} onChange={(e) => set("active", e.target.checked ? "all" : "")} /><span>{t("ui.products.showInactive")}</span></label>
        {active > 0 && <button type="button" className="btn btn--outline btn--sm" onClick={() => { setF(NO_FILTERS); setPage(1); }}><Icon name="x" /><span>{fill(t("ui.products.resetFilters"), { n: active })}</span></button>}
      </div>

      {list.loading && !list.data ? <Loading /> : products.length === 0 ? (
        <EmptyState icon="package" text={active ? t("ui.common.noResults") : t("ui.products.empty")} action={!active && can("products.edit") && <button className="btn btn--primary" onClick={() => setEditing(EMPTY)}><Icon name="plus" /><span>{t("ui.products.add")}</span></button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <Th by="name">{t("ui.common.name")}</Th><Th by="size">{t("ui.products.size")}</Th><Th by="sku">{t("ui.products.sku")}</Th><Th by="brand">{t("ui.products.brand")}</Th><Th by="category">{t("ui.common.category")}</Th>
              <Th by="cost" num>{t("ui.products.costPrice")}</Th><Th by="price" num>{t("ui.products.sellingPrice")}</Th>
              <th className="num">{t("ui.products.wholesalePrice")}</th><Th by="stock" num>{t("ui.stock.current")}</Th><th />
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
                  <td>{p.size || "—"}</td>
                  <td>{p.sku || "—"}</td>
                  <td>{p.brand || "—"}</td>
                  <td>{p.category || "—"}{p.subcategory && <small className="cell-sub">{p.subcategory}</small>}</td>
                  <td className="num"><Money value={p.costPrice} /></td>
                  <td className="num"><Money value={p.sellingPrice} /></td>
                  <td className="num">{p.wholesalePrice === null ? "—" : <Money value={p.wholesalePrice} />}</td>
                  <td className="num">
                    <span className={"stock-pill" + (p.stockStatus === "low" ? " is-low" : p.stockStatus === "in" ? "" : " is-out")} title={t(`ui.stock.status.${p.stockStatus}`)}>{qty(p.stock)} {p.unit}</span>
                    <small className="cell-sub">{fill(t("ui.products.alertAt"), { n: qty(p.minStock) })}</small>
                  </td>
                  <td className="row-actions">
                    <button type="button" className="icon-btn" title={t("ui.products.history")} onClick={() => setHistory(p)}><Icon name="history" /></button>
                    {can("stock.adjust") && <Link className="icon-btn" title={t("ui.stock.adjust")} to={`/app/m/stock?tab=adjust&product=${p.id}`}><Icon name="swap" /></Link>}
                    {can("products.edit") && <button type="button" className="icon-btn" title={t("ui.common.edit")} onClick={() => setEditing(p)}><Icon name="settings" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && list.data.total > PAGE_SIZE && (
        <div className="pager">
          <span className="muted">{fill(t("ui.stock.pageOf"), { page: list.data.page, pages: Math.ceil(list.data.total / PAGE_SIZE), n: list.data.total })}</span>
          <button type="button" className="btn btn--outline btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><Icon name="arrow-left" /></button>
          <button type="button" className="btn btn--outline btn--sm" disabled={page * PAGE_SIZE >= list.data.total} onClick={() => setPage(page + 1)}><Icon name="arrow-right" /></button>
        </div>
      )}
      {list.data && list.data.total <= PAGE_SIZE && <p className="muted pager__info">{fill(t("ui.stock.results"), { n: list.data.total })}</p>}

      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); options.reload(); }} onOpen={(p) => setEditing(p)} />}
      {history && <HistoryModal product={history} lang={lang} onClose={() => setHistory(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); options.reload(); }} />}
    </div>
  );
}

/* Add / edit product form. Scanning a barcode checks it first: if another product already has it,
 * that product is shown (highlighted) instead of creating a duplicate.
 * onSaved(result, fields): result is { id } when created. onOpen(product): switch to editing that product. */
export function ProductForm({ product, onClose, onSaved, onOpen }) {
  const { t } = useLanguage();
  const can = usePerm();
  const isNew = !product.id;
  const [f, setF] = useState(isNew ? EMPTY : {
    ...EMPTY, ...product, name: product.baseName ?? product.name, size: product.size || "", description: product.description || "", category: product.category || "", subcategory: product.subcategory || "",
    brand: product.brand || "", sku: product.sku || "", barcode: product.barcode || "", wholesalePrice: product.wholesalePrice ?? "", minStock: product.minStock
  });
  const sub = useSubmit();
  const [image, setImage] = useState(null);            // newly chosen File
  const [preview, setPreview] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [owner, setOwner] = useState(null);            // product that already has the scanned / typed barcode
  const [camera, setCamera] = useState(false);
  const fileRef = useRef(null);
  const options = useApi("/api/products/filters");      // existing brands / categories as suggestions
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const pick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImage(file); setPreview(URL.createObjectURL(file)); setRemoveImage(false);
  };
  const shown = preview || (!removeImage && product.imagePath ? fileUrl(product.imagePath) : null);
  const units = UNITS.includes(f.unit) || !f.unit ? UNITS : [f.unit, ...UNITS];

  /* barcode check (scanner, camera or typed + Enter / leaving the field) */
  const checkBarcode = async (code) => {
    const value = String(code || "").trim();
    setOwner(null);
    if (!value) return;
    setF((x) => ({ ...x, barcode: value }));
    try {
      const { product: found } = await apiRequest(`/api/products/check-barcode/${encodeURIComponent(value)}`);
      if (found && found.id !== product.id) setOwner(found);
    } catch { /* checked again on save */ }
  };

  const save = async (e) => {
    e.preventDefault();
    if (owner) return;
    const fd = new FormData();
    Object.keys(EMPTY).forEach((k) => fd.append(k, f[k] === null || f[k] === undefined ? "" : String(f[k])));
    if (image) fd.append("image", image);
    if (removeImage) fd.append("removeImage", "true");
    const ok = await sub.run(() => apiRequest(isNew ? "/api/products" : `/api/products/${product.id}`, { method: isNew ? "POST" : "PUT", body: fd }));
    if (ok) onSaved(ok, f);
  };
  const err = sub.fieldErrors;
  const usedBy = sub.formError?.data?.usedBy;
  return (
    <Modal title={t(isNew ? "ui.products.add" : "ui.products.edit")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2 sheet-form">
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

        <div className="ff ff--full">
          <span className="ff__label">{t("ui.products.barcode")}</span>
          <div className="barcode-row">
            <input className={"input" + (err.barcode || owner ? " has-error" : "")} value={f.barcode} onChange={(e) => { setOwner(null); setF({ ...f, barcode: e.target.value }); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); checkBarcode(f.barcode); } }} onBlur={() => checkBarcode(f.barcode)}
              placeholder={t("ui.products.barcodePh")} aria-label={t("ui.products.barcode")} />
            <button type="button" className="btn btn--navy" onClick={() => setCamera(true)}><Icon name="barcode" /><span>{t("ui.pos.scan")}</span></button>
          </div>
          {(err.barcode || owner) && <span className="ff__error">{fill(t("ui.errors.barcodeTaken"), { product: owner?.name || usedBy || "" })}</span>}
          {owner && (
            <FoundCard product={owner} stockLabel={fill(t("ui.stock.totalNow"), { qty: qty(owner.totalStock ?? owner.stock), unit: owner.unit })}>
              <p className="muted">{t("ui.products.barcodeExistsHelp")}</p>
              <div className="form-actions found-card__actions">
                {onOpen && can("products.edit") && <button type="button" className="btn btn--outline btn--sm" onClick={() => onOpen(owner)}>{t("ui.products.openExisting")}</button>}
                {can("stock.add") && <Link className="btn btn--primary btn--sm" to="/app/m/stock?tab=add">{t("ui.stock.tabs.add")}</Link>}
              </div>
            </FoundCard>
          )}
        </div>

        <Field label={t("ui.common.name")} error={err.name}><input className="input" value={f.name} onChange={set("name")} placeholder={t("ui.products.namePh")} /></Field>
        <Field label={`${t("ui.products.size")} ${t("ui.common.optional")}`} error={err.size} hint={f.name && f.size ? fill(t("ui.products.showsAs"), { name: `${f.name} ${f.size}` }) : t("ui.products.sizeHint")}>
          <input className="input" value={f.size} onChange={set("size")} placeholder={t("ui.products.sizePh")} />
        </Field>
        <Field label={`${t("ui.common.description")} ${t("ui.common.optional")}`} full><textarea className="input" rows={2} value={f.description} onChange={set("description")} /></Field>
        <Field label={t("ui.products.sku")} error={err.sku}><input className="input" value={f.sku} onChange={set("sku")} /></Field>
        <Field label={t("ui.products.brand")}><input className="input" value={f.brand} onChange={set("brand")} list="brand-options" /></Field>
        <Field label={t("ui.common.category")}><input className="input" value={f.category} onChange={set("category")} list="category-options" /></Field>
        <Field label={`${t("ui.products.subcategory")} ${t("ui.common.optional")}`}><input className="input" value={f.subcategory} onChange={set("subcategory")} /></Field>
        <Field label={t("ui.products.unit")}>
          <select className="input" value={f.unit} onChange={set("unit")}>{units.map((u) => <option key={u} value={u}>{t(`ui.products.units.${u}`).startsWith("ui.") ? u : t(`ui.products.units.${u}`)}</option>)}</select>
        </Field>
        <Field label={t("ui.products.lowStockAlert")} error={err.minStock} hint={t("ui.products.lowStockAlertHint")}><input className="input" type="number" min="0" step="any" value={f.minStock} onChange={set("minStock")} /></Field>
        <Field label={t("ui.products.costPrice")} error={err.costPrice}><input className="input" type="number" min="0" step="0.01" value={f.costPrice} onChange={set("costPrice")} /></Field>
        <Field label={t("ui.products.sellingPrice")} error={err.sellingPrice}><input className="input" type="number" min="0" step="0.01" value={f.sellingPrice} onChange={set("sellingPrice")} /></Field>
        <Field label={`${t("ui.products.wholesalePrice")} ${t("ui.common.optional")}`} error={err.wholesalePrice}><input className="input" type="number" min="0" step="0.01" value={f.wholesalePrice} onChange={set("wholesalePrice")} /></Field>
        <label className="checkbox"><input type="checkbox" checked={f.isActive} onChange={set("isActive")} /><span>{t("ui.products.active")}</span></label>
        <datalist id="brand-options">{(options.data?.brands || []).map((b) => <option key={b.id} value={b.name} />)}</datalist>
        <datalist id="category-options">{(options.data?.categories || []).map((c) => <option key={c.id} value={c.name} />)}</datalist>
        {isNew && <p className="page-help ff--full"><Icon name="info" /> {t("ui.products.stockSeparate")}</p>}
        <FormError error={err.barcode ? null : sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy || Boolean(owner)}>{t(sub.busy ? "ui.common.saving" : "ui.common.save")}</button>
        </div>
      </form>
      {camera && <CameraScanner onCode={(code) => { setCamera(false); checkBarcode(code); }} onClose={() => setCamera(false)} />}
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
                  <td>{t(`ui.stock.types.${m.type}`)}</td>
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
