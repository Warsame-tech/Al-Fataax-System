import Icon from "./Icon.jsx";
import BuildingArt from "./BuildingArt.jsx";
import SectionTitle from "./SectionTitle.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { site } from "../config/site.js";

const tel = (n) => "tel:" + n.replace(/[^\d+]/g, "");

/*
 * "Get in touch" — one navy panel: tappable contact cards (phones + email) on the
 * left, the office photo with the Faatix sign on the right.
 */
export default function ContactSection() {
  const { t } = useLanguage();
  const { phones, emails } = site.contact;

  // All phone numbers share one card; each email gets its own.
  const items = [
    { key: "phones", icon: "phone", label: t("contact.phone"), tone: "orange", ltr: true,
      links: phones.map((p) => ({ href: tel(p), value: p })) },
    ...emails.map((e) => ({ key: e, icon: "mail", label: t("contact.email"), tone: "blue",
      links: [{ href: `mailto:${e}`, value: e }] }))
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
      </div>
    </section>
  );
}
