/*
 * Small SVG charts for the super admin (no chart library): AreaChart (a line with a soft fill), BarChart, Donut and
 * Sparkline. They scale to their box (viewBox), use the brand colours, and every point has a tooltip (<title>).
 */
const W = 640;
const H = 220;
const PAD = { l: 44, r: 12, t: 14, b: 30 };
const monthLabel = (m, lang) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString(lang === "so" ? "so" : "en", { month: "short", timeZone: "UTC" });
};
/* round axis top: 0, 1, 2, 5, 10, 20, 50… × power of ten */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function Axes({ max, data, lang, fmt }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const ih = H - PAD.t - PAD.b;
  const step = (W - PAD.l - PAD.r) / Math.max(1, data.length);
  return (
    <g className="chart__axes">
      {ticks.map((f) => {
        const y = PAD.t + ih - f * ih;
        return <g key={f}><line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} /><text x={PAD.l - 8} y={y + 4} textAnchor="end">{fmt(max * f)}</text></g>;
      })}
      {data.map((d, i) => (i % (data.length > 12 ? 2 : 1) === 0
        ? <text key={d.month} x={PAD.l + step * i + step / 2} y={H - 8} textAnchor="middle">{monthLabel(d.month, lang)}</text> : null))}
    </g>
  );
}
const compact = (v) => (v >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : v >= 1e3 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10));

export function AreaChart({ data, lang = "en", color = "var(--blue)", format = compact, label }) {
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ih = H - PAD.t - PAD.b;
  const step = (W - PAD.l - PAD.r) / Math.max(1, data.length);
  const pts = data.map((d, i) => [PAD.l + step * i + step / 2, PAD.t + ih - (d.value / max) * ih]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts.at(-1)[0].toFixed(1)},${PAD.t + ih} L${pts[0][0].toFixed(1)},${PAD.t + ih} Z` : "";
  const id = `area-${String(color).replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".32" /><stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <Axes max={max} data={data} lang={lang} fmt={compact} />
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" className="chart__dot" style={{ "--c": color }}><title>{`${monthLabel(data[i].month, lang)} ${data[i].month.slice(0, 4)}: ${format(data[i].value)}`}</title></circle>
      ))}
    </svg>
  );
}

export function BarChart({ data, lang = "en", color = "var(--orange)", format = compact, label }) {
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ih = H - PAD.t - PAD.b;
  const step = (W - PAD.l - PAD.r) / Math.max(1, data.length);
  const bw = Math.min(28, step * 0.58);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <Axes max={max} data={data} lang={lang} fmt={compact} />
      {data.map((d, i) => {
        const h = (d.value / max) * ih;
        const x = PAD.l + step * i + (step - bw) / 2;
        return (
          <rect key={d.month} x={x} y={PAD.t + ih - h} width={bw} height={Math.max(h, d.value ? 2 : 0)} rx="5" className="chart__bar" style={{ "--c": color }}>
            <title>{`${monthLabel(d.month, lang)} ${d.month.slice(0, 4)}: ${format(d.value)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

const PALETTE = ["#2373f4", "#ff8a4c", "#0b0d3d", "#1f9d61", "#7c3aed", "#d4a017", "#dc2626", "#0f9488", "#be185d", "#64748b"];
export const paletteColor = (i) => PALETTE[i % PALETTE.length];

/* items: [{ label, value }] — a ring with the total in the middle */
export function Donut({ items, center, sub, size = 168 }) {
  const total = items.reduce((s, x) => s + x.value, 0) || 1;
  const r = 60;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg className="donut" viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={sub}>
      <circle cx="80" cy="80" r={r} fill="none" stroke="#eef0f6" strokeWidth="20" />
      {items.map((x, i) => {
        const len = (x.value / total) * c;
        const seg = <circle key={x.label} cx="80" cy="80" r={r} fill="none" stroke={paletteColor(i)} strokeWidth="20" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off}
          transform="rotate(-90 80 80)"><title>{`${x.label}: ${x.value}`}</title></circle>;
        off += len;
        return seg;
      })}
      <text x="80" y="78" textAnchor="middle" className="donut__value">{center}</text>
      <text x="80" y="98" textAnchor="middle" className="donut__sub">{sub}</text>
    </svg>
  );
}

/* a tiny trend line inside a card */
export function Sparkline({ data, color = "var(--blue)" }) {
  const vals = data.map((d) => d.value);
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * 100},${30 - (v / max) * 26}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
