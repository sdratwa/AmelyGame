import { rngStream, type Rng } from "../core/rng";
import { boundsContain, regionAt, type RegionDef } from "./bounds";
import { FeatureMap, type EnvironmentZone, type PointOfInterest } from "./features";
import { fingerprintOf } from "./fingerprint";
import type { WorldObject } from "./objects";
import {
  bumpModifier,
  createBaseTerrain,
  padModifier,
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

/** Prośba o spłaszczenie pod obiekt (budynek, skrzynia, miejsce mostu): wysokość = teren bazowy w środku. */
export type PadRequest = { kind: "pad"; id: string; x: number; z: number; radius: number; blend: number; heightOffset?: number };
/** Prośba o łagodne wzniesienie lub zagłębienie. */
export type BumpRequest = { kind: "bump"; id: string; x: number; z: number; radius: number; amplitude: number };
export type TerrainRequest = PadRequest | BumpRequest;

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

export type WorldRecipe = {
  regions: readonly RegionDef[];
  start: { x: number; z: number };
  plan(ctx: PlanContext): WorldPlan;
  place(ctx: PlaceContext): WorldObject[];
  walk?: Partial<WalkConfig>;
  /** Promień (m), w którym osiągalna komórka wystarcza dla `mustReach` (zasięg interakcji). */
  reachRadius?: number;
};

export type Violation = { code: "start_blocked" | "out_of_bounds" | "unreachable" | "bad_terrain_request"; id: string; message: string };
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

const KIND_ORDER: Record<TerrainRequest["kind"], number> = { bump: 0, pad: 1 };

/**
 * Etap 3: zamienia prośby na modyfikacje terenu. Wysokość spłaszczenia wyznaczana jest raz, z terenu
 * BAZOWEGO, więc nie ma zależności cyklicznej teren <-> obiekty. Kolejność stosowania jest stała:
 * wzniesienia, potem spłaszczenia (spłaszczenie ma ostatnie słowo), w obrębie rodzaju wg kolejności planu.
 */
export function materializeTerrain(base: Terrain, requests: readonly TerrainRequest[]): Terrain {
  const ordered = requests
    .map((request, index) => ({ request, index }))
    .sort((a, b) => KIND_ORDER[a.request.kind] - KIND_ORDER[b.request.kind] || a.index - b.index);
  const modifiers: TerrainModifier[] = ordered.map(({ request: r }) =>
    r.kind === "pad"
      ? padModifier({
          id: r.id,
          x: r.x,
          z: r.z,
          radius: r.radius,
          blend: r.blend,
          height: base.height(r.x, r.z) + (r.heightOffset ?? 0),
        })
      : bumpModifier({ id: r.id, x: r.x, z: r.z, radius: r.radius, amplitude: r.amplitude }),
  );
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
  const seed = worldSeed >>> 0;
  const variant = options.variant ?? 0;
  const ctx = streamContext(seed, worldGenVersion, variant);

  const base = createBaseTerrain(seed, worldGenVersion);
  const plan = recipe.plan({ ...ctx, regions: recipe.regions, base });
  const terrain = materializeTerrain(base, plan.terrain);
  const features = new FeatureMap(plan.pois ?? [], plan.zones ?? []);
  const objects = recipe.place({ ...ctx, regions: recipe.regions, terrain, plan, features });

  const walk = new WalkWorld({
    regions: recipe.regions,
    terrain,
    objects,
    barriers: plan.barriers,
    passages: plan.passages,
    config: recipe.walk,
  });

  const violations: Violation[] = [];
  const noFlags = new Set<string>();
  for (const r of plan.terrain) {
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
