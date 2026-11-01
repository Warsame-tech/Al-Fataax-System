import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../services/api.js";
import { money, fill, date } from "../app/format.js";

/*
 * Online ordering for customers (no sign-in): /order/:code — the business's menu, sizes / extras / "no …", cart and
 * checkout (takeaway or delivery, contact, how they will pay); /order/:code/track/:tracking — the order's status.
 * Server: routes/public.js. Orders appear in the business's order list (Tables & orders) for staff to accept.
 */
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;

export default function OnlineOrder() {
  const { code } = useParams();
  const { t, lang, setLang } = useLanguage();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [cat, setCat] = useState("");
  const [cart, setCart] = useState([]);
  const [picking, setPicking] = useState(null);
  const [checkout, setCheckout] = useState(false);
  useEffect(() => { apiRequest(`/api/public/menu/${code}`).then(setD).catch((e) => setError(e)); }, [code]);
  if (error) return <div className="om om--msg"><Icon name="lock" /><p>{t("ui.online.closed")}</p></div>;
  if (!d) return <div className="om om--msg"><span className="app-spinner" /></div>;
  const m = (v) => money(v, d.business.currency, lang);
  const cats = [...new Set(d.items.map((x) => x.category || t("ui.food.noCategory")))];
  const shown = d.items.filter((x) => !cat || (x.category || t("ui.food.noCategory")) === cat);
  const total = r4(cart.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const add = (x, c = {}) => {
    const size = c.size ? x.sizes.find((s) => s.name === c.size) : null;
    const extras = c.extras || [];
    setCart((list) => [...list, { key: `${x.id}-${Date.now()}`, item: x, qty: c.qty || 1, size: size?.name || null, extras, removed: c.removed || [], notes: c.notes || "",
      unitPrice: r4((size ? size.price : x.price) + extras.reduce((s, e) => s + e.price, 0)) }]);
  };
  const setQty = (key, n) => setCart((list) => list.map((l) => (l.key === key ? { ...l, qty: n } : l)).filter((l) => l.qty > 0));
  return (
    <div className="om">
      <header className="om__head">
        {d.business.logoPath && <img src={fileUrl(d.business.logoPath)} alt="" />}
        <div><h1>{d.business.name}</h1>{d.settings.message && <p>{d.settings.message}</p>}{d.business.phone && <small><Icon name="phone" /> {d.business.phone}</small>}</div>
        <button type="button" className="om__lang" onClick={() => setLang(lang === "en" ? "so" : "en")}>{lang === "en" ? "SO" : "EN"}</button>
      </header>
      <nav className="fpos-cats om__cats">
        <button type="button" className={!cat ? "is-on" : ""} onClick={() => setCat("")}>{t("ui.common.all")}</button>
        {cats.map((c) => <button key={c} type="button" className={cat === c ? "is-on" : ""} onClick={() => setCat(c)}>{c}</button>)}
      </nav>
      <main className="om__grid">
        {shown.map((x) => (
          <button key={x.id} type="button" className={"om__item" + (!x.available ? " is-out" : "")} disabled={!x.available}
            onClick={() => (x.sizes.length || x.extras.length || x.optional.length ? setPicking(x) : add(x))}>
            <span className="om__img">{x.imagePath ? <img src={fileUrl(x.imagePath)} alt="" loading="lazy" /> : <Icon name="utensils" />}</span>
            <strong>{x.name}</strong>
            {x.description && <small>{x.description}</small>}
            <span className="om__price">{!x.available ? t("ui.food.soldOut") : m(x.sizes.length ? Math.min(...x.sizes.map((s) => s.price)) : x.price)}</span>
          </button>
        ))}
      </main>
      {cart.length > 0 && !checkout && (
        <div className="om__bar">
          <span>{fill(t("ui.online.itemsN"), { n: cart.reduce((s, l) => s + l.qty, 0) })} · <strong>{m(total)}</strong></span>
          <button type="button" className="btn btn--primary" onClick={() => setCheckout(true)}>{t("ui.online.checkout")}<Icon name="arrow-right" /></button>
        </div>
      )}
      {picking && <Choice item={picking} m={m} onClose={() => setPicking(null)} onAdd={(c) => { add(picking, c); setPicking(null); }} />}
      {checkout && <Checkout code={code} d={d} m={m} cart={cart} total={total} setQty={setQty} onClose={() => setCheckout(false)} />}
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal__box" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head"><h2>{title}</h2><button type="button" className="modal__x" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

function Choice({ item, m, onClose, onAdd }) {
  const { t } = useLanguage();
  const [size, setSize] = useState(item.sizes[0]?.name || null);
  const [extras, setExtras] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [notes, setNotes] = useState("");
  const [n, setN] = useState(1);
  const price = r4((size ? item.sizes.find((s) => s.name === size).price : item.price) + extras.reduce((s, e) => s + e.price, 0));
  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="form-grid item-choice">
        {item.sizes.length > 0 && <div className="seg">{item.sizes.map((s) => <button key={s.name} type="button" aria-pressed={size === s.name} onClick={() => setSize(s.name)}>{s.name} · {m(s.price)}</button>)}</div>}
        {item.extras.length > 0 && <div className="chip-pick">{item.extras.map((x) => <button key={x.id} type="button" aria-pressed={extras.some((e) => e.id === x.id)} onClick={() => setExtras(extras.some((e) => e.id === x.id) ? extras.filter((e) => e.id !== x.id) : [...extras, x])}>+ {x.name} · {m(x.price)}</button>)}</div>}
        {item.optional.length > 0 && <div className="chip-pick">{item.optional.map((x) => <button key={x.lineId} type="button" aria-pressed={removed.some((r) => r.lineId === x.lineId)} onClick={() => setRemoved(removed.some((r) => r.lineId === x.lineId) ? removed.filter((r) => r.lineId !== x.lineId) : [...removed, x])}>{fill(t("ui.food.without"), { name: x.name })}</button>)}</div>}
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("ui.food.instructionsPh")} maxLength={255} />
        <div className="item-choice__foot">
          <div className="qty-ctl"><button type="button" onClick={() => setN(Math.max(1, n - 1))} aria-label="−"><Icon name="minus" /></button><input type="number" min="1" value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} /><button type="button" onClick={() => setN(n + 1)} aria-label="+"><Icon name="plus" /></button></div>
          <button type="button" className="btn btn--primary" onClick={() => onAdd({ size, extras, removed, notes: notes.trim(), qty: n })}>{fill(t("ui.food.addFor"), { price: m(price * n) })}</button>
        </div>
      </div>
    </Sheet>
  );
}

