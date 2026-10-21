import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Icon from "./Icon.jsx";
import Logo from "./Logo.jsx";
import LanguageSwitch from "./LanguageSwitch.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import useActiveSection from "../hooks/useActiveSection.js";
import { useAuth } from "../auth/AuthContext.jsx";

/* The site is one page: menu items scroll to sections on the home page. */
export const NAV_ITEMS = [
  { id: "features", key: "nav.features" },
  { id: "who", key: "nav.who" },
  { id: "about", key: "nav.about" },
  { id: "pricing", key: "nav.pricing" },
  { id: "contact", key: "nav.contact" }
];
const SECTION_IDS = NAV_ITEMS.map((i) => i.id);

export const sectionLink = (id) => ({ pathname: "/", hash: `#${id}` });

export default function Header() {
  const { t } = useLanguage();
  const { pathname, hash } = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const active = useActiveSection(SECTION_IDS, pathname === "/");
  const { status: authStatus } = useAuth();
  const signedIn = authStatus === "signedIn";

  useEffect(() => { setOpen(false); }, [pathname, hash]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const mq = window.matchMedia("(min-width: 1200px)");
    const onMq = (e) => { if (e.matches) setOpen(false); };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  const links = (base) => NAV_ITEMS.map((item) => (
    <li key={item.id}>
      <Link
        to={sectionLink(item.id)}
        className={base + (active === item.id ? " is-active" : "")}
        aria-current={active === item.id ? "true" : undefined}
        onClick={() => setOpen(false)}
      >
        {t(item.key)}
      </Link>
    </li>
  ));

  return (
    <header className={"site-header" + (scrolled ? " is-scrolled" : "")}>
      <div className="container site-header__inner">
        <Logo />

        <nav className="main-nav" aria-label={t("nav.primary")}>
          <ul>{links("")}</ul>
        </nav>

        <div className="site-header__actions">
          <LanguageSwitch />
          {signedIn ? (
            <Link className="btn btn--primary btn--sweep btn--signin site-header__signin" to="/app">{t("app.dashboard")}</Link>
          ) : (
            <>
              <Link className="site-header__signup" to="/register">{t("nav.signup")}</Link>
              <Link className="btn btn--primary btn--sweep btn--signin site-header__signin" to="/signin">{t("nav.signin")}</Link>
            </>
          )}
          <button
            className="nav-toggle"
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={t(open ? "nav.closeMenu" : "nav.openMenu")}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? "x" : "menu"} />
          </button>
        </div>
      </div>

      <div className="mobile-nav" id="mobile-nav" hidden={!open}>
        <div className="container">
          <ul>{links("mobile-nav__link")}</ul>
          {signedIn ? (
            <Link className="btn btn--primary btn--sweep btn--signin btn--block" to="/app">{t("app.dashboard")}</Link>
          ) : (
            <div className="mobile-nav__auth">
              <Link className="btn btn--outline btn--block" to="/register">{t("nav.signup")}</Link>
              <Link className="btn btn--primary btn--sweep btn--signin btn--block" to="/signin">{t("nav.signin")}</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
