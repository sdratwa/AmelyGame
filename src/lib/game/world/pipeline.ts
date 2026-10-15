import { rngStream, type Rng } from "../core/rng";
import { boundsContain, regionAt, type RegionDef } from "./bounds";
import type { Point, RibbonPoint } from "./shape";
import { FeatureMap, type EnvironmentZone, type PointOfInterest } from "./features";
import { fingerprintOf } from "./fingerprint";
import type { WorldObject } from "./objects";
import {
  bumpModifier,
  createBaseTerrain,
  padModifier,
  riverModifier,
  trailModifier,
  withModifiers,
  type HeightField,
  type Terrain,
  type TerrainModifier,
} from "./terrain";
import {
  computeReachability,
  reachesNear,
  WalkWorld,
  type Barrier,
  type Passage,
  type WalkConfig,
} from "./walk";

/**
 * Prośba o spłaszczenie pod obiekt (budynek, skrzynia, miejsce mostu): wysokość = teren w środku.
 * `reference: "base"` (domyślnie) bierze wysokość z terenu bazowego, `"shaped"` z terenu po wzniesieniach i rzekach
 * (np. lądowisko mostu na brzegu, który sam jest modyfikacją).
 */
export type PadRequest = {
  kind: "pad";
  id: string;
  x: number;
  z: number;
  radius: number;
  blend: number;
  heightOffset?: number;
  reference?: "base" | "shaped";
};
/** Prośba o łagodne wzniesienie lub zagłębienie. */
export type BumpRequest = { kind: "bump"; id: string; x: number; z: number; radius: number; amplitude: number };
/**
 * Prośba o koryto rzeki: oś z półszerokościami, głębokość, skarpa brzegowa i wtopienie. Poziom lustra wody
 * wyznaczany jest z terenu bazowego (średnia wzdłuż osi w oknie `smoothWindow`, plus `waterOffset`).
 */
export type RiverRequest = {
  kind: "river";
  id: string;
  points: RibbonPoint[];
  depth: number;
  bankWidth: number;
  bankRise: number;
  blend: number;
  smoothWindow: number;
  waterOffset: number;
};
/**
 * Prośba o ścieżkę: oś, półszerokość i wtopienie. Profil wysokości to wygładzona (okno `smoothWindow`) wysokość
 * terenu po wzniesieniach, rzekach i wcześniejszych ścieżkach. `anchorStart` przypina początek do istniejącej
 * powierzchni (odgałęzienie od innej ścieżki) na odcinku `anchorLength`.
 */
export type TrailRequest = {
  kind: "trail";
  id: string;
  points: Point[];
  halfWidth: number;
  blend: number;
  smoothWindow: number;
  anchorStart?: boolean;
  anchorLength?: number;
};
export type TerrainRequest = PadRequest | BumpRequest | RiverRequest | TrailRequest;

/** Wynik etapu 2: czego potrzebuje świat, zanim ktokolwiek położy pierwszy obiekt. */
export type WorldPlan = {
  terrain: TerrainRequest[];
  pois?: PointOfInterest[];
  zones?: EnvironmentZone[];
  barriers?: Barrier[];
  passages?: Passage[];
};

type StreamContext = {
  seed: number;
  version: number;
  variant: number;
  /** Niezależny strumień RNG o nazwie `key` (dodanie strumienia nie przesuwa pozostałych). */
  rng(key: string): Rng;
};

/** Etap 2 widzi WYŁĄCZNIE teren bazowy (typ `HeightField`): nie może zależeć od obiektów ani modyfikacji. */
export type PlanContext = StreamContext & { regions: readonly RegionDef[]; base: HeightField };

/** Etap 4 widzi teren końcowy po modyfikacjach oraz plan; zwraca obiekty stojące na tym terenie. */
export type PlaceContext = StreamContext & {
  regions: readonly RegionDef[];
  terrain: Terrain;
  plan: WorldPlan;
  features: FeatureMap;
};

/** Kontekst walidacji specyficznej dla przepisu: gotowy świat bez raportu. */
export type ValidateContext = StreamContext & {
  regions: readonly RegionDef[];
  start: { x: number; z: number };
  terrain: Terrain;
  plan: WorldPlan;
  features: FeatureMap;
  objects: readonly WorldObject[];
  walk: WalkWorld;
};

export type WorldRecipe = {
  regions: readonly RegionDef[];
  start: { x: number; z: number };
  plan(ctx: PlanContext): WorldPlan;
  place(ctx: PlaceContext): WorldObject[];
  walk?: Partial<WalkConfig>;
  /** Rozmiar komórki indeksu przestrzennego chodzenia (domyślnie rozmiar sektora). */
  walkCell?: number;
  /** Promień (m), w którym osiągalna komórka wystarcza dla `mustReach` (zasięg interakcji). */
  reachRadius?: number;
  /** Dodatkowe reguły przepisu (np. brak obejścia rzeki); wynik dołączany do raportu. */
  validate?(ctx: ValidateContext): Violation[];
};

export type ViolationCode =
  | "start_blocked"
  | "out_of_bounds"
  | "unreachable"
  | "bad_terrain_request"
  | (string & {});
