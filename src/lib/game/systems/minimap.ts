import { QUEST_BY_ID } from "../content/quests";
import type { ChestId, QuestId } from "../core/ids";
import { rngStream } from "../core/rng";
import type { GameState } from "../core/state";
import { FOREST_START_REGION } from "../world/bounds";
import { FOREST_START } from "../world/generators/v2";
import { authoritativeForestOf, forestChestsOf, type WorldKey } from "../world/lookup";
import { questProgress } from "./quests";

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

export function buildMinimapModel(world: WorldKey): MinimapModel {
  const forest = authoritativeForestOf(world);
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

/**
 * Orientacyjny obszar na minimapie: koło, w którym leży cel, ale jego środek jest przesunięty (nigdy dokładna pozycja).
 * `chest` jest ustawione tylko dla obszarów skrzyń.
 */
export type SearchAreaKind = "chest" | "bridge_site" | "crossing" | "beyond";
export type SearchArea = { kind: SearchAreaKind; chest: ChestId | null; x: number; z: number; r: number };

export const SEARCH_AREA_RADIUS = 42;
/** Miejsce budowy jest dużo mniejszym celem niż polana ze skrzynią: mniejsze koło, wciąż z przesuniętym środkiem. */
export const BRIDGE_AREA_RADIUS = 26;
/** Obszar odkrycia za rzeką po zbudowaniu mostu. */
export const BEYOND_AREA_RADIUS = 40;
/** Znacznik samego mostu po jego zbudowaniu (most jest już widoczny w świecie, więc zaznaczamy go dokładnie). */
export const CROSSING_MARK_RADIUS = 9;
/** Przesunięcie środka koła względem celu jako ułamek promienia: nigdy w środku, nigdy blisko krawędzi. */
export const SEARCH_AREA_OFFSET: readonly [number, number] = [0.2, 0.55];

/** Środek orientacyjnego koła wokół celu `at` (deterministyczny z seeda i klucza). */
function offsetCenter(seed: number, key: string, at: MapPoint, radius: number): MapPoint {
  const rng = rngStream(seed, `minimap.hint.${key}`);
  const angle = rng() * Math.PI * 2;
  const frac = SEARCH_AREA_OFFSET[0] + rng() * (SEARCH_AREA_OFFSET[1] - SEARCH_AREA_OFFSET[0]);
  const b = FOREST_START_REGION.bounds;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    x: clamp(at.x + Math.cos(angle) * frac * radius, b.minX, b.maxX),
    z: clamp(at.z + Math.sin(angle) * frac * radius, b.minZ, b.maxZ),
  };
}

/** Obszar poszukiwań jednej skrzyni (deterministyczny z seeda); to jedyna informacja o jej położeniu na mapie. */
export function searchAreaFor(seed: number, chest: ChestId, at: MapPoint): SearchArea {
  return { kind: "chest", chest, ...offsetCenter(seed, chest, at, SEARCH_AREA_RADIUS), r: SEARCH_AREA_RADIUS };
}

/**
 * Obszary minimapy zgodne z BIEŻĄCYM etapem aktywnego zadania (dane etapu `areas`): skrzynie, których przedmiot nie
 * został zdobyty, a skrzynia nie była otwarta; miejsce budowy dopiero po zebraniu materiałów; po zbudowaniu mostu jego
 * znacznik i obszar za rzeką. Przyszłe etapy niczego nie pokazują. Nigdy nie zwraca dokładnych współrzędnych celów
 * (poza gotowym, widocznym mostem).
 */
export function searchAreas(state: GameState): SearchArea[] {
  if (!state.world) return [];
  const seed = state.world.seed;
  const world = { seed, genVersion: state.world.genVersion };
  const out: SearchArea[] = [];
  for (const questId of Object.keys(state.quests.accepted) as QuestId[]) {
    if (state.quests.completed[questId]) continue;
    const def = QUEST_BY_ID.get(questId);
    const progress = def ? questProgress(state, questId) : null;
    if (!def || !progress || progress.status !== "active") continue;
    const stage = def.stages[progress.currentStage];
    if (!stage) continue;
    const anchors = state.world.anchors;
    for (const area of stage.areas) {
      if (area.kind === "chest") {
        if ((state.ledger.gained[area.item] ?? 0) >= 1 || state.chests[area.chest]?.opened) continue;
        const placement = forestChestsOf(world).find((c) => c.id === area.chest);
        if (placement && !out.some((a) => a.chest === area.chest)) out.push(searchAreaFor(seed, area.chest, placement));
      } else if (area.kind === "bridge_site" && anchors) {
        out.push({ kind: "bridge_site", chest: null, ...offsetCenter(seed, "bridge_site", anchors.bridge, BRIDGE_AREA_RADIUS), r: BRIDGE_AREA_RADIUS });
      } else if (area.kind === "crossing" && anchors) {
        out.push({ kind: "crossing", chest: null, x: anchors.bridge.x, z: anchors.bridge.z, r: CROSSING_MARK_RADIUS });
        out.push({ kind: "beyond", chest: null, ...offsetCenter(seed, "beyond", anchors.beyond, BEYOND_AREA_RADIUS), r: BEYOND_AREA_RADIUS });
      }
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
