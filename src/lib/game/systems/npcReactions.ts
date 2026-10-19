import { applyCommand, type Command } from "../core/apply";
import type { GameEvent } from "../core/events";
import type { GameState } from "../core/state";

/**
 * Adapter prezentacji: zamienia zdarzenia silnika na reakcje NPC (animacje). Niczego nie zmienia w stanie gry i nie
 * zawiera logiki questa; zdarzenia są już skutkiem decyzji silnika (konfiskata, zagadki i blokada skrzyni zostają bez zmian).
 */
export type NpcReaction = { npc: "troll"; kind: "angry"; cause: GameEvent["type"] };

/** Nieudana interakcja z trollem lub jego skrzynią: próba otwarcia pilnowanej skrzyni, zła odpowiedź na zagadkę, konfiskata. */
export function reactionsFor(events: readonly GameEvent[]): NpcReaction[] {
  const out: NpcReaction[] = [];
  for (const event of events) {
    if (event.type === "chest.open_failed" && event.reason === "guarded") out.push({ npc: "troll", kind: "angry", cause: event.type });
    else if (event.type === "troll.riddle_answered" && !event.correct) out.push({ npc: "troll", kind: "angry", cause: event.type });
    else if (event.type === "troll.confiscated") out.push({ npc: "troll", kind: "angry", cause: event.type });
  }
  return out;
}

/**
 * Wysyła komendę do silnika i zgłasza reakcje NPC. Zdarzenia są liczone czystą funkcją `applyCommand` na tym samym stanie,
 * co komenda, więc wynik jest zgodny z tym, co zrobi reducer; sam stan zmienia wyłącznie `dispatch`.
 */
export function dispatchWithReactions(state: GameState, command: Command, dispatch: (command: Command) => void, onReaction: (reaction: NpcReaction) => void): void {
  const { events } = applyCommand(state, command);
  dispatch(command);
  for (const reaction of reactionsFor(events)) onReaction(reaction);
}
