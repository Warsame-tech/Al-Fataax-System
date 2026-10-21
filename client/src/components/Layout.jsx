import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header.jsx";
import Footer from "./Footer.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import useReveal from "../hooks/useReveal.js";

export default function Layout() {
  const { pathname, hash, key } = useLocation();
  const { t } = useLanguage();

  // Scroll to the section named in the URL hash (e.g. /#pricing), otherwise to the top.
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash, key]);

  useReveal(pathname);

  return (
    <>
      <a className="skip-link" href="#main">{t("nav.skip")}</a>
      <Header />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
