import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";
import { MODULES, QUICK_ACTIONS } from "./modules.js";
import { usePerm } from "./ui.jsx";

/*
 * Business dashboard: quick actions, then large module buttons (5 per row).
 * Totals, activity and stock alerts live in the "Business overview" module.
 */
export default function Dashboard() {
  const { t } = useLanguage();
  const can = usePerm();
  const quick = QUICK_ACTIONS.filter((a) => can(a.perm));
  const tiles = MODULES.filter((mod) => !mod.perm || can(mod.perm));
  usePageTitle("meta.app");

  return (
    <div className="dash">
      {quick.length > 0 && (
        <section className="dash-block" aria-labelledby="qa-title">
          <h2 id="qa-title" className="dash-title">{t("app.quick.title")}</h2>
          <div className="dash-quick">
            {quick.map((a) => (
              <Link key={a.key} to={a.to} className={`dash-quick__btn dash-quick__btn--${a.tone}`}>
                <span className="dash-quick__icon"><Icon name={a.icon} /></span>
                <span>{t(`app.quick.${a.key}`)}</span>
                <Icon name="plus" className="dash-quick__plus" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="dash-block" aria-labelledby="mod-title">
        <h2 id="mod-title" className="dash-title">{t("app.sections.modules")}</h2>
        <nav className="dash-tiles" aria-labelledby="mod-title">
          {tiles.map((mod) => (
            <Link key={mod.id} to={`/app/m/${mod.id}`} className="dash-tile" style={{ "--tile": mod.color }}>
              <span className="dash-tile__icon"><Icon name={mod.icon} /></span>
              <span className="dash-tile__label">{t(`app.modules.${mod.id}`)}</span>
            </Link>
          ))}
        </nav>
      </section>
    </div>
  );
}
