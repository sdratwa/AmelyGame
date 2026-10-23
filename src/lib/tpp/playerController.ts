import { ROCK_PHYSICS } from "@/lib/game/world/rockPhysics";
import type { WalkBlock, WalkWorld, WorldFlags } from "@/lib/game/world/walk";
import type { Blocker } from "@/lib/npc/patrol";
import type { TppConfig } from "./config";
import type { PlayerIntent } from "./playerInput";

export const MAX_TPP_DT = 0.1;
/** Różnica wysokości terenu pod stopami (m), od której postać przestaje się "kleić" do ziemi i zaczyna spadać. */
const STEP_DOWN_LIMIT = 0.4;
/** Szybkość doganiania terenu przez stopy po ziemi (1/s): usuwa drgania na nierównościach, nie wprowadza zauważalnego opóźnienia. */
const GROUND_FOLLOW = 28;
/** Największy ruch poziomy (m) i pionowy (m) w jednym kroku cząstkowym, gdy w pobliżu są skały z profilem pionowym. */
const SUBSTEP_MAX_HORIZONTAL = 0.12;
const SUBSTEP_MAX_VERTICAL = 0.08;
const SUBSTEP_MAX_TIME = 1 / 120;
const MAX_SUBSTEPS = 16;

/** Zwrot "do przodu" dla kąta yaw (jak w `FirstPersonController`: Three.js patrzy w -Z, yaw rośnie w lewo). */
export const forwardOfYaw = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const NPC_BLOCK: WalkBlock = { reason: "object", by: "npc" };

/** Rodzaj powierzchni, na której stoi postać. */
export type SurfaceKind = "terrain" | "bridge" | "rock";

/** Powierzchnia podparcia: rodzaj, identyfikator skały (null dla terenu i mostu) i wysokość (m). */
export type SupportInfo = { kind: SurfaceKind; id: string | null; y: number };

/** Ostatnie lądowanie: powierzchnia i prędkość uderzenia (m/s). */
export type LandingInfo = SupportInfo & { impact: number };

/**
 * Świat widziany przez kontroler: chodzenie 2D (`WalkWorld`) plus wysokość podłoża i opcjonalne punkty zaczepienia.
 * Funkcje skał (`rocksNear`, `findLandingSurface`, `supportSurfaceAt`) są opcjonalne: bez nich skały nie mają wysokości
 * (świat 2D, zamrożone wersje generatora i uproszczone światy testowe).
 */
export type PlayerWorld = {
  walk: Pick<WalkWorld, "move" | "config"> & Partial<Pick<WalkWorld, "rocksNear" | "findLandingSurface" | "supportSurfaceAt">>;
  /** Wysokość podłoża pod punktem (teren albo pokład mostu). Skały mają osobne API `supportSurfaceAt` / `findLandingSurface`. */
  groundAt(x: number, z: number): number;
  /** Rodzaj podłoża zwracanego przez `groundAt` (diagnostyka); brak = teren. */
  groundKindAt?(x: number, z: number): "terrain" | "bridge";
  flags?(): WorldFlags | undefined;
  blockers?(): readonly Blocker[];
  /** Czy nad postacią jest miejsce na wstanie; brak = zawsze (świat 2D nie ma sufitów). */
  canStand?(x: number, z: number): boolean;
};

export type PlayerState = {
  x: number;
  /** Wysokość stóp. */
  y: number;
  z: number;
  vx: number;
  vz: number;
  vy: number;
  /** Prędkość pozioma (m/s). */
  speed: number;
  /** Kierunek, w którym patrzy postać (konwencja kamery: `forwardOfYaw`). */
  bodyYaw: number;
  grounded: boolean;
  crouching: boolean;
  /** Aktualna wysokość kapsuły (m), płynnie zmieniana przy kucaniu. */
  capsuleHeight: number;
  /** Czas spędzony w powietrzu (s). */
  airTime: number;
  /** Zdarzenia z ostatniej aktualizacji. */
  justJumped: boolean;
  justLanded: boolean;
  /** Spadek bez skoku (zejście z krawędzi). */
  falling: boolean;
  lastBlock: string | null;
  /** Powierzchnia, na której postać stoi (null w powietrzu). */
  support: SupportInfo | null;
  /** Ostatnie lądowanie (do diagnostyki). */
  lastLanding: LandingInfo | null;
};

const wrapPi = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const moveToward = (v: number, target: number, maxDelta: number) => (Math.abs(target - v) <= maxDelta ? target : v + Math.sign(target - v) * maxDelta);

