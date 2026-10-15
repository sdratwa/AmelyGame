import { boundsContain, regionAt, type RegionDef } from "./bounds";
import { pushOutOfCollider, type WorldObject } from "./objects";
import { shapeContains, shapeIntersectsCircle, type Shape } from "./shape";
import { SpatialIndex } from "./spatialIndex";
import type { HeightField } from "./terrain";

export type WorldFlags = { has(flag: string): boolean };
const NO_FLAGS: WorldFlags = { has: () => false };

export type WalkConfig = {
  /** Promień gracza (m) używany w kolizjach z obiektami i barierami. */
  playerRadius: number;
  /** Maksymalne nachylenie, po którym można chodzić (stopnie). */
  maxSlopeDeg: number;
  /** Odstęp od krawędzi regionu (m). */
  edgeMargin: number;
};

export const DEFAULT_WALK_CONFIG: WalkConfig = { playerRadius: 0.4, maxSlopeDeg: 35, edgeMargin: 0.5 };

/** Przeszkoda terenowa (np. rzeka, urwisko): blokuje ruch, dopóki nie otworzy jej `Passage`. */
export type Barrier = { id: string; kind: string; shape: Shape };

/**
 * Przejście (np. most po zbudowaniu): gdy flaga świata jest ustawiona, w obrębie kształtu
 * przestają obowiązywać wskazane bariery (`opens`; brak = wszystkie bariery).
 */
export type Passage = { id: string; shape: Shape; requiresFlag: string; opens?: readonly string[] };

export type WalkBlock = {
  reason: "out_of_bounds" | "too_steep" | "barrier" | "object";
  by?: string;
};

export type WalkWorldOptions = {
  regions: readonly RegionDef[];
  terrain: HeightField;
  objects?: readonly WorldObject[];
  barriers?: readonly Barrier[];
  passages?: readonly Passage[];
  config?: Partial<WalkConfig>;
  cellSize?: number;
};

/**
 * Logika chodzenia niezależna od renderera: granice odblokowanych regionów, nachylenie, bariery
 * z przejściami warunkowanymi flagami oraz kolizje z obiektami (z indeksu przestrzennego).
 */
export class WalkWorld {
  readonly regions: readonly RegionDef[];
  readonly terrain: HeightField;
  readonly config: WalkConfig;
  readonly index: SpatialIndex<WorldObject>;
  private readonly barriers: readonly Barrier[];
  private readonly passages: readonly Passage[];
  private readonly maxGradient: number;

  constructor(options: WalkWorldOptions) {
    this.regions = options.regions;
    this.terrain = options.terrain;
    this.config = { ...DEFAULT_WALK_CONFIG, ...options.config };
    this.barriers = options.barriers ?? [];
    this.passages = options.passages ?? [];
    this.maxGradient = Math.tan((this.config.maxSlopeDeg * Math.PI) / 180);
    const cell = options.cellSize ?? options.regions[0]?.sectorSize ?? 30;
    this.index = new SpatialIndex<WorldObject>(cell);
    for (const o of options.objects ?? []) this.index.add(o);
  }

  addObject(obj: WorldObject): void {
    this.index.add(obj);
  }

  removeObject(id: string): boolean {
    return this.index.remove(id);
  }

  private inBounds(x: number, z: number, flags: WorldFlags): boolean {
    const region = regionAt(this.regions, x, z, flags);
    return region !== null && boundsContain(region.bounds, x, z, this.config.edgeMargin);
  }

  private barrierAt(x: number, z: number, radius: number, flags: WorldFlags): Barrier | null {
    for (const barrier of this.barriers) {
      if (!shapeIntersectsCircle(barrier.shape, x, z, radius)) continue;
      const opened = this.passages.some(
        (p) =>
          flags.has(p.requiresFlag) &&
          (!p.opens || p.opens.includes(barrier.id)) &&
          shapeContains(p.shape, x, z),
      );
      if (!opened) return barrier;
    }
    return null;
  }

  private terrainBlock(x: number, z: number, flags: WorldFlags): WalkBlock | null {
    if (!this.inBounds(x, z, flags)) return { reason: "out_of_bounds" };
    const g = this.terrain.gradient(x, z);
    if (Math.hypot(g.dx, g.dz) > this.maxGradient) return { reason: "too_steep" };
    const barrier = this.barrierAt(x, z, this.config.playerRadius, flags);
    if (barrier) return { reason: "barrier", by: barrier.id };
    return null;
  }

  /** Obiekt, którego collider koliduje z graczem w tym punkcie (bez wypychania). */
  objectBlocking(x: number, z: number, radius = this.config.playerRadius): WorldObject | null {
    for (const o of this.index.queryRadius(x, z, radius)) {
      if (pushOutOfCollider(o, x, z, radius).hit) return o;
    }
    return null;
  }

  /** Czy gracz może stać w punkcie (x, z). Zwraca przyczynę blokady albo null. */
  checkPoint(x: number, z: number, flags: WorldFlags = NO_FLAGS): WalkBlock | null {
    const block = this.terrainBlock(x, z, flags);
    if (block) return block;
    const obj = this.objectBlocking(x, z);
    return obj ? { reason: "object", by: obj.id } : null;
  }

  isWalkable(x: number, z: number, flags: WorldFlags = NO_FLAGS): boolean {
    return this.checkPoint(x, z, flags) === null;
  }

