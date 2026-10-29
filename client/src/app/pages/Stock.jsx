import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, useErrorText, Modal, Field, FormError, Money, EmptyState, Loading, SearchBox, DateRange, ReasonModal, daysAgo, isoDate, downloadCsv } from "../ui.jsx";
import { fill, qty, date } from "../format.js";
import ProductPicker, { FoundCard } from "../ProductPicker.jsx";
import { useDraft, DraftBar } from "../Drafts.jsx";

/*
 * Stock Management module. Tabs (shown by permission):
 *   Current stock · Add stock · Opening stock · Adjust · Transfer · Movements · Low stock · Valuation · Reports · Locations
 * Product details live in Products; this module only changes quantities, always through the
 * server's stock ledger (every change keeps the balance before / after, the user and the time).
 */
const TABS = [
  { id: "current", icon: "grid", perm: "stock.view" },
  { id: "add", icon: "plus", perm: "stock.add" },
  { id: "opening", icon: "package", perm: "stock.add" },
  { id: "adjust", icon: "swap", perm: "stock.adjust" },
  { id: "transfer", icon: "truck", perm: "stock.transfer" },
  { id: "movements", icon: "history", perm: "stock.view" },
  { id: "low", icon: "alert", perm: "stock.view" },
  { id: "valuation", icon: "wallet", perm: "stock.view" },
  { id: "reports", icon: "file-chart", perm: "stock.view" },
  { id: "locations", icon: "store", perm: "stock.view" }
];
const ADD_TYPES = ["purchase", "return_in", "stock_in"];
const ADJUST_REASONS = ["damaged", "expired", "lost", "found", "correction", "other"];
const MOVE_TYPES = ["opening", "purchase", "stock_in", "return_in", "sale", "invoice", "return_out", "purchase_return", "transfer_out", "transfer_in", "damaged", "adjustment", "count", "reversal"];
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;

export default function Stock() {
  const { t } = useLanguage();
  const can = usePerm();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((x) => can(x.perm));
  const tab = tabs.some((x) => x.id === params.get("tab")) ? params.get("tab") : tabs[0]?.id;
  const locationsApi = useApi("/api/stock/locations");
  const go = (id, extra = {}) => setParams({ tab: id, ...extra });
  return (
    <div className="page">
      <PageHeader icon="layers" title={t("ui.stock.title")} />
      <Tabs value={tab} onChange={(id) => go(id)} tabs={tabs.map((x) => ({ id: x.id, icon: x.icon, label: t(`ui.stock.tabs.${x.id}`) }))} />
      {tab === "current" && <CurrentStock locationsApi={locationsApi} go={go} />}
      {tab === "add" && <AddStock locationsApi={locationsApi} />}
      {tab === "opening" && <OpeningStock locationsApi={locationsApi} />}
      {tab === "adjust" && <AdjustStock locationsApi={locationsApi} initialProduct={params.get("product")} initialLocation={params.get("location")} />}
      {tab === "transfer" && <TransferStock locationsApi={locationsApi} />}
      {tab === "movements" && <Movements locationsApi={locationsApi} />}
      {tab === "low" && <LowStock go={go} />}
      {tab === "valuation" && <Valuation locationsApi={locationsApi} />}
      {tab === "reports" && <StockReports locationsApi={locationsApi} />}
      {tab === "locations" && <Locations locationsApi={locationsApi} />}
    </div>
  );
}

/* ---------- shared bits ---------- */
const activeLocations = (api) => (api.data?.locations || []).filter((l) => l.isActive);
const defaultLocation = (api) => activeLocations(api).find((l) => l.isDefault)?.id || activeLocations(api)[0]?.id || "";

function LocationSelect({ locationsApi, value, onChange, label, allowAll = false, error }) {
  const { t } = useLanguage();
  return (
    <Field label={label || t("ui.stock.location")} error={error}>
      <select className="input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">{t("ui.stock.allLocations")}</option>}
        {activeLocations(locationsApi).map((l) => <option key={l.id} value={l.id}>{l.name}{l.isDefault ? ` · ${t("ui.stock.default")}` : ""}</option>)}
      </select>
    </Field>
  );
}

function StatusPill({ status }) {
  const { t } = useLanguage();
  const cls = status === "in" ? "" : status === "low" ? " is-low" : " is-out";
  return <span className={"stock-pill" + cls}>{t(`ui.stock.status.${status}`)}</span>;
}

function Pager({ page, pageSize, total, onPage }) {
  const { t } = useLanguage();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="muted pager__info">{fill(t("ui.stock.results"), { n: total })}</p>;
  return (
    <div className="pager">
      <span className="muted">{fill(t("ui.stock.pageOf"), { page, pages, n: total })}</span>
      <button type="button" className="btn btn--outline btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><Icon name="arrow-left" /></button>
      <button type="button" className="btn btn--outline btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)}><Icon name="arrow-right" /></button>
    </div>
  );
}

/* Stock of one product at every location (for previews). */
function useProductStock(productId) {
  return useApi(productId ? `/api/stock/product/${productId}` : null);
}

/* Batch number + expiry date for products that track batches (cosmetics). value: { batchNo, expiryDate } */
export function BatchFields({ value, onChange, compact = false }) {
  const { t } = useLanguage();
  const today = isoDate(new Date());
  const past = value.expiryDate && value.expiryDate < today;
  const inputs = (
    <>
      <input className="input" value={value.batchNo || ""} onChange={(e) => onChange({ batchNo: e.target.value })} placeholder={t("ui.products.batchNoPh")} aria-label={t("ui.products.batchNo")} maxLength={60} />
      <input className={"input" + (past ? " has-error" : "")} type="date" value={value.expiryDate || ""} onChange={(e) => onChange({ expiryDate: e.target.value })} aria-label={t("ui.products.expiryDate")} title={t("ui.products.expiryDate")} />
    </>
  );
  if (compact) return <div className="batch-fields">{inputs}{past && <small className="ff__error">{t("ui.products.expiryPast")}</small>}</div>;
  return (
    <>
      <Field label={`${t("ui.products.batchNo")} ${t("ui.common.optional")}`}><input className="input" value={value.batchNo || ""} onChange={(e) => onChange({ batchNo: e.target.value })} placeholder={t("ui.products.batchNoPh")} maxLength={60} /></Field>
      <Field label={t("ui.products.expiryDate")} error={past ? "expiryPast" : undefined} hint={t("ui.products.expiryHint")}>
        <input className={"input" + (past ? " has-error" : "")} type="date" value={value.expiryDate || ""} onChange={(e) => onChange({ expiryDate: e.target.value })} />
      </Field>
    </>
  );
}

