import type { House } from "../content/houses";
import type { ItemId } from "../content/items";
import { respawn } from "../systems/death";
import { buyHouse, upgradeHouse } from "../systems/houses";
import { buyItem, eatSelected, selectSlot } from "../systems/inventory";
import {
  clearToast,
  enterView,
  leaveView,
  setName,
  startLoading,
  worldReady,
} from "../systems/session";
import { tick } from "../systems/vitals";
import type { GameEvent } from "./events";
import { addPause, clearPauseOwner, pauseReasons, removePause } from "./pause";
import { unchanged, type CommandResult } from "./result";
import type { GameState, View } from "./state";

/**
 * Wszystkie zmiany stanu gry. Komendy są serializowalne, więc te same obiekty
 * może w przyszłości walidować i wykonywać serwer.
 */
export type Command =
  | { type: "setName"; name: string }
  | { type: "startLoading" }
  | { type: "worldReady"; houses: House[] }
  | { type: "tick"; dt: number }
  | { type: "enter"; view: View }
  | { type: "leave" }
  | { type: "buy"; item: ItemId }
  | { type: "buyHouse"; id: string }
  | { type: "upgradeHouse"; id: string }
  | { type: "select"; slot: number }
  | { type: "eat" }
  | { type: "respawn" }
  | { type: "clearToast"; id: number }
  | { type: "pause.add"; reason: string; owner: string }
  | { type: "pause.remove"; reason: string; owner: string }
  | { type: "pause.clearOwner"; owner: string };

/** Nazwa zachowana dla zgodności ze starszym kodem. */
export type Action = Command;

function execute(state: GameState, command: Command): CommandResult {
  switch (command.type) {
    case "setName":
      return setName(state, command.name);
    case "startLoading":
      return startLoading(state);
    case "worldReady":
      return worldReady(state, command.houses);
    case "tick":
      return tick(state, command.dt);
    case "enter":
      return enterView(state, command.view);
    case "leave":
      return leaveView(state);
    case "buy":
      return buyItem(state, command.item);
    case "buyHouse":
      return buyHouse(state, command.id);
    case "upgradeHouse":
      return upgradeHouse(state, command.id);
    case "select":
      return selectSlot(state, command.slot);
    case "eat":
      return eatSelected(state);
    case "respawn":
      return respawn(state);
    case "clearToast":
      return clearToast(state, command.id);
    case "pause.add":
      return addPause(state, { reason: command.reason, owner: command.owner });
    case "pause.remove":
      return removePause(state, { reason: command.reason, owner: command.owner });
    case "pause.clearOwner":
      return clearPauseOwner(state, command.owner);
    default:
      return unchanged(state);
  }
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Jedyne API zmian stanu gry: zwraca nowy stan i zdarzenia będące skutkiem komendy. */
export function applyCommand(state: GameState, command: Command): CommandResult {
  const outcome = execute(state, command);
  const before = pauseReasons(state);
  const after = pauseReasons(outcome.state);
  if (sameList(before, after)) return outcome;
  const pauseEvent: GameEvent = {
    type: "time.pause_changed",
    paused: after.length > 0,
    reasons: after,
  };
  return { state: outcome.state, events: [...outcome.events, pauseEvent] };
}

/** Cienka nakładka dla `useReducer`. */
export function reducer(state: GameState, command: Command): GameState {
  return applyCommand(state, command).state;
}
