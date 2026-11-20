import { useEffect } from "react";
import { useLanguage } from "../i18n/LanguageContext.jsx";

/** Sets the browser tab title from a translation key and updates it on language change. */
export default function usePageTitle(key) {
  const { t } = useLanguage();
  useEffect(() => { document.title = t(key); }, [t, key]);
}
