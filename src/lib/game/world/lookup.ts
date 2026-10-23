import { FOREST_START_REGION, parseObjectId, regionKey } from "./bounds";
import { anchorsFromFeatures } from "./anchors";
import { bridgeRailBoxes, planBridge, type BridgeLayout } from "./bridgeLayout";
import { chestCollider, chestPlacements, type ChestPlacement } from "./chests";
import { createForest, type ForestSector, type ForestWorld } from "./generators/v2/forest";
import { PRO_OPTIONS } from "./generators/v2/pro";
import { DUNE_TRAIL_REACH_V4 } from "./generators/v4/world";
import type { WorldRef } from "./types";
import { FOREST_START } from "./generators/v2/plan";
import { makeObject, type WorldObject } from "./objects";
import { WalkWorld } from "./walk";

const FOREST_CACHE_LIMIT = 3;
const forests = new Map<string, ForestWorld>();
const gameplayForests = new Map<string, ForestWorld>();
const byId = new WeakMap<ForestSector, Map<string, WorldObject>>();

/**
 * Świat lasu wskazywany tożsamością `WorldRef` (seed + wersja generatora). Sam numer to skrót dla generatora v2 (zamrożone
 * zapisy i testy); gra przekazuje zawsze `state.world` (seed i `genVersion`).
 */
export type WorldKey = number | WorldRef;

export function worldRefOf(key: WorldKey): WorldRef {
  return typeof key === "number" ? { seed: key >>> 0, genVersion: 2 } : { seed: key.seed >>> 0, genVersion: key.genVersion };
}

const cacheKey = (ref: WorldRef) => `${ref.genVersion}:${ref.seed}`;

function build(ref: WorldRef, layers: "gameplay" | "all"): ForestWorld {
  if (ref.genVersion >= 3) return createForest(ref.seed, { pro: PRO_OPTIONS, layers, duneTrailReach: ref.genVersion >= 4 ? DUNE_TRAIL_REACH_V4 : undefined });
  return createForest(ref.seed, layers === "all" ? {} : { layers });
}

function cached(map: Map<string, ForestWorld>, key: WorldKey, layers: "gameplay" | "all"): ForestWorld {
  const ref = worldRefOf(key);
  const id = cacheKey(ref);
  const hit = map.get(id);
  if (hit) {
    map.delete(id);
    map.set(id, hit);
    return hit;
  }
  const forest = build(ref, layers);
  map.set(id, forest);
  if (map.size > FOREST_CACHE_LIMIT) map.delete(map.keys().next().value as string);
  return forest;
}

/** Las z wszystkimi warstwami (także kosmetyczną), do renderowania; liczony leniwie i trzymany w małej pamięci podręcznej. */
export function forestOf(key: WorldKey): ForestWorld {
  return cached(forests, key, "all");
}

/**
 * Las tylko z warstwą autorytatywną (drzewa i skały, teren, plan): do kolizji, pozyskiwania, skrzyń, mostu i walidacji pozycji.
 * ID, pozycje i kolizje są takie same jak w `forestOf`, a generowanie jest szybsze (to samo będzie liczył serwer).
 */
export function authoritativeForestOf(key: WorldKey): ForestWorld {
  return cached(gameplayForests, key, "gameplay");
}

/**
 * Obiekt lasu o danym ID albo null: ID jest parsowane do sektora i szukane tylko w nim, więc zmyślony lub
 * obcy identyfikator nigdy nie wskazuje na obiekt.
 */
export function forestObject(key: WorldKey, id: string): WorldObject | null {
  const parsed = parseObjectId(id);
  if (!parsed || parsed.regionKey !== regionKey(FOREST_START_REGION)) return null;
  const forest = authoritativeForestOf(key);
  const { nx, nz } = forest.sectorGrid;
  if (parsed.ix >= nx || parsed.iz >= nz) return null;
  const sector = forest.sector(parsed.ix, parsed.iz);
  let index = byId.get(sector);
  if (!index) {
    index = new Map(sector.objects.map((o) => [o.id, o]));
    byId.set(sector, index);
  }
  return index.get(id) ?? null;
}

const walks = new WeakMap<ForestWorld, WalkWorld>();

/**
 * Świat chodzenia po całym lesie: wszystkie collidery (drzewa i skały), bariery (rzeka) i przejścia (most po fladze
 * `bridge.built`). Cały las ma ok. 2000 colliderów, więc kolizje nie zależą od streamingu sektorów renderowania.
 */
