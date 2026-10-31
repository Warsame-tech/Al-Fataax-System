import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, Money, EmptyState, Loading, SearchBox, downloadCsv, parseCsv } from "../ui.jsx";
import { fill, qty, date } from "../format.js";
import CameraScanner from "../CameraScanner.jsx";
import { FoundCard } from "../ProductPicker.jsx";
import { useDraft, DraftBar } from "../Drafts.jsx";
import { useProfile, productLabel, variantText, expiryState } from "../profile.js";
import { DOSAGE_FORMS, PACK_NAMES, templateFor, unitsPer, breakdown, inPacks, packPrice } from "../packaging.js";
import { PRODUCT_TYPES, TRACKING, typeOf, specFieldsFor, variantFromSpecs, trackingShort } from "../electronics.js";
import { useCatalog, asOptions } from "../catalog.js";
import { ProductLists, VariantMatrix } from "../Catalog.jsx";
import SearchSelect from "../SearchSelect.jsx";
import { usePurities, metalName, useWeight } from "../Jewelry.jsx";

/*
 * Product master data only — stock quantities are entered in the Stock module (opening stock, add stock).
 * The fields and tools follow the business type's profile (app/profile.js), e.g. cosmetics:
 * variants (shade, fragrance, formula, pack size), packaging barcodes, batch & expiry tracking.
 */
export const EMPTY = {
  name: "", size: "", shade: "", fragrance: "", formula: "", packSize: "", description: "", sku: "", barcode: "", category: "", subcategory: "", brand: "",
  unit: "pcs", costPrice: "", sellingPrice: "", wholesalePrice: "", minStock: "", isActive: true, trackBatches: false,
  // pharmacy (profile.medicine)
  genericName: "", dosageForm: "", manufacturer: "", supplierId: "", rxRequired: false, storageInstructions: "",
  // electronics (profile.electronics / serials / warranties)
  productType: "", modelNumber: "", countryOfOrigin: "", notes: "", tracking: "qty", minPrice: "", warrantyMonths: "", warrantyProvider: "", warrantyTerms: "",
  // clothing (profile.fashion)
  collection: "", season: "",
  // jewelry (profile.jewelry)
  metal: "", purity: "", grossWeight: "", stoneWeight: "", pricingMode: "fixed", makingCharge: "", makingType: "per_gram", extraCharge: "", uniqueItem: false, itemStatus: "active"
};
const unitName = (t, u) => (t(`ui.products.units.${u}`).startsWith("ui.") ? u : t(`ui.products.units.${u}`));
const uniqList = (list) => [...new Set(list.filter(Boolean))];
/* full unit names for dropdowns ("Piece", "Meter"…), falling back to the short ones */
const unitFull = (t, u) => (t(`ui.products.unitNames.${u}`).startsWith("ui.") ? unitName(t, u) : t(`ui.products.unitNames.${u}`));

/* Units of measurement offered in the product form (a unit already saved on a product stays selectable).
 * A business type can have its own list (profile.units, e.g. cosmetics: pcs, bottle, tube, box, carton). */
export const UNITS = ["pcs", "bottle", "box", "pack", "carton", "kg", "g", "liter", "ml", "meter", "yard", "roll", "pair", "dozen"];

const NO_FILTERS = { q: "", brandId: "", categoryId: "", subcategory: "", status: "", stockAt: "", supplierId: "", active: "", expiry: "", variantOf: "", productType: "" };
const PAGE_SIZE = 25;

/* A new variant starts from the product it belongs to: same name, brand, category, prices; new variant fields and codes. */
const variantTemplate = (p) => ({
  ...EMPTY, name: p.baseName ?? p.name, brand: p.brand || "", category: p.category || "", subcategory: p.subcategory || "", description: p.description || "",
  unit: p.unit, costPrice: p.costPrice, sellingPrice: p.sellingPrice, wholesalePrice: p.wholesalePrice ?? "", minStock: p.minStock,
  trackBatches: Boolean(p.trackBatches), variantOf: p.id,
  // electronics: same type, model, maker, supplier, tracking, warranty and specs (the variant changes the ones that differ)
  productType: p.productType || "", modelNumber: p.modelNumber || "", manufacturer: p.manufacturer || "", supplierId: p.supplierId ? String(p.supplierId) : "",
  countryOfOrigin: p.countryOfOrigin || "", tracking: p.tracking || "qty", collection: p.collection || "", season: p.season || "", minPrice: p.minPrice ?? "", warrantyMonths: p.warrantyMonths ?? "",
  warrantyProvider: p.warrantyProvider || "", warrantyTerms: p.warrantyTerms || "", specs: { ...(p.specs || {}) }
});

function ExpiryCell({ value, soonDays }) {
  const { t, lang } = useLanguage();
  if (!value) return "—";
  const state = expiryState(value, soonDays);
  return (
    <span className={"expiry-pill" + (state ? ` is-${state}` : "")} title={state ? t(`ui.products.expiry.${state}`) : undefined}>
      {date(value, lang)}
    </span>
  );
}

