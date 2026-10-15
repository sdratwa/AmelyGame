import { MAX_HEALTH } from "../core/constants";
import { result, unchanged, withToast, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";
import { ITEMS } from "../content/items";
import { spend } from "./containers";

/** Odrodzenie: jedzenie przepada, a narzędzia, schemat i surowce zostają (nie da się zablokować questa śmiercią). */
export function respawn(state: GameState): CommandResult {
  if (!state.dead) return unchanged(state);
  let ledger = state.ledger;
  const slots = state.slots.map((s) => {
    if (!s) return null;
    if (ITEMS[s.id].keepOnDeath) return s;
    ledger = spend(ledger, s.id, s.count);
    return null;
  });
  return result(
    withToast(
      {
        ...state,
        dead: false,
        health: MAX_HEALTH,
        drainAcc: 0,
        view: "world",
        dialog: null,
        slots,
        ledger,
        selected: 0,
      },
      "Odradzasz się. Jedzenie przepadło, narzędzia i materiały zostały.",
    ),
    { type: "player.respawned" },
  );
}
