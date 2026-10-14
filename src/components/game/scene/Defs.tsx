import { shade, type Palette } from "./palette";

const STONES: [number, number, number, number, number][] = [
  [2, 2, 28, 18, 0],
  [33, 3, 29, 15, 1],
  [1, 23, 18, 17, 2],
  [22, 21, 22, 20, 3],
  [47, 19, 16, 22, 1],
  [3, 43, 26, 19, 0],
  [32, 44, 30, 18, 2],
];

export function SceneDefs({ palette }: { palette: Palette }) {
  return (
      <defs>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="soft2" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <filter id="mottleDark" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.011 0.017" numOctaves="4" seed="7" />
          <feColorMatrix values="0 0 0 0 0.05  0 0 0 0 0.07  0 0 0 0 0.02  0 0 0 2.2 -0.95" />
        </filter>
        <filter id="mottleLight" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.03" numOctaves="3" seed="21" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 0.95  0 0 0 0 0.6  0 0 0 2.4 -1.25" />
        </filter>

        <radialGradient id="terrain" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor={palette.grassLight} />
          <stop offset="55%" stopColor={palette.grassMid} />
          <stop offset="100%" stopColor={palette.grassDark} />
        </radialGradient>
        <radialGradient id="vignette" cx="50%" cy="50%" r="55%">
          <stop offset="62%" stopColor={palette.edge} stopOpacity="0" />
          <stop offset="82%" stopColor={palette.edge} stopOpacity="0.5" />
          <stop offset="97%" stopColor={palette.edge} stopOpacity="1" />
        </radialGradient>

        <pattern id="cobble" width="64" height="64" patternUnits="userSpaceOnUse">
          <rect width="64" height="64" fill={palette.cobbleBase} />
          {STONES.map(([x, y, w, h, c], i) => (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx="6" fill={palette.cobbleStones[c]} />
              <rect x={x + 2} y={y + 1.5} width={w - 6} height="3" rx="1.5" fill="#fff" opacity="0.16" />
              <rect x={x} y={y + h - 4} width={w} height="4" rx="2" fill="#000" opacity="0.14" />
            </g>
          ))}
        </pattern>

        <pattern
          id="tiles"
          width="28"
          height="16"
          patternUnits="userSpaceOnUse"
          patternTransform="skewY(-26.565)"
        >
          <path d="M0 8H28M0 16H28M14 0V8M0 8V16M28 8V16" stroke="#000" strokeOpacity="0.32" strokeWidth="1.2" fill="none" />
          <path d="M0 9.2H28M0 1.2H28" stroke="#fff" strokeOpacity="0.14" strokeWidth="1" fill="none" />
        </pattern>
        <pattern id="tilesFlat" width="28" height="16" patternUnits="userSpaceOnUse">
          <path d="M0 8H28M0 16H28M14 0V8M0 8V16M28 8V16" stroke="#000" strokeOpacity="0.32" strokeWidth="1.2" fill="none" />
          <path d="M0 9.2H28M0 1.2H28" stroke="#fff" strokeOpacity="0.14" strokeWidth="1" fill="none" />
        </pattern>
        <pattern id="bricks" width="32" height="20" patternUnits="userSpaceOnUse">
          <path d="M0 10H32M0 20H32M16 0V10M0 10V20M32 10V20" stroke="#000" strokeOpacity="0.24" strokeWidth="1.3" fill="none" />
          <rect x="17" y="1" width="14" height="8" fill="#fff" opacity="0.1" />
          <rect x="1" y="11" width="14" height="8" fill="#000" opacity="0.07" />
        </pattern>
        <pattern id="planks" width="12" height="40" patternUnits="userSpaceOnUse">
          <path d="M0.5 0V40" stroke="#000" strokeOpacity="0.35" strokeWidth="1.4" />
          <path d="M2 0V40" stroke="#fff" strokeOpacity="0.12" strokeWidth="1" />
          <path d="M6 12H9M3 28H6" stroke="#000" strokeOpacity="0.2" strokeWidth="1" />
        </pattern>

        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff3b0" stopOpacity="1" />
          <stop offset="25%" stopColor="#ffc24d" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#ff9a1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe066" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#ffd23f" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffd23f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="win" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe9a8" />
          <stop offset="100%" stopColor="#ff9f43" />
        </linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff1bd" />
          <stop offset="100%" stopColor="#ffb25b" />
        </linearGradient>
        <linearGradient id="wallShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id="roofShade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="rockShade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.rock[0]} />
          <stop offset="55%" stopColor={palette.rock[1]} />
          <stop offset="100%" stopColor={palette.rock[2]} />
        </linearGradient>
        {palette.canopy.map((c, i) => (
          <radialGradient key={i} id={`can${i}`} cx="38%" cy="30%" r="75%">
            <stop offset="0%" stopColor={shade(c, 1.45)} />
            <stop offset="50%" stopColor={c} />
            <stop offset="100%" stopColor={shade(c, 0.55)} />
          </radialGradient>
        ))}
      </defs>
  );
}
