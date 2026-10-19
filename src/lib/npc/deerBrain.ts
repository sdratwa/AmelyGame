import { segmentFree, type Point } from "./patrol";

export type DeerMode = "rest" | "stroll" | "alert" | "retreat";

export type DeerConfig = {
  /** Prędkość chodu z animacji (m/s): bez ślizgania stóp przy mnożniku 1. */
  walkSpeed: number;
  /** Mnożniki `walkSpeed` dla spaceru i spokojnego odejścia (oba to chód, bez galopu). */
  strollFactor: number;
  retreatFactor: number;
  /** Poniżej tej odległości od gracza jeleń staje i patrzy na niego; spokojny dopiero powyżej `relaxDistance` (histereza). */
  alertDistance: number;
  relaxDistance: number;
  /** Promień spaceru wokół punktu domowego (m) i największe oddalenie przy odejściu przed graczem (m). */
  leash: number;
  retreatLeash: number;
  /** Czas postoju (s), czas patrzenia na gracza przed odejściem (s). */
  rest: readonly [number, number];
  alert: readonly [number, number];
  /** Obrót ciała (rad/s) i jego przyspieszenie kątowe (rad/s^2). */
  turnRate: number;
  turnAccel: number;
  accel: number;
  decel: number;
};

export const DEER_BEHAVIOR: Omit<DeerConfig, "walkSpeed"> = {
  strollFactor: 0.85,
  retreatFactor: 1.25,
  alertDistance: 10,
  relaxDistance: 13,
  leash: 4.5,
  retreatLeash: 24,
  rest: [3, 8],
  alert: [1.6, 2.6],
  turnRate: 1.6,
  turnAccel: 4,
  accel: 0.9,
  decel: 1.8,
};

export type DeerEnv = {
  /** Czy jeleń (z zapasem na rozmiar ciała) może stać w punkcie. */
  free(x: number, z: number): boolean;
};

const TWO_PI = Math.PI * 2;
const wrap = (a: number) => {
  const r = a % TWO_PI;
  return r > Math.PI ? r - TWO_PI : r < -Math.PI ? r + TWO_PI : r;
};
const ARRIVE = 0.25;
/** Błąd kierunku (rad), powyżej którego jeleń obraca się w miejscu zamiast iść. */
const PIVOT_ERROR = 0.9;
const MAX_STEP = 0.1;
const SEGMENT_STEP = 0.6;
const RETREAT_ANGLES = [0, 0.5, -0.5, 1.0, -1.0, 1.55, -1.55];
const RETREAT_DISTANCES = [9, 6, 4];

/**
 * Zachowanie jelenia (czysta logika, bez Three.js): odpoczynek, spacer po polanie, czujność i spokojne odejście od gracza.
 * Pozycja świata należy do mózgu (animacja chodzi w miejscu). Każdy cel spaceru i odejścia jest sprawdzany odcinkiem
 * `segmentFree`, a każdy krok dodatkowo `free`, więc jeleń nigdy nie wchodzi w drzewo, skałę, rzekę ani poza granice.
 * Nie ma galopu: najszybszy ruch to marsz z mnożnikiem `retreatFactor`.
 */
export class DeerBrain {
  x: number;
  z: number;
  yaw: number;
  mode: DeerMode = "rest";
  /** Chwilowa prędkość (m/s) i prędkość kątowa obrotu (rad/s). */
  speed = 0;
  yawVelocity = 0;
  /** Gdzie jeleń patrzy: gracz w stanie czujności, inaczej null. */
  lookAt: Point | null = null;
  /** Aktualny cel ruchu (spacer lub odejście). */
  target: Point | null = null;
  /** Odległość od gracza w ostatnim kroku (m), Infinity bez gracza. */
  distance = Infinity;
  /** Liczba odejść przed graczem od startu (diagnostyka i testy). */
  retreats = 0;
  /** Przebyta droga w ostatnim kroku (m). */
  lastStep = 0;
  private timer: number;
  private factor = 1;
  private cornered = false;
  private player: Point | null = null;

  constructor(
    private readonly config: DeerConfig,
    readonly home: Point,
    yaw: number,
    private readonly env: DeerEnv,
    private readonly rng: () => number,
  ) {
    this.x = home.x;
    this.z = home.z;
    this.yaw = yaw;
    this.timer = this.between(config.rest) * 0.5;
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rng() * (hi - lo);
  }

  get moving(): boolean {
    return this.lastStep > 1e-6;
  }

  /** Jeleń obraca się w miejscu (bez przesuwania). */
  get turning(): boolean {
    return Math.abs(this.yawVelocity) > 0.2 && this.speed < 0.05;
  }

