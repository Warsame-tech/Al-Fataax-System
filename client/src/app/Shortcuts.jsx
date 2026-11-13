import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { useApi, usePerm, useMoney, useSubmit, Modal, FormError } from "./ui.jsx";
import { useProfile } from "./profile.js";
import { MODULES } from "./modules.js";
import { date } from "./format.js";

/*
 * Keyboard shortcuts and quick navigation (the whole signed-in app; ShortcutsProvider sits in AppLayout).
 *
 * ACTIONS: what a shortcut can do and its default key. The owner can change the keys (Settings → Keyboard shortcuts,
 * GET / PUT /api/search/shortcuts); Esc is always "close / cancel". Keys are read from the physical key (e.code), so
 * Alt + S works the same on every keyboard layout and on a Mac (Option + S); on a Mac, Cmd counts as Ctrl.
 * Shortcuts with Ctrl / Alt work while typing in a field (Ctrl + S saves the form you are in); plain keys ("?") don't.
 *
 * Browser / system clashes: the page takes the key first (preventDefault), which stops most browser menus (Alt + E
 * in Chrome / Edge, Alt + S / V in Firefox). Keys the browser never gives to a page (Ctrl + N, T, W, Tab, Alt + F4)
 * can't be used; KNOWN_CLASHES warns about them in the settings.
 */
export const ACTIONS = [
  { id: "search", keys: "Ctrl+K", icon: "search-glass", run: "search" },
  { id: "save", keys: "Ctrl+S", icon: "check", run: "save" },
  { id: "help", keys: "Ctrl+/", icon: "info", run: "help" },
  { id: "dashboard", keys: "Alt+H", icon: "grid", to: "/app" },
  { id: "pos", keys: "Alt+S", icon: "cart", to: "/app/m/pos", perm: "sales.create" },
  { id: "inventory", keys: "Alt+I", icon: "layers", to: "/app/m/stock", perm: "stock.view" },
  { id: "products", keys: "Alt+O", icon: "package", to: "/app/m/products", perm: "products.view" },
  { id: "newInvoice", keys: "Alt+N", icon: "receipt", to: "/app/invoices/new", perm: "invoices.create" },
  { id: "invoices", keys: "", icon: "receipt", to: "/app/m/invoices", perm: "invoices.view" },
  { id: "purchases", keys: "Alt+P", icon: "truck", to: "/app/m/purchases", perm: "purchases.view" },
  { id: "customers", keys: "Alt+C", icon: "users", to: "/app/m/customers", perm: "customers.view" },
  { id: "suppliers", keys: "Alt+V", icon: "store", to: "/app/m/suppliers", perm: "suppliers.view" },
  { id: "expenses", keys: "Alt+E", icon: "wallet", to: "/app/m/expenses", perm: "expenses.view" },
  { id: "reports", keys: "Alt+R", icon: "file-chart", to: "/app/m/reports", perm: "reports.view" },
  { id: "cashbook", keys: "", icon: "book-open", to: "/app/m/cashbook", perm: "cash.view" }
];
/* keys a browser or the system keeps (never reach the page) or that a browser uses itself */
export const KNOWN_CLASHES = {
  "Ctrl+N": "reserved", "Ctrl+T": "reserved", "Ctrl+W": "reserved", "Ctrl+Shift+N": "reserved", "Ctrl+Shift+T": "reserved", "Ctrl+Shift+W": "reserved",
  "Ctrl+Q": "reserved", "Ctrl+L": "browser", "Ctrl+D": "browser", "Ctrl+F": "browser", "Ctrl+P": "browser", "Ctrl+R": "browser", "Ctrl+H": "browser",
  "Ctrl+J": "browser", "Ctrl+O": "browser", "Ctrl+U": "browser", "Ctrl+A": "typing", "Ctrl+C": "typing", "Ctrl+V": "typing", "Ctrl+X": "typing", "Ctrl+Z": "typing", "Ctrl+Y": "typing",
  "Alt+D": "browser", "Alt+F": "browser", "Alt+F4": "reserved"
};

const ShortcutsContext = createContext({ keyOf: () => "", openSearch: () => {}, openHelp: () => {} });
export const useShortcuts = () => useContext(ShortcutsContext);

