import type { ForestWindow } from "./window";
import { FrameStats } from "./frameStats";

/**
 * Prototyp lasu Pro (`/dev/forest-pro`): środki czterech stref i trasa pomiarowa przez wszystkie strefy.
 * Układ ćwiartek: A (NW) jesienna łąka, B (SW) las iglasty, C (SE) pustynia, D (NE) mix; północ to mniejsze z.
 * Środki leżą ok. 60-70 m od szwu (0, 0), czyli w czystej strefie (pas przejścia kończy się 20 m od szwu), a rzeka
 * (x ok. 100) zostaje poza okręgiem pomiarowym.
 */
export type ProZoneId = "a" | "b" | "c" | "d";

export const PRO_ZONE_IDS: readonly ProZoneId[] = ["a", "b", "c", "d"];

export const PRO_ZONES: Readonly<Record<ProZoneId, { label: string; x: number; z: number }>> = {
  a: { label: "A: jesienna łąka (NW)", x: -70, z: -70 },
  b: { label: "B: las iglasty (SW)", x: -70, z: 70 },
  c: { label: "C: pustynia (SE)", x: 60, z: 70 },
  d: { label: "D: mix wszystkiego (NE)", x: 60, z: -70 },
};

const SECTOR_SIZE = 30;
const REGION_MIN = -150;

export function parseZoneParam(text: string | null | undefined): ProZoneId | null {
  const z = (text ?? "").toLowerCase();
  return (PRO_ZONE_IDS as readonly string[]).includes(z) ? (z as ProZoneId) : null;
}

/** Sektor (30 m) zawierający środek strefy; start gracza jest wybierany przez `pickStart` najbliżej jego środka. */
export function zoneSector(zone: ProZoneId): { ix: number; iz: number } {
  const c = PRO_ZONES[zone];
  return { ix: Math.floor((c.x - REGION_MIN) / SECTOR_SIZE), iz: Math.floor((c.z - REGION_MIN) / SECTOR_SIZE) };
}

export type TourLegId = ProZoneId | "road";

export type TourLeg = {
  id: TourLegId;
  label: string;
  points: { x: number; z: number; yaw: number }[];
  length: number;
  closed: boolean;
  speed: number;
  seconds: number;
};

export type TourPose = { x: number; z: number; yaw: number; pitch: number };

/** Czas (s) na początku każdego odcinka, który nie wchodzi do statystyk (doładowanie instancji, kompilacja shaderów). */
export const TOUR_WARMUP_SECONDS = 1.5;
const ZONE_SECONDS = 20;
const ZONE_SPEED = 5;
const ZONE_RADIUS = 26;
const ROAD_SPEED = 6;
const ROAD_MAX_SECONDS = 60;
const SWEEP = 1.1;

function withYaw(raw: { x: number; z: number }[], closed: boolean): { x: number; z: number; yaw: number }[] {
  const n = raw.length;
  return raw.map((p, i) => {
    const q = closed ? raw[(i + 1) % n] : raw[Math.min(n - 1, i + 1)];
    const r = closed ? raw[(i - 1 + n) % n] : raw[Math.max(0, i - 1)];
    return { x: p.x, z: p.z, yaw: Math.atan2(-(q.x - r.x), -(q.z - r.z)) };
  });
}

function lengthOf(points: readonly { x: number; z: number }[], closed: boolean): number {
  let len = 0;
  const n = points.length;
  for (let i = 0; i + 1 < n; i++) len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  if (closed && n > 1) len += Math.hypot(points[0].x - points[n - 1].x, points[0].z - points[n - 1].z);
  return Math.max(len, 0.01);
}

/** Droga główna od startu do mostu próbkowana co 0,5 m; null, gdy w planie nie ma ścieżki (testy). */
export function mainRoadPoints(win: ForestWindow): { x: number; z: number }[] | null {
  const trail = win.forest.geometry.trails.find((t) => t.id === "trail.main") ?? win.forest.geometry.trails.find((t) => !t.stub);
  if (!trail || trail.points.length < 2) return null;
  const src = trail.points[0].x <= trail.points[trail.points.length - 1].x ? trail.points : [...trail.points].reverse();
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i + 1 < src.length; i++) {
    const p = src[i];
    const q = src[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.5));
    for (let k = 0; k < n; k++) out.push({ x: p.x + ((q.x - p.x) * k) / n, z: p.z + ((q.z - p.z) * k) / n });
  }
  out.push({ x: src[src.length - 1].x, z: src[src.length - 1].z });
  return out;
}

