import { result, unchanged, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";

/**
 * Lampa naftowa: stałe wyposażenie z dwoma stanami (wyłączona/zapalona). Nie zużywa paliwa, nie zajmuje miejsca w
 * ekwipunku i nie da się jej stracić, więc jedyną zmianą stanu jest przełącznik. Martwy gracz nie obsługuje lampy.
 * Komenda `lantern.set` jest idempotentna: powtórzenie tego samego stanu nie zmienia niczego (ani referencji stanu),
 * dzięki czemu autorepeat klawisza lub podwójne dotknięcie nie wywołają zdarzenia dwa razy.
 */
export function setLantern(state: GameState, enabled: boolean): CommandResult {
  if (state.dead || typeof enabled !== "boolean" || state.lantern.enabled === enabled) return unchanged(state);
  return result({ ...state, lantern: { enabled } }, { type: "lantern.changed", enabled });
}

export function toggleLantern(state: GameState): CommandResult {
  return setLantern(state, !state.lantern.enabled);
}