function Checkout({ code, d, m, cart, total, setQty, onClose }) {
  const { t } = useLanguage();
  const s = d.settings;
  const [f, setF] = useState({ service: s.services[0], name: "", phone: "", address: "", payment: s.payments[0], notes: "" });
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const fee = f.service === "delivery" ? s.deliveryFee : 0;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setErr(null);
    try {
      const r = await apiRequest(`/api/public/orders/${code}`, { method: "POST", body: { ...f, items: cart.map((l) => ({ productId: l.item.id, qty: l.qty, size: l.size || undefined, extras: l.extras.map((x) => x.id), removed: l.removed.map((x) => x.lineId), notes: l.notes || undefined })) } });
      setDone(r);
    } catch (x) { setErrors(x.errors || {}); setErr(x); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <Sheet title={t("ui.online.thanks")} onClose={() => window.location.reload()}>
        <div className="sale-done">
          <span className="sale-done__icon"><Icon name="check" /></span>
          <p>{t("ui.online.orderNo")}: <strong>{done.number}</strong></p>
          <p className="sale-done__total">{m(done.total)}</p>
          <p className="muted">{t("ui.online.waitConfirm")}</p>
          <Link className="btn btn--primary" to={`/order/${code}/track/${done.tracking}`}>{t("ui.online.track")}</Link>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={t("ui.online.checkout")} onClose={onClose}>
      <form onSubmit={send} className="form-grid">
        <ul className="fpos__cart">{cart.map((l) => (
          <li key={l.key}><span className="fpos__cart-name"><strong>{l.item.name}</strong><small>{[l.size, ...l.extras.map((x) => `+ ${x.name}`), ...l.removed.map((x) => fill(t("ui.food.without"), { name: x.name })), l.notes].filter(Boolean).join(" · ")}</small></span>
            <div className="qty-ctl"><button type="button" onClick={() => setQty(l.key, l.qty - 1)} aria-label="−"><Icon name="minus" /></button><input type="number" value={l.qty} readOnly /><button type="button" onClick={() => setQty(l.key, l.qty + 1)} aria-label="+"><Icon name="plus" /></button></div>
            <span className="num">{m(l.qty * l.unitPrice)}</span></li>
        ))}</ul>
        <div className="seg">{s.services.map((x) => <button key={x} type="button" aria-pressed={f.service === x} onClick={() => setF({ ...f, service: x })}>{t(`ui.food.services.${x}`)}</button>)}</div>
        <input className={"input" + (errors.name ? " has-error" : "")} value={f.name} onChange={set("name")} placeholder={t("ui.jewelry.customerName")} autoComplete="name" />
        <input className={"input" + (errors.phone ? " has-error" : "")} type="tel" value={f.phone} onChange={set("phone")} placeholder={t("ui.common.phone")} autoComplete="tel" />
        {f.service === "delivery" && <input className={"input" + (errors.address ? " has-error" : "")} value={f.address} onChange={set("address")} placeholder={t("ui.food.deliveryAddress")} autoComplete="street-address" />}
        <label className="ff"><span className="ff__label">{t("ui.online.payWith")}</span>
          <select className="input" value={f.payment} onChange={set("payment")}>{s.payments.map((x) => <option key={x} value={x}>{t(`ui.online.payments.${x}`)}</option>)}</select></label>
        <input className="input" value={f.notes} onChange={set("notes")} placeholder={t("ui.food.orderNotes")} />
        <dl className="paybox__sum">
          <div><dt>{t("ui.common.subtotal")}</dt><dd>{m(total)}</dd></div>
          {fee > 0 && <div><dt>{t("ui.food.deliveryFee")}</dt><dd>{m(fee)}</dd></div>}
          <div className="is-total"><dt>{t("ui.common.total")}</dt><dd>{m(r4(total + fee))}</dd></div>
        </dl>
        {s.minOrder > 0 && total < s.minOrder && <p className="form-status form-status--error">{fill(t("ui.online.minOrder"), { amount: m(s.minOrder) })}</p>}
        {err && <p className="form-status form-status--error">{t(err.code === "validation" ? "ui.errors.validation" : `ui.errors.${err.code}`).startsWith("ui.") ? t("ui.errors.failed") : t(err.code === "validation" ? "ui.errors.validation" : `ui.errors.${err.code}`)}</p>}
        <button type="submit" className="btn btn--primary" disabled={busy || !cart.length || (s.minOrder > 0 && total < s.minOrder)}>{t("ui.online.place")}</button>
      </form>
    </Sheet>
  );
}

