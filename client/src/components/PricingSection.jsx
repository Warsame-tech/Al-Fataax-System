import { Link } from "react-router-dom";
import Icon from "./Icon.jsx";
import SectionTitle from "./SectionTitle.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

/*
 * Two plans on a brand-blue section. Each card: a head (name, big price, short
 * text) that ends in a soft wave, then a check list and a pill button.
 * The monthly plan has a solid blue head and is tagged "Recommended".
 */
const PLANS = [
  { id: "trial", list: "trialList", cta: "trialCta" },
  { id: "monthly", list: "monthlyList", cta: "monthlyCta", featured: true }
];

export default function PricingSection() {
  const { t } = useLanguage();
  return (
    <section className="section plans-section" id="pricing">
      <div className="container">
        <SectionTitle k="pricing.eyebrow" />

        <div className="plans">
          {PLANS.map((plan, i) => {
            const items = t(`pricing.${plan.list}`);
            return (
              <article className={"plan" + (plan.featured ? " plan--featured" : "")} key={plan.id} data-reveal data-reveal-delay={i}>
                <div className="plan__head">
                  {plan.featured && <span className="plan__tag">{t("pricing.recommended")}</span>}
                  <h3 className="plan__name">{t(`pricing.${plan.id}`)}</h3>
                  <p className="plan__price">
                    <strong>{t(`pricing.${plan.id}Price`)}</strong>
                    <span>/ {t(`pricing.${plan.id}Unit`)}</span>
                  </p>
                  <p className="plan__text">{t(`pricing.${plan.id}Text`)}</p>
                  <svg className="plan__wave" viewBox="0 0 360 56" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M0 30 C 70 0, 150 0, 210 22 S 320 56, 360 18 L 360 56 L 0 56 Z" />
                  </svg>
                </div>
                <div className="plan__body">
                  <p className="plan__includes">{t("pricing.includes")}</p>
                  <ul className="plan__list">
                    {(Array.isArray(items) ? items : []).map((item) => (
                      <li key={item}><Icon name="check" /><span>{item}</span></li>
                    ))}
                  </ul>
                  <Link className="plan__btn" to="/register">{t(`pricing.${plan.cta}`)}</Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
