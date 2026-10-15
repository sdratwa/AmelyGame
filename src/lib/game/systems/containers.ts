import { ITEMS, type ItemId, type ItemStack } from "../content/items";
import type { Ledger } from "../core/state";

export type Slots = (ItemStack | null)[];

/** Operacje na kontenerach (ekwipunek, depozyt) są czyste: zwracają nowe tablice i nigdy nie gubią ani nie powielają sztuk. */

export function countOf(slots: readonly (ItemStack | null)[], id: ItemId): number {
  let n = 0;
  for (const s of slots) if (s && s.id === id) n += s.count;
  return n;
}

export function totalsOf(stacks: readonly (ItemStack | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of stacks) if (s) out[s.id] = (out[s.id] ?? 0) + s.count;
  return out;
}

/** Ile sztuk danego przedmiotu zmieści się jeszcze w kontenerze. */
export function capacityFor(slots: readonly (ItemStack | null)[], id: ItemId): number {
  const max = ITEMS[id].maxStack;
  let room = 0;
  for (const s of slots) {
    if (s === null) room += max;
    else if (s.id === id) room += max - s.count;
  }
  return room;
}

export function canAdd(slots: readonly (ItemStack | null)[], id: ItemId, count: number): boolean {
  return count <= capacityFor(slots, id);
}

/** Dodaje tyle sztuk, ile się zmieści (najpierw dopełnia stosy, potem zajmuje puste miejsca); reszta wraca w `rest`. */
export function addToSlots(
  slots: readonly (ItemStack | null)[],
  id: ItemId,
  count: number,
): { slots: Slots; added: number; rest: number } {
  const max = ITEMS[id].maxStack;
  const next: Slots = slots.map((s) => (s ? { ...s } : null));
  let left = count;
  for (let i = 0; i < next.length && left > 0; i++) {
    const s = next[i];
    if (s && s.id === id && s.count < max) {
      const put = Math.min(max - s.count, left);
      s.count += put;
      left -= put;
    }
  }
  for (let i = 0; i < next.length && left > 0; i++) {
    if (next[i] === null) {
      const put = Math.min(max, left);
      next[i] = { id, count: put };
      left -= put;
    }
  }
  return { slots: next, added: count - left, rest: left };
}

/** Odejmuje sztuki (od ostatnich stosów); gdy brakuje, nic nie zmienia i zwraca `ok: false`. */
export function removeFromSlots(
  slots: readonly (ItemStack | null)[],
  id: ItemId,
  count: number,
): { slots: Slots; ok: boolean } {
  if (countOf(slots, id) < count) return { slots: slots.map((s) => (s ? { ...s } : null)), ok: false };
  const next: Slots = slots.map((s) => (s ? { ...s } : null));
  let left = count;
  for (let i = next.length - 1; i >= 0 && left > 0; i--) {
    const s = next[i];
    if (s && s.id === id) {
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count === 0) next[i] = null;
    }
  }
  return { slots: next, ok: true };
}

/** Dodaje do listy sum (depozyt nie ma limitu stosu), łącząc takie same przedmioty. */
export function addToPile(pile: readonly ItemStack[], id: ItemId, count: number): ItemStack[] {
  if (count <= 0) return pile.map((s) => ({ ...s }));
  const next = pile.map((s) => ({ ...s }));
  const hit = next.find((s) => s.id === id);
  if (hit) hit.count += count;
  else next.push({ id, count });
  return next;
}

/** Zabiera z kontenera wszystko, co nie jest chronione (telefon zostaje); zwraca zabrane sumy w stałej kolejności. */
export function confiscate(slots: readonly (ItemStack | null)[]): { slots: Slots; taken: ItemStack[] } {
  let taken: ItemStack[] = [];
  const next: Slots = slots.map((s) => {
    if (!s) return null;
    if (ITEMS[s.id].protected) return { ...s };
    taken = addToPile(taken, s.id, s.count);
    return null;
  });
  return { slots: next, taken };
}

/** Przenosi z depozytu do ekwipunku tyle, ile się zmieści; reszta zostaje w depozycie. */
export function recover(
  slots: readonly (ItemStack | null)[],
  pile: readonly ItemStack[],
): { slots: Slots; pile: ItemStack[]; moved: ItemStack[] } {
  let cur: Slots = slots.map((s) => (s ? { ...s } : null));
  const rest: ItemStack[] = [];
  const moved: ItemStack[] = [];
  // Najpierw rzeczy, których nie da się wyrzucić (narzędzia, schemat, surowce): jedzenie nie może ich wyprzeć.
  const ordered = [...pile].sort((a, b) => Number(ITEMS[a.id].discardable) - Number(ITEMS[b.id].discardable));
  for (const entry of ordered) {
    const res = addToSlots(cur, entry.id, entry.count);
    cur = res.slots;
    if (res.added > 0) moved.push({ id: entry.id, count: res.added });
    if (res.rest > 0) rest.push({ id: entry.id, count: res.rest });
  }
  return { slots: cur, pile: rest, moved };
}

export function bump(record: Record<string, number>, id: string, n: number): Record<string, number> {
  return n === 0 ? record : { ...record, [id]: (record[id] ?? 0) + n };
}

export const gain = (ledger: Ledger, id: ItemId, n: number): Ledger => ({ ...ledger, gained: bump(ledger.gained, id, n) });
export const spend = (ledger: Ledger, id: ItemId, n: number): Ledger => ({ ...ledger, spent: bump(ledger.spent, id, n) });

/**
 * Niezmienniki ekwipunku: poprawne stosy, zgodność księgi (zdobyte - wydane = u gracza + w depozycie) i brak
 * duplikatów przedmiotów niestosowalnych (narzędzia, schemat). Zwraca listę naruszeń (pustą, gdy wszystko gra).
 */
export function inventoryProblems(
  slots: readonly (ItemStack | null)[],
  deposit: readonly ItemStack[],
  ledger: Ledger,
): string[] {
  const problems: string[] = [];
  slots.forEach((s, i) => {
    if (!s) return;
    const def = ITEMS[s.id];
    if (!Number.isInteger(s.count) || s.count < 1 || s.count > def.maxStack) {
      problems.push(`slots[${i}]: zła liczba sztuk (${s.id} x${s.count})`);
    }
  });
  const held = totalsOf(slots);
  const stored = totalsOf(deposit);
  const ids = new Set([...Object.keys(ledger.gained), ...Object.keys(ledger.spent), ...Object.keys(held), ...Object.keys(stored)]);
  for (const id of ids) {
    const balance = (ledger.gained[id] ?? 0) - (ledger.spent[id] ?? 0);
    const actual = (held[id] ?? 0) + (stored[id] ?? 0);
    if (balance !== actual) problems.push(`${id}: księga ${balance}, faktycznie ${actual}`);
    if (id in ITEMS && ITEMS[id as ItemId].maxStack === 1 && ITEMS[id as ItemId].category !== "food" && actual > 1) {
      problems.push(`${id}: powielony przedmiot unikatowy (${actual})`);
    }
  }
  return problems;
}
