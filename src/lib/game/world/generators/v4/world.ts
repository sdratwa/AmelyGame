import { fingerprintOf } from "../../fingerprint";
import type { WorldBase } from "../../types";
import { generateWorldV3 } from "../v3/world";

export const WORLD_GEN_V4 = 4;
export const DUNE_TRAIL_REACH_V4 = 11;

/** Plan i kotwice pozostają z v3; wersja odróżnia poprawioną geometrię wydm. */
export function generateWorldV4(seed: number): WorldBase {
  const base = generateWorldV3(seed);
  return {
    ...base,
    genVersion: WORLD_GEN_V4,
    forest: base.forest && {
      ...base.forest,
      planDigest: fingerprintOf({ previous: base.forest.planDigest, duneTrailReach: DUNE_TRAIL_REACH_V4 }),
    },
  };
}
