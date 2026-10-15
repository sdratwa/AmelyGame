import { getClock, type Season } from "../core/clock";
import { isTimePaused } from "../core/pause";
import { result, unchanged, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";

/** Health lost per real second. */
export function drainPerSecond(
  season: Season,
  isDay: boolean,
  sheltered: boolean,
): number {
  if (sheltered) return 0;
  if (season === "winter") return isDay ? 1 / 10 : 1 / 5;
  return isDay ? 0 : 1 / 10;
}

export function isSheltered(state: Pick<GameState, "view">): boolean {
  return state.view === "shop";
}

export function tick(state: GameState, dtSeconds: number): CommandResult {
  if (isTimePaused(state)) return unchanged(state);

  const dt = Math.max(0, dtSeconds);
  const elapsed = state.elapsed + dt;
  const clock = getClock(elapsed);
  const rate = drainPerSecond(clock.season, clock.isDay, isSheltered(state));
  let acc = state.drainAcc + rate * dt;
  let health = state.health;
  while (acc >= 1 - 1e-9 && health > 0) {
    acc -= 1;
    health -= 1;
  }
  if (health <= 0) {
    const deaths = state.deaths + 1;
    return result(
      { ...state, elapsed, health: 0, drainAcc: 0, dead: true, deaths },
      { type: "player.died", deaths },
    );
  }
  return result({ ...state, elapsed, health, drainAcc: acc });
}
