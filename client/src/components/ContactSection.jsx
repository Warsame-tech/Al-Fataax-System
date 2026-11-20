import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import BuildingArt from "./BuildingArt.jsx";
import SectionTitle from "./SectionTitle.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { site } from "../config/site.js";
import { apiRequest } from "../services/api.js";

const tel = (n) => "tel:" + n.replace(/[^\d+]/g, "");

/*
 * "Get in touch" — one navy panel: tappable contact cards (phones + email + WhatsApp) on the left, the office photo with
 * the Faatix sign on the right; under it a short "Send us a message" form (POST /api/contact — the super admin reads it in
 * Support → Website messages). The contact details come from the super admin's System settings (GET /api/contact/platform);
 * until they are set there, the ones in config/site.js are shown.
 */
export default function ContactSection() {
  const { t } = useLanguage();
  const [contact, setContact] = useState(site.contact);
  useEffect(() => {
    apiRequest("/api/contact/platform").then((r) => {
      const c = r.contact || {};
      if (c.phones?.length || c.emails?.length) setContact({ phones: c.phones?.length ? c.phones : site.contact.phones, emails: c.emails?.length ? c.emails : site.contact.emails, whatsapp: c.whatsapp, address: c.address });
    }).catch(() => {});
  }, []);
  const { phones, emails } = contact;

  // All phone numbers share one card; each email gets its own.
  const items = [
    { key: "phones", icon: "phone", label: t("contact.phone"), tone: "orange", ltr: true,
      links: phones.map((p) => ({ href: tel(p), value: p })) },
    ...emails.map((e) => ({ key: e, icon: "mail", label: t("contact.email"), tone: "blue",
      links: [{ href: `mailto:${e}`, value: e }] })),
    ...(contact.whatsapp ? [{ key: "wa", icon: "message", label: "WhatsApp", tone: "orange", ltr: true,
      links: [{ href: `https://wa.me/${contact.whatsapp.replace(/[^\d]/g, "")}`, value: contact.whatsapp }] }] : [])
  ];

  return (
    <section className="section" id="contact">
      <div className="container">
        <SectionTitle k="contact.eyebrow" />

        <div className="contact-panel" data-reveal>
          <ul className="contact-cards">
            {items.map((it) => (
              <li key={it.key} className={`contact-card contact-card--${it.tone}`}>
                <span className="contact-card__icon"><Icon name={it.icon} /></span>
                <span className="contact-card__text">
                  <small>{it.label}</small>
                  {it.links.map((l) => (
                    <a key={l.value} href={l.href}><strong dir={it.ltr ? "ltr" : undefined}>{l.value}</strong></a>
                  ))}
                </span>
                <span className="contact-card__go" aria-hidden="true"><Icon name="arrow-right" /></span>
              </li>
            ))}
          </ul>

          <div className="contact-panel__media">
            {site.contactImage ? <img src={site.contactImage} alt="Faatix office building" /> : <BuildingArt variant="dusk" />}
          </div>
        </div>
        <MessageForm />
      </div>
    </section>
  );
}

function MessageForm() {
  const { t } = useLanguage();
  const [f, setF] = useState({ name: "", phone: "", email: "", message: "" });
  const [state, setState] = useState({ busy: false, sent: false, errors: {}, error: null });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (e) => {
    e.preventDefault();
    setState({ busy: true, sent: false, errors: {}, error: null });
    try {
      await apiRequest("/api/contact", { method: "POST", body: f });
      setF({ name: "", phone: "", email: "", message: "" });
      setState({ busy: false, sent: true, errors: {}, error: null });
    } catch (err) {
      setState({ busy: false, sent: false, errors: err?.data?.errors || {}, error: err?.data?.code === "tooManyAttempts" ? "contact.form.tooMany" : err?.data?.errors ? null : "contact.form.failed" });
    }
  };
  const bad = (k) => (state.errors[k] ? " has-error" : "");
  return (
    <form className="contact-form" onSubmit={send} data-reveal>
      <div className="contact-form__head"><Icon name="message" /><div><h3>{t("contact.form.title")}</h3><p>{t("contact.form.sub")}</p></div></div>
      <div className="contact-form__grid">
        <input className={"input" + bad("name")} value={f.name} onChange={set("name")} placeholder={t("contact.form.name")} aria-label={t("contact.form.name")} maxLength={120} />
        <input className={"input" + bad("phone")} type="tel" value={f.phone} onChange={set("phone")} placeholder={t("contact.form.phone")} aria-label={t("contact.form.phone")} maxLength={40} />
        <input className={"input" + bad("email")} type="email" value={f.email} onChange={set("email")} placeholder={t("contact.form.email")} aria-label={t("contact.form.email")} maxLength={190} />
        <textarea className={"input contact-form__msg" + bad("message")} rows="3" value={f.message} onChange={set("message")} placeholder={t("contact.form.message")} aria-label={t("contact.form.message")} maxLength={4000} />
      </div>
      {state.errors.phone === "emailOrPhone" && <p className="form-status form-status--error">{t("contact.form.needContact")}</p>}
      {(state.errors.name || state.errors.message) && <p className="form-status form-status--error">{t("contact.form.needAll")}</p>}
      {state.error && <p className="form-status form-status--error">{t(state.error)}</p>}
      {state.sent && <p className="form-status form-status--success" role="status"><Icon name="check" /> {t("contact.form.sent")}</p>}
      <button type="submit" className="btn btn--primary" disabled={state.busy}><span>{t(state.busy ? "contact.form.sending" : "contact.form.send")}</span><Icon name="arrow-right" /></button>
    </form>
  );
}
