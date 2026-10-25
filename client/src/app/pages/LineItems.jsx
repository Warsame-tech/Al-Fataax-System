import { useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { useApi, useMoney } from "../ui.jsx";
import { qty } from "../format.js";

/*
 * Editable product lines for invoices and purchases.
 * mode "sell": price from the chosen price list (editable only when allowPrice)
 * mode "buy":  unit cost entered per line (defaults to the product's cost price)
 */
export default function LineItems({ lines, onChange, mode = "sell", priceList = "retail", allowPrice = false, errors = {} }) {
  const { t } = useLanguage();
  const m = useMoney();
  const [pick, setPick] = useState("");
  const products = useApi("/api/products?location=default");
  const all = products.data?.products || [];

  const priceOf = (p) => (mode === "buy" ? p.costPrice : priceList === "wholesale" && p.wholesalePrice !== null ? p.wholesalePrice : p.sellingPrice);
  const add = (idv) => {
    const p = all.find((x) => String(x.id) === String(idv));
    if (!p) return;
    if (lines.some((l) => l.product.id === p.id)) return;
    onChange([...lines, { product: p, qty: 1, price: priceOf(p) }]);
    setPick("");
  };
  const update = (i, patch) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);

  return (
    <div className="lines">
      <div className="lines__add">
        <Icon name="search-glass" />
        <select className="input" value={pick} onChange={(e) => add(e.target.value)} aria-label={t("ui.invoices.addItem")}>
          <option value="">{t("ui.invoices.addItem")}…</option>
          {all.map((p) => (
            <option key={p.id} value={p.id} disabled={mode === "sell" && p.stock <= 0}>
              {p.name}{p.sku ? ` (${p.sku})` : ""} — {mode === "buy" ? m(p.costPrice) : m(priceOf(p))} · {qty(p.stock)} {p.unit}
            </option>
          ))}
        </select>
      </div>
      {errors.items && <span className="ff__error">{t("ui.errors.required")}</span>}
      {lines.length > 0 && (
        <div className="table-wrap">
          <table className="table table--compact lines__table">
            <thead><tr><th>{t("ui.common.product")}</th><th className="num">{t("ui.common.qty")}</th><th className="num">{mode === "buy" ? t("ui.common.unitCost") : t("ui.common.unitPrice")}</th><th className="num">{t("ui.common.total")}</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.product.id}>
                  <td>{l.product.name}{mode === "sell" && <small className="cell-sub">{qty(l.product.stock)} {l.product.unit}</small>}</td>
                  <td className="num"><input className={"input input--sm" + (errors[`items.${i}.qty`] ? " has-error" : "")} type="number" min="0" step="any" value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} /></td>
                  <td className="num">
                    {mode === "buy" || allowPrice
                      ? <input className={"input input--sm" + (errors[`items.${i}.unitCost`] || errors[`items.${i}.unitPrice`] ? " has-error" : "")} type="number" min="0" step="0.01" value={l.price} onChange={(e) => update(i, { price: e.target.value })} />
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
    </div>
  );
}
