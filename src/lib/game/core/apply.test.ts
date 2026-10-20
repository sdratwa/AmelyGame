import { slotsFrom } from "../testkit";
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
    const cmd = { type: "buy", item: "item.hotdog" } as const;
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
    const started = applyCommand(s, { type: "startLoading", seed: 4242, saveId: "save_test" });
    expect(started.events).toEqual([{ type: "game.started", name: "Ala" }]);
    s = started.state;
    const ready = applyCommand(s, { type: "worldReady" });
    const types = ready.events.map((e) => e.type);
    expect(types).toContain("world.ready");
    expect(types).toContain("time.pause_changed");
  });

  it("zakup emituje zdarzenie i deterministyczny komunikat", () => {
    const out = applyCommand(playing(), { type: "buy", item: "item.hotdog" });
    expect(out.events).toEqual([{ type: "item.purchased", item: "item.hotdog", price: 12 }]);
    expect(out.state.toast).toEqual({
      id: 1,
      text: "Kupiono: Hot-dog (−12 zł)",
      tone: "ok",
    });
    expect(out.state.toastSeq).toBe(1);
  });

  it("nieudany zakup informuje o powodzie", () => {
    const full = playing({
      slots: slotsFrom(["item.water", "item.water", "item.water", "item.water", "item.water", "item.water", "item.water", "item.water"]),
    });
    expect(applyCommand(full, { type: "buy", item: "item.water" }).events).toEqual([
      { type: "item.purchase_failed", item: "item.water", reason: "inventory_full" },
    ]);
    const poor = playing({ wallet: 1 });
    expect(applyCommand(poor, { type: "buy", item: "item.water" }).events).toEqual([
      { type: "item.purchase_failed", item: "item.water", reason: "no_money" },
    ]);
  });

  it("identyfikatory komunikatów rosną w ramach stanu, bez zmiennych modułu", () => {
    const a = applyCommand(playing(), { type: "buy", item: "item.water" }).state;
    const b = applyCommand(a, { type: "buy", item: "item.water" }).state;
    expect(a.toast?.id).toBe(1);
    expect(b.toast?.id).toBe(2);
    const other = applyCommand(playing(), { type: "buy", item: "item.water" }).state;
    expect(other.toast?.id).toBe(1);
  });

  it("jedzenie, śmierć i odrodzenie emitują zdarzenia", () => {
    const eat = applyCommand(
      playing({ health: 50, slots: slotsFrom(["item.hotdog", null, null, null, null, null, null, null]), selected: 0 }),
      { type: "eat" },
    );
    expect(eat.events).toEqual([{ type: "item.eaten", item: "item.hotdog", healed: 25 }]);

    const died = applyCommand(playing({ health: 1 }), { type: "tick", dt: 10 });
    expect(died.events.map((e) => e.type)).toEqual(["player.died", "time.pause_changed"]);
    expect(died.state.dead).toBe(true);

    const back = applyCommand(died.state, { type: "respawn" });
    expect(back.events.map((e) => e.type)).toEqual(["player.respawned", "time.pause_changed"]);
  });

  it("w tutorialu wejście do lasu jest zablokowane, a przyjęcie zadania kończy tutorial i emituje zdarzenia", () => {
    const tutorial = playing({ tutorialDone: false });
    expect(applyCommand(tutorial, { type: "enter", view: "forest" }).events).toEqual([]);
    const out = applyCommand(tutorial, { type: "quest.accept", id: "quest.bridge_01" });
    expect(out.events.map((e) => e.type)).toEqual(["quest.accepted", "tutorial.completed", "time.pause_changed"]);
    expect(out.state.tutorialDone).toBe(true);
    const entered = applyCommand(out.state, { type: "enter", view: "forest" });
    expect(entered.events.map((e) => e.type)).toEqual(["view.entered"]);
    const left = applyCommand(entered.state, { type: "leave" });
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
    const s = playing({ health: 50, slots: slotsFrom(["item.hotdog", null, null, null, null, null, null, null]), selected: 0 });
    const snapshot = JSON.parse(JSON.stringify(s));
    applyCommand(s, { type: "eat" });
    applyCommand(s, { type: "tick", dt: 5 });
    applyCommand(s, { type: "buy", item: "item.water" });
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
  });
});
