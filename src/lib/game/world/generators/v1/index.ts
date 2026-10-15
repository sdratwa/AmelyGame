/** ZAMROŻONE (generator świata v1) – patrz houses.ts. */
import { rngStream } from "../../../core/rng";
import type { WorldBase } from "../../types";
import { generateHousesV1 } from "./houses";

export function generateWorldV1(seed: number): WorldBase {
  return {
    genVersion: 1,
    seed,
    houses: generateHousesV1(rngStream(seed, "houses")),
  };
}