  get homeDistance(): number {
    return Math.hypot(this.x - this.home.x, this.z - this.home.z);
  }

  /** Mnożnik prędkości animacji chodu względem `walkSpeed`. */
  get gaitFactor(): number {
    return this.speed / Math.max(this.config.walkSpeed, 1e-6);
  }

  private free = (x: number, z: number) => this.env.free(x, z);

  update(dt: number, player?: Point | null): void {
    const step = Math.min(Math.max(dt, 0), MAX_STEP);
    this.lastStep = 0;
    this.player = player ?? null;
    this.distance = player ? Math.hypot(player.x - this.x, player.z - this.z) : Infinity;
    const c = this.config;
    const near = this.distance < c.alertDistance;
    switch (this.mode) {
      case "rest":
        this.lookAt = null;
        this.settle(step);
        if (near) this.enterAlert();
        else if ((this.timer -= step) <= 0) this.beginStroll();
        break;
      case "stroll":
        this.lookAt = null;
        if (near) this.enterAlert();
        else if (this.walkTo(step, c.strollFactor)) this.finishWalk();
        break;
      case "alert":
        this.alert(step, player ?? null);
        break;
      case "retreat":
        this.lookAt = null;
        if (this.walkTo(step, this.factor)) {
          this.target = null;
          if (near) this.enterAlert(0.6);
          else this.enterRest();
        }
        break;
    }
  }

  private enterRest(): void {
    this.mode = "rest";
    this.target = null;
    this.timer = this.between(this.config.rest);
  }

  private enterAlert(minHold = 0): void {
    this.mode = "alert";
    this.target = null;
    this.cornered = false;
    this.lookAt = this.player;
    this.timer = Math.max(this.between(this.config.alert), minHold);
  }

  private finishWalk(): void {
    this.target = null;
    this.enterRest();
  }

  /** Hamuje do zera (łagodnie) i kończy obrót ku `face`, jeśli podano. */
  private settle(step: number, face?: Point): void {
    if (this.speed > 1e-3) {
      this.speed = Math.max(0, this.speed - this.config.decel * step);
      this.advance(step, Math.sin(this.yaw), Math.cos(this.yaw));
    } else this.speed = 0;
    if (face) this.turnToward(Math.atan2(face.x - this.x, face.z - this.z), step);
    else this.yawVelocity = 0;
  }

  private alert(step: number, player: Point | null): void {
    this.lookAt = player;
    this.settle(step, player ?? undefined);
    if (!player || this.distance >= this.config.relaxDistance) {
      this.lookAt = null;
      this.enterRest();
      this.timer = this.between([1.5, 3.5]);
      return;
    }
    this.timer -= step;
    const aligned = Math.abs(wrap(Math.atan2(player.x - this.x, player.z - this.z) - this.yaw)) < 0.35;
    if (this.timer > 0 || !aligned || this.speed > 1e-3) return;
    // Spokojne odejście: gdy niczego bezpiecznego nie ma (zapędzony w kąt), stoi i dalej patrzy zamiast przechodzić obok gracza.
    const target = this.pickRetreat(player);
    if (target) {
      this.mode = "retreat";
      this.target = target;
      this.factor = this.config.retreatFactor;
      this.retreats++;
      this.cornered = false;
    } else {
      this.cornered = true;
      this.timer = 1;
    }
  }

  /** Czy jeleń stoi zapędzony: gracz blisko, a nie ma bezpiecznego kierunku odejścia. */
  get isCornered(): boolean {
    return this.cornered;
  }

  /** Wybiera punkt odejścia: wachlarz kierunków od gracza, najlepszy to najdalszy od niego, bez mijania go i w granicach smyczy. */
  pickRetreat(player: Point): Point | null {
    const away = Math.atan2(this.x - player.x, this.z - player.z);
    const here = this.distance;
    let best: { p: Point; score: number } | null = null;
    for (const offset of RETREAT_ANGLES) {
      for (const distance of RETREAT_DISTANCES) {
        const a = away + offset;
        const p = { x: this.x + Math.sin(a) * distance, z: this.z + Math.cos(a) * distance };
        if (Math.hypot(p.x - this.home.x, p.z - this.home.z) > this.config.retreatLeash) continue;
        const gain = Math.hypot(p.x - player.x, p.z - player.z) - here;
        if (gain < 2.5) continue;
        if (!this.free(p.x, p.z) || !segmentFree(this, p, this.free, SEGMENT_STEP)) continue;
        // Preferuje odejście wprost od gracza i dalekie, ale lekko ciągnie ku domowi, żeby nie uciekać w głąb lasu.
        const score = gain - Math.abs(offset) * 1.2 + 0.05 * (this.homeDistance - Math.hypot(p.x - this.home.x, p.z - this.home.z));
        if (!best || score > best.score) best = { p, score };
      }
    }
    return best ? best.p : null;
  }