function Done({ text, onClose }) {
  return text ? <p className="form-status form-status--success" role="status">{text}{onClose && <button type="button" className="link-btn" onClick={onClose}> ✕</button>}</p> : null;
}

/* ===================== Current stock ===================== */
function CurrentStock({ locationsApi, go }) {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const [f, setF] = useState({ locationId: "", q: "", status: "" });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const path = `/api/stock/current?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page, pageSize: 50 })}`;
  const list = useApi(path);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const rows = list.data?.rows || [];
  return (
    <>
      <div className="toolbar">
        <SearchBox value={f.q} onChange={(v) => set("q", v)} placeholder={t("ui.stock.searchPh")} />
        <select className="input input--auto" value={f.locationId} onChange={(e) => set("locationId", e.target.value)} aria-label={t("ui.stock.location")}>
          <option value="">{t("ui.stock.allLocations")}</option>
          {activeLocations(locationsApi).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="input input--auto" value={f.status} onChange={(e) => set("status", e.target.value)} aria-label={t("ui.stock.stockStatus")}>
          <option value="">{t("ui.stock.allStatuses")}</option>
          {["in", "low", "out", "negative"].map((s) => <option key={s} value={s}>{t(`ui.stock.status.${s}`)}</option>)}
        </select>
      </div>
      <p className="muted stock-note"><Icon name="info" /> {t("ui.stock.availableNote")}</p>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="layers" text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr>
            <th>{t("ui.common.product")}</th><th>{t("ui.stock.location")}</th><th className="num">{t("ui.stock.current")}</th>
            <th className="num">{t("ui.stock.available")}</th><th>{t("ui.products.unit")}</th><th>{t("ui.stock.stockStatus")}</th><th className="num">{t("ui.stock.alertLevel")}</th>
            <th>{t("ui.stock.lastMovement")}</th><th />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.productId}-${r.locationId}`}>
                <td><div className="prod-cell">
                  <span className="prod-thumb">{r.imagePath ? <img src={fileUrl(r.imagePath)} alt="" loading="lazy" /> : <Icon name="package" />}</span>
                  <div><strong>{r.name}</strong><small className="cell-sub">{[r.sku, r.barcode].filter(Boolean).join(" · ")}</small></div>
                </div></td>
                <td>{r.location}</td>
                <td className="num">{qty(r.qty)}</td>
                <td className="num">{qty(r.available)}</td>
                <td>{r.unit}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="num">{qty(r.alertLevel)}<small className="cell-sub">{t(`ui.stock.alertFrom.${r.alertSource}`)}</small></td>
                <td>{r.lastMovementAt ? date(r.lastMovementAt, lang, true) : "—"}</td>
                <td className="row-actions">
                  {can("products.edit") && <button type="button" className="icon-btn" title={t("ui.stock.setAlert")} onClick={() => setEditing(r)}><Icon name="bell" /></button>}
                  {can("stock.adjust") && <button type="button" className="btn btn--outline btn--sm" onClick={() => go("adjust", { product: r.productId, location: r.locationId })}>{t("ui.stock.adjust")}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {editing && <AlertLevelForm row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
    </>
  );
}

function AlertLevelForm({ row, onClose, onSaved }) {
  const { t } = useLanguage();
  const [level, setLevel] = useState(row.alertSource === "location" ? String(row.alertLevel) : "");
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest("/api/stock/alert-level", { method: "PATCH", body: { productId: row.productId, locationId: row.locationId, alertLevel: level === "" ? null : level } }))) onSaved();
  };
  return (
    <Modal title={`${t("ui.stock.setAlert")} · ${row.name}`} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <p className="modal__help">{fill(t("ui.stock.alertHelp"), { location: row.location })}</p>
        <Field label={`${t("ui.stock.alertLevel")} · ${row.location}`} error={sub.fieldErrors.alertLevel} hint={t("ui.stock.alertEmpty")}>
          <input className="input" type="number" min="0" step="any" value={level} onChange={(e) => setLevel(e.target.value)} />
        </Field>
        <FormError error={sub.formError} />
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ===================== Add stock (several products in one entry) ===================== */
function AddStock({ locationsApi }) {
  const { t } = useLanguage();
  const errText = useErrorText();
  const suppliers = useApi("/api/suppliers");
  const [f, setF] = useState({ locationId: "", type: "purchase", reference: "", supplierId: "", notes: "" });
  const [lines, setLines] = useState([]);           // [{ product, qty }]
  const draft = useDraft("stock_add");
  const [flash, setFlash] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const qtyRefs = useRef({});
  const sub = useSubmit();
  const locationId = f.locationId || defaultLocation(locationsApi);
  const locationName = activeLocations(locationsApi).find((l) => String(l.id) === String(locationId))?.name || "";

  /* scanning selects a product; it never adds quantity by itself */
  const pick = (p) => {
    setDone(null);
    setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, qty: "" }]));
    setFlash(p.id);
    setTimeout(() => qtyRefs.current[p.id]?.focus(), 50);
    setTimeout(() => setFlash(null), 1500);
  };
  const setQty = (pid, v) => setLines((ls) => ls.map((l) => (l.product.id === pid ? { ...l, qty: v } : l)));
  const invalid = lines.filter((l) => !(Number(l.qty) > 0));
  const totalUnits = r3(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0));

  const save = async () => {
    const body = { ...f, locationId, supplierId: f.type === "purchase" ? f.supplierId || null : null,
      items: lines.map((l) => ({ productId: l.product.id, qty: Number(l.qty), batchNo: l.batchNo || "", expiryDate: l.expiryDate || "" })) };
    const r = await sub.run(() => apiRequest("/api/stock/add", { method: "POST", body }));
    setConfirming(false);
    if (r) { draft.finish(); setDone(fill(t("ui.stock.addDone"), { n: r.count, location: locationName })); setLines([]); setF((x) => ({ ...x, reference: "", notes: "" })); }
  };

  return (
    <div className="stock-form">
      <DraftBar draft={draft} canSave={lines.length > 0}
        title={`${t(`ui.stock.types.${f.type}`)} · ${locationName} · ${fill(t("ui.stock.linesSummary"), { n: lines.length, units: qty(totalUnits) })}`}
        getData={() => ({ f, lines })} onLoad={(d) => { setDone(null); setF((x) => ({ ...x, ...d.f })); setLines(d.lines || []); }} />
      <section className="panel-card form-grid form-grid--2">
        <LocationSelect locationsApi={locationsApi} value={locationId} onChange={(v) => setF({ ...f, locationId: v })} error={sub.fieldErrors.locationId} />
        <Field label={t("ui.stock.transactionType")} error={sub.fieldErrors.type}>
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {ADD_TYPES.map((x) => <option key={x} value={x}>{t(`ui.stock.types.${x}`)}</option>)}
          </select>
        </Field>
        {f.type === "purchase" && (
          <Field label={`${t("ui.common.supplier")} ${t("ui.common.optional")}`}>
            <select className="input" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">—</option>
              {(suppliers.data?.suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={`${t("ui.stock.reference")} ${t("ui.common.optional")}`}><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder={t("ui.stock.referencePh")} /></Field>
        <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`} full><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {f.type === "purchase" && <p className="page-help ff--full"><Icon name="info" /> {t("ui.stock.purchaseNote")}</p>}
      </section>

      <section className="panel-card">
        <h2 className="panel-card__title"><Icon name="barcode" />{t("ui.stock.scanProducts")}</h2>
        <ProductPicker onPick={pick} autoFocus />
        <p className="muted stock-note"><Icon name="info" /> {t("ui.stock.scanNoAdd")}</p>
        {lines.length === 0 ? <EmptyState icon="barcode" text={t("ui.stock.noLines")} /> : (
          <ul className="stock-lines">
            {lines.map((l) => (
              <li key={l.product.id} className={flash === l.product.id ? "is-flash" : ""}>
                <span className="prod-thumb">{l.product.imagePath ? <img src={fileUrl(l.product.imagePath)} alt="" /> : <Icon name="package" />}</span>
                <div className="stock-lines__name"><strong>{l.product.name}</strong><small>{[l.product.barcode, l.product.sku].filter(Boolean).join(" · ")} · {fill(t("ui.stock.totalNow"), { qty: qty(l.product.totalStock ?? l.product.stock), unit: l.product.unit })}</small></div>
                <label className="stock-lines__qty">
                  <input ref={(el) => { qtyRefs.current[l.product.id] = el; }} className={"input" + (l.qty !== "" && !(Number(l.qty) > 0) ? " has-error" : "")} type="number" min="0" step="any" value={l.qty} onChange={(e) => setQty(l.product.id, e.target.value)} placeholder="0" aria-label={t("ui.common.qty")} />
                  <span>{l.product.unit}</span>
                </label>
                <button type="button" className="icon-btn" onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
                {l.product.trackBatches && (
                  <div className="stock-lines__batch">
                    <BatchFields compact value={l} onChange={(patch) => setLines((ls) => ls.map((x) => (x.product.id === l.product.id ? { ...x, ...patch } : x)))} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {sub.formError && <p className="form-status form-status--error" role="alert">{errText(sub.formError)}</p>}
        <Done text={done} />
        <div className="form-actions">
          <span className="muted perm-count">{fill(t("ui.stock.linesSummary"), { n: lines.length, units: qty(totalUnits) })}</span>
          <button type="button" className="btn btn--primary" disabled={!lines.length || invalid.length > 0 || sub.busy} onClick={() => setConfirming(true)}>{t("ui.stock.reviewSave")}</button>
        </div>
      </section>

      {confirming && (
        <Modal title={t("ui.stock.confirmAdd")} onClose={() => setConfirming(false)}>
          <div className="form-grid">
            <p className="modal__help">{fill(t("ui.stock.confirmAddHelp"), { location: locationName, type: t(`ui.stock.types.${f.type}`) })}</p>
            <ul className="pay-list">{lines.map((l) => <li key={l.product.id}><strong>+{qty(l.qty)} {l.product.unit}</strong> · {l.product.name}{(l.batchNo || l.expiryDate) && <small className="muted"> · {[l.batchNo && `${t("ui.products.batchNo")} ${l.batchNo}`, l.expiryDate && `${t("ui.products.expiryDate")} ${l.expiryDate}`].filter(Boolean).join(" · ")}</small>}</li>)}</ul>
            <div className="form-actions sheet-actions">
              <button type="button" className="btn btn--outline" onClick={() => setConfirming(false)}>{t("ui.common.cancel")}</button>
              <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}>{t(sub.busy ? "ui.common.saving" : "ui.stock.confirm")}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ===================== Opening stock ===================== */
function OpeningStock({ locationsApi }) {
  const { t } = useLanguage();
  const errText = useErrorText();
  const [product, setProduct] = useState(null);
  const ps = useProductStock(product?.id);
  const [f, setF] = useState({ locationId: "", qty: "", reference: "", notes: "", batchNo: "", expiryDate: "" });
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const sub = useSubmit();
  const locationId = f.locationId || defaultLocation(locationsApi);
  const here = (ps.data?.locations || []).find((l) => String(l.locationId) === String(locationId));
  const save = async () => {
    const r = await sub.run(() => apiRequest("/api/stock/opening", { method: "POST", body: { productId: product.id, locationId, qty: f.qty, reference: f.reference, notes: f.notes, batchNo: f.batchNo, expiryDate: f.expiryDate } }));
    setConfirming(false);
    if (r) { setDone(fill(t("ui.stock.openingDone"), { name: product.name, qty: qty(r.after), location: here?.location || "" })); setProduct(null); setF({ ...f, qty: "", reference: "", notes: "", batchNo: "", expiryDate: "" }); }
  };
  return (
    <div className="stock-form">
      <p className="page-help"><Icon name="info" /> {t("ui.stock.openingHelp")}</p>
      <section className="panel-card form-grid">
        <ProductPicker onPick={(p) => { setProduct(p); setDone(null); }} autoFocus />
        {product && <FoundCard product={ps.data?.product || product} onClear={() => setProduct(null)} stockLabel={ps.data && fill(t("ui.stock.totalNow"), { qty: qty(ps.data.product.total), unit: ps.data.product.unit })} />}
        {product && (
          <div className="form-grid form-grid--2">
            <LocationSelect locationsApi={locationsApi} value={locationId} onChange={(v) => setF({ ...f, locationId: v })} />
            <Field label={`${t("ui.stock.openingQty")} (${(ps.data?.product || product).unit})`} error={sub.fieldErrors.qty}>
              <input className="input" type="number" min="0" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
            </Field>
            <Field label={`${t("ui.stock.reference")} ${t("ui.common.optional")}`}><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
            <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            {product.trackBatches && <BatchFields value={f} onChange={(patch) => setF({ ...f, ...patch })} />}
          </div>
        )}
        {here?.hasOpening && <p className="form-status form-status--error">{fill(t("ui.stock.openingExistsHere"), { location: here.location })}</p>}
        {sub.formError && <p className="form-status form-status--error" role="alert">{errText(sub.formError)}</p>}
        <Done text={done} />
        {product && (
          <div className="form-actions">
            <button type="button" className="btn btn--primary" disabled={!(Number(f.qty) > 0) || here?.hasOpening || sub.busy} onClick={() => setConfirming(true)}>{t("ui.stock.reviewSave")}</button>
          </div>
        )}
      </section>
      {confirming && (
        <Modal title={t("ui.stock.confirmOpening")} onClose={() => setConfirming(false)}>
          <div className="form-grid">
            <dl className="adj-preview">
              <div><dt>{t("ui.common.product")}</dt><dd>{product.name}</dd></div>
              <div><dt>{t("ui.stock.location")}</dt><dd>{here?.location}</dd></div>
              <div><dt>{t("ui.stock.openingQty")}</dt><dd>{qty(f.qty)} {(ps.data?.product || product).unit}</dd></div>
            </dl>
            <div className="form-actions sheet-actions">
              <button type="button" className="btn btn--outline" onClick={() => setConfirming(false)}>{t("ui.common.cancel")}</button>
              <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}>{t(sub.busy ? "ui.common.saving" : "ui.stock.confirm")}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ===================== Adjust stock (quantity or verified count) ===================== */
function AdjustStock({ locationsApi, initialProduct, initialLocation }) {
  const { t } = useLanguage();
  const m = useMoney();
  const errText = useErrorText();
  const [productId, setProductId] = useState(initialProduct || null);
  const ps = useProductStock(productId);
  const [f, setF] = useState({ locationId: initialLocation || "", mode: "adjust", direction: "subtract", qty: "", counted: "", reason: "", notes: "" });
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const sub = useSubmit();
  const locationId = f.locationId || defaultLocation(locationsApi);
  const here = (ps.data?.locations || []).find((l) => String(l.locationId) === String(locationId));
  const product = ps.data?.product;
  const before = here ? here.qty : null;
  const change = before === null ? null
    : f.mode === "count" ? (f.counted === "" ? null : r3(Number(f.counted) - before))
    : (Number(f.qty) > 0 ? (f.direction === "subtract" ? -Number(f.qty) : Number(f.qty)) : null);
  const after = change === null ? null : r3(before + change);
  const valueChange = change === null || !product ? null : Math.round(change * product.costPrice * 100) / 100;
  const reason = f.mode === "count" ? (f.reason || "correction") : f.reason;
  const ready = product && change !== null && change !== 0 && after >= 0 && reason;

  const save = async () => {
    const body = { productId, locationId, mode: f.mode, direction: f.direction, qty: f.qty, counted: f.counted, reason, notes: f.notes, expectedBefore: before };
    const r = await sub.run(() => apiRequest("/api/stock/adjust", { method: "POST", body }));
    setConfirming(false);
    ps.reload();
    if (r) {
      setDone(fill(t("ui.stock.adjustDone"), { name: product.name, before: qty(r.before), after: qty(r.after), unit: product.unit }));
      setF((x) => ({ ...x, qty: "", counted: "", notes: "" }));
    }
  };

  return (
    <div className="stock-form">
      <section className="panel-card form-grid">
        <ProductPicker onPick={(p) => { setProductId(p.id); setDone(null); }} autoFocus={!initialProduct} />
        {product && <FoundCard product={product} onClear={() => setProductId(null)}
          stockLabel={(ps.data.locations || []).map((l) => `${l.location}: ${qty(l.qty)}`).join(" · ")} />}
        {product && (
          <>
            <div className="form-grid form-grid--2">
              <LocationSelect locationsApi={locationsApi} value={locationId} onChange={(v) => setF({ ...f, locationId: v })} />
              <Field label={t("ui.stock.method")}>
                <div className="seg">
                  <button type="button" aria-pressed={f.mode === "adjust"} onClick={() => setF({ ...f, mode: "adjust" })}>{t("ui.stock.modeAdjust")}</button>
                  <button type="button" aria-pressed={f.mode === "count"} onClick={() => setF({ ...f, mode: "count" })}>{t("ui.stock.modeCount")}</button>
                </div>
              </Field>
              {f.mode === "adjust" ? (
                <>
                  <Field label={t("ui.stock.adjustType")}>
                    <div className="seg">
                      <button type="button" aria-pressed={f.direction === "add"} onClick={() => setF({ ...f, direction: "add" })}>{t("ui.stock.add")}</button>
                      <button type="button" aria-pressed={f.direction === "subtract"} onClick={() => setF({ ...f, direction: "subtract" })}>{t("ui.stock.subtract")}</button>
                    </div>
                  </Field>
                  <Field label={`${t("ui.stock.adjustQty")} (${product.unit})`} error={sub.fieldErrors.qty}>
                    <input className="input" type="number" min="0" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
                  </Field>
                </>
              ) : (
                <Field label={`${t("ui.stock.countedQty")} (${product.unit})`} error={sub.fieldErrors.counted} hint={t("ui.stock.countHint")} full>
                  <input className="input" type="number" min="0" step="any" value={f.counted} onChange={(e) => setF({ ...f, counted: e.target.value })} />
                </Field>
              )}
              <Field label={t("ui.common.reason")} error={sub.fieldErrors.reason}>
                <select className="input" value={reason || ""} onChange={(e) => setF({ ...f, reason: e.target.value })}>
                  <option value="">{t("ui.common.choose")}</option>
                  {ADJUST_REASONS.map((x) => <option key={x} value={x}>{t(`ui.stock.reasons.${x}`)}</option>)}
                </select>
              </Field>
              <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            </div>
            <AdjPreview before={before} change={change} after={after} unit={product.unit} value={valueChange} m={m} />
            {after !== null && after < 0 && <p className="form-status form-status--error">{t("ui.stock.wouldBeNegative")}</p>}
            {change === 0 && <p className="form-status form-status--error">{t("ui.errors.noChange")}</p>}
            {sub.formError && <p className="form-status form-status--error" role="alert">{sub.formError.code === "stockChanged" ? t("ui.stock.stockChanged") : errText(sub.formError)}</p>}
            <Done text={done} />
            <div className="form-actions">
              <button type="button" className="btn btn--primary" disabled={!ready || sub.busy} onClick={() => setConfirming(true)}>{t("ui.stock.reviewAdjust")}</button>
            </div>
          </>
        )}
        {!product && <Done text={done} />}
      </section>
      {confirming && product && (
        <Modal title={t("ui.stock.confirmAdjust")} onClose={() => setConfirming(false)}>
          <div className="form-grid">
            <p className="modal__help"><strong>{product.name}</strong> · {here?.location} · {t(`ui.stock.reasons.${reason}`)}</p>
            <AdjPreview before={before} change={change} after={after} unit={product.unit} value={valueChange} m={m} />
            <div className="form-actions sheet-actions">
              <button type="button" className="btn btn--outline" onClick={() => setConfirming(false)}>{t("ui.common.cancel")}</button>
              <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}>{t(sub.busy ? "ui.common.saving" : "ui.stock.confirm")}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AdjPreview({ before, change, after, unit, value, m }) {
  const { t } = useLanguage();
  if (before === null) return null;
  return (
    <dl className="adj-preview">
      <div><dt>{t("ui.stock.previous")}</dt><dd>{qty(before)} {unit}</dd></div>
      <div><dt>{t("ui.stock.change")}</dt><dd className={change > 0 ? "is-pos" : change < 0 ? "is-neg" : ""}>{change === null ? "—" : `${change > 0 ? "+" : ""}${qty(change)} ${unit}`}</dd></div>
      <div className="is-total"><dt>{t("ui.stock.newStock")}</dt><dd>{after === null ? "—" : `${qty(after)} ${unit}`}</dd></div>
      {value !== null && value !== 0 && <div><dt>{t("ui.stock.valueEffect")}</dt><dd className={value > 0 ? "is-pos" : "is-neg"}>{value > 0 ? "+" : "−"}{m(Math.abs(value))}</dd></div>}
    </dl>
  );
}

/* ===================== Transfer between locations ===================== */
function TransferStock({ locationsApi }) {
  const { t } = useLanguage();
  const errText = useErrorText();
  const locs = activeLocations(locationsApi);
  const [f, setF] = useState({ fromLocationId: "", toLocationId: "", reference: "", notes: "" });
  const [lines, setLines] = useState([]);    // [{ product, qty, available }]
  const draft = useDraft("stock_transfer");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);
  const sub = useSubmit();
  const from = f.fromLocationId || defaultLocation(locationsApi);
  const to = f.toLocationId || locs.find((l) => String(l.id) !== String(from))?.id || "";
  const nameOf = (lid) => locs.find((l) => String(l.id) === String(lid))?.name || "";
  // available quantity at the source location for each line
  useEffect(() => {
    lines.forEach((l) => {
      if (l.availableAt === String(from)) return;
      apiRequest(`/api/stock/product/${l.product.id}`).then((d) => {
        const at = d.locations.find((x) => String(x.locationId) === String(from));
        setLines((ls) => ls.map((x) => (x.product.id === l.product.id ? { ...x, available: at ? at.qty : 0, availableAt: String(from) } : x)));
      }).catch(() => {});
    });
  }, [from, lines.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (p) => { setDone(null); setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, qty: "", available: null, availableAt: null }])); };
  const bad = (l) => !(Number(l.qty) > 0) || (l.available !== null && Number(l.qty) > l.available);
  const save = async () => {
    const r = await sub.run(() => apiRequest("/api/stock/transfer", { method: "POST", body: { fromLocationId: from, toLocationId: to, reference: f.reference, notes: f.notes, items: lines.map((l) => ({ productId: l.product.id, qty: Number(l.qty) })) } }));
    setConfirming(false);
    if (r) { draft.finish(); setDone(fill(t("ui.stock.transferDone"), { n: r.count, from: nameOf(from), to: nameOf(to), ref: r.transferRef })); setLines([]); }
  };
  if (locs.length < 2) return <EmptyState icon="store" text={t("ui.stock.needTwoLocations")} />;
  return (
    <div className="stock-form">
      <DraftBar draft={draft} canSave={lines.length > 0}
        title={`${nameOf(from)} → ${nameOf(to)} · ${lines.length}`}
        getData={() => ({ f, lines: lines.map((l) => ({ product: l.product, qty: l.qty })) })}
        onLoad={(d) => { setDone(null); setF((x) => ({ ...x, ...d.f })); setLines((d.lines || []).map((l) => ({ ...l, available: null, availableAt: null }))); }} />
      <section className="panel-card form-grid form-grid--2">
        <LocationSelect locationsApi={locationsApi} label={t("ui.stock.fromLocation")} value={from} onChange={(v) => setF({ ...f, fromLocationId: v })} />
        <Field label={t("ui.stock.toLocation")} error={sub.fieldErrors.toLocationId && t("ui.errors.sameLocation")}>
          <select className="input" value={to} onChange={(e) => setF({ ...f, toLocationId: e.target.value })}>
            {locs.filter((l) => String(l.id) !== String(from)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label={`${t("ui.stock.reference")} ${t("ui.common.optional")}`}><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </section>
      <section className="panel-card">
        <ProductPicker onPick={pick} />
        {lines.length === 0 ? <EmptyState icon="truck" text={t("ui.stock.noLines")} /> : (
          <ul className="stock-lines">
            {lines.map((l) => (
              <li key={l.product.id}>
                <span className="prod-thumb">{l.product.imagePath ? <img src={fileUrl(l.product.imagePath)} alt="" /> : <Icon name="package" />}</span>
                <div className="stock-lines__name"><strong>{l.product.name}</strong><small>{l.available === null ? "…" : fill(t("ui.stock.availableAt"), { qty: qty(l.available), unit: l.product.unit, location: nameOf(from) })}</small></div>
                <label className="stock-lines__qty">
                  <input className={"input" + (l.qty !== "" && bad(l) ? " has-error" : "")} type="number" min="0" step="any" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.product.id === l.product.id ? { ...x, qty: e.target.value } : x)))} placeholder="0" aria-label={t("ui.common.qty")} />
                  <span>{l.product.unit}</span>
                </label>
                <button type="button" className="icon-btn" onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
              </li>
            ))}
          </ul>
        )}
        {sub.formError && <p className="form-status form-status--error" role="alert">{errText(sub.formError)}</p>}
        <Done text={done} />
        <div className="form-actions">
          <button type="button" className="btn btn--primary" disabled={!lines.length || lines.some(bad) || !to || sub.busy} onClick={() => setConfirming(true)}>{t("ui.stock.reviewTransfer")}</button>
        </div>
      </section>
      {confirming && (
        <Modal title={t("ui.stock.confirmTransfer")} onClose={() => setConfirming(false)}>
          <div className="form-grid">
            <p className="modal__help"><strong>{nameOf(from)}</strong> → <strong>{nameOf(to)}</strong></p>
            <ul className="pay-list">{lines.map((l) => <li key={l.product.id}><strong>{qty(l.qty)} {l.product.unit}</strong> · {l.product.name}</li>)}</ul>
            <div className="form-actions sheet-actions">
              <button type="button" className="btn btn--outline" onClick={() => setConfirming(false)}>{t("ui.common.cancel")}</button>
              <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}>{t(sub.busy ? "ui.common.saving" : "ui.stock.confirm")}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ===================== Movement ledger ===================== */
function Movements({ locationsApi }) {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const [f, setF] = useState({ q: "", locationId: "", type: "", ...{ from: daysAgo(29), to: isoDate(new Date()) } });
  const [page, setPage] = useState(1);
  const [reversing, setReversing] = useState(null);
  const list = useApi(`/api/stock/movements?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page, pageSize: 50 })}`);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const rows = list.data?.movements || [];
  return (
    <>
      <div className="toolbar">
        <SearchBox value={f.q} onChange={(v) => set("q", v)} placeholder={t("ui.stock.searchMovesPh")} />
        <select className="input input--auto" value={f.locationId} onChange={(e) => set("locationId", e.target.value)} aria-label={t("ui.stock.location")}>
          <option value="">{t("ui.stock.allLocations")}</option>
          {(locationsApi.data?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="input input--auto" value={f.type} onChange={(e) => set("type", e.target.value)} aria-label={t("ui.stock.movementType")}>
          <option value="">{t("ui.stock.allTypes")}</option>
          {MOVE_TYPES.map((x) => <option key={x} value={x}>{t(`ui.stock.types.${x}`)}</option>)}
        </select>
        <DateRange value={{ from: f.from, to: f.to }} onChange={(v) => { setF((x) => ({ ...x, ...v })); setPage(1); }} />
      </div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="history" text={t("ui.common.noResults")} /> : (
        <div className="table-wrap"><table className="table table--compact">
          <thead><tr>
            <th>{t("ui.common.date")}</th><th>{t("ui.common.product")}</th><th>{t("ui.stock.location")}</th><th>{t("ui.stock.movementType")}</th>
            <th className="num">{t("ui.stock.change")}</th><th className="num">{t("ui.stock.beforeAfter")}</th><th className="num">{t("ui.stock.value")}</th>
            <th>{t("ui.stock.reasonRef")}</th><th>{t("ui.common.user")}</th><th />
          </tr></thead>
          <tbody>
            {rows.map((mv) => (
              <tr key={mv.id} className={mv.reversedBy ? "is-muted" : ""}>
                <td>{date(mv.at, lang, true)}<small className="cell-sub">#{mv.id}</small></td>
                <td><strong>{mv.product}</strong>{mv.sku && <small className="cell-sub">{mv.sku}</small>}</td>
                <td>{mv.location || "—"}</td>
                <td>{t(`ui.stock.types.${mv.type}`)}{mv.reversalOf && <small className="cell-sub">{fill(t("ui.stock.reversalOf"), { id: mv.reversalOf })}</small>}{mv.reversedBy && <small className="cell-sub">{t("ui.stock.reversed")}</small>}</td>
                <td className={"num " + (mv.change < 0 ? "is-neg" : "is-pos")}>{mv.change > 0 ? "+" : ""}{qty(mv.change)} {mv.unit}</td>
                <td className="num">{mv.before === null ? "—" : `${qty(mv.before)} → ${qty(mv.after)}`}</td>
                <td className="num">{mv.value === null ? "—" : <Money value={mv.value} />}</td>
                <td>{[mv.reason && (t(`ui.stock.reasons.${mv.reason}`).startsWith("ui.") ? mv.reason : t(`ui.stock.reasons.${mv.reason}`)), mv.reference, mv.supplier, mv.notes].filter(Boolean).join(" · ") || "—"}</td>
                <td>{mv.user || "—"}</td>
                <td className="row-actions">{mv.canReverse && can("stock.adjust") && <button type="button" className="btn btn--outline btn--sm" onClick={() => setReversing(mv)}>{t("ui.stock.reverse")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {reversing && <ReasonModal title={`${t("ui.stock.reverse")} #${reversing.id}`} help={reversing.transferRef ? t("ui.stock.reverseTransferHelp") : t("ui.stock.reverseHelp")} confirmLabel={t("ui.stock.reverse")}
        onConfirm={(reason) => apiRequest(`/api/stock/movements/${reversing.id}/reverse`, { method: "POST", body: { reason } }).then(() => list.reload())} onClose={() => setReversing(null)} />}
    </>
  );
}

/* ===================== Low stock ===================== */
function LowStock({ go }) {
  const { t } = useLanguage();
  const can = usePerm();
  const list = useApi("/api/stock/low");
  const items = list.data?.items || [];
  return list.loading && !list.data ? <Loading /> : items.length === 0 ? <EmptyState icon="check" text={t("ui.stock.noLow")} /> : (
    <>
      <p className="page-help"><Icon name="info" /> {t("ui.stock.lowHelp")}</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t("ui.common.product")}</th><th>{t("ui.stock.location")}</th><th className="num">{t("ui.stock.current")}</th><th>{t("ui.products.unit")}</th><th className="num">{t("ui.stock.alertLevel")}</th><th>{t("ui.stock.stockStatus")}</th><th /></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={`${r.productId}-${r.locationId}`}>
              <td><strong>{r.name}</strong>{r.sku && <small className="cell-sub">{r.sku}</small>}</td>
              <td>{r.location}</td>
              <td className="num">{qty(r.qty)}</td>
              <td>{r.unit}</td>
              <td className="num">{qty(r.alertLevel)}<small className="cell-sub">{t(`ui.stock.alertFrom.${r.alertSource}`)}</small></td>
              <td><StatusPill status={r.status} /></td>
              <td className="row-actions">{can("stock.add") && <button type="button" className="btn btn--outline btn--sm" onClick={() => go("add")}>{t("ui.stock.tabs.add")}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}

/* ===================== Valuation ===================== */
function Valuation({ locationsApi }) {
  const { t } = useLanguage();
  const m = useMoney();
  const [loc, setLoc] = useState("");
  const v = useApi(`/api/stock/valuation${loc ? `?locationId=${loc}` : ""}`);
  const d = v.data;
  const exportCsv = () => downloadCsv("stock-valuation.csv", ["location", "product", "sku", "qty", "unit", "costPrice", "costValue", "sellingPrice", "retailValue"],
    (d?.items || []).map((i) => [i.location, i.name, i.sku, i.qty, i.unit, i.costPrice, i.costValue, i.sellingPrice, i.retailValue]));
  return (
    <>
      <div className="toolbar">
        <select className="input input--auto" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label={t("ui.stock.location")}>
          <option value="">{t("ui.stock.allLocations")}</option>
          {(locationsApi.data?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button type="button" className="btn btn--outline" onClick={exportCsv} disabled={!d?.items?.length}><Icon name="download" /><span>{t("ui.common.exportCsv")}</span></button>
      </div>
      {v.loading && !d ? <Loading /> : !d ? null : (
        <>
          <div className="acct-grid">
            <div className="acct-card acct-card--total"><small>{t("ui.stock.costValue")}</small><span className="money">{m(d.totals.costValue)}</span></div>
            <div className="acct-card"><small>{t("ui.stock.retailValue")}</small><span className="money">{m(d.totals.retailValue)}</span></div>
            <div className="acct-card"><small>{t("ui.stock.units")}</small><span className="money">{qty(d.totals.units)}</span></div>
            {d.byLocation.length > 1 && d.byLocation.map((b) => (
              <div key={b.locationId} className="acct-card"><small>{b.location}</small><span className="money">{m(b.costValue)}</span><small>{fill(t("ui.stock.unitsShort"), { n: qty(b.units) })}</small></div>
            ))}
          </div>
          <p className="muted stock-note"><Icon name="info" /> {t("ui.stock.valuationNote")}</p>
          {d.items.length === 0 ? <EmptyState icon="wallet" text={t("ui.common.noResults")} /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t("ui.common.product")}</th><th>{t("ui.stock.location")}</th><th className="num">{t("ui.common.qty")}</th><th>{t("ui.products.unit")}</th><th className="num">{t("ui.products.costPrice")}</th><th className="num">{t("ui.stock.costValue")}</th><th className="num">{t("ui.stock.retailValue")}</th></tr></thead>
              <tbody>{d.items.map((i) => (
                <tr key={`${i.productId}-${i.locationId}`}><td><strong>{i.name}</strong></td><td>{i.location}</td><td className="num">{qty(i.qty)}</td><td>{i.unit}</td><td className="num"><Money value={i.costPrice} /></td><td className="num"><Money value={i.costValue} /></td><td className="num"><Money value={i.retailValue} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </>
  );
}

/* ===================== Stock reports ===================== */
function StockReports({ locationsApi }) {
  const { t } = useLanguage();
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const [loc, setLoc] = useState("");
  const r = useApi(`/api/stock/report?${new URLSearchParams({ ...range, ...(loc ? { locationId: loc } : {}) })}`);
  const d = r.data;
  return (
    <>
      <div className="toolbar">
        <DateRange value={range} onChange={setRange} />
        <select className="input input--auto" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label={t("ui.stock.location")}>
          <option value="">{t("ui.stock.allLocations")}</option>
          {(locationsApi.data?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <Link className="btn btn--outline" to="/app/m/reports"><Icon name="file-chart" /><span>{t("ui.stock.moreReports")}</span></Link>
      </div>
      {r.loading && !d ? <Loading /> : !d ? null : (
        <div className="split-view">
          <section className="panel-card">
            <h2 className="panel-card__title"><Icon name="history" />{t("ui.stock.byType")}</h2>
            {d.byType.length === 0 ? <p className="dash-empty">{t("ui.common.noResults")}</p> : (
              <div className="table-wrap"><table className="table table--compact">
                <thead><tr><th>{t("ui.stock.movementType")}</th><th className="num">{t("ui.stock.moves")}</th><th className="num">{t("ui.stock.qtyIn")}</th><th className="num">{t("ui.stock.qtyOut")}</th><th className="num">{t("ui.stock.value")}</th></tr></thead>
                <tbody>{d.byType.map((x) => (
                  <tr key={x.type}><td>{t(`ui.stock.types.${x.type}`)}</td><td className="num">{x.moves}</td><td className="num is-pos">{qty(x.qtyIn)}</td><td className="num is-neg">{qty(x.qtyOut)}</td><td className="num"><Money value={x.value} /></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <section className="panel-card">
            <h2 className="panel-card__title"><Icon name="alert" />{t("ui.stock.losses")}</h2>
            {d.losses.length === 0 ? <p className="dash-empty">{t("ui.stock.noLosses")}</p> : (
              <div className="table-wrap"><table className="table table--compact">
                <thead><tr><th>{t("ui.common.product")}</th><th>{t("ui.common.reason")}</th><th className="num">{t("ui.common.qty")}</th><th className="num">{t("ui.stock.value")}</th></tr></thead>
                <tbody>{d.losses.map((x, i) => (
                  <tr key={i}><td>{x.name}</td><td>{x.reason ? (t(`ui.stock.reasons.${x.reason}`).startsWith("ui.") ? x.reason : t(`ui.stock.reasons.${x.reason}`)) : "—"}</td><td className="num">{qty(x.qty)}</td><td className="num is-neg"><Money value={x.value} /></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

/* ===================== Locations ===================== */
function Locations({ locationsApi }) {
  const { t } = useLanguage();
  const can = usePerm();
  const [editing, setEditing] = useState(null);
  const locs = locationsApi.data?.locations || [];
  return (
    <>
      <div className="staff-bar">
        <p className="page-help">{t("ui.stock.locationsHelp")}</p>
        {can("stock.locations") && <button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Icon name="plus" /><span>{t("ui.stock.newLocation")}</span></button>}
      </div>
      {locationsApi.loading && !locationsApi.data ? <Loading /> : (
        <div className="role-cards">
          {locs.map((l) => (
            <article key={l.id} className={"role-card" + (l.isActive ? "" : " is-off")}>
              <div className="role-card__head">
                <strong>{l.name}</strong>
                <span className="role-card__count">{t(`ui.stock.kinds.${l.kind}`)}</span>
              </div>
              {l.address && <p className="muted">{l.address}</p>}
              <div className="role-card__mods">
                {l.isDefault && <span className="chip-mod">{t("ui.stock.defaultLocation")}</span>}
                {!l.isActive && <span className="chip-mod chip-mod--off">{t("ui.payMethods.off")}</span>}
              </div>
              <small className="muted">{fill(t("ui.stock.locationSummary"), { products: l.products, units: qty(l.units) })}</small>
              {can("stock.locations") && <div className="role-card__actions"><button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(l)}>{t("ui.common.edit")}</button></div>}
            </article>
          ))}
        </div>
      )}
      {editing && <LocationForm location={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); locationsApi.reload(); }} />}
    </>
  );
}

function LocationForm({ location, onClose, onSaved }) {
  const { t } = useLanguage();
  const errText = useErrorText();
  const isNew = !location.id;
  const [f, setF] = useState({ name: location.name || "", kind: location.kind || "shop", address: location.address || "", isActive: location.isActive ?? true, isDefault: Boolean(location.isDefault) });
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(isNew ? "/api/stock/locations" : `/api/stock/locations/${location.id}`, { method: isNew ? "POST" : "PUT", body: f }))) onSaved();
  };
  return (
    <Modal title={t(isNew ? "ui.stock.newLocation" : "ui.stock.editLocation")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.common.name")} error={sub.fieldErrors.name === "locationNameTaken" ? undefined : sub.fieldErrors.name}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("ui.stock.locationNamePh")} autoFocus /></Field>
        {sub.fieldErrors.name === "locationNameTaken" && <p className="form-status form-status--error">{t("ui.errors.locationNameTaken")}</p>}
        <Field label={t("ui.stock.kind")}>
          <div className="seg">{["shop", "warehouse", "other"].map((k) => <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>{t(`ui.stock.kinds.${k}`)}</button>)}</div>
        </Field>
        <Field label={`${t("ui.common.address")} ${t("ui.common.optional")}`}><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        {!isNew && !location.isDefault && <label className="checkbox"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /><span>{t("ui.stock.makeDefault")}</span></label>}
        {!isNew && !location.isDefault && <label className="checkbox"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /><span>{t("ui.stock.locationActive")}</span></label>}
        <p className="muted">{t("ui.stock.defaultHelp")}</p>
        {sub.formError && sub.formError.code !== "validation" && <p className="form-status form-status--error" role="alert">{errText(sub.formError)}</p>}
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t(sub.busy ? "ui.common.saving" : "ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
