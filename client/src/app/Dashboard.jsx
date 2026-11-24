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
 * Business dashboard: quick actions, then a button per module, and two combined buttons (Money & reports, Business)
 * that open a page with their modules (GroupPage); a combined button with a single module goes straight to it. Totals, activity and stock alerts live in "Business overview".
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
      {/* organised sections of plain links (not buttons): a title, then each module with a one-line description */}
      <div className="group-sections">
        {(g.sections || [{ id: "all", modules: g.modules }]).map((sec) => {
          const items = sec.modules.map((mid) => g.items.find((m) => m.id === mid)).filter(Boolean);
          if (!items.length) return null;
          return (
            <section key={sec.id} className="group-section" aria-labelledby={`gs-${sec.id}`}>
              <h2 id={`gs-${sec.id}`} className="group-section__title">{t(`app.groups.sections.${sec.id}`)}</h2>
              <ul className="group-links">
                {items.map((mod) => (
                  <li key={mod.id}>
                    <Link to={`/app/m/${mod.id}`} className="group-link" style={{ "--tile": mod.color }}>
                      <Icon name={mod.icon} className="group-link__icon" />
                      <span className="group-link__text"><strong>{t(`app.modules.${mod.id}`)}</strong><small>{t(`app.groups.desc.${mod.id}`)}</small></span>
                      <Kbd combo={moduleKey(mod.id)} className="group-link__kbd" />
                      <Icon name="chevron-right" className="group-link__go" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
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
  const visible = useVisibleModules();
  const grouped = new Set(groups.flatMap((g) => g.modules));
  const single = visible.filter((m) => !grouped.has(m.id));   // every module outside the combined buttons keeps its own button
  const moduleKey = (id) => keyOf(ACTIONS.find((x) => x.to === `/app/m/${id}`)?.id);
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
          {single.map((mod) => (
            <Link key={mod.id} to={`/app/m/${mod.id}`} className="dash-tile" style={{ "--tile": mod.color }}>
              <span className="dash-tile__icon"><Icon name={mod.icon} /></span>
              <span className="dash-tile__label">{t(`app.modules.${mod.id}`)}</span>
              <Kbd combo={moduleKey(mod.id)} className="dash-tile__kbd" />
            </Link>
          ))}
          {/* the combined buttons: money in / out, and running the business */}
          {groups.map((g) => (
            <Link key={g.id} to={g.items.length === 1 ? `/app/m/${g.items[0].id}` : `/app/g/${g.id}`} className="dash-tile dash-tile--group" style={{ "--tile": g.color }}>
              <span className="dash-tile__icon"><Icon name={g.icon} /></span>
              <span className="dash-tile__label">{t(`app.groups.${g.id}`)}</span>
              <small className="dash-tile__count">{fill(t("app.groups.count"), { n: g.items.length })}</small>
            </Link>
          ))}
        </nav>
      </section>
    </div>
  );
}
