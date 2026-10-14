import type { ReactNode } from "react";
import type { House, HouseLevel, Season } from "@/lib/game/engine";
import { shade } from "./palette";
import { Barrel, Bench, Bush, Crate, Fence, LanternPost, Pumpkin, Shadow } from "./props";

const OBL = 0.5;

type GableProps = {
  x: number;
  y: number;
  w: number;
  h: number;
  rh: number;
  d: number;
  wall: string;
  roof: string;
  floors?: number;
  planks?: boolean;
  bricks?: boolean;
  snow?: boolean;
  attic?: boolean;
  chimneys?: { t: number; s: number; h?: number }[];
  sideWindows?: number[];
  children?: ReactNode;
};

export function Window({
  cx,
  cy,
  w = 20,
  h = 24,
  arch,
  box,
  shutters,
}: {
  cx: number;
  cy: number;
  w?: number;
  h?: number;
  arch?: boolean;
  box?: boolean;
  shutters?: string;
}) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const frame = (pad: number) =>
    arch
      ? `M${x - pad} ${y + h + pad} V${y + w / 2} A${w / 2 + pad} ${w / 2 + pad} 0 0 1 ${x + w + pad} ${y + w / 2} V${y + h + pad} Z`
      : `M${x - pad} ${y - pad} H${x + w + pad} V${y + h + pad} H${x - pad} Z`;
  return (
    <g>
      {shutters && (
        <>
          <rect x={x - 9} y={y - 1} width="8" height={h + 2} fill={shutters} />
          <rect x={x + w + 1} y={y - 1} width="8" height={h + 2} fill={shutters} />
        </>
      )}
      <path d={frame(3)} fill="#3a2a1c" />
      <path d={frame(0)} fill="url(#glass)" className="win" />
      <path d={`M${cx} ${y} V${y + h} M${x} ${cy + 2} H${x + w}`} stroke="#3a2a1c" strokeWidth="2" />
      <path d={frame(0)} fill="url(#wallShade)" opacity="0.5" />
      <rect x={x - 5} y={y + h + 3} width={w + 10} height="4" rx="1.5" fill="#d9d2bf" />
      <rect x={x - 5} y={y + h + 6} width={w + 10} height="2" fill="#000" opacity="0.2" />
      {box && (
        <g>
          <rect x={x - 3} y={y + h + 6} width={w + 6} height="8" fill="#6a4524" />
          <circle cx={x + 3} cy={y + h + 5} r="3.2" fill="#d9602b" />
          <circle cx={cx} cy={y + h + 4} r="3.4" fill="#e8a33d" />
          <circle cx={x + w - 3} cy={y + h + 5} r="3.2" fill="#c24a2a" />
          <circle cx={cx - 5} cy={y + h + 2} r="2.4" fill="#4f7a36" />
          <circle cx={cx + 5} cy={y + h + 2} r="2.4" fill="#4f7a36" />
        </g>
      )}
    </g>
  );
}

export function Door({
  cx,
  y,
  w = 24,
  h = 38,
  color,
  wall,
  steps = true,
}: {
  cx: number;
  y: number;
  w?: number;
  h?: number;
  color: string;
  wall: string;
  steps?: boolean;
}) {
  const x = cx - w / 2;
  const top = y - h;
  const arch = (pad: number) =>
    `M${x - pad} ${y} V${top + w / 2} A${w / 2 + pad} ${w / 2 + pad} 0 0 1 ${x + w + pad} ${top + w / 2} V${y} Z`;
  return (
    <g>
      {steps && (
        <>
          <rect x={x - 8} y={y + 6} width={w + 16} height="7" rx="1.5" fill={shade(wall, 1.05)} />
          <rect x={x - 8} y={y + 11} width={w + 16} height="3" fill="#000" opacity="0.22" />
          <rect x={x - 4} y={y} width={w + 8} height="7" rx="1.5" fill={shade(wall, 1.18)} />
        </>
      )}
      <path d={arch(4)} fill={shade(wall, 1.22)} />
      <path d={arch(4)} fill="url(#wallShade)" opacity="0.6" />
      <path d={arch(0)} fill={color} />
      <path d={`M${cx - w / 6} ${top + 4} V${y} M${cx + w / 6} ${top + 4} V${y}`} stroke="#000" strokeOpacity="0.25" strokeWidth="1.2" />
      <path d={arch(0)} fill="#000" opacity="0.18" transform={`translate(${w * 0.45} 0) scale(0.55 1)`} />
      <circle cx={cx + w / 4} cy={y - h / 2.4} r="1.8" fill="#e6c675" />
    </g>
  );
}

