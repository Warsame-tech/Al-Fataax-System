import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import logoDark from "../assets/faatix-logo.png";
import logoLight from "../assets/faatix-logo-light.png";

/** Faatix logo. `light` uses the white-text version for dark backgrounds. */
export default function Logo({ light = false, linked = true }) {
  const { t } = useLanguage();
  const img = <img className="logo__img" src={light ? logoLight : logoDark} alt="Faatix" width="283" height="85" />;
  if (!linked) return <span className="logo">{img}</span>;
  return <Link className="logo" to="/" aria-label={t("nav.home")}>{img}</Link>;
}
