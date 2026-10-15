import { describe, expect, it } from "vitest";
import { applyCommand, reducer } from "./apply";
import { initialState, type GameState } from "./state";
import { generateHouse } from "../systems/houses";

const playing = (over: Partial<GameState> = {}): GameState => ({
  ...initialState,
  phase: "playing",
  tutorialDone: true,
  ...over,
});

describe("applyCommand", () => {
  it("reducer zwraca ten sam stan co applyCommand", () => {
    const s = playing();
    const cmd = { type: "buy", item: "hotdog" } as const;
    expect(reducer(s, cmd)).toEqual(applyCommand(s, cmd).state);
  });

  it("komenda bez skutku zwraca tę samą referencję stanu i brak zdarzeń", () => {
    const s = playing();
    const out = applyCommand(s, { type: "eat" });
    expect(out.state).toBe(s);
    expect(out.events).toEqual([]);
  });

  it("nieznana komenda nic nie zmienia", () => {
    const s = playing();
    const out = applyCommand(s, { type: "nope" } as never);
    expect(out.state).toBe(s);
    expect(out.events).toEqual([]);
  });

  it("start gry i świat emitują zdarzenia", () => {
    let s: GameState = { ...initialState, name: "  Ala " };
    const started = applyCommand(s, { type: "startLoading" });
    expect(started.events).toEqual([{ type: "game.started", name: "Ala" }]);
    s = started.state;
    const ready = applyCommand(s, { type: "worldReady", houses: [] });
    const types = ready.events.map((e) => e.type);
    expect(types).toContain("world.ready");
    expect(types).toContain("time.pause_changed");
  });

  it("zakup emituje zdarzenie i deterministyczny komunikat", () => {
    const out = applyCommand(playing(), { type: "buy", item: "hotdog" });
    expect(out.events).toEqual([{ type: "item.purchased", item: "hotdog", price: 12 }]);
    expect(out.state.toast).toEqual({
      id: 1,
      text: "Kupiono: Hot-dog (−12 zł)",
      tone: "ok",
    });
    expect(out.state.toastSeq).toBe(1);
  });

  it("nieudany zakup informuje o powodzie", () => {
    const full = playing({
      slots: ["phone", "water", "water", "water", "water", "water", "water", "water"],
    });
    expect(applyCommand(full, { type: "buy", item: "water" }).events).toEqual([
      { type: "item.purchase_failed", item: "water", reason: "inventory_full" },
    ]);
    const poor = playing({ wallet: 1 });
    expect(applyCommand(poor, { type: "buy", item: "water" }).events).toEqual([
      { type: "item.purchase_failed", item: "water", reason: "no_money" },
    ]);
  });

  it("identyfikatory komunikatów rosną w ramach stanu, bez zmiennych modułu", () => {
    const a = applyCommand(playing(), { type: "buy", item: "water" }).state;
    const b = applyCommand(a, { type: "buy", item: "water" }).state;
    expect(a.toast?.id).toBe(1);
    expect(b.toast?.id).toBe(2);
    const other = applyCommand(playing(), { type: "buy", item: "water" }).state;
    expect(other.toast?.id).toBe(1);
  });

  it("jedzenie, śmierć i odrodzenie emitują zdarzenia", () => {
    const eat = applyCommand(
      playing({ health: 50, slots: ["phone", "hotdog", null, null, null, null, null, null], selected: 1 }),
      { type: "eat" },
    );
    expect(eat.events).toEqual([{ type: "item.eaten", item: "hotdog", healed: 25 }]);

    const died = applyCommand(playing({ health: 1 }), { type: "tick", dt: 10 });
    expect(died.events.map((e) => e.type)).toEqual(["player.died", "time.pause_changed"]);
    expect(died.state.dead).toBe(true);

    const back = applyCommand(died.state, { type: "respawn" });
    expect(back.events.map((e) => e.type)).toEqual(["player.respawned", "time.pause_changed"]);
  });

  it("wejście do lasu kończy tutorial i emituje zdarzenia", () => {
    const out = applyCommand(playing({ tutorialDone: false }), { type: "enter", view: "forest" });
    expect(out.events.map((e) => e.type)).toEqual([
      "view.entered",
      "tutorial.completed",
      "time.pause_changed",
    ]);
    const left = applyCommand(out.state, { type: "leave" });
    expect(left.events).toEqual([{ type: "view.left", from: "forest" }]);
  });

  it("domy emitują zdarzenia kupna i ulepszenia", () => {
    const house = { ...generateHouse("d1", () => 0), price: 200_000, level: 1 as const };
    const bought = applyCommand(playing({ houses: [house] }), { type: "buyHouse", id: "d1" });
    expect(bought.events).toEqual([{ type: "house.bought", id: "d1", price: 200_000 }]);
    const upgraded = applyCommand(bought.state, { type: "upgradeHouse", id: "d1" });
    expect(upgraded.events).toEqual([
      { type: "house.upgraded", id: "d1", level: 2, cost: 60_000 },
    ]);
  });

  it("silnik nie mutuje poprzedniego stanu", () => {
    const s = playing({ health: 50, slots: ["phone", "hotdog", null, null, null, null, null, null], selected: 1 });
    const snapshot = JSON.parse(JSON.stringify(s));
    applyCommand(s, { type: "eat" });
    applyCommand(s, { type: "tick", dt: 5 });
    applyCommand(s, { type: "buy", item: "water" });
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
  });
});
