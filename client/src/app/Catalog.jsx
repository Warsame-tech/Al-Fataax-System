import { useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { Modal, Tabs, Field, FormError, Loading, useSubmit, useErrorText, useMoney } from "./ui.jsx";
import { fill } from "./format.js";
import { useProfile, productLabel } from "./profile.js";
import { useCatalog } from "./catalog.js";
import { Swatch } from "./SearchSelect.jsx";

/*
 * Products → Product lists: register once, pick from dropdowns in the product form.
 * Every business: categories (+ subcategories), brands, units. Clothing also: colours, sizes, collections, seasons.
 * Ready-made values of the business type are shown first (they can't be removed); the business adds its own.
 */
export function ProductLists({ onClose }) {
  const { t } = useLanguage();
  const profile = useProfile();
  const cat = useCatalog();
  const tabs = [
    { id: "category", label: t("ui.lists.tabs.category"), icon: "layers" },
    { id: "brand", label: t("ui.lists.tabs.brand"), icon: "sparkles" },
    { id: "unit", label: t("ui.lists.tabs.unit"), icon: "package" },
    ...(profile.jewelry ? [{ id: "purity", label: t("ui.lists.tabs.purity"), icon: "gem" }] : []),
    ...(profile.fashion ? [
      { id: "color", label: t("ui.lists.tabs.color"), icon: "image" },
      { id: "size", label: t("ui.lists.tabs.size"), icon: "grid" },
      { id: "collection", label: t("ui.lists.tabs.collection"), icon: "book-open" },
      { id: "season", label: t("ui.lists.tabs.season"), icon: "calendar" }
    ] : [])
  ];
  const [tab, setTab] = useState("category");
  return (
    <Modal title={t("ui.lists.title")} onClose={onClose} wide>
      <p className="modal__help">{t("ui.lists.help")}</p>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {cat.loading ? <Loading /> : (
        <>
          {tab === "category" && <CategoryList cat={cat} />}
          {tab === "brand" && <SimpleList cat={cat} kind="brand" own={cat.raw.brands} />}
          {tab === "unit" && <SimpleList cat={cat} kind="unit" own={cat.raw.options.unit} builtIn={(profile.units || []).map((u) => unitLabel(t, u))} />}
          {tab === "color" && <ColorList cat={cat} />}
          {tab === "purity" && <PurityList cat={cat} />}
          {tab === "size" && <SizeList cat={cat} />}
          {tab === "collection" && <SimpleList cat={cat} kind="collection" own={cat.raw.options.collection} />}
          {tab === "season" && <SimpleList cat={cat} kind="season" own={cat.raw.options.season} builtIn={cat.seasons.filter((s) => !cat.raw.options.season.some((x) => x.name === s))} />}
        </>
      )}
    </Modal>
  );
}

const unitLabel = (t, u) => (t(`ui.products.unitNames.${u}`).startsWith("ui.") ? u : t(`ui.products.unitNames.${u}`));

/* add / rename / delete one value */
function useListActions(cat, kind) {
  const sub = useSubmit();
  const errText = useErrorText();
  const add = (body) => sub.run(() => apiRequest(`/api/catalog/${kind}`, { method: "POST", body })).then((ok) => { if (ok) cat.reload(); return ok; });
  const rename = (itemId, body) => sub.run(() => apiRequest(`/api/catalog/${kind}/${itemId}`, { method: "PUT", body })).then((ok) => { if (ok) cat.reload(); return ok; });
  const remove = (itemId) => sub.run(() => apiRequest(`/api/catalog/${kind}/${itemId}`, { method: "DELETE" })).then((ok) => { if (ok) cat.reload(); return ok; });
  return { sub, errText, add, rename, remove };
}

function AddRow({ placeholder, onAdd, extra = null, busy }) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const go = async () => { if (!name.trim()) return; if (await onAdd(name.trim())) setName(""); };
  return (
    <div className="lists__add">
      {extra}
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }} />
      <button type="button" className="btn btn--primary" disabled={busy || !name.trim()} onClick={go}><Icon name="plus" /><span>{t("ui.common.add")}</span></button>
    </div>
  );
}

