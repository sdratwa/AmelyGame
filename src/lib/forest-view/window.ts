import type { Placement } from "@/lib/assets";
import { objectToPlacement } from "@/lib/assets";
import { sectorId, FOREST_START_REGION, type Bounds, type RegionDef } from "@/lib/game/world/bounds";
import {
  FOREST_START,
  PRO_OPTIONS,
  SPECIES_ALL_BY_MODEL as SPECIES_BY_MODEL,
  createForest,
  pickShowcaseSectors,
  type ForestSector,
  type ForestWorld,
  type ShowcaseSector,
} from "@/lib/game/world/generators/v2";
import type { WorldObject } from "@/lib/game/world/objects";
import { WalkWorld } from "@/lib/game/world/walk";
import { lookOf } from "./disposition";
import { viewKindOf, type ViewKind } from "./profiles";

export const DEFAULT_SEED = 2030;
/** Strefa chodzenia to wybrany sektor powiększony o tyle metrów z każdej strony (render obejmuje 3 x 3 sektory). */
export const WALK_MARGIN = 15;

/** Stabilny skrót napisu -> [0, 1); decyduje o rzadzeniu widoku niezależnie od kolejności obiektów. */
export function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Instancje jednego modelu razem z danymi pomocniczymi dla przydziału LOD i odcinania. */
export type ModelBatch = {
  modelId: string;
  kind: ViewKind;
  placements: Placement[];
  ids: string[];
  /** Stały dla instancji rank [0,1) do rzadzenia drobnej roślinności. */
  rank: Float32Array;
  /** Promień sfery brzegowej instancji (m) i wysokość jej środka nad podstawą. */
  radius: Float32Array;
  centerY: Float32Array;
  /** Skok progu LOD [-1, 1], żeby sylwetki nie zmieniały się jednocześnie w jednym pierścieniu. */
  jitter: Float32Array;
};

export type ForestWindow = {
  seed: number;
  forest: ForestWorld;
  sector: { ix: number; iz: number; id: string };
  showcase: ShowcaseSector[];
  /** Sektory rysowane (kolumny x wiersze okna). */
  sectors: ForestSector[];
  windowBounds: Bounds;
  walkBounds: Bounds;
  objects: WorldObject[];
  batches: ModelBatch[];
  walk: WalkWorld;
  start: { x: number; z: number; yaw: number };
  /** Liczba instancji bez ukrytych odmian i ogółem (do raportu). */
  instanceCount: number;
  hiddenCount: number;
};

export type WindowOptions = {
  seed?: number;
  /** Wybrany sektor; domyślnie pierwszy sektor wzorcowy dla seeda. */
  sector?: { ix: number; iz: number };
  /** Promień okna w sektorach: 1 = 3 x 3 (zwykły prototyp), 3 = 7 x 7 (tryb obciążeniowy). */
  radius?: number;
  walkMargin?: number;
  /** Tryb deweloperski Pro (`/dev/forest-pro`): wszystkie modele paczki Pro, 4 strefy i bruk drogi. Domyślnie wyłączony. */
  pro?: boolean;
};

export function parseSectorParam(text: string | null | undefined): { ix: number; iz: number } | null {
  const m = /^(\d+)[_,x:-](\d+)$/.exec(text ?? "");
  if (!m) return null;
  return { ix: Number(m[1]), iz: Number(m[2]) };
}

/** Dla ?stress=N: liczba sektorów kwadratowego okna (9, 25, 49...) -> promień. Poza zakresem lub nie-kwadrat: null. */
export function stressRadius(count: number): number | null {
  const side = Math.round(Math.sqrt(count));
  if (!Number.isFinite(count) || side * side !== count || side % 2 === 0 || side < 3 || side > 9) return null;
  return (side - 1) / 2;
}

export function clampSector(forest: ForestWorld, sector: { ix: number; iz: number }) {
  const { nx, nz } = forest.sectorGrid;
  return { ix: Math.max(0, Math.min(nx - 1, sector.ix)), iz: Math.max(0, Math.min(nz - 1, sector.iz)) };
}

function windowRange(center: number, radius: number, count: number) {
  const side = Math.min(count, radius * 2 + 1);
  const start = Math.max(0, Math.min(count - side, center - radius));
  return { start, end: start + side - 1 };
}