  /** Cel spaceru nie może leżeć w strefie czujności gracza: spokojny jeleń nie idzie sam w jego stronę. */
  private calmFor(p: Point): boolean {
    return !this.player || Math.hypot(p.x - this.player.x, p.z - this.player.z) >= this.config.alertDistance + 0.5;
  }

  /** Wybiera cel spaceru: punkt na polanie, a gdy jeleń jest za daleko od domu, krok w stronę domu. */
  private beginStroll(): void {
    const c = this.config;
    let target: Point | null = null;
    if (this.homeDistance > c.leash + 0.5) {
      const toHome = Math.atan2(this.home.x - this.x, this.home.z - this.z);
      for (const offset of [0, 0.4, -0.4, 0.9, -0.9]) {
        const d = Math.min(8, this.homeDistance);
        const p = { x: this.x + Math.sin(toHome + offset) * d, z: this.z + Math.cos(toHome + offset) * d };
        if (this.calmFor(p) && this.free(p.x, p.z) && segmentFree(this, p, this.free, SEGMENT_STEP)) {
          target = p;
          break;
        }
      }
    } else {
      for (let i = 0; i < 12 && !target; i++) {
        const angle = this.rng() * TWO_PI;
        const radius = 1.5 + this.rng() * (c.leash - 1.5);
        const p = { x: this.home.x + Math.sin(angle) * radius, z: this.home.z + Math.cos(angle) * radius };
        if (Math.hypot(p.x - this.x, p.z - this.z) < 1.5) continue;
        if (this.calmFor(p) && this.free(p.x, p.z) && segmentFree(this, p, this.free, SEGMENT_STEP)) target = p;
      }
    }
    if (!target) {
      this.timer = this.between([2, 4]);
      return;
    }
    this.mode = "stroll";
    this.target = target;
    this.factor = c.strollFactor;
  }

  /** Jeden krok ku celowi; true po dojściu (albo gdy dalsza droga jest zablokowana: wtedy kończy spacer w miejscu). */
  private walkTo(step: number, factor: number): boolean {
    const target = this.target;
    if (!target) return true;
    const c = this.config;
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ARRIVE) {
      this.settle(step);
      if (this.speed < 1e-3) return true;
      return false;
    }
    const bearing = Math.atan2(dx, dz);
    const error = Math.abs(wrap(bearing - this.yaw));
    this.turnToward(bearing, step);
    const vmax = c.walkSpeed * factor;
    const want = error > PIVOT_ERROR ? 0 : Math.min(vmax, Math.sqrt(2 * c.decel * Math.max(dist - ARRIVE * 0.5, 0)) + 0.15) * Math.max(0.3, Math.cos(error));
    const delta = want - this.speed;
    this.speed += Math.sign(delta) * Math.min(Math.abs(delta), (delta > 0 ? c.accel : c.decel) * step);
    if (this.speed < 1e-3) return false;
    const advance = Math.min(dist, this.speed * step);
    const nx = this.x + (dx / dist) * advance;
    const nz = this.z + (dz / dist) * advance;
    if (!this.free(nx, nz)) {
      this.speed = 0;
      this.target = null;
      return true;
    }
    this.x = nx;
    this.z = nz;
    this.lastStep = advance;
    return false;
  }

  private advance(step: number, dirX: number, dirZ: number): void {
    const advance = this.speed * step;
    const nx = this.x + dirX * advance;
    const nz = this.z + dirZ * advance;
    if (!this.free(nx, nz)) {
      this.speed = 0;
      return;
    }
    this.x = nx;
    this.z = nz;
    this.lastStep = advance;
  }

  /** Obrót ciała ku azymutowi z ograniczoną prędkością i przyspieszeniem kątowym (łagodny start i hamowanie). */
  private turnToward(target: number, step: number): void {
    const alpha = this.config.turnAccel;
    const error = wrap(target - this.yaw);
    const desired = Math.sign(error) * Math.min(this.config.turnRate, Math.sqrt(2 * alpha * Math.abs(error)));
    const dv = desired - this.yawVelocity;
    this.yawVelocity += Math.sign(dv) * Math.min(Math.abs(dv), alpha * step);
    const move = this.yawVelocity * step;
    if (Math.abs(error) <= Math.abs(move) || Math.abs(error) < 1e-4) {
      this.yaw = target;
      this.yawVelocity = 0;
    } else this.yaw = wrap(this.yaw + move);
  }
}
