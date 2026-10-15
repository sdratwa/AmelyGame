import { describe, expect, it } from "vitest";
import { idKind, isIdOfKind } from "./ids";

describe("identyfikatory z przestrzeni nazw", () => {
  it("rozpoznaje rodzaj identyfikatora", () => {
    expect(idKind("quest.bridge_01")).toBe("quest");
    expect(idKind("chest.bridge.pickaxe")).toBe("chest");
    expect(isIdOfKind("npc.troll.bridge", "npc")).toBe(true);
    expect(isIdOfKind("npc.troll.bridge", "quest")).toBe(false);
  });

  it("odrzuca napisy bez przestrzeni nazw", () => {
    expect(idKind("hotdog")).toBeNull();
    expect(idKind(".x")).toBeNull();
    expect(idKind("x.")).toBeNull();
    expect(isIdOfKind("Kilof", "item")).toBe(false);
  });
});
