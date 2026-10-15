import type { WorldObject } from "@/lib/game/world/objects";
import type { Placement } from "./instancing";

/**
 * Adapter świata lasu -> instancing V1: zamienia obiekty generatora na pozycje instancji pogrupowane wg modelu
 * (`rodzaj.wariant`, np. `tree.common.3`). Bez Three.js w czasie działania, więc da się go testować i cache'ować
 * per sektor; renderer dostaje gotowe tablice i nie podejmuje żadnych decyzji o rozmieszczeniu.
 */

/** Skały lekko zagłębiamy w terenie (część wysokości modelu), żeby nie wisiały na nierównościach. */
export const ROCK_SINK = 0.1;

export function objectModelId(o: Pick<WorldObject, "kind" | "variant">): string {
  return o.variant ? `${o.kind}.${o.variant}` : o.kind;
}

export function objectToPlacement(o: WorldObject): Placement {
  const scale = o.scaleXYZ ?? o.scale ?? 1;
  const sy = typeof scale === "number" ? scale : scale[1];
  const sink = o.kind === "rock" ? ROCK_SINK * sy : 0;
  return {
    x: o.x,
    y: o.y - sink,
    z: o.z,
    yaw: o.yaw,
    scale,
    tiltX: o.tilt?.[0],
    tiltZ: o.tilt?.[1],
  };
}

export function groupPlacements(objects: readonly WorldObject[]): Map<string, Placement[]> {
  const out = new Map<string, Placement[]>();
  for (const o of objects) {
    const id = objectModelId(o);
    const list = out.get(id);
    if (list) list.push(objectToPlacement(o));
    else out.set(id, [objectToPlacement(o)]);
  }
  return out;
}

const cache = new WeakMap<object, ReadonlyMap<string, Placement[]>>();

/**
 * Pozycje instancji dla sektora (obiekt z `byModel`), liczone raz na sektor. Klucz to sam obiekt sektora, więc
 * zwolnienie sektora zwalnia też cache.
 */
export function sectorPlacements(sector: { byModel: ReadonlyMap<string, readonly WorldObject[]> }): ReadonlyMap<string, Placement[]> {
  const hit = cache.get(sector);
  if (hit) return hit;
  const out = new Map<string, Placement[]>();
  for (const [model, objects] of sector.byModel) out.set(model, objects.map(objectToPlacement));
  cache.set(sector, out);
  return out;
}