/* "Ctrl+Alt+K" from a key event (physical key, so layouts and Mac Option don't change it) */
function comboOf(e) {
  let k = "";
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) k = e.code;
  else if (e.code === "Slash") k = "/";
  if (!k) return "";
  return `${e.ctrlKey || e.metaKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${k}`;
}
const typing = (el) => el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/*
 * Ctrl + S: saves what you are working on — the dialog on top if one is open, otherwise the page. A button marked
 * data-shortcut-save (e.g. the POS payment) is pressed; otherwise the form you are in (or the only form there) is sent.
 */
function saveCurrent() {
  const modals = document.querySelectorAll(".modal");
  const scope = modals.length ? modals[modals.length - 1] : document.querySelector(".app-main");
  if (!scope) return false;
  const marked = [...scope.querySelectorAll("[data-shortcut-save]")].filter((b) => !b.disabled);
  if (marked.length) { marked[marked.length - 1].click(); return true; }
  const active = document.activeElement?.closest?.("form");
  const form = active && scope.contains(active) ? active : scope.querySelector("form");
  if (!form) return false;
  const submit = form.querySelector('button[type="submit"]:not([disabled])') || (form.querySelector('button[type="submit"]') ? null : form);
  if (!submit) return false;
  form.requestSubmit(submit === form ? undefined : submit);
  return true;
}

export function ShortcutsProvider({ children }) {
  const can = usePerm();
  const navigate = useNavigate();
  const saved = useApi("/api/search/shortcuts");
  const [searching, setSearching] = useState(false);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  // the keys in use: the owner's, or the defaults
  const keys = useMemo(() => Object.fromEntries(ACTIONS.map((a) => [a.id, saved.data?.shortcuts && saved.data.shortcuts[a.id] !== undefined ? saved.data.shortcuts[a.id] : a.keys])), [saved.data]);
  const byKey = useMemo(() => new Map(ACTIONS.filter((a) => keys[a.id]).map((a) => [keys[a.id], a])), [keys]);
  const run = useCallback((a) => {
    if (a.perm && !can(a.perm)) return false;
    if (a.run === "search") { setHelp(false); setSearching(true); return true; }
    if (a.run === "help") { setSearching(false); setHelp(true); return true; }
    if (a.run === "save") return saveCurrent();
    setSearching(false); setHelp(false);
    navigate(a.to);
    return true;
  }, [can, navigate]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.isComposing || e.target?.closest?.(".kbd-input")) return;   // the settings are recording a new key
      // Esc with no dialog open: cancel what you are typing (leave the field); dialogs close themselves (ui.jsx Modal)
      if (e.key === "Escape" && !document.querySelector(".modal") && typing(e.target)) { e.target.blur(); return; }
      // "?" opens the shortcut list (not while typing)
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target)) { e.preventDefault(); setHelp(true); return; }
      const combo = comboOf(e);
      if (!combo || !/^(Ctrl|Alt)\+/.test(combo) && !/^F\d/.test(combo)) return;
      const a = byKey.get(combo);
      if (!a) return;
      // the page takes the key before the browser (stops its menus / save-page dialog)
      e.preventDefault();
      e.stopPropagation();
      run(a);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [byKey, run]);
  const value = useMemo(() => ({ keyOf: (id) => keys[id] || "", keys, openSearch: () => setSearching(true), openHelp: () => setHelp(true) }), [keys]);
  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      {searching && <GlobalSearch onClose={() => setSearching(false)} keys={keys} />}
      {help && <ShortcutHelp onClose={() => setHelp(false)} keys={keys} onSettings={() => { setHelp(false); setSettings(true); }} />}
      {settings && <ShortcutSettings onClose={() => setSettings(false)} keys={keys} onSaved={() => { setSettings(false); saved.reload(); }} />}
    </ShortcutsContext.Provider>
  );
}

/* A key combination as keyboard keys: Ctrl + K */
export function Kbd({ combo, className = "" }) {
  if (!combo) return null;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
  return (
    <span className={"kbd-combo " + className} aria-label={combo}>
      {combo.split("+").map((k, i) => <kbd key={i}>{mac && k === "Ctrl" ? "⌘" : mac && k === "Alt" ? "⌥" : k}</kbd>)}
    </span>
  );
}

