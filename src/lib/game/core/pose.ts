import { FOREST_RADIUS } from "./constants";
import type { ForestPose } from "./state";

const EDGE_MARGIN = 1;
const EPS = 1e-6;

export function isForestPose(value: unknown): value is ForestPose {
  if (typeof value !== "object" || value === null) return false;
  const { x, z, yaw } = value as Record<string, unknown>;
  if (typeof x !== "number" || typeof z !== "number" || typeof yaw !== "number") return false;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return false;
  if (Math.abs(yaw) > 100) return false;
  return Math.hypot(x, z) <= FOREST_RADIUS - EDGE_MARGIN + EPS;
}

/** Kąt sprowadzony do przedziału (-π, π]. */
export function wrapYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let a = yaw % twoPi;
  if (a > Math.PI) a -= twoPi;
  if (a <= -Math.PI) a += twoPi;
  return a;
}
