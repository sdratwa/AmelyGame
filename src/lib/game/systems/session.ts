import { result, unchanged, type CommandResult } from "../core/result";
import type { GameState, View } from "../core/state";
import type { GameEvent } from "../core/events";
import type { House } from "../content/houses";

export function setName(state: GameState, name: string): CommandResult {
  return result({ ...state, name });
}

export function startLoading(state: GameState): CommandResult {
  const name = state.name.trim();
  if (!name) return unchanged(state);
  return result(
    { ...state, name, phase: "loading" },
    { type: "game.started", name },
  );
}

export function worldReady(state: GameState, houses: House[]): CommandResult {
  if (state.phase !== "loading") return unchanged(state);
  return result({ ...state, phase: "playing", houses }, { type: "world.ready" });
}

export function enterView(state: GameState, view: View): CommandResult {
  if (state.phase !== "playing" || state.dead || state.view !== "world") {
    return unchanged(state);
  }
  if (!state.tutorialDone && view !== "forest") return unchanged(state);
  const completesTutorial = !state.tutorialDone && view === "forest";
  const events: GameEvent[] = [{ type: "view.entered", view }];
  if (completesTutorial) events.push({ type: "tutorial.completed" });
  return result(
    { ...state, view, tutorialDone: state.tutorialDone || view === "forest" },
    ...events,
  );
}

export function leaveView(state: GameState): CommandResult {
  if (state.view === "world") return unchanged(state);
  return result({ ...state, view: "world" }, { type: "view.left", from: state.view });
}

export function clearToast(state: GameState, id: number): CommandResult {
  return state.toast?.id === id
    ? result({ ...state, toast: null })
    : unchanged(state);
}
