import { normalizeAppearance, sameAppearance, type CharacterAppearanceV1 } from "@/lib/character/appearance";
import { result, unchanged, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";

/**
 * Ustawia wygląd postaci gracza. Wejście jest zawsze normalizowane (nieznane elementy i złe kolory nie przechodzą do
 * stanu), a identyczny wygląd nie zmienia stanu. Komenda nie dotyka zegara, życia, ekwipunku, pozycji ani questów.
 */
export function setAppearance(state: GameState, appearance: CharacterAppearanceV1): CommandResult {
  if (state.phase !== "playing") return unchanged(state);
  const next = normalizeAppearance(appearance);
  if (sameAppearance(next, state.appearance)) return unchanged(state);
  return result({ ...state, appearance: next });
}