/** Najbliższy środkowi sektora punkt ścieżki w sektorze i kierunek marszu (do startu i patrzenia wzdłuż ścieżki). */
export function pickStart(forest: ForestWorld, sector: ForestSector, walk: WalkWorld): { x: number; z: number; yaw: number } {
  const b = sector.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  let best: { x: number; z: number; yaw: number; d: number } | null = null;
  for (const trail of forest.geometry.trails) {
    if (trail.stub) continue;
    for (let i = 0; i + 1 < trail.points.length; i++) {
      const p = trail.points[i];
      const q = trail.points[i + 1];
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const n = Math.max(1, Math.ceil(len / 1));
      for (let k = 0; k < n; k++) {
        const x = p.x + ((q.x - p.x) * k) / n;
        const z = p.z + ((q.z - p.z) * k) / n;
        if (x < b.minX + 2 || x > b.maxX - 2 || z < b.minZ + 2 || z > b.maxZ - 2) continue;
        const d = Math.hypot(x - cx, z - cz);
        if (best && d >= best.d) continue;
        if (!walk.isWalkable(x, z)) continue;
        best = { x, z, yaw: Math.atan2(-(q.x - p.x), -(q.z - p.z)), d };
      }
    }
  }
  if (best) return { x: best.x, z: best.z, yaw: best.yaw };
  for (let r = 0; r < 40; r += 1) {
    for (let a = 0; a < 16; a++) {
      const x = cx + r * Math.cos((a / 16) * Math.PI * 2);
      const z = cz + r * Math.sin((a / 16) * Math.PI * 2);
      if (walk.isWalkable(x, z)) return { x, z, yaw: Math.atan2(-(cx - x), -(cz - z)) };
    }
  }
  return { x: FOREST_START.x, z: FOREST_START.z, yaw: 0 };
}

/** Grupuje obiekty wg modelu w partie instancji z danymi do LOD/odcinania; ukryte odmiany (disposition) są pomijane. */
export function batchesFor(objects: readonly WorldObject[], showAll = false): { batches: ModelBatch[]; instanceCount: number; hiddenCount: number } {
  const grouped = new Map<string, WorldObject[]>();
  let hiddenCount = 0;
  for (const o of objects) {
    const id = o.variant ? `${o.kind}.${o.variant}` : o.kind;
    if (!showAll && lookOf(id).mode === "hide") {
      hiddenCount++;
      continue;
    }
    const list = grouped.get(id);
    if (list) list.push(o);
    else grouped.set(id, [o]);
  }
  const batches: ModelBatch[] = [];
  let instanceCount = 0;
  for (const [modelId, list] of [...grouped].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const species = SPECIES_BY_MODEL.get(modelId);
    const footprint = species?.footprint ?? 1;
    const height = species?.height ?? 1;
    const n = list.length;
    const rank = new Float32Array(n);
    const radiusArr = new Float32Array(n);
    const centerY = new Float32Array(n);
    const jitter = new Float32Array(n);
    list.forEach((o, i) => {
      const scale = o.scaleXYZ ?? o.scale ?? 1;
      const sxz = typeof scale === "number" ? scale : Math.max(scale[0], scale[2]);
      const sy = typeof scale === "number" ? scale : scale[1];
      rank[i] = hash01(o.id);
      jitter[i] = hash01(`${o.id}#lod`) * 2 - 1;
      radiusArr[i] = Math.hypot(footprint * sxz, (height * sy) / 2) * 1.05;
      centerY[i] = (height * sy) / 2;
    });
    batches.push({
      modelId,
      kind: viewKindOf(list[0].kind),
      placements: list.map(objectToPlacement),
      ids: list.map((o) => o.id),
      rank,
      radius: radiusArr,
      centerY,
      jitter,
    });
    instanceCount += n;
  }
  return { batches, instanceCount, hiddenCount };
}

