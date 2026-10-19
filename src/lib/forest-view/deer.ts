import * as THREE from "three";
import type { DeerAsset } from "@/lib/assets/characters";
import { rngStream } from "@/lib/game/core/rng";
import { anchorsFromFeatures } from "@/lib/game/world/anchors";
import { FOREST_START } from "@/lib/game/world/generators/v2";
import type { ForestWorld } from "@/lib/game/world/generators/v2/forest";
import type { WalkWorld } from "@/lib/game/world/walk";
import { DeerNpc } from "@/lib/npc/deer";
import type { Blocker, Point } from "@/lib/npc/patrol";
import { NPC_DRAW_DISTANCE } from "./npc";

/** Kierunek, w którym gracz patrzy po wejściu do lasu (wschód): polana ze zwierzęciem ma leżeć mniej więcej przed nim. */
const ENTRY_BEARING = Math.PI / 2;
/** Środkowa odległość polany od punktu wejścia (m) i zakres, w którym jej szukamy. */
export const DEER_DISTANCE = { min: 20, max: 30, ideal: 25 } as const;
const QUEST_CLEARANCE = 12;
const REACH_RADIUS = 40;

export type DeerPlacement = {
  home: Point;
  /** Odległość polany od punktu wejścia (m) i azymut od wejścia (rad, `atan2(dx, dz)`). */
  distance: number;
  bearing: number;
  /** Największy promień (m), w którym wokół polany nie ma przeszkód. */
  clearance: number;
  /** Czy z punktu wejścia widać polanę bez pni na linii wzroku. */
  sightline: boolean;
  /** Numer kroku łagodzenia wymagań (0 = pełne wymagania). */
  relaxation: number;
  /** Początkowy azymut jelenia: twarzą w stronę wejścia. */
  yaw: number;
};

type Level = { clearance: number; slope: number; min: number; max: number };
const LEVELS: readonly Level[] = [
  { clearance: 6.5, slope: 0.27, min: 21, max: 29 },
  { clearance: 5.5, slope: 0.32, min: 21, max: 29 },
  { clearance: 4.5, slope: 0.4, min: 20, max: 30 },
  { clearance: 3.5, slope: 0.5, min: 18, max: 32 },
  { clearance: 2.5, slope: 0.6, min: 15, max: 36 },
];

const RING_POINTS = 16;
const ringFree = (walk: Pick<WalkWorld, "isWalkable">, x: number, z: number, r: number) => {
  for (let k = 0; k < RING_POINTS; k++) {
    const a = (k / RING_POINTS) * Math.PI * 2;
    if (!walk.isWalkable(x + Math.sin(a) * r, z + Math.cos(a) * r)) return false;
  }
  return true;
};

/** Największy promień (całe metry, do 9), w którym punkt i kolejne pierścienie są wolne; 0, gdy sam punkt jest zajęty. */
function clearanceAt(walk: Pick<WalkWorld, "isWalkable">, x: number, z: number): number {
  if (!walk.isWalkable(x, z)) return 0;
  let r = 0;
  while (r < 9 && ringFree(walk, x, z, r + 1)) r++;
  return r;
}

function maxGradient(forest: ForestWorld, x: number, z: number, radius: number): number {
  let worst = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (const r of [0, radius * 0.5, radius]) {
      const g = forest.terrain.gradient(x + Math.sin(a) * r, z + Math.cos(a) * r);
      worst = Math.max(worst, Math.hypot(g.dx, g.dz));
    }
  }
  return worst;
}

