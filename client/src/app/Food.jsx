import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest, fileUrl } from "../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, useErrorText, Modal, Field, FormError, EmptyState, Loading, SearchBox, ReasonModal, DateRange, daysAgo, isoDate } from "./ui.jsx";
import { date, fill, qty } from "./format.js";
import { useProfile } from "./profile.js";
import SearchSelect from "./SearchSelect.jsx";
import { PaymentModal } from "./pages/Pos.jsx";
import { ProductForm } from "./pages/Products.jsx";

/*
 * Restaurant & cafe (food business types):
 *   FoodPos       orders: dine-in (table), takeaway, counter, delivery; menu with sizes, extras, "no …" and notes;
 *                 send to the kitchen, add more items, pay (split / partial / credit) — a POS sale with its receipt
 *   KitchenPage   the kitchen display by station: tickets with timers; preparing → ready → served; kitchen reports
 *   TablesPage    tables and their status, open orders (served / delivered / completed, move, combine, split, cancel), setup
 *   MenuPage      menu items, extras and prepared items: sizes, extras, station, sold out, recipes (versions, cost, margin)
 */
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
const OPEN = ["received", "sent", "preparing", "ready", "served", "delivered"];

/** "Large · + Extra cheese · no Cheese slice · Well done" */
export function menuText(t, x) {
  if (!x) return "";
  return [x.size, ...(x.extras || []).map((e) => `+ ${e.name}`), ...(x.removed || []).map((r) => fill(t("ui.food.without"), { name: r.name || r })), x.notes].filter(Boolean).join(" · ");
}
/** On receipts: the size / extras / notes of a food sale line */
export function MenuDetailLine({ detail, className }) {
  const { t } = useLanguage();
  const text = menuText(t, detail?.menu);
  return text ? <small className={className}>{text}</small> : null;
}
const minutesSince = (at, now = Date.now()) => (at ? Math.max(0, Math.floor((now - Date.parse(at)) / 60000)) : 0);

/** Kitchen ticket (separate from the customer receipt): opens a small print window. */
export function printKitchenTicket(t, order, items = order.items, station = "") {
  const w = window.open("", "_blank", "width=380,height=600");
  if (!w) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lines = items.filter((i) => i.status !== "cancelled").map((i) => `<li><b>${qty(i.qty)} × ${esc(i.name)}</b>${menuText(t, i) ? `<br><span>${esc(menuText(t, i))}</span>` : ""}</li>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(order.number)}</title><style>
    body{font:14px/1.35 system-ui,sans-serif;margin:8px;width:72mm} h1{font-size:22px;margin:0} p{margin:2px 0} ul{list-style:none;padding:0;margin:8px 0;border-top:1px dashed #000}
    li{padding:6px 0;border-bottom:1px dashed #000} li span{font-size:13px} .big{font-size:18px;font-weight:700}</style></head><body>
    <h1>${esc(order.number)}</h1><p class="big">${esc(t(`ui.food.services.${order.service}`))}${order.table ? ` · ${esc(t("ui.food.table"))} ${esc(order.table)}` : ""}</p>
    ${station ? `<p>${esc(station)}</p>` : ""}<p>${esc(date(order.sentAt || order.createdAt, "en", true))}</p>${order.customer ? `<p>${esc(order.customer)}</p>` : ""}
    <ul>${lines}</ul>${order.notes ? `<p><b>${esc(order.notes)}</b></p>` : ""}<script>window.print();setTimeout(()=>window.close(),300)</script></body></html>`);
  w.document.close();
}