export default function Products() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const profile = useProfile();
  const L = (k) => productLabel(t, profile, k);
  const showVariant = profile.variants.some((v) => v !== "size");
  const fmtW = useWeight();
  const groups = showVariant || profile.variantGroups;          // product families: "Add variant", "n variants"
  const [specSettings, setSpecSettings] = useState(false);
  const [lists, setLists] = useState(false);
  const [f, setF] = useState(NO_FILTERS);
  const [sort, setSort] = useState({ by: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const options = useApi("/api/products/filters");
  const query = useMemo(() => {
    const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    return new URLSearchParams({ ...params, sort: sort.by, dir: sort.dir, page, pageSize: PAGE_SIZE });
  }, [f, sort, page]);
  const list = useApi(`/api/products?${query}`);
  const [editing, setEditing] = useState(null);   // product, EMPTY or a variant template
  const [history, setHistory] = useState(null);
  const [importing, setImporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState(null);
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
  const setStatus = async (p, archive) => {
    try {
      await apiRequest(`/api/products/${p.id}/${archive ? "archive" : "restore"}`, { method: "POST" });
      setNotice(fill(t(archive ? "ui.products.archivedDone" : "ui.products.restoredDone"), { name: p.name }));
      list.reload();
    } catch { setNotice(t("ui.errors.failed")); }
  };

  const exportCsv = () => downloadCsv("products.csv",
    ["name", "size", "shade", "fragrance", "formula", "packSize", "sku", "barcode", "brand", "category", "subcategory", "unit", "costPrice", "sellingPrice", "wholesalePrice", "lowStockAlertLevel", "stock", "status"],
    products.map((p) => [p.baseName ?? p.name, p.size, p.shade, p.fragrance, p.formula, p.packSize, p.sku, p.barcode, p.brand, p.category, p.subcategory, p.unit, p.costPrice, p.sellingPrice,
      p.wholesalePrice ?? "", p.minStock, p.stock, p.isActive ? "active" : "archived"]));
  const hidden = (k) => profile.hiddenFields?.includes(k);
  const lead = 7 + (showVariant ? 1 : 0) + (hidden("wholesalePrice") ? 0 : 1) + (profile.medicine ? 2 : 0) + (profile.electronics ? 2 : 0) + (profile.jewelry ? 2 : 0);   // columns before "Current stock" (totals row)

  return (
    <div className="page">
      <PageHeader icon="package" title={t("ui.products.title")} actions={
        <>
          {can("products.edit") && <button type="button" className="btn btn--outline" onClick={() => setLists(true)}><Icon name="layers" /><span>{t("ui.lists.title")}</span></button>}
          {can("settings.edit") && profile.electronics && <button type="button" className="btn btn--outline" onClick={() => setSpecSettings(true)}><Icon name="layers" /><span>{t("ui.products.specFields")}</span></button>}
          {can("settings.edit") && <button type="button" className="btn btn--outline" onClick={() => setSettings(true)}><Icon name="settings" /><span>{t("ui.products.settings")}</span></button>}
          <button type="button" className="btn btn--outline" onClick={exportCsv}><Icon name="download" /><span>{t("ui.common.exportCsv")}</span></button>
          {can("products.edit") && <button type="button" className="btn btn--outline" onClick={() => setImporting(true)}><Icon name="upload" /><span>{t("ui.products.import")}</span></button>}
          {can("products.edit") && <button type="button" className="btn btn--primary" onClick={() => setEditing(EMPTY)}><Icon name="plus" /><span>{t("ui.products.add")}</span></button>}
        </>
      } />

      <div className="filters">
        <SearchBox value={f.q} onChange={(v) => set("q", v)} placeholder={t(profile.variants.includes("shade") ? "ui.products.searchPhVariants" : "ui.products.searchPh")} />
        <select className="input input--auto" value={f.brandId} onChange={(e) => set("brandId", e.target.value)} aria-label={t("ui.products.brand")}>
          <option value="">{t("ui.products.allBrands")}</option>
          {(o.brands || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input input--auto" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} aria-label={t("ui.common.category")}>
          <option value="">{t("ui.products.allCategories")}</option>
          {(o.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {!hidden("subcategory") && (
          <select className="input input--auto" value={f.subcategory} onChange={(e) => set("subcategory", e.target.value)} aria-label={t("ui.products.subcategory")}>
            <option value="">{t("ui.products.allSubcategories")}</option>
            {(o.subcategories || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <select className="input input--auto" value={f.status} onChange={(e) => set("status", e.target.value)} aria-label={t("ui.stock.stockStatus")}>
          <option value="">{t("ui.stock.allStatuses")}</option>
          {["in", "low", "out", "negative"].map((s) => <option key={s} value={s}>{t(`ui.stock.status.${s}`)}</option>)}
        </select>
        {profile.electronics && (
          <select className="input input--auto" value={f.productType} onChange={(e) => set("productType", e.target.value)} aria-label={t("ui.products.productType")}>
            <option value="">{t("ui.products.allTypes")}</option>
            {PRODUCT_TYPES.map((x) => <option key={x.key} value={x.key}>{x.key}</option>)}
          </select>
        )}
        {profile.batches && (
          <select className="input input--auto" value={f.expiry} onChange={(e) => set("expiry", e.target.value)} aria-label={t("ui.products.expiryFilter")}>
            <option value="">{t("ui.products.expiry.all")}</option>
            <option value="soon">{fill(t("ui.products.expiry.soonDays"), { n: profile.expirySoonDays })}</option>
            <option value="expired">{t("ui.products.expiry.expired")}</option>
          </select>
        )}
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
        <select className="input input--auto" value={f.active} onChange={(e) => set("active", e.target.value)} aria-label={t("ui.products.productStatus")}>
          <option value="">{t("ui.products.statusFilter.active")}</option>
          <option value="archived">{t("ui.products.statusFilter.archived")}</option>
          <option value="all">{t("ui.products.statusFilter.all")}</option>
        </select>
        {active > 0 && <button type="button" className="btn btn--outline btn--sm" onClick={() => { setF(NO_FILTERS); setPage(1); }}><Icon name="x" /><span>{fill(t("ui.products.resetFilters"), { n: active })}</span></button>}
      </div>
      {f.variantOf && <p className="page-help"><Icon name="layers" /> {t("ui.products.showingVariants")} <button type="button" className="link-btn" onClick={() => set("variantOf", "")}>{t("ui.products.showAll")}</button></p>}
      {notice && <p className="form-status form-status--info" role="status">{notice} <button type="button" className="link-btn" onClick={() => setNotice(null)} aria-label={t("ui.common.close")}>✕</button></p>}

      {list.loading && !list.data ? <Loading /> : products.length === 0 ? (
        <EmptyState icon="package" text={active ? t("ui.common.noResults") : t("ui.products.empty")} action={!active && can("products.edit") && <button className="btn btn--primary" onClick={() => setEditing(EMPTY)}><Icon name="plus" /><span>{t("ui.products.add")}</span></button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <Th by="name">{t("ui.common.name")}</Th><Th by="size">{L("size")}</Th>
              {showVariant && <th>{t("ui.products.variant")}</th>}
              {profile.medicine && <><th>{t("ui.products.dosageForm")}</th><th>{t("ui.products.packagingShort")}</th></>}
              {profile.electronics && <><th>{t("ui.products.productType")}</th><th>{t("ui.products.modelNumber")}</th></>}
              {profile.jewelry && <><th>{t("ui.jewelry.metalPurity")}</th><th className="num">{t("ui.jewelry.netWeight")}</th></>}
              <Th by="sku">{t("ui.products.sku")}</Th><Th by="brand">{L("brand")}</Th><Th by="category">{L("category")}</Th>
              <Th by="cost" num>{L("costPrice")}</Th><Th by="price" num>{L("sellingPrice")}</Th>
              {!hidden("wholesalePrice") && <th className="num">{t("ui.products.wholesalePrice")}</th>}<Th by="stock" num>{t("ui.stock.current")}</Th><th>{L("unit")}</th>
              <th className="num">{L("lowStockShort")}</th>
              {profile.batches && <Th by="expiry">{t("ui.products.nextExpiry")}</Th>}
              <Th by="value" num>{t("ui.products.stockValue")}</Th><th />
            </tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={!p.isActive ? "is-muted" : ""}>
                  <td>
                    <div className="prod-cell">
                      <span className="prod-thumb">{p.imagePath ? <img src={fileUrl(p.imagePath)} alt="" loading="lazy" /> : <Icon name="package" />}</span>
                      <div>
                        <strong>{p.name}</strong>{p.rxRequired && <span className="rx-tag" title={t("ui.products.rxRequired")}>Rx</span>}
                        {p.genericName && <small className="cell-sub">{p.genericName}</small>}
                        {p.barcode && <small className="cell-sub"><Icon name="barcode" /> {p.barcode}</small>}
                        {!p.isActive && <small className="cell-sub archived-tag">{t("ui.products.statusValues.archived")}</small>}
                        {p.tracking && p.tracking !== "qty" && <small className="cell-sub"><span className="track-tag">{p.tracking === "roll" ? t("ui.fabric.rollsTag") : trackingShort(p.tracking)}</span></small>}
                        {profile.jewelry && (p.uniqueItem || (p.itemStatus && p.itemStatus !== "active")) && <small className="cell-sub">{p.uniqueItem && <span className="track-tag">{t("ui.jewelry.uniqueShort")}</span>} {p.itemStatus !== "active" && <span className={`gb-status is-${p.itemStatus}`}>{t(`ui.jewelry.itemStatus.${p.itemStatus}`)}</span>}</small>}
                        {groups && p.variantCount > 1 && !f.variantOf && (
                          <button type="button" className="link-btn cell-sub" onClick={() => set("variantOf", String(p.variantOf || p.id))}>
                            <Icon name="layers" /> {fill(t("ui.products.variantsCount"), { n: p.variantCount })}
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>{p.size || "—"}</td>
                  {showVariant && <td>{variantText(p) || "—"}</td>}
                  {profile.electronics && <><td>{p.productType || "—"}</td><td>{p.modelNumber || "—"}</td></>}
                  {profile.jewelry && <>
                    <td>{p.metal ? `${metalName(t, p.metal)} ${p.purity || ""}` : "—"}{p.pricingMode === "weight" && <small className="cell-sub">{p.noRate ? t("ui.jewelry.noRateShort") : t("ui.jewelry.byWeight")}</small>}</td>
                    <td className="num">{p.netWeight ? fmtW(p.netWeight) : "—"}</td>
                  </>}
                  {profile.medicine && <>
                    <td>{p.dosageForm ? t(`ui.products.forms.${p.dosageForm}`) : "—"}</td>
                    <td className="nowrap">{p.packaging.length ? <span title={breakdown(p, p.packaging[0].name, 1, (u) => unitName(t, u))}>{p.packaging.map((l) => `${qty(l.per)}`).join(" × ")}<small className="cell-sub">{p.packaging.map((l) => l.name).join(" › ")} › {unitName(t, p.unit)}</small></span> : "—"}</td>
                  </>}
                  <td>{p.sku || "—"}</td>
                  <td>{p.brand || "—"}</td>
                  <td>{p.category || "—"}{p.subcategory && <small className="cell-sub">{p.subcategory}</small>}</td>
                  <td className="num"><Money value={p.costPrice} /></td>
                  <td className="num"><Money value={p.sellingPrice} /></td>
                  {!hidden("wholesalePrice") && <td className="num">{p.wholesalePrice === null ? "—" : <Money value={p.wholesalePrice} />}</td>}
                  <td className="num">
                    <span className={"stock-pill" + (p.stockStatus === "low" ? " is-low" : p.stockStatus === "in" ? "" : " is-out")} title={t(`ui.stock.status.${p.stockStatus}`)}>{qty(p.stock)}</span>
                    {p.packaging?.length > 0 && p.stock > 0 && <small className="cell-sub">{inPacks(p, p.stock, (u) => unitName(t, u))}</small>}
                  </td>
                  <td>{unitName(t, p.unit)}</td>
                  <td className="num">{qty(p.minStock)}</td>
                  {profile.batches && <td>{p.trackBatches ? <ExpiryCell value={p.nextExpiry} soonDays={profile.expirySoonDays} /> : <span className="muted">{t("ui.products.notTracked")}</span>}</td>}
                  <td className="num"><Money value={Math.round(p.stock * p.costPrice * 10000) / 10000} /></td>
                  <td className="row-actions">
                    <button type="button" className="icon-btn" title={t("ui.products.history")} onClick={() => setHistory(p)}><Icon name="history" /></button>
                    {can("stock.adjust") && p.isActive && <Link className="icon-btn" title={t("ui.stock.adjust")} to={`/app/m/stock?tab=adjust&product=${p.id}`}><Icon name="swap" /></Link>}
                    {can("products.edit") && groups && <button type="button" className="icon-btn" title={t("ui.products.addVariant")} onClick={() => setEditing(variantTemplate(p))}><Icon name="copy" /></button>}
                    {can("products.edit") && <button type="button" className="icon-btn" title={t("ui.common.edit")} onClick={() => setEditing(p)}><Icon name="settings" /></button>}
                    {can("products.edit") && (
                      <button type="button" className="icon-btn" title={t(p.isActive ? "ui.products.archive" : "ui.products.restore")} onClick={() => setStatus(p, p.isActive)}>
                        <Icon name={p.isActive ? "archive" : "archive-restore"} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {list.data.summary && (
              <tfoot className="table-summary">
                <tr>
                  <td colSpan={lead}><strong>{fill(t("ui.products.totalProducts"), { n: list.data.summary.count })}</strong>{list.data.total > PAGE_SIZE && <small className="cell-sub">{t("ui.products.totalAllPages")}</small>}</td>
                  <td className="num"><strong>{qty(list.data.summary.units)}</strong></td>
                  <td colSpan={profile.batches ? 3 : 2} />
                  <td className="num"><strong><Money value={list.data.summary.stockValue} /></strong></td>
                  <td />
                </tr>
              </tfoot>
            )}
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

      {editing && <ProductForm key={editing.id || `new-${editing.variantOf || ""}`} product={editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); list.reload(); options.reload(); }} onOpen={(p) => setEditing(p)} />}
      {history && <HistoryModal product={history} lang={lang} onClose={() => setHistory(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); list.reload(); options.reload(); }} />}
      {settings && <ProductSettings onClose={() => setSettings(false)} />}
      {specSettings && <SpecFieldsSettings onClose={() => setSpecSettings(false)} />}
      {lists && <ProductLists onClose={() => { setLists(false); options.reload(); }} />}
    </div>
  );
}

/* Add / edit product form. Scanning a barcode checks it first: if another product already has it,
 * that product is shown (highlighted) instead of creating a duplicate (unless the business allows duplicates).
 * The fields follow the business profile (variants, packaging barcodes, batch tracking, labels).
 * onSaved(result, fields): result is { id } when created. onOpen(product): switch to editing that product (or a new variant). */
export function ProductForm({ product, onClose, onSaved, onOpen }) {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const profile = useProfile();
  const { business } = useAuth();
  const L = (k) => productLabel(t, profile, k);
  const isNew = !product.id;
  const [f, setF] = useState(isNew ? { ...EMPTY, ...product } : {
    ...EMPTY, ...product, name: product.baseName ?? product.name, size: product.size || "", shade: product.shade || "", fragrance: product.fragrance || "",
    formula: product.formula || "", packSize: product.packSize || "", description: product.description || "", category: product.category || "",
    subcategory: product.subcategory || "", brand: product.brand || "", sku: product.sku || "", barcode: product.barcode || "",
    wholesalePrice: product.wholesalePrice ?? "", minStock: product.minStock, trackBatches: Boolean(product.trackBatches),
    genericName: product.genericName || "", dosageForm: product.dosageForm || "", manufacturer: product.manufacturer || "",
    supplierId: product.supplierId ? String(product.supplierId) : "", rxRequired: Boolean(product.rxRequired), storageInstructions: product.storageInstructions || "",
    productType: product.productType || "", modelNumber: product.modelNumber || "", countryOfOrigin: product.countryOfOrigin || "", notes: product.notes || "",
    tracking: product.tracking || "qty", minPrice: product.minPrice ?? "", warrantyMonths: product.warrantyMonths ?? "",
    warrantyProvider: product.warrantyProvider || "", warrantyTerms: product.warrantyTerms || "",
    collection: product.collection || "", season: product.season || "",
    metal: product.metal || "", purity: product.purity || "", grossWeight: product.grossWeight ?? "", stoneWeight: product.stoneWeight ?? "",
    pricingMode: product.pricingMode || "fixed", makingCharge: product.makingCharge ?? "", makingType: product.makingType || "per_gram",
    extraCharge: product.extraCharge ?? "", uniqueItem: Boolean(product.uniqueItem), itemStatus: product.itemStatus || "active",
    sellingPrice: product.fixedPrice ?? product.sellingPrice ?? ""
  });
  /* jewelry: purity options and today's rates (price preview) */
  const purities = usePurities();
  const jRates = useApi(profile.jewelry ? "/api/jewelry/rates" : null);
  const jRate = (jRates.data?.rates || []).find((r) => r.metal === f.metal && r.purity === f.purity)?.rate;
  const jNet = Math.max(0, Math.round(((Number(f.grossWeight) || 0) - (Number(f.stoneWeight) || 0)) * 10000) / 10000);
  const jMaking = f.makingType === "fixed" ? Number(f.makingCharge) || 0 : jNet * (Number(f.makingCharge) || 0);
  const jPrice = jRate !== undefined ? Math.round((jNet * jRate + jMaking + (Number(f.extraCharge) || 0)) * 100) / 100 : null;
  const wStep = 1 / 10 ** (jRates.data?.weightDecimals ?? 3);
  /* dropdown lists: ready-made for the business type + the business's own (Product lists) */
  const cat = useCatalog();
  const [matrix, setMatrix] = useState(false);
  /* clothing / fabric: the variant attributes the category uses (size + colour, colour + pattern + width…) */
  const variantFields = profile.categoryVariants ? (profile.categoryVariants[f.category] || profile.defaultVariants || ["size", "shade"]) : profile.variants;
  const sizeOptions = asOptions(uniqList([...(cat.sizeSystems[cat.systemFor(f.category)] || []), ...Object.entries(cat.sizeSystems).filter(([k]) => k !== cat.systemFor(f.category)).flatMap(([, v]) => v)]));
  const colorOptions = cat.colors.map((c) => ({ value: c.name, label: c.name, swatch: c.code }));
  /* electronics: technical specifications by product type (template + the owner's extra fields) */
  const [specs, setSpecs] = useState(() => ({ ...(product.specs || {}) }));
  const specExtra = useApi(profile.electronics ? "/api/products/spec-fields" : null);
  const specFields = profile.electronics ? specFieldsFor(f.productType, specExtra.data?.fields || {}) : [];
  /* choosing a product type suggests its unit and tracking method (new products) */
  const chooseType = (key) => {
    const tp = typeOf(key);
    setF((x) => ({
      ...x, productType: key,
      unit: tp && !tp.units.includes(x.unit) ? tp.units[0] : x.unit,
      tracking: tp && isNew ? tp.tracking : x.tracking
    }));
  };
  /* packaging structure (pharmacy): packs above the base unit, largest first */
  const [pack, setPack] = useState(() => (product.packaging || []).map((l) => ({ ...l, per: l.per, price: l.price ?? "" })));
  const suppliers = useApi(profile.medicine || profile.electronics || profile.fabric ? "/api/suppliers" : null);
  /* choosing a dosage form fills its usual packaging, unless counts were already entered */
  const chooseForm = (form) => {
    setF((x) => ({ ...x, dosageForm: form }));
    if (!form || pack.some((l) => String(l.per).trim())) return;
    const tpl = templateFor(form);
    setPack(tpl.packaging);
    setF((x) => ({ ...x, dosageForm: form, unit: tpl.unit }));
  };
  const [barcodes, setBarcodes] = useState([]);        // packaging barcodes [{ barcode, label, qty }]
  const details = useApi(isNew ? null : `/api/products/${product.id}/details`);
  useEffect(() => { if (details.data) setBarcodes(details.data.barcodes); }, [details.data]);
  const sub = useSubmit();
  const draft = useDraft("product");
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
  const unitList = uniqList([...((profile.electronics && typeOf(f.productType)?.units) || profile.units || UNITS), ...cat.units]);
  const units = unitList.includes(f.unit) || !f.unit ? unitList : [f.unit, ...unitList];
  /* packaging (cosmetics): one of the business units other than the product's own, e.g. carton of 12 bottles */
  const packUnits = (label) => { const list = unitList.filter((u) => u !== f.unit); return !label || list.includes(label) ? list : [label, ...list]; };
  const fullName = [f.name, ...profile.variants.map((v) => f[v])].filter((v) => v && String(v).trim()).join(" ");
  const setBarcode = (i, k, v) => setBarcodes((list) => list.map((b, j) => (j === i ? { ...b, [k]: v } : b)));

  /* barcode check (scanner, camera or typed + Enter / leaving the field) */
  const checkBarcode = async (code) => {
    const value = String(code || "").trim();
    setOwner(null);
    if (!value) return;
    setF((x) => ({ ...x, barcode: value }));
    if (business?.allowDuplicateCodes) return;
    try {
      const { product: found } = await apiRequest(`/api/products/check-barcode/${encodeURIComponent(value)}`);
      if (found && found.id !== product.id) setOwner(found);
    } catch { /* checked again on save */ }
  };

  const save = async (e) => {
    e.preventDefault();
    if (owner) return;
    const fd = new FormData();
    // clothing: attributes the category does not use are not kept (e.g. a bag has no size)
    const unused = (k) => profile.fashion && ["size", "shade", "formula", "packSize"].includes(k) && !variantFields.includes(k);
    Object.keys(EMPTY).forEach((k) => fd.append(k, unused(k) || f[k] === null || f[k] === undefined ? "" : String(f[k])));
    if (profile.extraBarcodes) fd.append("barcodes", JSON.stringify(barcodes.filter((b) => String(b.barcode).trim())));
    if (profile.electronics) fd.append("specs", JSON.stringify(Object.fromEntries(Object.entries(specs).filter(([k, v]) => specFields.includes(k) && String(v).trim()))));
    if (profile.packaging) fd.append("packaging", JSON.stringify(pack.filter((l) => String(l.name).trim()).map((l) => ({ ...l, price: l.sell && l.price !== "" ? l.price : null }))));
    if (isNew && f.variantOf) fd.append("variantOf", String(f.variantOf));
    if (image) fd.append("image", image);
    if (removeImage) fd.append("removeImage", "true");
    const ok = await sub.run(() => apiRequest(isNew ? "/api/products" : `/api/products/${product.id}`, { method: isNew ? "POST" : "PUT", body: fd }));
    if (ok) { if (isNew) await draft.finish(); onSaved(ok, f); }
  };
  const err = sub.fieldErrors;
  const usedBy = sub.formError?.data?.usedBy;
  const variants = (details.data?.variants || []).filter((v) => v.id !== product.id);
  const title = isNew ? (f.variantOf ? fill(t("ui.products.newVariantOf"), { name: f.name }) : t("ui.products.add")) : t("ui.products.edit");
  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid form-grid--2 sheet-form">
        {isNew && (
          <div className="ff ff--full">
            <DraftBar draft={draft} canSave={Boolean(f.name || f.barcode)} title={fullName || f.barcode}
              getData={() => ({ f, barcodes })} onLoad={(d) => { setOwner(null); setF({ ...EMPTY, ...d.f }); setBarcodes(d.barcodes || []); }} />
            {image && <small className="ff__hint">{t("ui.drafts.noPhoto")}</small>}
          </div>
        )}
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
        <Field label={t("ui.products.sku")} error={err.sku} hint={err.sku === "duplicate" && usedBy ? fill(t("ui.products.skuUsedBy"), { name: usedBy }) : undefined}>
          <input className="input" value={f.sku} onChange={set("sku")} placeholder={t("ui.products.sku")} />
        </Field>
        {/* category first: it decides the subcategories and (clothing) the variant fields */}
        <div className="ff">
          <span className="ff__label">{L("category")}</span>
          <SearchSelect freeText value={f.category} onChange={(x) => setF((y) => ({ ...y, category: x, subcategory: x === y.category ? y.subcategory : "" }))}
            onCreate={(x) => setF((y) => ({ ...y, category: x, subcategory: "" }))} createLabel={t("ui.common.add")}
            options={asOptions(cat.categories)} placeholder={L("category")} searchPlaceholder={t("ui.common.searchPh")} />
        </div>
        {!profile.hiddenFields?.includes("subcategory") && (
          <div className="ff">
            <span className="ff__label">{`${L("subcategory")} ${t("ui.common.optional")}`}</span>
            <SearchSelect freeText value={f.subcategory} onChange={(x) => setF((y) => ({ ...y, subcategory: x }))} onCreate={(x) => setF((y) => ({ ...y, subcategory: x }))} createLabel={t("ui.common.add")}
              options={asOptions(cat.subcategoriesOf(f.category))} placeholder={L("subcategory")} searchPlaceholder={t("ui.common.searchPh")} />
          </div>
        )}
        <div className="ff">
          <span className="ff__label">{L("brand")}</span>
          <SearchSelect freeText value={f.brand} onChange={(x) => setF((y) => ({ ...y, brand: x }))} onCreate={(x) => setF((y) => ({ ...y, brand: x }))} createLabel={t("ui.common.add")}
            options={asOptions(cat.brands)} placeholder={L("brand")} searchPlaceholder={t("ui.common.searchPh")} />
        </div>

        {profile.electronics && (
          <>
            <Field label={t("ui.products.productType")} hint={t("ui.products.productTypeHint")}>
              <select className="input input--type-sm" value={f.productType} onChange={(e) => chooseType(e.target.value)}>
                <option value="">{t("ui.common.choose")}</option>
                {PRODUCT_TYPES.map((x) => <option key={x.key} value={x.key}>{x.key}</option>)}
              </select>
            </Field>
            <Field label={`${t("ui.products.modelNumber")} ${t("ui.common.optional")}`}><input className="input" value={f.modelNumber} onChange={set("modelNumber")} placeholder={t("ui.products.modelNumberPh")} /></Field>
          </>
        )}
        {(profile.variants.length > 1 || profile.variantGroups) && <p className="form-sub ff--full"><Icon name="layers" /> {t(profile.electronics ? "ui.products.variantSectionElec" : profile.fashion ? "ui.products.variantSectionFashion" : "ui.products.variantSection")}</p>}
        {variantFields.map((v) => (
          <Field key={v} label={`${L(v)} ${t("ui.common.optional")}`} error={err[v]}>
            <div className="qty-unit">
              {profile.fashion && v === "size" ? (
                <SearchSelect freeText value={f.size} onChange={(x) => setF((y) => ({ ...y, size: x }))} onCreate={(x) => setF((y) => ({ ...y, size: x }))} createLabel={t("ui.common.add")}
                  options={sizeOptions} placeholder={L("size")} searchPlaceholder={t("ui.common.searchPh")} />
              ) : profile.fashion && v === "shade" ? (
                <SearchSelect freeText value={f.shade} onChange={(x) => setF((y) => ({ ...y, shade: x }))} onCreate={(x) => setF((y) => ({ ...y, shade: x }))} createLabel={t("ui.common.add")}
                  options={colorOptions} placeholder={L("shade")} searchPlaceholder={t("ui.common.searchPh")} />
              ) : <input className="input" value={f[v]} onChange={set(v)} placeholder={t(`ui.products.${profile.labels?.[v] || v}Ph`)} />}
              {profile.electronics && v === "size" && variantFromSpecs(specs) && f.size !== variantFromSpecs(specs) && (
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setF((x) => ({ ...x, size: variantFromSpecs(specs) }))} title={variantFromSpecs(specs)}>{t("ui.products.fromSpecs")}</button>
              )}
            </div>
          </Field>
        ))}
        {profile.medicine && (
          <>
            <Field label={`${t("ui.products.genericName")} ${t("ui.common.optional")}`}><input className="input" value={f.genericName} onChange={set("genericName")} placeholder={t("ui.products.genericNamePh")} /></Field>
            <Field label={t("ui.products.dosageForm")}>
              <select className="input" value={f.dosageForm} onChange={(e) => chooseForm(e.target.value)}>
                <option value="">{t("ui.common.choose")}</option>
                {Object.keys(DOSAGE_FORMS).map((k) => <option key={k} value={k}>{t(`ui.products.forms.${k}`)}</option>)}
              </select>
            </Field>
          </>
        )}
        {profile.fabric && (
          <>
            <p className="form-sub ff--full"><Icon name="roll" /> {t("ui.products.fabricSection")}</p>
            <Field label={`${L("modelNumber")} ${t("ui.common.optional")}`}><input className="input" value={f.modelNumber} onChange={set("modelNumber")} placeholder={L("modelNumber")} /></Field>
            <Field label={`${L("genericName")} ${t("ui.common.optional")}`}><input className="input" value={f.genericName} onChange={set("genericName")} placeholder={t("ui.products.compositionPh")} /></Field>
            <Field label={`${t("ui.common.supplier")} ${t("ui.common.optional")}`} error={err.supplierId}>
              <select className="input" value={f.supplierId} onChange={set("supplierId")}>
                <option value="">—</option>
                {(suppliers.data?.suppliers || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            {/* sold from rolls: stock in meters, each roll with its own ID and length (Fabric rolls) */}
            <div className="ff">
              <label className="checkbox"><input type="checkbox" checked={f.tracking === "roll"} disabled={!isNew && Number(product.stock) !== 0}
                onChange={(e) => setF((x) => ({ ...x, tracking: e.target.checked ? "roll" : "qty", unit: e.target.checked ? "meter" : x.unit }))} /><span>{t("ui.fabric.soldFromRolls")}</span></label>
              <small className="ff__hint">{t(!isNew && Number(product.stock) !== 0 ? "ui.fabric.soldFromRollsLocked" : "ui.fabric.soldFromRollsHint")}</small>
              {err.tracking && <span className="ff__error">{t(`ui.errors.${err.tracking}`)}</span>}
            </div>
          </>
        )}
        {profile.fashion && !profile.fabric && (
          <>
            <Field label={`${t("ui.products.modelStyle")} ${t("ui.common.optional")}`}><input className="input" value={f.modelNumber} onChange={set("modelNumber")} placeholder={t("ui.products.modelStyle")} /></Field>
            <Field label={`${t("ui.products.collection")} ${t("ui.common.optional")}`}>
              <SearchSelect freeText value={f.collection} onChange={(x) => setF((y) => ({ ...y, collection: x }))} onCreate={(x) => setF((y) => ({ ...y, collection: x }))} createLabel={t("ui.common.add")}
                options={asOptions(cat.collections)} placeholder={t("ui.products.collection")} searchPlaceholder={t("ui.common.searchPh")} />
            </Field>
            <Field label={`${t("ui.products.season")} ${t("ui.common.optional")}`}>
              <SearchSelect freeText value={f.season} onChange={(x) => setF((y) => ({ ...y, season: x }))} onCreate={(x) => setF((y) => ({ ...y, season: x }))} createLabel={t("ui.common.add")}
                options={asOptions(cat.seasons)} placeholder={t("ui.products.season")} searchPlaceholder={t("ui.common.searchPh")} />
            </Field>
          </>
        )}
        <p className="ff__hint ff--full">{f.name && fullName !== f.name ? fill(t("ui.products.showsAs"), { name: fullName }) : t(profile.electronics ? "ui.products.variantHintElec" : profile.fashion ? "ui.products.variantHintFashion" : profile.variants.length > 1 ? "ui.products.variantHint" : "ui.products.sizeHint")}</p>

        {profile.jewelry && (
          <>
            <p className="form-sub ff--full"><Icon name="gem" /> {t("ui.jewelry.section")}</p>
            <Field label={t("ui.jewelry.metal")}>
              <select className="input" value={f.metal} onChange={(e) => setF((x) => ({ ...x, metal: e.target.value, purity: "" }))}>
                <option value="">{t("ui.common.choose")}</option>
                {(profile.metals || ["gold", "silver"]).map((x) => <option key={x} value={x}>{metalName(t, x)}</option>)}
              </select>
            </Field>
            <Field label={t("ui.jewelry.purity")}>
              <select className="input" value={f.purity} onChange={set("purity")} disabled={!f.metal}>
                <option value="">{t("ui.common.choose")}</option>
                {purities(f.metal).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label={t("ui.jewelry.grossWeight")} error={err.grossWeight}><input className="input" type="number" min="0" step={wStep} value={f.grossWeight} onChange={set("grossWeight")} placeholder={t("ui.jewelry.grams")} /></Field>
            <Field label={`${t("ui.jewelry.stoneWeight")} ${t("ui.common.optional")}`} error={err.stoneWeight}><input className="input" type="number" min="0" step={wStep} value={f.stoneWeight} onChange={set("stoneWeight")} placeholder={t("ui.jewelry.grams")} /></Field>
            <Field label={t("ui.jewelry.netWeight")} hint={t("ui.jewelry.netHint")}><input className="input packaging__total" readOnly tabIndex={-1} value={`${jNet.toFixed(jRates.data?.weightDecimals ?? 3)} g`} /></Field>
            <Field label={t("ui.jewelry.pricing")} error={err.pricingMode}>
              <div className="seg">{["fixed", "weight"].map((v) => <button key={v} type="button" aria-pressed={f.pricingMode === v} onClick={() => setF((x) => ({ ...x, pricingMode: v }))}>{t(`ui.jewelry.pricingModes.${v}`)}</button>)}</div>
            </Field>
            {f.pricingMode === "weight" && (
              <>
                <Field label={`${t("ui.jewelry.making")} ${t("ui.common.optional")}`} error={err.makingCharge}>
                  <div className="qty-unit">
                    <input className="input" type="number" min="0" step="any" value={f.makingCharge} onChange={set("makingCharge")} placeholder={t("ui.jewelry.making")} />
                    <select className="input input--auto" value={f.makingType} onChange={set("makingType")}><option value="per_gram">{t("ui.jewelry.perGram")}</option><option value="fixed">{t("ui.jewelry.fixedAmount")}</option></select>
                  </div>
                </Field>
                <Field label={`${t("ui.jewelry.extra")} ${t("ui.common.optional")}`} error={err.extraCharge}><input className="input" type="number" min="0" step="any" value={f.extraCharge} onChange={set("extraCharge")} placeholder={t("ui.jewelry.extra")} /></Field>
                <p className="ff--full jewel-price">{jPrice !== null
                  ? fill(t("ui.jewelry.pricePreview"), { net: jNet.toFixed(jRates.data?.weightDecimals ?? 3), rate: m(jRate), making: m(jMaking), extra: m(Number(f.extraCharge) || 0), price: m(jPrice) })
                  : t(f.metal && f.purity ? "ui.jewelry.noRateHint" : "ui.jewelry.pickPurity")}</p>
              </>
            )}
            <div className="ff">
              <label className="checkbox"><input type="checkbox" checked={f.uniqueItem} onChange={set("uniqueItem")} /><span>{t("ui.jewelry.unique")}</span></label>
              <small className="ff__hint">{t("ui.jewelry.uniqueHint")}</small>
            </div>
            <Field label={t("ui.jewelry.itemStatusLabel")}>
              <select className="input" value={f.itemStatus} onChange={set("itemStatus")} disabled={f.itemStatus === "sold"}>
                {(f.itemStatus === "sold" ? ["sold"] : ["active", "returned", "damaged"]).map((x) => <option key={x} value={x}>{t(`ui.jewelry.itemStatus.${x}`)}</option>)}
              </select>
            </Field>
          </>
        )}
        {!profile.hiddenFields?.includes("description") && <Field label={`${t("ui.common.description")} ${t("ui.common.optional")}`} full><textarea className="input" rows={2} value={f.description} onChange={set("description")} placeholder={t("ui.common.description")} /></Field>}
        {profile.electronics && <Field label={`${t("ui.products.countryOfOrigin")} ${t("ui.common.optional")}`}><input className="input" value={f.countryOfOrigin} onChange={set("countryOfOrigin")} placeholder={t("ui.products.countryOfOrigin")} /></Field>}
        {(profile.medicine || profile.electronics) && (
          <>
            <Field label={`${t("ui.products.manufacturer")} ${t("ui.common.optional")}`}><input className="input" value={f.manufacturer} onChange={set("manufacturer")} placeholder={t("ui.products.manufacturer")} /></Field>
            <Field label={`${t("ui.common.supplier")} ${t("ui.common.optional")}`} error={err.supplierId}>
              <select className="input" value={f.supplierId} onChange={set("supplierId")}>
                <option value="">—</option>
                {(suppliers.data?.suppliers || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label={L("unit")} error={err.unit} hint={f.tracking === "roll" ? t("ui.fabric.unitIsMeter") : profile.packaging ? t("ui.products.baseUnitHint") : undefined}>
          <select className="input" value={f.unit} onChange={set("unit")} disabled={f.tracking === "roll"}>{units.map((u) => <option key={u} value={u}>{unitFull(t, u)}</option>)}</select>
        </Field>
        {profile.serials && (
          <Field label={t("ui.products.tracking")} error={err.tracking} hint={t(`ui.products.trackingHint.${f.tracking}`)}>
            <select className="input" value={f.tracking} onChange={set("tracking")}>{TRACKING.map((x) => <option key={x} value={x}>{t(`ui.products.trackingOptions.${x}`)}</option>)}</select>
          </Field>
        )}
        {profile.packaging && <PackagingEditor pack={pack} setPack={setPack} unit={f.unit} sellingPrice={f.sellingPrice} errors={err} />}
        <Field label={L("costPrice")} error={err.costPrice}><input className="input" type="number" min="0" step="any" value={f.costPrice} onChange={set("costPrice")} placeholder={L("costPrice")} /></Field>
        <Field label={profile.jewelry && f.pricingMode === "weight" ? t("ui.jewelry.fallbackPrice") : L("sellingPrice")} error={err.sellingPrice}><input className="input" type="number" min="0" step="any" value={f.sellingPrice} onChange={set("sellingPrice")} placeholder={L("sellingPrice")} /></Field>
        {!profile.hiddenFields?.includes("wholesalePrice") && <Field label={`${t("ui.products.wholesalePrice")} ${t("ui.common.optional")}`} error={err.wholesalePrice}><input className="input" type="number" min="0" step="any" value={f.wholesalePrice} onChange={set("wholesalePrice")} placeholder={t("ui.products.wholesalePrice")} /></Field>}
        {profile.electronics && <Field label={`${t("ui.products.minPrice")} ${t("ui.common.optional")}`} error={err.minPrice} hint={t("ui.products.minPriceHint")}><input className="input" type="number" min="0" step="any" value={f.minPrice} onChange={set("minPrice")} placeholder={t("ui.products.minPrice")} /></Field>}
        <Field label={L("lowStockAlert")} error={err.minStock} hint={t("ui.products.lowStockAlertHint")}><input className="input" type="number" min="0" step="any" value={f.minStock} onChange={set("minStock")} placeholder={L("lowStockAlert")} /></Field>
        {profile.warranties && (
          <>
            <p className="form-sub ff--full"><Icon name="shield-check" /> {t("ui.products.warrantySection")}</p>
            <Field label={`${t("ui.warranty.duration")} ${t("ui.common.optional")}`} error={err.warrantyMonths} hint={t("ui.products.warrantyHint")}><input className="input" type="number" min="0" max="240" step="1" value={f.warrantyMonths} onChange={set("warrantyMonths")} placeholder={t("ui.warranty.duration")} /></Field>
            <Field label={`${t("ui.warranty.provider")} ${t("ui.common.optional")}`}><input className="input" value={f.warrantyProvider} onChange={set("warrantyProvider")} placeholder={t("ui.warranty.providerPh")} /></Field>
            <Field label={`${t("ui.warranty.terms")} ${t("ui.common.optional")}`} full><input className="input" value={f.warrantyTerms} onChange={set("warrantyTerms")} maxLength={255} placeholder={t("ui.warranty.terms")} /></Field>
          </>
        )}
        {profile.electronics && specFields.length > 0 && (
          <div className="ff ff--full specs">
            <span className="ff__label"><Icon name="layers" /> {fill(t("ui.products.specsTitle"), { type: f.productType })}</span>
            <div className="specs__grid">
              {specFields.map((k) => (
                <label key={k} className="specs__field">
                  <span>{k}</span>
                  <input className="input" value={specs[k] || ""} onChange={(e) => setSpecs((x) => ({ ...x, [k]: e.target.value }))} placeholder={k} />
                </label>
              ))}
            </div>
          </div>
        )}
        {profile.electronics && <Field label={`${t("ui.products.notes")} ${t("ui.common.optional")}`} full><textarea className="input" rows={2} value={f.notes} onChange={set("notes")} placeholder={t("ui.products.notes")} /></Field>}
        {profile.medicine && (
          <>
            <div className="ff">
              <label className="checkbox"><input type="checkbox" checked={f.rxRequired} onChange={set("rxRequired")} /><span>{t("ui.products.rxRequired")}</span></label>
              <small className="ff__hint">{t("ui.products.rxHint")}</small>
            </div>
            <Field label={`${t("ui.products.storage")} ${t("ui.common.optional")}`}><input className="input" value={f.storageInstructions} onChange={set("storageInstructions")} placeholder={t("ui.products.storagePh")} maxLength={255} /></Field>
          </>
        )}
        <Field label={t("ui.products.productStatus")}>
          <select className="input" value={f.isActive ? "active" : "archived"} onChange={(e) => setF((x) => ({ ...x, isActive: e.target.value === "active" }))}>
            <option value="active">{t("ui.products.statusValues.active")}</option>
            <option value="archived">{t("ui.products.statusValues.archived")}</option>
          </select>
        </Field>

        {profile.extraBarcodes && (
          <div className="ff ff--full pack-codes">
            <span className="ff__label">{t("ui.products.packBarcodes")}</span>
            <small className="ff__hint">{t("ui.products.packBarcodesHint")}</small>
            {barcodes.map((b, i) => (
              <div key={i} className="pack-codes__row">
                <input className={"input" + (err[`barcodes.${i}.barcode`] ? " has-error" : "")} value={b.barcode} onChange={(e) => setBarcode(i, "barcode", e.target.value)}
                  placeholder={t("ui.products.barcode")} aria-label={t("ui.products.barcode")} />
                {profile.units
                  ? <select className="input" value={b.label} onChange={(e) => setBarcode(i, "label", e.target.value)} aria-label={t("ui.products.packLabel")}>
                      <option value="">{t("ui.products.packLabel")}…</option>
                      {packUnits(b.label).map((u) => <option key={u} value={u}>{unitName(t, u)}</option>)}
                    </select>
                  : <input className="input" value={b.label} onChange={(e) => setBarcode(i, "label", e.target.value)} placeholder={t("ui.products.packLabelPh")} aria-label={t("ui.products.packLabel")} />}
                <input className={"input" + (err[`barcodes.${i}.qty`] ? " has-error" : "")} type="number" min="0" step="any" value={b.qty} onChange={(e) => setBarcode(i, "qty", e.target.value)} placeholder={t("ui.products.packQty")}
                  aria-label={t("ui.products.packQty")} title={t("ui.products.packQty")} />
                <button type="button" className="icon-btn" onClick={() => setBarcodes((list) => list.filter((_, j) => j !== i))} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
                {b.label && Number(b.qty) > 0 && <small className="ff__hint pack-codes__means">{fill(t("ui.products.packMeans"), { pack: unitName(t, b.label), qty: qty(b.qty), unit: unitName(t, f.unit) })}</small>}
                {err[`barcodes.${i}.barcode`] && <span className="ff__error">{fill(t("ui.errors.barcodeTaken"), { product: usedBy || f.name })}</span>}
                {err[`barcodes.${i}.qty`] && <span className="ff__error">{t("ui.errors.invalidAmount")}</span>}
              </div>
            ))}
            <div><button type="button" className="btn btn--outline btn--sm" onClick={() => setBarcodes((list) => [...list, { barcode: "", label: "", qty: 1 }])}><Icon name="plus" /><span>{t("ui.products.addPackBarcode")}</span></button></div>
          </div>
        )}

        {!isNew && (profile.variants.length > 1 || profile.variantGroups) && (
          <div className="ff ff--full variant-list">
            <span className="ff__label">{t("ui.products.otherVariants")}</span>
            {variants.length === 0 ? <small className="ff__hint">{t("ui.products.noVariants")}</small> : (
              <ul>
                {variants.map((v) => (
                  <li key={v.id}><button type="button" className="link-btn" onClick={() => onOpen?.(v)}>{v.name}</button><small className="muted"> · {qty(v.stock)} {v.unit}{!v.isActive ? ` · ${t("ui.products.statusValues.archived")}` : ""}</small></li>
                ))}
              </ul>
            )}
            {profile.fashion && <div><button type="button" className="btn btn--primary btn--sm" onClick={() => setMatrix(true)}><Icon name="grid" /><span>{t("ui.lists.createVariants")}</span></button></div>}
            {onOpen && <div><button type="button" className="btn btn--outline btn--sm" onClick={() => onOpen(variantTemplate({ ...product, ...f, specs, id: product.id }))}><Icon name="copy" /><span>{t("ui.products.addVariant")}</span></button></div>}
          </div>
        )}

        <datalist id="brand-options">{(options.data?.brands || []).map((b) => <option key={b.id} value={b.name} />)}</datalist>
        <datalist id="category-options">{(options.data?.categories || []).map((c) => <option key={c.id} value={c.name} />)}</datalist>
        {isNew && <p className="page-help ff--full"><Icon name="info" /> {t("ui.products.stockSeparate")}</p>}
        <FormError error={err.barcode || err.sku || Object.keys(err).some((k) => k.startsWith("barcodes.")) ? null : sub.formError} />
        <div className="form-actions ff--full sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy || Boolean(owner)}>{t(sub.busy ? "ui.common.saving" : "ui.common.save")}</button>
        </div>
      </form>
      {camera && <CameraScanner onCode={(code) => { setCamera(false); checkBarcode(code); }} onClose={() => setCamera(false)} />}
      {matrix && <VariantMatrix product={{ ...product, ...f, id: product.id }} fields={variantFields} onClose={() => setMatrix(false)}
        onDone={(r) => { setMatrix(false); onSaved({ id: product.id, variants: r }, f); }} />}
    </Modal>
  );
}

/*
 * Packaging structure (pharmacy): e.g. Carton → Box → Strip → tablet, with "Boxes per Carton", "Strips per Box",
 * "Tablets per Strip" and a calculator: Cartons × … = total tablets (updates as you type; it does not add stock).
 */
function PackagingEditor({ pack, setPack, unit, sellingPrice, errors }) {
  const { t, lang } = useLanguage();
  // English labels use plurals: "Boxes per Carton", "Tablets per Strip"
  const many = (w) => (lang !== "en" || !w || w === "…" ? w : (w[0].toUpperCase() + w.slice(1)).replace(/(x|s|ch|sh)$/i, "$1e") + "s");
  const m = useMoney();
  const [calc, setCalc] = useState("");
  const base = unitName(t, unit);
  const product = { unit, packaging: pack, sellingPrice: Number(sellingPrice) || 0 };
  const setLevel = (i, k, v) => setPack((list) => list.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const childOf = (i) => (i + 1 < pack.length ? pack[i + 1].name || "…" : base);
  const top = pack[0];
  const total = top ? unitsPer(product, top.name) : null;
  const calcTotal = total && Number(calc) > 0 ? Math.round(Number(calc) * total * 10000) / 10000 : null;
  return (
    <div className="ff ff--full packaging">
      <span className="ff__label">{t("ui.products.packagingTitle")}</span>
      <small className="ff__hint">{fill(t("ui.products.packagingHint"), { unit: base })}</small>
      {pack.map((l, i) => (
        <div key={i} className="packaging__row">
          <input className={"input" + (errors[`packaging.${i}.name`] ? " has-error" : "")} value={l.name} onChange={(e) => setLevel(i, "name", e.target.value)}
            list="pack-names" placeholder={t("ui.products.packName")} aria-label={t("ui.products.packName")} />
          <label className="packaging__per">
            <span>{fill(t("ui.products.perLabel"), { child: many(childOf(i)), pack: l.name || "…" })}</span>
            <input className={"input" + (errors[`packaging.${i}.per`] ? " has-error" : "")} type="number" min="0" step="any" inputMode="numeric" value={l.per}
              onChange={(e) => setLevel(i, "per", e.target.value)} />
          </label>
          <label className="checkbox packaging__flag"><input type="checkbox" checked={l.buy !== false} onChange={(e) => setLevel(i, "buy", e.target.checked)} /><span>{t("ui.products.buyUnit")}</span></label>
          <label className="checkbox packaging__flag"><input type="checkbox" checked={Boolean(l.sell)} onChange={(e) => setLevel(i, "sell", e.target.checked)} /><span>{t("ui.products.sellUnit")}</span></label>
          {l.sell ? (
            <label className="packaging__price">
              <span>{fill(t("ui.products.pricePer"), { pack: l.name || "…" })}</span>
              <input className={"input" + (errors[`packaging.${i}.price`] ? " has-error" : "")} type="number" min="0" step="any" value={l.price}
                onChange={(e) => setLevel(i, "price", e.target.value)} placeholder={unitsPer(product, l.name) ? m(packPrice(product, l.name)) : ""} />
            </label>
          ) : <span />}
          <button type="button" className="icon-btn" onClick={() => setPack((list) => list.filter((_, j) => j !== i))} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
        </div>
      ))}
      <div className="packaging__base"><Icon name="package" /> {fill(t("ui.products.baseUnitRow"), { unit: base })}</div>
      {errors.packaging && <span className="ff__error">{t("ui.products.packSameAsUnit")}</span>}
      <div className="packaging__actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setPack((list) => [{ name: "", per: "", buy: true, sell: false, price: "" }, ...list])}><Icon name="plus" /><span>{t("ui.products.addLargerPack")}</span></button>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setPack((list) => [...list, { name: "", per: "", buy: false, sell: true, price: "" }])}><Icon name="plus" /><span>{fill(t("ui.products.addSmallerPack"), { unit: base })}</span></button>
      </div>
      {top && (
        <div className="packaging__calc">
          <label>
            <span>{fill(t("ui.products.calcQty"), { pack: many(top.name || "…") })}</span>
            <input className="input" type="number" min="0" step="any" value={calc} onChange={(e) => setCalc(e.target.value)} placeholder="0" />
          </label>
          <label>
            <span>{fill(t("ui.products.calcTotal"), { unit: many(base) })}</span>
            <input className="input packaging__total" readOnly tabIndex={-1} value={calcTotal === null ? "" : qty(calcTotal)} placeholder={total ? "0" : t("ui.products.calcIncomplete")} />
          </label>
          <p className="packaging__chain">
            {total ? (Number(calc) > 0 ? breakdown(product, top.name, calc, (u) => unitName(t, u)) : breakdown(product, top.name, 1, (u) => unitName(t, u))) : t("ui.products.calcIncomplete")}
          </p>
          <small className="ff__hint">{t("ui.products.calcHint")}</small>
        </div>
      )}
      <datalist id="pack-names">{PACK_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}

/* Owner setting (electronics): extra technical specification fields per product type. */
function SpecFieldsSettings({ onClose }) {
  const { t } = useLanguage();
  const cur = useApi("/api/products/spec-fields");
  const [type, setType] = useState(PRODUCT_TYPES[0].key);
  const [fields, setFields] = useState(null);
  const [name, setName] = useState("");
  useEffect(() => { if (cur.data && !fields) setFields(cur.data.fields || {}); }, [cur.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const sub = useSubmit();
  const extra = fields?.[type] || [];
  const add = () => { const n = name.trim(); if (!n) return; setFields((x) => ({ ...x, [type]: [...new Set([...(x[type] || []), n])] })); setName(""); };
  const remove = (n) => setFields((x) => ({ ...x, [type]: (x[type] || []).filter((y) => y !== n) }));
  const save = async () => { if (await sub.run(() => apiRequest("/api/products/spec-fields", { method: "PUT", body: { fields } }))) onClose(); };
  return (
    <Modal title={t("ui.products.specFields")} onClose={onClose} wide>
      {!fields ? <Loading /> : (
        <div className="form-grid">
          <p className="modal__help">{t("ui.products.specFieldsHelp")}</p>
          <Field label={t("ui.products.productType")}>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{PRODUCT_TYPES.map((x) => <option key={x.key} value={x.key}>{x.key}</option>)}</select>
          </Field>
          <p className="muted">{t("ui.products.specFieldsBuiltIn")}: {typeOf(type)?.specs.join(", ") || "—"}</p>
          <ul className="chip-list">
            {extra.map((n) => <li key={n}>{n}<button type="button" className="link-btn" onClick={() => remove(n)} aria-label={t("ui.common.remove")}> ✕</button></li>)}
          </ul>
          <div className="qty-unit">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={t("ui.products.specFieldPh")} />
            <button type="button" className="btn btn--outline" onClick={add}><Icon name="plus" /><span>{t("ui.common.add")}</span></button>
          </div>
          <FormError error={sub.formError} />
          <div className="form-actions sheet-actions">
            <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
            <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}>{t("ui.common.save")}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* Owner setting: may two products share a SKU or barcode? (normally no) */
function ProductSettings({ onClose }) {
  const { t } = useLanguage();
  const { business, refresh } = useAuth();
  const [allow, setAllow] = useState(Boolean(business?.allowDuplicateCodes));
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest("/api/products/settings", { method: "PUT", body: { allowDuplicateCodes: allow } }))) { await refresh(); onClose(); }
  };
  return (
    <Modal title={t("ui.products.settings")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <label className="checkbox"><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /><span>{t("ui.products.allowDuplicates")}</span></label>
        <p className="modal__help">{t("ui.products.allowDuplicatesHelp")}</p>
        <FormError error={sub.formError} />
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* Product history: stock movements · changes to costs, prices, reorder level and status · batches on hand */
function HistoryModal({ product, lang, onClose }) {
  const { t } = useLanguage();
  const profile = useProfile();
  const m = useMoney();
  const L = (k) => productLabel(t, profile, k);
  const [tab, setTab] = useState("movements");
  const moves = useApi(`/api/products/${product.id}/movements`);
  const changes = useApi(tab === "changes" ? `/api/products/${product.id}/changes` : null);
  const details = useApi(tab === "batches" ? `/api/products/${product.id}/details` : null);
  const FIELD = { costPrice: L("costPrice"), sellingPrice: L("sellingPrice"), wholesalePrice: t("ui.products.wholesalePrice"), minStock: L("lowStockAlert"),
    status: t("ui.products.productStatus"), trackBatches: t("ui.products.trackBatches") };
  const value = (field, v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (field === "status") return t(`ui.products.statusValues.${v}`);
    if (field === "trackBatches") return t(v ? "ui.common.yes" : "ui.common.no");
    if (field === "minStock") return qty(v);
    return m(v);
  };
  const tabs = [
    { id: "movements", label: t("ui.products.tabs.movements"), icon: "history" },
    { id: "changes", label: t("ui.products.tabs.changes"), icon: "activity" },
    ...(profile.batches || product.trackBatches ? [{ id: "batches", label: t("ui.products.tabs.batches"), icon: "calendar" }] : [])
  ];
  return (
    <Modal title={`${t("ui.products.history")} · ${product.name}`} onClose={onClose} wide>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "movements" && (moves.loading ? <Loading /> : (moves.data?.movements || []).length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.audit.action")}</th><th className="num">{t("ui.common.qty")}</th><th>{t("ui.common.notes")}</th><th>{t("ui.common.user")}</th></tr></thead>
            <tbody>
              {moves.data.movements.map((mv, i) => (
                <tr key={i}>
                  <td>{date(mv.at, lang, true)}</td>
                  <td>{t(`ui.stock.types.${mv.type}`)}</td>
                  <td className={"num " + (mv.change < 0 ? "is-neg" : "is-pos")}>{mv.change > 0 ? "+" : ""}{qty(mv.change)}</td>
                  <td>{mv.note || "—"}</td>
                  <td>{mv.user || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {tab === "changes" && (!changes.data ? <Loading /> : changes.data.changes.length === 0 ? <EmptyState text={t("ui.products.noChanges")} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.products.change")}</th><th>{t("ui.common.user")}</th></tr></thead>
            <tbody>
              {changes.data.changes.map((c, i) => (
                <tr key={i}>
                  <td>{date(c.at, lang, true)}</td>
                  <td>
                    {c.action === "product.created"
                      ? <>{t("ui.products.created")}: {L("costPrice")} {value("costPrice", c.costPrice)} · {L("sellingPrice")} {value("sellingPrice", c.sellingPrice)}</>
                      : (c.changes || []).map((x, j) => <div key={j}><strong>{FIELD[x.field] || x.field}</strong>: {value(x.field, x.from)} → {value(x.field, x.to)}{c.source ? <small className="muted"> · {c.source}</small> : null}</div>)}
                  </td>
                  <td>{c.user || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {tab === "batches" && (!details.data ? <Loading /> : details.data.batches.length === 0 ? <EmptyState text={t(product.trackBatches ? "ui.products.noBatches" : "ui.products.batchesOff")} /> : (
        <div className="table-wrap">
          <table className="table table--compact">
            <thead><tr><th>{t("ui.stock.location")}</th><th>{t("ui.products.batchNo")}</th><th>{t("ui.products.expiryDate")}</th><th className="num">{t("ui.common.qty")}</th></tr></thead>
            <tbody>
              {details.data.batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.location}</td>
                  <td>{b.batchNo || <span className="muted">{t("ui.products.noBatchNo")}</span>}</td>
                  <td><ExpiryCell value={b.expiryDate} soonDays={profile.expirySoonDays} /></td>
                  <td className="num">{qty(b.qty)} {product.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
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
