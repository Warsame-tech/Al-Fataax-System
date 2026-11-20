import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import LanguageSwitch from "../components/LanguageSwitch.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";
import { signIn } from "../services/authService.js";
import { apiRequest, fileUrl, getTenant, setTenant } from "../services/api.js";
import faatixMark from "../assets/faatix-logo.png";
import "../styles/signin.css";

const REMEMBER_KEY = "faatix.rememberUser";
const THEME_KEY = "faatix.signinTheme";
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } };
const initials = (name) => String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "F";

/*
 * Sign-in — the app's first page. Branded per business: the business comes from the address (prodima.faatix.com or a
 * custom domain, resolved by the server) or from the link /b/<slug> (kept on this device and sent as X-Tenant);
 * the page then shows that business's logo and name. Without one, it is the Faatix sign-in.
 */
export default function SignIn() {
  const { t } = useLanguage();
  const { status: authStatus, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { slug } = useParams();
  usePageTitle("meta.signin");

  const goTo = location.state?.from?.startsWith("/app") ? location.state.from : "/app";
  const remembered = read(REMEMBER_KEY);
  const [form, setForm] = useState({ username: remembered || "", password: "" });
  const [remember, setRemember] = useState(Boolean(remembered));
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [forgot, setForgot] = useState(false);
  const [dark, setDark] = useState(() => read(THEME_KEY) === "dark");
  const [tenant, setTenantInfo] = useState({ loading: true, info: null, missing: false });

  // the business link /b/<slug> is remembered on this device (so signing out comes back here)
  if (slug && getTenant() !== slug.toLowerCase()) setTenant(slug.toLowerCase());

  useEffect(() => {
    let live = true;
    apiRequest("/api/public/tenant").then((r) => { if (live) setTenantInfo({ loading: false, info: r.tenant, missing: false }); })
      .catch((err) => {
        if (!live) return;
        if (err.code === "tenantNotFound") { setTenant(null); setTenantInfo({ loading: false, info: null, missing: true }); }
        else setTenantInfo({ loading: false, info: null, missing: false });
      });
    return () => { live = false; };
  }, [slug]);

  useEffect(() => { if (authStatus === "signedIn") navigate(goTo, { replace: true }); }, [authStatus, navigate, goTo]);
  useEffect(() => { write(THEME_KEY, dark ? "dark" : null); }, [dark]);

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    const result = await signIn({ username: form.username.trim(), password: form.password });
    if (result.ok) {
      write(REMEMBER_KEY, remember ? form.username.trim() : null);
      await refresh();
      navigate(goTo, { replace: true });
      return;
    }
    setLoading(false);
    setStatus(["required", "invalidCredentials", "tooManyAttempts", "businessSuspended", "businessNotReady", "serverOffline"].includes(result.code) ? result.code : "failed");
  }

  const useAnother = () => { setTenant(null); navigate("/signin", { replace: true }); window.location.reload(); };
  const biz = tenant.info;
  const logo = biz?.logoPath ? fileUrl(biz.logoPath) : null;

  return (
    <main className={`signin${dark ? " signin--dark" : ""}`}>
      <span className="signin__orb signin__orb--a" aria-hidden="true" />
      <span className="signin__orb signin__orb--b" aria-hidden="true" />
      <span className="signin__orb signin__orb--c" aria-hidden="true" />

      <div className="signin__top">
        <LanguageSwitch />
        <button type="button" className="signin__theme" onClick={() => setDark((v) => !v)} aria-pressed={dark} aria-label={t("signin.theme")} title={t("signin.theme")}>
          <Icon name={dark ? "sun" : "moon"} />
        </button>
      </div>

      <section className="signin__card" aria-labelledby="signin-title">
        <div className={`signin__mark${biz && !logo ? " signin__mark--initials" : ""}`}>
          {tenant.loading ? <span className="signin__mark-wait" /> : biz ? (logo ? <img src={logo} alt={biz.name} /> : <span>{initials(biz.name)}</span>) : <img src={faatixMark} alt="Faatix" />}
        </div>
        {biz && <p className="signin__business">{biz.name}</p>}
        <h1 id="signin-title">{t("signin.welcome")}</h1>
        <p className="signin__sub">{t("signin.continue")}</p>

        {tenant.missing && <p className="signin__note" role="status"><Icon name="info" /> {t("signin.linkNotFound")}</p>}
        {biz && biz.status !== "active" && <p className="signin__note signin__note--warn" role="status"><Icon name="alert" /> {t(biz.status === "notReady" ? "signin.businessNotReady" : "signin.businessSuspended")}</p>}

        <form className="signin__form" onSubmit={handleSubmit} noValidate>
          <label className="signin__field">
            <Icon name="user" />
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck="false" required aria-label={t("signin.email")}
              placeholder={t("signin.email")} value={form.username} onChange={update} />
          </label>
          <label className="signin__field">
            <Icon name="lock" />
            <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required aria-label={t("signin.password")}
              placeholder={t("signin.password")} value={form.password} onChange={update} />
            <button className="signin__eye" type="button" aria-controls="password" aria-pressed={showPassword}
              aria-label={t(showPassword ? "signin.hide" : "signin.show")} onClick={() => setShowPassword((v) => !v)}>
              <Icon name={showPassword ? "eye" : "eye-off"} />
            </button>
          </label>

          <div className="signin__row">
            <label className="signin__check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="signin__box" aria-hidden="true"><Icon name="check" /></span>
              <span>{t("signin.remember")}</span>
            </label>
            <button type="button" className="signin__link" onClick={() => setForgot((v) => !v)} aria-expanded={forgot}>{t("signin.forgot")}</button>
          </div>
          {forgot && <p className="signin__note" role="status"><Icon name="info" /> {t(biz ? "signin.forgotHelpBusiness" : "signin.forgotHelp")}</p>}

          <p className="signin__error" role="alert" hidden={!status}>{status && t(`signin.${status}`)}</p>

          <button className="signin__submit" type="submit" disabled={loading}>
            <span>{t(loading ? "signin.loading" : "signin.submit")}</span>
            <span className="signin__submit-go" aria-hidden="true"><Icon name="arrow-right" /></span>
          </button>
        </form>

        {biz ? (
          <button type="button" className="signin__other" onClick={useAnother}>{t("signin.otherBusiness")}</button>
        ) : (
          <p className="signin__other signin__other--text">{t("signin.noAccount")} {t("signin.byFaatix")}</p>
        )}
      </section>

      <p className="signin__powered">{biz ? <>{t("signin.poweredBy")} <img src={faatixMark} alt="Faatix" /></> : "© Faatix"}</p>
    </main>
  );
}
