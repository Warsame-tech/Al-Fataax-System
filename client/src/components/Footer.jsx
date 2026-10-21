import { Link } from "react-router-dom";
import Logo from "./Logo.jsx";
import Icon from "./Icon.jsx";
import { sectionLink } from "./Header.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { site } from "../config/site.js";

const COLUMNS = [
  { title: "footer.product", links: [
    { section: "features", key: "nav.features" },
    { section: "pricing", key: "nav.pricing" }
  ] },
  { title: "footer.company", links: [
    { section: "about", key: "nav.about" },
    { section: "who", key: "nav.who" },
    { section: "contact", key: "nav.contact" }
  ] }
];

const tel = (n) => "tel:" + n.replace(/[^\d+]/g, "");

export default function Footer() {
  const { t } = useLanguage();
  const { phones, emails } = site.contact;

  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <Logo light />
            <p className="site-footer__slogan">{t("hero.title1")} {t("hero.title2")}</p>
            <ul className="site-footer__contact">
              <li><a href={tel(phones[0])}><Icon name="phone" /><span dir="ltr">{phones[0]}</span></a></li>
              <li><a href={`mailto:${emails[0]}`}><Icon name="mail" /><span>{emails[0]}</span></a></li>
            </ul>
          </div>

          {COLUMNS.map((col) => (
            <nav className="site-footer__col" key={col.title} aria-label={t(col.title)}>
              <h2>{t(col.title)}</h2>
              <ul>
                {col.links.map((link) => (
                  <li key={link.key}><Link to={sectionLink(link.section)}>{t(link.key)}</Link></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="site-footer__bottom">
          <p>&copy; {new Date().getFullYear()} {t("footer.rights")}</p>
        </div>
      </div>
    </footer>
  );
}
