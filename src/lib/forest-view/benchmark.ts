import type { ForestWindow } from "./window";

export type BenchmarkPose = { x: number; z: number; yaw: number; pitch: number };
export type BenchmarkRoute = { points: { x: number; z: number; yaw: number }[]; length: number };

export const BENCHMARK_SECONDS = 30;
const SPEED = 2.4;
const SWEEP = 1.3;

/** Trasa testu FPS: odcinek głównej ścieżki w strefie chodzenia od punktu startu w obu kierunkach (bez kolizji z obiektami). */
export function buildBenchmarkRoute(win: ForestWindow): BenchmarkRoute {
  const main = win.forest.geometry.trails.find((t) => !t.stub) ?? null;
  const pts: { x: number; z: number }[] = [];
  if (main) {
    for (let i = 0; i + 1 < main.points.length; i++) {
      const p = main.points[i];
      const q = main.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.5));
      for (let k = 0; k < n; k++) pts.push({ x: p.x + ((q.x - p.x) * k) / n, z: p.z + ((q.z - p.z) * k) / n });
    }
  }
  const b = win.walkBounds;
  const inside = (p: { x: number; z: number }) => p.x > b.minX + 2 && p.x < b.maxX - 2 && p.z > b.minZ + 2 && p.z < b.maxZ - 2;
  let nearest = -1;
  let best = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - win.start.x, p.z - win.start.z);
    if (inside(p) && d < best) {
      best = d;
      nearest = i;
    }
  });
  const route: { x: number; z: number }[] = [];
  if (nearest >= 0 && best < 6) {
    let a = nearest;
    let c = nearest;
    while (a > 0 && inside(pts[a - 1]) && nearest - a < 24) a--;
    while (c < pts.length - 1 && inside(pts[c + 1]) && c - nearest < 24) c++;
    for (let i = a; i <= c; i++) route.push(pts[i]);
  }
  if (route.length < 8) {
    route.length = 0;
    for (let a = 0; a <= 32; a++) {
      const t = (a / 32) * Math.PI * 2;
      route.push({ x: win.start.x + 4 * Math.cos(t) - 4, z: win.start.z + 4 * Math.sin(t) });
    }
  }
  const points = route.map((p, i) => {
    const q = route[Math.min(route.length - 1, i + 1)];
    const r = route[Math.max(0, i - 1)];
    return { x: p.x, z: p.z, yaw: Math.atan2(-(q.x - r.x), -(q.z - r.z)) };
  });
  let length = 0;
  for (let i = 0; i + 1 < points.length; i++) length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return { points, length: Math.max(length, 0.01) };
}

/** Poza kamery w chwili `t` (s): marsz tam i z powrotem po trasie, głowa omiata ok. +-75 stopni (sprawdza frustum culling). */
export function benchmarkPose(route: BenchmarkRoute, t: number): BenchmarkPose {
  const span = route.length;
  const cycle = (t * SPEED) % (2 * span);
  const s = cycle <= span ? cycle : 2 * span - cycle;
  const reverse = cycle > span;
  let acc = 0;
  const pts = route.points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    if (acc + seg >= s || i === pts.length - 2) {
      const f = seg > 0 ? Math.min(1, Math.max(0, (s - acc) / seg)) : 0;
      const x = pts[i].x + (pts[i + 1].x - pts[i].x) * f;
      const z = pts[i].z + (pts[i + 1].z - pts[i].z) * f;
      const base = pts[i].yaw + (reverse ? Math.PI : 0);
      return { x, z, yaw: base + SWEEP * Math.sin(t * 0.9), pitch: -0.05 + 0.08 * Math.sin(t * 0.6) };
    }
    acc += seg;
  }
  return { x: pts[0].x, z: pts[0].z, yaw: pts[0].yaw, pitch: 0 };
}