function OwnItem({ item, onRename, onRemove, children, count }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  return (
    <li className="lists__item">
      {children}
      {editing ? (
        <>
          <input className="input input--sm" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="button" className="btn btn--primary btn--sm" onClick={async () => { if (await onRename(name)) setEditing(false); }}>{t("ui.common.save")}</button>
          <button type="button" className="link-btn" onClick={() => { setEditing(false); setName(item.name); }}>{t("ui.common.cancel")}</button>
        </>
      ) : (
        <>
          <span className="lists__name">{item.name}</span>
          {count !== undefined && <small className="muted">{fill(t("ui.lists.usedBy"), { n: count })}</small>}
          <button type="button" className="icon-btn" title={t("ui.common.edit")} onClick={() => setEditing(true)}><Icon name="settings" /></button>
          <button type="button" className="icon-btn" title={t("ui.common.delete")} onClick={onRemove}><Icon name="trash" /></button>
        </>
      )}
    </li>
  );
}

function BuiltIn({ items }) {
  const { t } = useLanguage();
  if (!items?.length) return null;
  return (
    <div className="lists__builtin">
      <small className="muted">{t("ui.lists.builtIn")}</small>
      <ul className="chip-list">{items.map((x) => <li key={typeof x === "string" ? x : x.name}>{typeof x === "string" ? x : <><Swatch code={x.code} />{x.name}</>}</li>)}</ul>
    </div>
  );
}

function SimpleList({ cat, kind, own = [], builtIn = [] }) {
  const { t } = useLanguage();
  const a = useListActions(cat, kind);
  return (
    <div className="lists">
      <BuiltIn items={builtIn} />
      <ul className="lists__items">
        {own.length === 0 && <li className="muted">{t("ui.lists.noneYet")}</li>}
        {own.map((x) => <OwnItem key={x.id} item={x} count={x.products} onRename={(name) => a.rename(x.id, { name })} onRemove={() => a.remove(x.id)} />)}
      </ul>
      <AddRow placeholder={t(`ui.lists.add.${kind}`)} busy={a.sub.busy} onAdd={(name) => a.add({ name })} />
      {a.sub.formError && <p className="form-status form-status--error">{a.errText(a.sub.formError)}</p>}
    </div>
  );
}

