import { Navigate, useParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import usePageTitle from "../hooks/usePageTitle.js";
import { moduleById } from "./modules.js";
import { usePerm, PageHeader } from "./ui.jsx";
import Products from "./pages/Products.jsx";
import Parties from "./pages/Parties.jsx";
import Pos from "./pages/Pos.jsx";
import Invoices from "./pages/Invoices.jsx";
import Purchases from "./pages/Purchases.jsx";
import Reports from "./pages/Reports.jsx";
import Overview from "./pages/Overview.jsx";
import Stock from "./pages/Stock.jsx";
import { Expenses, Cashbook } from "./pages/MoneyPages.jsx";
import { Staff, BusinessInfo, Settings, Profile, Subscription, Audit } from "./pages/AccountPages.jsx";
import { DevicesPage, WarrantiesPage } from "./Devices.jsx";
import { MetalRatesPage, UsedGoldPage } from "./Jewelry.jsx";
import { useProfile } from "./profile.js";

const SCREENS = {
  overview: Overview,
  pos: Pos,
  invoices: Invoices,
  customers: () => <Parties kind="customers" />,
  suppliers: () => <Parties kind="suppliers" />,
  purchases: Purchases,
  products: Products,
  stock: Stock,
  devices: DevicesPage,
  warranties: WarrantiesPage,
  metalRates: MetalRatesPage,
  usedGold: UsedGoldPage,
  expenses: Expenses,
  cashbook: Cashbook,
  reports: Reports,
  staff: Staff,
  business: BusinessInfo,
  profile: Profile,
  subscription: Subscription,
  settings: Settings,
  audit: Audit
};

/** Routes /app/m/:id to its screen, after a permission check. */
export default function ModulePage() {
  const { id } = useParams();
  const { t } = useLanguage();
  const can = usePerm();
  const profile = useProfile();
  usePageTitle("meta.app");
  const mod = moduleById(id);
  if (!mod || (mod.profile && !profile[mod.profile])) return <Navigate to="/app" replace />;
  if (mod.perm && !can(mod.perm)) {
    return (
      <div className="page">
        <PageHeader icon={mod.icon} title={t(`app.modules.${mod.id}`)} />
        <div className="module-page__card"><Icon name="lock" /><p>{t("ui.errors.forbidden")}</p></div>
      </div>
    );
  }
  const Screen = SCREENS[mod.id];
  return <Screen key={mod.id} />;
}
