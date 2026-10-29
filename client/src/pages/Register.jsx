import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";
import { register } from "../services/authService.js";

/* Business categories (same list as the server: routes/auth.js; "fashion" = Clothing) */
const TYPES = ["supermarket", "cosmetics", "fashion", "pharmacy", "electronics", "jewelry", "fabric"];
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const EMPTY = { businessName: "", businessType: "", phone: "", ownerName: "", username: "", password: "", confirmPassword: "" };

/* Same rules as the server; the server re-checks everything. */
function validate(f, logo) {
  const e = {};
  if (f.businessName.trim().length < 2) e.businessName = "required";
  if (!f.businessType) e.businessType = "required";
  if (!/^\+?[0-9\s-]{7,20}$/.test(f.phone.trim())) e.phone = "invalidPhone";
  if (f.ownerName.trim().length < 2) e.ownerName = "required";
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(f.username.trim())) e.username = "invalidUsername";
  if (!f.password) e.password = "required"; // the owner may choose any password
  if (f.confirmPassword !== f.password) e.confirmPassword = "passwordMismatch";
  if (logo && !LOGO_TYPES.includes(logo.type)) e.logo = "invalidLogo";
  if (logo && logo.size > 2 * 1024 * 1024) e.logo = "logoTooLarge";
  return e;
}

/*
 * Business sign-up: centred title, fields on the left (business details, then owner
 * & sign-in), a large logo upload panel on the right.
 */
