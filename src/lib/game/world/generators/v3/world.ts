import { rngStream } from "../../../core/rng";
import { anchorsFromFeatures } from "../../anchors";
import { FOREST_START_REGION } from "../../bounds";
import { fingerprintOf } from "../../fingerprint";
import { prepareWorld } from "../../pipeline";
import type { WorldBase } from "../../types";
import { generateHousesV1 } from "../v1/houses";
import { FOREST_GEN_VERSION } from "../v2/forest";
import { FOREST_START, planForest } from "../v2/plan";
import { PRO_OPTIONS, type ProOptions } from "../v2/pro";
import { QUADRANT_IDS } from "../v2/geometry";

export const WORLD_GEN_V3 = 3;

/**
 * Odcisk WARSTWY AUTORYTATYWNEJ lasu Pro: wyłącznie dane, od których zależy to, co wspólne dla wszystkich graczy i serwera
 * (teren z wydmami, drzewa, drzewa stare, skały z formacjami: pozycje, kolizje, ID, skale). Dane kosmetyczne (trawa, kwiaty,
 * paprocie, krzewy, grzyby, płatki, kamyki, bruk, kolory, pęknięcia, skale widoku) celowo NIE wchodzą do odcisku: można je stroić
 * bez unieważniania zapisów i światów serwera. Zmiana któregokolwiek pola poniżej = nowa wersja świata.
 */
export function gameplayDigest(pro: ProOptions = PRO_OPTIONS): string {
  const layout = pro.quadrants;
  const profiles = QUADRANT_IDS.map((id) => {
    const p = layout.profiles[id];
    return {
      id: p.id,
      density: { tree: p.density.tree, ancient: p.density.ancient, rock: p.density.rock },
      mix: { tree: p.mix.tree, rock: p.mix.rock },
      pro: { tree: p.pro?.tree ?? {}, rockBig: p.pro?.rockBig ?? 0, rockDesert: p.pro?.rockDesert ?? 0, formations: p.pro?.formations ?? 0 },
    };
  });
  const species = pro.catalog
    .filter((s) => s.layer === "tree" || s.layer === "ancient" || s.layer === "rock")
    .map((s) => ({ model: s.model, group: s.group, collider: s.collider, crown: s.crown, footprint: s.footprint, scale: s.scale }));
  return fingerprintOf({
    quadrants: { seamX: layout.seamX, seamZ: layout.seamZ, feather: layout.feather, drop: layout.dropZoneKinds, profiles },
    rocks: pro.tuning?.rocks ?? null,
    dunes: pro.tuning?.dunes ?? null,
    species,
  });
}

/**
 * Generator świata v3 (zapisywalny): miasto i plan lasu identyczne jak w v2 (te same kotwice questa), a las ma roślinność i
 * strefy z paczki Pro (`ForestOptions.pro`). Plan i teren bazowy liczone są wersją układu lasu (`FOREST_GEN_VERSION`), więc
 * kotwice są bit w bit takie jak w v2. Odcisk obejmuje plan oraz `gameplayDigest`.
 */
export function generateWorldV3(seed: number): WorldBase {
  const prepared = prepareWorld({ regions: [FOREST_START_REGION], plan: planForest }, seed, FOREST_GEN_VERSION);
  const { plan, features } = prepared;
  const planDigest = fingerprintOf({
    terrain: plan.terrain,
    pois: plan.pois ?? [],
    zones: plan.zones ?? [],
    barriers: plan.barriers,
    passages: plan.passages,
  });
  return {
    genVersion: WORLD_GEN_V3,
    seed: seed >>> 0,
    houses: generateHousesV1(rngStream(seed, "houses")),
    forest: { anchors: anchorsFromFeatures(features, FOREST_START), planDigest: fingerprintOf({ plan: planDigest, gameplay: gameplayDigest() }) },
  };
}
