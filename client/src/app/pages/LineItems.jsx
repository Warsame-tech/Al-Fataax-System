import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { useApi, useMoney, usePerm } from "../ui.jsx";
import { fill, qty } from "../format.js";
import SearchSelect from "../SearchSelect.jsx";
import CameraScanner from "../CameraScanner.jsx";
import { BatchFields } from "./Stock.jsx";
import { unitsOf, unitsPer, packPrice, breakdown } from "../packaging.js";
import { DeviceEntry, DevicePicker, deviceText } from "../Devices.jsx";
import { isRoll, YARD, RollEntry, RollPicker, rollsDeclared, lengthText } from "../Fabric.jsx";

const tracked = (p) => ["serial", "imei", "serial_imei"].includes(p?.tracking);
const q4 = (v) => Math.round(Number(v) * 10000) / 10000;

/*
 * Editable product lines for invoices and purchases.
 * mode "sell": price from the chosen price list (editable only when allowPrice);
 *              the quantity can never be more than the stock on hand
 * mode "buy":  unit cost entered per line (defaults to the product's cost price); batch no + expiry for products that track batches
 * Packaged products (pharmacy): a line has a unit — a sales unit when selling (box, strip, tablet), a purchase unit when
 * buying (carton, box) — and its price / cost is per that unit; the stock it uses is qty × units per pack (base units).
 * Fabric sold from rolls: selling, each line is cut from a chosen roll (rollId) by the meter, the yard or the whole roll,
 * and can't be more than the roll has (the same product may be on several lines, one per roll); buying, the line is in
 * meters or yards and, when received now, its rolls are entered (declared / verified length).
 * Under the lines: "Scan barcode" (camera) and "Add item" (opens the product list to choose another product).
 */
