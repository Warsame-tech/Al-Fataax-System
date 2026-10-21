import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";

export default function NotFound() {
  const { t } = useLanguage();
  usePageTitle("meta.notFound");

  return (
    <section className="page-hero page-hero--center">
      <div className="container">
        <div className="page-hero__inner">
          <span className="eyebrow">404</span>
          <h1>{t("common.notFoundTitle")}</h1>
          <p>{t("common.notFoundText")}</p>
          <div className="hero__actions">
            <Link className="btn btn--primary btn--lg" to="/"><Icon name="arrow-left" /><span>{t("common.backHome")}</span></Link>
          </div>
        </div>
      </div>
    </section>
  );
}
