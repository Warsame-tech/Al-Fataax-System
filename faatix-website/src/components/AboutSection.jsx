import Icon from "./Icon.jsx";
import SectionTitle from "./SectionTitle.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { site } from "../config/site.js";

const CARDS = [
  { n: 1, icon: "book-open" },
  { n: 2, icon: "smartphone" },
  { n: 3, icon: "shield-check" },
  { n: 4, icon: "headset" }
];

/*
 * "About Faatix": white top half, the office photo across the bottom half, and four
 * brand-gradient cards sitting across both (see .about-band).
 */
export default function AboutSection() {
  const { t } = useLanguage();
  const photo = site.aboutImage ? { "--about-photo": `url("${site.aboutImage}")` } : undefined;
  return (
    <section className="section about-band" id="about" style={photo}>
      <div className="container">
        <SectionTitle k="about.eyebrow" />
        <ul className="about-cards">
          {CARDS.map((c, i) => (
            <li className="about-card" key={c.n} data-reveal data-reveal-delay={i}>
              <span className="about-card__icon"><Icon name={c.icon} /></span>
              <h3>{t(`about.t${c.n}`)}</h3>
              <p>{t(`about.d${c.n}`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
