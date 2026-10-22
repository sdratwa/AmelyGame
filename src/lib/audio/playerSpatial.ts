import { FootstepScheduler, PLAYER_STRIDE } from "./footsteps";
import type { Player } from "../multiplayer/protocol";
export const SPATIAL_DEFAULTS = {
  enabled: true,
  volume: 1,
  walkRange: 22,
  runRange: 36,
  crouchRange: 6,
  rolloff: 1,
  refDistance: 2,
};
export function stepGain(
  distance: number,
  range: number,
  ref = 2,
  rolloff = 1,
) {
  const t = Math.max(
    0,
    Math.min(1, (distance - range * 0.65) / (range * 0.35)),
  );
  return (
    (ref / (ref + rolloff * (Math.max(ref, distance) - ref))) *
    (1 - t * t * (3 - 2 * t))
  );
}
export class PlayerStepEmitter {
  readonly scheduler = new FootstepScheduler({
    ...PLAYER_STRIDE,
    walkStride: 1.2,
    runStride: 1.8,
  });
  private previous: Player | null = null;
  update(p: Player, dt: number) {
    const last = this.previous;
    this.previous = p;
    return this.scheduler.update(
      last ? Math.hypot(p.x - last.x, p.z - last.z) : 0,
      dt,
      !p.grounded || p.speed < 0.1,
    );
  }
}
