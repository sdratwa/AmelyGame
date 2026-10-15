import { INVENTORY_SLOTS, MAX_HEALTH } from "../core/constants";
import { result, unchanged, withToast, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";
import { ITEMS, type ItemId } from "../content/items";
import { addToSlots, canAdd, gain, removeFromSlots, spend } from "./containers";

export function buyItem(state: GameState, itemId: ItemId): CommandResult {
  if (state.dead) return unchanged(state);
  const item = ITEMS[itemId];
  if (!item || item.category !== "food") return unchanged(state);
  if (!canAdd(state.slots, itemId, 1)) {
    return result(
      withToast(state, "Ekwipunek pełny (maks. 8 miejsc).", "error"),
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
  const { slots } = addToSlots(state.slots, itemId, 1);
  return result(
    withToast(
      {
        ...state,
        slots,
        ledger: gain(state.ledger, itemId, 1),
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
  const stack = state.slots[state.selected];
  if (!stack) return unchanged(state);
  const item = ITEMS[stack.id];
  if (item.heal <= 0) return unchanged(state);
  const removed = removeFromSlots(state.slots, stack.id, 1);
  const health = Math.min(MAX_HEALTH, state.health + item.heal);
  const healed = health - state.health;
  return result(
    withToast(
      { ...state, slots: removed.slots, ledger: spend(state.ledger, stack.id, 1), health, selected: 0 },
      `${item.name}: +${healed}% życia`,
    ),
    { type: "item.eaten", item: stack.id, healed },
  );
}

/** Wyrzucenie całego stosu z miejsca (tylko przedmioty `discardable`): zwalnia miejsce, gdy ekwipunek jest pełny. */
export function discardSlot(state: GameState, slot: number): CommandResult {
  if (state.dead || slot < 0 || slot >= INVENTORY_SLOTS) return unchanged(state);
  const stack = state.slots[slot];
  if (!stack || !ITEMS[stack.id].discardable) return unchanged(state);
  const slots = [...state.slots];
  slots[slot] = null;
  return result(
    withToast(
      { ...state, slots, ledger: spend(state.ledger, stack.id, stack.count) },
      `Wyrzucono: ${ITEMS[stack.id].name}`,
    ),
    { type: "item.discarded", item: stack.id, count: stack.count },
  );
}
