"use client";

import { memo, useMemo, type KeyboardEvent, type ReactNode } from "react";
import {
  HOUSE_LEVEL_NAME,
  formatMoney,
  formatPhone,
  type House,
  type Season,
  type View,
} from "@/lib/game/engine";
import { SceneDefs } from "./Defs";
import { HOUSE_LANTERNS, HouseDrawing, SHOP_DOOR_X, ShopDrawing, houseMetrics } from "./houses";
import { mulberry32 } from "@/lib/game/core/rng";
import { PALETTES, shade, type Palette } from "./palette";
import {
  Barrel,
  Bench,
  Bush,
  Conifer,
  Crate,
  Flower,
  Leaf,
  LanternPost,
  Mushroom,
  NoticeBoard,
  Pumpkin,
  Rocks,
  Signpost,
  Tree,
  Tuft,
} from "./props";

export type SceneLayoutName = "landscape" | "portrait";

type Spot = { x: number; y: number; s: number };
type Layout = {
  w: number;
  h: number;
  plaza: { x: number; y: number; rx: number; ry: number };
  pathW: number;
  fs: number;
  forest: Spot;
  shop: Spot;
  houses: Spot[];
  board: Spot;
  plazaLanterns: { x: number; y: number }[];
};

export const LAYOUTS: Record<SceneLayoutName, Layout> = {
  landscape: {
    w: 1200,
    h: 760,
    plaza: { x: 610, y: 470, rx: 118, ry: 60 },
    pathW: 54,
    fs: 18,
    forest: { x: 215, y: 580, s: 1 },
    shop: { x: 470, y: 300, s: 1 },
    houses: [
      { x: 905, y: 285, s: 1 },
      { x: 935, y: 585, s: 1 },
    ],
    board: { x: 690, y: 655, s: 1 },
    plazaLanterns: [
      { x: 500, y: 520 },
      { x: 722, y: 428 },
    ],
  },
  portrait: {
    w: 700,
    h: 1000,
    plaza: { x: 350, y: 545, rx: 96, ry: 50 },
    pathW: 46,
    fs: 20,
    forest: { x: 190, y: 835, s: 0.8 },
    shop: { x: 175, y: 305, s: 0.8 },
    houses: [
      { x: 485, y: 245, s: 0.74 },
      { x: 515, y: 770, s: 0.74 },
    ],
    board: { x: 405, y: 672, s: 0.8 },
    plazaLanterns: [
      { x: 258, y: 590 },
      { x: 444, y: 505 },
    ],
  },
};

type Pt = { x: number; y: number };