/**
 * Kinematyczna kapsuła gracza TPP. Niezależna od renderera, modelu i FPS: ruch poziomy idzie przez `WalkWorld.move`
 * (kolizje, zbocza, rzeka, most), pion przez grawitację i `groundAt`. Animacja nigdy nie przesuwa postaci: jedynym
 * źródłem pozycji jest ten kontroler.
 */
export class PlayerController {
  readonly state: PlayerState;
  config: TppConfig;

  constructor(
    private readonly world: PlayerWorld,
    config: TppConfig,
    start: { x: number; z: number; yaw: number },
  ) {
    this.config = config;
    this.state = {
      x: start.x,
      y: world.groundAt(start.x, start.z),
      z: start.z,
      vx: 0,
      vz: 0,
      vy: 0,
      speed: 0,
      bodyYaw: start.yaw,
      grounded: true,
      crouching: false,
      capsuleHeight: config.standHeight,
      airTime: 0,
      justJumped: false,
      justLanded: false,
      falling: false,
      lastBlock: null,
      support: null,
      lastLanding: null,
    };
    this.state.support = this.terrainSupport(start.x, start.z);
  }

  private terrainSupport(x: number, z: number, y = this.world.groundAt(x, z)): SupportInfo {
    return { kind: this.world.groundKindAt?.(x, z) ?? "terrain", id: null, y };
  }

  /** Czas lotu skoku z ziemi na równym terenie (s). */
  get expectedAirTime(): number {
    return (2 * this.jumpSpeed) / this.config.gravity;
  }

  private get jumpSpeed(): number {
    return Math.sqrt(2 * this.config.gravity * this.config.jumpHeight);
  }

  teleport(x: number, z: number, yaw = this.state.bodyYaw): void {
    const s = this.state;
    s.x = x;
    s.z = z;
    s.y = this.world.groundAt(x, z);
    s.vx = s.vz = s.vy = s.speed = 0;
    s.bodyYaw = yaw;
    s.grounded = true;
    s.airTime = 0;
    s.falling = false;
    s.support = this.terrainSupport(x, z, s.y);
  }

  /**
   * Powierzchnia, na którą postać opadłaby teraz (najwyższa pod stopami: teren, most albo wierzch skały); do diagnostyki.
   * Skała jest brana pod uwagę tylko wtedy, gdy stopy są nad jej powierzchnią, więc u podstawy skały wynikiem jest teren.
   */
  potentialLanding(): SupportInfo {
    const s = this.state;
    const ground = this.terrainSupport(s.x, s.z);
    const rock = this.world.walk.supportSurfaceAt?.(s.x, s.z, s.y, 0, Infinity);
    return rock && rock.y >= ground.y ? { kind: "rock", id: rock.id, y: rock.y } : ground;
  }

  /** Lokalny kierunek ruchu względem ciała: `forward` i `right` w m/s (do wyboru animacji). */
  localVelocity(): { forward: number; right: number } {
    const s = this.state;
    const f = forwardOfYaw(s.bodyYaw);
    return { forward: s.vx * f.x + s.vz * f.z, right: s.vx * -f.z + s.vz * f.x };
  }

  /** Wypycha punkt z okręgów NPC; gdy wypchnięcie nie jest możliwe, gracz zostaje w miejscu (jak w `FirstPersonController`). */
  private avoidBlockers(from: { x: number; z: number }, to: { x: number; z: number; blocked: WalkBlock[] }) {
    const blockers = this.world.blockers?.();
    if (!blockers || blockers.length === 0) return to;
    const radius = this.world.walk.config.playerRadius;
    let x = to.x;
    let z = to.z;
    let pushed = false;
    for (const b of blockers) {
      const min = b.r + radius;
      const d = Math.hypot(x - b.x, z - b.z);
      if (d >= min) continue;
      const nx = d > 1e-6 ? (x - b.x) / d : 1;
      const nz = d > 1e-6 ? (z - b.z) / d : 0;
      x = b.x + nx * min;
      z = b.z + nz * min;
      pushed = true;
    }
    if (!pushed) return to;
    const slid = this.world.walk.move({ x: to.x, z: to.z }, { x, z }, this.world.flags?.());
    const inside = blockers.some((b) => Math.hypot(slid.x - b.x, slid.z - b.z) < b.r + radius - 0.02);
    if (inside) return { x: from.x, z: from.z, blocked: [NPC_BLOCK] };
    return { x: slid.x, z: slid.z, blocked: slid.blocked.length > 0 ? slid.blocked : [NPC_BLOCK] };
  }

  private canStandNow(): boolean {
    return this.world.canStand ? this.world.canStand(this.state.x, this.state.z) : true;
  }

