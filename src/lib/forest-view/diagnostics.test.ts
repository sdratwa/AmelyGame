import { describe, expect, it } from "vitest";
import { nearestCreature } from "./diagnostics";

const npc = (distance: number) => ({ distance }) as never;

describe("nearestCreature", () => {
  it("wybiera bliższe z trolla i jelenia", () => {
    expect(nearestCreature({ npc: npc(30), deer: npc(12.5) })).toEqual({ name: "jeleń", distance: 12.5 });
    expect(nearestCreature({ npc: npc(8), deer: npc(12.5) })).toEqual({ name: "troll", distance: 8 });
  });

  it("radzi sobie z brakiem modeli i dystansem jeszcze niewyliczonym", () => {
    expect(nearestCreature({ npc: null, deer: null })).toBeNull();
    expect(nearestCreature({})).toBeNull();
    expect(nearestCreature({ npc: npc(Infinity), deer: npc(20) })).toEqual({ name: "jeleń", distance: 20 });
    expect(nearestCreature({ npc: npc(Infinity), deer: null })).toBeNull();
  });
});
