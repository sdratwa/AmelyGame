import type { GameEvent } from "./events";
import type { GameState } from "./state";

export type CommandResult = { state: GameState; events: GameEvent[] };

/** Komenda bez skutku: ta sama referencja stanu, brak zdarzeń. */
export function unchanged(state: GameState): CommandResult {
  return { state, events: [] };
}

export function result(state: GameState, ...events: GameEvent[]): CommandResult {
  return { state, events };
}

/** Zwraca stan z nowym komunikatem; identyfikator jest częścią stanu (bez zmiennych modułu). */
export function withToast(
  state: GameState,
  text: string,
  tone: "ok" | "error" = "ok",
): GameState {
  const id = state.toastSeq + 1;
  return { ...state, toastSeq: id, toast: { id, text, tone } };
}