/*
 * Global search (Ctrl + K): business modules and actions match as you type; products, customers, suppliers, invoices,
 * receipts, purchases, expenses and categories come from the server (GET /api/search). ↑ ↓ choose, Enter opens, Esc closes.
 */
function GlobalSearch({ onClose, keys }) {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const m = useMoney();
  const profile = useProfile();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [server, setServer] = useState({ q: "", results: [] });
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);
  const needle = q.trim().toLowerCase();
  useEffect(() => {
    if (!needle) { setServer({ q: "", results: [] }); return undefined; }
    setLoading(true);
    const timer = setTimeout(() => {
      apiRequest(`/api/search?q=${encodeURIComponent(q.trim())}`).then((r) => setServer(r)).catch(() => {}).finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [needle]); // eslint-disable-line react-hooks/exhaustive-deps

  // modules the user can open, and the shortcut actions (matched on their names in the user's language)
  const modules = MODULES.filter((mod) => (!mod.perm || can(mod.perm)) && (!mod.profile || profile[mod.profile]))
    .map((mod) => ({ kind: "module", id: mod.id, title: t(`app.modules.${mod.id}`), icon: mod.icon, to: `/app/m/${mod.id}`, keys: keys[ACTIONS.find((a) => a.to === `/app/m/${mod.id}`)?.id] }));
  const actions = ACTIONS.filter((a) => a.to && !a.to.startsWith("/app/m/") && (!a.perm || can(a.perm)))
    .map((a) => ({ kind: "action", id: a.id, title: t(`ui.shortcuts.actions.${a.id}`), icon: a.icon, to: a.to, keys: keys[a.id] }));
  const local = [...actions, ...modules].filter((x) => !needle || x.title.toLowerCase().includes(needle)).slice(0, needle ? 8 : 12);
  const items = [...local, ...(server.q && needle ? server.results : [])];
  useEffect(() => { setSel(0); }, [needle, server.q]);
  useEffect(() => { listRef.current?.querySelector(".gsearch__item.is-sel")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const open = (x) => { if (!x) return; onClose(); navigate(x.to); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); open(items[sel]); }
  };
  const ICON = { product: "package", customer: "users", supplier: "store", invoice: "receipt", sale: "cart", purchase: "truck", expense: "wallet", category: "layers" };
  let lastKind = null;
  return (
    <Modal title={t("ui.shortcuts.searchTitle")} onClose={onClose} wide>
      <div className="gsearch">
        <div className="gsearch__box">
          <Icon name="search-glass" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t("ui.shortcuts.searchPh")} aria-label={t("ui.shortcuts.searchTitle")}
            role="combobox" aria-expanded="true" aria-controls="gsearch-list" aria-activedescendant={items[sel] ? `gs-${sel}` : undefined} autoFocus />
          {loading && <span className="app-spinner gsearch__spin" aria-hidden="true" />}
        </div>
        <ul className="gsearch__list" id="gsearch-list" role="listbox" ref={listRef}>
          {items.map((x, i) => {
            const group = x.kind === "module" || x.kind === "action" ? "go" : x.kind;
            const head = group !== lastKind ? <li className="gsearch__group" role="presentation">{t(`ui.shortcuts.groups.${group}`)}</li> : null;
            lastKind = group;
            return [head,
              <li key={`${x.kind}-${x.id}`} id={`gs-${i}`} role="option" aria-selected={i === sel} className={"gsearch__item" + (i === sel ? " is-sel" : "")}
                onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); open(x); }}>
                <span className="gsearch__icon"><Icon name={x.icon || ICON[x.kind] || "search-glass"} /></span>
                <span className="gsearch__text">
                  <strong>{x.title}</strong>
                  {(x.sub || x.date || x.count !== undefined) && <small>{[x.sub, x.date ? date(x.date, lang) : null, x.count !== undefined ? `${x.count} ${t("ui.shortcuts.productsN")}` : null].filter(Boolean).join(" · ")}</small>}
                </span>
                {x.amount !== undefined && <span className="gsearch__amount">{m(x.amount)}</span>}
                {x.price !== undefined && <span className="gsearch__amount">{m(x.price)}</span>}
                {x.status && <span className={`badge-status badge-status--${x.status}`}>{t(`ui.status.${x.status}`)}</span>}
                {x.keys && <Kbd combo={x.keys} />}
              </li>];
          })}
          {needle && !loading && items.length === 0 && <li className="gsearch__empty">{t("ui.common.noResults")}</li>}
        </ul>
        <p className="gsearch__foot"><Kbd combo="↑" /><Kbd combo="↓" /> {t("ui.shortcuts.choose")} · <Kbd combo="Enter" /> {t("ui.shortcuts.open")} · <Kbd combo="Esc" /> {t("ui.shortcuts.close")}</p>
      </div>
    </Modal>
  );
}

