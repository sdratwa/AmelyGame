import { FOREST_START_REGION, parseObjectId, regionKey } from "./bounds";
import { createForest, type ForestSector, type ForestWorld } from "./generators/v2/forest";
import type { WorldObject } from "./objects";

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