/* ===================== POS ===================== */
export function FoodPos() {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const profile = useProfile();
  const errText = useErrorText();
  const [params, setParams] = useSearchParams();
  const services = profile.food?.services || ["counter"];
  const menu = useApi("/api/food/menu");
  const tables = useApi(profile.food?.tables ? "/api/food/tables" : null);
  const customers = useApi("/api/customers");
  const openOrders = useApi("/api/food/orders?status=open");
  const [head, setHead] = useState(() => ({ service: params.get("table") ? "dine_in" : services[0], tableId: params.get("table") || "", guests: "", customerId: "", customerName: "", customerPhone: "", deliveryAddress: "", deliveryFee: "", driver: "", notes: "" }));
  const [cart, setCart] = useState([]);
  const [orderId, setOrderId] = useState(params.get("order") || null);
  const order = useApi(orderId ? `/api/food/orders/${orderId}` : null);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(null);   // menu item being customised
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(null);
  const [modal, setModal] = useState(null);       // cancel | move
  const sub = useSubmit();
  const o = orderId ? order.data?.order : null;

  // a table opened from the Tables page: its open order, if any
  useEffect(() => {
    const tid = params.get("table");
    if (!tid || !openOrders.data) return;
    const existing = openOrders.data.orders.find((x) => String(x.tableId) === tid);
    if (existing) setOrderId(String(existing.id));
    setParams({}, { replace: true });
  }, [openOrders.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = setInterval(() => { openOrders.reload(); }, 20000); return () => clearInterval(h); }, [openOrders.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = menu.data?.items || [];
  // the grid: menu items and goods (extras are chosen on an item, prepared items are kitchen stock)
  const sellable = items.filter((x) => x.kind === "menu" || x.kind === "goods");
  const cats = [...new Set(sellable.map((x) => x.category || t("ui.food.noCategory")))];
  const shown = sellable.filter((x) => !cat || (x.category || t("ui.food.noCategory")) === cat)
    .filter((x) => !q || `${x.name} ${x.sku || ""} ${x.barcode || ""}`.toLowerCase().includes(q.toLowerCase()));
  const needsChoice = (x) => x.sizes.length > 0 || x.extras.length > 0 || x.optional.length > 0;
  const addToCart = (x, choice = {}) => {
    if (!x.available) return;
    const size = choice.size ? x.sizes.find((s) => s.name === choice.size) : null;
    const extras = choice.extras || [];
    const unitPrice = r4((size ? size.price : x.price) + extras.reduce((s, e) => s + e.price, 0));
    const line = { key: `${x.id}-${Date.now()}`, item: x, qty: choice.qty || 1, size: size?.name || null, extras, removed: choice.removed || [], notes: choice.notes || "", unitPrice };
    // the same plain item again: one more on its line
    setCart((c) => {
      const same = c.find((l) => l.item.id === x.id && !l.size && !l.extras.length && !l.removed.length && !l.notes && !line.size && !extras.length && !line.removed.length && !line.notes);
      return same ? c.map((l) => (l === same ? { ...l, qty: l.qty + line.qty } : l)) : [...c, line];
    });
  };
  const pick = (x) => (needsChoice(x) ? setPicking(x) : addToCart(x));
  const setLineQty = (key, v) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: Math.max(0, Number(v) || 0) } : l)).filter((l) => l.qty > 0));
  const cartTotal = r4(cart.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const payload = () => cart.map((l) => ({ productId: l.item.id, qty: l.qty, size: l.size || undefined, extras: l.extras.map((e) => e.id), removed: l.removed.map((r) => r.lineId), notes: l.notes || undefined }));
  const reloadAll = () => { openOrders.reload(); tables.reload?.(); order.reload(); };

  /* send the cart: a new order, or more items on the open one */
  const send = async () => {
    if (!cart.length) return o;
    const r = await sub.run(() => (o
      ? apiRequest(`/api/food/orders/${o.id}/items`, { method: "POST", body: { items: payload() } }).then(() => ({ id: o.id }))
      : apiRequest("/api/food/orders", { method: "POST", body: { serviceType: head.service, tableId: head.tableId || undefined, guests: head.guests || undefined, customerId: head.customerId || undefined,
          customerName: head.customerName, customerPhone: head.customerPhone, deliveryAddress: head.deliveryAddress, deliveryFee: head.deliveryFee, driver: head.driver, notes: head.notes, items: payload() } })));
    if (!r) return null;
    setCart([]);
    setOrderId(String(r.id));
    openOrders.reload(); tables.reload?.();
    return r;
  };
  const sendAndPay = async () => {
    const r = cart.length ? await send() : o;
    if (!r) return;
    if (cart.length) await order.reload();
    setPaying(true);
  };
  const newOrder = () => { setOrderId(null); setCart([]); setHead((h) => ({ ...h, tableId: "", guests: "", customerId: "", customerName: "", customerPhone: "", deliveryAddress: "", deliveryFee: "", driver: "", notes: "" })); sub.setFormError(null); };
  const act = async (path, body) => { if (await sub.run(() => apiRequest(`/api/food/orders/${o.id}/${path}`, { method: "POST", body }))) reloadAll(); };

  const service = o ? o.service : head.service;
  const freeTables = (tables.data?.tables || []);
  const orderCustomer = (customers.data?.customers || []).find((c) => String(c.id) === String(o?.customerId || head.customerId)) || null;
  return (
    <div className="page food-pos">
      <PageHeader icon="cart" title={t("ui.food.posTitle")} actions={<Link className="btn btn--outline" to="/app/m/pos?tab=history"><Icon name="history" /><span>{t("ui.pos.history")}</span></Link>} />
      {/* open orders */}
      <div className="fpos-orders">
        <button type="button" className={"fpos-chip fpos-chip--new" + (!orderId ? " is-on" : "")} onClick={newOrder}><Icon name="plus" /> {t("ui.food.newOrder")}</button>
        {(openOrders.data?.orders || []).map((x) => (
          <button key={x.id} type="button" className={`fpos-chip is-${x.status}` + (String(x.id) === String(orderId) ? " is-on" : "")} onClick={() => { setOrderId(String(x.id)); setCart([]); }}>
            <strong>{x.table ? `${t("ui.food.table")} ${x.table}` : x.number}</strong>
            <small>{x.table ? x.number : t(`ui.food.services.${x.service}`)} · {t(`ui.food.status.${x.status}`)}{x.saleId ? ` · ${t("ui.food.paidShort")}` : ""}</small>
          </button>
        ))}
      </div>
      <div className="fpos">
        {/* ---------- left: the order ---------- */}
        <aside className="fpos__left">
          {!o ? (
            <div className="fpos__head">
              <div className="seg seg--sm">{services.map((s) => <button key={s} type="button" aria-pressed={head.service === s} onClick={() => setHead({ ...head, service: s })}>{t(`ui.food.services.${s}`)}</button>)}</div>
              {head.service === "dine_in" && profile.food?.tables && (
                <div className="fpos__row">
                  <select className={"input input--sm" + (sub.fieldErrors.tableId ? " has-error" : "")} value={head.tableId} onChange={(e) => setHead({ ...head, tableId: e.target.value })} aria-label={t("ui.food.table")}>
                    <option value="">{t("ui.food.chooseTable")}</option>
                    {freeTables.map((tb) => <option key={tb.id} value={tb.id}>{tb.name}{tb.area ? ` · ${tb.area}` : ""} ({t(`ui.food.tableStatus.${tb.status}`)})</option>)}
                  </select>
                  <input className="input input--sm" type="number" min="1" value={head.guests} onChange={(e) => setHead({ ...head, guests: e.target.value })} placeholder={t("ui.food.guests")} aria-label={t("ui.food.guests")} />
                </div>
              )}
              <select className="input input--sm" value={head.customerId} onChange={(e) => setHead({ ...head, customerId: e.target.value })} aria-label={t("ui.common.customer")}>
                <option value="">{t("ui.pos.walkInDefault")}</option>
                {(customers.data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
              </select>
              {!head.customerId && head.service !== "dine_in" && (
                <div className="fpos__row">
                  <input className="input input--sm" value={head.customerName} onChange={(e) => setHead({ ...head, customerName: e.target.value })} placeholder={t("ui.jewelry.customerName")} />
                  <input className={"input input--sm" + (sub.fieldErrors.customerPhone ? " has-error" : "")} type="tel" value={head.customerPhone} onChange={(e) => setHead({ ...head, customerPhone: e.target.value })} placeholder={t("ui.common.phone")} />
                </div>
              )}
              {head.service === "delivery" && (
                <>
                  <input className={"input input--sm" + (sub.fieldErrors.deliveryAddress ? " has-error" : "")} value={head.deliveryAddress} onChange={(e) => setHead({ ...head, deliveryAddress: e.target.value })} placeholder={t("ui.food.deliveryAddress")} />
                  <div className="fpos__row">
                    <input className="input input--sm" type="number" min="0" step="any" value={head.deliveryFee} onChange={(e) => setHead({ ...head, deliveryFee: e.target.value })} placeholder={t("ui.food.deliveryFee")} />
                    <input className="input input--sm" value={head.driver} onChange={(e) => setHead({ ...head, driver: e.target.value })} placeholder={t("ui.food.driver")} />
                  </div>
                </>
              )}
              <input className="input input--sm" value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} placeholder={t("ui.food.orderNotes")} />
            </div>
          ) : (
            <div className="fpos__current">
              <div className="fpos__current-top">
                <strong>{o.number}</strong>
                <span className={`food-status is-${o.status}`}>{t(`ui.food.status.${o.status}`)}</span>
              </div>
              <small>{t(`ui.food.services.${o.service}`)}{o.table ? ` · ${t("ui.food.table")} ${o.table}` : ""}{o.guests ? ` · ${fill(t("ui.food.guestsN"), { n: o.guests })}` : ""}{o.customer ? ` · ${o.customer}` : ""}</small>
              {o.service === "delivery" && <small>{o.deliveryAddress}{o.driver ? ` · ${o.driver}` : ""}</small>}
              {o.notes && <small className="fpos__note">{o.notes}</small>}
              <ul className="fpos__items">
                {o.items.map((i) => (
                  <li key={i.id} className={i.status === "cancelled" ? "is-cancelled" : ""}>
                    <span><strong>{qty(i.qty)} × {i.name}</strong>{menuText(t, i) && <small>{menuText(t, i)}</small>}</span>
                    <span className={`food-status is-${i.status}`}>{t(`ui.food.itemStatus.${i.status}`)}</span>
                    <span className="num">{m(i.total)}</span>
                  </li>
                ))}
              </ul>
              <div className="fpos__sum"><span>{t("ui.common.total")}</span><strong>{m(o.total)}</strong></div>
              {o.saleId && <p className="fpos__paid"><Icon name="check" /> {fill(t("ui.food.paidOn"), { receipt: o.receiptNo })}{o.balance > 0 ? ` · ${t("ui.common.balance")} ${m(o.balance)}` : ""} <Link to={`/app/sales/${o.saleId}`}>{t("ui.pos.receipt")}</Link></p>}
              <div className="fpos__actions">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => printKitchenTicket(t, o)}><Icon name="printer" /><span>{t("ui.food.kitchenTicket")}</span></button>
                {o.unsent > 0 && <button type="button" className="btn btn--outline btn--sm" onClick={() => act("send")}><Icon name="send" /><span>{t("ui.food.sendRest")}</span></button>}
                {o.service === "dine_in" && profile.food?.tables && !o.saleId && <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal("move")}><Icon name="swap" /><span>{t("ui.food.moveTable")}</span></button>}
                {["ready", "preparing", "sent"].includes(o.status) && o.service !== "delivery" && <button type="button" className="btn btn--outline btn--sm" onClick={() => act("status", { status: "served" })}><Icon name="check" /><span>{t("ui.food.markServed")}</span></button>}
                {o.service === "delivery" && o.status !== "delivered" && <button type="button" className="btn btn--outline btn--sm" onClick={() => act("status", { status: "delivered" })}><Icon name="truck" /><span>{t("ui.food.markDelivered")}</span></button>}
                {o.saleId && <button type="button" className="btn btn--primary btn--sm" onClick={async () => { await act("status", { status: "completed" }); newOrder(); }}><Icon name="check" /><span>{t("ui.food.complete")}</span></button>}
                {can("sales.cancel") && !o.saleId && <button type="button" className="btn btn--danger btn--sm" onClick={() => setModal("cancel")}>{t("ui.food.cancelOrder")}</button>}
              </div>
            </div>
          )}

          {cart.length > 0 && (
            <>
              <p className="fpos__label">{o ? t("ui.food.adding") : t("ui.food.newItems")}</p>
              <ul className="fpos__cart">
                {cart.map((l) => (
                  <li key={l.key}>
                    <span className="fpos__cart-name"><strong>{l.item.name}</strong>{menuText(t, l) && <small>{menuText(t, l)}</small>}</span>
                    <div className="qty-ctl">
                      <button type="button" onClick={() => setLineQty(l.key, l.qty - 1)} aria-label="−"><Icon name="minus" /></button>
                      <input type="number" min="0" step="1" value={l.qty} onChange={(e) => setLineQty(l.key, e.target.value)} aria-label={t("ui.common.qty")} />
                      <button type="button" onClick={() => setLineQty(l.key, l.qty + 1)} aria-label="+"><Icon name="plus" /></button>
                    </div>
                    <span className="num">{m(l.qty * l.unitPrice)}</span>
                  </li>
                ))}
              </ul>
              <div className="fpos__sum"><span>{t("ui.food.newItems")}</span><strong>{m(cartTotal)}</strong></div>
            </>
          )}
          {!o && !cart.length && <p className="fpos__empty"><Icon name="cart" /> {t("ui.food.pickItems")}</p>}
          {sub.formError && <p className="form-status form-status--error" role="alert">{errText(sub.formError.errors ? "validation" : sub.formError)}</p>}
          <div className="fpos__buttons">
            <button type="button" className="btn btn--outline" disabled={!cart.length || sub.busy} onClick={send}><Icon name="send" /><span>{t(o ? "ui.food.addToOrder" : "ui.food.sendKitchen")}</span></button>
            <button type="button" className="btn btn--primary" disabled={(!cart.length && !o) || Boolean(o?.saleId && !cart.length) || sub.busy} onClick={sendAndPay}><Icon name="wallet" /><span>{t("ui.food.pay")}</span></button>
          </div>
        </aside>

        {/* ---------- right: the menu ---------- */}
        <section className="fpos__right">
          <div className="pos2__bar">
            <div className="pos2__search"><Icon name="search-glass" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui.food.searchMenu")} aria-label={t("ui.food.searchMenu")} /></div>
          </div>
          <div className="fpos-cats">
            <button type="button" className={!cat ? "is-on" : ""} onClick={() => setCat("")}>{t("ui.common.all")}</button>
            {cats.map((c) => <button key={c} type="button" className={cat === c ? "is-on" : ""} onClick={() => setCat(c)}>{c}</button>)}
          </div>
          {menu.loading && !menu.data ? <Loading /> : shown.length === 0 ? <EmptyState icon="package" text={items.length ? t("ui.common.noResults") : t("ui.food.noMenu")} action={can("products.edit") && <Link className="btn btn--primary" to="/app/m/menu">{t("app.modules.menu")}</Link>} /> : (
            <div className="pos2__grid">
              {shown.map((x) => (
                <button key={x.id} type="button" className={"pcard" + (!x.available || (x.stock !== null && x.stock <= 0) ? " is-out" : "")} onClick={() => pick(x)} disabled={!x.available}>
                  {!x.available && <span className="pcard__ribbon">{t("ui.food.soldOut")}</span>}
                  <span className="pcard__img">{x.imagePath ? <img src={fileUrl(x.imagePath)} alt="" loading="lazy" /> : <Icon name="package" />}</span>
                  <strong className="pcard__name">{x.name}</strong>
                  {x.sizes.length > 0 ? <small className="pcard__qty">{x.sizes.map((s) => s.name).join(" / ")}</small> : x.stock !== null && <small className="pcard__qty">{fill(t("ui.pos.qtyLabel"), { qty: qty(x.stock) })}</small>}
                  <span className="pcard__price">{m(x.sizes.length ? Math.min(...x.sizes.map((s) => s.price)) : x.price)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {picking && <ItemChoice item={picking} onClose={() => setPicking(null)} onAdd={(choice) => { addToCart(picking, choice); setPicking(null); }} />}
      {paying && o && (
        <PaymentModal cart={o.items} subtotal={o.subtotal} fee={o.deliveryFee} feeLabel={t("ui.food.deliveryFee")} customer={orderCustomer} addVat={false} setAddVat={() => {}}
          submit={(body) => apiRequest(`/api/food/orders/${o.id}/pay`, { method: "POST", body: { ...body, customerId: body.customerId || o.customerId || undefined } })}
          onClose={() => setPaying(false)} onDone={(r) => { setPaying(false); setDone(r); reloadAll(); }} />
      )}
      {done && (
        <Modal title={t("ui.pos.done")} onClose={() => setDone(null)}>
          <div className="sale-done">
            <span className="sale-done__icon"><Icon name="check" /></span>
            <p>{t("ui.pos.receiptNo")}: <strong>{done.receiptNo}</strong></p>
            <p className="sale-done__total">{m(done.total)}</p>
            {done.change > 0 && <p>{t("ui.pos.change")}: <strong>{m(done.change)}</strong></p>}
            {done.paid < done.total && <p className="muted">{fill(t("ui.food.onCredit"), { amount: m(r4(done.total - done.paid)) })}</p>}
            <div className="form-actions">
              <Link className="btn btn--outline" to={`/app/sales/${done.id}`}><Icon name="printer" /><span>{t("ui.pos.receipt")}</span></Link>
              <button type="button" className="btn btn--outline" onClick={() => setDone(null)}>{t("ui.food.backToOrder")}</button>
              <button type="button" className="btn btn--primary" onClick={() => { setDone(null); newOrder(); }}><Icon name="plus" /><span>{t("ui.food.newOrder")}</span></button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "cancel" && o && <ReasonModal title={t("ui.food.cancelOrder")} help={t("ui.food.cancelHelp")} confirmLabel={t("ui.food.cancelOrder")}
        onConfirm={(reason) => apiRequest(`/api/food/orders/${o.id}/cancel`, { method: "POST", body: { reason } }).then(() => { newOrder(); openOrders.reload(); tables.reload?.(); })} onClose={() => setModal(null)} />}
      {modal === "move" && o && <MoveTable order={o} tables={freeTables} openOrders={openOrders.data?.orders || []} onClose={() => setModal(null)} onDone={() => { setModal(null); reloadAll(); }} />}
    </div>
  );
}

/** Size, extras, ingredients left out, notes and quantity of one menu item. */
function ItemChoice({ item, onClose, onAdd }) {
  const { t } = useLanguage();
  const m = useMoney();
  const [size, setSize] = useState(item.sizes[0]?.name || null);
  const [extras, setExtras] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [notes, setNotes] = useState("");
  const [n, setN] = useState(1);
  const base = size ? item.sizes.find((s) => s.name === size).price : item.price;
  const price = r4(base + extras.reduce((s, e) => s + e.price, 0));
  const toggle = (list, set, x, key) => set(list.some((y) => y[key] === x[key]) ? list.filter((y) => y[key] !== x[key]) : [...list, x]);
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="form-grid item-choice">
        {item.description && <p className="muted">{item.description}</p>}
        {item.sizes.length > 0 && (
          <Field label={t("ui.food.size")}>
            <div className="seg">{item.sizes.map((s) => <button key={s.name} type="button" aria-pressed={size === s.name} onClick={() => setSize(s.name)}>{s.name} · {m(s.price)}</button>)}</div>
          </Field>
        )}
        {item.extras.length > 0 && (
          <div className="ff"><span className="ff__label">{t("ui.food.extras")}</span>
            <div className="chip-pick">{item.extras.map((x) => (
              <button key={x.id} type="button" disabled={!x.available} aria-pressed={extras.some((e) => e.id === x.id)} onClick={() => toggle(extras, setExtras, x, "id")}>+ {x.name} · {m(x.price)}</button>
            ))}</div>
          </div>
        )}
        {item.optional.length > 0 && (
          <div className="ff"><span className="ff__label">{t("ui.food.leaveOut")}</span>
            <div className="chip-pick">{item.optional.map((x) => (
              <button key={x.lineId} type="button" aria-pressed={removed.some((r) => r.lineId === x.lineId)} onClick={() => toggle(removed, setRemoved, x, "lineId")}>{fill(t("ui.food.without"), { name: x.name })}</button>
            ))}</div>
          </div>
        )}
        <Field label={`${t("ui.food.instructions")} ${t("ui.common.optional")}`}><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("ui.food.instructionsPh")} maxLength={255} /></Field>
        <div className="item-choice__foot">
          <div className="qty-ctl">
            <button type="button" onClick={() => setN(Math.max(1, n - 1))} aria-label="−"><Icon name="minus" /></button>
            <input type="number" min="1" value={n} onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))} aria-label={t("ui.common.qty")} />
            <button type="button" onClick={() => setN(n + 1)} aria-label="+"><Icon name="plus" /></button>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => onAdd({ size, extras, removed, notes: notes.trim(), qty: n })}><Icon name="plus" /><span>{fill(t("ui.food.addFor"), { price: m(price * n) })}</span></button>
        </div>
      </div>
    </Modal>
  );
}

