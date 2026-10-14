import { shade } from "./palette";

type At = { x: number; y: number; s?: number };
const place = ({ x, y, s = 1 }: At) => `translate(${x} ${y}) scale(${s})`;

export function Shadow({ cx, cy, rx, ry, o = 0.35 }: { cx: number; cy: number; rx: number; ry: number; o?: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#000" opacity={o} filter="url(#soft)" />;
}

export function Tree({
  x,
  y,
  s = 1,
  c = 0,
  trunk,
  snow,
}: At & { c?: number; trunk: string; snow?: boolean }) {
  const a = `url(#can${c})`;
  const b = `url(#can${(c + 1) % 4})`;
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={10} cy={4} rx={52} ry={15} />
      <path d="M-9 2 L-5 -46 L6 -46 L10 2 Z" fill={trunk} />
      <path d="M-3 0 L-1 -44 L2 -44 L2 0 Z" fill="#fff" opacity="0.1" />
      <circle cx="-30" cy="-72" r="34" fill={b} />
      <circle cx="32" cy="-74" r="36" fill={a} />
      <circle cx="0" cy="-92" r="44" fill={a} />
      <circle cx="-22" cy="-112" r="28" fill={b} />
      <circle cx="24" cy="-110" r="27" fill={a} />
      <circle cx="-8" cy="-130" r="22" fill={b} opacity="0.95" />
      {snow && (
        <g fill="#f7fbff" opacity="0.95">
          <ellipse cx="-10" cy="-140" rx="22" ry="9" />
          <ellipse cx="26" cy="-118" rx="16" ry="7" />
          <ellipse cx="-34" cy="-96" rx="14" ry="6" />
          <ellipse cx="14" cy="-96" rx="18" ry="7" />
        </g>
      )}
    </g>
  );
}

export function Conifer({ x, y, s = 1, c = 0, trunk, snow }: At & { c?: number; trunk: string; snow?: boolean }) {
  const fill = `url(#can${c})`;
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={8} cy={4} rx={40} ry={12} />
      <rect x="-6" y="-30" width="12" height="32" fill={trunk} />
      <path d="M-46 -26 Q0 -44 46 -26 L0 -92 Z" fill={fill} />
      <path d="M-38 -62 Q0 -80 38 -62 L0 -122 Z" fill={fill} />
      <path d="M-28 -98 Q0 -112 28 -98 L0 -150 Z" fill={fill} />
      <path d="M-46 -26 Q0 -44 46 -26 L38 -24 Q0 -38 -38 -24 Z" fill="#000" opacity="0.18" />
      {snow && (
        <g fill="#f7fbff">
          <path d="M-30 -48 Q0 -62 30 -48 L22 -56 Q0 -66 -22 -56 Z" />
          <path d="M-22 -84 Q0 -96 22 -84 L14 -92 Q0 -100 -14 -92 Z" />
          <path d="M-12 -122 Q0 -130 12 -122 L0 -150 Z" />
        </g>
      )}
    </g>
  );
}

export function Bush({ x, y, s = 1, c = 0 }: At & { c?: number }) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={4} cy={3} rx={26} ry={7} o={0.3} />
      <circle cx="-14" cy="-10" r="14" fill={`url(#can${c})`} />
      <circle cx="12" cy="-12" r="16" fill={`url(#can${(c + 2) % 4})`} />
      <circle cx="0" cy="-18" r="15" fill={`url(#can${c})`} />
    </g>
  );
}

export function LanternPost({ x, y, s = 1 }: At) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={4} cy={2} rx={10} ry={3} o={0.35} />
      <rect x="-2" y="-52" width="4" height="54" fill="#2b241d" />
      <rect x="-9" y="-70" width="18" height="20" rx="3" fill="#3a2f25" />
      <rect x="-6" y="-67" width="12" height="14" rx="2" fill="url(#win)" className="win" />
      <path d="M-11 -70 L0 -80 L11 -70 Z" fill="#2b241d" />
    </g>
  );
}

export function Mushroom({ x, y, s = 1 }: At) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={5} cy={3} rx={22} ry={6} o={0.3} />
      <path d="M-7 0 Q-9 -22 -5 -30 L5 -30 Q9 -22 7 0 Z" fill="#efe3c8" />
      <path d="M-30 -28 Q-28 -62 0 -64 Q28 -62 30 -28 Q0 -20 -30 -28 Z" fill="#c92a2a" />
      <path d="M-30 -28 Q0 -20 30 -28 Q0 -14 -30 -28 Z" fill="#000" opacity="0.2" />
      <g fill="#fff6e6">
        <circle cx="-12" cy="-44" r="5" />
        <circle cx="8" cy="-52" r="4.5" />
        <circle cx="16" cy="-38" r="4" />
        <circle cx="-2" cy="-34" r="3.2" />
      </g>
    </g>
  );
}

export function Pumpkin({ x, y, s = 1 }: At) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={3} cy={2} rx={13} ry={4} o={0.3} />
      <ellipse cx="0" cy="-8" rx="13" ry="10" fill="#e0701c" />
      <ellipse cx="-6" cy="-8" rx="6" ry="10" fill="#f08a2c" />
      <ellipse cx="6" cy="-8" rx="6" ry="10" fill="#c85a12" opacity="0.8" />
      <rect x="-1.5" y="-20" width="3" height="6" fill="#4a5a22" />
    </g>
  );
}

