import Icon from "./Icon.jsx";
import SectionTitle from "./SectionTitle.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

/** Frequently asked questions: a clean accordion (native <details>, works without JS). */
export default function FaqSection() {
  const { t } = useLanguage();
  const items = t("faq.items");
  return (
    <section className="section faq-section" id="faq">
      <div className="container">
        <SectionTitle k="faq.eyebrow" />
        <div className="faq">
          {(Array.isArray(items) ? items : []).map(([q, a], i) => (
            <details className="faq__item" key={q} open={i === 0} data-reveal>
              <summary>
                <span>{q}</span>
                <span className="faq__toggle" aria-hidden="true"><Icon name="plus" /></span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