export type Violation = { code: ViolationCode; id: string; message: string };
export type ValidationReport = { ok: boolean; violations: Violation[] };

export type BuiltWorld = {
  seed: number;
  version: number;
  variant: number;
  regions: readonly RegionDef[];
  base: Terrain;
  terrain: Terrain;
  plan: WorldPlan;
  objects: WorldObject[];
  features: FeatureMap;
  walk: WalkWorld;
  report: ValidationReport;
  fingerprint: string;
};

function streamContext(seed: number, version: number, variant: number): StreamContext {
  return {
    seed,
    version,
    variant,
    rng: (key) => rngStream(seed, variant > 0 ? `${key}#v${variant}` : key),
  };
}

const KIND_ORDER: Record<TerrainRequest["kind"], number> = { bump: 0, river: 1, trail: 2, pad: 3 };

const smooth01 = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

function cumulativeLength(points: readonly Point[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.sqrt((points[i].x - points[i - 1].x) ** 2 + (points[i].z - points[i - 1].z) ** 2));
  }
  return cum;
}

function pointAtArc(points: readonly Point[], cum: readonly number[], s: number): Point {
  const total = cum[cum.length - 1];
  const c = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < c) i++;
  const span = cum[i] - cum[i - 1];
  const t = span === 0 ? 0 : (c - cum[i - 1]) / span;
  return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, z: points[i - 1].z + (points[i].z - points[i - 1].z) * t };
}

/** Średnia wysokości wzdłuż łamanej w oknie +-`window` m (próbkowanie co 2 m, po długości łuku). */
function smoothedProfile(points: readonly Point[], height: (x: number, z: number) => number, window: number): number[] {
  const cum = cumulativeLength(points);
  const step = 2;
  const half = Math.max(0, Math.round(window / step));
  return points.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -half; k <= half; k++) {
      const p = pointAtArc(points, cum, cum[i] + k * step);
      sum += height(p.x, p.z);
      n++;
    }
    return sum / n;
  });
}

/**
 * Etap 3: zamienia prośby na modyfikacje terenu. Kolejność stosowania jest stała: wzniesienia, rzeki, ścieżki,
 * spłaszczenia (spłaszczenie ma ostatnie słowo); w obrębie rodzaju wg kolejności planu. Wysokości zależne od terenu
 * (lustro wody, profil ścieżki, spłaszczenie) wyznaczane są raz, z terenu zbudowanego przez wcześniejsze etapy,
 * więc nie ma zależności cyklicznej teren <-> obiekty.
 */
export function materializeTerrain(base: Terrain, requests: readonly TerrainRequest[]): Terrain {
  const ordered = requests
    .map((request, index) => ({ request, index }))
    .sort((a, b) => KIND_ORDER[a.request.kind] - KIND_ORDER[b.request.kind] || a.index - b.index)
    .map(({ request }) => request);

  const modifiers: TerrainModifier[] = [];
  let shaped: Terrain = base;
  let current: Terrain = base;
  const push = (m: TerrainModifier) => {
    modifiers.push(m);
    current = withModifiers(base, modifiers);
  };

  for (const r of ordered) {
    if (r.kind === "bump") {
      push(bumpModifier({ id: r.id, x: r.x, z: r.z, radius: r.radius, amplitude: r.amplitude }));
      shaped = current;
    } else if (r.kind === "river") {
      const water = smoothedProfile(r.points, (x, z) => base.height(x, z), r.smoothWindow).map((h) => h + r.waterOffset);
      push(
        riverModifier({
          id: r.id,
          points: r.points,
          waterY: water,
          depth: r.depth,
          bankWidth: r.bankWidth,
          bankRise: r.bankRise,
          blend: r.blend,
        }),
      );
      shaped = current;
    } else if (r.kind === "trail") {
      const profile = smoothedProfile(r.points, (x, z) => current.height(x, z), r.smoothWindow);
      if (r.anchorStart) {
        const cum = cumulativeLength(r.points);
        const h0 = current.height(r.points[0].x, r.points[0].z);
        const len = r.anchorLength ?? 12;
        for (let i = 0; i < profile.length; i++) {
          const t = smooth01(cum[i] / len);
          profile[i] = h0 + (profile[i] - h0) * t;
        }
      }
      push(trailModifier({ id: r.id, points: r.points, y: profile, halfWidth: r.halfWidth, blend: r.blend }));
    } else {
      const ref = r.reference === "shaped" ? shaped : base;
      push(
        padModifier({
          id: r.id,
          x: r.x,
          z: r.z,
          radius: r.radius,
          blend: r.blend,
          height: ref.height(r.x, r.z) + (r.heightOffset ?? 0),
        }),
      );
    }
  }
  return withModifiers(base, modifiers);
}

function terrainSignature(terrain: HeightField, region: RegionDef): number[] {
  const step = 10;
  const out: number[] = [];
  for (let z = region.bounds.minZ; z <= region.bounds.maxZ; z += step) {
    for (let x = region.bounds.minX; x <= region.bounds.maxX; x += step) {
      out.push(Math.round(terrain.height(x, z) * 1000));
    }
  }
  return out;
}

