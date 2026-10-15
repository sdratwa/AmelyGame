import { describe, expect, it } from "vitest";
import { rngStream } from "./core/rng";
import {
  Action,
  GameState,
  SECONDS_PER_DAY,
  drainPerSecond,
  generateHouse,
  houseLevelForPrice,
  houseUpgradeCost,
  getClock,
  initialState,
  reducer,
} from "./engine";

const playing = (over: Partial<GameState> = {}): GameState => ({
  ...initialState,
  phase: "playing",
  tutorialDone: true,
  ...over,
});

const run = (s: GameState, a: Action[]) => a.reduce(reducer, s);

describe("zegar", () => {
  it("startuje zimą 2030 w dzień", () => {
    const c = getClock(0);
    expect(c.season).toBe("winter");
    expect(c.year).toBe(2030);
    expect(c.isDay).toBe(true);
  });
  it("1 godzina gry = 20 s, doba = 12h dnia i 12h nocy", () => {
    expect(getClock(12 * 20 - 0.1).isDay).toBe(true);
    expect(getClock(12 * 20).isDay).toBe(false);
    expect(getClock(SECONDS_PER_DAY).isDay).toBe(true);
  });
  it("pory roku trwają po 30 dni", () => {
    expect(getClock(29 * SECONDS_PER_DAY).season).toBe("winter");
    expect(getClock(30 * SECONDS_PER_DAY).season).toBe("spring");
    expect(getClock(60 * SECONDS_PER_DAY).season).toBe("summer");
    expect(getClock(90 * SECONDS_PER_DAY).season).toBe("autumn");
    const next = getClock(120 * SECONDS_PER_DAY);
    expect(next.season).toBe("winter");
    expect(next.year).toBe(2031);
  });
});

describe("spadek życia", () => {
  it("zgodnie ze specyfikacją", () => {
    expect(drainPerSecond("spring", true, false)).toBe(0);
    expect(drainPerSecond("summer", false, false)).toBe(0.1);
    expect(drainPerSecond("autumn", false, false)).toBe(0.1);
    expect(drainPerSecond("winter", true, false)).toBe(0.1);
    expect(drainPerSecond("winter", false, false)).toBe(0.2);
    expect(drainPerSecond("winter", false, true)).toBe(0);
  });
  it("zimą w dzień -1% / 10 s", () => {
    let s = playing();
    for (let i = 0; i < 100; i++) s = reducer(s, { type: "tick", dt: 0.1 });
    expect(s.health).toBe(100 - 1);
    for (let i = 0; i < 100; i++) s = reducer(s, { type: "tick", dt: 0.1 });
    expect(s.health).toBe(100 - 2);
  });
  it("zimą w nocy -1% / 5 s", () => {
    const s = reducer(playing({ elapsed: 12 * 20 }), { type: "tick", dt: 5 });
    expect(s.health).toBe(99);
  });
  it("w sklepie życie nie spada", () => {
    const s = reducer(playing({ view: "shop" }), { type: "tick", dt: 60 });
    expect(s.health).toBe(100);
    expect(s.elapsed).toBe(60);
  });
  it("czas stoi do końca tutoriala", () => {
    const s = reducer(playing({ tutorialDone: false }), { type: "tick", dt: 30 });
    expect(s.elapsed).toBe(0);
  });
});

describe("śmierć i odrodzenie", () => {
  it("po utracie życia gracz ginie i odradza się z telefonem", () => {
    let s = playing({ health: 1, slots: ["phone", "hotdog", null, null, null, null, null, null] });
    s = reducer(s, { type: "tick", dt: 10 });
    expect(s.dead).toBe(true);
    expect(s.health).toBe(0);
    s = reducer(s, { type: "respawn" });
    expect(s.dead).toBe(false);
    expect(s.health).toBe(100);
    expect(s.slots).toEqual(["phone", null, null, null, null, null, null, null]);
  });
});

describe("sklep i ekwipunek", () => {
  it("zakup dodaje przedmiot i odejmuje pieniądze", () => {
    const s = reducer(playing(), { type: "buy", item: "hotdog" });
    expect(s.slots[1]).toBe("hotdog");
    expect(s.wallet).toBe(1_000_000 - 12);
  });
  it("max 8 slotów", () => {
    let s = playing();
    for (let i = 0; i < 10; i++) s = reducer(s, { type: "buy", item: "water" });
    expect(s.slots.filter(Boolean)).toHaveLength(8);
    expect(s.wallet).toBe(1_000_000 - 7 * 3);
    expect(s.toast?.tone).toBe("error");
  });
  it("jedzenie leczy i znika, telefon zostaje", () => {
    let s = playing({ health: 50 });
    s = run(s, [
      { type: "buy", item: "hotdog" },
      { type: "select", slot: 1 },
      { type: "eat" },
    ]);
    expect(s.health).toBe(75);
    expect(s.slots[1]).toBeNull();
    s = run(s, [{ type: "select", slot: 0 }, { type: "eat" }]);
    expect(s.slots[0]).toBe("phone");
  });
});

describe("tutorial", () => {
  it("do czasu wejścia do lasu inne miejsca są zablokowane", () => {
    let s = playing({ tutorialDone: false });
    s = reducer(s, { type: "enter", view: "shop" });
    expect(s.view).toBe("world");
    s = reducer(s, { type: "enter", view: "forest" });
    expect(s.view).toBe("forest");
    expect(s.tutorialDone).toBe(true);
  });
});

describe("domy", () => {
  it("cena 200-500k, telefon 6 cyfr, poziom zgodny z ceną", () => {
    const rnd = rngStream(11, "house-test");
    for (let i = 0; i < 200; i++) {
      const h = generateHouse("h", rnd);
      expect(h.price).toBeGreaterThanOrEqual(200_000);
      expect(h.price).toBeLessThanOrEqual(500_000);
      expect(h.phone).toMatch(/^\d{6}$/);
      expect(h.level).toBe(houseLevelForPrice(h.price));
    }
  });
  it("4 poziomy rosnące z ceną", () => {
    expect(houseLevelForPrice(200_000)).toBe(1);
    expect(houseLevelForPrice(274_999)).toBe(1);
    expect(houseLevelForPrice(275_000)).toBe(2);
    expect(houseLevelForPrice(350_000)).toBe(3);
    expect(houseLevelForPrice(425_000)).toBe(4);
    expect(houseLevelForPrice(500_000)).toBe(4);
  });
  it("kupno i ulepszanie do maks. poziomu 4", () => {
    const house = { ...generateHouse("d1", () => 0), level: 1 as const, price: 200_000 };
    let s = playing({ houses: [house] });
    s = reducer(s, { type: "upgradeHouse", id: "d1" });
    expect(s.houses[0].level).toBe(1);
    s = reducer(s, { type: "buyHouse", id: "d1" });
    expect(s.houses[0].owned).toBe(true);
    expect(s.wallet).toBe(800_000);
    for (let i = 0; i < 5; i++) s = reducer(s, { type: "upgradeHouse", id: "d1" });
    expect(s.houses[0].level).toBe(4);
    expect(s.wallet).toBe(800_000 - 60_000 - 90_000 - 130_000);
    expect(houseUpgradeCost(4)).toBeNull();
  });
  it("nie kupisz domu bez pieniędzy", () => {
    const house = { ...generateHouse("d1", () => 0.9), price: 500_000 };
    const s = reducer(playing({ houses: [house], wallet: 1000 }), { type: "buyHouse", id: "d1" });
    expect(s.houses[0].owned).toBe(false);
    expect(s.wallet).toBe(1000);
  });
});
