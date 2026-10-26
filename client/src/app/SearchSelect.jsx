import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

/*
 * Dropdown with a search box. Keyboard: ↑ ↓ to move, Enter to choose, Esc to close.
 *   options   [{ value, label, sub?, disabled? }]   (sub = small grey text, also searched)
 *   value     selected value ("" = none)          onChange(value)
 *   onCreate  optional: shows "+ Add “typed text”" at the end, called with the typed text
 *   clearOnPick  show the placeholder again after choosing (pickers that add lines)
 *   openSignal  optional number: each time it changes the dropdown opens (e.g. an "Add item" button elsewhere)
 */
export default function SearchSelect({ options, value, onChange, placeholder, searchPlaceholder, onCreate, createLabel, disabled = false, invalid = false, clearOnPick = false, icon, openSignal }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hover, setHover] = useState(0);
  const boxRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => `${o.label} ${o.sub || ""}`.toLowerCase().includes(term));
  }, [options, q]);
  const showCreate = Boolean(onCreate);
  const count = list.length + (showCreate ? 1 : 0);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => { setHover(0); }, [q, open]);
  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    boxRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [openSignal]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${hover}"]`)?.scrollIntoView({ block: "nearest" }); }, [hover]);

  const choose = (o) => {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
    setQ("");
  };
  const create = () => { const text = q.trim(); setOpen(false); setQ(""); onCreate(text); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHover((h) => Math.min(h + 1, count - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHover((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hover < list.length) { if (list[hover]) choose(list[hover]); } else if (showCreate) create(); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className={"sselect" + (open ? " is-open" : "")} ref={boxRef}>
      <button type="button" className={"input sselect__btn" + (invalid ? " has-error" : "")} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        {icon && <Icon name={icon} className="sselect__icon" />}
        <span className={"sselect__value" + (selected && !clearOnPick ? "" : " is-placeholder")}>{selected && !clearOnPick ? selected.label : placeholder || t("ui.common.choose")}</span>
        <Icon name="chevron-down" className="sselect__chev" />
      </button>
      {open && (
        <div className="sselect__panel">
          <div className="sselect__search">
            <Icon name="search-glass" />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={searchPlaceholder || t("ui.common.searchPh")} aria-label={searchPlaceholder || t("ui.common.search")} />
          </div>
          <ul className="sselect__list" role="listbox" ref={listRef}>
            {list.length === 0 && !showCreate && <li className="sselect__empty">{t("ui.common.noResults")}</li>}
            {list.map((o, i) => (
              <li key={o.value} data-i={i} role="option" aria-selected={String(o.value) === String(value)} aria-disabled={o.disabled || undefined}
                className={(i === hover ? "is-hover " : "") + (o.disabled ? "is-disabled" : "")} onMouseEnter={() => setHover(i)} onMouseDown={(e) => { e.preventDefault(); choose(o); }}>
                <span>{o.label}</span>
                {o.sub && <small>{o.sub}</small>}
              </li>
            ))}
            {showCreate && (
              <li data-i={list.length} role="option" aria-selected="false" className={"sselect__create" + (hover === list.length ? " is-hover" : "")}
                onMouseEnter={() => setHover(list.length)} onMouseDown={(e) => { e.preventDefault(); create(); }}>
                <Icon name="plus" /><span>{q.trim() ? `${createLabel} “${q.trim()}”` : createLabel}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
