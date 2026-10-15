import type { Rng } from "../../../core/rng";
import type { EnvironmentZone, PointOfInterest } from "../../features";
import { hash2 } from "../../noise";
import type { PlanContext, TerrainRequest, WorldPlan } from "../../pipeline";
import { ribbonGap, type Point, type RibbonPoint } from "../../shape";
import type { Barrier, Passage } from "../../walk";

/** Punkt startu gracza (zachodni skraj lasu). Stały: wynik nie zależy od seeda, żeby start był przewidywalny. */
export const FOREST_START: Readonly<{ x: number; z: number }> = { x: -126, z: 0 };

/** Flaga świata otwierająca przejście przez rzekę (ustawiana po zbudowaniu mostu; mechanika poza zakresem W1a). */
export const BRIDGE_FLAG = "bridge.built";

/** Skrzynie questa `quest.bridge_01`: punkt charakterystyczny i identyfikator skrzyni (kolejność = kolejność losowania polan). */
export const QUEST_CHEST_SLOTS = [
  { poi: "poi.chest_pickaxe", chest: "chest.bridge.pickaxe" },
  { poi: "poi.chest_saw", chest: "chest.bridge.saw" },
  { poi: "poi.chest_blueprint", chest: "chest.bridge.blueprint" },
] as const;

/** Odległość (m) trolla od pilnowanej skrzyni. */
export const TROLL_OFFSET = 3.4;

export const RIVER_BARRIER_ID = "barrier.river";
export const BRIDGE_PASSAGE_ID = "passage.bridge";

/** Parametry planu lasu. Wszystkie wartości w metrach; zmiana któregokolwiek zmienia świat (nowa wersja generatora). */
export const FOREST_PLAN = {
  river: {
    x0: [100, 106],
    meanderA: 5.5,
    meanderB: 1.8,
    halfWidth: [5, 7],
    depth: 1.1,
    bankWidth: 4,
    bankRise: 0.8,
    blend: 22,
    smoothWindow: 40,
    waterOffset: -0.35,
    reach: 170,
    points: 42,
  },
  bridge: { zRange: [-30, 30], landingOffset: 4.5, padRadius: 1.6, padBlend: 2.4, passageHalfWidth: 2.2 },
  trails: {
    main: { halfWidth: 1.3, blend: 3.5, smoothWindow: 10, spacing: 3, amplitude: 14 },
    branch: { halfWidth: 1.0, blend: 3.5, smoothWindow: 8, spacing: 3, amplitude: 6 },
    stub: { length: 18 },
  },
  hills: { count: 9, radius: [22, 46], amplitude: [1.2, 3.2] },
  hollows: { count: 5, radius: [14, 28], amplitude: [-1.8, -0.8] },
  zones: { dense: { count: 3, radius: [28, 48] }, sunny: { count: 3, radius: [24, 40] } },
} as const;

const q = (v: number) => Math.round(v * 1000) / 1000;
const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};
const dist = (a: Point, b: Point) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
const between = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo);
const seedOf = (r: Rng) => (r() * 4294967296) | 0;

/** Szum 1D (wartościowy, bez funkcji trygonometrycznych). */
function noise1(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash2(seed, i, 0);
  const b = hash2(seed, i + 1, 0);
  return a + (b - a) * u;
}

function riverInterp(points: readonly RibbonPoint[], z: number): { x: number; w: number } {
  if (z <= points[0].z) return points[0];
  const last = points[points.length - 1];
  if (z >= last.z) return last;
  let i = 1;
  while (points[i].z < z) i++;
  const a = points[i - 1];
  const b = points[i];
  const t = (z - a.z) / (b.z - a.z);
  return { x: a.x + (b.x - a.x) * t, w: a.w + (b.w - a.w) * t };
}

