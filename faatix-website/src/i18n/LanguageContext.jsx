import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import translations from "./translations.js";

const STORAGE_KEY = "faatix.lang";
const DEFAULT_LANG = "en";
export const SUPPORTED = ["en", "so"];

function initialLang() {
  // ?lang=so in the URL wins (handy for sharing links), then the saved choice.
  const param = new URLSearchParams(window.location.search).get("lang");
  if (SUPPORTED.includes(param)) return param;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return DEFAULT_LANG;
}

function resolve(lang, key) {
  return key.split(".").reduce((obj, part) => (obj == null ? undefined : obj[part]), translations[lang]);
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  }, [lang]);

  const setLang = useCallback((next) => {
    if (SUPPORTED.includes(next)) setLangState(next);
  }, []);

  const t = useCallback((key) => {
    const value = resolve(lang, key) ?? resolve(DEFAULT_LANG, key);
    return value ?? key;
  }, [lang]);

  // Browser form checks ("Value must be less than or equal to 1.", "Please fill out this field.")
  // follow the browser's language; replace them everywhere with messages in the chosen language.
  useEffect(() => {
    const num = (v) => { try { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Number(v)); } catch { return v; } };
    const fillIn = (key, params) => String(t(`ui.validation.${key}`)).replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
    const messageFor = (el) => {
      const v = el.validity;
      if (v.valueMissing) return fillIn(el.tagName === "SELECT" ? "requiredSelect" : el.type === "checkbox" || el.type === "radio" ? "requiredCheck" : "required", {});
      if (v.badInput) return fillIn(el.type === "date" ? "date" : "number", {});
      if (v.typeMismatch) return fillIn(el.type === "email" ? "email" : el.type === "url" ? "url" : "invalid", {});
      if (v.rangeUnderflow) return fillIn("min", { min: num(el.min) });
      if (v.rangeOverflow) return fillIn("max", { max: num(el.max) });
      if (v.stepMismatch) return fillIn("step", { step: el.step });
      if (v.tooShort) return fillIn("tooShort", { min: el.minLength, n: el.value.length });
      if (v.tooLong) return fillIn("tooLong", { max: el.maxLength });
      if (v.patternMismatch) return el.title || fillIn("pattern", {});
      return fillIn("invalid", {});
    };
    const onInvalid = (e) => {
      const el = e.target;
      if (!el?.validity || !el.setCustomValidity) return;
      el.setCustomValidity("");                       // re-check the real value first
      if (!el.validity.valid) el.setCustomValidity(messageFor(el));
    };
    const onEdit = (e) => e.target?.setCustomValidity?.("");
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, [t]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}

/** Renders a translation that contains trusted markup (e.g. <em>, <br>) from translations.js. */
export function Rich({ k, as: Tag = "span", ...rest }) {
  const { t } = useLanguage();
  return <Tag {...rest} dangerouslySetInnerHTML={{ __html: t(k) }} />;
}
