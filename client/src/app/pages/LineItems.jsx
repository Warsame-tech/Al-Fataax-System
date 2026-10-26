import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { useApi, useMoney, usePerm } from "../ui.jsx";
import { fill, qty } from "../format.js";
import SearchSelect from "../SearchSelect.jsx";
import CameraScanner from "../CameraScanner.jsx";

/*
 * Editable product lines for invoices and purchases.
 * mode "sell": price from the chosen price list (editable only when allowPrice);
 *              the quantity can never be more than the stock on hand
 * mode "buy":  unit cost entered per line (defaults to the product's cost price)
 * Under the lines: "Scan barcode" (camera) and "Add item" (opens the product list to choose another product).
 */
export default function LineItems({ lines, onChange, mode = "sell", priceList = "retail", allowPrice = false, errors = {} }) {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const products = useApi("/api/products?location=default");
  const all = products.data?.products || [];
  const [camera, setCamera] = useState(false);
  const [pickSignal, setPickSignal] = useState(0);   // "Add item" opens the product list
  const [notice, setNotice] = useState(null);      // { text, kind, link? }

  const sell = mode === "sell";
  const priceOf = (p) => (mode === "buy" ? p.costPrice : priceList === "wholesale" && p.wholesalePrice !== null ? p.wholesalePrice : p.sellingPrice);
  const addProduct = (p) => {
    if (!p) return;
    if (lines.some((l) => l.product.id === p.id)) return setNotice({ text: fill(t("ui.invoices.alreadyAdded"), { name: p.name }), kind: "info" });
    if (sell && p.stock <= 0) return setNotice({ text: fill(t("ui.invoices.noStock"), { name: p.name }), kind: "error", link: can("stock.add") });
    setNotice(null);
    onChange([...lines, { product: p, qty: 1, price: priceOf(p) }]);
  };
  const add = (idv) => addProduct(all.find((x) => String(x.id) === String(idv)));
  const onScan = (code) => {
    setCamera(false);
    const p = all.find((x) => x.barcode && x.barcode === String(code).trim());
    if (p) addProduct(p);
    else setNotice({ text: t("ui.pos.notFound"), kind: "error" });
  };

  const options = all.map((p) => ({
    value: p.id,
    label: p.name,
    sub: [p.sku, p.barcode, `${mode === "buy" ? m(p.costPrice) : m(priceOf(p))} · ${qty(p.stock)} ${p.unit}`].filter(Boolean).join(" · "),
    disabled: (sell && p.stock <= 0) || lines.some((l) => l.product.id === p.id)
  }));
  /* selling: the quantity is capped at the stock on hand */
  const setQty = (i, value) => {
    const l = lines[i];
    const over = sell && value !== "" && Number(value) > l.product.stock;
    update(i, { qty: over ? String(l.product.stock) : value, capped: over });
  };
  const update = (i, patch) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);

  return (
    <div className="lines">
      <SearchSelect options={options} value="" onChange={add} clearOnPick icon="search-glass"
        placeholder={`${t("ui.invoices.addItem")}…`} searchPlaceholder={t("ui.products.searchPh")} invalid={Boolean(errors.items)} openSignal={pickSignal} />
      {errors.items && <span className="ff__error">{t("ui.errors.required")}</span>}
      {notice && (
        <p className={"form-status " + (notice.kind === "error" ? "form-status--error" : "form-status--info")} role="status">
          {notice.text}
          {notice.link && <> <Link to="/app/m/stock?tab=add">{t("ui.stock.tabs.add")}</Link></>}
          <button type="button" className="link-btn" onClick={() => setNotice(null)} aria-label={t("ui.common.close")}> ✕</button>
        </p>
      )}
      {lines.length > 0 && (
        <div className="table-wrap">
          <table className="table table--compact lines__table">
            <thead><tr><th>{t("ui.common.product")}</th><th className="num">{t("ui.common.qty")}</th><th className="num">{mode === "buy" ? t("ui.common.unitCost") : t("ui.common.unitPrice")}</th><th className="num">{t("ui.common.total")}</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.product.id}>
                  <td>{l.product.name}{sell && <small className="cell-sub">{fill(t("ui.invoices.inStock"), { qty: qty(l.product.stock), unit: l.product.unit })}</small>}</td>
                  <td className="num">
                    <input className={"input input--sm" + (errors[`items.${i}.qty`] || l.capped ? " has-error" : "")} type="number" min="0" step="any"
                      max={sell ? l.product.stock : undefined} value={l.qty} onChange={(e) => setQty(i, e.target.value)} />
                    {sell && l.capped && <small className="ff__error lines__cap">{fill(t("ui.invoices.onlyInStock"), { qty: qty(l.product.stock), unit: l.product.unit })}</small>}
                  </td>
                  <td className="num">
                    {mode === "buy" || allowPrice
                      ? <input className={"input input--sm" + (errors[`items.${i}.unitCost`] || errors[`items.${i}.unitPrice`] ? " has-error" : "")} type="number" min="0" step="any" value={l.price} onChange={(e) => update(i, { price: e.target.value })} />
                      : m(l.price)}
                  </td>
                  <td className="num">{m((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>
                  <td><button type="button" className="icon-btn" aria-label={t("ui.common.remove")} onClick={() => onChange(lines.filter((_, k) => k !== i))}><Icon name="trash" /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan="3" className="num"><strong>{t("ui.common.subtotal")}</strong></td><td className="num"><strong>{m(total)}</strong></td><td /></tr></tfoot>
          </table>
        </div>
      )}
      <div className="lines__actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setCamera(true)}><span>{t("ui.pos.scan")}</span><Icon name="barcode" /></button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setPickSignal((n) => n + 1)}><span>{t("ui.invoices.addItem")}</span><Icon name="plus" /></button>
      </div>
      {camera && <CameraScanner onCode={onScan} onClose={() => setCamera(false)} />}
    </div>
  );
}
