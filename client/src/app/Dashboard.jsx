import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";
import { MODULES, QUICK_ACTIONS } from "./modules.js";
import { usePerm } from "./ui.jsx";
import { useProfile } from "./profile.js";
import { ClockCard } from "./Hr.jsx";
import { ACTIONS, useShortcuts, Kbd } from "./Shortcuts.jsx";

/*
 * Business dashboard: quick actions, then large module buttons (5 per row).
 * Totals, activity and stock alerts live in the "Business overview" module.
 */
const QUICK_KEYS = { newSale: "pos", newInvoice: "newInvoice" };

export default function Dashboard() {
  const { t } = useLanguage();
  const can = usePerm();
  const quick = QUICK_ACTIONS.filter((a) => can(a.perm));
  // the keyboard shortcut of each tile / quick action, shown on it (Shortcuts.jsx)
  const { keyOf } = useShortcuts();
  const moduleKey = (id) => keyOf(ACTIONS.find((x) => x.to === `/app/m/${id}`)?.id);
  const profile = useProfile();
  const tiles = MODULES.filter((mod) => (!mod.perm || can(mod.perm)) && (!mod.profile || profile[mod.profile]));
  usePageTitle("meta.app");

  return (
    <div className="dash">
      <ClockCard />
      {quick.length > 0 && (
        <section className="dash-block" aria-labelledby="qa-title">
          <h2 id="qa-title" className="dash-title">{t("app.quick.title")}</h2>
          <div className="dash-quick">
            {quick.map((a) => (
              <Link key={a.key} to={a.to} className={`dash-quick__btn dash-quick__btn--${a.tone}`}>
                <span className="dash-quick__icon"><Icon name={a.icon} /></span>
                <span>{t(`app.quick.${a.key}`)}</span>
                <Kbd combo={keyOf(QUICK_KEYS[a.key])} className="dash-quick__kbd" />
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
              <Kbd combo={moduleKey(mod.id)} className="dash-tile__kbd" />
            </Link>
          ))}
        </nav>
      </section>
    </div>
  );
}
