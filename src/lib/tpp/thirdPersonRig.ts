import { pushOutOfCollider } from "@/lib/game/world/objects";
import { rockWallTop } from "@/lib/game/world/rockPhysics";
import type { HeightField } from "@/lib/game/world/terrain";
import type { WalkWorld, WorldFlags } from "@/lib/game/world/walk";
import type { Blocker } from "@/lib/npc/patrol";
import type { AnimIntent } from "./animationState";
import { ThirdPersonCamera, type CameraPose, type CameraWorld } from "./cameraRig";
import { mergeTppConfig, TPP_DEFAULTS, type TppConfig } from "./config";
import { PlayerController, type LandingInfo, type PlayerState, type PlayerWorld, type SupportInfo } from "./playerController";
import { PlayerInput, type PlayerIntent } from "./playerInput";
import { FREE_GATE, type MovementGate } from "@/lib/hideseek/types";

/** Dane diagnostyczne (panel deweloperski); wypełniane bez alokacji w klatce, czytane rzadko. */
export type TppSnapshot = {
  x: number;
  y: number;
  z: number;
  speed: number;
  grounded: boolean;
  crouching: boolean;
  airborne: boolean;
  bodyYawDeg: number;
  terrainY: number;
  cameraDistance: number;
  cameraYawDeg: number;
  cameraPitchDeg: number;
  lastBlock: string | null;
  /** Prędkość pionowa (m/s); `y` to wysokość stóp. */
  vy: number;
  /** Powierzchnia podparcia (null w powietrzu): rodzaj, identyfikator skały i wysokość. */
  support: SupportInfo | null;
  /** Skała, na której postać stoi (null poza skałą). */
  rockId: string | null;
  /** Ostatnie lądowanie. */
  lastLanding: LandingInfo | null;
  /** Powierzchnia, na którą postać opadłaby teraz (teren, most albo wierzch skały pod stopami), z wysokością. */
  landingCandidate: SupportInfo | null;
};

/** Wysokość (nad podłożem), do której obiekt zasłania kamerę: drzewa w całości, skały do ok. 2,6 m skali, reszta niska. */
function obstacleTopOf(kind: string, scale: number): number {
  if (kind === "tree" || kind === "ancient") return 99;
  if (kind === "rock") return 2.6 * scale;
  return 1.6;
}

const DEG = 180 / Math.PI;

/**
 * Całość logiki TPP bez Three.js: wejście -> kontroler (kapsuła) -> kamera. Renderer tylko woła `update(dt)`, ustawia
 * kamerę z `camera.pose` i rysuje model w `controller.state`. Flagi świata, blokery NPC i pokład mostu ustawia z zewnątrz
 * (tak samo jak w `FirstPersonController`).
 */
export class ThirdPersonRig {
  readonly input = new PlayerInput();
  readonly controller: PlayerController;
  readonly camera: ThirdPersonCamera;
  flags: WorldFlags | undefined;
  blockers: readonly Blocker[] = [];
  deckHeight: ((x: number, z: number) => number | null) | null = null;
  /** Bramka ruchu z zabawy w chowanego (domyślnie wolny ruch); ten sam opis egzekwuje serwer w handlerze `motion`. */
  private gate: MovementGate = FREE_GATE;
  private readonly gated: PlayerIntent = { moveX: 0, moveY: 0, run: false, crouchToggle: false, jump: false, lookDx: 0, lookDy: 0 };
  private cfg: TppConfig;
  private readonly anim: AnimIntent = { crouching: false, airborne: false, speed: 0, forward: 0, right: 0 };
  private readonly snap: TppSnapshot = {
    x: 0,
    y: 0,
    z: 0,
    speed: 0,
    grounded: true,
    crouching: false,
    airborne: false,
    bodyYawDeg: 0,
    terrainY: 0,
    cameraDistance: 0,
    cameraYawDeg: 0,
    cameraPitchDeg: 0,
    lastBlock: null,
    vy: 0,
    support: null,
    rockId: null,
    lastLanding: null,
    landingCandidate: null,
  };

  constructor(
    private readonly walk: WalkWorld,
    private readonly terrain: HeightField,
    start: { x: number; z: number; yaw: number },
    config: Partial<TppConfig> = {},
  ) {
    this.cfg = mergeTppConfig({ ...TPP_DEFAULTS }, config);
    const playerWorld: PlayerWorld = {
      walk,
      groundAt: (x, z) => this.groundAt(x, z),
      groundKindAt: (x, z) => this.groundKindAt(x, z),
      flags: () => this.flags,
      blockers: () => this.blockers,
    };
    const cameraWorld: CameraWorld = {
      groundAt: (x, z) => this.groundAt(x, z),
      obstacleTop: (x, z, r) => {
        let top = 0;
        for (const o of walk.index.queryRadius(x, z, r)) {
          if (!o.collider || !pushOutOfCollider(o, x, z, r).hit) continue;
          // Skała z profilem: zasłania kamerę dokładnie do swojego szczytu (a nie do szacunku ze skali), więc kamera nie
          // zacina się przy postaci stojącej na wierzchu.
          const t = o.rock ? Math.max(0, rockWallTop(o) - this.groundAt(x, z)) : obstacleTopOf(o.kind, Math.max(o.scale ?? 1, o.scaleXYZ?.[1] ?? 1));
          if (t > top) top = t;
        }
        return top;
      },
    };
    this.controller = new PlayerController(playerWorld, this.cfg, start);
    this.camera = new ThirdPersonCamera(cameraWorld, this.cfg, start.yaw);
    this.camera.snap();
  }

