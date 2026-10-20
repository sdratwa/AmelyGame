import type { HeightField } from "@/lib/game/world/terrain";
import type { WalkBlock, WalkWorld, WorldFlags } from "@/lib/game/world/walk";
import type { Blocker } from "@/lib/npc/patrol";

export const EYE_HEIGHT = 1.62;
export const WALK_SPEED = 3.2;
export const SPRINT_SPEED = 5.6;
export const MAX_FRAME_DT = 0.1;
const MAX_PITCH = 1.45;
const NPC_BLOCK: WalkBlock = { reason: "object", by: "npc" };

export type PlayerState = { x: number; z: number; yaw: number; pitch: number; eyeY: number };
export type MoveInput = { forward: number; right: number; sprint: boolean };

/** Wektor "do przodu" dla kąta yaw (kamera Three.js patrzy w -Z, yaw rośnie w lewo). */
export function forwardOf(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/**
 * Sterowanie pierwszoosobowe (WASD + mysz) niezależne od renderera i FPS: ruch w metrach na sekundę, kolizje i zbocza
 * z `WalkWorld` (W0), wysokość oczu z `terrain.height` z gładkim śledzeniem (bez drgań na nierównościach).
 */
export class FirstPersonController {
  readonly state: PlayerState;
  /** Ostatnia blokada z W0 (do diagnostyki). */
  lastBlock: string | null = null;
  /** Flagi świata (np. `bridge.built` otwiera przejście przez rzekę); zmieniane z zewnątrz w trakcie gry. */
  flags: WorldFlags | undefined;
  /** Ruchome okręgi kolizji (NPC): gracz nie wchodzi w nie, ale też nie zostaje wypchnięty w drzewo lub rzekę. */
  blockers: readonly Blocker[] = [];
  /**
   * Dodatkowa warstwa powierzchni (pokład mostu): wysokość pod punktem albo null poza pokładem. Teren nadal pochodzi
   * wyłącznie z `terrain.height`; tu bierzemy wyższą z obu wartości, więc oczy nigdy nie schodzą poniżej gruntu.
   * Ustawiana tylko, gdy most jest zbudowany.
   */
  deckHeight: ((x: number, z: number) => number | null) | null = null;

  constructor(
    private readonly walk: WalkWorld,
    private readonly terrain: HeightField,
    start: { x: number; z: number; yaw: number },
  ) {
    this.state = { x: start.x, z: start.z, yaw: start.yaw, pitch: -0.05, eyeY: terrain.height(start.x, start.z) + EYE_HEIGHT };
  }

  /** Wysokość powierzchni, po której chodzi gracz: teren albo (na zbudowanym moście) wyższy pokład. */
  groundAt(x: number, z: number): number {
    const terrain = this.terrain.height(x, z);
    const deck = this.deckHeight?.(x, z);
    return deck == null ? terrain : Math.max(terrain, deck);
  }

  teleport(x: number, z: number, yaw = this.state.yaw): void {
    this.state.x = x;
    this.state.z = z;
    this.state.yaw = yaw;
    this.state.eyeY = this.groundAt(x, z) + EYE_HEIGHT;
  }

  look(dx: number, dy: number, sensitivity = 0.0022): void {
    this.state.yaw -= dx * sensitivity;
    this.state.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.state.pitch - dy * sensitivity));
  }

  /**
   * Obrót kamery wychyleniem analoga: `x` w prawo, `y` w dół (po deadzone i krzywej), `yawRate`/`pitchRate` w rad/s przy
   * pełnym wychyleniu. Prędkość zależy od `dt` (niezależna od FPS), bez wygładzania; pitch ma ten sam limit co mysz.
   */
  lookAnalog(x: number, y: number, dt: number, yawRate: number, pitchRate: number): void {
    const step = Math.min(Math.max(dt, 0), MAX_FRAME_DT);
    this.state.yaw -= x * yawRate * step;
    this.state.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.state.pitch - y * pitchRate * step));
  }

  /** Wypycha punkt z okręgów kolizji NPC; wypchnięcie sprawdza `walk.move`, a gdy nie da się go wykonać, gracz zostaje w miejscu. */
  private avoidBlockers(from: { x: number; z: number }, to: { x: number; z: number; blocked: WalkBlock[] }) {
    if (this.blockers.length === 0) return to;
    const radius = this.walk.config.playerRadius;
    let x = to.x;
    let z = to.z;
    let pushed = false;
    for (const b of this.blockers) {
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
    const slid = this.walk.move({ x: to.x, z: to.z }, { x, z }, this.flags);
    const stillInside = this.blockers.some((b) => Math.hypot(slid.x - b.x, slid.z - b.z) < b.r + radius - 0.02);
    if (stillInside) return { x: from.x, z: from.z, blocked: [NPC_BLOCK] };
    return { x: slid.x, z: slid.z, blocked: slid.blocked.length > 0 ? slid.blocked : [NPC_BLOCK] };
  }

  /** Zwraca przebytą odległość (m). `dt` w sekundach; długie klatki są obcinane do `MAX_FRAME_DT`. */
  update(dt: number, input: MoveInput): number {
    const step = Math.min(Math.max(dt, 0), MAX_FRAME_DT);
    const s = this.state;
    let moved = 0;
    const len = Math.hypot(input.forward, input.right);
    if (len > 0.001 && step > 0) {
      const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
      const f = forwardOf(s.yaw);
      const rx = -f.z;
      const rz = f.x;
      const vx = (f.x * input.forward + rx * input.right) / Math.max(1, len);
      const vz = (f.z * input.forward + rz * input.right) / Math.max(1, len);
      let result = this.walk.move({ x: s.x, z: s.z }, { x: s.x + vx * speed * step, z: s.z + vz * speed * step }, this.flags);
      result = this.avoidBlockers({ x: s.x, z: s.z }, result);
      moved = Math.hypot(result.x - s.x, result.z - s.z);
      s.x = result.x;
      s.z = result.z;
      this.lastBlock = result.blocked.length > 0 ? `${result.blocked[0].reason}${result.blocked[0].by ? `:${result.blocked[0].by}` : ""}` : null;
    }
    const target = this.groundAt(s.x, s.z) + EYE_HEIGHT;
    s.eyeY += (target - s.eyeY) * (1 - Math.exp(-14 * Math.max(step, 1 / 240)));
    return moved;
  }
}
