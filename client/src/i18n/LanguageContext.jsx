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