export function Barrel({ x, y, s = 1 }: At) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={4} cy={2} rx={16} ry={5} o={0.35} />
      <path d="M-13 0 Q-17 -20 -13 -38 L13 -38 Q17 -20 13 0 Q0 5 -13 0 Z" fill="#7a4d27" />
      <path d="M-13 -38 Q0 -32 13 -38 Q0 -44 -13 -38 Z" fill="#9a6a3a" />
      <path d="M-15 -28 Q0 -23 15 -28 M-15 -10 Q0 -5 15 -10" stroke="#2f2a26" strokeWidth="3" fill="none" />
      <path d="M-8 -36 V-2 M0 -35 V0 M8 -36 V-2" stroke="#000" strokeOpacity="0.18" />
    </g>
  );
}

export function Crate({ x, y, s = 1 }: At) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={5} cy={2} rx={20} ry={5} o={0.35} />
      <rect x="-16" y="-28" width="32" height="28" fill="#a9723a" />
      <rect x="-16" y="-28" width="32" height="28" fill="none" stroke="#5a381a" strokeWidth="2.5" />
      <path d="M-16 -28 L16 0 M16 -28 L-16 0" stroke="#5a381a" strokeWidth="2" />
      <path d="M16 -28 L24 -33 L24 -5 L16 0 Z" fill="#7a4d27" />
      <path d="M-16 -28 L-8 -33 L24 -33 L16 -28 Z" fill="#c68a4a" />
    </g>
  );
}

export function Fence({ x, y, n = 6, step = 18, s = 1 }: At & { n?: number; step?: number }) {
  const w = (n - 1) * step;
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={w / 2 + 4} cy={2} rx={w / 2 + 12} ry={4} o={0.28} />
      <rect x="-3" y="-24" width={w + 6} height="4" fill="#8a5a2e" />
      <rect x="-3" y="-13" width={w + 6} height="4" fill="#7a4d27" />
      {Array.from({ length: n }, (_, i) => (
        <g key={i}>
          <rect x={i * step - 3.5} y="-32" width="7" height="34" fill="#9a6a3a" />
          <path d={`M${i * step - 3.5} -32 L${i * step} -37 L${i * step + 3.5} -32 Z`} fill="#b07a44" />
          <rect x={i * step + 1} y="-32" width="2.5" height="34" fill="#000" opacity="0.15" />
        </g>
      ))}
    </g>
  );
}

export function Bench({ x, y, s = 1 }: At) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={6} cy={3} rx={32} ry={6} o={0.3} />
      <rect x="-28" y="-30" width="56" height="7" fill="#7a4d27" />
      <rect x="-28" y="-20" width="56" height="8" fill="#a9723a" />
      <rect x="-26" y="-12" width="5" height="12" fill="#3a2f25" />
      <rect x="21" y="-12" width="5" height="12" fill="#3a2f25" />
    </g>
  );
}

export function Signpost({ x, y, s = 1, text }: At & { text: string }) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={4} cy={2} rx={14} ry={4} o={0.35} />
      <rect x="-3" y="-60" width="6" height="62" fill="#5a381a" />
      <path d="M-38 -66 L30 -66 L42 -54 L30 -42 L-38 -42 Z" fill="#a9723a" stroke="#4a2f16" strokeWidth="2.5" />
      <text x="-2" y="-48" textAnchor="middle" fontSize="15" fontWeight="800" fill="#2a1a0c" fontFamily="system-ui, sans-serif">
        {text}
      </text>
    </g>
  );
}

export function Rocks({ x, y, s = 1, snow }: At & { snow?: boolean }) {
  return (
    <g transform={place({ x, y, s })}>
      <Shadow cx={6} cy={3} rx={30} ry={8} o={0.3} />
      <path d="M-26 0 L-22 -18 L-8 -26 L8 -20 L14 0 Z" fill="url(#rockShade)" />
      <path d="M8 0 L12 -12 L24 -16 L32 -4 L30 0 Z" fill="url(#rockShade)" />
      {snow && <path d="M-22 -18 L-8 -26 L8 -20 L2 -17 L-10 -21 Z" fill="#f7fbff" />}
    </g>
  );
}

export function Tuft({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <path
      transform={`translate(${x} ${y})`}
      d="M-6 0 Q-6 -8 -9 -12 Q-3 -9 -2 0 M-2 0 Q-1 -12 2 -16 Q3 -8 2 0 M2 0 Q5 -8 9 -10 Q6 -4 6 0 Z"
      fill={color}
    />
  );
}

export function Flower({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-0.6" y="-7" width="1.2" height="7" fill="#3f6a2a" />
      <circle cx="0" cy="-8" r="3.2" fill={color} />
      <circle cx="0" cy="-8" r="1.1" fill="#ffe9a0" />
    </g>
  );
}

export function Leaf({ x, y, color, r = 0 }: { x: number; y: number; color: string; r?: number }) {
  return (
    <ellipse transform={`translate(${x} ${y}) rotate(${r})`} cx="0" cy="0" rx="4.5" ry="2.4" fill={shade(color, 0.95)} opacity="0.9" />
  );
}
