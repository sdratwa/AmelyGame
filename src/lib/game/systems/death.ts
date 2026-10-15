import { MAX_HEALTH } from "../core/constants";
import { result, unchanged, withToast, type CommandResult } from "../core/result";
import { initialSlots, type GameState } from "../core/state";

export function respawn(state: GameState): CommandResult {
  if (!state.dead) return unchanged(state);
  return result(
    withToast(
      {
        ...state,
        dead: false,
        health: MAX_HEALTH,
        drainAcc: 0,
        view: "world",
        slots: initialSlots(),
        selected: 0,
      },
      "Odradzasz się z telefonem. Reszta rzeczy przepadła.",
    ),
    { type: "player.respawned" },
  );
}