  private pushOut(x: number, z: number, hits: Set<string>): { x: number; z: number } {
    let px = x;
    let pz = z;
    const pr = this.config.playerRadius;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const o of this.index.queryRadius(px, pz, pr)) {
        const out = pushOutOfCollider(o, px, pz, pr);
        if (out.hit) {
          px = out.x;
          pz = out.z;
          hits.add(o.id);
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x: px, z: pz };
  }

  private step(
    from: { x: number; z: number },
    to: { x: number; z: number },
    flags: WorldFlags,
  ): { x: number; z: number; blocked: WalkBlock[] } {
    const blocked: WalkBlock[] = [];
    const attempts = [to, { x: to.x, z: from.z }, { x: from.x, z: to.z }];
    for (let i = 0; i < attempts.length; i++) {
      const hits = new Set<string>();
      const p = this.pushOut(attempts[i].x, attempts[i].z, hits);
      const leftover = this.objectBlocking(p.x, p.z);
      const block = this.terrainBlock(p.x, p.z, flags) ?? (leftover ? ({ reason: "object", by: leftover.id } as const) : null);
      if (i === 0) {
        for (const id of [...hits].sort()) blocked.push({ reason: "object", by: id });
        if (block && block.reason !== "object") blocked.push(block);
      }
      if (!block) return { x: p.x, z: p.z, blocked };
    }
    return { x: from.x, z: from.z, blocked };
  }

  /**
   * Ruch gracza z `from` do `to`. Dłuższy ruch jest dzielony na kroki nie dłuższe niż promień gracza,
   * więc nie da się przeskoczyć cienkiej bariery. W każdym kroku kolizje z obiektami wypychają (ślizg
   * po przeszkodzie), a granice, zbyt strome zbocza i bariery zatrzymują – z próbą ślizgu wzdłuż osi,
   * a w ostateczności pozostaniem w miejscu. `blocked` opisuje pierwszą przeszkodę napotkaną w ruchu.
   */
  move(
    from: { x: number; z: number },
    to: { x: number; z: number },
    flags: WorldFlags = NO_FLAGS,
  ): { x: number; z: number; blocked: WalkBlock[] } {
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const n = Math.min(256, Math.max(1, Math.ceil(dist / this.config.playerRadius)));
    const dx = (to.x - from.x) / n;
    const dz = (to.z - from.z) / n;
    let cur = { x: from.x, z: from.z };
    let blocked: WalkBlock[] = [];
    let unobstructed = true;
    for (let i = 1; i <= n; i++) {
      const target = unobstructed
        ? i === n
          ? to
          : { x: from.x + dx * i, z: from.z + dz * i }
        : { x: cur.x + dx, z: cur.z + dz };
      const result = this.step(cur, target, flags);
      if (result.blocked.length > 0) {
        unobstructed = false;
        if (blocked.length === 0) blocked = result.blocked;
      }
      cur = { x: result.x, z: result.z };
    }
    return { x: cur.x, z: cur.z, blocked };
  }
}

export type Reachability = {
  readonly cell: number;
  /** Czy komórka zawierająca punkt została osiągnięta. */
  has(x: number, z: number): boolean;
  readonly count: number;
};

/**
 * Zalewanie siatką (BFS, 4 sąsiadów) od `start` z użyciem `checkPoint` – uwzględnia granice,
 * zbocza, bariery, obiekty i flagi. Nie zakłada niczego o wyglądzie świata.
 */
export function computeReachability(
  world: WalkWorld,
  start: { x: number; z: number },
  options: { cell?: number; flags?: WorldFlags } = {},
): Reachability {
  const cell = options.cell ?? 1;
  const flags = options.flags ?? NO_FLAGS;
  const visited = new Set<number>();
  const key = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);
  const center = (i: number) => (i + 0.5) * cell;
  const sx = Math.floor(start.x / cell);
  const sz = Math.floor(start.z / cell);
  const queue: number[] = [];
  const open = (ix: number, iz: number) => world.isWalkable(center(ix), center(iz), flags);
  if (open(sx, sz)) {
    visited.add(key(sx, sz));
    queue.push(sx, sz);
  }
  for (let head = 0; head < queue.length; head += 2) {
    const ix = queue[head];
    const iz = queue[head + 1];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ix + dx;
      const nz = iz + dz;
      const k = key(nx, nz);
      if (visited.has(k) || !open(nx, nz)) continue;
      visited.add(k);
      queue.push(nx, nz);
    }
  }
  return {
    cell,
    count: visited.size,
    has: (x, z) => visited.has(key(Math.floor(x / cell), Math.floor(z / cell))),
  };
}

/** Czy któraś osiągnięta komórka leży w odległości `radius` od punktu (np. zasięg interakcji ze skrzynią). */
export function reachesNear(reach: Reachability, x: number, z: number, radius: number): boolean {
  const c = reach.cell;
  const x0 = Math.floor((x - radius) / c);
  const x1 = Math.floor((x + radius) / c);
  const z0 = Math.floor((z - radius) / c);
  const z1 = Math.floor((z + radius) / c);
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const cx = (ix + 0.5) * c;
      const cz = (iz + 0.5) * c;
      if ((cx - x) ** 2 + (cz - z) ** 2 <= radius * radius && reach.has(cx, cz)) return true;
    }
  }
  return false;
}