/** Move an order to another table, or combine it with the order already on that table. */
function MoveTable({ order, tables, openOrders, onClose, onDone }) {
  const { t } = useLanguage();
  const [tableId, setTableId] = useState("");
  const sub = useSubmit();
  const target = openOrders.find((x) => String(x.tableId) === String(tableId) && x.id !== order.id && !x.saleId);
  const save = async (combine) => {
    const ok = await sub.run(() => (combine
      ? apiRequest(`/api/food/orders/${target.id}/merge`, { method: "POST", body: { orderId: order.id } })
      : apiRequest(`/api/food/orders/${order.id}`, { method: "PATCH", body: { tableId } })));
    if (ok) onDone();
  };
  return (
    <Modal title={t("ui.food.moveTable")} onClose={onClose}>
      <div className="form-grid">
        <Field label={t("ui.food.table")}>
          <select className="input" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">{t("ui.food.chooseTable")}</option>
            {tables.filter((tb) => tb.id !== order.tableId).map((tb) => <option key={tb.id} value={tb.id}>{tb.name} ({t(`ui.food.tableStatus.${tb.status}`)})</option>)}
          </select>
        </Field>
        {target && <p className="page-help"><Icon name="info" /> {fill(t("ui.food.tableHasOrder"), { n: target.number })}</p>}
        <FormError error={sub.formError} />
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          {target && <button type="button" className="btn btn--outline" disabled={sub.busy} onClick={() => save(true)}>{t("ui.food.combine")}</button>}
          <button type="button" className="btn btn--primary" disabled={!tableId || sub.busy} onClick={() => save(false)}>{t("ui.food.move")}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ===================== Kitchen display ===================== */
export function KitchenPage() {
  const { t } = useLanguage();
  const can = usePerm();
  const [tab, setTab] = useState("display");
  return (
    <div className="page">
      <PageHeader icon="flame" title={t("app.modules.kitchen")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "display", label: t("ui.food.display"), icon: "grid" },
        ...(can("reports.view") || can("kitchen.view") ? [{ id: "reports", label: t("ui.food.reports"), icon: "file-chart" }] : []),
        ...(can("settings.edit") ? [{ id: "settings", label: t("ui.food.stations"), icon: "settings" }] : [])]} />
      {tab === "display" ? <KitchenDisplay /> : tab === "reports" ? <KitchenReports /> : <KitchenSettings />}
    </div>
  );
}

