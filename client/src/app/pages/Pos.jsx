import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, useErrorText, Field, FormError, Money, EmptyState, Loading, SearchBox, PaymentFields, StatusBadge, DateRange, daysAgo, isoDate, Modal } from "../ui.jsx";
import { fill, qty, date } from "../format.js";

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

function Register() {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const errText = useErrorText();
  const [q, setQ] = useState("");
  const products = useApi(`/api/products?q=${encodeURIComponent(q)}`);
  const customers = useApi("/api/customers");
  const [cart, setCart] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState("cash");
  const [bankId, setBankId] = useState("");
  const [received, setReceived] = useState("");
  const [paidMethod, setPaidMethod] = useState("cash");
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState(null);
  const [scanned, setScanned] = useState(null);   // last scanned / picked product (details panel)
  const [camera, setCamera] = useState(false);
  const sub = useSubmit();
  const searchRef = useRef(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const add = (p) => {
    setScanned(p);
    if (p.stock <= 0) { setNotice(fill(t("ui.errors.insufficientStock"), { product: p.name, available: qty(p.stock) })); return; }
    setNotice(null);
    setCart((c) => {
      const found = c.find((l) => l.product.id === p.id);
      if (found) return c.map((l) => (l.product.id === p.id ? { ...l, qty: Math.min(l.qty + 1, p.stock) } : l));
      return [...c, { product: p, qty: 1 }];
    });
  };
  const setQty = (id, v) => setCart((c) => c.map((l) => (l.product.id === id ? { ...l, qty: Math.max(0, Math.min(Number(v) || 0, l.product.stock)) } : l)).filter((l) => l.qty > 0));

  /* Barcode / SKU lookup — used by USB scanners (they type the code + Enter) and the camera. */
  const lookup = async (code) => {
    try {
      const { product } = await apiRequest(`/api/products/barcode/${encodeURIComponent(code)}`);
      add(product);
      return true;
    } catch {
      return false;
    }
  };
  const onSearchKey = async (e) => {
    if (e.key !== "Enter" || !q.trim()) return;
    e.preventDefault();
    if (await lookup(q.trim())) { setQ(""); return; }
    const list = products.data?.products || [];
    if (list.length === 1) { add(list[0]); setQ(""); } else setNotice(t("ui.pos.notFound"));
  };
  const onCameraCode = useCallback(async (code) => {
    setCamera(false);
    if (!(await lookup(code))) { setScanned(null); setNotice(`${t("ui.pos.notFound")} (${code})`); }
    searchRef.current?.focus();
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = useMemo(() => Math.round(cart.reduce((s, l) => s + l.qty * l.product.sellingPrice, 0) * 100) / 100, [cart]);
  const disc = Math.min(Number(discount) || 0, subtotal);
  const total = Math.round((subtotal - disc) * 100) / 100;
  const change = method !== "credit" && Number(received) > total ? Math.round((Number(received) - total) * 100) / 100 : 0;

  const reset = () => { setCart([]); setCustomerId(""); setDiscount(""); setReceived(""); setMethod("cash"); setBankId(""); setDone(null); setScanned(null); products.reload(); searchRef.current?.focus(); };

  const complete = async () => {
    const body = {
      items: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
      customerId: customerId || null, discount: disc || 0, paymentMethod: method, bankAccountId: bankId || null,
      amountReceived: method === "credit" ? (received || 0) : (received || total), paidMethod
    };
    const result = await sub.run(() => apiRequest("/api/sales", { method: "POST", body }));
    if (result) setDone(result);
  };

  const list = products.data?.products || [];
  return (
    <div className="pos">

      <aside className="pos__cart">
        <h2><Icon name="cart" />{t("ui.pos.cart")}</h2>
        {cart.length === 0 ? <p className="dash-empty">{t("ui.pos.emptyCart")}</p> : (
          <ul className="cart">
            {cart.map((l) => (
              <li key={l.product.id}>
                <div className="cart__name"><strong>{l.product.name}</strong><small>{m(l.product.sellingPrice)}</small></div>
                <div className="qty-ctl">
                  <button type="button" onClick={() => setQty(l.product.id, l.qty - 1)} aria-label="−"><Icon name="minus" /></button>
                  <input type="number" min="0" step="any" value={l.qty} onChange={(e) => setQty(l.product.id, e.target.value)} aria-label={t("ui.common.qty")} />
                  <button type="button" onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="+"><Icon name="plus" /></button>
                </div>
                <span className="cart__line">{m(l.qty * l.product.sellingPrice)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="pos__form">
          <Field label={`${t("ui.common.customer")} ${method === "credit" ? "" : t("ui.common.optional")}`} error={sub.fieldErrors.customerId}>
            <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">{t("ui.pos.walkIn")}</option>
              {(customers.data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={t("ui.common.discount")} error={sub.fieldErrors.discount} hint={!can("sales.discount") ? t("ui.pos.noDiscount") : null}>
            <input className="input" type="number" min="0" step="0.01" value={discount} disabled={!can("sales.discount")} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <PaymentFields method={method} onMethod={setMethod} bankId={bankId} onBank={setBankId} errors={sub.fieldErrors} allowCredit />
          {method === "credit" ? (
            <>
              <Field label={t("ui.pos.creditPaid")} error={sub.fieldErrors.amountReceived}><input className="input" type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} /></Field>
              {Number(received) > 0 && (
                <Field label={t("ui.pos.paidWith")}>
                  <div className="seg">{["cash", "mobile_money"].map((x) => <button key={x} type="button" aria-pressed={paidMethod === x} onClick={() => setPaidMethod(x)}>{t(`ui.methods.${x}`)}</button>)}</div>
                </Field>
              )}
            </>
          ) : (
            <Field label={t("ui.pos.received")} error={sub.fieldErrors.amountReceived}><input className="input" type="number" min="0" step="0.01" value={received} placeholder={String(total)} onChange={(e) => setReceived(e.target.value)} /></Field>
          )}
        </div>

        <dl className="pos__totals">
          <div><dt>{t("ui.common.subtotal")}</dt><dd>{m(subtotal)}</dd></div>
          {disc > 0 && <div><dt>{t("ui.common.discount")}</dt><dd>− {m(disc)}</dd></div>}
          <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(total)}</dd></div>
          {change > 0 && <div className="is-change"><dt>{t("ui.pos.change")}</dt><dd>{m(change)}</dd></div>}
        </dl>
        {sub.formError && sub.formError.code !== "validation" && <p className="form-status form-status--error" role="alert">{errText(sub.formError)}</p>}
        {sub.formError?.code === "validation" && <FormError error={sub.formError} />}
        <button type="button" className="btn btn--primary btn--lg btn--block" disabled={!cart.length || sub.busy} onClick={complete}>
          <Icon name="check" /><span>{fill(t("ui.pos.charge"), { amount: m(total) })}</span>
        </button>
      </aside>

      <section className="pos__products">
        <div className="pos__scanbar">
          <div className="pos__search">
            <Icon name="barcode" />
            <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder={t("ui.pos.search")} aria-label={t("ui.pos.search")} />
          </div>
          <button type="button" className="btn btn--primary pos__scanbtn" onClick={() => { setNotice(null); setCamera(true); }}>
            <Icon name="barcode" /><span>{t("ui.pos.scan")}</span>
          </button>
        </div>
        {notice && <p className="form-status form-status--error" role="alert">{notice}</p>}

        <ScannedItem product={scanned} inCart={cart.find((l) => l.product.id === scanned?.id)?.qty || 0} onAdd={() => add(scanned)} />

        {products.loading && !products.data ? <Loading /> : (
          <div className="pos__grid">
            {list.map((p) => (
              <button key={p.id} type="button" className={"pos-item" + (p.stock <= 0 ? " is-out" : "")} onClick={() => add(p)}>
                <span className="pos-item__img">{p.imagePath ? <img src={fileUrl(p.imagePath)} alt="" loading="lazy" /> : <Icon name="package" />}</span>
                <strong>{p.name}</strong>
                <span className="pos-item__price">{m(p.sellingPrice)}</span>
                <small>{p.stock <= 0 ? t("ui.pos.outOfStock") : fill(t("ui.pos.inStock"), { qty: qty(p.stock) })}</small>
              </button>
            ))}
            {list.length === 0 && <EmptyState icon="package" text={t("ui.common.noResults")} />}
          </div>
        )}
      </section>

      {camera && <CameraScanner onCode={onCameraCode} onClose={() => { setCamera(false); searchRef.current?.focus(); }} />}

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

/* Details of the last scanned / picked product: photo, prices and stock. */
function ScannedItem({ product: p, inCart, onAdd }) {
  const { t } = useLanguage();
  const m = useMoney();
  if (!p) return <div className="scan-card scan-card--empty"><Icon name="barcode" /><p>{t("ui.pos.scanEmpty")}</p></div>;
  const facts = [
    [t("ui.products.barcode"), p.barcode], [t("ui.products.sku"), p.sku], [t("ui.common.category"), p.category],
    [t("ui.products.brand"), p.brand], [t("ui.products.unit"), p.unit],
    [t("ui.products.wholesalePrice"), p.wholesalePrice === null ? null : m(p.wholesalePrice)]
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <article className="scan-card" aria-live="polite">
      <div className="scan-card__img">
        {p.imagePath ? <img src={fileUrl(p.imagePath)} alt={p.name} /> : <span><Icon name="package" /><small>{t("ui.pos.noPhoto")}</small></span>}
      </div>
      <div className="scan-card__body">
        <small className="scan-card__label">{t("ui.pos.scanned")}</small>
        <h3>{p.name}</h3>
        <p className="scan-card__price">{m(p.sellingPrice)}<small> / {p.unit}</small></p>
        <span className={"stock-pill" + (p.stock <= 0 ? " is-out" : p.stock <= p.minStock ? " is-low" : "")}>
          {p.stock <= 0 ? t("ui.pos.outOfStock") : fill(t("ui.pos.inStock"), { qty: qty(p.stock) })}
        </span>
        {facts.length > 0 && <dl className="scan-card__facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        <div className="scan-card__foot">
          {inCart > 0 && <span className="scan-card__incart"><Icon name="check" />{fill(t("ui.pos.inCart"), { qty: qty(inCart) })}</span>}
          <button type="button" className="btn btn--outline btn--sm" disabled={p.stock <= inCart} onClick={onAdd}><Icon name="plus" /><span>{t("ui.pos.addAnother")}</span></button>
        </div>
      </div>
    </article>
  );
}

/* Camera barcode scanner (ZXing, loaded only when opened). Needs https or localhost. */
function CameraScanner({ onCode, onClose }) {
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let controls = null;
    let stopped = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err, ctl) => {
          if (result && !stopped) { stopped = true; ctl.stop(); onCode(result.getText()); }
        });
        if (stopped) controls.stop();
      } catch {
        if (!stopped) setFailed(true);
      }
    })();
    return () => { stopped = true; controls?.stop(); };
  }, [onCode]);
  return (
    <Modal title={t("ui.pos.scanTitle")} onClose={onClose}>
      {failed ? <p className="form-status form-status--error" role="alert">{t("ui.pos.scanNoCamera")}</p> : (
        <div className="camera">
          <div className="camera__view">
            <video ref={videoRef} className="camera__video" muted playsInline />
            <span className="camera__frame" aria-hidden="true" />
          </div>
          <p className="modal__help">{t("ui.pos.scanHelp")}</p>
        </div>
      )}
    </Modal>
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