/** Łączy partie z wielu sektorów w jedną partię na model (kolejność modeli i obiektów jest stabilna). */
export function mergeBatches(parts: readonly (readonly ModelBatch[])[]): ModelBatch[] {
  const byModel = new Map<string, ModelBatch[]>();
  for (const list of parts) {
    for (const b of list) {
      const arr = byModel.get(b.modelId);
      if (arr) arr.push(b);
      else byModel.set(b.modelId, [b]);
    }
  }
  const out: ModelBatch[] = [];
  for (const [modelId, list] of [...byModel].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const total = list.reduce((n, b) => n + b.ids.length, 0);
    const cat = (pick: (b: ModelBatch) => Float32Array) => {
      const arr = new Float32Array(total);
      let at = 0;
      for (const b of list) {
        arr.set(pick(b), at);
        at += b.ids.length;
      }
      return arr;
    };
    out.push({
      modelId,
      kind: list[0].kind,
      placements: list.flatMap((b) => b.placements),
      ids: list.flatMap((b) => b.ids),
      rank: cat((b) => b.rank),
      radius: cat((b) => b.radius),
      centerY: cat((b) => b.centerY),
      jitter: cat((b) => b.jitter),
    });
  }
  return out;
}

/** Okno lasu dla prototypu V2a: wszystko pochodzi z generatora W1a (teren, rozmieszczenie, kolizje). */
export function buildForestWindow(options: WindowOptions = {}): ForestWindow {
  const seed = options.seed ?? DEFAULT_SEED;
  const forest = createForest(seed, options.pro ? { pro: PRO_OPTIONS } : {});
  // W trybie Pro nie szukamy sektorów wzorcowych (to oznaczałoby wygenerowanie całego lasu osobnym przebiegiem metryk).
  const showcase = options.pro ? [] : pickShowcaseSectors(forest, 6);
  const wanted = options.sector
    ? clampSector(forest, options.sector)
    : options.pro
      ? forest.sectorCoordClamped(FOREST_START.x, FOREST_START.z)
      : { ix: showcase[0].ix, iz: showcase[0].iz };
  const radius = options.radius ?? 1;
  const { nx, nz } = forest.sectorGrid;
  const xr = windowRange(wanted.ix, radius, nx);
  const zr = windowRange(wanted.iz, radius, nz);

  const sectors: ForestSector[] = [];
  for (let iz = zr.start; iz <= zr.end; iz++) for (let ix = xr.start; ix <= xr.end; ix++) sectors.push(forest.sector(ix, iz));
  const first = sectors[0].bounds;
  const last = sectors[sectors.length - 1].bounds;
  const windowBounds: Bounds = { minX: first.minX, minZ: first.minZ, maxX: last.maxX, maxZ: last.maxZ };
  const chosen = forest.sector(wanted.ix, wanted.iz);

  const stress = radius > 1;
  const margin = options.walkMargin ?? WALK_MARGIN;
  const rb = forest.region.bounds;
  const walkBounds: Bounds = stress
    ? windowBounds
    : {
        minX: Math.max(rb.minX, chosen.bounds.minX - margin),
        minZ: Math.max(rb.minZ, chosen.bounds.minZ - margin),
        maxX: Math.min(rb.maxX, chosen.bounds.maxX + margin),
        maxZ: Math.min(rb.maxZ, chosen.bounds.maxZ + margin),
      };

  const objects: WorldObject[] = [];
  const colliders: WorldObject[] = [];
  for (const s of sectors) {
    for (const o of s.objects) {
      objects.push(o);
      if (o.collider) colliders.push(o);
    }
  }
  const { batches, instanceCount, hiddenCount } = batchesFor(objects, options.pro === true);

  const walkRegion: RegionDef = { ...FOREST_START_REGION, bounds: walkBounds };
  const walk = new WalkWorld({
    regions: [walkRegion],
    terrain: forest.terrain,
    objects: colliders,
    barriers: forest.plan.barriers,
    passages: forest.plan.passages,
    cellSize: 10,
  });

  return {
    seed,
    forest,
    sector: { ix: wanted.ix, iz: wanted.iz, id: sectorId(forest.region, wanted.ix, wanted.iz) },
    showcase,
    sectors,
    windowBounds,
    walkBounds,
    objects,
    batches,
    walk,
    start: pickStart(forest, chosen, walk),
    instanceCount,
    hiddenCount,
  };
}
