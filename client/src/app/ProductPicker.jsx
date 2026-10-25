import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../services/api.js";
import { useMoney } from "./ui.jsx";
import { fill, qty } from "./format.js";
import CameraScanner from "./CameraScanner.jsx";

/*
 * Find a product by typing (name / SKU / barcode), a USB barcode scanner (types the code + Enter)
 * or the camera. Picking a product only SELECTS it — it never changes stock by itself.
 *   onPick(product)   called with the product from GET /api/products
 *   onUnknown(code)   optional: a scanned / typed code that matches no product
 */
export default function ProductPicker({ onPick, onUnknown, placeholder, autoFocus = false, includeInactive = false }) {
  const { t } = useLanguage();
  const m = useMoney();
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [camera, setCamera] = useState(false);
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  // suggestions while typing
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setList([]); return undefined; }
    const timer = setTimeout(() => {
      apiRequest(`/api/products?${new URLSearchParams({ q: term, ...(includeInactive ? { active: "all" } : {}) })}`)
        .then((d) => { setList((d.products || []).slice(0, 8)); setOpen(true); })
        .catch(() => setList([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, includeInactive]);
  useEffect(() => {
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (p) => { setQ(""); setList([]); setOpen(false); setNotice(null); onPick(p); };

  /* exact barcode / SKU first, then a single name match */
  const lookup = useCallback(async (code) => {
    try {
      const { product } = await apiRequest(`/api/products/barcode/${encodeURIComponent(code)}`);
      pick(product);
      return;
    } catch { /* not a barcode */ }
    try {
      const { products } = await apiRequest(`/api/products?q=${encodeURIComponent(code)}`);
      if (products.length === 1) { pick(products[0]); return; }
    } catch { /* ignore */ }
    if (onUnknown) { setQ(""); setOpen(false); onUnknown(code); } else setNotice(`${t("ui.pos.notFound")} (${code})`);
  }, [onUnknown]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e) => {
    if (e.key === "Enter" && q.trim()) { e.preventDefault(); lookup(q.trim()); }
    if (e.key === "Escape") setOpen(false);
  };
  const onCamera = useCallback((code) => { setCamera(false); lookup(code); inputRef.current?.focus(); }, [lookup]);

  return (
    <div className="picker" ref={boxRef}>
      <div className="picker__bar">
        <div className="picker__input">
          <Icon name="barcode" />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setNotice(null); }} onKeyDown={onKey} onFocus={() => list.length && setOpen(true)}
            placeholder={placeholder || t("ui.stock.pickerPh")} aria-label={placeholder || t("ui.stock.pickerPh")} autoComplete="off" />
        </div>
        <button type="button" className="btn btn--navy picker__scan" onClick={() => { setNotice(null); setCamera(true); }}>
          <Icon name="barcode" /><span>{t("ui.pos.scan")}</span>
        </button>
      </div>
      {open && list.length > 0 && (
        <ul className="picker__list" role="listbox">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => pick(p)}>
                <span className="picker__thumb">{p.imagePath ? <img src={fileUrl(p.imagePath)} alt="" /> : <Icon name="package" />}</span>
                <span className="picker__text"><strong>{p.name}</strong><small>{[p.barcode, p.sku].filter(Boolean).join(" · ")}</small></span>
                <span className="picker__meta">{m(p.sellingPrice)}<small>{fill(t("ui.pos.inStock"), { qty: qty(p.stock) })}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="form-status form-status--error" role="alert">{notice}</p>}
      {camera && <CameraScanner onCode={onCamera} onClose={() => setCamera(false)} />}
    </div>
  );
}

/* The found / selected product, highlighted on a light-grey background. */
export function FoundCard({ product: p, stockLabel, children, onClear }) {
  const { t } = useLanguage();
  const m = useMoney();
  if (!p) return null;
  const facts = [
    [t("ui.products.barcode"), p.barcode], [t("ui.products.sku"), p.sku], [t("ui.products.brand"), p.brand],
    [t("ui.common.category"), [p.category, p.subcategory].filter(Boolean).join(" › ")], [t("ui.products.unit"), p.unit],
    [t("ui.products.sellingPrice"), m(p.sellingPrice)]
  ].filter(([, v]) => v);
  return (
    <article className="found-card" aria-live="polite">
      <span className="found-card__img">{p.imagePath ? <img src={fileUrl(p.imagePath)} alt="" /> : <Icon name="package" />}</span>
      <div className="found-card__body">
        <div className="found-card__head">
          <strong>{p.name}</strong>
          {onClear && <button type="button" className="icon-btn" onClick={onClear} aria-label={t("ui.common.remove")}><Icon name="x" /></button>}
        </div>
        <dl className="found-card__facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {stockLabel && <p className="found-card__stock">{stockLabel}</p>}
        {children}
      </div>
    </article>
  );
}
