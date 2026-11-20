import SectionTitle from "./SectionTitle.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

/*
 * Business types that can use Faatix, as clean white cards with one large rounded
 * corner: a small photo at the top, the name and a short description.
 * Photos: client/public/images/who/biz-<n>.webp
 */
const BUSINESSES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export default function WhoSection() {
  const { t } = useLanguage();
  return (
    <section className="section who-section" id="who">
      <div className="container">
        <SectionTitle k="who.eyebrow" />
        <ul className="who-grid">
          {BUSINESSES.map((n, i) => (
            <li className="who-card" key={n} data-reveal data-reveal-delay={i % 4}>
              <img className="who-card__img" src={`/images/who/biz-${n}.webp`} alt="" width="480" height="480" loading="lazy" />
              <h3>{t(`who.b${n}`)}</h3>
              <p>{t(`who.d${n}`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