function KitchenDisplay() {
  const { t } = useLanguage();
  const can = usePerm();
  const errText = useErrorText();
  const [station, setStation] = useState(() => { try { return localStorage.getItem("faatix.station") || ""; } catch { return ""; } });
  const k = useApi(`/api/food/kitchen?station=${encodeURIComponent(station)}`);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState(null);
  useEffect(() => { const h = setInterval(() => { k.reload(); setNow(Date.now()); }, 10000); return () => clearInterval(h); }, [k.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseStation = (s) => { setStation(s); try { localStorage.setItem("faatix.station", s); } catch { /* private mode */ } };
  const post = useCallback(async (path, body) => { setErr(null); try { await apiRequest(path, { method: "POST", body }); k.reload(); } catch (e) { setErr(e); } }, [k]);
  const data = k.data;
  return (
    <>
      <div className="fpos-cats kitchen-stations">
        <button type="button" className={!station ? "is-on" : ""} onClick={() => chooseStation("")}>{t("ui.food.allStations")}</button>
        {(data?.stations || []).map((s) => <button key={s} type="button" className={station === s ? "is-on" : ""} onClick={() => chooseStation(s)}>{s}</button>)}
      </div>
      {err && <p className="form-status form-status--error">{errText(err)}</p>}
      {k.loading && !data ? <Loading /> : !data.orders.length ? <EmptyState icon="flame" text={t("ui.food.kitchenEmpty")} /> : (
        <div className="kds">
          {data.orders.map((o) => {
            const mins = minutesSince(o.sentAt, now);
            const late = mins >= data.delayMinutes;
            const lowest = ["sent", "preparing", "ready"].find((s) => o.items.some((i) => i.status === s));
            return (
              <article key={o.id} className={"kds__ticket" + (late ? " is-late" : "") + (lowest === "ready" ? " is-ready" : "")}>
                <header>
                  <strong>{o.table ? `${t("ui.food.table")} ${o.table}` : o.number}</strong>
                  <span className="kds__time"><Icon name="clock" /> {fill(t("ui.food.minutes"), { n: mins })}</span>
                  <small>{o.table ? o.number : ""} {t(`ui.food.services.${o.service}`)}{o.customer ? ` · ${o.customer}` : ""}</small>
                </header>
                {o.notes && <p className="kds__note">{o.notes}</p>}
                <ul>{o.items.map((i) => (
                  <li key={i.id} className={`is-${i.status}`}>
                    <button type="button" disabled={!can("kitchen.update")} onClick={() => post(`/api/food/kitchen/items/${i.id}`, { status: { sent: "preparing", preparing: "ready", ready: "served" }[i.status] })}
                      title={t(`ui.food.itemStatus.${i.status}`)}>
                      <b>{qty(i.qty)} ×</b> <span>{i.name}{!station && i.station ? <em> · {i.station}</em> : null}</span>
                      {menuText(t, i) && <small>{menuText(t, i)}</small>}
                    </button>
                    <span className={`food-status is-${i.status}`}>{t(`ui.food.itemStatus.${i.status}`)}</span>
                  </li>
                ))}</ul>
                <footer>
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => printKitchenTicket(t, o, o.items, station)}><Icon name="printer" /></button>
                  {can("kitchen.update") && <button type="button" className="btn btn--primary btn--sm" onClick={() => post(`/api/food/kitchen/orders/${o.id}`, { station })}>
                    {t(lowest === "sent" ? "ui.food.start" : lowest === "preparing" ? "ui.food.markReady" : "ui.food.markServed")}</button>}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function KitchenReports() {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const [range, setRange] = useState({ from: daysAgo(6), to: isoDate(new Date()) });
  const r = useApi(`/api/food/reports?${new URLSearchParams(range)}`);
  const d = r.data;
  return (
    <div className="stock-form">
      <div className="toolbar"><DateRange value={range} onChange={setRange} /></div>
      {!d ? <Loading /> : (
        <div className="split-view split-view--even">
          <section className="panel-card">
            <h2 className="panel-card__title"><Icon name="clock" />{t("ui.food.prepByStation")}</h2>
            {!d.stations.length ? <EmptyState text={t("ui.common.noResults")} /> : (
              <table className="table table--compact"><thead><tr><th>{t("ui.food.station")}</th><th className="num">{t("ui.common.items")}</th><th className="num">{t("ui.food.avgMin")}</th><th className="num">{t("ui.food.maxMin")}</th><th className="num">{fill(t("ui.food.overN"), { n: d.delayMinutes })}</th></tr></thead>
                <tbody>{d.stations.map((s) => <tr key={s.station}><td>{s.station || "—"}</td><td className="num">{s.items}</td><td className="num">{s.avgMinutes}</td><td className="num">{s.maxMinutes}</td><td className={"num" + (s.delayed ? " is-neg" : "")}>{s.delayed}</td></tr>)}</tbody></table>
            )}
            <h2 className="panel-card__title"><Icon name="layers" />{t("ui.food.byService")}</h2>
            <table className="table table--compact"><tbody>{d.services.map((s) => <tr key={s.service}><td>{t(`ui.food.services.${s.service}`)}</td><td className="num">{fill(t("ui.food.ordersN"), { n: s.orders })}</td><td className="num">{m(s.total)}</td></tr>)}</tbody></table>
          </section>
          <section className="panel-card">
            <h2 className="panel-card__title"><Icon name="package" />{t("ui.food.prepByItem")}</h2>
            <table className="table table--compact"><thead><tr><th>{t("ui.common.item")}</th><th className="num">{t("ui.common.qty")}</th><th className="num">{t("ui.food.avgMin")}</th></tr></thead>
              <tbody>{d.products.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num">{qty(p.qty)}</td><td className="num">{p.avgMinutes}</td></tr>)}</tbody></table>
            <h2 className="panel-card__title"><Icon name="alert" />{fill(t("ui.food.delayedOrders"), { n: d.delayMinutes })}</h2>
            {!d.delayed.length ? <p className="muted">{t("ui.food.noDelays")}</p> : <ul className="pay-list">{d.delayed.map((x) => <li key={x.number}><strong>{x.number}</strong> · {t(`ui.food.services.${x.service}`)}{x.table ? ` · ${x.table}` : ""} · {fill(t("ui.food.minutes"), { n: x.minutes })}{x.open ? ` · ${t("ui.food.stillOpen")}` : ""}</li>)}</ul>}
            <h2 className="panel-card__title"><Icon name="x" />{t("ui.food.cancelledOrders")}</h2>
            {!d.cancelled.length ? <p className="muted">{t("ui.common.noResults")}</p> : <ul className="pay-list">{d.cancelled.map((x) => <li key={x.number}><strong>{x.number}</strong> · {x.reason}{x.user ? ` · ${x.user}` : ""} · {date(x.at, lang, true)}</li>)}</ul>}
          </section>
        </div>
      )}
    </div>
  );
}

function KitchenSettings() {
  const { t } = useLanguage();
  const d = useApi("/api/food/settings");
  const [list, setList] = useState(null);
  const [delay, setDelay] = useState(20);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (d.data && !list) { setList(d.data.stations); setDelay(d.data.delayMinutes); } }, [d.data, list]);
  const sub = useSubmit();
  const save = async () => { if (await sub.run(() => apiRequest("/api/food/settings", { method: "PUT", body: { stations: list.map((s) => s.trim()).filter(Boolean), delayMinutes: Number(delay) } }))) { setSaved(true); setTimeout(() => setSaved(false), 2500); } };
  if (!list) return <Loading />;
  return (
    <section className="panel-card form-grid stock-form">
      <p className="modal__help">{t("ui.food.stationsHelp")}</p>
      <ol className="stage-edit">{list.map((s, i) => (
        <li key={i}><input className="input input--sm" value={s} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? e.target.value : x)))} maxLength={60} aria-label={t("ui.food.station")} />
          <button type="button" className="icon-btn" disabled={list.length <= 1} onClick={() => setList((l) => l.filter((_, j) => j !== i))} aria-label={t("ui.common.remove")}><Icon name="x" /></button></li>
      ))}</ol>
      <div><button type="button" className="btn btn--outline btn--sm" onClick={() => setList((l) => [...l, ""])}><Icon name="plus" /><span>{t("ui.food.addStation")}</span></button></div>
      <Field label={t("ui.food.delayAfter")} error={sub.fieldErrors.delayMinutes}><input className="input" type="number" min="1" max="600" value={delay} onChange={(e) => setDelay(e.target.value)} /></Field>
      {sub.fieldErrors.stations && <p className="form-status form-status--error">{t(`ui.errors.${sub.fieldErrors.stations}`)}</p>}
      {saved && <p className="form-status form-status--success">{t("ui.common.saved")}</p>}
      <div className="form-actions"><button type="button" className="btn btn--primary" disabled={sub.busy} onClick={save}>{t("ui.common.save")}</button></div>
    </section>
  );
}

/* ===================== Tables and orders ===================== */
export function TablesPage() {
  const { t } = useLanguage();
  const can = usePerm();
  const profile = useProfile();
  const [tab, setTab] = useState(profile.food?.tables ? "tables" : "orders");
  return (
    <div className="page">
      <PageHeader icon="grid" title={t("app.modules.tables")} actions={<Link className="btn btn--primary" to="/app/m/pos"><Icon name="plus" /><span>{t("ui.food.newOrder")}</span></Link>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        ...(profile.food?.tables ? [{ id: "tables", label: t("ui.food.tables"), icon: "grid" }] : []),
        { id: "orders", label: t("ui.food.openOrders"), icon: "receipt" }, { id: "history", label: t("ui.food.orderHistory"), icon: "history" },
        ...(profile.food?.tables && can("tables.manage") ? [{ id: "setup", label: t("ui.food.tableSetup"), icon: "settings" }] : [])]} />
      {tab === "tables" ? <TableMap /> : tab === "setup" ? <TableSetup /> : <OrderBoard closed={tab === "history"} />}
    </div>
  );
}

function TableMap() {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const errText = useErrorText();
  const d = useApi("/api/food/tables");
  const [err, setErr] = useState(null);
  useEffect(() => { const h = setInterval(() => d.reload(), 20000); return () => clearInterval(h); }, [d.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const setStatus = async (tb, status) => { setErr(null); try { await apiRequest(`/api/food/tables/${tb.id}/status`, { method: "POST", body: { status } }); d.reload(); } catch (e) { setErr(e); } };
  const list = d.data?.tables || [];
  const areas = [...new Set(list.map((x) => x.area || ""))];
  return (
    <>
      <div className="table-legend">{["available", "occupied", "reserved", "cleaning"].map((s) => <span key={s} className={`tstatus is-${s}`}>{t(`ui.food.tableStatus.${s}`)} · {list.filter((x) => x.status === s).length}</span>)}</div>
      {err && <p className="form-status form-status--error">{errText(err)}</p>}
      {d.loading && !d.data ? <Loading /> : !list.length ? <EmptyState icon="grid" text={t("ui.food.noTables")} /> : areas.map((a) => (
        <section key={a} className="table-area">
          {a && <h3>{a}</h3>}
          <div className="table-map">
            {list.filter((x) => (x.area || "") === a).map((tb) => (
              <div key={tb.id} className={`table-card is-${tb.status}`}>
                <Link to={`/app/m/pos?table=${tb.id}`} className="table-card__main">
                  <strong>{tb.name}</strong>
                  <small>{fill(t("ui.food.seats"), { n: tb.capacity })} · {t(`ui.food.tableStatus.${tb.status}`)}</small>
                  {tb.orders.map((o) => <span key={o.id} className="table-card__order">{o.number} · {m(o.total)}{o.paid ? ` · ${t("ui.food.paidShort")}` : ""}{o.guests ? ` · ${fill(t("ui.food.guestsN"), { n: o.guests })}` : ""}</span>)}
                </Link>
                {can("sales.create") && !tb.orders.length && (
                  <div className="table-card__acts">
                    {tb.status !== "available" && <button type="button" className="link-btn" onClick={() => setStatus(tb, "available")}>{t("ui.food.setAvailable")}</button>}
                    {tb.status === "available" && <button type="button" className="link-btn" onClick={() => setStatus(tb, "reserved")}>{t("ui.food.setReserved")}</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function OrderBoard({ closed }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const profile = useProfile();
  const errText = useErrorText();
  const [service, setService] = useState("");
  const [q, setQ] = useState("");
  const [range, setRange] = useState({ from: daysAgo(6), to: isoDate(new Date()) });
  const list = useApi(`/api/food/orders?${new URLSearchParams({ status: closed ? "closed" : "open", service, q, ...(closed ? range : {}) })}`);
  const [split, setSplit] = useState(null);
  const [err, setErr] = useState(null);
  const act = async (o, path, body) => { setErr(null); try { await apiRequest(`/api/food/orders/${o.id}/${path}`, { method: "POST", body }); list.reload(); } catch (e) { setErr(e); } };
  const rows = list.data?.orders || [];
  return (
    <>
      <div className="toolbar">
        {closed && <DateRange value={range} onChange={setRange} />}
        <SearchBox value={q} onChange={setQ} placeholder={t("ui.food.searchOrders")} />
        <select className="input input--auto" value={service} onChange={(e) => setService(e.target.value)} aria-label={t("ui.food.service")}>
          <option value="">{t("ui.food.allServices")}</option>
          {(profile.food?.services || []).map((s) => <option key={s} value={s}>{t(`ui.food.services.${s}`)}</option>)}
        </select>
      </div>
      {err && <p className="form-status form-status--error">{errText(err)}</p>}
      {list.loading && !list.data ? <Loading /> : !rows.length ? <EmptyState icon="receipt" text={t(closed ? "ui.common.noResults" : "ui.food.noOpenOrders")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.food.order")}</th><th>{t("ui.food.service")}</th><th>{t("ui.common.items")}</th><th>{t("ui.common.status")}</th><th className="num">{t("ui.common.total")}</th><th>{t("ui.food.payment")}</th><th /></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.id}>
              <td><strong>{o.number}</strong><small className="cell-sub">{date(o.createdAt, lang, true)}{o.user ? ` · ${o.user}` : ""}</small></td>
              <td>{t(`ui.food.services.${o.service}`)}{o.table && <small className="cell-sub">{t("ui.food.table")} {o.table}</small>}{o.customer && <small className="cell-sub">{o.customer}{o.phone ? ` · ${o.phone}` : ""}</small>}
                {o.service === "delivery" && <small className="cell-sub">{o.deliveryAddress}{o.driver ? ` · ${o.driver}` : ""}</small>}</td>
              <td><ul className="mini-lines">{o.items.filter((i) => i.status !== "cancelled").map((i) => <li key={i.id}>{qty(i.qty)} × {i.name}</li>)}</ul></td>
              <td><span className={`food-status is-${o.status}`}>{t(`ui.food.status.${o.status}`)}</span>{o.cancelReason && <small className="cell-sub">{o.cancelReason}</small>}</td>
              <td className="num">{m(o.total)}</td>
              <td>{o.saleId ? <Link to={`/app/sales/${o.saleId}`}>{o.receiptNo}</Link> : <span className="muted">{t("ui.food.unpaid")}</span>}{o.balance > 0 && <small className="cell-sub is-neg">{t("ui.common.balance")} {m(o.balance)}</small>}</td>
              <td className="row-actions">
                {!closed && <Link className="btn btn--outline btn--sm" to={`/app/m/pos?order=${o.id}`}>{t("ui.common.view")}</Link>}
                {!closed && !o.saleId && o.items.filter((i) => i.status !== "cancelled").length > 1 && <button type="button" className="btn btn--outline btn--sm" onClick={() => setSplit(o)}>{t("ui.food.splitBill")}</button>}
                {!closed && o.service === "delivery" && o.status !== "delivered" && <button type="button" className="btn btn--outline btn--sm" onClick={() => act(o, "status", { status: "delivered" })}>{t("ui.food.markDelivered")}</button>}
                {!closed && o.saleId && <button type="button" className="btn btn--primary btn--sm" onClick={() => act(o, "status", { status: "completed" })}>{t("ui.food.complete")}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {split && <SplitBill order={split} onClose={() => setSplit(null)} onDone={() => { setSplit(null); list.reload(); }} />}
    </>
  );
}

function SplitBill({ order, onClose, onDone }) {
  const { t } = useLanguage();
  const m = useMoney();
  const items = order.items.filter((i) => i.status !== "cancelled");
  const [take, setTake] = useState({});
  const sub = useSubmit();
  const moving = Object.entries(take).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ id: Number(id), qty: Number(v) }));
  const total = r4(moving.reduce((s, x) => s + x.qty * items.find((i) => i.id === x.id).unitPrice, 0));
  const save = async () => { if (await sub.run(() => apiRequest(`/api/food/orders/${order.id}/split`, { method: "POST", body: { items: moving } }))) onDone(); };
  return (
    <Modal title={fill(t("ui.food.splitTitle"), { n: order.number })} onClose={onClose}>
      <div className="form-grid">
        <p className="modal__help">{t("ui.food.splitHelp")}</p>
        <ul className="receive-list">{items.map((i) => (
          <li key={i.id}><strong>{i.name}</strong><span>{menuText(t, i)} · {m(i.unitPrice)}</span>
            <input className="input input--sm" type="number" min="0" max={i.qty} step="1" value={take[i.id] ?? ""} onChange={(e) => setTake({ ...take, [i.id]: e.target.value })} placeholder={`0 / ${qty(i.qty)}`} aria-label={t("ui.common.qty")} /></li>
        ))}</ul>
        <p className="muted">{fill(t("ui.food.newBillTotal"), { amount: m(total) })}</p>
        <FormError error={sub.formError} />
        {sub.fieldErrors.items && <p className="form-status form-status--error">{t(`ui.errors.${sub.fieldErrors.items}`)}</p>}
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="button" className="btn btn--primary" disabled={!moving.length || sub.busy} onClick={save}>{t("ui.food.splitBill")}</button>
        </div>
      </div>
    </Modal>
  );
}

function TableSetup() {
  const { t } = useLanguage();
  const d = useApi("/api/food/tables");
  const [f, setF] = useState({ name: "", area: "", capacity: "4" });
  const [editing, setEditing] = useState(null);
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    const body = { name: f.name, area: f.area, capacity: Number(f.capacity) };
    if (await sub.run(() => apiRequest(editing ? `/api/food/tables/${editing}` : "/api/food/tables", { method: editing ? "PUT" : "POST", body }))) { setF({ name: "", area: f.area, capacity: f.capacity }); setEditing(null); d.reload(); }
  };
  const remove = async (tb) => { if (await sub.run(() => apiRequest(`/api/food/tables/${tb.id}`, { method: "PUT", body: { name: tb.name, area: tb.area, capacity: tb.capacity, isActive: false } }))) d.reload(); };
  return (
    <div className="split-view">
      <form onSubmit={save} className="panel-card form-grid">
        <h2 className="panel-card__title"><Icon name="plus" />{t(editing ? "ui.food.editTable" : "ui.food.addTable")}</h2>
        <Field label={t("ui.food.tableName")} error={sub.fieldErrors.name}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("ui.food.tableNamePh")} /></Field>
        <Field label={`${t("ui.food.area")} ${t("ui.common.optional")}`}><input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder={t("ui.food.areaPh")} /></Field>
        <Field label={t("ui.food.capacity")} error={sub.fieldErrors.capacity}><input className="input" type="number" min="1" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        <div className="form-actions">{editing && <button type="button" className="btn btn--outline" onClick={() => { setEditing(null); setF({ name: "", area: "", capacity: "4" }); }}>{t("ui.common.cancel")}</button>}
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
      <section className="panel-card">
        {!d.data ? <Loading /> : !d.data.tables.length ? <EmptyState icon="grid" text={t("ui.food.noTables")} /> : (
          <table className="table table--compact"><thead><tr><th>{t("ui.food.tableName")}</th><th>{t("ui.food.area")}</th><th className="num">{t("ui.food.capacity")}</th><th /></tr></thead>
            <tbody>{d.data.tables.map((tb) => (
              <tr key={tb.id}><td><strong>{tb.name}</strong></td><td>{tb.area || "—"}</td><td className="num">{tb.capacity}</td>
                <td className="row-actions"><button type="button" className="link-btn" onClick={() => { setEditing(tb.id); setF({ name: tb.name, area: tb.area, capacity: String(tb.capacity) }); }}>{t("ui.common.edit")}</button>
                  {!tb.orders.length && <button type="button" className="link-btn" onClick={() => remove(tb)}>{t("ui.common.remove")}</button>}</td></tr>
            ))}</tbody></table>
        )}
      </section>
    </div>
  );
}

/* ===================== Menu & recipes ===================== */
const KINDS = ["menu", "modifier", "prepared", "goods", "ingredient", "packaging"];

export function MenuPage() {
  const { t } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const errText = useErrorText();
  const [kind, setKind] = useState("menu");
  const [q, setQ] = useState("");
  const list = useApi(`/api/products?kind=${kind}&active=all`);
  const menu = useApi("/api/food/menu");
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [producing, setProducing] = useState(null);
  const [err, setErr] = useState(null);
  const info = new Map((menu.data?.items || []).map((x) => [x.id, x]));
  const rows = (list.data?.products || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = async (p) => { setErr(null); try { await apiRequest(`/api/food/menu/${p.id}/availability`, { method: "POST", body: { available: !p.available } }); list.reload(); menu.reload(); } catch (e) { setErr(e); } };
  const showCost = can("products.edit") || can("dashboard.finance");
  return (
    <div className="page">
      <PageHeader icon="book-open" title={t("app.modules.menu")} actions={can("products.edit") && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" /><span>{t(`ui.food.addKind.${kind}`)}</span></button>} />
      <p className="page-help"><Icon name="info" /> {t("ui.food.menuHelp")}</p>
      <div className="fpos-cats">{KINDS.map((k) => <button key={k} type="button" className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>{t(`ui.food.kinds.${k}`)}</button>)}</div>
      <div className="toolbar"><SearchBox value={q} onChange={setQ} /></div>
      {err && <p className="form-status form-status--error">{errText(err)}</p>}
      {list.loading && !list.data ? <Loading /> : !rows.length ? <EmptyState icon="book-open" text={t(`ui.food.noneKind.${kind}`)} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.common.name")}</th><th>{t("ui.common.category")}</th>
            {["menu", "modifier", "goods"].includes(kind) && <th className="num">{t("ui.food.price")}</th>}
            {["menu", "modifier", "prepared"].includes(kind) && showCost && <><th className="num">{t("ui.food.recipeCost")}</th>{kind !== "prepared" && <th className="num">{t("ui.food.margin")}</th>}</>}
            {["menu", "modifier"].includes(kind) && <th>{t("ui.food.station")}</th>}
            {!["menu", "modifier"].includes(kind) && <th className="num">{t("ui.food.inStock")}</th>}
            {["menu", "modifier", "goods"].includes(kind) && <th>{t("ui.food.onMenu")}</th>}<th /></tr></thead>
          <tbody>{rows.map((p) => {
            const x = info.get(p.id);
            const cost = x?.recipeCost ?? null;
            const margin = cost !== null && p.sellingPrice > 0 ? Math.round(((p.sellingPrice - cost) / p.sellingPrice) * 1000) / 10 : null;
            return (
              <tr key={p.id} className={!p.isActive ? "is-muted" : ""}>
                <td><strong>{p.name}</strong>{x?.sizes?.length > 0 && <small className="cell-sub">{x.sizes.map((s) => `${s.name} ${m(s.price)}`).join(" · ")}</small>}
                  {x?.extras?.length > 0 && <small className="cell-sub">+ {x.extras.map((e) => e.name).join(", ")}</small>}{!p.isActive && <small className="cell-sub">{t("ui.products.statusValues.archived")}</small>}</td>
                <td>{p.category || "—"}</td>
                {["menu", "modifier", "goods"].includes(kind) && <td className="num">{m(p.sellingPrice)}</td>}
                {["menu", "modifier", "prepared"].includes(kind) && showCost && <>
                  <td className="num">{cost === null ? <span className="muted">{t("ui.food.noRecipe")}</span> : m(cost)}</td>
                  {kind !== "prepared" && <td className={"num" + (margin !== null && margin < 50 ? " is-neg" : "")}>{margin === null ? "—" : `${margin}%`}</td>}</>}
                {["menu", "modifier"].includes(kind) && <td>{p.station || "—"}</td>}
                {!["menu", "modifier"].includes(kind) && <td className="num">{qty(p.stock)} {p.unit}</td>}
                {["menu", "modifier", "goods"].includes(kind) && <td><label className="switch-line"><input type="checkbox" checked={p.available} disabled={!can("products.edit") && !can("kitchen.update")} onChange={() => toggle(p)} /><span>{t(p.available ? "ui.food.available" : "ui.food.soldOut")}</span></label></td>}
                <td className="row-actions">
                  {["menu", "modifier", "prepared"].includes(kind) && <button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(p)}><Icon name="book-open" /><span>{t(kind === "menu" ? "ui.food.recipeOptions" : "ui.food.recipe")}</span></button>}
                  {kind === "prepared" && can("stock.add") && <button type="button" className="btn btn--outline btn--sm" onClick={() => setProducing(p)}>{t("ui.food.makeBatch")}</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {open && <MenuEditor product={open} onClose={() => setOpen(null)} onSaved={() => { list.reload(); menu.reload(); }} />}
      {creating && <ProductForm product={{ itemKind: kind, unit: ["menu", "modifier"].includes(kind) ? "portion" : "pcs" }} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); list.reload(); menu.reload(); }} />}
      {producing && <Production product={producing} onClose={() => setProducing(null)} onDone={() => { setProducing(null); list.reload(); }} />}
    </div>
  );
}

/** Recipe (new version on save, history) and, for menu items, sizes / extras / station. */
function MenuEditor({ product, onClose, onSaved }) {
  const { t, lang } = useLanguage();
  const m = useMoney();
  const can = usePerm();
  const profile = useProfile();
  const isMenu = product.itemKind === "menu";
  const [tab, setTab] = useState("recipe");
  const d = useApi(`/api/food/recipes/${product.id}`);
  const ings = useApi("/api/food/ingredients");
  const settings = useApi("/api/food/settings");
  const extrasList = useApi(isMenu ? "/api/products?kind=modifier" : null);
  const [lines, setLines] = useState(null);
  const [yieldQty, setYield] = useState("1");
  const [notes, setNotes] = useState("");
  const [viewing, setViewing] = useState(null);       // an older version
  const [opts, setOpts] = useState(null);
  const [saved, setSaved] = useState("");
  const sub = useSubmit();
  const edit = can("products.edit");
  useEffect(() => {
    if (!d.data || lines) return;
    const r = d.data.recipe;
    setLines((r?.lines || []).map((l) => ({ ingredientId: l.ingredientId, qty: String(l.qty), unit: l.unit, optional: l.optional, service: l.service })));
    setYield(String(r?.yieldQty ?? 1)); setNotes(r?.notes || "");
  }, [d.data, lines]);
  useEffect(() => { if (!opts) setOpts({ sizes: (product.menuOptions?.sizes || []).map((s) => ({ name: s.name, price: String(s.price), factor: String(s.factor ?? 1) })), extras: product.menuOptions?.extras || [], station: product.station || "" }); }, [product, opts]);
  const byId = useMemo(() => new Map((ings.data?.items || []).map((x) => [x.id, x])), [ings.data]);
  const options = (ings.data?.items || []).filter((x) => x.id !== product.id).map((x) => ({ value: x.id, label: x.name, sub: `${t(`ui.food.kinds.${x.kind}`)} · ${x.unit}${x.cost !== undefined ? ` · ${m(x.cost)} / ${x.unit}` : ""}` }));
  const conv = { mg: 0.001, g: 1, kg: 1000, ml: 1, cl: 10, liter: 1000 };
  const lineCost = (l) => {
    const ing = byId.get(Number(l.ingredientId));
    if (!ing || ing.cost === undefined || !(Number(l.qty) > 0)) return null;
    const f = l.unit === ing.unit ? 1 : conv[l.unit] && conv[ing.unit] ? conv[l.unit] / conv[ing.unit] : null;
    return f === null ? null : r4(Number(l.qty) * f * ing.cost);
  };
  const total = r4((lines || []).filter((l) => l.service !== "takeaway").reduce((s, l) => s + (lineCost(l) || 0), 0) / (Number(yieldQty) || 1));
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const saveRecipe = async () => {
    const r = await sub.run(() => apiRequest(`/api/food/recipes/${product.id}`, { method: "PUT", body: { yieldQty, notes, lines: lines.filter((l) => l.ingredientId) } }));
    if (r) { setSaved(fill(t("ui.food.versionSaved"), { n: r.version })); d.reload(); onSaved(); }
  };
  const saveOptions = async () => {
    const body = { sizes: opts.sizes.filter((s) => s.name.trim()), extras: opts.extras, station: opts.station };
    if (await sub.run(() => apiRequest(`/api/food/menu/${product.id}/options`, { method: "PUT", body }))) { setSaved(t("ui.common.saved")); onSaved(); }
  };
  const err = sub.fieldErrors;
  return (
    <Modal title={product.name} onClose={onClose} wide>
      <div className="form-grid">
        <Tabs value={tab} onChange={(x) => { setTab(x); setSaved(""); sub.setFormError(null); }} tabs={[{ id: "recipe", label: t("ui.food.recipe"), icon: "book-open" },
          ...(isMenu ? [{ id: "options", label: t("ui.food.sizesExtras"), icon: "layers" }] : []), { id: "history", label: t("ui.food.versions"), icon: "history" }]} />
        {tab === "recipe" && (!lines || !ings.data ? <Loading /> : (
          <>
            <p className="modal__help">{t(product.itemKind === "prepared" ? "ui.food.recipeHelpPrepared" : "ui.food.recipeHelp")}</p>
            <div className="recipe-lines">
              {lines.map((l, i) => {
                const ing = byId.get(Number(l.ingredientId));
                const c = lineCost(l);
                return (
                  <div key={i} className="recipe-line">
                    <SearchSelect value={l.ingredientId} onChange={(v) => { const x = byId.get(Number(v)); setLine(i, { ingredientId: v, unit: x?.unit || l.unit }); }} options={options} placeholder={t("ui.food.ingredient")} searchPlaceholder={t("ui.common.searchPh")} invalid={Boolean(err[`lines.${i}.ingredientId`])} />
                    <input className={"input input--sm" + (err[`lines.${i}.qty`] ? " has-error" : "")} type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} placeholder={t("ui.common.qty")} aria-label={t("ui.common.qty")} disabled={!edit} />
                    <select className={"input input--sm" + (err[`lines.${i}.unit`] ? " has-error" : "")} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label={t("ui.products.unit")} disabled={!edit}>
                      {(ing?.units || [l.unit]).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <select className="input input--sm" value={l.service} onChange={(e) => setLine(i, { service: e.target.value })} aria-label={t("ui.food.when")} disabled={!edit}>
                      {["all", "takeaway", "dine_in"].map((s) => <option key={s} value={s}>{t(`ui.food.lineService.${s}`)}</option>)}
                    </select>
                    <label className="checkbox recipe-line__opt" title={t("ui.food.optionalHint")}><input type="checkbox" checked={l.optional} onChange={(e) => setLine(i, { optional: e.target.checked })} disabled={!edit} /><span>{t("ui.food.optional")}</span></label>
                    <span className="num recipe-line__cost">{c === null ? "" : m(c)}</span>
                    {edit && <button type="button" className="icon-btn" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={t("ui.common.remove")}><Icon name="x" /></button>}
                    {err[`lines.${i}.unit`] && <span className="ff__error recipe-line__err">{t(`ui.errors.${err[`lines.${i}.unit`]}`)}</span>}
                  </div>
                );
              })}
            </div>
            {edit && <div><button type="button" className="btn btn--outline btn--sm" onClick={() => setLines((ls) => [...ls, { ingredientId: "", qty: "", unit: "", optional: false, service: "all" }])}><Icon name="plus" /><span>{t("ui.food.addIngredient")}</span></button></div>}
            <div className="form-grid form-grid--2">
              <Field label={t(product.itemKind === "prepared" ? "ui.food.batchMakes" : "ui.food.recipeMakes")} hint={fill(t("ui.food.yieldHint"), { unit: product.unit })} error={err.yieldQty}>
                <input className="input" type="number" min="0" step="any" value={yieldQty} onChange={(e) => setYield(e.target.value)} disabled={!edit} />
              </Field>
              <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("ui.food.recipeNotesPh")} disabled={!edit} /></Field>
            </div>
            {d.data.cost !== undefined && (
              <dl className="adj-preview">
                <div><dt>{fill(t("ui.food.costPer"), { unit: product.unit })}</dt><dd>{m(total)}</dd></div>
                {d.data.takeawayCost !== null && d.data.takeawayCost !== d.data.cost && <div><dt>{t("ui.food.takeawayCost")}</dt><dd>{m(d.data.takeawayCost)}</dd></div>}
                {product.sellingPrice > 0 && isMenu && <div><dt>{t("ui.food.price")}</dt><dd>{m(product.sellingPrice)}</dd></div>}
                {product.sellingPrice > 0 && isMenu && <div className="is-total"><dt>{t("ui.food.grossProfit")}</dt><dd className={product.sellingPrice - total >= 0 ? "is-pos" : "is-neg"}>{m(r4(product.sellingPrice - total))}</dd></div>}
              </dl>
            )}
            {err.lines && <p className="form-status form-status--error">{t(`ui.errors.${err.lines}`)}</p>}
            <FormError error={sub.formError} />
            {saved && <p className="form-status form-status--success">{saved}</p>}
            {edit && <div className="form-actions sheet-actions"><button type="button" className="btn btn--primary" disabled={sub.busy} onClick={saveRecipe}>{t("ui.food.saveRecipe")}</button></div>}
          </>
        ))}
        {tab === "options" && opts && (
          <>
            <div className="ff ff--full"><span className="ff__label">{t("ui.food.sizes")}</span><small className="ff__hint">{t("ui.food.sizesHint")}</small>
              {opts.sizes.map((s, i) => (
                <div key={i} className="size-row">
                  <input className={"input input--sm" + (err[`sizes.${i}.name`] ? " has-error" : "")} value={s.name} onChange={(e) => setOpts({ ...opts, sizes: opts.sizes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={t("ui.food.sizeName")} disabled={!edit} />
                  <input className={"input input--sm" + (err[`sizes.${i}.price`] ? " has-error" : "")} type="number" min="0" step="any" value={s.price} onChange={(e) => setOpts({ ...opts, sizes: opts.sizes.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} placeholder={t("ui.food.price")} disabled={!edit} />
                  <input className={"input input--sm" + (err[`sizes.${i}.factor`] ? " has-error" : "")} type="number" min="0" step="any" value={s.factor} onChange={(e) => setOpts({ ...opts, sizes: opts.sizes.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)) })} placeholder={t("ui.food.factor")} title={t("ui.food.factorHint")} disabled={!edit} />
                  {edit && <button type="button" className="icon-btn" onClick={() => setOpts({ ...opts, sizes: opts.sizes.filter((_, j) => j !== i) })} aria-label={t("ui.common.remove")}><Icon name="x" /></button>}
                </div>
              ))}
              {edit && <div><button type="button" className="btn btn--outline btn--sm" onClick={() => setOpts({ ...opts, sizes: [...opts.sizes, { name: "", price: String(product.sellingPrice || ""), factor: "1" }] })}><Icon name="plus" /><span>{t("ui.food.addSize")}</span></button></div>}
            </div>
            <div className="ff ff--full"><span className="ff__label">{t("ui.food.allowedExtras")}</span>
              {(extrasList.data?.products || []).length === 0 ? <small className="muted">{t("ui.food.noExtras")}</small> : (
                <div className="chip-pick">{extrasList.data.products.map((x) => (
                  <button key={x.id} type="button" disabled={!edit} aria-pressed={opts.extras.includes(x.id)} onClick={() => setOpts({ ...opts, extras: opts.extras.includes(x.id) ? opts.extras.filter((e) => e !== x.id) : [...opts.extras, x.id] })}>+ {x.name} · {m(x.sellingPrice)}</button>
                ))}</div>
              )}
            </div>
            <Field label={t("ui.food.station")}>
              <select className="input" value={opts.station} onChange={(e) => setOpts({ ...opts, station: e.target.value })} disabled={!edit}>
                <option value="">—</option>
                {(settings.data?.stations || profile.food?.stations || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <FormError error={sub.formError} />
            {saved && <p className="form-status form-status--success">{saved}</p>}
            {edit && <div className="form-actions sheet-actions"><button type="button" className="btn btn--primary" disabled={sub.busy} onClick={saveOptions}>{t("ui.common.save")}</button></div>}
          </>
        )}
        {tab === "history" && (!d.data ? <Loading /> : !d.data.versions.length ? <EmptyState text={t("ui.food.noRecipe")} /> : (
          <>
            <ul className="timeline">{d.data.versions.map((v) => (
              <li key={v.id}><button type="button" className="link-btn" onClick={() => apiRequest(`/api/food/recipes/${product.id}/versions/${v.id}`).then((x) => setViewing(x.recipe))}>
                <strong>{fill(t("ui.food.versionN"), { n: v.version })}{v.current ? ` · ${t("ui.food.current")}` : ""}</strong></button>
                <small>{date(v.at, lang, true)}{v.user ? ` · ${v.user}` : ""}</small></li>
            ))}</ul>
            {viewing && (
              <div className="panel-card"><h3 className="panel-card__title">{fill(t("ui.food.versionN"), { n: viewing.version })}</h3>
                <ul className="pay-list">{viewing.lines.map((l) => <li key={l.id}>{qty(l.qty)} {l.unit} · {l.name}{l.optional ? ` · ${t("ui.food.optional")}` : ""}{l.service !== "all" ? ` · ${t(`ui.food.lineService.${l.service}`)}` : ""}</li>)}</ul>
                {viewing.yieldQty !== 1 && <p className="muted">{fill(t("ui.food.makesN"), { n: viewing.yieldQty, unit: product.unit })}</p>}</div>
            )}
          </>
        ))}
      </div>
    </Modal>
  );
}

/** Batch of a prepared item (sauce, dough…): its recipe's ingredients are used, the item goes into stock. */
function Production({ product, onClose, onDone }) {
  const { t } = useLanguage();
  const m = useMoney();
  const errText = useErrorText();
  const [n, setN] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState(null);
  const sub = useSubmit();
  const save = async () => { const r = await sub.run(() => apiRequest("/api/food/production", { method: "POST", body: { productId: product.id, qty: n, note } })); if (r) setResult(r); };
  return (
    <Modal title={fill(t("ui.food.makeTitle"), { name: product.name })} onClose={result ? onDone : onClose}>
      <div className="form-grid">
        {result ? <p className="form-status form-status--success">{fill(t("ui.food.made"), { qty: qty(n), unit: product.unit, cost: m(result.cost), each: m(result.unitCost) })}</p> : (
          <>
            <p className="modal__help">{t("ui.food.makeHelp")}</p>
            <Field label={`${t("ui.common.qty")} (${product.unit})`} error={sub.fieldErrors.qty}><input className="input" type="number" min="0" step="any" value={n} onChange={(e) => setN(e.target.value)} /></Field>
            <Field label={`${t("ui.common.notes")} ${t("ui.common.optional")}`}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {sub.formError && !sub.formError.errors && <p className="form-status form-status--error">{errText(sub.formError)}</p>}
          </>
        )}
        <div className="form-actions sheet-actions">
          {result ? <button type="button" className="btn btn--primary" onClick={onDone}>{t("ui.common.close")}</button> : <>
            <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
            <button type="button" className="btn btn--primary" disabled={!(Number(n) > 0) || sub.busy} onClick={save}>{t("ui.food.makeBatch")}</button></>}
        </div>
      </div>
    </Modal>
  );
}
