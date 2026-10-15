import type { Bounds } from "./bounds";

export type Point = { x: number; z: number };

/** Kształty 2D na płaszczyźnie x-z: strefy, bariery, przejścia. `band` to pas wokół łamanej (rzeka, ścieżka). */
export type Shape =
  | { type: "circle"; x: number; z: number; r: number }
  | ({ type: "rect" } & Bounds)
  | { type: "band"; points: readonly Point[]; halfWidth: number };

function distToSegmentSq(px: number, pz: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - a.x) * dx + (pz - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx - px;
  const cz = a.z + t * dz - pz;
  return cx * cx + cz * cz;
}

function bandDistSq(shape: Extract<Shape, { type: "band" }>, x: number, z: number): number {
  const pts = shape.points;
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return (x - pts[0].x) ** 2 + (z - pts[0].z) ** 2;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, distToSegmentSq(x, z, pts[i], pts[i + 1]));
  return best;
}

export function shapeContains(shape: Shape, x: number, z: number): boolean {
  switch (shape.type) {
    case "circle":
      return (x - shape.x) ** 2 + (z - shape.z) ** 2 <= shape.r * shape.r;
    case "rect":
      return x >= shape.minX && x <= shape.maxX && z >= shape.minZ && z <= shape.maxZ;
    case "band":
      return bandDistSq(shape, x, z) <= shape.halfWidth * shape.halfWidth;
  }
}

/** Czy koło (x, z, r) ma wspólny punkt z kształtem. */
export function shapeIntersectsCircle(shape: Shape, x: number, z: number, r: number): boolean {
  switch (shape.type) {
    case "circle":
      return (x - shape.x) ** 2 + (z - shape.z) ** 2 <= (shape.r + r) ** 2;
    case "rect": {
      const cx = Math.max(shape.minX, Math.min(shape.maxX, x));
      const cz = Math.max(shape.minZ, Math.min(shape.maxZ, z));
      return (x - cx) ** 2 + (z - cz) ** 2 <= r * r;
    }
    case "band":
      return bandDistSq(shape, x, z) <= (shape.halfWidth + r) ** 2;
  }
}

export function shapeBounds(shape: Shape): Bounds {
  switch (shape.type) {
    case "circle":
      return { minX: shape.x - shape.r, minZ: shape.z - shape.r, maxX: shape.x + shape.r, maxZ: shape.z + shape.r };
    case "rect":
      return { minX: shape.minX, minZ: shape.minZ, maxX: shape.maxX, maxZ: shape.maxZ };
    case "band": {
      const xs = shape.points.map((p) => p.x);
      const zs = shape.points.map((p) => p.z);
      const h = shape.halfWidth;
      return { minX: Math.min(...xs) - h, minZ: Math.min(...zs) - h, maxX: Math.max(...xs) + h, maxZ: Math.max(...zs) + h };
    }
  }
}