function WallLamp({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <rect x={cx - 1} y={cy - 6} width="2" height="6" fill="#2b241d" />
      <rect x={cx - 4} y={cy - 2} width="8" height="10" rx="2" fill="url(#win)" className="win" stroke="#2b241d" strokeWidth="1.5" />
    </g>
  );
}

function Chimney({
  px,
  py,
  h,
  wall,
  smoke,
}: {
  px: number;
  py: number;
  h: number;
  wall: string;
  smoke?: boolean;
}) {
  const w = 13;
  const cd = 9;
  const cdx = cd;
  const cdy = -cd * OBL;
  return (
    <g>
      <path
        d={`M${px + w} ${py} L${px + w + cdx} ${py + cdy} V${py + cdy - h} L${px + w} ${py - h} Z`}
        fill={shade(wall, 0.6)}
      />
      <rect x={px} y={py - h} width={w} height={h} fill={shade(wall, 0.9)} />
      <rect x={px} y={py - h} width={w} height={h} fill="url(#bricks)" />
      <path
        d={`M${px - 2} ${py - h} H${px + w + 1} L${px + w + cdx + 1} ${py - h + cdy} H${px + cdx - 2} Z`}
        fill={shade(wall, 1.15)}
      />
      <path d={`M${px + 2} ${py - h} H${px + w - 2} L${px + w - 2 + cdx} ${py - h + cdy} H${px + 2 + cdx} Z`} fill="#1d1a17" />
      {smoke && (
        <g className="smoke" fill="#e8e6e0">
          <circle cx={px + w / 2 + 5} cy={py - h - 8} r="5" />
          <circle cx={px + w / 2 + 9} cy={py - h - 20} r="7" />
          <circle cx={px + w / 2 + 6} cy={py - h - 36} r="9" />
        </g>
      )}
    </g>
  );
}

