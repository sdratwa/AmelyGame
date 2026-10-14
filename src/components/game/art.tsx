import type { House, Season } from "@/lib/game/engine";

export const GROUND: Record<Season, { base: string; accent: string }> = {
  winter: { base: "#dbe7f1", accent: "#f8fbff" },
  spring: { base: "#8fcf72", accent: "#a9de8c" },
  summer: { base: "#5fb04a", accent: "#74c45c" },
  autumn: { base: "#c79a52", accent: "#d9ad63" },
};

const FOLIAGE: Record<Season, [string, string]> = {
  winter: ["#2f6b4f", "#3f8663"],
  spring: ["#57b84a", "#7fd36b"],
  summer: ["#2f8f3a", "#43a84c"],
  autumn: ["#d2691e", "#e8a33d"],
};

function TopTree({
  cx,
  cy,
  r,
  season,
  tone = 0,
}: {
  cx: number;
  cy: number;
  r: number;
  season: Season;
  tone?: 0 | 1;
}) {
  const [dark, light] = FOLIAGE[season];
  return (
    <g>
      <circle cx={cx + r * 0.18} cy={cy + r * 0.22} r={r} fill="rgba(0,0,0,0.22)" />
      <circle cx={cx} cy={cy} r={r} fill={tone ? light : dark} />
      <circle cx={cx - r * 0.25} cy={cy - r * 0.25} r={r * 0.55} fill={tone ? dark : light} opacity={0.75} />
      {season === "winter" && (
        <>
          <circle cx={cx - r * 0.3} cy={cy - r * 0.35} r={r * 0.38} fill="#f4f9ff" opacity={0.95} />
          <circle cx={cx + r * 0.35} cy={cy + r * 0.1} r={r * 0.22} fill="#f4f9ff" opacity={0.9} />
        </>
      )}
    </g>
  );
}

export function ForestArt({ season }: { season: Season }) {
  const trees: [number, number, number, 0 | 1][] = [
    [30, 34, 22, 0],
    [78, 26, 18, 1],
    [128, 40, 24, 0],
    [56, 82, 24, 1],
    [108, 92, 20, 0],
    [150, 100, 17, 1],
    [28, 130, 19, 0],
    [84, 144, 22, 1],
    [134, 148, 18, 0],
  ];
  return (
    <svg viewBox="0 0 180 180" className="h-full w-full" role="img" aria-label="Las">
      <rect x="4" y="4" width="172" height="172" rx="26" fill={GROUND[season].accent} opacity={0.55} />
      {trees.map(([x, y, r, t], i) => (
        <TopTree key={i} cx={x} cy={y} r={r} tone={t} season={season} />
      ))}
    </svg>
  );
}

export function FrogLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <circle cx="18" cy="20" r="11" fill="#2e9e44" />
      <circle cx="46" cy="20" r="11" fill="#2e9e44" />
      <ellipse cx="32" cy="38" rx="25" ry="20" fill="#3cc058" />
      <circle cx="18" cy="20" r="7" fill="#fff" />
      <circle cx="46" cy="20" r="7" fill="#fff" />
      <circle cx="19" cy="21" r="3.6" fill="#111" />
      <circle cx="45" cy="21" r="3.6" fill="#111" />
      <path d="M17 42 Q32 54 47 42" stroke="#14532d" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="36" r="1.6" fill="#14532d" />
      <circle cx="40" cy="36" r="1.6" fill="#14532d" />
    </svg>
  );
}

