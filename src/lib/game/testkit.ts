import type { ItemId, ItemStack } from "./content/items";
import { INVENTORY_SLOTS } from "./core/constants";

/** Tylko testy: lista przedmiotów (po jednej sztuce) lub stosów zamieniona na pełną tablicę miejsc ekwipunku. */
export function slotsFrom(list: readonly (ItemId | ItemStack | null)[]): (ItemStack | null)[] {
  const out: (ItemStack | null)[] = Array.from({ length: INVENTORY_SLOTS }, () => null);
  list.forEach((entry, i) => {
    out[i] = entry === null ? null : typeof entry === "string" ? { id: entry, count: 1 } : { ...entry };
  });
  return out;
}