/** Zbiór komórek 1 m w promieniu `REACH_RADIUS` od punktu wejścia osiągalnych krok po kroku po przejezdnym terenie. */
function reachableCells(walk: Pick<WalkWorld, "isWalkable">, start: Point): Set<number> {
  const key = (ix: number, iz: number) => (ix + 512) * 1024 + (iz + 512);
  const visited = new Set<number>();
  const sx = Math.floor(start.x);
  const sz = Math.floor(start.z);
  const queue: number[] = [];
  const open = (ix: number, iz: number) =>
    Math.hypot(ix + 0.5 - start.x, iz + 0.5 - start.z) <= REACH_RADIUS && walk.isWalkable(ix + 0.5, iz + 0.5);
  if (open(sx, sz)) {
    visited.add(key(sx, sz));
    queue.push(sx, sz);
  }
  for (let head = 0; head < queue.length; head += 2) {
    const ix = queue[head];
    const iz = queue[head + 1];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const k = key(ix + dx, iz + dz);
      if (visited.has(k) || !open(ix + dx, iz + dz)) continue;
      visited.add(k);
      queue.push(ix + dx, iz + dz);
    }
  }
  return visited;
}

const lineOfSight = (walk: Pick<WalkWorld, "isWalkable"> & { objectBlocking(x: number, z: number, r?: number): unknown }, a: Point, b: Point): boolean => {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.75));
  for (let i = 2; i < n; i++) {
    const t = i / n;
    if (walk.objectBlocking(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.45)) return false;
  }
  return true;
};

const placements = new WeakMap<ForestWorld, DeerPlacement | null>();

/**
 * Polana jelenia: deterministyczny wybór z istniejących danych lasu (świat, kolizje i teren zostają nietknięte; nic nie jest
 * zapisywane). Kandydaci leżą 20-30 m od punktu wejścia, muszą mieć duży wolny promień, łagodny teren, być osiągalni pieszo,
 * daleko od skrzyń i trolla, a przy remisie wygrywa polana bliżej kierunku patrzenia po wejściu i z widoczną linią wzroku.
 * Gdy nie ma idealnej, wymagania łagodnieją po kolei; brak jakiejkolwiek polany daje `null` (wtedy nie ma jelenia).
 */
export function deerPlacementOf(forest: ForestWorld, walk: WalkWorld, seed: number): DeerPlacement | null {
  if (placements.has(forest)) return placements.get(forest) ?? null;
  const result = computePlacement(forest, walk, seed);
  placements.set(forest, result);
  return result;
}

export function computePlacement(forest: ForestWorld, walk: WalkWorld, seed: number): DeerPlacement | null {
  const start = FOREST_START;
  const anchors = anchorsFromFeatures(forest.features, start);
  const avoid: Point[] = [...Object.values(anchors.chests), anchors.troll, { x: anchors.bridge.x, z: anchors.bridge.z }];
  const reach = reachableCells(walk, start);
  const reaches = (x: number, z: number) => reach.has((Math.floor(x) + 512) * 1024 + (Math.floor(z) + 512));
  const rng = rngStream(seed, "npc.deer.home");
  for (const [relaxation, level] of LEVELS.entries()) {
    let best: (DeerPlacement & { score: number }) | null = null;
    for (let ring = level.min; ring <= level.max; ring += 1) {
      for (let a = 0; a < 360; a += 5) {
        const bearing = (a * Math.PI) / 180;
        const x = start.x + Math.sin(bearing) * ring;
        const z = start.z + Math.cos(bearing) * ring;
        const jitter = rng();
        if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < QUEST_CLEARANCE)) continue;
        if (!reaches(x, z) || !ringFree(walk, x, z, level.clearance)) continue;
        const clearance = clearanceAt(walk, x, z);
        if (clearance < level.clearance) continue;
        const gradient = maxGradient(forest, x, z, Math.min(clearance, 5));
        if (gradient > level.slope) continue;
        const sightline = lineOfSight(walk, start, { x, z });
        const off = Math.abs(Math.atan2(Math.sin(bearing - ENTRY_BEARING), Math.cos(bearing - ENTRY_BEARING)));
        const score = Math.min(clearance, 9) + 6 * Math.cos(off) + (sightline ? 5 : 0) - Math.abs(ring - DEER_DISTANCE.ideal) * 0.15 - gradient * 6 + jitter * 0.3;
        if (!best || score > best.score) {
          best = {
            home: { x, z },
            distance: ring,
            bearing,
            clearance,
            sightline,
            relaxation,
            yaw: Math.atan2(start.x - x, start.z - z),
            score,
          };
        }
      }
    }
    if (best) {
      const { score: _score, ...placement } = best;
      void _score;
      return placement;
    }
  }
  return null;
}

