import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, useErrorText, FormError, Money, EmptyState, Loading, SearchBox, StatusBadge, DateRange, daysAgo, isoDate, Modal } from "../ui.jsx";
import { fill, qty, date } from "../format.js";
import CameraScanner from "../CameraScanner.jsx";
import { VAT_RATE, vatOf } from "../vat.js";
import { useDraft, DraftBar } from "../Drafts.jsx";
import { unitsOf, unitsPer, packPrice } from "../packaging.js";
import { DevicePicker, deviceText } from "../Devices.jsx";

/* serial / IMEI products (electronics): a line is the exact devices chosen or scanned */
const tracked = (p) => Boolean(p?.tracking) && p.tracking !== "qty";

/* A cart line may be sold in a pack of the product (pharmacy: box, strip…); stock is counted in base units. */
const perOf = (l) => (l.unit ? unitsPer(l.product, l.unit) || 1 : 1);
const priceOf = (l) => (l.unit ? packPrice(l.product, l.unit) : l.product.sellingPrice);
const maxOf = (l) => Math.floor((l.product.stock / perOf(l)) * 1000 + 1e-6) / 1000;

export default function Pos() {
  const { t } = useLanguage();
  const can = usePerm();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "history" ? "history" : "sell";
  return (
    <div className="page">
      <PageHeader icon="cart" title={t("ui.pos.title")} />
      <Tabs value={tab} onChange={(id) => setParams(id === "history" ? { tab: "history" } : {})} tabs={[
        { id: "sell", label: t("ui.pos.newSale"), icon: "plus" },
        ...(can("sales.view") ? [{ id: "history", label: t("ui.pos.history"), icon: "history" }] : [])
      ]} />
      {tab === "sell" ? <Register /> : <History />}
    </div>
  );
}

/*
 * Register (POS): customer, barcode box, cart lines (− / + / ✕), totals and PAYMENT on the left;
 * search, scan and the product grid on the right.
 * A compact item card appears for a few seconds after each barcode scan.
 * PAYMENT opens the payment screen (split payments, discount, rest on credit).
 */
const SCAN_CARD_MS = 6000;

