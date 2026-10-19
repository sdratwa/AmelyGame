import { HOURS_PER_DAY, SECONDS_PER_DAY, SECONDS_PER_GAME_HOUR, DAY_START_HOUR } from "../core/constants";
import { result, unchanged, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";

/** Największy skok zegara dozwolony jedną komendą deweloperską. */
const MAX_JUMP = 2 * SECONDS_PER_DAY;

/**
 * Najbliższy moment w przyszłości (czas gry w sekundach), w którym zegar pokazuje godzinę `hour`.
 * Zawsze do przodu, więc blokady zależne od czasu (`lockUntil`) tylko wygasają, a nic nie wraca do przeszłości.
 */
export function nextClockTime(elapsed: number, hour: number): number {
  const current = (DAY_START_HOUR + elapsed / SECONDS_PER_GAME_HOUR) % HOURS_PER_DAY;
  let delta = (((hour - current) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  if (delta < 0.01) delta += HOURS_PER_DAY;
  return elapsed + delta * SECONDS_PER_GAME_HOUR;
}

/** Komenda deweloperska: ręczne przesunięcie zegara gry do przodu (panel diagnostyczny). Nie zmienia nic poza `elapsed`. */
export function devSetClock(state: GameState, elapsed: number): CommandResult {
  if (!Number.isFinite(elapsed) || elapsed <= state.elapsed || elapsed - state.elapsed > MAX_JUMP) return unchanged(state);
  return result({ ...state, elapsed });
}