export function ShopArt({ season }: { season: Season }) {
  return (
    <svg viewBox="0 0 180 180" className="h-full w-full" role="img" aria-label="Sklep Żappka">
      <rect x="4" y="4" width="172" height="172" rx="26" fill={GROUND[season].accent} opacity={0.55} />
      <rect x="22" y="30" width="136" height="104" rx="6" fill="rgba(0,0,0,0.22)" transform="translate(5 6)" />
      <rect x="22" y="30" width="136" height="104" rx="6" fill="#f1f5f2" stroke="#1f7a37" strokeWidth="4" />
      <rect x="30" y="38" width="120" height="88" rx="3" fill="#3cc058" />
      {Array.from({ length: 6 }).map((_, i) => (
        <rect key={i} x={30 + i * 20} y="38" width="10" height="88" fill="#2e9e44" />
      ))}
      {season === "winter" && (
        <>
          <rect x="30" y="38" width="120" height="14" rx="6" fill="#f8fbff" />
          <circle cx="50" cy="60" r="5" fill="#f8fbff" />
          <circle cx="132" cy="58" r="4" fill="#f8fbff" />
        </>
      )}
      <rect x="70" y="102" width="40" height="24" fill="#bde7c8" stroke="#1f7a37" strokeWidth="2" />
      <rect x="78" y="146" width="24" height="10" rx="3" fill="#cbd5d1" />
      <g transform="translate(66 52)">
        <circle cx="12" cy="10" r="9" fill="#fff" />
        <circle cx="48" cy="10" r="9" fill="#fff" />
        <circle cx="12" cy="10" r="4" fill="#111" />
        <circle cx="48" cy="10" r="4" fill="#111" />
        <ellipse cx="30" cy="26" rx="24" ry="16" fill="#fff" opacity={0.9} />
        <path d="M14 26 Q30 40 46 26" stroke="#14532d" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function HouseArt({ house, season }: { house: House; season: Season }) {
  const snow = season === "winter";
  return (
    <svg viewBox="0 0 180 180" className="h-full w-full" role="img" aria-label={house.name}>
      <rect x="4" y="4" width="172" height="172" rx="26" fill={GROUND[season].accent} opacity={0.55} />
      {house.hasGarage && (
        <>
          <rect x="116" y="48" width="48" height="84" rx="3" fill="rgba(0,0,0,0.2)" transform="translate(4 5)" />
          <rect x="116" y="48" width="48" height="84" rx="3" fill={house.roofColor} opacity={0.85} />
          <rect x="116" y="48" width="48" height="84" rx="3" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="2" />
          {snow && <rect x="119" y="51" width="42" height="78" rx="2" fill="#f8fbff" opacity={0.8} />}
        </>
      )}
      <rect x="20" y="36" width={house.hasGarage ? 98 : 140} height="104" rx="4" fill="rgba(0,0,0,0.22)" transform="translate(5 6)" />
      <rect x="20" y="36" width={house.hasGarage ? 98 : 140} height="104" rx="4" fill={house.roofColor} />
      {house.roofStyle === "gable" && (
        <>
          <rect x="20" y="36" width={house.hasGarage ? 98 : 140} height="52" fill="rgba(255,255,255,0.14)" />
          <line x1="20" y1="88" x2={house.hasGarage ? 118 : 160} y2="88" stroke="rgba(0,0,0,0.35)" strokeWidth="3" />
          {snow && <rect x="24" y="40" width={house.hasGarage ? 90 : 132} height="44" rx="3" fill="#f8fbff" opacity={0.85} />}
        </>
      )}
      {house.roofStyle === "hip" && (
        <>
          <path
            d={`M20 36 L${house.hasGarage ? 118 : 160} 36 L${house.hasGarage ? 98 : 140} 56 L40 56 Z`}
            fill="rgba(255,255,255,0.14)"
          />
          <rect x="40" y="56" width={house.hasGarage ? 58 : 100} height="64" fill="rgba(0,0,0,0.12)" />
          {snow && <rect x="42" y="58" width={house.hasGarage ? 54 : 96} height="60" rx="3" fill="#f8fbff" opacity={0.85} />}
        </>
      )}
      {house.roofStyle === "flat" && (
        <>
          <rect x="28" y="44" width={house.hasGarage ? 82 : 124} height="88" fill={house.wallColor} opacity={snow ? 0.15 : 0.45} />
          {snow && <rect x="28" y="44" width={house.hasGarage ? 82 : 124} height="88" fill="#f8fbff" opacity={0.85} />}
        </>
      )}
      {house.hasChimney && (
        <>
          <rect x="34" y="46" width="14" height="14" fill="#8a8a8a" stroke="#555" strokeWidth="2" />
          <rect x="38" y="50" width="6" height="6" fill="#333" />
        </>
      )}
      <rect x={house.hasGarage ? 56 : 78} y="140" width="26" height="14" rx="3" fill={house.doorColor} />
      <rect x={house.hasGarage ? 52 : 74} y="154" width="34" height="8" rx="2" fill="#cfd6d9" opacity={0.8} />
    </svg>
  );
}

export function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 64" className={className} aria-hidden>
      <rect x="2" y="2" width="36" height="60" rx="7" fill="#1f2937" stroke="#94a3b8" strokeWidth="2" />
      <rect x="6" y="9" width="28" height="42" rx="2" fill="#38bdf8" />
      <rect x="9" y="13" width="22" height="4" rx="1" fill="#e0f2fe" opacity={0.9} />
      <rect x="9" y="21" width="14" height="3" rx="1" fill="#e0f2fe" opacity={0.7} />
      <circle cx="20" cy="57" r="2" fill="#94a3b8" />
    </svg>
  );
}