/* The keyboard shortcuts help screen (Ctrl + / or ?) */
function ShortcutHelp({ onClose, keys, onSettings }) {
  const { t } = useLanguage();
  const can = usePerm();
  const rows = ACTIONS.filter((a) => (!a.perm || can(a.perm)) && keys[a.id]);
  return (
    <Modal title={t("ui.shortcuts.helpTitle")} onClose={onClose} wide footer={can("settings.edit") && (
      <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onSettings}><Icon name="settings" /><span>{t("ui.shortcuts.change")}</span></button></div>
    )}>
      <div className="kbd-help">
        <table className="table table--compact">
          <tbody>
            {rows.map((a) => <tr key={a.id}><td><Kbd combo={keys[a.id]} /></td><td>{t(`ui.shortcuts.actions.${a.id}`)}</td></tr>)}
            <tr><td><Kbd combo="Esc" /></td><td>{t("ui.shortcuts.esc")}</td></tr>
            <tr><td><Kbd combo="?" /></td><td>{t("ui.shortcuts.questionMark")}</td></tr>
          </tbody>
        </table>
        <p className="muted kbd-help__note"><Icon name="info" /> {t("ui.shortcuts.helpNote")}</p>
      </div>
    </Modal>
  );
}

/* Owner: change the keys. Click a box and press the new keys (Backspace clears it); clashes are shown before saving. */
function ShortcutSettings({ onClose, keys, onSaved }) {
  const { t } = useLanguage();
  const [v, setV] = useState({ ...keys });
  const sub = useSubmit();
  const dup = (id) => v[id] && ACTIONS.some((a) => a.id !== id && v[a.id] === v[id]);
  const record = (id) => (e) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Backspace" || e.key === "Delete") { setV((x) => ({ ...x, [id]: "" })); return; }
    const c = comboOf(e);
    if (c && (/^(Ctrl|Alt)\+/.test(c) || /^F\d/.test(c))) setV((x) => ({ ...x, [id]: c }));
  };
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/search/shortcuts", { method: "PUT", body: { shortcuts: v } }))) onSaved(); };
  const reset = async () => { if (await sub.run(() => apiRequest("/api/search/shortcuts", { method: "PUT", body: { shortcuts: null } }))) onSaved(); };
  return (
    <Modal title={t("ui.shortcuts.settingsTitle")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid">
        <p className="modal__help">{t("ui.shortcuts.settingsHelp")}</p>
        <table className="table table--compact kbd-settings">
          <tbody>
            {ACTIONS.map((a) => {
              const clash = KNOWN_CLASHES[v[a.id]];
              return (
                <tr key={a.id}>
                  <td>{t(`ui.shortcuts.actions.${a.id}`)}</td>
                  <td>
                    <input className={"input input--sm kbd-input" + (dup(a.id) || sub.fieldErrors[a.id] ? " has-error" : "")} readOnly value={v[a.id] || ""} placeholder={t("ui.shortcuts.pressKeys")}
                      onKeyDown={record(a.id)} aria-label={t(`ui.shortcuts.actions.${a.id}`)} />
                    {dup(a.id) && <small className="ff__error">{t("ui.shortcuts.duplicate")}</small>}
                    {sub.fieldErrors[a.id] && <small className="ff__error">{t(`ui.shortcuts.errors.${sub.fieldErrors[a.id]}`)}</small>}
                    {clash && <small className={clash === "reserved" ? "ff__error" : "ff__hint"}>{t(`ui.shortcuts.clash.${clash}`)}</small>}
                  </td>
                  <td className="muted">{a.keys ? <>{t("ui.shortcuts.default")}: <Kbd combo={a.keys} /></> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <FormError error={sub.formError} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={reset} disabled={sub.busy}>{t("ui.shortcuts.reset")}</button>
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy || ACTIONS.some((a) => dup(a.id))}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
