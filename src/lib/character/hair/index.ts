import type { HeadMetrics } from "../head";
import type { MeshData } from "../meshData";
import { buildHair01 } from "./hair01";
import { buildHair02 } from "./hair02";

export { buildHair01, buildHair02 };
export { onHead } from "./headSpace";

/** Generatory fryzur proceduralnych (klucz `generator` w rejestrze). */
export const HAIR_GENERATORS: Readonly<Record<string, (head: HeadMetrics) => MeshData>> = {
  hair01: buildHair01,
  hair02: buildHair02,
};
