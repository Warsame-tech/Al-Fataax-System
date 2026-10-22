import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Logo from "../components/Logo.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";
import { signIn } from "../services/authService.js";

const PERKS = ["about.check1", "about.check2", "about.check3"];

export default function SignIn() {
  const { t } = useLanguage();
  const { status: authStatus, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  usePageTitle("meta.signin");

  const goTo = location.state?.from?.startsWith("/app") ? location.state.from : "/app";
  const [form, setForm] = useState({ username: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => { if (authStatus === "signedIn") navigate(goTo, { replace: true }); }, [authStatus, navigate, goTo]);

  const update = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);
    const result = await signIn({ username: form.username.trim(), password: form.password });
    if (result.ok) {
      await refresh();
      navigate(goTo, { replace: true });
      return;
    }
    setLoading(false);
    setStatus(["required", "invalidCredentials", "tooManyAttempts", "businessSuspended", "serverOffline"].includes(result.code) ? result.code : "failed");
  }

  return (
    <section className="auth">
      <div className="container">
        <div className="auth__shell">
          <aside className="auth__aside">
            <Logo light linked={false} />
            <h2>{t("signin.panelTitle")}</h2>
            <ul className="check-list">
              {PERKS.map((key) => <li key={key}><Icon name="check" /><span>{t(key)}</span></li>)}
            </ul>
          </aside>

          <div className="auth__form">
            <Link className="auth__back" to="/"><Icon name="arrow-left" /><span>{t("signin.back")}</span></Link>
            <h1>{t("signin.title")}</h1>
            <p>{t("signin.subtitle")}</p>

            <form className="form" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="username">{t("signin.email")}</label>
                <div className="input-wrap">
                  <Icon name="user" />
                  <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck="false" required
                    placeholder={t("signin.emailPh")} value={form.username} onChange={update} />
                </div>
              </div>

              <div className="field">
                <label htmlFor="password">{t("signin.password")}</label>
                <div className="input-wrap">
                  <Icon name="lock" />
                  <input id="password" name="password" type={showPassword ? "text" : "password"}
                    autoComplete="current-password" required
                    placeholder={t("signin.passwordPh")} value={form.password} onChange={update} />
                  <button className="password-toggle" type="button" aria-controls="password"
                    aria-pressed={showPassword} aria-label={t(showPassword ? "signin.hide" : "signin.show")}
                    onClick={() => setShowPassword((v) => !v)}>
                    <Icon name={showPassword ? "eye-off" : "eye"} />
                  </button>
                </div>
              </div>

              <p className="form-status form-status--error" role="alert" hidden={!status}>
                {status && t(`signin.${status}`)}
              </p>

              <button className="btn btn--blue btn--lg btn--block" type="submit" disabled={loading}>
                <span>{t(loading ? "signin.loading" : "signin.submit")}</span><Icon name="arrow-right" />
              </button>
            </form>

            <p className="auth__alt">{t("signin.noAccount")} <Link className="text-link" to="/register">{t("signin.trial")}</Link></p>
          </div>
        </div>
      </div>
    </section>
  );
}
