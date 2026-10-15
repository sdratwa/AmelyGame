import type { Bounds } from "./bounds";

export type Point = { x: number; z: number };
/** Punkt wstęgi: `w` to półszerokość w tym punkcie (między punktami interpolowana liniowo). */
export type RibbonPoint = Point & { w: number };

/**
 * Kształty 2D na płaszczyźnie x-z: strefy, bariery, przejścia. `band` to pas o stałej szerokości wokół łamanej
 * (ścieżka), `ribbon` to pas o zmiennej szerokości (rzeka).
 */
export type Shape =
  | { type: "circle"; x: number; z: number; r: number }
  | ({ type: "rect" } & Bounds)
  | { type: "band"; points: readonly Point[]; halfWidth: number }
  | { type: "ribbon"; points: readonly RibbonPoint[] };

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

/** Odległość punktu od brzegu wstęgi (ujemna wewnątrz); najbliższy segment wybierany geometrycznie. */
export function ribbonGap(shape: Extract<Shape, { type: "ribbon" }>, x: number, z: number): number {
  const pts = shape.points;
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.sqrt((x - pts[0].x) ** 2 + (z - pts[0].z) ** 2) - pts[0].w;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - a.x) * dx + (z - a.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx - x;
    const cz = a.z + t * dz - z;
    const gap = Math.sqrt(cx * cx + cz * cz) - (a.w + (b.w - a.w) * t);
    if (gap < best) best = gap;
  }
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
    case "ribbon":
      return ribbonGap(shape, x, z) <= 0;
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
    case "ribbon":
      return ribbonGap(shape, x, z) <= r;
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
    case "ribbon": {
      const xs = shape.points.map((p) => p.x);
      const zs = shape.points.map((p) => p.z);
      const h = Math.max(...shape.points.map((p) => p.w));
      return { minX: Math.min(...xs) - h, minZ: Math.min(...zs) - h, maxX: Math.max(...xs) + h, maxZ: Math.max(...zs) + h };
    }
  }
}
