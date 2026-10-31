/** Replace {name}-style placeholders in a translated string. */
export function fill(text, params = {}) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
}

const LOCALES = { en: "en-US", so: "so-SO" };

export function money(value, currency = "USD", lang = "en") {
  try {
    return new Intl.NumberFormat(LOCALES[lang] || "en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value || 0);
  } catch {
    return `${currency} ${Number(value || 0).toFixed(4).replace(/0{1,2}$/, "")}`;
  }
}

export function qty(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value || 0);
}

/** Dates from the API are "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" (UTC). */
export function date(value, lang = "en", withTime = false) {
  if (!value) return "—";
  const iso = String(value).replace(" ", "T") + (String(value).length > 10 ? "Z" : "T00:00:00Z");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(value);
  const opts = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
  if (withTime && String(value).length > 10 && !String(value).endsWith("00:00:00")) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  try { return new Intl.DateTimeFormat(LOCALES[lang] || "en-US", opts).format(d); } catch { return d.toISOString().slice(0, 10); }
}

export function daysLeft(endDate) {
  if (!endDate) return null;
  const end = new Date(String(endDate).slice(0, 10) + "T00:00:00Z");
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - today) / 86400000);
}