  /** `cameraYaw`: kierunek patrzenia kamery (ruch i orientacja w kuckach liczone względem niego). */
  update(dt: number, intent: PlayerIntent, cameraYaw: number): PlayerState {
    const s = this.state;
    const c = this.config;
    s.justJumped = false;
    s.justLanded = false;
    const step = Math.min(Math.max(dt, 0), MAX_TPP_DT);
    if (step <= 0) return s;

    // Kucanie: przełącznik (C); wstać można tylko, gdy jest miejsce. W powietrzu nie zmieniamy pozy.
    if (intent.crouchToggle && s.grounded) {
      if (!s.crouching) s.crouching = true;
      else if (this.canStandNow()) s.crouching = false;
    }
    const wantHeight = s.crouching ? c.crouchHeight : c.standHeight;
    s.capsuleHeight = moveToward(s.capsuleHeight, wantHeight, (Math.abs(c.standHeight - c.crouchHeight) / Math.max(c.crouchTransition, 0.01)) * step);

    // Skok: tylko z ziemi (brak skoku w powietrzu). Skok z kucania wstaje, o ile jest miejsce.
    if (intent.jump && s.grounded) {
      if (s.crouching && this.canStandNow()) s.crouching = false;
      if (!s.crouching) {
        s.vy = this.jumpSpeed;
        s.grounded = false;
        s.airTime = 0;
        s.justJumped = true;
        s.falling = false;
        s.support = null;
      }
    }

    // Prędkość pozioma: cel z kierunku kamery, dochodzenie liniowe (przyspieszanie i hamowanie niezależne od FPS).
    const len = Math.hypot(intent.moveX, intent.moveY);
    const f = forwardOfYaw(cameraYaw);
    const rx = -f.z;
    const rz = f.x;
    const dirX = len > 1e-4 ? (f.x * intent.moveY + rx * intent.moveX) / Math.max(1, len) : 0;
    const dirZ = len > 1e-4 ? (f.z * intent.moveY + rz * intent.moveX) / Math.max(1, len) : 0;
    const top = s.crouching ? c.crouchSpeed : intent.run ? c.runSpeed : c.walkSpeed;
    const tvx = dirX * top * (len > 1e-4 ? 1 : 0);
    const tvz = dirZ * top * (len > 1e-4 ? 1 : 0);
    const accelerating = Math.hypot(tvx, tvz) > Math.hypot(s.vx, s.vz) - 1e-6 && len > 1e-4;
    const rate = (accelerating ? c.acceleration : c.deceleration) * (s.grounded ? 1 : c.airControl) * step;
    const dvx = tvx - s.vx;
    const dvz = tvz - s.vz;
    const dv = Math.hypot(dvx, dvz);
    if (dv <= rate || dv < 1e-9) {
      s.vx = tvx;
      s.vz = tvz;
    } else {
      s.vx += (dvx / dv) * rate;
      s.vz += (dvz / dv) * rate;
    }

    // Przemieszczenie i pion: jeden spójny krok symulacji. Daleko od skał z profilem pionowym to jeden krok cząstkowy
    // (jak dawniej); w pobliżu skał krok jest dzielony tak, by stopy i środek kapsuły nie przeskakiwały bryły skały.
    const moving = Math.abs(s.vx) > 1e-5 || Math.abs(s.vz) > 1e-5;
    const n = this.substepCount(step, moving);
    const h = step / n;
    const x0 = s.x;
    const z0 = s.z;
    const acc: { block: WalkBlock | null } = { block: null };
    for (let i = 0; i < n; i++) this.substep(h, moving, acc);
    if (moving && acc.block) {
      // Przeszkoda: prędkość odpowiada faktycznemu przesunięciu, żeby nie narastała pod ścianą.
      s.vx = (s.x - x0) / step;
      s.vz = (s.z - z0) / step;
      s.lastBlock = `${acc.block.reason}${acc.block.by ? `:${acc.block.by}` : ""}`;
    } else {
      s.lastBlock = null;
    }
    s.speed = Math.hypot(s.vx, s.vz);

    // Orientacja: w marszu i biegu w stronę ruchu; w kuckach w ruchu zgodnie z kamerą (pasują klipy tył i boki); w miejscu bez obrotu.
    let targetYaw: number | null = null;
    if (s.crouching) {
      if (s.speed > 0.1 || len > 1e-4) targetYaw = cameraYaw;
    } else if (s.speed > 0.15) {
      targetYaw = Math.atan2(-s.vx, -s.vz);
    }
    if (targetYaw !== null) {
      const diff = wrapPi(targetYaw - s.bodyYaw);
      const maxTurn = c.turnSpeed * step;
      s.bodyYaw += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
    }

    return s;
  }

