import { useLanguage } from "../i18n/LanguageContext.jsx";

/** Section header: orange, uppercase, letter-spaced, centred, with a short underline. */
export default function SectionTitle({ k }) {
  const { t } = useLanguage();
  return (
    <div className="section-title" data-reveal>
      <h2>{t(k)}</h2>
    </div>
  );
}