/** Łamana od `a` do `b` z bocznym falowaniem wygaszanym na obu końcach (koniec zawsze dokładnie w `b`). */
function wanderingPath(rng: Rng, a: Point, b: Point, amplitude: number, spacing: number, wavelength: number): Point[] {
  const len = dist(a, b);
  const n = Math.max(2, Math.ceil(len / spacing));
  const nx = -(b.z - a.z) / len;
  const nz = (b.x - a.x) / len;
  const seed = seedOf(rng);
  const phase = rng() * 100;
  const fade = Math.min(40, len * 0.35);
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = t * len;
    const env = smooth(s / fade) * smooth((len - s) / fade);
    const wob = Math.max(-1, Math.min(1, (noise1(seed, s / wavelength + phase) * 2 - 1) * 1.7));
    const off = amplitude * env * wob;
    pts.push({ x: q(a.x + (b.x - a.x) * t + nx * off), z: q(a.z + (b.z - a.z) * t + nz * off) });
  }
  pts[0] = { x: q(a.x), z: q(a.z) };
  pts[n] = { x: q(b.x), z: q(b.z) };
  return pts;
}

const minDistToPoints = (p: Point, pts: readonly Point[]) => {
  let best = Infinity;
  for (const o of pts) best = Math.min(best, dist(p, o));
  return best;
};

/**
 * Plan lasu W1a: rzeka N-S na wschodzie, miejsce mostu, ścieżka główna z dwoma odgałęzieniami, polany, wzniesienia
 * i zagłębienia oraz strefy środowiskowe. Wynik jest czystymi danymi (bez funkcji) i zależy wyłącznie od
 * nazwanych strumieni `ctx.rng`, więc dodanie kolejnego strumienia nie zmienia pozostałych elementów.
 */
