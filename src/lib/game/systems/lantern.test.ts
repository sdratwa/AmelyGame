import { describe, expect, it } from "vitest";
import { EQUIPMENT, EQUIPMENT_IDS, OIL_LANTERN_ID, isEquipmentId } from "../content/equipment";
import { ITEMS, isItemId } from "../content/items";
import { applyCommand, reducer } from "../core/apply";
import { INVENTORY_SLOTS } from "../core/constants";
import { initialState } from "../core/state";
import { respawn } from "./death";
import { decodeSave, encodeSave } from "../save/codec";
import { hydrateState } from "../save/hydrate";
import { serializeState } from "../save/serialize";
import { validateSaveV5 } from "../save/validate";
import { newPlaying, run } from "../testkit";

describe("lampa naftowa: stałe wyposażenie", () => {
  it("ma stały identyfikator i polską nazwę, a nie jest przedmiotem ekwipunku", () => {
    expect(OIL_LANTERN_ID).toBe("oil_lantern");
    expect(EQUIPMENT[OIL_LANTERN_ID].name).toBe("Lampa naftowa");
    expect(EQUIPMENT[OIL_LANTERN_ID].permanent).toBe(true);
    expect(EQUIPMENT_IDS).toEqual([OIL_LANTERN_ID]);
    expect(isEquipmentId("oil_lantern")).toBe(true);
    expect(isEquipmentId("item.pickaxe")).toBe(false);
    expect(isItemId("oil_lantern")).toBe(false);
    expect(Object.keys(ITEMS)).not.toContain("oil_lantern");
  });

  it("nowy gracz ma lampę (wyłączoną) i wszystkie sloty na rzeczy zbierane w grze", () => {
    const s = newPlaying();
    expect(s.lantern).toEqual({ enabled: false });
    expect(s.slots).toHaveLength(INVENTORY_SLOTS);
    expect(s.slots.every((slot) => slot === null)).toBe(true);
    expect(s.ledger).toEqual({ gained: {}, spent: {} });
  });

  it("przedmioty nie mogą jej usunąć: wyrzucenie, jedzenie, kupno i odrodzenie nie dotykają lampy ani slotów", () => {
    let s = run(newPlaying(), { type: "lantern.set", enabled: true });
    s = run(s, { type: "buy", item: "item.hotdog" }, { type: "discard", slot: 0 }, { type: "eat" }, { type: "select", slot: 3 });
    expect(s.lantern.enabled).toBe(true);
    const dead = { ...s, health: 0, dead: true };
    const revived = respawn(dead).state;
    expect(revived.lantern.enabled).toBe(true);
    expect(revived.slots).toHaveLength(INVENTORY_SLOTS);
  });

  it("zapis z lampą w slotach jest odrzucany (lampa nie jest zwykłym przedmiotem i nie powstaje przez zapis)", () => {
    const save = JSON.parse(JSON.stringify(serializeState(newPlaying(), 1)));
    save.player.slots[0] = { id: "oil_lantern", count: 1 };
    expect(validateSaveV5(save).ok).toBe(false);
  });
});

describe("lampa naftowa: przełączanie ON/OFF", () => {
  it("włącza, wyłącza i przełącza wielokrotnie, zgłaszając zdarzenie tylko przy zmianie", () => {
    let s = newPlaying();
    const on = applyCommand(s, { type: "lantern.set", enabled: true });
    expect(on.state.lantern.enabled).toBe(true);
    expect(on.events).toEqual([{ type: "lantern.changed", enabled: true }]);
    s = on.state;
    const again = applyCommand(s, { type: "lantern.set", enabled: true });
    expect(again.state).toBe(s);
    expect(again.events).toEqual([]);
    const off = applyCommand(s, { type: "lantern.toggle" });
    expect(off.state.lantern.enabled).toBe(false);
    expect(off.events).toEqual([{ type: "lantern.changed", enabled: false }]);
    let state = newPlaying();
    for (let i = 0; i < 25; i++) state = reducer(state, { type: "lantern.toggle" });
    expect(state.lantern.enabled).toBe(true);
  });

  it("martwy gracz nie obsługuje lampy, a niepoprawna wartość nie zmienia stanu", () => {
    const dead = { ...newPlaying(), health: 0, dead: true };
    expect(applyCommand(dead, { type: "lantern.toggle" }).state).toBe(dead);
    const s = newPlaying();
    expect(applyCommand(s, { type: "lantern.set", enabled: "tak" as unknown as boolean }).state).toBe(s);
  });

  it("nie zmienia niczego poza lampą (ekwipunek, portfel, zdrowie, pauzy, zadania)", () => {
    const s = run(newPlaying(), { type: "buy", item: "item.hotdog" });
    const out = reducer(s, { type: "lantern.toggle" });
    expect({ ...out, lantern: s.lantern }).toEqual(s);
  });

  it("lampa nie wymaga paliwa: wielogodzinny upływ czasu nie wyłącza jej ani nie zmienia stanu", () => {
    let s = run(newPlaying(), { type: "lantern.set", enabled: true }, { type: "enter", view: "forest" });
    for (let i = 0; i < 200; i++) s = reducer(s, { type: "tick", dt: 5 });
    expect(s.lantern).toEqual({ enabled: true });
  });
});

describe("lampa naftowa: zapis i kontynuacja", () => {
  it("stan lampy przechodzi round-trip (serialize, kodek, hydrate) i walidację", () => {
    for (const enabled of [false, true]) {
      const s = run(newPlaying(), { type: "lantern.set", enabled });
      const save = serializeState(s, 10)!;
      expect(save.player.lantern).toEqual({ enabled });
      expect(validateSaveV5(JSON.parse(JSON.stringify(save))).ok).toBe(true);
      const decoded = decodeSave(encodeSave(save));
      expect(decoded.kind).toBe("ok");
      if (decoded.kind !== "ok") return;
      expect(hydrateState(decoded.save).lantern).toEqual({ enabled });
    }
  });

  it("w zapisie jest tylko flaga (bez parametrów światła i geometrii)", () => {
    const save = serializeState(run(newPlaying(), { type: "lantern.set", enabled: true }), 10)!;
    expect(Object.keys(save.player.lantern)).toEqual(["enabled"]);
    const text = JSON.stringify(save).toLowerCase();
    for (const forbidden of ["intensity", "flicker", "glow", "kelvin", "#ffbd55", "geometry", "three"]) expect(text).not.toContain(forbidden);
  });

  it("uszkodzona sekcja lampy jest odrzucana przez walidację", () => {
    const base = JSON.parse(JSON.stringify(serializeState(newPlaying(), 1)));
    for (const lantern of [undefined, null, {}, { enabled: "tak" }, { enabled: 1 }, []]) {
      const bad = { ...base, player: { ...base.player, lantern } };
      expect(validateSaveV5(bad).ok).toBe(false);
    }
  });

  it("wczytanie zapisu odtwarza lampę, a stan początkowy gry jest wyłączony", () => {
    expect(initialState.lantern).toEqual({ enabled: false });
    const save = serializeState(run(newPlaying(), { type: "lantern.set", enabled: true }), 1)!;
    const loaded = reducer(initialState, { type: "game.load", save });
    expect(loaded.lantern.enabled).toBe(true);
  });
});