function curve(a: Pt, b: Pt) {
  const c1 = { x: a.x, y: a.y + (b.y - a.y) * 0.6 };
  const c2 = { x: b.x + (a.x - b.x) * 0.3, y: b.y };
  return `M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

type Item = { key: string; y: number; node: ReactNode; dim: boolean };

function Ground({ layout, palette }: { layout: Layout; palette: Palette }) {
  const { w, h } = layout;
  const rnd = useMemo(() => mulberry32(w * 7 + h), [w, h]);
  const decor = useMemo(() => {
    const out: ReactNode[] = [];
    const flowers = palette.flowers;
    for (let i = 0; i < 170; i++) {
      const x = rnd() * w;
      const y = 40 + rnd() * (h - 80);
      const r = rnd();
      if (r < 0.5) {
        out.push(<Tuft key={i} x={x} y={y} color={palette.snow ? "#bccddd" : r < 0.25 ? palette.grassDark : palette.grassLight} />);
      } else if (r < 0.72) {
        out.push(<Flower key={i} x={x} y={y} color={flowers[Math.floor(rnd() * flowers.length)]} />);
      } else if (r < 0.92) {
        out.push(<Leaf key={i} x={x} y={y} color={palette.canopy[Math.floor(rnd() * palette.canopy.length)]} r={rnd() * 180} />);
      } else {
        out.push(<ellipse key={i} cx={x} cy={y} rx={4 + rnd() * 5} ry={2.5 + rnd() * 2} fill={palette.rock[0]} opacity="0.85" />);
      }
    }
    return out;
  }, [rnd, w, h, palette]);

  const cliff = useMemo(() => {
    const pts: string[] = [];
    const top = h - 52;
    for (let x = -60; x <= w + 60; x += 36) {
      pts.push(`${x},${top + (rnd() - 0.5) * 22}`);
    }
    const strata: ReactNode[] = [];
    for (let x = -40; x <= w + 40; x += 26) {
      strata.push(
        <path key={x} d={`M${x} ${top + 10} V${h + 40}`} stroke="#000" strokeOpacity={0.14 + rnd() * 0.12} strokeWidth={2 + rnd() * 2} />,
      );
    }
    return { poly: `-60,${h + 80} ${pts.join(" ")} ${w + 60},${h + 80}`, strata };
  }, [rnd, w, h]);

  return (
    <g>
      <rect x={-1400} y={-1000} width={w + 2800} height={h + 2000} fill={palette.edge} />
      <rect x={0} y={0} width={w} height={h} fill="url(#terrain)" />
      <rect x={0} y={0} width={w} height={h} fill="#000" filter="url(#mottleDark)" opacity="0.5" />
      <rect x={0} y={0} width={w} height={h} fill="#000" filter="url(#mottleLight)" opacity={palette.snow ? 0.18 : 0.3} />
      {decor}
      <polygon points={cliff.poly} fill="url(#rockShade)" />
      {cliff.strata}
      <path d={`M-60 ${h - 52} H${w + 60}`} stroke={palette.grassDark} strokeWidth="1" opacity="0" />
    </g>
  );
}

function SpotShell({
  testId,
  label,
  locked,
  onActivate,
  children,
}: {
  testId: string;
  label: string;
  locked: boolean;
  onActivate: () => void;
  children: ReactNode;
}) {
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  };
  return (
    <g
      className="spot"
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-label={label}
      aria-disabled={locked}
      data-testid={testId}
      data-locked={locked}
      onClick={locked ? undefined : onActivate}
      onKeyDown={locked ? undefined : onKey}
      style={{ pointerEvents: locked ? "none" : "auto" }}
    >
      {children}
    </g>
  );
}

function Label({
  x,
  y,
  fs,
  lines,
}: {
  x: number;
  y: number;
  fs: number;
  lines: { text: string; color?: string; bold?: boolean }[];
}) {
  const longest = Math.max(...lines.map((l) => l.text.length));
  const width = longest * fs * 0.58 + 26;
  const lh = fs + 5;
  const height = lines.length * lh + 12;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <rect x={-width / 2} y={0} width={width} height={height} rx={12} fill="#0f1713" opacity="0.82" stroke="#fff" strokeOpacity="0.18" />
      {lines.map((l, i) => (
        <text
          key={i}
          x={0}
          y={8 + (i + 1) * lh - 5}
          textAnchor="middle"
          fontSize={fs}
          fontWeight={l.bold ? 800 : 500}
          fill={l.color ?? "#f4f1e6"}
          style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
        >
          {l.text}
        </text>
      ))}
    </g>
  );
}

function ForestSpotArt({ palette }: { palette: Palette }) {
  const trees = useMemo(() => {
    const defs: { x: number; y: number; s: number; c: number; conifer: boolean }[] = [
      { x: -150, y: -78, s: 1.05, c: 0, conifer: false },
      { x: -60, y: -96, s: 1.15, c: 1, conifer: true },
      { x: 30, y: -92, s: 1.1, c: 2, conifer: false },
      { x: 120, y: -80, s: 1.0, c: 3, conifer: true },
      { x: 186, y: -50, s: 0.9, c: 4, conifer: false },
      { x: -190, y: -22, s: 0.9, c: 2, conifer: true },
      { x: -104, y: -34, s: 1.1, c: 4, conifer: false },
      { x: -10, y: -40, s: 1.2, c: 0, conifer: true },
      { x: 78, y: -34, s: 1.05, c: 1, conifer: false },
      { x: 150, y: -6, s: 0.95, c: 3, conifer: true },
      { x: -142, y: 20, s: 0.95, c: 1, conifer: false },
      { x: -52, y: 18, s: 1.0, c: 3, conifer: true },
      { x: 24, y: 12, s: 0.9, c: 2, conifer: false },
    ];
    return defs.sort((a, b) => a.y - b.y);
  }, []);
  const winter = palette.snow;
  return (
    <g>
      <ellipse cx="0" cy="-8" rx="230" ry="62" fill="#0b1a08" opacity="0.55" filter="url(#soft)" />
      <ellipse cx="0" cy="-6" rx="205" ry="48" fill={palette.snow ? "#c5d3e0" : "#3b5a2a"} opacity="0.8" />
      {trees.map((t, i) =>
        t.conifer ? (
          <Conifer key={i} x={t.x} y={t.y} s={t.s} c={winter ? t.c % 4 : 3} trunk={palette.trunk} snow={winter} />
        ) : (
          <Tree key={i} x={t.x} y={t.y} s={t.s} c={t.c % palette.canopy.length} trunk={palette.trunk} snow={winter} />
        ),
      )}
      <Mushroom x={104} y={38} s={0.55} />
      <Mushroom x={122} y={44} s={0.38} />
      <Rocks x={-176} y={34} s={0.9} snow={winter} />
      <Bush x={-100} y={46} s={0.9} c={2} />
      <Signpost x={52} y={46} text="Las" />
    </g>
  );
}

export const WorldScene = memo(function WorldScene({
  layoutName,
  season,
  isDay,
  houses,
  tutorialDone,
  boardUnread,
  onEnter,
  onOpenHouse,
  onOpenBoard,
}: {
  layoutName: SceneLayoutName;
  season: Season;
  isDay: boolean;
  houses: House[];
  tutorialDone: boolean;
  boardUnread: boolean;
  onEnter: (view: View) => void;
  onOpenHouse: (house: House) => void;
  onOpenBoard: () => void;
}) {
  const layout = LAYOUTS[layoutName];
  const palette = PALETTES[season];
  const locked = !tutorialDone;
  const { w, h } = layout;

  const houseMeta = houses.map((house, i) => {
    const spot = layout.houses[i];
    return { house, spot, metrics: houseMetrics(house.level, house, season) };
  });

  const doors = {
    forest: { x: layout.forest.x + 52 * layout.forest.s, y: layout.forest.y + 50 * layout.forest.s },
    shop: { x: layout.shop.x + SHOP_DOOR_X * layout.shop.s, y: layout.shop.y + 22 * layout.shop.s },
    houses: houseMeta.map(({ spot, metrics }) => ({
      x: spot.x + metrics.doorX * spot.s,
      y: spot.y + 26 * spot.s,
    })),
  };
  const plaza = layout.plaza;
  const plazaPt = { x: plaza.x, y: plaza.y };
  const pathD = [doors.forest, doors.shop, ...doors.houses].map((d) => curve(d, plazaPt));

  const rects = [
    { x0: layout.forest.x - 240 * layout.forest.s, x1: layout.forest.x + 240 * layout.forest.s, y0: layout.forest.y - 290 * layout.forest.s, y1: layout.forest.y + 80 },
    { x0: layout.shop.x - 160 * layout.shop.s, x1: layout.shop.x + 300 * layout.shop.s, y0: layout.shop.y - 230 * layout.shop.s, y1: layout.shop.y + 90 },
    ...houseMeta.map(({ spot, metrics }) => ({
      x0: spot.x + metrics.minX * spot.s - 40,
      x1: spot.x + metrics.maxX * spot.s + 40,
      y0: spot.y + metrics.minY * spot.s - 40,
      y1: spot.y + 100,
    })),
    { x0: layout.board.x - 90 * layout.board.s, x1: layout.board.x + 90 * layout.board.s, y0: layout.board.y - 200 * layout.board.s, y1: layout.board.y + 50 },
    { x0: plaza.x - plaza.rx - 20, x1: plaza.x + plaza.rx + 20, y0: plaza.y - plaza.ry - 90, y1: plaza.y + plaza.ry + 30 },
  ];

  const items = useMemo(() => {
    const out: Item[] = [];
    const rnd = mulberry32(w * 13 + h * 3);
    const blocked = (x: number, y: number) =>
      rects.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);

    const addTree = (key: string, x: number, y: number, s: number) => {
      const conifer = rnd() > 0.55;
      const c = Math.floor(rnd() * palette.canopy.length);
      out.push({
        key,
        y,
        dim: true,
        node: conifer ? (
          <Conifer x={x} y={y} s={s} c={palette.snow ? c % 4 : 3} trunk={palette.trunk} snow={palette.snow} />
        ) : (
          <Tree x={x} y={y} s={s} c={c} trunk={palette.trunk} snow={palette.snow} />
        ),
      });
    };

    const tries = (count: number, gen: () => [number, number, number]) => {
      let placed = 0;
      for (let i = 0; i < count * 6 && placed < count; i++) {
        const [x, y, s] = gen();
        if (blocked(x, y)) continue;
        addTree(`t-${out.length}`, x, y, s);
        placed++;
      }
    };
    tries(16, () => [rnd() * (w + 80) - 40, 20 + rnd() * 90, 0.95 + rnd() * 0.5]);
    tries(8, () => [rnd() * 70 - 10, 120 + rnd() * (h - 300), 0.9 + rnd() * 0.4]);
    tries(8, () => [w - rnd() * 70 + 10, 120 + rnd() * (h - 300), 0.9 + rnd() * 0.4]);
    tries(3, () => [rnd() * 90 - 20, h - 70 + rnd() * 40, 0.8]);
    tries(3, () => [w - rnd() * 90 + 20, h - 70 + rnd() * 40, 0.8]);

    for (let i = 0; i < 14; i++) {
      const x = rnd() * w;
      const y = 140 + rnd() * (h - 220);
      if (blocked(x, y)) continue;
      out.push({ key: `b-${i}`, y, dim: true, node: <Bush x={x} y={y} s={0.8 + rnd() * 0.5} c={Math.floor(rnd() * 4)} /> });
    }

    out.push({
      key: "plaza-props",
      y: plaza.y + plaza.ry + 4,
      dim: true,
      node: (
        <g>
          <Mushroom x={plaza.x - plaza.rx - 34} y={plaza.y + 26} s={1.1} />
          <Bench x={plaza.x + plaza.rx * 0.55} y={plaza.y + plaza.ry + 26} s={0.9} />
          <Barrel x={plaza.x - 40} y={plaza.y - plaza.ry - 14} s={0.9} />
          <Crate x={plaza.x - 14} y={plaza.y - plaza.ry - 6} s={0.8} />
          {season === "autumn" && <Pumpkin x={plaza.x + 30} y={plaza.y - plaza.ry - 2} s={1} />}
        </g>
      ),
    });
    layout.plazaLanterns.forEach((l, i) =>
      out.push({ key: `pl-${i}`, y: l.y, dim: true, node: <LanternPost x={l.x} y={l.y} /> }),
    );

    out.push({
      key: "shop",
      y: layout.shop.y,
      dim: locked,
      node: (
        <SpotShell testId="tile-shop" label="Sklep Żappka" locked={locked} onActivate={() => onEnter("shop")}>
          <rect x={layout.shop.x - 160 * layout.shop.s} y={layout.shop.y - 230 * layout.shop.s} width={460 * layout.shop.s} height={300 * layout.shop.s} fill="transparent" />
          <g className="lift" transform={`translate(${layout.shop.x} ${layout.shop.y}) scale(${layout.shop.s})`}>
            <ShopDrawing season={season} />
          </g>
        </SpotShell>
      ),
    });

    houseMeta.forEach(({ house, spot, metrics }, i) => {
      out.push({
        key: house.id,
        y: spot.y,
        dim: locked,
        node: (
          <SpotShell
            testId={`tile-house-${i}`}
            label={`${HOUSE_LEVEL_NAME[house.level]}, ${formatMoney(house.price)}`}
            locked={locked}
            onActivate={() => onOpenHouse(house)}
          >
            <rect
              x={spot.x + metrics.minX * spot.s}
              y={spot.y + metrics.minY * spot.s}
              width={(metrics.maxX - metrics.minX) * spot.s}
              height={(60 - metrics.minY) * spot.s}
              fill="transparent"
            />
            <g className="lift" transform={`translate(${spot.x} ${spot.y}) scale(${spot.s})`}>
              <HouseDrawing house={house} season={season} />
            </g>
          </SpotShell>
        ),
      });
    });

    const b = layout.board;
    out.push({
      key: "board",
      y: b.y,
      dim: false,
      node: (
        <SpotShell testId="tile-board" label="Tablica ogłoszeń" locked={false} onActivate={onOpenBoard}>
          <rect x={b.x - 70 * b.s} y={b.y - 170 * b.s} width={140 * b.s} height={180 * b.s} fill="transparent" />
          {locked && (
            <ellipse
              className="pulse"
              cx={b.x}
              cy={b.y - 90 * b.s}
              rx={170 * b.s}
              ry={150 * b.s}
              fill="url(#halo)"
              pointerEvents="none"
            />
          )}
          <g className="lift">
            <NoticeBoard x={b.x} y={b.y} s={b.s} snow={palette.snow} />
          </g>
        </SpotShell>
      ),
    });

    const f = layout.forest;
    out.push({
      key: "forest",
      y: f.y,
      dim: locked,
      node: (
        <SpotShell testId="tile-forest" label="Las" locked={locked} onActivate={() => onEnter("forest")}>
          <rect x={f.x - 240 * f.s} y={f.y - 290 * f.s} width={480 * f.s} height={350 * f.s} fill="transparent" />
          <g className="lift" transform={`translate(${f.x} ${f.y}) scale(${f.s})`}>
            <ForestSpotArt palette={palette} />
          </g>
        </SpotShell>
      ),
    });

    return out.sort((a, b) => a.y - b.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutName, season, locked, houses, onEnter, onOpenHouse, onOpenBoard]);

  const glows = [
    ...layout.plazaLanterns.map((l) => ({ x: l.x, y: l.y - 60 })),
    ...houseMeta.flatMap(({ house, spot }) =>
      HOUSE_LANTERNS[house.level].map((l) => ({
        x: spot.x + (house.flip ? -1 : 1) * l.x * spot.s,
        y: spot.y + (40 + l.y - 45 + (house.level === 4 ? 4 : 0)) * spot.s,
      })),
    ),
    { x: layout.shop.x + 196 * layout.shop.s, y: layout.shop.y + (32 - 51) * layout.shop.s },
  ];

  const forest = layout.forest;
  const fs = layout.fs;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      style={{ overflow: "visible" }}
      role="group"
      aria-label="Mapa świata"
    >
      <SceneDefs palette={palette} />
      <g className={isDay ? "world" : "world world-night"}>
        <g className={locked ? "tut-dim" : "tut-clear"}>
          <Ground layout={layout} palette={palette} />
          {pathD.map((d, i) => (
            <g key={i} fill="none" strokeLinecap="round">
              <path d={d} stroke="#0b0f08" strokeOpacity="0.5" strokeWidth={layout.pathW + 16} filter="url(#soft2)" />
              <path d={d} stroke={palette.cobbleBase} strokeWidth={layout.pathW + 6} />
              <path d={d} stroke="url(#cobble)" strokeWidth={layout.pathW} />
            </g>
          ))}
          <ellipse cx={plaza.x} cy={plaza.y + 8} rx={plaza.rx + 12} ry={plaza.ry + 10} fill="#0b0f08" opacity="0.5" filter="url(#soft2)" />
          <ellipse cx={plaza.x} cy={plaza.y} rx={plaza.rx + 6} ry={plaza.ry + 4} fill={palette.cobbleBase} />
          <ellipse cx={plaza.x} cy={plaza.y} rx={plaza.rx} ry={plaza.ry} fill="url(#cobble)" />
          <ellipse cx={plaza.x} cy={plaza.y} rx={plaza.rx * 0.45} ry={plaza.ry * 0.45} fill="none" stroke={shade(palette.cobbleBase, 0.7)} strokeWidth="4" opacity="0.7" />
        </g>
        {items.map((it) => (
          <g key={it.key} className={it.dim ? "tut-dim" : "tut-clear"} style={it.dim ? undefined : undefined}>
            {it.node}
          </g>
        ))}
      </g>

      <rect x={-2} y={-2} width={w + 4} height={h + 4} fill="url(#vignette)" pointerEvents="none" />

      <g pointerEvents="none">
        {glows.map((g, i) => (
          <circle
            key={i}
            className="flicker"
            cx={g.x}
            cy={g.y}
            r={isDay ? 36 : 70}
            fill="url(#glow)"
            opacity={isDay ? 0.3 : 0.95}
            style={{ animationDelay: `${i * 0.37}s` }}
          />
        ))}
      </g>

      <g>
        <g
          className={locked ? "tut-dim" : ""}
          onClick={locked ? undefined : () => onEnter("shop")}
          style={{ cursor: locked ? "default" : "pointer", pointerEvents: locked ? "none" : "auto" }}
        >
          <Label
            x={layout.shop.x + 70 * layout.shop.s}
            y={layout.shop.y + 62 * layout.shop.s}
            fs={fs}
            lines={[
              { text: "Sklep Żappka", bold: true },
              { text: "jedzenie i schronienie", color: "#b9d9b3" },
            ]}
          />
        </g>
        <g
          className={locked ? "tut-dim" : ""}
          onClick={locked ? undefined : () => onEnter("forest")}
          style={{ cursor: locked ? "default" : "pointer", pointerEvents: locked ? "none" : "auto" }}
        >
          <Label
            x={forest.x}
            y={forest.y + 66 * forest.s}
            fs={fs}
            lines={[
              { text: "Las", bold: true },
              { text: "idź na spacer", color: "#b9d9b3" },
            ]}
          />
        </g>
        <g onClick={onOpenBoard} style={{ cursor: "pointer" }}>
          <Label
            x={layout.board.x}
            y={layout.board.y + 14 * layout.board.s}
            fs={fs}
            lines={[
              { text: "Tablica ogłoszeń", bold: true },
              { text: boardUnread ? "nowe zadanie!" : "zadania i prośby", color: boardUnread ? "#ffd98a" : "#b9d9b3" },
            ]}
          />
        </g>
        {houseMeta.map(({ house, spot, metrics }) => (
          <g
            key={house.id}
            className={locked ? "tut-dim" : ""}
            onClick={locked ? undefined : () => onOpenHouse(house)}
            style={{ cursor: locked ? "default" : "pointer", pointerEvents: locked ? "none" : "auto" }}
          >
            <Label
              x={spot.x + (metrics.minX + metrics.maxX) * 0.5 * spot.s}
              y={spot.y + (metrics.labelY + 14) * spot.s}
              fs={fs}
              lines={[
                { text: house.owned ? `Twój dom · poz. ${house.level}` : `Na sprzedaż · poz. ${house.level}`, bold: true },
                { text: formatMoney(house.price), color: "#ffd98a", bold: true },
                { text: `tel. ${formatPhone(house.phone)}`, color: "#d7d3c4" },
              ]}
            />
          </g>
        ))}

        {(locked || boardUnread) && (
          <g className="bob" pointerEvents="none" data-testid={locked ? "tutorial-exclamation" : "board-exclamation"}>
            <circle cx={layout.board.x} cy={layout.board.y - 190 * layout.board.s} r={26} fill="#ffc933" stroke="#fff" strokeWidth="4" />
            <text
              x={layout.board.x}
              y={layout.board.y - 190 * layout.board.s + 13}
              textAnchor="middle"
              fontSize="40"
              fontWeight="900"
              fill="#5a3b00"
              fontFamily="system-ui, sans-serif"
            >
              !
            </text>
          </g>
        )}
      </g>
    </svg>
  );
});
