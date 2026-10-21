import Icon from "./Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export const MODULES = [
  { n: 1, icon: "cart" },       // POS / Sales
  { n: 2, icon: "receipt" },    // Sales Invoices
  { n: 3, icon: "package" },    // Products & Inventory
  { n: 4, icon: "users" },      // Customers & Receivables
  { n: 5, icon: "truck" },      // Purchases & Suppliers
  { n: 6, icon: "wallet" },     // Expenses & Income
  { n: 7, icon: "chart-line" }, // Reports
  { n: 8, icon: "settings" }    // Users & Settings
];

/*
 * Eight features as centred columns on the brand gradient band (.section--band):
 * a white icon circle, the title and a short description.
 */
export default function FeatureGrid() {
  const { t } = useLanguage();
  return (
    <ul className="feat-band">
      {MODULES.map((m, i) => (
        <li className="feat-band__item" key={m.n} data-reveal data-reveal-delay={i % 4}>
          <span className="feat-band__icon"><Icon name={m.icon} /></span>
          <h3>{t(`modules.m${m.n}`)}</h3>
          <p>{t(`modules.m${m.n}Text`)}</p>
        </li>
      ))}
    </ul>
  );
}
