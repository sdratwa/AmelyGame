import { describe, expect, it } from "vitest";
import { ITEMS, ITEM_IDS, LEGACY_ITEM_IDS, type ItemId, type ItemStack } from "../content/items";
import { slotsFrom } from "../testkit";
import {
  addToPile,
  addToSlots,
  canAdd,
  capacityFor,
  confiscate,
  countOf,
  inventoryProblems,
  recover,
  removeFromSlots,
  totalsOf,
} from "./containers";

describe("E2: stosy i kontenery", () => {
  it("dopełnia istniejące stosy, potem zajmuje puste miejsca; nadwyżka wraca jako reszta", () => {
    let slots = slotsFrom(["item.phone"]);
    const a = addToSlots(slots, "resource.wood", 25);
    expect(a.added).toBe(25);
    expect(a.slots.filter(Boolean).map((s) => s!.count)).toEqual([1, 20, 5]);
    slots = a.slots;
    const b = addToSlots(slots, "resource.wood", 20);
    expect(b.slots[2]).toEqual({ id: "resource.wood", count: 20 });
    expect(countOf(b.slots, "resource.wood")).toBe(45);
    const full = addToSlots(slotsFrom(["item.phone"]), "resource.stone", 999);
    expect(full.added).toBe(7 * 20);
    expect(full.rest).toBe(999 - 140);
  });

  it("przedmioty niestosowalne zajmują po jednym miejscu; pojemność jest liczona poprawnie", () => {
    const slots = slotsFrom(["item.phone", "item.pickaxe"]);
    expect(capacityFor(slots, "item.saw")).toBe(6);
    expect(capacityFor(slots, "resource.wood")).toBe(120);
    expect(canAdd(slots, "item.saw", 6)).toBe(true);
    expect(canAdd(slots, "item.saw", 7)).toBe(false);
  });

  it("odejmowanie nie schodzi poniżej zera i nie zmienia wejścia", () => {
    const slots = slotsFrom(["item.phone", { id: "resource.wood", count: 7 }]);
    const snapshot = JSON.stringify(slots);
    expect(removeFromSlots(slots, "resource.wood", 8).ok).toBe(false);
    const r = removeFromSlots(slots, "resource.wood", 7);
    expect(r.ok).toBe(true);
    expect(r.slots[1]).toBeNull();
    expect(JSON.stringify(slots)).toBe(snapshot);
  });

  it("konfiskata zostawia tylko przedmioty chronione, a odzyskanie zwraca dokładnie to samo", () => {
    const slots = slotsFrom(["item.phone", "item.pickaxe", { id: "resource.wood", count: 14 }, "item.hotdog", "item.hotdog"]);
    const before = totalsOf(slots);
    const { slots: kept, taken } = confiscate(slots);
    expect(kept.filter(Boolean)).toEqual([{ id: "item.phone", count: 1 }]);
    expect(totalsOf(taken)).toEqual({ "item.pickaxe": 1, "resource.wood": 14, "item.hotdog": 2 });
    const back = recover(kept, taken);
    expect(back.pile).toEqual([]);
    expect(totalsOf(back.slots)).toEqual(before);
  });

  it("odzyskanie przy braku miejsca zachowuje resztę w depozycie, najpierw rzeczy niewyrzucalne", () => {
    const pile: ItemStack[] = [
      { id: "item.water", count: 3 },
      { id: "item.hotdog", count: 2 },
      { id: "item.pickaxe", count: 1 },
    ];
    const slots = slotsFrom(["item.phone", "item.coffee", "item.coffee", "item.coffee", "item.coffee", "item.coffee", "item.coffee"]);
    const back = recover(slots, pile);
    expect(back.slots.some((s) => s?.id === "item.pickaxe")).toBe(true);
    expect(back.pile.some((s) => s.id === "item.pickaxe")).toBe(false);
    expect(totalsOf(back.pile).hasOwnProperty("item.pickaxe")).toBe(false);
    const lost = [...back.moved, ...back.pile];
    expect(totalsOf(lost)).toEqual({ "item.water": 3, "item.hotdog": 2, "item.pickaxe": 1 });
  });

  it("depozyt łączy takie same przedmioty bez limitu stosu", () => {
    let pile: ItemStack[] = [];
    pile = addToPile(pile, "resource.wood", 20);
    pile = addToPile(pile, "resource.wood", 20);
    expect(pile).toEqual([{ id: "resource.wood", count: 40 }]);
  });

  it("niezmienniki: księga zgodna z zawartością, brak duplikatów unikatów, poprawne stosy", () => {
    const slots = slotsFrom(["item.phone", "item.saw"]);
    const ok = inventoryProblems(slots, [], { gained: { "item.phone": 1, "item.saw": 1 }, spent: {} });
    expect(ok).toEqual([]);
    expect(inventoryProblems(slots, [{ id: "item.saw", count: 1 }], { gained: { "item.phone": 1, "item.saw": 2 }, spent: {} }).join()).toContain("powielony");
    expect(inventoryProblems(slots, [], { gained: { "item.phone": 1, "item.saw": 2 }, spent: {} }).join()).toContain("księga");
    const overstack = slotsFrom(["item.phone", { id: "resource.wood", count: 21 }]);
    expect(inventoryProblems(overstack, [], { gained: { "item.phone": 1, "resource.wood": 21 }, spent: {} }).join()).toContain("zła liczba");
  });

  it("definicje przedmiotów: identyfikatory z przestrzeni nazw, telefon chroniony, zgodność ze starymi zapisami", () => {
    for (const id of ITEM_IDS) {
      expect(id).toMatch(/^(item|resource)\./);
      expect(ITEMS[id].id).toBe(id);
      expect(ITEMS[id].maxStack).toBeGreaterThanOrEqual(1);
    }
    expect(ITEMS["item.phone"].protected).toBe(true);
    expect(ITEM_IDS.filter((id) => ITEMS[id].protected)).toEqual(["item.phone"]);
    for (const mapped of Object.values(LEGACY_ITEM_IDS)) expect(ITEM_IDS).toContain(mapped);
    expect(Object.keys(LEGACY_ITEM_IDS).sort()).toEqual(["chocolate", "coffee", "hotdog", "phone", "sandwich", "water"]);
  });

  it("własność losowa: dowolne dodawania i odejmowania nie gubią ani nie tworzą sztuk", () => {
    let x = 12345;
    const rnd = () => {
      x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) | 0;
      return (x >>> 0) / 4294967296;
    };
    for (let round = 0; round < 200; round++) {
      let slots = slotsFrom(["item.phone"]);
      const expected: Record<string, number> = { "item.phone": 1 };
      for (let i = 0; i < 40; i++) {
        const id = ITEM_IDS[Math.floor(rnd() * ITEM_IDS.length)] as ItemId;
        if (id === "item.phone") continue;
        const n = 1 + Math.floor(rnd() * 12);
        if (rnd() < 0.6) {
          const r = addToSlots(slots, id, n);
          slots = r.slots;
          expected[id] = (expected[id] ?? 0) + r.added;
          expect(r.added + r.rest).toBe(n);
        } else {
          const r = removeFromSlots(slots, id, n);
          slots = r.slots;
          if (r.ok) expected[id] -= n;
        }
        for (const s of slots) if (s) expect(s.count).toBeLessThanOrEqual(ITEMS[s.id].maxStack);
      }
      const actual = totalsOf(slots);
      for (const [id, n] of Object.entries(expected)) expect(actual[id] ?? 0).toBe(n);
      const { slots: kept, taken } = confiscate(slots);
      const back = recover(kept, taken);
      expect(back.pile).toEqual([]);
      expect(totalsOf(back.slots)).toEqual(totalsOf(slots));
    }
  });
});