export function Gable({
  x,
  y,
  w,
  h,
  rh,
  d,
  wall,
  roof,
  floors = 1,
  planks,
  bricks = true,
  snow,
  attic,
  chimneys = [],
  sideWindows = [],
  children,
}: GableProps) {
  const dx = d;
  const dy = -d * OBL;
  const ov = 9;
  const top = y - h;
  const A = { x: x + w / 2, y: top - rh };
  const B = { x: x + w + ov, y: top + 5 };
  const C = { x: B.x + dx, y: B.y + dy };
  const D = { x: A.x + dx, y: A.y + dy };
  const wallPattern = planks ? "url(#planks)" : "url(#bricks)";
  const sideWall = shade(wall, 0.7);

  return (
    <g>
      <Shadow cx={x + w / 2 + dx * 0.55 + 8} cy={y + dy * 0.45 + 8} rx={w / 2 + dx * 0.6 + 20} ry={13 + d * 0.16} o={0.4} />

      <path d={`M${x + w} ${top} L${x + w + dx} ${top + dy} V${y + dy} L${x + w} ${y} Z`} fill={sideWall} />
      {(bricks || planks) && (
        <path d={`M${x + w} ${top} L${x + w + dx} ${top + dy} V${y + dy} L${x + w} ${y} Z`} fill={wallPattern} opacity="0.7" />
      )}
      <path d={`M${x + w} ${top} L${x + w + dx} ${top + dy} V${y + dy} L${x + w} ${y} Z`} fill="url(#wallShade)" />
      {floors > 1 && (
        <path
          d={`M${x + w} ${y - h / 2} L${x + w + dx} ${y - h / 2 + dy}`}
          stroke={shade(wall, 0.5)}
          strokeWidth="3"
        />
      )}
      {sideWindows.map((t, i) => (
        <g key={i} transform={`matrix(1 ${-OBL} 0 1 ${x + w} ${y})`}>
          <Window cx={t * dx} cy={-h * (floors > 1 ? 0.28 : 0.52)} w={14} h={18} />
          {floors > 1 && <Window cx={t * dx} cy={-h * 0.76} w={14} h={18} />}
        </g>
      ))}

      <path d={`M${A.x} ${A.y} L${B.x} ${B.y} L${C.x} ${C.y} L${D.x} ${D.y} Z`} fill={roof} />
      <path d={`M${A.x} ${A.y} L${B.x} ${B.y} L${C.x} ${C.y} L${D.x} ${D.y} Z`} fill="url(#tiles)" />
      <path d={`M${A.x} ${A.y} L${B.x} ${B.y} L${C.x} ${C.y} L${D.x} ${D.y} Z`} fill="url(#roofShade)" />
      <path d={`M${A.x} ${A.y} L${D.x} ${D.y}`} stroke={shade(roof, 1.35)} strokeWidth="3.5" strokeLinecap="round" />
      <path d={`M${B.x} ${B.y} L${C.x} ${C.y}`} stroke={shade(roof, 0.5)} strokeWidth="4" strokeLinecap="round" />
      <path
        d={`M${B.x} ${B.y + 2} L${C.x} ${C.y + 2} V${C.y + 8} L${B.x} ${B.y + 8} Z`}
        fill="#000"
        opacity="0.28"
      />
      {snow && (
        <path
          d={`M${A.x} ${A.y} L${D.x} ${D.y} L${D.x + (C.x - D.x) * 0.38} ${D.y + (C.y - D.y) * 0.38} L${A.x + (B.x - A.x) * 0.38} ${A.y + (B.y - A.y) * 0.38} Z`}
          fill="#f7fbff"
          stroke="#f7fbff"
          strokeWidth="5"
          strokeLinejoin="round"
        />
      )}

      <rect x={x} y={top} width={w} height={h} fill={wall} />
      {(bricks || planks) && <rect x={x} y={top} width={w} height={h} fill={wallPattern} />}
      <rect x={x} y={top} width={w} height={h} fill="url(#wallShade)" />
      <rect x={x} y={y - 6} width={w} height="6" fill="#000" opacity="0.2" />
      {floors > 1 && <rect x={x} y={y - h / 2 - 2} width={w} height="4" fill={shade(wall, 0.62)} />}
      <path d={`M${x} ${top} H${x + w} L${A.x} ${A.y} Z`} fill={shade(wall, 1.04)} />
      {(bricks || planks) && <path d={`M${x} ${top} H${x + w} L${A.x} ${A.y} Z`} fill={wallPattern} opacity="0.9" />}
      <path d={`M${x} ${top} H${x + w} L${A.x} ${A.y} Z`} fill="url(#wallShade)" opacity="0.7" />
      <path d={`M${x - ov} ${top + 6} L${A.x} ${A.y - 2} L${B.x} ${B.y}`} stroke={shade(roof, 0.55)} strokeWidth="6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <path d={`M${x - ov} ${top + 6} L${A.x} ${A.y - 2}`} stroke={shade(roof, 1.25)} strokeWidth="2" fill="none" strokeLinecap="round" transform="translate(0 -3)" />
      {snow && (
        <path d={`M${x - ov - 2} ${top + 4} L${A.x} ${A.y - 6} L${B.x + 2} ${B.y - 2}`} stroke="#f7fbff" strokeWidth="5" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {attic && <Window cx={A.x} cy={A.y + rh * 0.62} w={14} h={14} arch />}

      {children}

      {chimneys.map((c, i) => {
        const sx = A.x + (B.x - A.x) * c.s;
        const sy = A.y + (B.y - A.y) * c.s;
        return (
          <Chimney
            key={i}
            px={sx + dx * c.t}
            py={sy + dy * c.t + 4}
            h={c.h ?? 26}
            wall={wall}
            smoke={i === 0}
          />
        );
      })}
    </g>
  );
}

function Tower({
  x,
  y,
  w,
  h,
  rh,
  d,
  wall,
  roof,
  snow,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  rh: number;
  d: number;
  wall: string;
  roof: string;
  snow?: boolean;
}) {
  const dx = d;
  const dy = -d * OBL;
  const top = y - h;
  const apex = { x: x + w / 2 + dx / 2, y: top - rh + dy / 2 };
  const ov = 7;
  return (
    <g>
      <Shadow cx={x + w / 2 + dx * 0.5 + 6} cy={y + dy * 0.4 + 8} rx={w / 2 + dx * 0.6 + 14} ry={12} o={0.4} />
      <path d={`M${x + w} ${top} L${x + w + dx} ${top + dy} V${y + dy} L${x + w} ${y} Z`} fill={shade(wall, 0.68)} />
      <path d={`M${x + w} ${top} L${x + w + dx} ${top + dy} V${y + dy} L${x + w} ${y} Z`} fill="url(#bricks)" opacity="0.7" />
      <path d={`M${x + w} ${top} L${x + w + dx} ${top + dy} V${y + dy} L${x + w} ${y} Z`} fill="url(#wallShade)" />
      <rect x={x} y={top} width={w} height={h} fill={wall} />
      <rect x={x} y={top} width={w} height={h} fill="url(#bricks)" />
      <rect x={x} y={top} width={w} height={h} fill="url(#wallShade)" />
      <rect x={x} y={y - 6} width={w} height="6" fill="#000" opacity="0.2" />
      <path d={`M${x + w + ov} ${top + 4} L${x + w + ov + dx} ${top + 4 + dy} L${apex.x} ${apex.y} Z`} fill={shade(roof, 0.85)} />
      <path d={`M${x + w + ov} ${top + 4} L${x + w + ov + dx} ${top + 4 + dy} L${apex.x} ${apex.y} Z`} fill="url(#tiles)" />
      <path d={`M${x - ov} ${top + 4} L${x + w + ov} ${top + 4} L${apex.x} ${apex.y} Z`} fill={roof} />
      <path d={`M${x - ov} ${top + 4} L${x + w + ov} ${top + 4} L${apex.x} ${apex.y} Z`} fill="url(#tilesFlat)" />
      <path d={`M${x - ov} ${top + 4} L${x + w + ov} ${top + 4} L${apex.x} ${apex.y} Z`} fill="url(#roofShade)" />
      <path d={`M${x - ov} ${top + 4} L${x + w + ov} ${top + 4}`} stroke={shade(roof, 0.5)} strokeWidth="5" />
      {snow && (
        <path d={`M${apex.x - 14} ${apex.y + 22} L${apex.x} ${apex.y - 2} L${apex.x + 12} ${apex.y + 14} Z`} fill="#f7fbff" />
      )}
      <Window cx={x + w / 2} cy={top + h * 0.28} w={14} h={22} arch />
      <Window cx={x + w / 2} cy={top + h * 0.68} w={14} h={22} arch />
    </g>
  );
}

type Built = { node: ReactNode; doorX: number; minX: number; maxX: number; minY: number; labelY: number };

function buildHouse(level: HouseLevel, house: House, season: Season): Built {
  const { wallColor: wall, roofColor: roof, doorColor: door } = house;
  const snow = season === "winter";
  const autumn = season === "autumn";

  if (level === 1) {
    return {
      labelY: 34,
      doorX: -14,
      minX: -70,
      maxX: 112,
      minY: -108,
      node: (
        <g>
          <Gable x={-42} y={0} w={84} h={46} rh={36} d={62} wall={shade(wall, 0.9)} roof={shade(roof, 0.82)} planks snow={snow} chimneys={[{ t: 0.55, s: 0.45, h: 22 }]}>
            <Door cx={-14} y={0} w={22} h={34} color={door} wall={wall} />
            <Window cx={22} cy={-26} w={18} h={18} shutters={shade(door, 1.2)} />
          </Gable>
          <Barrel x={-64} y={8} s={0.85} />
          <Bush x={64} y={12} s={0.8} c={3} />
          {autumn && <Pumpkin x={-46} y={18} s={0.9} />}
        </g>
      ),
    };
  }

  if (level === 2) {
    return {
      labelY: 42,
      doorX: -18,
      minX: -108,
      maxX: 136,
      minY: -132,
      node: (
        <g>
          <Gable x={-52} y={0} w={104} h={52} rh={40} d={74} wall={wall} roof={roof} snow={snow} chimneys={[{ t: 0.5, s: 0.5, h: 26 }]}>
            <Window cx={-38} cy={-30} w={18} h={22} />
            <Door cx={-12} y={0} w={22} h={38} color={door} wall={wall} />
            <WallLamp cx={6} cy={-30} />
            <Window cx={30} cy={-30} w={22} h={22} box shutters={shade(door, 1.15)} />
          </Gable>
          <Fence x={-102} y={22} n={4} />
          <Barrel x={70} y={10} s={0.9} />
          <Crate x={92} y={18} s={0.8} />
          <Bush x={-70} y={4} s={0.9} c={2} />
          {autumn && <Pumpkin x={-30} y={24} />}
        </g>
      ),
    };
  }

  if (level === 3) {
    return {
      labelY: 54,
      doorX: -2,
      minX: -142,
      maxX: 160,
      minY: -164,
      node: (
        <g>
          <Gable x={-122} y={0} w={72} h={48} rh={32} d={52} wall={shade(wall, 0.96)} roof={shade(roof, 0.92)} snow={snow} chimneys={[{ t: 0.5, s: 0.5, h: 22 }]}>
            <Window cx={-86} cy={-28} w={16} h={22} arch />
            <Window cx={-62} cy={-28} w={16} h={22} arch />
          </Gable>
          <Gable x={-52} y={0} w={116} h={76} rh={44} d={84} floors={2} attic wall={wall} roof={roof} snow={snow} sideWindows={[0.5]} chimneys={[{ t: 0.3, s: 0.35, h: 30 }]}>
            <Window cx={-30} cy={-24} w={18} h={24} shutters={shade(door, 1.15)} />
            <Door cx={6} y={0} w={24} h={40} color={door} wall={wall} />
            <WallLamp cx={28} cy={-32} />
            <Window cx={44} cy={-24} w={18} h={24} shutters={shade(door, 1.15)} box />
            <Window cx={-30} cy={-58} w={18} h={22} />
            <Window cx={6} cy={-58} w={18} h={22} />
            <Window cx={44} cy={-58} w={18} h={22} />
          </Gable>
          <Fence x={-134} y={30} n={5} />
          <Fence x={22} y={34} n={4} />
          <LanternPost x={-4} y={40} s={0.75} />
          <Bush x={-110} y={12} s={1} c={2} />
          <Bush x={78} y={20} s={0.9} c={3} />
          {autumn && <Pumpkin x={46} y={30} />}
        </g>
      ),
    };
  }

  return {
    labelY: 60,
    doorX: 12,
    minX: -200,
    maxX: 210,
    minY: -240,
    node: (
      <g>
        <Gable x={-132} y={0} w={78} h={62} rh={36} d={58} wall={shade(wall, 0.95)} roof={shade(roof, 0.9)} snow={snow} chimneys={[{ t: 0.55, s: 0.5, h: 26 }]} floors={2}>
          <Window cx={-108} cy={-20} w={16} h={22} arch />
          <Window cx={-78} cy={-20} w={16} h={22} arch />
          <Window cx={-108} cy={-46} w={14} h={18} />
          <Window cx={-78} cy={-46} w={14} h={18} />
        </Gable>
        <Gable x={-54} y={0} w={134} h={88} rh={52} d={100} floors={2} attic wall={wall} roof={roof} snow={snow} sideWindows={[0.28, 0.7]} chimneys={[{ t: 0.28, s: 0.3, h: 34 }, { t: 0.78, s: 0.4, h: 30 }]}>
          <Window cx={-30} cy={-26} w={20} h={26} arch shutters={shade(door, 1.15)} />
          <Door cx={13} y={0} w={28} h={46} color={door} wall={wall} />
          <WallLamp cx={37} cy={-34} />
          <Window cx={58} cy={-26} w={20} h={26} arch shutters={shade(door, 1.15)} box />
          <Window cx={-30} cy={-66} w={18} h={24} arch />
          <rect x="-4" y="-56" width="34" height="5" fill="#d9d2bf" />
          <rect x="-4" y="-56" width="34" height="2" fill="#fff" opacity="0.35" />
          <path d="M-4 -56 V-70 M6 -56 V-70 M16 -56 V-70 M26 -56 V-70 M-4 -70 H30" stroke="#2b241d" strokeWidth="2" />
          <Window cx={13} cy={-74} w={18} h={22} arch />
          <Window cx={58} cy={-66} w={18} h={24} arch />
        </Gable>
        <Tower x={-188} y={12} w={42} h={118} rh={62} d={42} wall={shade(wall, 1.03)} roof={shade(roof, 0.95)} snow={snow} />
        <Fence x={-140} y={42} n={9} />
        <LanternPost x={-36} y={46} s={0.85} />
        <LanternPost x={92} y={46} s={0.85} />
        <Bush x={-150} y={34} s={1.1} c={2} />
        <Bush x={120} y={30} s={1} c={3} />
        <Bench x={52} y={44} s={0.8} />
        {autumn && <Pumpkin x={-60} y={46} />}
      </g>
    ),
  };
}

export type HouseMetrics = { doorX: number; minX: number; maxX: number; minY: number; labelY: number };

export function houseMetrics(level: HouseLevel, house: House, season: Season): HouseMetrics {
  const { doorX, minX, maxX, minY, labelY } = buildHouse(level, house, season);
  const f = house.flip ? -1 : 1;
  return {
    doorX: doorX * f,
    minX: house.flip ? -maxX : minX,
    maxX: house.flip ? -minX : maxX,
    minY,
    labelY,
  };
}

export function HouseDrawing({ house, season }: { house: House; season: Season }) {
  const { node } = buildHouse(house.level, house, season);
  return house.flip ? <g transform="scale(-1 1)">{node}</g> : <g>{node}</g>;
}

export const LEVEL_FRAME: Record<HouseLevel, { x: number; y: number; w: number; h: number }> = {
  1: { x: -90, y: -130, w: 220, h: 170 },
  2: { x: -120, y: -150, w: 270, h: 200 },
  3: { x: -155, y: -185, w: 330, h: 250 },
  4: { x: -210, y: -255, w: 430, h: 330 },
};

export function ShopDrawing({ season }: { season: Season }) {
  const x = -100;
  const w = 200;
  const h = 104;
  const wall = "#ece8d8";
  const awning: ReactNode[] = [];
  const stripes = 10;
  const sw = (w + 16) / stripes;
  for (let i = 0; i < stripes; i++) {
    const x0 = x - 8 + i * sw;
    awning.push(
      <path
        key={i}
        d={`M${x0 + 4 * (i / stripes)} ${-h + 36} h${sw} L${x0 + sw + 2} ${-h + 58} h${-sw} Z`}
        fill={i % 2 ? "#f4f6ee" : "#2fa04a"}
      />,
    );
    awning.push(
      <path
        key={`s${i}`}
        d={`M${x0 - 2} ${-h + 58} h${sw} a${sw / 2} 7 0 0 1 ${-sw} 0 Z`}
        fill={i % 2 ? "#f4f6ee" : "#2fa04a"}
        transform={`translate(${sw / 2 + 0} 0)`}
      />,
    );
  }
  return (
    <g>
      <Gable x={x} y={0} w={w} h={h} rh={46} d={84} wall={wall} roof="#2e6a3c" bricks={false} snow={season === "winter"} chimneys={[{ t: 0.7, s: 0.55, h: 20 }]} sideWindows={[0.3, 0.7]}>
        <rect x={x + 26} y={-h + 8} width={w - 52} height="24" rx="6" fill="#1f7a37" stroke="#14532d" strokeWidth="2" />
        <text x={x + w / 2 + 14} y={-h + 26} textAnchor="middle" fontSize="19" fontWeight="900" fill="#fff" fontFamily="system-ui, sans-serif" letterSpacing="1">
          Żappka
        </text>
        <g transform={`translate(${x + 40} ${-h + 8}) scale(.38)`}>
          <circle cx="18" cy="20" r="11" fill="#2e9e44" stroke="#14532d" strokeWidth="2" />
          <circle cx="46" cy="20" r="11" fill="#2e9e44" stroke="#14532d" strokeWidth="2" />
          <ellipse cx="32" cy="38" rx="25" ry="20" fill="#3cc058" stroke="#14532d" strokeWidth="2" />
          <circle cx="18" cy="20" r="7" fill="#fff" />
          <circle cx="46" cy="20" r="7" fill="#fff" />
          <circle cx="19" cy="21" r="3.6" fill="#111" />
          <circle cx="45" cy="21" r="3.6" fill="#111" />
          <path d="M17 42 Q32 54 47 42" stroke="#14532d" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </g>
        <rect x={x + 10} y={-h + 60} width={w - 20} height="3" fill="#000" opacity="0.15" />
        {awning}
        <path d={`M${x - 8} ${-h + 36} H${x + w + 8}`} stroke="#14532d" strokeWidth="3" />
        <rect x={x + 12} y="-40" width="108" height="36" fill="#3a2a1c" />
        <rect x={x + 15} y="-37" width="102" height="30" fill="url(#glass)" className="win" />
        <path d={`M${x + 66} -37 V-7`} stroke="#3a2a1c" strokeWidth="3" />
        <g opacity="0.85">
          <rect x={x + 20} y="-30" width="9" height="12" fill="#c92a2a" />
          <rect x={x + 32} y="-32" width="9" height="14" fill="#2e9e44" />
          <rect x={x + 44} y="-29" width="9" height="11" fill="#e0a02f" />
          <rect x={x + 72} y="-31" width="9" height="13" fill="#2f6fa8" />
          <rect x={x + 84} y="-30" width="9" height="12" fill="#c92a2a" />
          <rect x={x + 96} y="-32" width="9" height="14" fill="#e0a02f" />
          <rect x={x + 15} y="-19" width="102" height="2.5" fill="#6a4524" />
        </g>
        <rect x={x + 22} y="-6" width="86" height="5" fill="#d9d2bf" />
        <rect x={x + 134} y="-48" width="46" height="48" fill="#14532d" />
        <rect x={x + 137} y="-45" width="40" height="45" fill="url(#glass)" className="win" />
        <path d={`M${x + 157} -45 V0`} stroke="#14532d" strokeWidth="3" />
        <circle cx={x + 153} cy="-22" r="1.8" fill="#14532d" />
        <circle cx={x + 161} cy="-22" r="1.8" fill="#14532d" />
        <rect x={x + 124} y="-62" width="64" height="9" fill="#a82a2a" />
        <text x={x + 156} y="-54.5" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">OTWARTE</text>
        <rect x={x + 128} y="0" width="56" height="8" rx="2" fill="#cfc9b6" />
      </Gable>
      <Bench x={-70} y={28} s={0.9} />
      <Crate x={114} y={18} s={0.9} />
      <Crate x={136} y={14} s={0.75} />
      <Barrel x={-124} y={12} s={0.9} />
      <LanternPost x={196} y={32} s={0.85} />
      {season === "autumn" && <Pumpkin x={-34} y={38} s={1.1} />}
    </g>
  );
}

export const SHOP_DOOR_X = 57;
export const SHOP_FRAME = { x: -140, y: -200, w: 400, h: 270 };

export const HOUSE_LANTERNS: Record<HouseLevel, { x: number; y: number }[]> = {
  1: [],
  2: [],
  3: [{ x: -4, y: -5 }],
  4: [
    { x: -36, y: -5 },
    { x: 92, y: -5 },
  ],
};