const STEPS = ["received", "sent", "preparing", "ready", "on_the_way", "delivered"];
export function OrderTracking() {
  const { code, tracking } = useParams();
  const { t, lang } = useLanguage();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const load = () => apiRequest(`/api/public/orders/${code}/${tracking}`).then(setD).catch(setError);
    load();
    const h = setInterval(load, 20000);
    return () => clearInterval(h);
  }, [code, tracking]);
  if (error && !d) return <div className="om om--msg"><Icon name="lock" /><p>{t("ui.errors.notFound")}</p></div>;
  if (!d) return <div className="om om--msg"><span className="app-spinner" /></div>;
  const o = d.order;
  const m = (v) => money(v, d.business.currency, lang);
  const steps = STEPS.filter((s) => o.service === "delivery" || !["on_the_way", "delivered"].includes(s));
  const at = ["served", "completed"].includes(o.status) ? steps.length - 1 : steps.indexOf(o.status);
  return (
    <div className="om om--track">
      <header className="om__head"><div><h1>{d.business.name}</h1><small>{t("ui.online.orderNo")} {o.number} · {date(o.createdAt, lang, true)}</small></div></header>
      {o.status === "cancelled" ? <p className="form-status form-status--error">{t("ui.online.notAccepted")}{o.cancelReason ? `: ${o.cancelReason}` : ""}</p> : (
        <ol className="stage-steps om__steps">{steps.map((s, i) => <li key={s} className={i < at ? "is-done" : i === at ? "is-now" : ""}>{t(`ui.online.steps.${s}`)}</li>)}</ol>
      )}
      <ul className="pay-list">{o.items.map((i, k) => <li key={k}>{i.qty} × {i.name}{i.size ? ` (${i.size})` : ""} · {m(i.total)}</li>)}</ul>
      {o.deliveryFee > 0 && <p>{t("ui.food.deliveryFee")}: {m(o.deliveryFee)}</p>}
      <p><strong>{t("ui.common.total")}: {m(o.total)}</strong></p>
      {d.business.phone && <p className="muted"><Icon name="phone" /> {d.business.phone}</p>}
      <p className="muted">{t("ui.online.refreshes")}</p>
    </div>
  );
}