export default function Register() {
  const { t } = useLanguage();
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  usePageTitle("meta.register");

  const [form, setForm] = useState(EMPTY);
  const [logo, setLogo] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { if (status === "signedIn") navigate("/app", { replace: true }); }, [status, navigate]);
  useEffect(() => () => logoUrl && URL.revokeObjectURL(logoUrl), [logoUrl]);

  const update = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((x) => ({ ...x, [name]: undefined }));
  };

  const pickLogo = (e) => {
    const file = e.target.files?.[0] || null;
    setLogo(file);
    setLogoUrl(file ? URL.createObjectURL(file) : null);
    setErrors((x) => ({ ...x, logo: validate(EMPTY, file).logo }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const errs = validate(form, logo);
    setErrors(errs);
    if (Object.keys(errs).length) { setFormError("fixErrors"); return; }

    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v.trim()));
    fd.set("password", form.password);
    fd.set("confirmPassword", form.confirmPassword);
    if (logo) fd.append("logo", logo);

    setLoading(true);
    const result = await register(fd);
    setLoading(false);
    if (result.ok) {
      await refresh();
      navigate("/app", { replace: true });
      return;
    }
    if (result.errors) { setErrors(result.errors); setFormError("fixErrors"); }
    else setFormError(result.code === "serverOffline" ? "errors.serverOffline" : "errors.failed");
  }

  const err = (name) => errors[name] && <span className="field__error" id={`${name}-err`}>{t(`register.errors.${errors[name]}`)}</span>;
  const aria = (name) => (errors[name] ? { "aria-invalid": true, "aria-describedby": `${name}-err` } : {});

  return (
    <section className="auth register">
      <div className="container">
        <div className="register__card">
          <Link className="auth__back" to="/"><Icon name="arrow-left" /><span>{t("signin.back")}</span></Link>
          <h1>{t("register.title")}</h1>

          <form className="form register__form" onSubmit={handleSubmit} noValidate>
            <div className="register__fields">
              <fieldset>
                <legend>{t("register.business")}</legend>
                <div className="field">
                  <label htmlFor="businessName">{t("register.businessName")}</label>
                  <input className="input" id="businessName" name="businessName" autoComplete="organization" placeholder={t("register.businessNamePh")} value={form.businessName} onChange={update} {...aria("businessName")} />
                  {err("businessName")}
                </div>
                <div className="form__grid">
                  <div className="field">
                    <label htmlFor="businessType">{t("register.businessType")}</label>
                    <select className="input input--type" id="businessType" name="businessType" value={form.businessType} onChange={update} {...aria("businessType")}>
                      <option value="">{t("register.choose")}</option>
                      {TYPES.map((x) => <option key={x} value={x}>{t(`register.types.${x}`)}</option>)}
                    </select>
                    {err("businessType")}
                  </div>
                  <div className="field">
                    <label htmlFor="phone">{t("register.phone")}</label>
                    <input className="input" id="phone" name="phone" type="tel" autoComplete="tel" placeholder={t("register.phonePh")} value={form.phone} onChange={update} {...aria("phone")} />
                    {err("phone")}
                  </div>
                </div>
              </fieldset>

              <fieldset>
                <legend>{t("register.owner")}</legend>
                <div className="form__grid">
                  <div className="field">
                    <label htmlFor="ownerName">{t("register.ownerName")}</label>
                    <input className="input" id="ownerName" name="ownerName" autoComplete="name" placeholder={t("register.ownerNamePh")} value={form.ownerName} onChange={update} {...aria("ownerName")} />
                    {err("ownerName")}
                  </div>
                  <div className="field">
                    <label htmlFor="username">{t("register.username")}</label>
                    <input className="input" id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder={t("register.usernamePh")} value={form.username} onChange={update} {...aria("username")} />
                    {err("username")}
                  </div>
                  <div className="field">
                    <label htmlFor="password">{t("register.password")}</label>
                    <div className="input-wrap">
                      <Icon name="lock" />
                      <input id="password" name="password" type={showPw ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={update} {...aria("password")} />
                      <button className="password-toggle" type="button" aria-controls="password" aria-pressed={showPw}
                        aria-label={t(showPw ? "signin.hide" : "signin.show")} onClick={() => setShowPw((v) => !v)}>
                        <Icon name={showPw ? "eye-off" : "eye"} />
                      </button>
                    </div>
                    {err("password")}
                  </div>
                  <div className="field">
                    <label htmlFor="confirmPassword">{t("register.confirmPassword")}</label>
                    <div className="input-wrap">
                      <Icon name="lock" />
                      <input id="confirmPassword" name="confirmPassword" type={showPw ? "text" : "password"} autoComplete="new-password" value={form.confirmPassword} onChange={update} {...aria("confirmPassword")} />
                    </div>
                    {err("confirmPassword")}
                  </div>
                </div>
              </fieldset>
            </div>

            {/* Large logo upload panel (right column on wide screens) */}
            <div className="register__logo">
              <span className="field__label">{t("register.logo")}</span>
              <button type="button" className={"logo-drop" + (errors.logo ? " has-error" : "")} onClick={() => fileRef.current?.click()}
                aria-label={logo ? t("register.logoChange") : t("register.logoChoose")}>
                {logoUrl ? <img src={logoUrl} alt="" /> : (
                  <span className="logo-drop__empty">
                    <Icon name="image" />
                    <Icon name="upload" className="logo-drop__up" />
                  </span>
                )}
              </button>
              <button type="button" className="btn btn--outline" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" /><span>{logo ? t("register.logoChange") : t("register.logoChoose")}</span>
              </button>
              <small className="field__hint">{t("register.logoHint")}</small>
              {err("logo")}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickLogo} />
            </div>

            <div className="register__submit">
              <p className="form-status form-status--error" role="alert" hidden={!formError}>
                {formError && t(formError === "fixErrors" ? "register.fixErrors" : `register.${formError}`)}
              </p>
              <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={loading}>
                <span>{t(loading ? "register.loading" : "register.submit")}</span><Icon name="arrow-right" />
              </button>
            </div>
          </form>

          <p className="auth__alt">{t("register.haveAccount")} <Link className="text-link" to="/signin">{t("register.signIn")}</Link></p>
        </div>
      </div>
    </section>
  );
}