export function planForest(ctx: PlanContext): WorldPlan {
  const P = FOREST_PLAN;
  const requests: TerrainRequest[] = [];
  const pois: PointOfInterest[] = [];
  const zones: EnvironmentZone[] = [];

  // Rzeka: oś jest funkcją z (płynie z północy, z = -170, na południe, z = +170), wychodzi poza region po obu
  // stronach, więc nie da się jej obejść przy granicy mapy.
  const rr = ctx.rng("forest.river");
  const x0 = between(rr, P.river.x0[0], P.river.x0[1]);
  const phase = rr() * 50;
  const nA = seedOf(rr);
  const nB = seedOf(rr);
  const nW = seedOf(rr);
  const riverPts: RibbonPoint[] = [];
  for (let i = 0; i <= P.river.points; i++) {
    const z = -P.river.reach + (2 * P.river.reach * i) / P.river.points;
    const x =
      x0 + P.river.meanderA * (noise1(nA, z / 60 + phase) * 2 - 1) + P.river.meanderB * (noise1(nB, z / 23) * 2 - 1);
    const w = P.river.halfWidth[0] + (P.river.halfWidth[1] - P.river.halfWidth[0]) * noise1(nW, z / 50);
    riverPts.push({ x: q(x), z: q(z), w: q(w) });
  }
  requests.push({
    kind: "river",
    id: "river.main",
    points: riverPts,
    depth: P.river.depth,
    bankWidth: P.river.bankWidth,
    bankRise: P.river.bankRise,
    blend: P.river.blend,
    smoothWindow: P.river.smoothWindow,
    waterOffset: P.river.waterOffset,
  });
  const riverGap = (p: Point) => ribbonGap({ type: "ribbon", points: riverPts }, p.x, p.z);

  // Miejsce mostu: oś prostopadła do rzeki, lądowiska po obu brzegach (tylko dane i teren, bez mostu).
  const rb = ctx.rng("forest.bridge");
  const zb = between(rb, P.bridge.zRange[0], P.bridge.zRange[1]);
  const center = riverInterp(riverPts, zb);
  const slope = (riverInterp(riverPts, zb + 6).x - riverInterp(riverPts, zb - 6).x) / 12;
  const nl = Math.sqrt(1 + slope * slope);
  const nx = 1 / nl;
  const nz = -slope / nl;
  const off = center.w + P.bridge.landingOffset;
  const west: Point = { x: q(center.x - nx * off), z: q(zb - nz * off) };
  const east: Point = { x: q(center.x + nx * off), z: q(zb + nz * off) };
  for (const [name, p] of [["west", west], ["east", east]] as const) {
    requests.push({
      kind: "pad",
      id: `pad.bridge_${name}`,
      x: p.x,
      z: p.z,
      radius: P.bridge.padRadius,
      blend: P.bridge.padBlend,
      reference: "shaped",
    });
  }

  // Start.
  const start: Point = { x: FOREST_START.x, z: FOREST_START.z };
  requests.push({ kind: "pad", id: "pad.start", x: start.x, z: start.z, radius: 3.5, blend: 7 });

  // Ścieżka główna: start -> zachodnie lądowisko; kilka prób z różnymi strumieniami, pierwsza poprawna wygrywa.
  const T = P.trails;
  const mainOk = (pts: Point[]) =>
    pts.every((p) => {
      if (Math.abs(p.x) > 140 || Math.abs(p.z) > 140) return false;
      return riverGap(p) >= (dist(p, west) > 14 ? 12 : 2.5);
    });
  let main = wanderingPath(ctx.rng("forest.trail.main#0"), start, west, T.main.amplitude, T.main.spacing, 45);
  for (let k = 1; k <= 12 && !mainOk(main); k++) {
    main = wanderingPath(ctx.rng(`forest.trail.main#${k}`), start, west, T.main.amplitude, T.main.spacing, 45);
  }
  if (!mainOk(main)) main = wanderingPath(ctx.rng("forest.trail.main#fallback"), start, west, 0, T.main.spacing, 45);
  requests.push({
    kind: "trail",
    id: "trail.main",
    points: main,
    halfWidth: T.main.halfWidth,
    blend: T.main.blend,
    smoothWindow: T.main.smoothWindow,
  });

  // Odgałęzienia: po przeciwnych stronach ścieżki głównej, każde kończy się polaną.
  const rbs = ctx.rng("forest.trail.branches");
  const sideA = rbs() < 0.5 ? -1 : 1;
  const branchSpecs = [
    { id: "a", side: sideA, tRange: [0.28, 0.42] },
    { id: "b", side: -sideA, tRange: [0.56, 0.72] },
  ] as const;
  const branchEnds: Point[] = [];
  const branchPoints: Point[] = [];
  for (const spec of branchSpecs) {
    const rj = ctx.rng(`forest.trail.branch_${spec.id}`);
    const tJ = between(rj, spec.tRange[0], spec.tRange[1]);
    const j = Math.max(1, Math.min(main.length - 2, Math.round(tJ * (main.length - 1))));
    const J = main[j];
    const tx = main[j + 1].x - main[j - 1].x;
    const tz = main[j + 1].z - main[j - 1].z;
    const tl = Math.sqrt(tx * tx + tz * tz);
    const ux = tx / tl;
    const uz = tz / tl;
    const bx = -uz * spec.side + 0.35 * ux;
    const bz = ux * spec.side + 0.35 * uz;
    const bl = Math.sqrt(bx * bx + bz * bz);
    const attempt = (k: number): Point[] => {
      const ra = ctx.rng(`forest.trail.branch_${spec.id}#${k}`);
      const len = between(ra, 55, 80);
      const end: Point = { x: J.x + (bx / bl) * len, z: J.z + (bz / bl) * len };
      return wanderingPath(ra, J, end, T.branch.amplitude, T.branch.spacing, 30);
    };
    const branchOk = (pts: Point[]) => {
      const end = pts[pts.length - 1];
      if (Math.abs(end.x) > 128 || Math.abs(end.z) > 128) return false;
      if (!pts.every((p) => riverGap(p) >= 25)) return false;
      if (dist(end, start) < 30) return false;
      if (branchEnds.some((e) => dist(e, end) < 45)) return false;
      return pts.every((p, i) => i * T.branch.spacing < 15 || minDistToPoints(p, main) >= 12);
    };
    let pts = attempt(0);
    for (let k = 1; k <= 14 && !branchOk(pts); k++) pts = attempt(k);
    if (!branchOk(pts)) {
      const end: Point = { x: J.x + (bx / bl) * 42, z: J.z + (bz / bl) * 42 };
      pts = wanderingPath(ctx.rng(`forest.trail.branch_${spec.id}#fallback`), J, end, 0, T.branch.spacing, 30);
    }
    branchEnds.push(pts[pts.length - 1]);
    branchPoints.push(...pts);
    requests.push({
      kind: "trail",
      id: `trail.branch_${spec.id}`,
      points: pts,
      halfWidth: T.branch.halfWidth,
      blend: T.branch.blend,
      smoothWindow: T.branch.smoothWindow,
      anchorStart: true,
      anchorLength: 12,
    });
  }

  // Odcinek za rzeką: dostępny dopiero po zbudowaniu mostu.
  const rs = ctx.rng("forest.trail.stub");
  const stubEnd: Point = { x: east.x + nx * T.stub.length, z: east.z + nz * T.stub.length + between(rs, -3, 3) };
  const stub = wanderingPath(rs, east, stubEnd, 1.5, 3, 20);
  requests.push({
    kind: "trail",
    id: "trail.east_stub",
    points: stub,
    halfWidth: T.branch.halfWidth,
    blend: T.branch.blend,
    smoothWindow: T.branch.smoothWindow,
  });

  // Polany: końce odgałęzień, dwie wolne polany oraz otoczenie lądowisk i startu.
  const allTrailPts = [...main, ...branchPoints, ...stub];
  type Clearing = { id: string; x: number; z: number; r: number; pad: boolean; reach: boolean };
  const clearings: Clearing[] = [];
  const rc = ctx.rng("forest.clearings");
  branchEnds.forEach((e, i) => {
    clearings.push({ id: i === 0 ? "a" : "b", x: e.x, z: e.z, r: q(between(rc, 8, 11)), pad: true, reach: true });
  });
  const centers: Point[] = [start, west, east, ...branchEnds];
  for (const id of ["c", "d"]) {
    for (let k = 0; k < 60; k++) {
      const p: Point = { x: q(between(rc, -125, 70)), z: q(between(rc, -125, 125)) };
      const r = q(between(rc, 6, 9));
      if (minDistToPoints(p, allTrailPts) < 22 || riverGap(p) < 30) continue;
      if (centers.some((c) => dist(c, p) < 35)) continue;
      clearings.push({ id, x: p.x, z: p.z, r, pad: true, reach: true });
      centers.push(p);
      break;
    }
  }
  for (const c of clearings) {
    requests.push({ kind: "pad", id: `pad.clearing_${c.id}`, x: c.x, z: c.z, radius: c.r > 8.5 ? 3 : 2.5, blend: 7 });
    pois.push({
      id: `poi.clearing_${c.id}`,
      kind: "clearing",
      x: c.x,
      z: c.z,
      radius: 3,
      mustReach: c.reach,
      tags: ["clearing", "keep_clear"],
      props: { clearingRadius: c.r },
    });
    zones.push({
      id: `zone.clearing_${c.id}`,
      kind: "clearing",
      shape: { type: "circle", x: c.x, z: c.z, r: c.r },
      tags: ["clearing"],
      props: { feather: 4 },
      priority: 40,
    });
  }

  // Wzniesienia i zagłębienia: łagodne, z dala od rzeki, polan i osi ścieżek (żeby nie zwiększać ich spadków).
  const rh = ctx.rng("forest.hills");
  const clearCenters: Point[] = [start, west, east, ...clearings];
  const placeBumps = (count: number, spec: { radius: readonly [number, number]; amplitude: readonly [number, number] }, prefix: string) => {
    let placed = 0;
    for (let attempts = 0; placed < count && attempts < count * 40; attempts++) {
      const p: Point = { x: q(between(rh, -135, 135)), z: q(between(rh, -135, 135)) };
      const radius = q(between(rh, spec.radius[0], spec.radius[1]));
      const amplitude = q(between(rh, spec.amplitude[0], spec.amplitude[1]));
      if (riverGap(p) < radius * 0.5 + 20) continue;
      if (clearCenters.some((c) => dist(c, p) < radius + 12)) continue;
      if (minDistToPoints(p, allTrailPts) < radius * 0.55) continue;
      requests.push({ kind: "bump", id: `bump.${prefix}_${placed}`, x: p.x, z: p.z, radius, amplitude });
      placed++;
    }
  };
  placeBumps(P.hills.count, P.hills, "hill");
  placeBumps(P.hollows.count, P.hollows, "hollow");

  // Strefy środowiskowe.
  const rz = ctx.rng("forest.zones");
  const placeZones = (profile: "dense_forest" | "sunny_forest", count: number, radius: readonly [number, number], priority: number) => {
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 40; k++) {
        const r = q(between(rz, radius[0], radius[1]));
        const p: Point = { x: q(between(rz, -125, 125)), z: q(between(rz, -125, 125)) };
        if (dist(p, start) < r + 6) continue;
        zones.push({
          id: `zone.${profile}_${i + 1}`,
          kind: profile,
          shape: { type: "circle", x: p.x, z: p.z, r },
          tags: [profile],
          props: { feather: 14 },
          priority,
        });
        break;
      }
    }
  };
  placeZones("dense_forest", P.zones.dense.count, P.zones.dense.radius, 20);
  placeZones("sunny_forest", P.zones.sunny.count, P.zones.sunny.radius, 10);
  zones.push({
    id: "zone.riverside",
    kind: "riverside",
    shape: { type: "ribbon", points: riverPts.map((p) => ({ x: p.x, z: p.z, w: q(p.w + 26) })) },
    tags: ["riverside"],
    props: { feather: 20 },
    priority: 30,
  });
  zones.push({
    id: "zone.clearing_start",
    kind: "clearing",
    shape: { type: "circle", x: start.x, z: start.z, r: 12 },
    tags: ["clearing", "start"],
    props: { feather: 6 },
    priority: 40,
  });
  for (const [name, p] of [["west", west], ["east", east]] as const) {
    zones.push({
      id: `zone.clearing_bridge_${name}`,
      kind: "clearing",
      shape: { type: "circle", x: p.x, z: p.z, r: 7 },
      tags: ["clearing", "bridge"],
      props: { feather: 3.5 },
      priority: 40,
    });
  }
  const stubEndPoint = stub[stub.length - 1];
  zones.push({
    id: "zone.clearing_east_bank",
    kind: "clearing",
    shape: { type: "circle", x: stubEndPoint.x, z: stubEndPoint.z, r: 8 },
    tags: ["clearing"],
    props: { feather: 4 },
    priority: 40,
  });

  // Punkty charakterystyczne: start i miejsce mostu (dane dla przyszłych questów, bez żadnej mechaniki).
  pois.push({ id: "poi.start", kind: "start", x: start.x, z: start.z, radius: 4, tags: ["start", "keep_clear"] });
  pois.push({
    id: "poi.bridge_site",
    kind: "bridge_site",
    x: q(center.x),
    z: q(zb),
    radius: q(center.w + 8),
    tags: ["bridge"],
    props: {
      westX: west.x,
      westZ: west.z,
      eastX: east.x,
      eastZ: east.z,
      riverHalfWidth: q(center.w),
      requiresFlag: BRIDGE_FLAG,
    },
  });
  pois.push({
    id: "poi.bridge_landing_west",
    kind: "bridge_landing",
    x: west.x,
    z: west.z,
    radius: 3,
    mustReach: true,
    tags: ["bridge", "keep_clear", "west"],
  });
  pois.push({
    id: "poi.bridge_landing_east",
    kind: "bridge_landing",
    x: east.x,
    z: east.z,
    radius: 3,
    tags: ["bridge", "keep_clear", "east"],
  });

  // Kotwice questa (W1b): trzy skrzynie na różnych polanach (kolejność losowana raz z seeda), troll przy skrzyni
  // ze schematem i punkt odkrycia za rzeką. Osobny strumień RNG: pozostałe elementy planu się nie zmieniają.
  const anchorRng = ctx.rng("forest.anchors");
  const order = clearings.map((c) => c.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(anchorRng() * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const clearingById = new Map(clearings.map((c) => [c.id, c]));
  QUEST_CHEST_SLOTS.forEach((slot, i) => {
    const c = clearingById.get(order[i] ?? "");
    if (!c) return;
    pois.push({
      id: slot.poi,
      kind: "chest",
      x: q(c.x),
      z: q(c.z),
      radius: 1.6,
      mustReach: true,
      tags: ["chest", "keep_clear"],
      props: { chestId: slot.chest, clearing: c.id },
    });
  });
  const trollClearing = clearingById.get(order[2] ?? "");
  if (trollClearing) {
    let ux = 1;
    let uz = 0;
    for (let k = 0; k < 24; k++) {
      const a = anchorRng() * 2 - 1;
      const b = anchorRng() * 2 - 1;
      const l2 = a * a + b * b;
      if (l2 > 0.2 && l2 <= 1) {
        const l = Math.sqrt(l2);
        ux = a / l;
        uz = b / l;
        break;
      }
    }
    pois.push({
      id: "poi.troll_bridge",
      kind: "npc",
      x: q(trollClearing.x + ux * TROLL_OFFSET),
      z: q(trollClearing.z + uz * TROLL_OFFSET),
      radius: 1.6,
      mustReach: true,
      tags: ["npc", "keep_clear"],
      props: { npcId: "npc.troll.bridge", guards: "chest.bridge.blueprint" },
    });
  }
  pois.push({
    id: "poi.beyond_bridge",
    kind: "region_entry",
    x: q(east.x + nx * 5),
    z: q(east.z + nz * 5),
    radius: 4,
    tags: ["region_entry"],
    props: { regionId: "region.beyond_bridge" },
  });

  // Oś przejścia mostu: pas wolny od drzew i skał (inaczej pojedyncza skała mogłaby zablokować gotowy most).
  const axisLen = dist(west, east);
  const axisSteps = Math.max(1, Math.ceil(axisLen / 3));
  for (let k = 0; k <= axisSteps; k++) {
    const t = k / axisSteps;
    pois.push({
      id: `poi.bridge_axis_${k}`,
      kind: "bridge_axis",
      x: q(west.x + (east.x - west.x) * t),
      z: q(west.z + (east.z - west.z) * t),
      radius: P.bridge.passageHalfWidth + 0.8,
      tags: ["bridge", "keep_clear"],
    });
  }

  const barriers: Barrier[] = [{ id: RIVER_BARRIER_ID, kind: "river", shape: { type: "ribbon", points: riverPts } }];
  const passages: Passage[] = [
    {
      id: BRIDGE_PASSAGE_ID,
      requiresFlag: BRIDGE_FLAG,
      opens: [RIVER_BARRIER_ID],
      shape: {
        type: "band",
        points: [
          { x: q(west.x - nx * 0.5), z: q(west.z - nz * 0.5) },
          { x: q(east.x + nx * 0.5), z: q(east.z + nz * 0.5) },
        ],
        halfWidth: P.bridge.passageHalfWidth,
      },
    },
  ];

  return { terrain: requests, pois, zones, barriers, passages };
}
