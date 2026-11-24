import { Link, Navigate, useParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";
import { MODULES, QUICK_ACTIONS, GROUPS } from "./modules.js";
import { usePerm, useModuleOff, PageHeader } from "./ui.jsx";
import { fill } from "./format.js";
import { useProfile } from "./profile.js";
import { ClockCard } from "./Hr.jsx";
import { ACTIONS, useShortcuts, Kbd } from "./Shortcuts.jsx";

/*
 * Business dashboard: quick actions, then one button per group of modules (Sales, Products & stock, Purchasing,
 * Money & reports, Business). A group opens its own page with its modules (GroupPage); a group with a single
 * module the user can open goes straight to it. Totals, activity and stock alerts live in "Business overview".
 */
/** The modules this user may open (permissions, business type, modules switched off by Faatix). */
export function useVisibleModules() {
  const can = usePerm();
  const off = useModuleOff();
  const profile = useProfile();
  return MODULES.filter((mod) => (!mod.perm || can(mod.perm)) && (!mod.profile || profile[mod.profile]) && !off(mod.id));
}
/** The groups with the modules the user may open in each (empty groups left out). */
export function useVisibleGroups() {
  const visible = useVisibleModules();
  return GROUPS.map((g) => ({ ...g, items: g.modules.map((id) => visible.find((m) => m.id === id)).filter(Boolean) })).filter((g) => g.items.length);
}
const QUICK_KEYS = { newSale: "pos", newInvoice: "newInvoice" };

/* /app/g/<group>: the modules of one group, as the dashboard used to show them (with their keyboard shortcuts) */
export function GroupPage() {
  const { t } = useLanguage();
  const { id } = useParams();
  const { keyOf } = useShortcuts();
  const groups = useVisibleGroups();
  const g = groups.find((x) => x.id === id);
  usePageTitle("meta.app");
  if (!g) return <Navigate to="/app" replace />;
  const moduleKey = (mid) => keyOf(ACTIONS.find((x) => x.to === `/app/m/${mid}`)?.id);
  return (
    <div className="page">
      <PageHeader icon={g.icon} title={t(`app.groups.${g.id}`)} back="/app" />
      <p className="page-help"><Icon name="info" /> {t(`app.groups.help.${g.id}`)}</p>
      <nav className="dash-tiles" aria-label={t(`app.groups.${g.id}`)}>
        {g.items.map((mod) => (
          <Link key={mod.id} to={`/app/m/${mod.id}`} className="dash-tile" style={{ "--tile": mod.color }}>
            <span className="dash-tile__icon"><Icon name={mod.icon} /></span>
            <span className="dash-tile__label">{t(`app.modules.${mod.id}`)}</span>
            <Kbd combo={moduleKey(mod.id)} className="dash-tile__kbd" />
          </Link>
        ))}
      </nav>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useLanguage();
  const can = usePerm();
  const off = useModuleOff();
  const quick = QUICK_ACTIONS.filter((a) => can(a.perm) && !(a.module && off(a.module)));
  // the keyboard shortcut of each tile / quick action, shown on it (Shortcuts.jsx)
  const { keyOf } = useShortcuts();
  const groups = useVisibleGroups();
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
        <nav className="dash-groups" aria-labelledby="mod-title">
          {groups.map((g) => (
            <Link key={g.id} to={g.items.length === 1 ? `/app/m/${g.items[0].id}` : `/app/g/${g.id}`} className="dash-group" style={{ "--tile": g.color }}>
              <span className="dash-group__head">
                <span className="dash-tile__icon"><Icon name={g.icon} /></span>
                <span className="dash-group__title"><strong>{t(`app.groups.${g.id}`)}</strong><small>{fill(t("app.groups.count"), { n: g.items.length })}</small></span>
                <Icon name="arrow-right" className="dash-group__go" />
              </span>
              <span className="dash-group__list">{g.items.map((m) => <span key={m.id}><Icon name={m.icon} />{t(`app.modules.${m.id}`)}</span>)}</span>
            </Link>
          ))}
        </nav>
      </section>
    </div>
  );
}