/** Odcinki trasy: cztery okręgi w środkach stref (A, B, C, D) i na końcu przejście drogą główną (bruk) od startu do mostu. */
export function buildTourLegs(win: ForestWindow): TourLeg[] {
  const legs: TourLeg[] = [];
  for (const id of PRO_ZONE_IDS) {
    const c = PRO_ZONES[id];
    const raw: { x: number; z: number }[] = [];
    for (let k = 0; k < 72; k++) {
      const t = (k / 72) * Math.PI * 2;
      raw.push({ x: c.x + ZONE_RADIUS * Math.cos(t), z: c.z + ZONE_RADIUS * Math.sin(t) });
    }
    const points = withYaw(raw, true);
    legs.push({ id, label: c.label, points, length: lengthOf(points, true), closed: true, speed: ZONE_SPEED, seconds: ZONE_SECONDS });
  }
  const road = mainRoadPoints(win);
  if (road && road.length > 8) {
    const points = withYaw(road, false);
    const length = lengthOf(points, false);
    legs.push({ id: "road", label: "Droga główna (start do mostu)", points, length, closed: false, speed: ROAD_SPEED, seconds: Math.min(ROAD_MAX_SECONDS, length / ROAD_SPEED) });
  }
  return legs;
}

export function tourDuration(legs: readonly TourLeg[]): number {
  return legs.reduce((a, l) => a + l.seconds, 0);
}

/** Który odcinek trwa w chwili `t` (s od startu trasy) i ile sekund minęło od początku tego odcinka. */
export function tourLegAt(legs: readonly TourLeg[], t: number): { index: number; local: number } | null {
  let acc = 0;
  for (let i = 0; i < legs.length; i++) {
    if (t < acc + legs[i].seconds) return { index: i, local: t - acc };
    acc += legs[i].seconds;
  }
  return null;
}

/** Poza kamery na odcinku po `local` sekundach: marsz ze stałą prędkością, głowa omiata +-63 stopnie (sprawdza frustum culling). */
export function tourPose(leg: TourLeg, local: number): TourPose {
  const pts = leg.points;
  const n = pts.length;
  const total = leg.length;
  const dist = leg.speed * local;
  const s = leg.closed ? dist % total : Math.min(dist, total);
  let acc = 0;
  const segs = leg.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + seg >= s || i === segs - 1) {
      const f = seg > 0 ? Math.min(1, Math.max(0, (s - acc) / seg)) : 0;
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        yaw: a.yaw + SWEEP * Math.sin(local * 0.9),
        pitch: -0.05 + 0.08 * Math.sin(local * 0.6),
      };
    }
    acc += seg;
  }
  return { x: pts[0].x, z: pts[0].z, yaw: pts[0].yaw, pitch: 0 };
}

export type TourLegReport = {
  id: TourLegId;
  label: string;
  seconds: number;
  frames: number;
  averageFps: number;
  onePercentLowFps: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgDrawCalls: number;
  avgTriangles: number;
  avgVisibleInstances: number;
  avgActiveModels: number;
  avgEstimatedModelTriangles: number;
};

/** Akumulator pomiarów jednego odcinka trasy. */
export class TourLegRecorder {
  readonly stats = new FrameStats(0.5, true);
  private calls = 0;
  private tris = 0;
  private visible = 0;
  private models = 0;
  private modelTris = 0;
  private n = 0;

  constructor(readonly leg: TourLeg) {}

  push(dtMs: number, drawCalls: number, triangles: number, inst: { visible: number; activeModels: number; triangles: number }): void {
    this.stats.push(dtMs);
    this.calls += drawCalls;
    this.tris += triangles;
    this.visible += inst.visible;
    this.models += inst.activeModels;
    this.modelTris += inst.triangles;
    this.n++;
  }

  report(): TourLegReport {
    const s = this.stats.summary();
    const n = Math.max(1, this.n);
    return {
      id: this.leg.id,
      label: this.leg.label,
      seconds: s.seconds,
      frames: s.frames,
      averageFps: s.averageFps,
      onePercentLowFps: s.onePercentLowFps,
      medianMs: s.medianMs,
      p95Ms: s.p95Ms,
      p99Ms: s.p99Ms,
      maxMs: s.maxMs,
      avgDrawCalls: this.calls / n,
      avgTriangles: this.tris / n,
      avgVisibleInstances: this.visible / n,
      avgActiveModels: this.models / n,
      avgEstimatedModelTriangles: this.modelTris / n,
    };
  }
}