function Register() {
  const { t } = useLanguage();
  const unitLabel = (u) => (t(`ui.products.units.${u}`).startsWith("ui.") ? u : t(`ui.products.units.${u}`));
  const m = useMoney();
  const [q, setQ] = useState("");
  const products = useApi(`/api/products?location=default&q=${encodeURIComponent(q)}`);
  const customers = useApi("/api/customers");
  const [cart, setCart] = useState([]);
  const [addVat, setAddVat] = useState(false);      // optional 5% VAT, shown in the cart total and the payment screen
  const draft = useDraft("pos");
  const [active, setActive] = useState(null);       // highlighted cart line: the product just scanned / picked
  const [pulse, setPulse] = useState(0);            // re-runs the highlight animation on every scan
  const [code, setCode] = useState("");             // barcode / search box in the cart column
  const [customerId, setCustomerId] = useState("");
  const [notice, setNotice] = useState(null);
  const [scanned, setScanned] = useState(null);     // shown briefly after a scan
  const [camera, setCamera] = useState(false);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(null);
  const codeRef = useRef(null);
  const scanTimer = useRef(null);

  useEffect(() => { codeRef.current?.focus(); return () => clearTimeout(scanTimer.current); }, []);

  const showScanned = (p) => {
    clearTimeout(scanTimer.current);
    setScanned(p);
    scanTimer.current = setTimeout(() => setScanned(null), SCAN_CARD_MS);
  };
  /* n: units to add (1, or the units in a scanned packaging barcode, e.g. a box of 12) */
  const add = (p, n = 1) => {
    if (p.stock <= 0) { setNotice(fill(t("ui.errors.insufficientStock"), { product: p.name, available: qty(p.stock) })); return false; }
    if (tracked(p)) { setPicking(p); return true; }       // choose the exact device(s)
    const line = cart.find((l) => l.product.id === p.id);
    const inCart = line ? line.qty * perOf(line) : 0;
    setNotice(inCart + n > p.stock ? fill(t("ui.pos.packCapped"), { qty: qty(p.stock), unit: p.unit }) : null);
    setCart((c) => {
      const found = c.find((l) => l.product.id === p.id);
      if (found) return c.map((l) => (l.product.id === p.id ? { ...l, qty: Math.min(l.qty + (l.unit ? 1 : n), maxOf(l)) } : l));
      return [...c, { product: p, qty: Math.min(n, p.stock), unit: null }];
    });
    setActive(p.id);
    setPulse((n) => n + 1);
    return true;
  };
  const setQty = (pid, v) => setCart((c) => c.map((l) => (l.product.id === pid ? { ...l, qty: Math.max(0, Math.min(Number(v) || 0, maxOf(l))) } : l)).filter((l) => l.qty > 0));
  /* switching a line to another pack starts it at 1 of that pack (if the stock allows it) */
  const setUnit = (pid, unit) => setCart((c) => c.map((l) => {
    if (l.product.id !== pid) return l;
    const next = { ...l, unit: unit === l.product.unit ? null : unit };
    return { ...next, qty: Math.min(1, maxOf(next)) };
  }).filter((l) => l.qty > 0));
  const removeLine = (pid) => setCart((c) => c.filter((l) => l.product.id !== pid));
  /* the devices of a tracked line (from the picker or a scanned serial / IMEI) */
  const [picking, setPicking] = useState(null);
  const setDevices = (p, devices) => {
    setCart((c) => {
      const rest = c.filter((l) => l.product.id !== p.id);
      if (!devices.length) return rest;
      const line = { product: p, qty: devices.length, unit: null, deviceIds: devices.map((d) => d.id), devices };
      return c.some((l) => l.product.id === p.id) ? c.map((l) => (l.product.id === p.id ? line : l)) : [...rest, line];
    });
    setActive(p.id); setPulse((x) => x + 1); setNotice(null);
  };
  const addDevice = async (device) => {
    if (device.status !== "available") { setNotice(fill(t("ui.devices.notAvailable"), { device: deviceText(device), status: t(`ui.devices.status.${device.status}`) })); return true; }
    const { products: found } = await apiRequest(`/api/products?location=default&id=${device.productId}`);
    const p = found[0];
    if (!p) return false;
    const line = cart.find((l) => l.product.id === p.id);
    if (line?.deviceIds?.includes(device.id)) return true;
    setDevices(p, [...(line?.devices || []), device]);
    showScanned(p);
    return true;
  };

  /* Barcode / SKU lookup (USB scanner, camera, or typed code); falls back to a single name match. */
  const lookup = async (value) => {
    try {
      const { product, pack } = await apiRequest(`/api/products/barcode/${encodeURIComponent(value)}?location=default`);
      add(product, pack?.qty || 1); showScanned(product);
      return true;
    } catch {
      // a serial number / IMEI scanned: add that exact device
      try { const { device } = await apiRequest(`/api/devices/lookup/${encodeURIComponent(value)}`); if (device) return addDevice(device); } catch { /* not a device */ }
      try {
        const { products: found } = await apiRequest(`/api/products?location=default&q=${encodeURIComponent(value)}`);
        if (found.length === 1) { add(found[0]); showScanned(found[0]); return true; }
      } catch { /* ignore */ }
      return false;
    }
  };
  const onCodeKey = async (e) => {
    if (e.key !== "Enter" || !code.trim()) return;
    e.preventDefault();
    if (await lookup(code.trim())) setCode(""); else setNotice(`${t("ui.pos.notFound")} (${code.trim()})`);
  };
  const onCameraCode = useCallback(async (value) => {
    setCamera(false);
    if (!(await lookup(value))) setNotice(`${t("ui.pos.notFound")} (${value})`);
    codeRef.current?.focus();
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = useMemo(() => Math.round(cart.reduce((s, l) => s + l.qty * priceOf(l), 0) * 10000) / 10000, [cart]);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const customerList = customers.data?.customers || [];
  const customer = customerList.find((c) => String(c.id) === String(customerId)) || null;

  const cartVat = vatOf(addVat, subtotal);
  const reset = () => {
    setAddVat(false);
    setCart([]); setActive(null); setCustomerId(""); setDone(null); setPaying(false); setScanned(null); setNotice(null); setCode("");
    products.reload(); codeRef.current?.focus();
  };

  const list = products.data?.products || [];
  return (
    <div className="pos2">
      {/* ---------- left: cart ---------- */}
      <aside className="pos2__left">
        <select className="input pos2__customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label={t("ui.common.customer")}>
          <option value="">{t("ui.pos.walkInDefault")}</option>
          {customerList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div className="pos2__code">
          <Icon name="barcode" />
          <input ref={codeRef} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onCodeKey}
            placeholder={t("ui.pos.codePh")} aria-label={t("ui.pos.codePh")} autoComplete="off" />
        </div>

        <ul className="pos2__lines" aria-label={t("ui.pos.cart")}>
          {cart.length === 0 && <li className="pos2__empty"><Icon name="cart" /><span>{t("ui.pos.emptyCart")}</span></li>}
          {cart.map((l) => (
            <li key={active === l.product.id ? `${l.product.id}-${pulse}` : l.product.id} className={"pos2__line" + (active === l.product.id ? " is-active" : "")}
              onClick={() => setActive(l.product.id)} aria-current={active === l.product.id ? "true" : undefined}>
              <div className="pos2__line-top">
                <span className="pos2__line-name">{l.product.name}{l.product.rxRequired && <span className="rx-tag" title={t("ui.products.rxRequired")}>Rx</span>}</span>
                <span className="pos2__line-total">{m(l.qty * priceOf(l))}</span>
              </div>
              <div className="pos2__line-bottom">
                {unitsOf(l.product, "sell").length > 1 ? (
                  <span className="pos2__unit" onClick={(e) => e.stopPropagation()}>
                    <select value={l.unit || l.product.unit} onChange={(e) => setUnit(l.product.id, e.target.value)} aria-label={t("ui.pos.sellUnit")}>
                      {unitsOf(l.product, "sell").map((u) => <option key={u.name} value={u.name}>{u.name === l.product.unit ? unitLabel(u.name) : `${u.name} (${qty(u.per)})`}</option>)}
                    </select>
                    <small>{fill(t("ui.pos.atPrice"), { price: m(priceOf(l)) })}</small>
                  </span>
                ) : <small>{fill(t("ui.pos.unitsAt"), { qty: qty(l.qty), price: m(l.product.sellingPrice) })}</small>}
                {tracked(l.product) ? (
                  <div className="qty-ctl">
                    <button type="button" className="pos2__devbtn" onClick={(e) => { e.stopPropagation(); setPicking(l.product); }}><Icon name="smartphone" /> {fill(t("ui.devices.count"), { n: l.qty })}</button>
                    <button type="button" className="qty-ctl__x" onClick={() => removeLine(l.product.id)} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
                  </div>
                ) : <div className="qty-ctl">
                  <button type="button" onClick={() => setQty(l.product.id, l.qty - 1)} aria-label="−"><Icon name="minus" /></button>
                  <input type="number" min="0" step="any" value={l.qty} onChange={(e) => setQty(l.product.id, e.target.value)} aria-label={t("ui.common.qty")} />
                  <button type="button" onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="+"><Icon name="plus" /></button>
                  <button type="button" className="qty-ctl__x" onClick={() => removeLine(l.product.id)} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
                </div>}
              </div>
              {l.devices?.length > 0 && <ul className="pos2__devices">{l.devices.map((d) => <li key={d.id}>{deviceText(d)}</li>)}</ul>}
            </li>
          ))}
        </ul>

        <dl className="pos2__totals">
          <div><dt>{t("ui.common.subtotal")} · {fill(t("ui.pos.itemsCount"), { n: qty(itemCount) })}</dt><dd>{m(subtotal)}</dd></div>
          <div>
            <dt><label className="vat-switch vat-switch--small"><input type="checkbox" checked={addVat} onChange={(e) => setAddVat(e.target.checked)} />{fill(t("ui.pos.addVat"), { rate: VAT_RATE })}</label></dt>
            <dd>{addVat ? m(cartVat) : "—"}</dd>
          </div>
          <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(Math.round((subtotal + cartVat) * 10000) / 10000)}</dd></div>
        </dl>

        <DraftBar draft={draft} compact canSave={cart.length > 0}
          title={`${customer?.name || t("ui.pos.walkInDefault")} · ${fill(t("ui.pos.itemsCount"), { n: qty(itemCount) })} · ${m(subtotal)}`}
          getData={() => ({ customerId, addVat, cart: cart.map((l) => ({ product: l.product, qty: l.qty, unit: l.unit || null, deviceIds: l.deviceIds, devices: l.devices })) })}
          onLoad={(d) => { setCustomerId(d.customerId || ""); setAddVat(Boolean(d.addVat)); setCart(d.cart || []); setActive(null); }} />

        <button type="button" className="pos2__pay" disabled={!cart.length} onClick={() => setPaying(true)}>
          <span>{t("ui.pos.payment")}</span><Icon name="arrow-right" />
        </button>
      </aside>

      {/* ---------- right: search, scan, products ---------- */}
      <section className="pos2__right">
        <div className="pos2__bar">
          <Link className="pos2__home" to="/app" aria-label={t("app.dashboard")}><Icon name="grid" /></Link>
          <div className="pos2__search">
            <Icon name="search-glass" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui.pos.filterPh")} aria-label={t("ui.pos.filterPh")} />
          </div>
          <button type="button" className="pos2__scan" onClick={() => { setNotice(null); setCamera(true); }}>
            <Icon name="barcode" /><span>{t("ui.pos.scan")}</span>
          </button>
        </div>
        {notice && <p className="form-status form-status--error" role="alert">{notice}</p>}

        {scanned && (
          <ScannedItem product={scanned} inCart={cart.find((l) => l.product.id === scanned.id)?.qty || 0}
            onAdd={() => { add(scanned); showScanned(scanned); }} onClose={() => { clearTimeout(scanTimer.current); setScanned(null); }} />
        )}

        {products.loading && !products.data ? <Loading /> : (
          <div className="pos2__grid">
            {list.map((p) => (
              <button key={p.id} type="button" className={"pcard" + (p.stock <= 0 ? " is-out" : "")} onClick={() => add(p)}>
                {p.stock <= 0 && <span className="pcard__ribbon">{t("ui.pos.outRibbon")}</span>}
                <span className="pcard__img">{p.imagePath ? <img src={fileUrl(p.imagePath)} alt="" loading="lazy" /> : <Icon name="package" />}</span>
                <strong className="pcard__name">{p.name}</strong>
                <small className="pcard__qty">{fill(t("ui.pos.qtyLabel"), { qty: qty(p.stock) })}</small>
                <span className="pcard__price">{m(p.sellingPrice)}</span>
              </button>
            ))}
            {list.length === 0 && <EmptyState icon="package" text={t("ui.common.noResults")} />}
          </div>
        )}
      </section>

      {picking && (
        <DevicePicker product={picking} locationId="default" value={cart.find((l) => l.product.id === picking.id)?.deviceIds || []}
          onDone={(ids, devices) => { setDevices(picking, devices); setPicking(null); codeRef.current?.focus(); }} onClose={() => setPicking(null)} />
      )}
      {camera && <CameraScanner onCode={onCameraCode} onClose={() => { setCamera(false); codeRef.current?.focus(); }} />}

      {paying && (
        <PaymentModal cart={cart} subtotal={subtotal} customer={customer} addVat={addVat} setAddVat={setAddVat}
          onClose={() => setPaying(false)} onDone={(result) => { setPaying(false); setDone(result); draft.finish(); }} />
      )}

      {done && (
        <Modal title={t("ui.pos.done")} onClose={reset}>
          <div className="sale-done">
            <span className="sale-done__icon"><Icon name="check" /></span>
            <p>{t("ui.pos.receiptNo")}: <strong>{done.receiptNo}</strong></p>
            <p className="sale-done__total">{m(done.total)}</p>
            {done.change > 0 && <p>{t("ui.pos.change")}: <strong>{m(done.change)}</strong></p>}
            <div className="form-actions">
              <Link className="btn btn--outline" to={`/app/sales/${done.id}`}><Icon name="printer" /><span>{t("ui.pos.receipt")}</span></Link>
              <button type="button" className="btn btn--primary" onClick={reset}><Icon name="plus" /><span>{t("ui.pos.newSale")}</span></button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/*
 * Payment screen. Left: totals (subtotal, discount, total due, total paid, remaining)
 * and the payment methods to click (cash, mobile money, each bank account).
 * Right: the applied payments (amount editable, removable) and Confirm order.
 * Paying more than the total gives change from cash; paying less leaves the rest
 * on credit for the chosen customer.
 */
function PaymentModal({ cart, subtotal, customer, addVat, setAddVat, onClose, onDone }) {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const errText = useErrorText();
  const methodsApi = useApi("/api/payment-methods");   // the business's own methods (Settings → Payment methods)
  const sub = useSubmit();
  const [discount, setDiscount] = useState("");
  const [discMode, setDiscMode] = useState("percent"); // "percent" | "amount"
  const [payments, setPayments] = useState([]);    // [{ key, paymentMethodId, kind, label, amount }]

  const r2 = (v) => Math.round(v * 10000) / 10000;   // money to 4 decimals (exact VAT)
  const discValue = Math.max(Number(discount) || 0, 0);
  const disc = discMode === "percent" ? r2(subtotal * Math.min(discValue, 100) / 100) : Math.min(discValue, subtotal);
  const vat = vatOf(addVat, r2(subtotal - disc));
  const total = r2(subtotal - disc + vat);
  const paid = r2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const remaining = r2(total - paid);
  const cashPaid = r2(payments.filter((p) => p.kind === "cash").reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const change = remaining < 0 ? -remaining : 0;
  const changeOk = change === 0 || cashPaid >= change;
  const canConfirm = cart.length > 0 && changeOk && (remaining <= 0 || customer) && !sub.busy;

  const METHODS = (methodsApi.data?.methods || []).map((pm) => ({ key: `pm-${pm.id}`, paymentMethodId: pm.id, kind: pm.kind, label: pm.label }));

  const addPayment = (mm) => setPayments((list) => {
    const due = r2(total - list.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const existing = list.find((p) => p.key === mm.key);
    if (existing) return list.map((p) => (p.key === mm.key ? { ...p, amount: String(r2((Number(p.amount) || 0) + Math.max(due, 0))) } : p));
    return [...list, { ...mm, amount: String(Math.max(due, 0)) }];
  });
  const setAmount = (key, v) => setPayments((list) => list.map((p) => (p.key === key ? { ...p, amount: v } : p)));
  const remove = (key) => setPayments((list) => list.filter((p) => p.key !== key));

  const confirm = async () => {
    const body = {
      items: cart.map((l) => ({ productId: l.product.id, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), ...(l.deviceIds ? { deviceIds: l.deviceIds } : {}) })),
      customerId: customer?.id || null,
      discount: disc || 0,
      vat: addVat,
      payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.paymentMethodId, amount: Number(p.amount) }))
    };
    const result = await sub.run(() => apiRequest("/api/sales", { method: "POST", body }));
    if (result) onDone(result);
  };

  return (
    <Modal title={t("ui.pos.payTitle")} onClose={onClose} wide>
      <div className="paybox">
        <div className="paybox__left">
          <dl className="paybox__sum">
            <div><dt>{t("ui.common.subtotal")}</dt><dd>{m(subtotal)}</dd></div>
            <div className="paybox__disc">
              <dt>{t("ui.common.discount")}</dt>
              <dd>
                <span className={"disc-box" + (can("sales.discount") ? "" : " is-locked")}>
                  <input type="number" min="0" max={discMode === "percent" ? 100 : undefined} step={discMode === "percent" ? "1" : "0.01"} value={discount}
                    disabled={!can("sales.discount")} onChange={(e) => setDiscount(e.target.value)} aria-label={t("ui.common.discount")} />
                  <button type="button" disabled={!can("sales.discount")} onClick={() => setDiscMode((x) => (x === "percent" ? "amount" : "percent"))}
                    title={t(discMode === "percent" ? "ui.pos.discPercent" : "ui.pos.discAmount")}>
                    {discMode === "percent" ? <Icon name="percent" /> : "$"}
                  </button>
                </span>
                {!can("sales.discount") && <span className="paybox__lock" title={t("ui.pos.discountLocked")}><Icon name="lock" />{t("ui.pos.locked")}</span>}
                <strong className="paybox__disc-amt">{disc > 0 ? `− ${m(disc)}` : m(0)}</strong>
              </dd>
            </div>
            <div className="paybox__vat">
              <dt>
                <label className="vat-switch">
                  <input type="checkbox" checked={addVat} onChange={(e) => setAddVat(e.target.checked)} />
                  {fill(t("ui.pos.addVat"), { rate: VAT_RATE })}
                </label>
              </dt>
              <dd>{addVat ? m(vat) : "—"}{addVat && <small className="paybox__vat-base">{fill(t("ui.pos.vatOf"), { rate: VAT_RATE, amount: m(r2(subtotal - disc)) })}</small>}</dd>
            </div>
            <div><dt>{t("ui.pos.totalDue")}</dt><dd>{m(total)}</dd></div>
            <div><dt>{t("ui.pos.totalPaid")}</dt><dd>{m(paid)}</dd></div>
            <div className="paybox__remaining">
              <dt>{change > 0 ? t("ui.pos.changeDue") : t("ui.pos.remaining")}</dt>
              <dd className={change > 0 ? "is-change" : remaining > 0 ? "is-due" : "is-ok"}>{m(change > 0 ? change : Math.max(remaining, 0))}</dd>
            </div>
          </dl>

          <p className="paybox__label">{t("ui.pos.addMethod")}</p>
          <div className="paybox__methods">
            {METHODS.map((mm) => (
              <button key={mm.key} type="button" onClick={() => addPayment(mm)}><span>{mm.label}</span></button>
            ))}
            {methodsApi.data && METHODS.length === 0 && <p className="dash-empty">{t("ui.pos.noMethods")}</p>}
          </div>
        </div>

        <div className="paybox__right">
          <h3>{t("ui.pos.applied")}</h3>
          {payments.length === 0 ? <p className="dash-empty">{t("ui.pos.noApplied")}</p> : (
            <ul className="paybox__applied">
              {payments.map((p) => (
                <li key={p.key}>
                  <span className="paybox__applied-name">{p.label}</span>
                  <input className="input input--sm" type="number" min="0" step="any" value={p.amount} onChange={(e) => setAmount(p.key, e.target.value)} aria-label={p.label} />
                  <button type="button" className="icon-btn" onClick={() => remove(p.key)} aria-label={t("ui.common.remove")}><Icon name="x" /></button>
                </li>
              ))}
            </ul>
          )}

          {remaining > 0 && (customer
            ? <p className="paybox__note"><Icon name="info" />{fill(t("ui.pos.restOnCredit"), { name: customer.name })}</p>
            : payments.length > 0 && <p className="paybox__note is-warn"><Icon name="alert" />{t("ui.pos.needCustomer")}</p>)}
          {!changeOk && <p className="paybox__note is-warn"><Icon name="alert" />{t("ui.errors.changeNeedsCash")}</p>}
          {sub.formError && sub.formError.code !== "validation" && <p className="form-status form-status--error" role="alert">{errText(sub.formError)}</p>}
          {sub.formError?.code === "validation" && <FormError error={sub.formError} />}

          <button type="button" className="paybox__confirm" disabled={!canConfirm} onClick={confirm}>
            <span>{sub.busy ? t("ui.common.saving") : t("ui.pos.confirm")}</span><Icon name="check" />
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* Compact card shown for a few seconds after a scan: photo, name, price, stock, codes, in-cart count. */
function ScannedItem({ product: p, inCart, onAdd, onClose }) {
  const { t } = useLanguage();
  const m = useMoney();
  const codes = [p.barcode, p.sku, p.category, p.brand].filter(Boolean).join(" · ");
  return (
    <article className="scan-mini" aria-live="polite">
      <span className="scan-mini__img">{p.imagePath ? <img src={fileUrl(p.imagePath)} alt="" /> : <Icon name="package" />}</span>
      <div className="scan-mini__body">
        <small className="scan-mini__label">{t("ui.pos.scanned")}</small>
        <strong className="scan-mini__name">{p.name}</strong>
        {codes && <small className="scan-mini__codes">{codes}</small>}
      </div>
      <div className="scan-mini__price">
        <strong>{m(p.sellingPrice)}<small> / {p.unit}</small></strong>
        {p.wholesalePrice !== null && <small>{t("ui.products.wholesalePrice")}: {m(p.wholesalePrice)}</small>}
      </div>
      <div className="scan-mini__side">
        <span className={"stock-pill" + (p.stock <= 0 ? " is-out" : p.stock <= p.minStock ? " is-low" : "")}>
          {p.stock <= 0 ? t("ui.pos.outOfStock") : fill(t("ui.pos.inStock"), { qty: qty(p.stock) })}
        </span>
        {inCart > 0 && <span className="scan-mini__incart"><Icon name="check" />{fill(t("ui.pos.inCart"), { qty: qty(inCart) })}</span>}
      </div>
      <button type="button" className="btn btn--outline btn--sm" disabled={p.stock <= inCart} onClick={onAdd}><Icon name="plus" /><span>{t("ui.pos.addAnother")}</span></button>
      <button type="button" className="icon-btn" onClick={onClose} aria-label={t("ui.common.close")}><Icon name="x" /></button>
    </article>
  );
}

function History() {
  const { t, lang } = useLanguage();
  const [range, setRange] = useState({ from: daysAgo(6), to: isoDate(new Date()) });
  const [q, setQ] = useState("");
  const list = useApi(`/api/sales?${new URLSearchParams({ ...range, q })}`);
  const rows = list.data?.sales || [];
  return (
    <>
      <div className="toolbar"><DateRange value={range} onChange={setRange} /><SearchBox value={q} onChange={setQ} /></div>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="cart" text={t("ui.common.noResults")} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("ui.pos.receiptNo")}</th><th>{t("ui.common.date")}</th><th>{t("ui.common.customer")}</th><th>{t("ui.pos.cashier")}</th><th>{t("ui.common.method")}</th><th className="num">{t("ui.common.total")}</th><th>{t("ui.common.status")}</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/app/sales/${s.id}`}>{s.number}</Link></td>
                  <td>{date(s.at, lang, true)}</td>
                  <td>{s.customer || "—"}</td>
                  <td>{s.cashier}</td>
                  <td>{t(`ui.methods.${s.method}`)}</td>
                  <td className="num"><Money value={s.total} /></td>
                  <td><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
