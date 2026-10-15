import { INVENTORY_SLOTS, MAX_HEALTH } from "../core/constants";
import { result, unchanged, withToast, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";
import { ITEMS, type ItemId } from "../content/items";

export function buyItem(state: GameState, itemId: ItemId): CommandResult {
  if (state.dead) return unchanged(state);
  const item = ITEMS[itemId];
  const free = state.slots.indexOf(null);
  if (free === -1) {
    return result(
      withToast(state, "Ekwipunek pełny (maks. 8 przedmiotów).", "error"),
      { type: "item.purchase_failed", item: itemId, reason: "inventory_full" },
    );
  }
  if (state.wallet < item.price) {
    return result(withToast(state, "Za mało pieniędzy.", "error"), {
      type: "item.purchase_failed",
      item: itemId,
      reason: "no_money",
    });
  }
  const slots = [...state.slots];
  slots[free] = item.id;
  return result(
    withToast(
      {
        ...state,
        slots,
        wallet: state.wallet - item.price,
      },
      `Kupiono: ${item.name} (−${item.price} zł)`,
    ),
    { type: "item.purchased", item: itemId, price: item.price },
  );
}

export function selectSlot(state: GameState, slot: number): CommandResult {
  if (slot < 0 || slot >= INVENTORY_SLOTS) return unchanged(state);
  return result({ ...state, selected: slot });
}

export function eatSelected(state: GameState): CommandResult {
  if (state.dead) return unchanged(state);
  const id = state.slots[state.selected];
  if (!id) return unchanged(state);
  const item = ITEMS[id];
  if (item.heal <= 0) return unchanged(state);
  const slots = [...state.slots];
  slots[state.selected] = null;
  const health = Math.min(MAX_HEALTH, state.health + item.heal);
  const healed = health - state.health;
  return result(
    withToast(
      { ...state, slots, health, selected: 0 },
      `${item.name}: +${healed}% życia`,
    ),
    { type: "item.eaten", item: id, healed },
  );
}
