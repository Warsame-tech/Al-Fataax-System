import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { SUPPORTED, useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { saveLanguage } from "../services/authService.js";
import { apiRequest, fileUrl } from "../services/api.js";
import { fill } from "./format.js";
import logo from "../assets/faatix-logo.png";

/** Frame for the signed-in business application. */
export default function AppLayout() {
  const { t, lang, setLang } = useLanguage();
  const { user, business, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Use the language saved on the user's account when they sign in.
  useEffect(() => {
    if (user?.language && user.language !== lang) setLang(user.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const changeLang = (code) => { setLang(code); saveLanguage(code); };
  const handleSignOut = async () => { await signOut(); navigate("/signin", { replace: true }); };
  const initials = (business?.name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#app-main">{t("nav.skip")}</a>
      <header className="app-bar">
        <div className="app-bar__inner">
          <Link to="/app" className="app-bar__brand" aria-label={t("app.dashboard")}>
            <img src={logo} alt="Faatix" width="283" height="85" />
          </Link>

          <div className="app-bar__business">
            {business?.logoPath
              ? <img className="app-bar__blogo" src={fileUrl(business.logoPath)} alt="" />
              : <span className="app-bar__blogo app-bar__blogo--initials" aria-hidden="true">{initials}</span>}
            <span className="app-bar__bname">{business?.name}</span>
          </div>

          <div className="app-bar__actions">
            <div className="lang-switch" role="group" aria-label={t("nav.language")}>
              <Icon name="globe" className="lang-switch__icon" />
              {SUPPORTED.map((code) => (
                <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => changeLang(code)}>
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <Bell />
            <Link className="app-user" to="/app/m/profile" title={user?.username}>
              <span className="app-user__avatar" aria-hidden="true"><Icon name="user" /></span>
              <span className="app-user__text">
                <strong>{user?.fullName}</strong>
                <small>{t(`app.roles.${user?.role}`)}</small>
              </span>
            </Link>
            <button type="button" className="app-signout" onClick={handleSignOut}>
              <Icon name="log-out" /><span>{t("app.signOut")}</span>
            </button>
          </div>
        </div>
      </header>

      <main id="app-main" className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

/** Notification bell: low stock, invoices due / overdue, supplier payables (refreshed on open). */
function Bell() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  const { pathname } = useLocation();
  const load = () => apiRequest("/api/notifications").then((d) => setItems(d.notifications || [])).catch(() => {});
  useEffect(() => { load(); setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="bell" ref={ref}>
      <button type="button" className="bell__btn" aria-expanded={open} aria-label={t("ui.notifications.title")} onClick={() => { setOpen((v) => !v); load(); }}>
        <Icon name="bell" />
        {items.length > 0 && <span className="bell__count">{items.length > 9 ? "9+" : items.length}</span>}
      </button>
      {open && (
        <div className="bell__panel" role="dialog" aria-label={t("ui.notifications.title")}>
          <h2>{t("ui.notifications.title")}</h2>
          {items.length === 0 ? <p className="dash-empty">{t("ui.notifications.empty")}</p> : (
            <ul>
              {items.map((n, i) => (
                <li key={i}>
                  <Link to={n.link} className={`bell__item bell__item--${n.type}`}>
                    <Icon name={n.type.includes("Stock") ? "package" : n.type === "supplierDue" ? "truck" : "receipt"} />
                    <span>{fill(t(`ui.notifications.types.${n.type}`), { ref: n.ref, amount: n.amount })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
