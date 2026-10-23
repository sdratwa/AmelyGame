import { boundsContain, regionAt, type RegionDef } from "./bounds";
import { pushOutOfCollider, type WorldObject } from "./objects";
import { ROCK_PHYSICS, rockSupports, rockSurfaceY, rockSurfaceYClamped, rockWallTop } from "./rockPhysics";
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

/**
 * Pionowe położenie ciała dla ruchu poziomego: wysokość stóp (m, bezwzględna) i skała, na której ciało stoi (jej bok nie
 * blokuje). Bez tego parametru `move` traktuje każdy collider jak przeszkodę o nieskończonej wysokości (stare zachowanie).
 * `slideStep` (m) to największe zsunięcie z boku skały w tym kroku, gdy ciało opada przy jej krawędzi.
 */
export type BodyVertical = { footY: number; supportId?: string | null; slideStep?: number };

/** Górna powierzchnia skały, na której można stanąć. */
export type RockSurface = { id: string; y: number; object: WorldObject };

type RockRule = "pass" | "block" | "slide";
type MoveCtx = { body: BodyVertical; from: { x: number; z: number }; rules: Map<string, RockRule> };

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

  /**
   * Obiekt, którego collider koliduje z graczem w tym punkcie (bez wypychania). Z `body` skały o skończonej wysokości
   * blokują tylko wtedy, gdy stopy nie są dość wysoko (patrz `BodyVertical`).
   */
  objectBlocking(x: number, z: number, radius = this.config.playerRadius, body?: BodyVertical): WorldObject | null {
    return this.blockingObject(x, z, radius, body ? { body, from: { x, z }, rules: new Map() } : undefined);
  }

  private blockingObject(x: number, z: number, radius: number, ctx?: MoveCtx): WorldObject | null {
    for (const o of this.index.queryRadius(x, z, radius)) {
      if (ctx && o.rock && this.rockRule(o, ctx) !== "block") continue;
      if (pushOutOfCollider(o, x, z, radius).hit) return o;
    }
    return null;
  }

  /**
   * Czy skała `o` blokuje ciało rozpoczynające krok w `ctx.from` na wysokości stóp `ctx.body.footY`:
   * - skała, na której ciało stoi, nie blokuje (`pass`);
   * - ciało już zachodzące na skałę (zeszło z wierzchu i opada przy krawędzi): nad powierzchnią `pass`, poniżej `slide`
   *   (zsuwa się wzdłuż boku zamiast być teleportowane);
   * - ciało spoza skały wchodzi nad nią tylko ze stopami powyżej szczytu o zapas `clearance`, inaczej `block`.
   */
  private rockRule(o: WorldObject, ctx: MoveCtx): RockRule {
    const memo = ctx.rules.get(o.id);
    if (memo) return memo;
    const { body, from } = ctx;
    let rule: RockRule;
    if (o.id === body.supportId) rule = "pass";
    else if (pushOutOfCollider(o, from.x, from.z, this.config.playerRadius).hit) {
      rule = body.footY >= rockSurfaceYClamped(o, from.x, from.z) - ROCK_PHYSICS.landingEpsilon ? "pass" : o.collider?.shape === "circle" ? "slide" : "block";
    } else rule = body.footY >= rockWallTop(o) + ROCK_PHYSICS.clearance ? "pass" : "block";
    ctx.rules.set(o.id, rule);
    return rule;
  }

  /**
   * Wysuwa ciało zachodzące na skałę (reguła `slide`) na zewnątrz, nie szybciej niż `slideStep`: wzdłuż promienia od środka
   * wierzchu skały (zejście z krawędzi wierzchu kontynuuje ruch od niego), a gdy skała nie ma wierzchu, od środka kolizji.
   * Ciało nie jest teleportowane: opuszcza bryłę stopniowo, tak szybko, jak zsunęłoby się z boku skały.
   */
  private applySlides(cur: { x: number; z: number }, ctx: MoveCtx): { x: number; z: number } {
    const pr = this.config.playerRadius;
    const step = ctx.body.slideStep ?? ROCK_PHYSICS.edgeSlideSpeed / 60;
    let { x, z } = cur;
    for (const o of this.index.queryRadius(x, z, pr, { filter: (item) => !!item.rock })) {
      if (this.rockRule(o, ctx) !== "slide" || o.collider?.shape !== "circle") continue;
      const reach = o.collider.r + pr;
      const d1 = Math.hypot(x - o.x, z - o.z);
      if (d1 >= reach) continue;
      // Ruch w głąb bryły jest wykluczony: nie bliżej środka kolizji niż na początku kroku.
      const d0 = Math.hypot(ctx.from.x - o.x, ctx.from.z - o.z);
      if (d1 < d0 && d1 > 1e-6) {
        x = o.x + ((x - o.x) * d0) / d1;
        z = o.z + ((z - o.z) * d0) / d1;
      }
      const p = o.rock!;
      const cx = p.standable ? o.x + p.topOffset[0] : o.x;
      const cz = p.standable ? o.z + p.topOffset[1] : o.z;
      let ux = x - cx;
      let uz = z - cz;
      let len = Math.hypot(ux, uz);
      if (len < 1e-6) {
        // Dokładnie nad środkiem wierzchu: kierunek ostatniego ruchu, a bez ruchu od środka kolizji.
        ux = x - ctx.from.x;
        uz = z - ctx.from.z;
        len = Math.hypot(ux, uz);
        if (len < 1e-6) {
          ux = x - o.x;
          uz = z - o.z;
          len = Math.hypot(ux, uz);
          if (len < 1e-6) {
            ux = 1;
            uz = 0;
            len = 1;
          }
        }
      }
      ux /= len;
      uz /= len;
      // Odległość wzdłuż promienia do wyjścia z okręgu kolizji: |q + t u - o|^2 = reach^2.
      const qx = x - o.x;
      const qz = z - o.z;
      const b = qx * ux + qz * uz;
      const exit = -b + Math.sqrt(Math.max(0, b * b - (qx * qx + qz * qz - reach * reach)));
      const t = Math.min(exit, step);
      x += ux * t;
      z += uz * t;
    }
    return { x, z };
  }

  /**
   * Skała z profilem, która według reguł ruchu (`BodyVertical`) blokuje ciało stojące w (x, z) po przejściu z `from`
   * (np. punkty cięciwy między dwiema próbkami ruchu); `tolerance` skraca promień ciała, by dotyk brzegiem nie liczył się jako wejście.
   * Służy walidacji ruchu po stronie serwera: nie wypycha ani nie zmienia pozycji.
   */
  rockBlockingAt(x: number, z: number, from: { x: number; z: number }, body: BodyVertical, tolerance = 0): WorldObject | null {
    const ctx: MoveCtx = { body, from: { x: from.x, z: from.z }, rules: new Map() };
    const pr = this.config.playerRadius - tolerance;
    for (const o of this.index.queryRadius(x, z, pr, { filter: (item) => !!item.rock })) {
      if (this.rockRule(o, ctx) === "block" && pushOutOfCollider(o, x, z, pr).hit) return o;
    }
    return null;
  }

  /** Czy w pobliżu (x, z) jest skała z profilem pionowym; tanie sprawdzenie, czy w ogóle potrzebne są kroki cząstkowe. */
  rocksNear(x: number, z: number, radius: number): boolean {
    return this.index.queryRadius(x, z, radius, { filter: (o) => !!o.rock }).length > 0;
  }

  /**
   * Górna powierzchnia skały, na którą z góry opada stopa: środek ciała nad obszarem podparcia, stopy przeszły z
   * `prevFootY` (nie niżej niż o tolerancję pod powierzchnią) do `footY` (na powierzchni lub pod nią), a w miejscu
   * lądowania nic innego nie blokuje kapsuły. Wybiera najwyższą z takich powierzchni.
   */
  findLandingSurface(x: number, z: number, prevFootY: number, footY: number): RockSurface | null {
    let best: RockSurface | null = null;
    for (const o of this.index.queryRadius(x, z, 0, { filter: (item) => !!item.rock?.standable })) {
      if (!rockSupports(o, x, z)) continue;
      const y = rockSurfaceY(o, x, z);
      if (prevFootY < y - ROCK_PHYSICS.landingEpsilon || footY > y) continue;
      if (best && best.y >= y) continue;
      if (this.objectBlocking(x, z, this.config.playerRadius, { footY: y, supportId: o.id })) continue;
      best = { id: o.id, y, object: o };
    }
    return best;
  }

  /**
   * Powierzchnia skały podtrzymująca ciało stojące: wierzch w przedziale [`footY - maxDown`, `footY + maxUp`] nad
   * środkiem ciała (najwyższy z nich). Skała, której wierzch jest znacznie wyżej niż stopy, NIE jest zwracana, więc
   * stojąc u jej podstawy nie "wskakuje się" na szczyt.
   */
  supportSurfaceAt(x: number, z: number, footY: number, maxUp: number = ROCK_PHYSICS.stepUp, maxDown = Infinity): RockSurface | null {
    let best: RockSurface | null = null;
    for (const o of this.index.queryRadius(x, z, 0, { filter: (item) => !!item.rock?.standable })) {
      if (!rockSupports(o, x, z)) continue;
      const y = rockSurfaceY(o, x, z);
      if (y > footY + maxUp || y < footY - maxDown) continue;
      if (!best || y > best.y) best = { id: o.id, y, object: o };
    }
    return best;
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

  private pushOut(x: number, z: number, hits: Set<string>, ctx?: MoveCtx): { x: number; z: number } {
    let px = x;
    let pz = z;
    const pr = this.config.playerRadius;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const o of this.index.queryRadius(px, pz, pr)) {
        if (ctx && o.rock && this.rockRule(o, ctx) !== "block") continue;
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
    ctx?: MoveCtx,
  ): { x: number; z: number; blocked: WalkBlock[] } {
    const blocked: WalkBlock[] = [];
    const attempts = [to, { x: to.x, z: from.z }, { x: from.x, z: to.z }];
    for (let i = 0; i < attempts.length; i++) {
      const hits = new Set<string>();
      const p = this.pushOut(attempts[i].x, attempts[i].z, hits, ctx);
      const leftover = this.blockingObject(p.x, p.z, this.config.playerRadius, ctx);
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
   * Z `body` skały o skończonej wysokości (`WorldObject.rock`) blokują tylko ciało, którego stopy są niżej niż szczyt
   * o zapas; bariery, granice, strome zbocza i pozostałe obiekty działają niezależnie od wysokości stóp.
   */
  move(
    from: { x: number; z: number },
    to: { x: number; z: number },
    flags: WorldFlags = NO_FLAGS,
    body?: BodyVertical,
  ): { x: number; z: number; blocked: WalkBlock[] } {
    const ctx: MoveCtx | undefined = body ? { body, from: { x: from.x, z: from.z }, rules: new Map() } : undefined;
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
      const result = this.step(cur, target, flags, ctx);
      if (result.blocked.length > 0) {
        unobstructed = false;
        if (blocked.length === 0) blocked = result.blocked;
      }
      cur = { x: result.x, z: result.z };
    }
    if (ctx) cur = this.applySlides(cur, ctx);
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
