import { rngStream } from "../../../core/rng";
import { anchorsFromFeatures } from "../../anchors";
import { FOREST_START_REGION } from "../../bounds";
import { fingerprintOf } from "../../fingerprint";
import { prepareWorld } from "../../pipeline";
import type { WorldBase } from "../../types";
import { generateHousesV1 } from "../v1/houses";
import { FOREST_START, planForest } from "./plan";

export const WORLD_GEN_V2 = 2;

/**
 * Generator świata v2 (zapisywalny): miasto identyczne jak w v1 (te same domy z tego samego strumienia RNG)
 * oraz kotwice lasu W1a/W1b. Odcisk obejmuje cały plan lasu (rzeka, ścieżki, strefy, punkty charakterystyczne),
 * więc dryf generatora lasu wykrywa weryfikacja zapisu.
 */
export function generateWorldV2(seed: number): WorldBase {
  const prepared = prepareWorld({ regions: [FOREST_START_REGION], plan: planForest }, seed, WORLD_GEN_V2);
  const { plan, features } = prepared;
  const planDigest = fingerprintOf({
    terrain: plan.terrain,
    pois: plan.pois ?? [],
    zones: plan.zones ?? [],
    barriers: plan.barriers,
    passages: plan.passages,
  });
  return {
    genVersion: WORLD_GEN_V2,
    seed: seed >>> 0,
    houses: generateHousesV1(rngStream(seed, "houses")),
    forest: { anchors: anchorsFromFeatures(features, FOREST_START), planDigest },
  };
}
