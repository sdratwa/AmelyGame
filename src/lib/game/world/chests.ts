import type { ChestId } from "../core/ids";
import { hashString } from "../core/rng";
import type { ForestWorld } from "./generators/v2/forest";
import { FOREST_START } from "./generators/v2/plan";
import { makeObject, type WorldObject } from "./objects";

/** Skrzynie questa leżą na kotwicach z generatora; tu wyliczamy tylko ustawienie na terenie (nie zmienia świata ani odcisku). */
export type ChestPlacement = {
  id: ChestId;
  x: number;
  y: number;
  z: number;
  /** Obrót wokół osi Y (rad); przód skrzyni (zamek) jest po stronie +Z modelu. */
  yaw: number;
};

/** Połowy wymiarów podstawy skrzyni po skali świata (model 1,19 x 0,9 m * 0,85, z zapasem na fazy). */
export const CHEST_HALF_X = 0.5;
export const CHEST_HALF_Z = 0.4;

const CHEST_POIS: readonly string[] = ["poi.chest_pickaxe", "poi.chest_saw", "poi.chest_blueprint"];

/**
 * Pozycje skrzyń: dokładnie kotwice W1b. Obrót: przodem w stronę punktu wejścia do lasu (skąd gracz przychodzi),
 * z deterministycznym, niewielkim rozrzutem zależnym od identyfikatora. Wysokość: najniższy punkt terenu pod
 * podstawą, żeby skrzynia nie wisiała nad ziemią (na łagodnym zboczu górna krawędź lekko wchodzi w teren).
 */
export function chestPlacements(forest: ForestWorld): ChestPlacement[] {
  const out: ChestPlacement[] = [];
  for (const poiId of CHEST_POIS) {
    const poi = forest.features.poi(poiId);
    if (!poi) throw new Error(`Brak punktu skrzyni ${poiId}`);
    const id = String(poi.props?.chestId) as ChestId;
    const toStart = Math.atan2(FOREST_START.x - poi.x, FOREST_START.z - poi.z);
    const jitter = ((hashString(`${forest.seed}:${id}:yaw`) / 4294967296) * 2 - 1) * 0.35;
    const yaw = toStart + jitter;
    out.push({ id, x: poi.x, z: poi.z, yaw, y: footprintGround(forest, poi.x, poi.z, yaw) });
  }
  return out;
}

function footprintGround(forest: ForestWorld, x: number, z: number, yaw: number): number {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  let min = forest.terrain.height(x, z);
  for (const [lx, lz] of [
    [CHEST_HALF_X, CHEST_HALF_Z],
    [-CHEST_HALF_X, CHEST_HALF_Z],
    [CHEST_HALF_X, -CHEST_HALF_Z],
    [-CHEST_HALF_X, -CHEST_HALF_Z],
  ]) {
    // Obrót lokalnego punktu o `yaw` wokół osi Y (ta sama konwencja co obrót obiektów w rendererze i colliderów).
    const wx = x + lx * cos + lz * sin;
    const wz = z - lx * sin + lz * cos;
    min = Math.min(min, forest.terrain.height(wx, wz));
  }
  return min;
}

/** Collider skrzyni (prostokąt obrócony jak model): gracz nie przechodzi przez skrzynię. */
export function chestCollider(p: ChestPlacement): WorldObject {
  return makeObject({
    id: `${p.id}#collider`,
    kind: "chest",
    x: p.x,
    z: p.z,
    y: p.y,
    yaw: p.yaw,
    collider: { shape: "box", halfX: CHEST_HALF_X, halfZ: CHEST_HALF_Z, yaw: p.yaw },
    tags: ["chest"],
  });
}