export function forestWalkOf(key: WorldKey): WalkWorld {
  const forest = authoritativeForestOf(key);
  const hit = walks.get(forest);
  if (hit) return hit;
  const colliders: WorldObject[] = [];
  for (const sector of forest.allSectors()) colliders.push(...sector.colliders);
  for (const chest of forestChestsOf(key)) colliders.push(chestCollider(chest));
  const walk = new WalkWorld({
    regions: [forest.region],
    terrain: forest.terrain,
    objects: colliders,
    barriers: forest.plan.barriers,
    passages: forest.plan.passages,
    cellSize: 10,
  });
  walks.set(forest, walk);
  return walk;
}

const chestCache = new WeakMap<ForestWorld, ChestPlacement[]>();

/** Ustawienie trzech skrzyń questa w lesie danego seeda (kotwice W1b, wysokość z terenu, obrót); wynik jest buforowany. */
export function forestChestsOf(key: WorldKey): readonly ChestPlacement[] {
  const forest = authoritativeForestOf(key);
  let hit = chestCache.get(forest);
  if (!hit) {
    hit = chestPlacements(forest);
    chestCache.set(forest, hit);
  }
  return hit;
}

const harvestedColliders = new WeakMap<WalkWorld, Map<string, WorldObject>>();

/**
 * Zgrywa kolizje z listą pozyskanych obiektów (źródłem prawdy jest stan gry): usuwa colliderów pozyskanych drzew i skał,
 * a przywraca te, których nie ma na liście (świat chodzenia jest buforowany między sesjami tego samego seeda).
 */
export function syncHarvestedColliders(key: WorldKey, harvested: readonly string[]): void {
  const walk = forestWalkOf(key);
  let removed = harvestedColliders.get(walk);
  if (!removed) {
    removed = new Map();
    harvestedColliders.set(walk, removed);
  }
  const want = new Set(harvested);
  for (const [id, obj] of [...removed]) {
    if (!want.has(id)) {
      walk.addObject(obj);
      removed.delete(id);
    }
  }
  for (const id of want) {
    if (removed.has(id)) continue;
    const obj = forestObject(key, id);
    if (!obj?.collider) continue;
    if (walk.removeObject(id)) removed.set(id, obj);
  }
}

const bridgeLayouts = new WeakMap<ForestWorld, BridgeLayout>();

/** Układ mostu dla lasu danego seeda (lądowiska z kotwic questa, wysokość z `terrain.height`); wynik jest buforowany. */
export function forestBridgeOf(key: WorldKey): BridgeLayout {
  const forest = authoritativeForestOf(key);
  let hit = bridgeLayouts.get(forest);
  if (!hit) {
    const anchors = anchorsFromFeatures(forest.features, FOREST_START);
    hit = planBridge({ west: anchors.bridge.west, east: anchors.bridge.east }, (x, z) => forest.terrain.height(x, z));
    bridgeLayouts.set(forest, hit);
  }
  return hit;
}

const railObjects = new WeakMap<WalkWorld, WorldObject[]>();

/**
 * Zgrywa uproszczone collidery poręczy mostu z flagą `bridge.built` (źródłem prawdy jest stan gry): po zbudowaniu
 * dwa prostokąty wzdłuż krawędzi pokładu (nie geometria GLB), przed zbudowaniem żadnych. Samo przejście przez rzekę
 * (otwarcie bariery) robi `passage.bridge` z generatora; poręcze tylko nie pozwalają zejść z pokładu na odcinku nad brzegiem.
 */
export function syncBridgeColliders(key: WorldKey, built: boolean): void {
  const walk = forestWalkOf(key);
  const current = railObjects.get(walk);
  if (built && !current) {
    const objects = bridgeRailBoxes(forestBridgeOf(key)).map((b) =>
      makeObject({
        id: b.id,
        kind: "bridge_rail",
        x: b.x,
        z: b.z,
        y: authoritativeForestOf(key).terrain.height(b.x, b.z),
        yaw: b.yaw,
        collider: { shape: "box", halfX: b.halfX, halfZ: b.halfZ, yaw: b.yaw },
        tags: ["bridge"],
      }),
    );
    for (const o of objects) walk.addObject(o);
    railObjects.set(walk, objects);
  } else if (!built && current) {
    for (const o of current) walk.removeObject(o.id);
    railObjects.delete(walk);
  }
}