function CategoryList({ cat }) {
  const { t } = useLanguage();
  const profile = useProfile();
  const cats = useListActions(cat, "category");
  const subs = useListActions(cat, "subcategory");
  const [open, setOpen] = useState(cat.categories[0] || "");
  const ownCats = cat.raw.categories;
  const builtInNames = Object.keys(profile.categories || {});
  const ownSubs = cat.raw.options.subcategory.filter((s) => s.parent === open);
  return (
    <div className="lists lists--two">
      <div>
        <h4>{t("ui.lists.tabs.category")}</h4>
        <ul className="lists__items lists__items--pick">
          {cat.categories.map((name) => {
            const own = ownCats.find((c) => c.name === name);
            return (
              <li key={name} className={"lists__item" + (open === name ? " is-open" : "")}>
                <button type="button" className="lists__name link-btn" onClick={() => setOpen(name)}>{name}</button>
                {!own || builtInNames.includes(name) ? <small className="muted">{t("ui.lists.readyMade")}</small> : (
                  <>
                    <small className="muted">{fill(t("ui.lists.usedBy"), { n: own.products })}</small>
                    <button type="button" className="icon-btn" title={t("ui.common.delete")} onClick={() => cats.remove(own.id)}><Icon name="trash" /></button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <AddRow placeholder={t("ui.lists.add.category")} busy={cats.sub.busy} onAdd={(name) => cats.add({ name }).then((ok) => { if (ok) setOpen(name); return ok; })} />
        {cats.sub.formError && <p className="form-status form-status--error">{cats.errText(cats.sub.formError)}</p>}
      </div>
      <div>
        <h4>{fill(t("ui.lists.subcategoriesOf"), { name: open || "…" })}</h4>
        {open && (
          <>
            <BuiltIn items={(profile.categories || {})[open] || []} />
            <ul className="lists__items">
              {ownSubs.length === 0 && <li className="muted">{t("ui.lists.noneYet")}</li>}
              {ownSubs.map((x) => <OwnItem key={x.id} item={x} onRename={(name) => subs.rename(x.id, { name })} onRemove={() => subs.remove(x.id)} />)}
            </ul>
            <AddRow placeholder={t("ui.lists.add.subcategory")} busy={subs.sub.busy} onAdd={(name) => subs.add({ name, parent: open })} />
            {subs.sub.formError && <p className="form-status form-status--error">{subs.errText(subs.sub.formError)}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function PurityList({ cat }) {
  const { t } = useLanguage();
  const profile = useProfile();
  const a = useListActions(cat, "purity");
  const metals = profile.metals || ["gold", "silver"];
  const [metal, setMetal] = useState(metals[0]);
  const own = (cat.raw.options.purity || []).filter((p) => p.parent === metal);
  return (
    <div className="lists">
      <Field label={t("ui.jewelry.metal")}>
        <select className="input" value={metal} onChange={(e) => setMetal(e.target.value)}>{metals.map((x) => <option key={x} value={x}>{t(`ui.jewelry.metals.${x}`)}</option>)}</select>
      </Field>
      <BuiltIn items={(profile.purities || {})[metal] || []} />
      <ul className="lists__items">
        {own.length === 0 && <li className="muted">{t("ui.lists.noneYet")}</li>}
        {own.map((x) => <OwnItem key={x.id} item={x} onRename={(name) => a.rename(x.id, { name })} onRemove={() => a.remove(x.id)} />)}
      </ul>
      <AddRow placeholder={t("ui.lists.add.purity")} busy={a.sub.busy} onAdd={(name) => a.add({ name, parent: metal })} />
      {a.sub.formError && <p className="form-status form-status--error">{a.errText(a.sub.formError)}</p>}
    </div>
  );
}

function ColorList({ cat }) {
  const { t } = useLanguage();
  const profile = useProfile();
  const a = useListActions(cat, "color");
  const [code, setCode] = useState("#2563eb");
  const own = cat.raw.options.color;
  return (
    <div className="lists">
      <BuiltIn items={(profile.colors || []).map(([name, c]) => ({ name, code: c }))} />
      <ul className="lists__items">
        {own.length === 0 && <li className="muted">{t("ui.lists.noneYet")}</li>}
        {own.map((x) => (
          <OwnItem key={x.id} item={x} onRename={(name) => a.rename(x.id, { name, code: x.code })} onRemove={() => a.remove(x.id)}>
            <input type="color" className="lists__color" value={x.code || "#ffffff"} onChange={(e) => a.rename(x.id, { name: x.name, code: e.target.value })} aria-label={t("ui.lists.colorCode")} />
          </OwnItem>
        ))}
      </ul>
      <AddRow placeholder={t("ui.lists.add.color")} busy={a.sub.busy} onAdd={(name) => a.add({ name, code })}
        extra={<input type="color" className="lists__color" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("ui.lists.colorCode")} />} />
      {a.sub.formError && <p className="form-status form-status--error">{a.errText(a.sub.formError)}</p>}
    </div>
  );
}

function SizeList({ cat }) {
  const { t } = useLanguage();
  const profile = useProfile();
  const a = useListActions(cat, "size");
  const systems = Object.keys(cat.sizeSystems);
  const [system, setSystem] = useState(systems[0] || "");
  const [newSystem, setNewSystem] = useState("");
  const own = cat.raw.options.size.filter((s) => s.parent === system);
  const usedBy = Object.entries(profile.categorySizes || {}).filter(([, s]) => s === system).map(([c]) => c);
  return (
    <div className="lists">
      <Field label={t("ui.lists.sizeSystem")}>
        <select className="input" value={system} onChange={(e) => setSystem(e.target.value)}>{systems.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </Field>
      {usedBy.length > 0 && <small className="muted">{fill(t("ui.lists.systemUsedBy"), { list: usedBy.join(", ") })}</small>}
      <BuiltIn items={(profile.sizeSystems || {})[system] || []} />
      <ul className="lists__items">
        {own.length === 0 && <li className="muted">{t("ui.lists.noneYet")}</li>}
        {own.map((x) => <OwnItem key={x.id} item={x} onRename={(name) => a.rename(x.id, { name })} onRemove={() => a.remove(x.id)} />)}
      </ul>
      <AddRow placeholder={t("ui.lists.add.size")} busy={a.sub.busy} onAdd={(name) => a.add({ name, parent: system })} />
      <div className="lists__add">
        <input className="input" value={newSystem} onChange={(e) => setNewSystem(e.target.value)} placeholder={t("ui.lists.newSystemPh")} />
        <button type="button" className="btn btn--outline" disabled={!newSystem.trim()} onClick={() => { setSystem(newSystem.trim()); setNewSystem(""); }}><Icon name="plus" /><span>{t("ui.lists.newSystem")}</span></button>
      </div>
      {a.sub.formError && <p className="form-status form-status--error">{a.errText(a.sub.formError)}</p>}
    </div>
  );
}

/*
 * Create variants (clothing): pick sizes × colours (and fabric type / width when the category uses them);
 * every combination becomes a variant with its own SKU, price and stock. Existing combinations are skipped.
 */
export function VariantMatrix({ product, fields, onClose, onDone }) {
  const { t } = useLanguage();
  const profile = useProfile();
  const L = (k) => productLabel(t, profile, k);
  const m = useMoney();
  const cat = useCatalog();
  const [system, setSystem] = useState(cat.systemFor(product.category));
  const [sizes, setSizes] = useState([]);
  const [colors, setColors] = useState([]);
  const [fabric, setFabric] = useState(product.formula || "");
  const [width, setWidth] = useState(product.packSize || "");
  const [price, setPrice] = useState(String(product.sellingPrice ?? ""));
  const sub = useSubmit();
  const errText = useErrorText();
  const toggle = (list, setList, v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const combos = useMemo(() => {
    const ss = fields.includes("size") ? (sizes.length ? sizes : [null]) : [null];
    const cs = fields.includes("shade") ? (colors.length ? colors : [null]) : [null];
    return ss.flatMap((s) => cs.map((c) => ({ size: s, shade: c }))).filter((x) => x.size || x.shade);
  }, [sizes, colors, fields]);
  // the product's own size / colour parts are taken off its SKU (POLO-M-BLACK → POLO)
  const own = [product.size, product.shade].filter(Boolean).map((x) => String(x).toUpperCase().replace(/s+/g, ""));
  const baseSku = (product.sku || "").split("-").filter((part, i) => i === 0 || !own.includes(part.toUpperCase())).join("-");
  const skuOf = (x) => (baseSku ? [baseSku, x.size, x.shade].filter(Boolean).join("-").toUpperCase().replace(/\s+/g, "") : "");
  const save = async () => {
    const variants = combos.map((x) => ({ size: x.size || "", shade: x.shade || "", formula: fields.includes("formula") ? fabric : "", packSize: fields.includes("packSize") ? width : "", sku: skuOf(x), sellingPrice: price }));
    const r = await sub.run(() => apiRequest(`/api/products/${product.id}/variants`, { method: "POST", body: { variants } }));
    if (r) onDone(r);
  };
  return (
    <Modal title={fill(t("ui.lists.matrixTitle"), { name: product.baseName || product.name })} onClose={onClose} wide>
      <div className="form-grid">
        <p className="modal__help">{t("ui.lists.matrixHelp")}</p>
        {fields.includes("size") && (
          <div className="ff ff--full">
            <span className="ff__label">{L("size")}</span>
            <select className="input input--auto" value={system} onChange={(e) => { setSystem(e.target.value); setSizes([]); }}>{Object.keys(cat.sizeSystems).map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <div className="chip-pick">{(cat.sizeSystems[system] || []).map((s) => <button key={s} type="button" aria-pressed={sizes.includes(s)} onClick={() => toggle(sizes, setSizes, s)}>{s}</button>)}</div>
          </div>
        )}
        {fields.includes("shade") && (
          <div className="ff ff--full">
            <span className="ff__label">{L("shade")}</span>
            <div className="chip-pick">{cat.colors.map((c) => <button key={c.name} type="button" aria-pressed={colors.includes(c.name)} onClick={() => toggle(colors, setColors, c.name)}><Swatch code={c.code} />{c.name}</button>)}</div>
          </div>
        )}
        {fields.includes("formula") && <Field label={L("formula")}><input className="input" value={fabric} onChange={(e) => setFabric(e.target.value)} placeholder={L("formula")} /></Field>}
        {fields.includes("packSize") && <Field label={L("packSize")}><input className="input" value={width} onChange={(e) => setWidth(e.target.value)} placeholder={L("packSize")} /></Field>}
        <Field label={t("ui.products.sellingPrice")}><input className="input" type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <div className="ff ff--full">
          <span className="ff__label">{fill(t("ui.lists.willCreate"), { n: combos.length })}</span>
          {combos.length === 0 ? <small className="muted">{t("ui.lists.pickSome")}</small> : (
            <div className="table-wrap"><table className="table table--compact">
              <thead><tr><th>{t("ui.products.variant")}</th><th>{t("ui.products.sku")}</th><th className="num">{t("ui.products.sellingPrice")}</th></tr></thead>
              <tbody>{combos.map((x, i) => <tr key={i}><td>{[x.size, x.shade, fields.includes("formula") && fabric, fields.includes("packSize") && width].filter(Boolean).join(" · ")}</td><td>{skuOf(x) || "—"}</td><td className="num">{m(Number(price) || 0)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
        <FormError error={sub.formError} />
        {sub.formError && !sub.formError.errors && <p className="form-status form-status--error">{errText(sub.formError)}</p>}
        <div className="form-actions sheet-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="button" className="btn btn--primary" disabled={!combos.length || sub.busy} onClick={save}><Icon name="plus" /><span>{fill(t("ui.lists.createN"), { n: combos.length })}</span></button>
        </div>
      </div>
    </Modal>
  );
}