export type DeerStats = {
  visible: boolean;
  /** Odległość gracza od jelenia (m). */
  distance: number;
  /** Zachowanie (rest, stroll, alert, retreat) i stan animacji (rest, walk). */
  behavior: string;
  cornered: boolean;
  state: string;
  clip: string;
  clipTime: number;
  clipDuration: number;
  blend: string;
  /** Skala modelu do świata, wysokość docelowa (m) i prędkość (m/s). */
  scale: number;
  height: number;
  speed: number;
  triangles: number;
  bones: number;
  x: number;
  z: number;
  /** Odległość polany jelenia od wejścia do lasu (m) i odległość jelenia od środka polany (m). */
  homeFromStart: number;
  homeDistance: number;
  watching: boolean;
  lookYaw: number;
  lookPitch: number;
  retreats: number;
};

/**
 * Warstwa jelenia lasu: jedno zwierzę na wyznaczonej polanie. Stanu gry i zapisu nie zna. Poza `NPC_DRAW_DISTANCE` zwierzę jest
 * ukryte i zamrożone, więc daleko nie kosztuje animacji szkieletowej.
 */
export class DeerLayer {
  readonly group = new THREE.Group();
  readonly deer: DeerNpc;
  readonly placement: DeerPlacement;
  private visible = true;
  private viewerDistance = Infinity;
  private readonly asset: DeerAsset;

  constructor(
    asset: DeerAsset,
    options: { forest: ForestWorld; walk: WalkWorld; seed: number; castShadow: boolean; receiveShadow: boolean },
  ) {
    const placement = deerPlacementOf(options.forest, options.walk, options.seed);
    if (!placement) throw new Error("Brak bezpiecznej polany dla jelenia w tym lesie.");
    this.asset = asset;
    this.placement = placement;
    this.deer = new DeerNpc({
      asset,
      walk: options.walk,
      terrain: options.forest.terrain,
      home: placement.home,
      yaw: placement.yaw,
      seed: options.seed,
      castShadow: options.castShadow,
      receiveShadow: options.receiveShadow,
    });
    this.group.name = "fauna";
    this.group.add(this.deer.group);
  }

  setShadows(cast: boolean, receive: boolean): void {
    this.deer.setShadows(cast, receive);
  }

  update(dt: number, viewer: Point): void {
    this.viewerDistance = Math.hypot(this.deer.x - viewer.x, this.deer.z - viewer.z);
    const near = this.viewerDistance <= NPC_DRAW_DISTANCE;
    this.visible = near;
    this.deer.group.visible = near;
    if (near) this.deer.update(dt, viewer);
  }

  blockers(): readonly Blocker[] {
    return this.visible ? [this.deer.blocker()] : [];
  }

  stats(): DeerStats {
    const d = this.deer;
    const animator = d.animator;
    return {
      visible: this.visible,
      distance: this.viewerDistance,
      behavior: d.mode,
      cornered: d.brain.isCornered,
      state: animator.state,
      clip: d.activeClip,
      clipTime: animator.stateTime,
      clipDuration: animator.stateDuration,
      blend: Object.entries(animator.weights())
        .map(([id, w]) => `${id} ${w.toFixed(2)}`)
        .join(" · "),
      scale: d.scale,
      height: this.asset.entry.targetHeight,
      speed: d.brain.speed,
      triangles: this.asset.triangles,
      bones: this.asset.bones,
      x: d.x,
      z: d.z,
      homeFromStart: this.placement.distance,
      homeDistance: d.brain.homeDistance,
      watching: d.watching,
      lookYaw: d.look.yaw,
      lookPitch: d.look.pitch,
      retreats: d.brain.retreats,
    };
  }

  dispose(): void {
    this.deer.dispose();
    this.group.removeFromParent();
  }
}