/* deviceEntry (buying): the goods are received now, so serial numbers / IMEIs of tracked products are typed per unit */
export default function LineItems({ lines, onChange, mode = "sell", priceList = "retail", allowPrice = false, errors = {}, deviceEntry = false }) {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const products = useApi("/api/products?location=default");
  const all = products.data?.products || [];
  const [camera, setCamera] = useState(false);
  const [pickSignal, setPickSignal] = useState(0);   // "Add item" opens the product list
  const [notice, setNotice] = useState(null);      // { text, kind, link? }
  const [picking, setPicking] = useState(null);    // line index choosing devices (selling)
  const [rollFor, setRollFor] = useState(null);    // { product, index? } choosing a roll (selling)

  const sell = mode === "sell";
  const basePrice = (p) => (priceList === "wholesale" && p.wholesalePrice !== null ? p.wholesalePrice : p.sellingPrice);
  const priceOf = (p, unit = null, roll = null) => {
    if (isRoll(p)) {
      const per = unit === "yard" ? YARD : unit === "roll" ? roll?.remaining || 0 : 1;
      return q4((mode === "buy" ? p.costPrice : basePrice(p)) * per);
    }
    if (mode === "buy") return Math.round(p.costPrice * (unit ? unitsPer(p, unit) || 1 : 1) * 10000) / 10000;
    const base = basePrice(p);
    if (!unit) return base;
    // wholesale: base wholesale price × units in the pack (a pack's own price is its retail price) — same rule as the server
    return priceList === "wholesale" && p.wholesalePrice !== null ? Math.round(base * (unitsPer(p, unit) || 1) * 10000) / 10000 : packPrice(p, unit, base);
  };
  // rolls: meters (base), yards, or (selling) the whole roll
  const unitList = (p) => (isRoll(p) ? [{ name: p.unit }, { name: "yard" }, ...(sell ? [{ name: "roll" }] : [])] : unitsOf(p, sell ? "sell" : "buy"));
  const perOf = (l) => (isRoll(l.product) ? (l.unit === "yard" ? YARD : l.unit === "roll" ? l.roll?.remaining || 1 : 1) : l.unit ? unitsPer(l.product, l.unit) || 1 : 1);
  const available = (l) => (isRoll(l.product) && sell ? l.roll?.remaining ?? 0 : l.product.stock);
  const unitLabel = (u) => (t(`ui.products.units.${u}`).startsWith("ui.") ? u : t(`ui.products.units.${u}`));
  const addProduct = (p) => {
    if (!p) return;
    if (!(isRoll(p) && sell) && lines.some((l) => l.product.id === p.id)) return setNotice({ text: fill(t("ui.invoices.alreadyAdded"), { name: p.name }), kind: "info" });
    if (sell && p.stock <= 0) return setNotice({ text: fill(t("ui.invoices.noStock"), { name: p.name }), kind: "error", link: can("stock.add") });
    setNotice(null);
    // selling fabric: choose the roll the cut comes from
    if (sell && isRoll(p)) { setRollFor({ product: p }); return; }
    // selling a serial / IMEI product: choose its exact devices right away
    if (sell && tracked(p)) { onChange([...lines, { product: p, qty: 0, unit: null, price: priceOf(p), deviceIds: [], devices: [] }]); setPicking(lines.length); return; }
    // buying a packaged product starts in its largest purchase unit (e.g. carton); selling starts in the base unit
    const unit = !sell && !isRoll(p) && unitList(p).length > 1 ? unitList(p)[0].name : null;
    onChange([...lines, { product: p, qty: 1, unit, price: priceOf(p, unit), ...(isRoll(p) ? { rolls: { unit: "meter", rolls: [] } } : {}) }]);
  };
  const chooseRoll = (roll) => {
    const { product, index } = rollFor;
    setRollFor(null);
    if (index !== undefined) return onChange(lines.map((l, k) => (k === index ? { ...l, rollId: roll.id, roll, qty: l.unit === "roll" ? 1 : Math.min(Number(l.qty) || 0, roll.remaining), price: priceOf(product, l.unit, roll) } : l)));
    onChange([...lines, { product, rollId: roll.id, roll, qty: "", unit: null, price: priceOf(product, null, roll) }]);
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
    disabled: (sell && p.stock <= 0) || (!(isRoll(p) && sell) && lines.some((l) => l.product.id === p.id))
  }));
  const maxOf = (l) => Math.floor((available(l) / perOf(l)) * 10000 + 1e-6) / 10000;
  /* selling: the quantity is capped at the stock on hand (fabric: what is left on the roll) */
  const setQty = (i, value) => {
    const l = lines[i];
    const max = maxOf(l);
    const over = sell && value !== "" && Number(value) > max;
    update(i, { qty: over ? String(max) : value, capped: over });
  };
  const setUnit = (i, name) => {
    const l = lines[i];
    const unit = name === l.product.unit ? null : name;
    const next = { ...l, unit, price: priceOf(l.product, unit, l.roll), capped: false };
    if (unit === "roll") next.qty = 1;
    const max = maxOf(next);
    onChange(lines.map((x, k) => (k === i ? { ...next, qty: sell && Number(next.qty) > max ? String(max) : next.qty } : x)));
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
                <tr key={`${l.product.id}-${l.rollId || ""}`}>
                  <td>
                    {l.product.name}
                    {sell && isRoll(l.product) && l.roll ? (
                      <small className="cell-sub">
                        <button type="button" className={"link-btn" + (errors[`items.${i}.rollId`] ? " is-neg" : "")} onClick={() => setRollFor({ product: l.product, index: i })}><Icon name="roll" /> {l.roll.code}</button> · {fill(t("ui.fabric.left"), { len: lengthText(l.roll.remaining) })}
                      </small>
                    ) : sell && <small className="cell-sub">{fill(t("ui.invoices.inStock"), { qty: qty(l.product.stock), unit: l.product.unit })}</small>}
                    {!sell && l.product.trackBatches && <BatchFields compact value={l} onChange={(patch) => update(i, patch)} />}
                    {sell && l.devices?.length > 0 && <ul className="pos2__devices">{l.devices.map((d) => <li key={d.id}>{deviceText(d)}</li>)}</ul>}
                    {!sell && deviceEntry && tracked(l.product) && (
                      <DeviceEntry tracking={l.product.tracking} qty={Number.isInteger(Number(l.qty)) ? Number(l.qty) : 0} value={l.devices || []}
                        onChange={(devices) => update(i, { devices })} errors={errors} field={`items.${i}.devices`} />
                    )}
                    {!sell && deviceEntry && isRoll(l.product) && (
                      <RollEntry value={l.rolls || { rolls: [] }} unitFixed={l.unit === "yard" ? "yard" : "meter"} errors={errors} field={`items.${i}.rolls`}
                        onChange={(v) => update(i, { rolls: v, qty: v.rolls.length ? String(rollsDeclared(v)) : l.qty })} />
                    )}
                  </td>
                  <td className="num">
                    {sell && tracked(l.product) ? (
                      <button type="button" className={"btn btn--outline btn--sm" + (errors[`items.${i}.deviceIds`] ? " has-error" : "")} onClick={() => setPicking(i)}>
                        <Icon name="smartphone" /><span>{fill(t("ui.devices.count"), { n: (l.deviceIds || []).length })}</span>
                      </button>
                    ) : <div className="lines__qty">
                      <input className={"input input--sm" + (errors[`items.${i}.qty`] || l.capped ? " has-error" : "")} type="number" min="0" step={tracked(l.product) ? "1" : "any"}
                        max={sell ? maxOf(l) : undefined} value={l.qty} onChange={(e) => setQty(i, e.target.value)} disabled={l.unit === "roll" || (!sell && deviceEntry && isRoll(l.product) && l.rolls?.rolls.length > 0)} />
                      {unitList(l.product).length > 1 && (
                        <select className={"input input--sm" + (errors[`items.${i}.unit`] ? " has-error" : "")} value={l.unit || l.product.unit} onChange={(e) => setUnit(i, e.target.value)} aria-label={t("ui.products.unit")}>
                          {unitList(l.product).map((u) => <option key={u.name} value={u.name}>{isRoll(l.product) && u.name === "roll" ? t("ui.fabric.wholeRoll") : u.name === l.product.unit || isRoll(l.product) ? unitLabel(u.name) : u.name}</option>)}
                        </select>
                      )}
                    </div>}
                    {l.unit && !isRoll(l.product) && Number(l.qty) > 0 && <small className="cell-sub lines__chain">{breakdown(l.product, l.unit, l.qty, unitLabel)}</small>}
                    {isRoll(l.product) && l.unit && Number(l.qty) > 0 && <small className="cell-sub lines__chain">= {qty(q4(Number(l.qty) * perOf(l)))} m</small>}
                    {sell && l.capped && <small className="ff__error lines__cap">{isRoll(l.product) ? fill(t("ui.fabric.onlyOnRoll"), { len: lengthText(available(l)) }) : fill(t("ui.invoices.onlyInStock"), { qty: qty(l.product.stock), unit: unitLabel(l.product.unit) })}</small>}
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
      {picking !== null && lines[picking] && (
        <DevicePicker product={lines[picking].product} locationId="default" value={lines[picking].deviceIds || []}
          onDone={(ids, devices) => { update(picking, { deviceIds: ids, devices, qty: ids.length }); setPicking(null); }} onClose={() => setPicking(null)} />
      )}
      {rollFor && (
        <RollPicker product={rollFor.product} onClose={() => setRollFor(null)} onDone={(ids, rolls) => chooseRoll(rolls[0])}
          filter={(r) => !lines.some((l, k) => l.rollId === r.id && k !== rollFor.index)} />
      )}
    </div>
  );
}

/** API items for selling lines (invoices): rolls send the roll and the unit (yard / roll). */
export const sellItems = (lines, allowPrice) => lines.map((l) => ({ productId: l.product.id, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}),
  ...(l.deviceIds ? { deviceIds: l.deviceIds } : {}), ...(l.rollId ? { rollId: l.rollId } : {}), ...(allowPrice ? { unitPrice: l.price } : {}) }));