  get config(): Readonly<TppConfig> {
    return this.cfg;
  }

  setConfig(patch: Partial<TppConfig>): void {
    this.cfg = mergeTppConfig(this.cfg, patch);
    this.controller.config = this.cfg;
    this.camera.config = this.cfg;
  }

  /** Powierzchnia, po której chodzi gracz: teren albo (na zbudowanym moście) wyższy pokład. */
  groundAt(x: number, z: number): number {
    const t = this.terrain.height(x, z);
    const deck = this.deckHeight?.(x, z);
    return deck == null ? t : Math.max(t, deck);
  }

  /** Rodzaj podłoża z `groundAt`: teren albo pokład mostu. */
  groundKindAt(x: number, z: number): "terrain" | "bridge" {
    const deck = this.deckHeight?.(x, z);
    return deck != null && deck > this.terrain.height(x, z) ? "bridge" : "terrain";
  }

  teleport(x: number, z: number, yaw: number): void {
    this.controller.teleport(x, z, yaw);
    this.camera.yaw = yaw;
    this.camera.snap();
  }

  /** Ustawia bramkę ruchu (wołane co klatkę z aktualnego stanu zabawy; ta sama bramka nic nie zmienia). */
  setGate(gate: MovementGate): void {
    if (gate === this.gate) return;
    this.gate = gate;
    this.camera.lookLocked = !gate.allowLook;
    this.camera.lockedDown = gate.cameraDown;
  }

  /** Korekta pozycji z serwera (odrzucony ruch): natychmiastowe przeniesienie w poziomie bez zmiany pionu. */
  snapHorizontal(x: number, z: number): void {
    this.controller.anchorHorizontal(x, z);
  }

  /** Jedna aktualizacja na klatkę: wejście, ruch kapsuły, kamera. Zwraca stan gracza (współdzielony obiekt). */
  update(dt: number): PlayerState {
    const raw = this.input.consume();
    const gate = this.gate;
    let intent = raw;
    if (gate !== FREE_GATE) {
      const g = this.gated;
      g.lookDx = raw.lookDx;
      g.lookDy = raw.lookDy;
      g.moveX = gate.anchor ? 0 : raw.moveX;
      g.moveY = gate.anchor ? 0 : raw.moveY;
      g.run = gate.anchor ? false : raw.run;
      g.jump = gate.allowJump && raw.jump;
      g.crouchToggle = gate.allowCrouch && raw.crouchToggle;
      intent = g;
    }
    this.camera.look(intent.lookDx, intent.lookDy);
    const s = this.controller.update(dt, intent, this.camera.yaw);
    if (gate.anchor) {
      this.controller.anchorHorizontal(gate.anchor.x, gate.anchor.z);
      if (gate.allowLook) this.controller.turnToward(this.camera.yaw, dt);
    }
    const c = this.cfg;
    this.camera.update(dt, { x: s.x, y: s.y + c.cameraTargetHeight * (s.capsuleHeight / c.standHeight), z: s.z });
    return s;
  }

  /** Dane dla animacji w bieżącej klatce (obiekt współdzielony). */
  animIntent(): AnimIntent {
    const s = this.controller.state;
    const v = this.controller.localVelocity();
    const a = this.anim;
    a.crouching = s.crouching;
    a.airborne = !s.grounded;
    a.speed = s.speed;
    a.forward = v.forward;
    a.right = v.right;
    return a;
  }

  /** Wysokość oczu (głowy) do warstw gry, które czytają `FirstPersonController.state.eyeY`. */
  get eyeY(): number {
    const s = this.controller.state;
    return s.y + s.capsuleHeight * 0.92;
  }

  snapshot(): TppSnapshot {
    const s = this.controller.state;
    const o = this.snap;
    o.x = s.x;
    o.y = s.y;
    o.z = s.z;
    o.speed = s.speed;
    o.grounded = s.grounded;
    o.crouching = s.crouching;
    o.airborne = !s.grounded;
    o.bodyYawDeg = ((((s.bodyYaw * DEG) % 360) + 540) % 360) - 180;
    o.terrainY = this.terrain.height(s.x, s.z);
    o.cameraDistance = this.camera.distance;
    o.cameraYawDeg = ((((this.camera.yaw * DEG) % 360) + 540) % 360) - 180;
    o.cameraPitchDeg = this.camera.pitch * DEG;
    o.lastBlock = s.lastBlock;
    o.vy = s.vy;
    o.support = s.support;
    o.rockId = s.support?.kind === "rock" ? s.support.id : null;
    o.lastLanding = s.lastLanding;
    o.landingCandidate = this.controller.potentialLanding();
    return o;
  }

  get cameraPose(): CameraPose {
    return this.camera.pose;
  }

  dispose(): void {
    this.input.dispose();
  }
}
