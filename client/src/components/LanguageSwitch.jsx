import Icon from "./Icon.jsx";
import { SUPPORTED, useLanguage } from "../i18n/LanguageContext.jsx";

export default function LanguageSwitch() {
  const { lang, setLang, t } = useLanguage();
  return (
    <div className="lang-switch" role="group" aria-label={t("nav.language")}>
      <Icon name="globe" className="lang-switch__icon" />
      {SUPPORTED.map((code) => (
        <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => setLang(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
