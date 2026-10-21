import { useId } from "react";
import logo from "../assets/faatix-logo.png";

/*
 * Illustration of the Faatix office building with the logo on its sign.
 * variant "day" (light sky) or "dusk" (navy sky, lit windows).
 * Shown until a real photo is configured in config/site.js.
 */
const COLS = [0, 1, 2, 3, 4];
const ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

export default function BuildingArt({ variant = "day" }) {
  const id = useId().replace(/:/g, "");
  const dusk = variant === "dusk";
  const glass = dusk ? ["#ffd2b8", "#ffb48c", "#3a3f8f"] : ["#cfe3f2", "#e6f1f8", "#b5d3ea"];

  return (
    <svg className="building-art" viewBox="0 0 400 440" role="img" aria-label="Faatix office" preserveAspectRatio="xMidYMax meet">
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          {dusk ? (
            <>
              <stop offset="0" stopColor="#0b0d3d" />
              <stop offset="1" stopColor="#2c3494" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#ffe7da" />
              <stop offset="1" stopColor="#fff6f0" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`tower-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#171a55" />
          <stop offset="1" stopColor="#0b0d3d" />
        </linearGradient>
      </defs>

      {/* sky */}
      <rect width="400" height="440" fill={`url(#sky-${id})`} />
      {dusk ? (
        <g fill="#fff">
          <circle cx="60" cy="50" r="1.6" /><circle cx="330" cy="36" r="1.4" /><circle cx="300" cy="90" r="1.2" />
          <circle cx="40" cy="120" r="1.2" /><circle cx="360" cy="140" r="1.6" />
          <circle cx="340" cy="60" r="14" fill="#ffd2b8" opacity=".9" />
        </g>
      ) : (
        <g fill="#fff" opacity=".9">
          <ellipse cx="70" cy="70" rx="38" ry="12" /><ellipse cx="96" cy="62" rx="26" ry="12" />
          <ellipse cx="320" cy="110" rx="34" ry="10" />
          <circle cx="335" cy="55" r="18" fill="#ff8a4c" opacity=".55" />
        </g>
      )}

      {/* left wing */}
      <rect x="34" y="210" width="96" height="200" rx="4" fill="#ff8a4c" />
      {[0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((c) => (
        <rect key={`l${r}${c}`} x={46 + c * 26} y={226 + r * 34} width="18" height="22" rx="2" fill={dusk ? "#ffe7da" : "#ffe7da"} opacity={dusk ? .95 : .85} />
      )))}

      {/* right wing */}
      <rect x="272" y="250" width="96" height="160" rx="4" fill="#2c3494" />
      {[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => (
        <rect key={`r${r}${c}`} x={284 + c * 26} y={266 + r * 34} width="18" height="22" rx="2" fill={glass[(r + c) % 2]} opacity=".9" />
      )))}

      {/* main tower */}
      <rect x="112" y="64" width="176" height="346" rx="6" fill={`url(#tower-${id})`} />
      <rect x="112" y="64" width="12" height="346" fill="#ff8a4c" />
      <rect x="150" y="44" width="100" height="24" rx="4" fill="#171a55" />
      {ROWS.map((r) => COLS.map((c) => (
        <rect
          key={`t${r}${c}`}
          x={136 + c * 30} y={150 + r * 28} width="22" height="18" rx="2"
          fill={glass[(r * 3 + c) % 3]}
          opacity={dusk && (r + c) % 4 === 0 ? .35 : .92}
        />
      )))}

      {/* sign with the Faatix logo */}
      <rect x="132" y="84" width="136" height="50" rx="10" fill="#fff" />
      <image href={logo} x="142" y="94" width="116" height="30" preserveAspectRatio="xMidYMid meet" />

      {/* entrance */}
      <rect x="172" y="372" width="56" height="38" rx="3" fill={dusk ? "#ffb48c" : "#cfe3f2"} />
      <rect x="199" y="372" width="2" height="38" fill="#0b0d3d" />
      <rect x="164" y="366" width="72" height="8" rx="2" fill="#ff8a4c" />

      {/* trees */}
      <g>
        <rect x="22" y="380" width="4" height="30" fill="#5a3b2a" />
        <circle cx="24" cy="372" r="16" fill={dusk ? "#2f7a4f" : "#4fa66f"} />
        <rect x="374" y="384" width="4" height="26" fill="#5a3b2a" />
        <circle cx="376" cy="376" r="14" fill={dusk ? "#2f7a4f" : "#4fa66f"} />
      </g>

      {/* ground */}
      <rect x="0" y="408" width="400" height="32" fill={dusk ? "#05062b" : "#ffd2b8"} />
      <rect x="0" y="408" width="400" height="4" fill={dusk ? "#171a55" : "#ffc5a5"} />
    </svg>
  );
}