export type PreparedWorld = {
  seed: number;
  version: number;
  variant: number;
  ctx: StreamContext;
  base: Terrain;
  plan: WorldPlan;
  terrain: Terrain;
  features: FeatureMap;
};

/**
 * Etapy 1-3 potoku (teren bazowy, plan, modyfikacje terenu) bez obiektów. Pozwala używać terenu i planu
 * (np. rzeki, ścieżek) bez generowania całego świata; `buildWorld` składa się z tego i etapów 4-5.
 */
export function prepareWorld(
  recipe: Pick<WorldRecipe, "regions" | "plan">,
  worldSeed: number,
  worldGenVersion: number,
  options: { variant?: number } = {},
): PreparedWorld {
  const seed = worldSeed >>> 0;
  const variant = options.variant ?? 0;
  const ctx = streamContext(seed, worldGenVersion, variant);
  const base = createBaseTerrain(seed, worldGenVersion);
  const plan = recipe.plan({ ...ctx, regions: recipe.regions, base });
  const terrain = materializeTerrain(base, plan.terrain);
  const features = new FeatureMap(plan.pois ?? [], plan.zones ?? []);
  return { seed, version: worldGenVersion, variant, ctx, base, plan, terrain, features };
}

/**
 * Deterministyczny proces budowy świata: (1) teren bazowy z seeda, (2) plan miejsc wymagających
 * modyfikacji (widzi tylko bazę), (3) modyfikacje terenu, (4) obiekty na terenie końcowym,
 * (5) walidacja przechodniości. Wynik zależy wyłącznie od (recipe, seed, version, variant).
 */
export function buildWorld(
  recipe: WorldRecipe,
  worldSeed: number,
  worldGenVersion: number,
  options: { variant?: number } = {},
): BuiltWorld {
  const { seed, variant, ctx, base, plan, terrain, features } = prepareWorld(recipe, worldSeed, worldGenVersion, options);
  const objects = recipe.place({ ...ctx, regions: recipe.regions, terrain, plan, features });

  const walk = new WalkWorld({
    regions: recipe.regions,
    terrain,
    objects: objects.filter((o) => o.collider),
    barriers: plan.barriers,
    passages: plan.passages,
    config: recipe.walk,
    cellSize: recipe.walkCell,
  });

  const violations: Violation[] = [];
  const noFlags = new Set<string>();
  for (const r of plan.terrain) {
    if (r.kind === "river" || r.kind === "trail") {
      const pts: readonly (Point & { w?: number })[] = r.points;
      const ok =
        pts.length >= 2 &&
        pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z) && (r.kind === "trail" || (p.w ?? 0) > 0)) &&
        (r.kind === "river" || r.halfWidth > 0);
      if (!ok) violations.push({ code: "bad_terrain_request", id: r.id, message: "niepoprawna oś rzeki lub ścieżki" });
      continue;
    }
    if (![r.x, r.z, r.radius].every(Number.isFinite) || r.radius <= 0 || regionAt(recipe.regions, r.x, r.z) === null) {
      violations.push({ code: "bad_terrain_request", id: r.id, message: "prośba o modyfikację terenu poza regionem lub niepoprawna" });
    }
  }
  for (const o of objects) {
    const region = regionAt(recipe.regions, o.x, o.z);
    if (!region || !boundsContain(region.bounds, o.x, o.z)) {
      violations.push({ code: "out_of_bounds", id: o.id, message: "obiekt poza regionem" });
    }
  }
  const startBlock = walk.checkPoint(recipe.start.x, recipe.start.z, noFlags);
  if (startBlock) {
    violations.push({ code: "start_blocked", id: "start", message: `punkt startu zablokowany: ${startBlock.reason}` });
  } else {
    const reach = computeReachability(walk, recipe.start, { flags: noFlags });
    const radius = recipe.reachRadius ?? 2;
    const targets = [
      ...(plan.pois ?? []).filter((p) => p.mustReach).map((p) => ({ id: p.id, x: p.x, z: p.z })),
      ...objects.filter((o) => o.tags?.includes("must_reach")).map((o) => ({ id: o.id, x: o.x, z: o.z })),
    ];
    for (const t of targets) {
      if (!reachesNear(reach, t.x, t.z, radius)) {
        violations.push({ code: "unreachable", id: t.id, message: "cel niedostępny pieszo od punktu startu" });
      }
    }
  }

  if (recipe.validate) {
    violations.push(
      ...recipe.validate({ ...ctx, regions: recipe.regions, start: recipe.start, terrain, plan, features, objects, walk }),
    );
  }

  const fingerprint = fingerprintOf({
    version: worldGenVersion,
    variant,
    terrain: terrainSignature(terrain, recipe.regions[0]),
    plan,
    objects,
  });

  return {
    seed,
    version: worldGenVersion,
    variant,
    regions: recipe.regions,
    base,
    terrain,
    plan,
    objects,
    features,
    walk,
    report: { ok: violations.length === 0, violations },
    fingerprint,
  };
}
