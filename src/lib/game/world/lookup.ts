import { FOREST_START_REGION, parseObjectId, regionKey } from "./bounds";
import { anchorsFromFeatures } from "./anchors";
import { bridgeRailBoxes, planBridge, type BridgeLayout } from "./bridgeLayout";
import { chestCollider, chestPlacements, type ChestPlacement } from "./chests";
import { createForest, type ForestSector, type ForestWorld } from "./generators/v2/forest";
import { FOREST_START } from "./generators/v2/plan";
import { makeObject, type WorldObject } from "./objects";
import { WalkWorld } from "./walk";

const FOREST_CACHE_LIMIT = 3;
const forests = new Map<number, ForestWorld>();
const byId = new WeakMap<ForestSector, Map<string, WorldObject>>();

/** Las danego seeda (generator v2), liczony leniwie i trzymany w małej pamięci podręcznej. */
export function forestOf(seed: number): ForestWorld {
  const key = seed >>> 0;
  const hit = forests.get(key);
  if (hit) {
    forests.delete(key);
    forests.set(key, hit);
    return hit;
  }
  const forest = createForest(key);
  forests.set(key, forest);
  if (forests.size > FOREST_CACHE_LIMIT) forests.delete(forests.keys().next().value as number);
  return forest;
}

/**
 * Obiekt lasu o danym ID albo null: ID jest parsowane do sektora i szukane tylko w nim, więc zmyślony lub
 * obcy identyfikator nigdy nie wskazuje na obiekt.
 */
export function forestObject(seed: number, id: string): WorldObject | null {
  const parsed = parseObjectId(id);
  if (!parsed || parsed.regionKey !== regionKey(FOREST_START_REGION)) return null;
  const forest = forestOf(seed);
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
export function forestWalkOf(seed: number): WalkWorld {
  const forest = forestOf(seed);
  const hit = walks.get(forest);
  if (hit) return hit;
  const colliders: WorldObject[] = [];
  for (const sector of forest.allSectors()) colliders.push(...sector.colliders);
  for (const chest of forestChestsOf(seed)) colliders.push(chestCollider(chest));
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
export function forestChestsOf(seed: number): readonly ChestPlacement[] {
  const forest = forestOf(seed);
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
export function syncHarvestedColliders(seed: number, harvested: readonly string[]): void {
  const walk = forestWalkOf(seed);
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
    const obj = forestObject(seed, id);
    if (!obj?.collider) continue;
    if (walk.removeObject(id)) removed.set(id, obj);
  }
}

const bridgeLayouts = new WeakMap<ForestWorld, BridgeLayout>();

/** Układ mostu dla lasu danego seeda (lądowiska z kotwic questa, wysokość z `terrain.height`); wynik jest buforowany. */
export function forestBridgeOf(seed: number): BridgeLayout {
  const forest = forestOf(seed);
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
export function syncBridgeColliders(seed: number, built: boolean): void {
  const walk = forestWalkOf(seed);
  const current = railObjects.get(walk);
  if (built && !current) {
    const objects = bridgeRailBoxes(forestBridgeOf(seed)).map((b) =>
      makeObject({
        id: b.id,
        kind: "bridge_rail",
        x: b.x,
        z: b.z,
        y: forestOf(seed).terrain.height(b.x, b.z),
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
