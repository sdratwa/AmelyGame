export type Point = { x: number; z: number };
export type Blocker = { x: number; z: number; r: number };

export type RouteOptions = {
  /** Maksymalna odległość punktów trasy od punktu domowego (m). */
  maxRadius: number;
  /** Ile punktów trasy (poza punktem domowym) najwyżej wybieramy. */
  points: number;
  /** Krok próbkowania odcinków przy sprawdzaniu przejezdności (m). */
  sampleStep?: number;
};

const TWO_PI = Math.PI * 2;
const RADII = [1.5, 2.0, 2.6];
const ANGLE_STEPS = 12;

/** Odcinek jest wolny, jeśli wszystkie jego próbki spełniają `isFree`. */
export function segmentFree(a: Point, b: Point, isFree: (x: number, z: number) => boolean, step = 0.5): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!isFree(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/**
 * Deterministyczna trasa patrolu wokół punktu domowego (kotwicy NPC): zamknięta pętla `home -> p1 -> p2 -> ...`, gdzie
 * każdy punkt i każdy odcinek (także zamykający) spełnia `isFree` (teren przejezdny z zapasem na rozmiar postaci).
 * Pusta trasa oznacza, że nie ma bezpiecznej pętli i NPC stoi w miejscu; nie wymuszamy chodzenia przez przeszkody.
 */
export function planPatrolRoute(home: Point, isFree: (x: number, z: number) => boolean, rng: () => number, options: RouteOptions): Point[] {
  const step = options.sampleStep ?? 0.5;
  if (!isFree(home.x, home.z)) return [];
  const start = rng() * TWO_PI;
  const candidates: { angle: number; p: Point }[] = [];
  for (let k = 0; k < ANGLE_STEPS; k++) {
    const angle = start + (k / ANGLE_STEPS) * TWO_PI;
    for (const radius of RADII) {
      if (radius > options.maxRadius) continue;
      const p = { x: home.x + Math.sin(angle) * radius, z: home.z + Math.cos(angle) * radius };
      if (isFree(p.x, p.z) && segmentFree(home, p, isFree, step)) candidates.push({ angle, p });
    }
  }
  // Dla każdego kierunku bierzemy najdalszy wolny punkt (większy rozmach pętli), potem rozstawiamy je równomiernie.
  const byAngle = new Map<number, { angle: number; p: Point }>();
  for (const c of candidates) byAngle.set(c.angle, c);
  const pool = [...byAngle.values()].sort((a, b) => a.angle - b.angle);
  if (pool.length < 2) return [];
  const wanted = Math.min(options.points, pool.length);
  const picked: { angle: number; p: Point }[] = [];
  for (let i = 0; i < wanted; i++) picked.push(pool[Math.floor((i * pool.length) / wanted)]);
  const route: Point[] = [home];
  for (const c of picked) route.push(c.p);
  // Odcinki między punktami pętli także muszą być wolne; punkt psujący odcinek odrzucamy.
  for (let i = 1; i < route.length; ) {
    const prev = route[i - 1];
    if (segmentFree(prev, route[i], isFree, step)) i++;
    else route.splice(i, 1);
  }
  while (route.length > 2 && !segmentFree(route[route.length - 1], route[0], isFree, step)) route.pop();
  return route.length >= 2 ? route : [];
}

export type PatrolConfig = {
  /** Prędkość marszu (m/s); powinna równać się nominalnej prędkości animacji chodu (brak ślizgania stóp). */
  speed: number;
  waitMin: number;
  waitMax: number;
  /** Prędkość obrotu (rad/s). */
  turnRate: number;
  /** Przyspieszenie i hamowanie (m/s^2): postać rusza i staje łagodnie, a tempo kroków da się dopasować do chwilowej prędkości. */
  accel: number;
};

const MIN_WALK_SPEED = 0.25;

export type PatrolMode = "walk" | "wait" | "hold";

export type PatrolContext = {
  /** Postój wymuszony z zewnątrz (np. reakcja gniewu): postać stoi i nie przesuwa się. */
  hold?: boolean;
  /** Dokąd patrzeć podczas postoju wymuszonego. */
  face?: Point;
  /** Przeszkody dynamiczne (gracz): patrol czeka, gdy ktoś stoi na drodze. */
  blockers?: readonly Blocker[];
  /** Promień postaci patrolującej (m), do wykrywania przeszkód. */
  radius?: number;
};

const MAX_STEP = 0.1;
const YIELD_WAIT = 0.5;
const ALIGN_EPS = 0.08;

const wrap = (a: number) => {
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  if (r < -Math.PI) r += TWO_PI;
  return r;
};

const turnToward = (cur: number, target: number, maxStep: number) => {
  const d = wrap(target - cur);
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
};

/**
 * Patrol jako maszyna stanów (czysta logika, bez Three.js): idzie od punktu do punktu stałą prędkością, na każdym
 * punkcie postój (idle) z obrotem w stronę następnego, a ruch zawsze zaczyna dopiero po wyrównaniu kierunku. Pozycja
 * świata należy wyłącznie do patrolu (animacja nie przesuwa postaci, patrz `rootMotion`). Kierunek `yaw` to azymut
 * `atan2(dx, dz)`, czyli obrót modelu zwróconego przodem do +Z.
 */
export class Patroller {
  x: number;
  z: number;
  yaw: number;
  mode: PatrolMode = "wait";
  /** Przebyta droga w ostatnim `update` (m). */
  lastStep = 0;
  /** Chwilowa prędkość marszu (m/s). */
  speed = 0;
  private index = 0;
  private timer: number;
  private yielded = false;

  constructor(
    private readonly route: readonly Point[],
    start: Point & { yaw: number },
    private readonly config: PatrolConfig,
    private readonly rng: () => number,
  ) {
    this.x = start.x;
    this.z = start.z;
    this.yaw = start.yaw;
    this.timer = this.nextWait();
  }

  get hasRoute(): boolean {
    return this.route.length >= 2;
  }

  /** Czy w ostatnim kroku postać faktycznie się przesunęła (animacja chodu ma się wtedy odtwarzać). */
  get moving(): boolean {
    return this.mode === "walk" && this.lastStep > 1e-6;
  }

  private nextWait(): number {
    return this.config.waitMin + this.rng() * (this.config.waitMax - this.config.waitMin);
  }

  private target(): Point {
    return this.route[(this.index + 1) % this.route.length];
  }

  update(dt: number, ctx: PatrolContext = {}): void {
    const step = Math.min(Math.max(dt, 0), MAX_STEP);
    this.lastStep = 0;
    if (ctx.hold) {
      this.speed = 0;
      this.mode = "hold";
      if (ctx.face) this.yaw = turnToward(this.yaw, Math.atan2(ctx.face.x - this.x, ctx.face.z - this.z), this.config.turnRate * step);
      return;
    }
    if (this.mode === "hold") {
      this.mode = "wait";
      this.timer = Math.min(this.timer, 0.4);
    }
    if (!this.hasRoute) {
      this.mode = "wait";
      this.speed = 0;
      return;
    }
    const target = this.target();
    const bearing = Math.atan2(target.x - this.x, target.z - this.z);
    if (this.mode === "wait") {
      this.yaw = turnToward(this.yaw, bearing, this.config.turnRate * step);
      this.timer -= step;
      const aligned = Math.abs(wrap(bearing - this.yaw)) < ALIGN_EPS;
      if (this.timer <= 0 && aligned && !this.blocked(ctx, this.x + Math.sin(this.yaw) * 0.6, this.z + Math.cos(this.yaw) * 0.6)) this.mode = "walk";
      return;
    }
    const dist = Math.hypot(target.x - this.x, target.z - this.z);
    // Prędkość docelowa: marsz, a przy punkcie hamowanie tak, by zatrzymać się dokładnie na nim.
    const want = Math.max(Math.min(this.config.speed, Math.sqrt(2 * this.config.accel * dist)), MIN_WALK_SPEED);
    this.speed += Math.sign(want - this.speed) * Math.min(Math.abs(want - this.speed), this.config.accel * step);
    const advance = Math.min(dist, this.speed * step);
    const nx = this.x + (dist > 1e-9 ? ((target.x - this.x) / dist) * advance : 0);
    const nz = this.z + (dist > 1e-9 ? ((target.z - this.z) / dist) * advance : 0);
    if (this.blocked(ctx, nx, nz)) {
      this.speed = 0;
      this.mode = "wait";
      this.timer = YIELD_WAIT;
      this.yielded = true;
      return;
    }
    this.yielded = false;
    this.yaw = turnToward(this.yaw, bearing, this.config.turnRate * 2 * step);
    this.x = nx;
    this.z = nz;
    this.lastStep = advance;
    if (dist - advance < 1e-6) {
      this.x = target.x;
      this.z = target.z;
      this.index = (this.index + 1) % this.route.length;
      this.speed = 0;
      this.mode = "wait";
      this.timer = this.nextWait();
    }
  }

  private blocked(ctx: PatrolContext, x: number, z: number): boolean {
    if (!ctx.blockers) return false;
    const radius = ctx.radius ?? 0;
    for (const b of ctx.blockers) {
      const now = Math.hypot(b.x - this.x, b.z - this.z);
      const next = Math.hypot(b.x - x, b.z - z);
      // Zatrzymuje tylko ruch ku przeszkodzie; oddalanie się od niej (np. gdy ktoś podszedł z boku) jest dozwolone.
      if (next < b.r + radius + 0.2 && next <= now) return true;
    }
    return false;
  }

  /** Czy patrol ustąpił komuś na drodze (diagnostyka). */
  get isYielding(): boolean {
    return this.yielded && this.mode === "wait";
  }
}
