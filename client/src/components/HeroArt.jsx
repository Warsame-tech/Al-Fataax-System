import Icon from "./Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import heroPerson from "../assets/hero-person.webp";

/*
 * Right side of the home hero. The photo and its floating cards share one
 * box (.hero-figure) with the photo's exact proportions, so the cards stay
 * on the man's shoulders at every screen size.
 * Sample text on the card is illustrative only.
 */
export default function HeroArt() {
  const { t } = useLanguage();

  return (
    <div className="hero-art">
      <div className="hero-figure">
        <img className="hero-photo" src={heroPerson} alt="" width="1800" height="1025" fetchpriority="high" />

        {/* on his right shoulder (viewer's right) */}
        <div className="chip chip--invoice" aria-hidden="true">
          <span className="chip__check"><Icon name="check" /></span>
          <span className="chip__text">{t("hero.invoicePaid")}</span>
        </div>
      </div>
    </div>
  );
}
