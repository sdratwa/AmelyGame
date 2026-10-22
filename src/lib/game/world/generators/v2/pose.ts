import type { ForestPose } from "../../../core/state";
import { FOREST_START_REGION } from "../../bounds";
import { authoritativeForestOf, forestWalkOf, type WorldKey } from "../../lookup";
import type { ForestWorld } from "./forest";
import { MAX_TERRAIN_TAN } from "./validate";
import { BRIDGE_FLAG, FOREST_START } from "./plan";

const BODY_RADIUS = 0.5;
const BANK_MARGIN = 1.5;

/** Bezpieczny punkt wejścia do lasu: start przy zachodnim skraju, twarzą na wschód (w stronę rzeki). */
export function forestEntryPose(): ForestPose {
  return { x: FOREST_START.x, z: FOREST_START.z, yaw: -Math.PI / 2 };
}

/**
 * Czy pozycja jest poprawna w lesie: w granicach regionu, na zachodnim brzegu rzeki (do czasu budowy mostu),
 * poza kolizjami i na łagodnym terenie.
 */
export function isValidForestPosition(forest: ForestWorld, x: number, z: number): boolean {
  const b = FOREST_START_REGION.bounds;
  if (![x, z].every(Number.isFinite)) return false;
  if (x < b.minX + 1 || x > b.maxX - 1 || z < b.minZ + 1 || z > b.maxZ - 1) return false;
  const river = forest.geometry.riverAt(z);
  if (x > river.x - river.w - BANK_MARGIN) return false;
  if (forest.geometry.waterGap(x, z) <= BANK_MARGIN) return false;
  const g = forest.terrain.gradient(x, z);
  if (Math.sqrt(g.dx * g.dx + g.dz * g.dz) > MAX_TERRAIN_TAN) return false;
  return forest.collidersNear(x, z, BODY_RADIUS).length === 0;
}

/** Po zbudowaniu mostu poprawna jest też pozycja na moście i na drugim brzegu: decyduje świat chodzenia z otwartym przejściem. */
function isValidPositionWithBridge(seed: WorldKey, x: number, z: number): boolean {
  const b = FOREST_START_REGION.bounds;
  if (![x, z].every(Number.isFinite)) return false;
  if (x < b.minX + 1 || x > b.maxX - 1 || z < b.minZ + 1 || z > b.maxZ - 1) return false;
  const open = { has: (flag: string) => flag === BRIDGE_FLAG };
  return forestWalkOf(seed).checkPoint(x, z, open) === null;
}

/** Pozycja z zapisu, jeśli jest poprawna w lesie danego seeda, w przeciwnym razie punkt wejścia. */
export function safeForestPose(seed: WorldKey, pose: ForestPose | null, bridgeBuilt = false): ForestPose {
  if (!pose) return forestEntryPose();
  if (isValidForestPosition(authoritativeForestOf(seed), pose.x, pose.z)) return { ...pose };
  if (bridgeBuilt && isValidPositionWithBridge(seed, pose.x, pose.z)) return { ...pose };
  return forestEntryPose();
}