  /** Liczba kroków cząstkowych: 1 poza zasięgiem skał z profilem pionowym, w ich pobliżu tyle, by kroki były krótkie. */
  private substepCount(step: number, moving: boolean): number {
    const s = this.state;
    const walk = this.world.walk;
    if (!walk.rocksNear || (s.grounded && !moving)) return 1;
    const travel = Math.hypot(s.vx, s.vz) * step;
    const rise = s.grounded ? 0 : Math.abs(s.vy) * step + 0.5 * this.config.gravity * step * step;
    if (!walk.rocksNear(s.x, s.z, walk.config.playerRadius + travel + rise + 0.3)) return 1;
    const n = Math.ceil(Math.max(travel / SUBSTEP_MAX_HORIZONTAL, rise / SUBSTEP_MAX_VERTICAL, step / SUBSTEP_MAX_TIME));
    return Math.min(MAX_SUBSTEPS, Math.max(1, n));
  }

  private integrateAir(h: number): void {
    const s = this.state;
    s.airTime += h;
    s.vy -= this.config.gravity * h;
    s.y += s.vy * h;
  }

  private land(surface: SupportInfo): void {
    const s = this.state;
    s.lastLanding = { ...surface, impact: Math.abs(s.vy) };
    s.y = surface.y;
    s.vy = 0;
    s.grounded = true;
    s.justLanded = true;
    s.falling = false;
    s.support = surface;
  }

  /**
   * Powierzchnia pod stopami stojącej postaci: teren albo pokład (`groundAt`) oraz wierzch skały, ale tylko taki, który
   * leży w zasięgu "dogonienia" (kilka cm nad stopami, do `STEP_DOWN_LIMIT` pod nimi). Wierzch skały znacznie wyżej niż
   * stopy nie jest podłożem, więc stojąc u jej podstawy postać nie wskakuje na szczyt.
   */
  private groundSurface(x: number, z: number, y: number): SupportInfo {
    const ground = this.terrainSupport(x, z);
    const rock = this.world.walk.supportSurfaceAt?.(x, z, y, ROCK_PHYSICS.stepUp, STEP_DOWN_LIMIT);
    return rock && rock.y >= ground.y ? { kind: "rock", id: rock.id, y: rock.y } : ground;
  }

  /**
   * Jeden krok cząstkowy `h` (s): (A) całkowanie pionu i lądowanie na skale nad bieżącym punktem, (B) ruch poziomy z
   * wysokością stóp (skała blokuje tylko, gdy stopy są niżej niż jej szczyt z zapasem), (C) dogonienie powierzchni
   * albo utrata gruntu, (D) spadanie po zejściu z krawędzi, (E) lądowanie w nowym punkcie (skała, potem teren).
   */
  private substep(h: number, moving: boolean, acc: { block: WalkBlock | null }): void {
    const s = this.state;
    const walk = this.world.walk;
    const startedAir = !s.grounded;
    const prevY = s.y;

    if (startedAir) {
      this.integrateAir(h);
      if (s.vy <= 0) {
        const rock = walk.findLandingSurface?.(s.x, s.z, prevY, s.y);
        if (rock) this.land({ kind: "rock", id: rock.id, y: rock.y });
      }
    }

    if (moving) {
      const from = { x: s.x, z: s.z };
      const body = { footY: Math.min(prevY, s.y), supportId: s.support?.kind === "rock" ? s.support.id : null, slideStep: ROCK_PHYSICS.edgeSlideSpeed * h };
      let result = walk.move(from, { x: s.x + s.vx * h, z: s.z + s.vz * h }, this.world.flags?.(), body);
      result = this.avoidBlockers(from, result);
      if (result.blocked.length > 0 && !acc.block) acc.block = result.blocked[0];
      s.x = result.x;
      s.z = result.z;
    }

    if (s.grounded) {
      const surface = this.groundSurface(s.x, s.z, s.y);
      if (s.y - surface.y > STEP_DOWN_LIMIT) {
        s.grounded = false;
        s.vy = 0;
        s.airTime = 0;
        s.falling = true;
        s.support = null;
      } else {
        s.y += (surface.y - s.y) * (1 - Math.exp(-GROUND_FOLLOW * h));
        if (Math.abs(surface.y - s.y) < 1e-4) s.y = surface.y;
        s.support = surface;
      }
    }
    if (!s.grounded && !startedAir) this.integrateAir(h);

    if (!s.grounded && s.vy <= 0) {
      const rock = walk.findLandingSurface?.(s.x, s.z, prevY, s.y);
      if (rock) this.land({ kind: "rock", id: rock.id, y: rock.y });
      else {
        const ground = this.terrainSupport(s.x, s.z);
        if (s.y <= ground.y) this.land(ground);
      }
    }
  }
}
