import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import HeroArt from "../components/HeroArt.jsx";
import FeatureGrid from "../components/FeatureGrid.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import WhoSection from "../components/WhoSection.jsx";
import AboutSection from "../components/AboutSection.jsx";
import PricingSection from "../components/PricingSection.jsx";
import ContactSection from "../components/ContactSection.jsx";
import FaqSection from "../components/FaqSection.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";

/* The whole public website lives on this one page; the menu scrolls between sections. */
export default function Home() {
  const { t, lang } = useLanguage();
  usePageTitle("meta.home");

  // The slogan is two sentences, one per line. Each word animates in turn;
  // keyed by language so the animation replays after switching EN/SO.
  const lines = [t("hero.title1"), t("hero.title2")].map((line) => line.split(" "));
  const slogan = `${t("hero.title1")} ${t("hero.title2")}`;
  let n = 0; // running word index for the stagger delay

  return (
    <>
      <section className="hero">
        <div className="container hero__grid">
          <div className="hero__text" key={lang}>
            {/* decorative shapes around the slogan */}
            <span className="hero-deco hero-deco--ring" aria-hidden="true" />
            <span className="hero-deco hero-deco--ring-sm" aria-hidden="true" />
            <span className="hero-deco hero-deco--dot" aria-hidden="true" />
            <span className="hero-deco hero-deco--dot-sm" aria-hidden="true" />
            <h1 className="hero__title" aria-label={slogan}>
              {lines.map((words, li) => (
                <span className="hero__line" key={li} aria-hidden="true">
                  {words.map((word, wi) => (
                    <span key={wi}>
                      <span className="hero__word" style={{ "--i": n++ }}>{word}</span>{" "}
                    </span>
                  ))}
                </span>
              ))}
            </h1>
            <div className="hero__actions" style={{ "--i": n }}>
              <Link className="btn btn--cta btn--sweep" to="/register">
                <span>{t("common.startTrial")}</span><Icon name="arrow-right" />
              </Link>
            </div>
          </div>
          <HeroArt />
        </div>
      </section>

      <section className="section section--band" id="features">
        <div className="container">
          <SectionTitle k="modules.eyebrow" />
          <FeatureGrid />
        </div>
      </section>

      <WhoSection />
      <AboutSection />
      <PricingSection />
      <FaqSection />
      <ContactSection />
    </>
  );
}
