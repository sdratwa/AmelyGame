import type { CommandResult } from "./result";
import { result, unchanged } from "./result";
import type { GameState, PauseEntry } from "./state";

export const SYSTEM_PAUSE_PREFIX = "system.";

/**
 * Powody zatrzymania zegara. Systemowe wynikają ze stanu gry, jawne pochodzą
 * z komend (`pause.add`). Zegar idzie tylko wtedy, gdy lista jest pusta.
 */
export function pauseReasons(
  state: Pick<GameState, "phase" | "dead" | "tutorialDone" | "pauses">,
): string[] {
  const reasons: string[] = [];
  if (state.phase !== "playing") reasons.push("system.not_playing");
  if (state.dead) reasons.push("system.dead");
  if (!state.tutorialDone) reasons.push("system.tutorial");
  for (const entry of state.pauses) {
    if (!reasons.includes(entry.reason)) reasons.push(entry.reason);
  }
  return reasons;
}

export function isTimePaused(
  state: Pick<GameState, "phase" | "dead" | "tutorialDone" | "pauses">,
): boolean {
  return pauseReasons(state).length > 0;
}

const isValidEntry = (entry: PauseEntry) =>
  entry.reason.length > 0 &&
  entry.owner.length > 0 &&
  !entry.reason.startsWith(SYSTEM_PAUSE_PREFIX);

const sameEntry = (a: PauseEntry, b: PauseEntry) =>
  a.reason === b.reason && a.owner === b.owner;

export function addPause(state: GameState, entry: PauseEntry): CommandResult {
  if (!isValidEntry(entry)) return unchanged(state);
  if (state.pauses.some((p) => sameEntry(p, entry))) return unchanged(state);
  return result({ ...state, pauses: [...state.pauses, entry] });
}

export function removePause(state: GameState, entry: PauseEntry): CommandResult {
  if (!state.pauses.some((p) => sameEntry(p, entry))) return unchanged(state);
  return result({
    ...state,
    pauses: state.pauses.filter((p) => !sameEntry(p, entry)),
  });
}

/** Usuwa wszystkie powody danego właściciela (np. przy zamknięciu widoku). */
export function clearPauseOwner(state: GameState, owner: string): CommandResult {
  if (!state.pauses.some((p) => p.owner === owner)) return unchanged(state);
  return result({
    ...state,
    pauses: state.pauses.filter((p) => p.owner !== owner),
  });
}
