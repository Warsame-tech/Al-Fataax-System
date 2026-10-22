import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, useErrorText, FormError, Money, EmptyState, Loading, SearchBox, StatusBadge, DateRange, daysAgo, isoDate, Modal } from "../ui.jsx";
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

/*
 * Register (POS): cart, totals, number keypad and a big PAYMENT button on the left;
 * search / scan, the scanned-item panel and the product grid on the right.
 * PAYMENT opens the payment screen (split payments, discount, rest on credit).
 */
function Register() {
  const { t } = useLanguage();
  const m = useMoney();
  const [q, setQ] = useState("");
  const products = useApi(`/api/products?q=${encodeURIComponent(q)}`);
  const customers = useApi("/api/customers");
  const [cart, setCart] = useState([]);
  const [selected, setSelected] = useState(null);   // highlighted cart line (product id)
  const [buffer, setBuffer] = useState("");         // digits typed on the keypad for the highlighted line
  const [customerId, setCustomerId] = useState("");
  const [notice, setNotice] = useState(null);
  const [scanned, setScanned] = useState(null);     // last scanned / picked product (details panel)
  const [camera, setCamera] = useState(false);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(null);
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
    setSelected(p.id);
    setBuffer("");
  };
  const setQty = (pid, v) => setCart((c) => c.map((l) => (l.product.id === pid ? { ...l, qty: Math.max(0, Math.min(v, l.product.stock)) } : l)).filter((l) => l.qty > 0));
  const removeLine = (pid) => {
    setCart((c) => {
      const next = c.filter((l) => l.product.id !== pid);
      setSelected(next.length ? next[next.length - 1].product.id : null);
      return next;
    });
    setBuffer("");
  };

  /* Keypad: digits replace the highlighted line's quantity; ⌫ deletes the last digit. */
  const press = (key) => {
    if (!selected) return;
    let next = buffer;
    if (key === "back") next = buffer.slice(0, -1);
    else if (key === ".") next = buffer.includes(".") ? buffer : (buffer || "0") + ".";
    else next = buffer + key;
    setBuffer(next);
    const n = Number(next);
    if (next && Number.isFinite(n) && n > 0) setQty(selected, n);
  };

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
  const customerList = customers.data?.customers || [];
  const customer = customerList.find((c) => String(c.id) === String(customerId)) || null;

  const reset = () => {
    setCart([]); setSelected(null); setBuffer(""); setCustomerId(""); setDone(null); setPaying(false); setScanned(null); setNotice(null);
    products.reload(); searchRef.current?.focus();
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

        <ul className="pos2__lines" aria-label={t("ui.pos.cart")}>
          {cart.length === 0 && <li className="pos2__empty"><Icon name="cart" /><span>{t("ui.pos.emptyCart")}</span></li>}
          {cart.map((l) => (
            <li key={l.product.id}>
              <button type="button" className={"pos2__line" + (selected === l.product.id ? " is-selected" : "")} aria-pressed={selected === l.product.id}
                onClick={() => { setSelected(l.product.id); setBuffer(""); }}>
                <span className="pos2__line-name">{l.product.name}</span>
                <span className="pos2__line-total">{m(l.qty * l.product.sellingPrice)}</span>
                <small>{fill(t("ui.pos.unitsAt"), { qty: qty(l.qty), price: m(l.product.sellingPrice) })}</small>
              </button>
            </li>
          ))}
        </ul>

        <dl className="pos2__totals">
          <div><dt>{t("ui.common.subtotal")}</dt><dd>{m(subtotal)}</dd></div>
          <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(subtotal)}</dd></div>
        </dl>

        <div className="keypad">
          <button type="button" className="keypad__clear" disabled={!selected} onClick={() => removeLine(selected)}>
            <Icon name="x" /><span>{t("ui.pos.clearItem")}</span>
          </button>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
            <button key={k} type="button" disabled={!selected} onClick={() => press(k)}>{k}</button>
          ))}
          <button type="button" disabled={!selected} onClick={() => press("back")} aria-label="⌫">⌫</button>
          <button type="button" disabled={!selected} onClick={() => press("0")}>0</button>
          <button type="button" disabled={!selected} onClick={() => press(".")}>.</button>
        </div>

        <button type="button" className="pos2__pay" disabled={!cart.length} onClick={() => setPaying(true)}>
          <span>{t("ui.pos.payment")}</span><Icon name="arrow-right" />
        </button>
      </aside>

      {/* ---------- right: search, scanner, products ---------- */}
      <section className="pos2__right">
        <div className="pos2__bar">
          <Link className="pos2__home" to="/app" aria-label={t("app.dashboard")}><Icon name="grid" /></Link>
          <div className="pos2__search">
            <Icon name="search-glass" />
            <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder={t("ui.pos.search")} aria-label={t("ui.pos.search")} />
          </div>
          <button type="button" className="pos2__scan" onClick={() => { setNotice(null); setCamera(true); }}>
            <Icon name="barcode" /><span>{t("ui.pos.scan")}</span>
          </button>
        </div>
        {notice && <p className="form-status form-status--error" role="alert">{notice}</p>}

        <ScannedItem product={scanned} inCart={cart.find((l) => l.product.id === scanned?.id)?.qty || 0} onAdd={() => add(scanned)} />

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

      {camera && <CameraScanner onCode={onCameraCode} onClose={() => { setCamera(false); searchRef.current?.focus(); }} />}

      {paying && (
        <PaymentModal cart={cart} subtotal={subtotal} customer={customer}
          onClose={() => setPaying(false)} onDone={(result) => { setPaying(false); setDone(result); }} />
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
function PaymentModal({ cart, subtotal, customer, onClose, onDone }) {
  const { t } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const errText = useErrorText();
  const banks = useApi("/api/accounts/banks");
  const sub = useSubmit();
  const [discount, setDiscount] = useState("");
  const [payments, setPayments] = useState([]);    // [{ key, method, bankAccountId, label, amount }]

  const r2 = (v) => Math.round(v * 100) / 100;
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = r2(subtotal - disc);
  const paid = r2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const remaining = r2(total - paid);
  const cashPaid = r2(payments.filter((p) => p.method === "cash").reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const change = remaining < 0 ? -remaining : 0;
  const changeOk = change === 0 || cashPaid >= change;
  const canConfirm = cart.length > 0 && changeOk && (remaining <= 0 || customer) && !sub.busy;

  const METHODS = [
    { key: "cash", method: "cash", label: t("ui.methods.cash"), icon: "wallet" },
    { key: "mobile_money", method: "mobile_money", label: t("ui.methods.mobile_money"), icon: "smartphone" },
    ...(banks.data?.banks || []).map((b) => ({ key: `bank-${b.id}`, method: "bank", bankAccountId: b.id, label: b.name, icon: "landmark" }))
  ];

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
      items: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
      customerId: customer?.id || null,
      discount: disc || 0,
      payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, bankAccountId: p.bankAccountId || null, amount: Number(p.amount) }))
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
                {can("sales.discount") ? (
                  <input className="input input--sm" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label={t("ui.common.discount")} />
                ) : <span className="paybox__lock" title={t("ui.pos.discountLocked")}><Icon name="lock" />{t("ui.pos.discountLocked")}</span>}
                <strong className="paybox__disc-amt">{disc > 0 ? `− ${m(disc)}` : m(0)}</strong>
              </dd>
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
              <button key={mm.key} type="button" onClick={() => addPayment(mm)}>
                <Icon name={mm.icon} /><span>{mm.label}</span><Icon name="plus" className="paybox__plus" />
              </button>
            ))}
          </div>
        </div>

        <div className="paybox__right">
          <h3>{t("ui.pos.applied")}</h3>
          {payments.length === 0 ? <p className="dash-empty">{t("ui.pos.noApplied")}</p> : (
            <ul className="paybox__applied">
              {payments.map((p) => (
                <li key={p.key}>
                  <span className="paybox__applied-name"><Icon name={p.icon} />{p.label}</span>
                  <input className="input input--sm" type="number" min="0" step="0.01" value={p.amount} onChange={(e) => setAmount(p.key, e.target.value)} aria-label={p.label} />
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
