import { QUEST_BY_ID } from "../content/quests";
import type { ChestId } from "../core/ids";
import { rngStream } from "../core/rng";
import type { GameState } from "../core/state";
import { FOREST_START_REGION } from "../world/bounds";
import { FOREST_START } from "../world/generators/v2";
import { forestChestsOf, forestOf } from "../world/lookup";
import { CHEST_CONTENTS } from "./forestQuest";

export type MapPoint = { x: number; z: number };

/**
 * Statyczne dane minimapy lasu (wyliczane z seeda, bez żadnych danych o skrzyniach i trollu): granice, wstęga rzeki,
 * orientacyjne ścieżki i punkt wejścia. Układ jak w świecie: +X na wschód (w prawo), -Z na północ (w górę).
 */
export type MinimapModel = {
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  river: { left: MapPoint[]; right: MapPoint[] };
  trails: { id: string; main: boolean; points: MapPoint[] }[];
  entry: MapPoint;
};

/** Odgałęzienia ścieżek kończą się na polanach; na mapie pokazujemy tylko ich początkową część, żeby nie wskazywać celu. */
export const BRANCH_VISIBLE_FRACTION = 0.5;
const RIVER_STEP = 5;

const cache = new WeakMap<object, MinimapModel>();

export function buildMinimapModel(seed: number): MinimapModel {
  const forest = forestOf(seed);
  const hit = cache.get(forest);
  if (hit) return hit;
  const b = FOREST_START_REGION.bounds;
  const left: MapPoint[] = [];
  const right: MapPoint[] = [];
  for (let z = b.minZ; z <= b.maxZ + 1e-9; z += RIVER_STEP) {
    const r = forest.geometry.riverAt(z);
    left.push({ x: r.x - r.w, z });
    right.push({ x: r.x + r.w, z });
  }
  const trails: MinimapModel["trails"] = [];
  for (const t of forest.geometry.trails) {
    if (t.stub) continue;
    const main = t.id === "trail.main";
    const count = main ? t.points.length : Math.max(2, Math.floor(t.points.length * BRANCH_VISIBLE_FRACTION));
    trails.push({ id: t.id, main, points: t.points.slice(0, count).map((p) => ({ x: p.x, z: p.z })) });
  }
  const model: MinimapModel = { bounds: { ...b }, river: { left, right }, trails, entry: { x: FOREST_START.x, z: FOREST_START.z } };
  cache.set(forest, model);
  return model;
}

/** Orientacyjny obszar poszukiwań skrzyni: koło, w którym leży skrzynia, ale jego środek jest przesunięty. */
export type SearchArea = { chest: ChestId; x: number; z: number; r: number };

export const SEARCH_AREA_RADIUS = 42;
/** Przesunięcie środka koła względem skrzyni jako ułamek promienia: nigdy w środku, nigdy blisko krawędzi. */
export const SEARCH_AREA_OFFSET: readonly [number, number] = [0.2, 0.55];

/** Obszar poszukiwań jednej skrzyni (deterministyczny z seeda); to jedyna informacja o jej położeniu na mapie. */
export function searchAreaFor(seed: number, chest: ChestId, at: MapPoint): SearchArea {
  const rng = rngStream(seed, `minimap.hint.${chest}`);
  const angle = rng() * Math.PI * 2;
  const frac = SEARCH_AREA_OFFSET[0] + rng() * (SEARCH_AREA_OFFSET[1] - SEARCH_AREA_OFFSET[0]);
  const b = FOREST_START_REGION.bounds;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    chest,
    x: clamp(at.x + Math.cos(angle) * frac * SEARCH_AREA_RADIUS, b.minX, b.maxX),
    z: clamp(at.z + Math.sin(angle) * frac * SEARCH_AREA_RADIUS, b.minZ, b.maxZ),
    r: SEARCH_AREA_RADIUS,
  };
}

const CHEST_BY_ITEM = new Map(Object.entries(CHEST_CONTENTS).map(([chest, item]) => [item, chest as ChestId]));

/**
 * Obszary poszukiwań zgodne z aktywnym zadaniem: dla skrzyń, których przedmiot jest celem bieżącego etapu,
 * nie został jeszcze zdobyty, a skrzynia nie była otwarta. Nigdy nie zwraca dokładnych współrzędnych skrzyń.
 */
export function searchAreas(state: GameState): SearchArea[] {
  if (!state.world) return [];
  const seed = state.world.seed;
  const out: SearchArea[] = [];
  for (const [questId] of Object.entries(state.quests.accepted)) {
    if (state.quests.completed[questId]) continue;
    const def = QUEST_BY_ID.get(questId);
    if (!def) continue;
    const stage = def.stages.find((st) =>
      st.objectives.some((o) => (o.kind === "obtained" || o.kind === "holding" ? (state.ledger.gained[o.item] ?? 0) < o.count : false)),
    );
    if (!stage) continue;
    for (const o of stage.objectives) {
      if (o.kind !== "obtained") continue;
      const chest = CHEST_BY_ITEM.get(o.item);
      if (!chest || (state.ledger.gained[o.item] ?? 0) >= o.count || state.chests[chest]?.opened) continue;
      const placement = forestChestsOf(seed).find((c) => c.id === chest);
      if (placement && !out.some((a) => a.chest === chest)) out.push(searchAreaFor(seed, chest, placement));
    }
  }
  return out;
}

/** Rzut punktu świata na kwadratową mapę o boku `size` px: +X w prawo, -Z (północ) w górę. */
export function projectToMap(bounds: MinimapModel["bounds"], size: number, p: MapPoint): { x: number; y: number } {
  return {
    x: ((p.x - bounds.minX) / (bounds.maxX - bounds.minX)) * size,
    y: ((p.z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * size,
  };
}

/** Obrót strzałki gracza na płótnie (rad, zgodnie z ruchem wskazówek zegara; strzałka narysowana grotem w górę). */
export function arrowRotation(yaw: number): number {
  return -yaw;
}
