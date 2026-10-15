import { FOREST_START_REGION } from "../world/bounds";
import { FOREST_RADIUS } from "./constants";
import type { ForestPose } from "./state";

const EDGE_MARGIN = 1;
const EPS = 1e-6;

function poseFields(value: unknown): ForestPose | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, z, yaw } = value as Record<string, unknown>;
  if (typeof x !== "number" || typeof z !== "number" || typeof yaw !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return null;
  if (Math.abs(yaw) > 100) return null;
  return { x, z, yaw };
}

/** Pozycja w lesie W1 (region 300 x 300 m): wewnątrz granic z marginesem. */
export function isForestPose(value: unknown): value is ForestPose {
  const p = poseFields(value);
  if (!p) return false;
  const b = FOREST_START_REGION.bounds;
  return p.x >= b.minX + EDGE_MARGIN && p.x <= b.maxX - EDGE_MARGIN && p.z >= b.minZ + EDGE_MARGIN && p.z <= b.maxZ - EDGE_MARGIN;
}

/** Pozycja w dawnym, okrągłym lesie prototypowym (SaveV1). */
export function isLegacyForestPose(value: unknown): value is ForestPose {
  const p = poseFields(value);
  return p !== null && Math.hypot(p.x, p.z) <= FOREST_RADIUS - EDGE_MARGIN + EPS;
}

/** Kąt sprowadzony do przedziału (-π, π]. */
export function wrapYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let a = yaw % twoPi;
  if (a > Math.PI) a -= twoPi;
  if (a <= -Math.PI) a += twoPi;
  return a;
}
