import { describe, expect, it } from "vitest";
import type { House } from "../content/houses";
import { ITEMS } from "../content/items";
import { reducer } from "../core/apply";
import { inventoryProblems } from "../systems/containers";
import { autoComplete } from "../testkit";
import { fingerprintWorld, generateWorld } from "../world";
import { createForest, forestEntryPose, isValidForestPosition, safeForestPose } from "../world/generators/v2";
import { decodeSave, encodeSave } from "./codec";
import { hydrateState } from "./hydrate";
import { loadGame, verifyWorld } from "./loader";
import { MemoryStorage } from "./memoryStorage";
import { migratePayload } from "./migrate";
import { migrateV1ToV2 } from "./migrations/v1ToV2";
import { migrateV2ToV3 } from "./migrations/v2ToV3";
import { migrateV3ToV4 } from "./migrations/v3ToV4";
import { DEFAULT_APPEARANCE } from "@/lib/character/appearance";
import { CURRENT_SAVE_VERSION, type SaveV1, type SaveV4 } from "./schema";
import { serializeState } from "./serialize";
import { LocalStorageSaveStore } from "./store";
import { validateSaveV1 } from "./validateV1";
import { validateSaveV4 } from "./validate";

const SEED = 31415;

function v1Save(seed = SEED, patch: Partial<SaveV1["player"]> = {}): SaveV1 {
  const base = generateWorld(seed, 1);
  const houses: House[] = base.houses.map((h, i) => (i === 0 ? { ...h, owned: true, level: 3 } : h));
  return {
    version: 1,
    saveId: "save_stary0001",
    savedAt: 1_700_000_000_000,
    world: { seed, genVersion: 1, fingerprint: fingerprintWorld(base), genHistory: [] },
    time: { elapsed: 12345.5 },
    player: {
      name: "Ola",
      health: 77,
      drainAcc: 0.25,
      dead: false,
      deaths: 2,
      wallet: 987_654,
      slots: ["phone", "hotdog", null, "water", null, null, "coffee", null],
      selected: 1,
      forestPose: null,
      ...patch,
    },
    tutorial: { done: true },
    houses,
  };
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function migrated(v1: SaveV1): SaveV4 {
  const out = migratePayload(clone(v1), 1);
  if (!out.ok) throw new Error(out.error);
  return out.save;
}

describe("migracja SaveV1 -> SaveV4 (łańcuch v1 -> v2 -> v3 -> v4): dane gracza i miasto", () => {
  it("zachowuje miasto, domy (własność i poziom), pieniądze, zdrowie, czas, imię i tutorial", () => {
    const v1 = v1Save();
    const v2 = migrated(v1);
    expect(v2.version).toBe(CURRENT_SAVE_VERSION);
    expect(v2.version).toBe(4);
    expect(v2.saveId).toBe(v1.saveId);
    expect(v2.houses).toEqual(v1.houses);
    expect(v2.houses[0]).toMatchObject({ owned: true, level: 3 });
    expect(v2.player).toMatchObject({ name: "Ola", health: 77, drainAcc: 0.25, deaths: 2, wallet: 987_654, dead: false, selected: 1 });
    expect(v2.time).toEqual(v1.time);
    expect(v2.tutorial).toEqual({ done: true });
    expect(v2.world.seed).toBe(SEED);
  });

  it("przedmioty dostają identyfikatory z przestrzenią nazw, miejsca zostają, księga zgadza się z zawartością", () => {
    const v2 = migrated(v1Save());
    expect(v2.player.slots).toEqual([
      null,
      { id: "item.hotdog", count: 1 },
      null,
      { id: "item.water", count: 1 },
      null,
      null,
      { id: "item.coffee", count: 1 },
      null,
    ]);
    expect(v2.player.ledger).toEqual({
      gained: { "item.hotdog": 1, "item.water": 1, "item.coffee": 1 },
      spent: {},
    });
    expect(inventoryProblems(v2.player.slots, v2.troll.deposit, v2.player.ledger)).toEqual([]);
    for (const s of v2.player.slots) if (s) expect(ITEMS[s.id]).toBeDefined();
  });

  it("nowe dane (zadania, skrzynie, troll, most, odznaki) startują od zera", () => {
    const v2 = migrated(v1Save());
    expect(v2.quests).toEqual({ accepted: {}, completed: {}, read: [] });
    expect(v2.chests).toEqual({});
    expect(v2.troll).toEqual({ phase: "unmet", lockUntil: 0, attempts: 0, deposit: [] });
    expect(v2.harvested).toEqual([]);
    expect(v2.bridge).toEqual({ built: false, builtAt: null });
    expect(v2.discovered).toEqual([]);
    expect(v2.badges).toEqual([]);
  });

  it("zapis ze stanem skrajnym: zmarły gracz i pełny ekwipunek przechodzą bez zmian", () => {
    const v1 = v1Save(SEED, {
      health: 0,
      dead: true,
      slots: ["phone", "hotdog", "hotdog", "water", "water", "coffee", "coffee", "chocolate"],
    });
    const v2 = migrated(v1);
    expect(v2.player.dead).toBe(true);
    expect(v2.player.slots.filter(Boolean)).toHaveLength(7);
    expect(v2.player.slots[0]).toBeNull();
    expect(v2.player.ledger.gained["item.hotdog"]).toBe(2);
    const state = hydrateState(v2);
    expect(state.dead).toBe(true);
  });
});

describe("migracja SaveV1 -> SaveV4 (łańcuch v1 -> v2 -> v3 -> v4): generator świata", () => {
  it("generator v2 zachowuje miasto: te same domy co v1 dla wielu seedów", () => {
    for (let i = 0; i < 25; i++) {
      const seed = (Math.imul(i + 3, 2654435761) ^ 0x1234567) >>> 0;
      expect(generateWorld(seed, 2).houses).toEqual(generateWorld(seed, 1).houses);
    }
  });

  it("odcisk i historia generatora: wersja 2, odcisk nowego generatora, wpis migracji z czasem gry", () => {
    const v2 = migrated(v1Save());
    expect(v2.world.genVersion).toBe(2);
    expect(v2.world.fingerprint).toBe(fingerprintWorld(generateWorld(SEED, 2)));
    expect(v2.world.fingerprint).not.toBe(v1Save().world.fingerprint);
    expect(v2.world.genHistory).toEqual([{ version: 2, atElapsed: 12345.5 }]);
  });

  it("po migracji świat przechodzi weryfikację (odcisk, domy), a stary zapis tego samego seeda na v1 też nadal się odtwarza", () => {
    const v2 = migrated(v1Save());
    expect(verifyWorld(v2)).toEqual({ ok: true });
    expect(verifyWorld(v1Save() as unknown as SaveV4)).toEqual({ ok: true });
  });

  it("zapis z dopisaną historią zachowuje wcześniejsze wpisy", () => {
    const v1 = v1Save();
    v1.world.genHistory = [{ version: 1, atElapsed: 0 }];
    expect(migrated(v1).world.genHistory).toEqual([
      { version: 1, atElapsed: 0 },
      { version: 2, atElapsed: 12345.5 },
    ]);
  });
});

describe("migracja SaveV1 -> SaveV4 (łańcuch v1 -> v2 -> v3 -> v4): pozycja w lesie", () => {
  const forest = createForest(SEED);

  function findPose(valid: boolean) {
    for (let r = 0; r < 4000; r++) {
      const x = -45 + ((r * 37) % 90) + 0.37;
      const z = -45 + ((r * 91) % 90) + 0.11;
      if (Math.hypot(x, z) > 49) continue;
      if (isValidForestPosition(forest, x, z) === valid) return { x, z, yaw: 0.7 };
    }
    throw new Error("brak pozycji testowej");
  }

  it("poprawna pozycja zostaje bez zmian", () => {
    const pose = findPose(true);
    expect(migrated(v1Save(SEED, { forestPose: pose })).player.forestPose).toEqual(pose);
  });

  it("pozycja niepoprawna w nowym lesie (drzewo lub skała) przenosi gracza do bezpiecznego punktu wejścia", () => {
    const pose = findPose(false);
    const out = migrated(v1Save(SEED, { forestPose: pose })).player.forestPose!;
    expect(out).toEqual(forestEntryPose());
    expect(isValidForestPosition(forest, out.x, out.z)).toBe(true);
  });

  it("brak zapisanej pozycji pozostaje brakiem; punkt wejścia jest poprawny dla wielu seedów", () => {
    expect(migrated(v1Save(SEED, { forestPose: null })).player.forestPose).toBeNull();
    for (let i = 0; i < 40; i++) {
      const seed = (Math.imul(i + 1, 2246822519) ^ 0xabcdef) >>> 0;
      const entry = forestEntryPose();
      expect(isValidForestPosition(createForest(seed), entry.x, entry.z), `seed ${seed}`).toBe(true);
      expect(safeForestPose(seed, { x: 105, z: 0, yaw: 0 }), `seed ${seed}`).toEqual(entry);
    }
  });
});

describe("migracja SaveV1 -> SaveV4 (łańcuch v1 -> v2 -> v3 -> v4): bezpieczeństwo i zgodność", () => {
  it("stary zapis nadal da się odczytać i zwalidować jako SaveV1, a koperta wskazuje migrację", () => {
    const v1 = v1Save();
    expect(validateSaveV1(v1).ok).toBe(true);
    expect(validateSaveV4(v1).ok).toBe(false);
    const decoded = decodeSave(encodeSave(v1 as unknown as SaveV4));
    expect(decoded.kind).toBe("needs_migration");
    if (decoded.kind === "needs_migration") expect(decoded.from).toBe(1);
  });

  it("migracja nie modyfikuje wejścia i jest deterministyczna", () => {
    const v1 = v1Save(SEED, { forestPose: { x: 1, z: 1, yaw: 0 } });
    const snapshot = JSON.stringify(v1);
    const a = migrateV1ToV2(clone(v1) as unknown as Record<string, unknown>);
    const b = migrateV1ToV2(clone(v1) as unknown as Record<string, unknown>);
    expect(JSON.stringify(v1)).toBe(snapshot);
    expect(a).toEqual(b);
  });

  it("uszkodzony SaveV1 (nieznany przedmiot, zły generator, brak pól) jest odrzucany bez zgadywania", () => {
    const badItem = clone(v1Save());
    badItem.player.slots[2] = "miecz";
    expect(migratePayload(badItem, 1).ok).toBe(false);
    const badGen = clone(v1Save());
    badGen.world.genVersion = 7;
    expect(migratePayload(badGen, 1).ok).toBe(false);
    expect(migratePayload({ version: 1 }, 1).ok).toBe(false);
  });

  it("magazyn: stary zapis jest migrowany, kopia przed migracją i .bak zawierają oryginał, a po migracji gra się ładuje", async () => {
    const storage = new MemoryStorage();
    const raw = encodeSave(v1Save() as unknown as SaveV4);
    storage.setItem("miasto.save", raw);
    const store = new LocalStorageSaveStore({ storage });
    const loaded = await store.load();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") return;
    expect(loaded.migratedFrom).toBe(1);
    expect(loaded.save.version).toBe(4);
    expect(storage.getItem("miasto.save.premigration.v1.0")).toBe(raw);
    expect(storage.getItem("miasto.save.bak")).toBe(raw);

    const boot = await loadGame(new LocalStorageSaveStore({ storage }));
    expect(boot.kind).toBe("ok");
    if (boot.kind !== "ok") return;
    const state = hydrateState(boot.save);
    expect(state.houses[0]).toMatchObject({ owned: true, level: 3 });
    expect(state.slots[1]).toEqual({ id: "item.hotdog", count: 1 });
    expect(state.world?.anchors).not.toBeNull();
    expect(serializeState(state, 1)).toEqual({ ...boot.save, savedAt: 1 });
  });

  it("po migracji gra jest w pełni grywalna: quest da się ukończyć", () => {
    const state = hydrateState(migrated(v1Save(SEED, { forestPose: null })));
    const done = autoComplete(reducer(state, { type: "leave" }));
    expect(done.quests.completed["quest.bridge_01"]).toBeDefined();
    expect(done.houses[0]).toMatchObject({ owned: true, level: 3 });
    expect(done.wallet).toBe(987_654 + 5000);
  });

  it("migracja dla wielu seedów daje zapis, który przechodzi walidację i weryfikację świata", () => {
    for (let i = 0; i < 12; i++) {
      const seed = (Math.imul(i + 11, 2654435761) ^ 0x7777) >>> 0;
      const v2 = migrated(v1Save(seed, { forestPose: { x: 10 + i, z: -3 * i, yaw: 0.1 } }));
      expect(validateSaveV4(v2).ok).toBe(true);
      expect(verifyWorld(v2)).toEqual({ ok: true });
    }
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures celowo budują dawny format SaveV2 z telefonem */
describe("migracja SaveV2 -> SaveV3: usunięcie telefonu", () => {
  type Json = Record<string, any>;

  /** Dawny zapis V2: telefon w slocie 1 (reszta przedmiotów przesunięta o jedno miejsce, jak w starej grze) i w księdze. */
  function v2With(state: ReturnType<typeof hydrateState>): Json {
    const base = clone(serializeState(state, 1_000)) as unknown as Json;
    const last = base.player.slots[base.player.slots.length - 1];
    if (last !== null) throw new Error("fixture: brak miejsca na telefon");
    base.version = 2;
    base.player.slots = [{ id: "item.phone", count: 1 }, ...base.player.slots.slice(0, -1)];
    base.player.ledger.gained["item.phone"] = 1;
    base.player.selected = Math.min(7, base.player.selected + 1);
    return base;
  }

  const fresh = () => hydrateState(migrated(v1Save(SEED, { forestPose: null })));

  it("wycina tylko telefon: miejsca pozostałych przedmiotów, księga, pieniądze i domy zostają", () => {
    const state = fresh();
    const v2 = v2With(state);
    const out = migratePayload(v2, 2);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const v3 = out.save;
    expect(v3.version).toBe(4);
    expect(v3.player.slots[0]).toBeNull();
    expect(v3.player.slots.slice(1)).toEqual(v2.player.slots.slice(1));
    expect(JSON.stringify(v3)).not.toContain("item.phone");
    expect(v3.player.ledger.gained).toEqual(Object.fromEntries(Object.entries(v2.player.ledger.gained).filter(([id]) => id !== "item.phone")));
    expect(v3.player.wallet).toBe(v2.player.wallet);
    expect(v3.houses).toEqual(v2.houses);
    expect(v3.world).toEqual(v2.world);
    expect(v3.player.selected).toBe(v2.player.selected);
    expect(verifyWorld(v3)).toEqual({ ok: true });
  });

  it("nie modyfikuje wejścia, jest deterministyczna i odrzuca zły format zamiast zgadywać", () => {
    const v2 = v2With(fresh());
    const snapshot = JSON.stringify(v2);
    const a = migrateV2ToV3(clone(v2));
    const b = migrateV2ToV3(clone(v2));
    expect(JSON.stringify(v2)).toBe(snapshot);
    expect(a).toEqual(b);
    expect(() => migrateV2ToV3({ ...clone(v2), version: 3 })).toThrow();
    expect(() => migrateV2ToV3({ ...clone(v2), player: null })).toThrow();
    expect(() => migrateV2ToV3({ ...clone(v2), troll: {} })).toThrow();
  });

  it("zapis V2 bez telefonu (np. uszkodzony ręcznie) też przechodzi, a wynik jest poprawnym SaveV4", () => {
    const v2 = v2With(fresh());
    v2.player.slots[0] = null;
    delete v2.player.ledger.gained["item.phone"];
    const out = migratePayload(v2, 2);
    expect(out.ok).toBe(true);
  });

  it("wycina telefon także z księgi wydatków i depozytu trolla, nie ruszając pozostałych wpisów", () => {
    const v2 = v2With(fresh());
    v2.player.ledger.spent["item.phone"] = 0;
    v2.troll.deposit = [{ id: "item.phone", count: 1 }];
    v2.troll.phase = "confronted";
    const out = migrateV2ToV3(clone(v2)) as Json;
    expect(out.player.ledger.spent).toEqual({});
    expect(out.troll.deposit).toEqual([]);
    expect(out.troll.phase).toBe("confronted");
  });

  it("ukończony quest ze zbudowanym mostem, odkrytym obszarem i odznaką przeżywa migrację bez cofania postępu", () => {
    const done = autoComplete(reducer(fresh(), { type: "leave" }));
    expect(done.quests.completed["quest.bridge_01"]).toBeDefined();
    const v2 = v2With(done);
    const out = migratePayload(v2, 2);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const state = hydrateState(out.save);
    expect(state.bridge.built).toBe(true);
    expect(state.quests.completed["quest.bridge_01"]).toBeDefined();
    expect(state.discovered).toEqual(done.discovered);
    expect(state.badges).toEqual(done.badges);
    expect(state.wallet).toBe(done.wallet);
    expect(state.harvested).toEqual(done.harvested);
    expect(state.world?.seed).toBe(done.world?.seed);
    expect(state.world?.fingerprint).toBe(done.world?.fingerprint);
    expect(state.slots.some((s) => s?.id === ("item.phone" as string))).toBe(false);
    // nagroda nie zostaje wypłacona drugi raz
    expect(reducer(state, { type: "tick", dt: 1 }).wallet).toBe(done.wallet);
  });

  it("magazyn: zapis V2 jest migrowany do V4, kopia przed migracją zawiera oryginał, a gra się ładuje", async () => {
    const storage = new MemoryStorage();
    const v2 = v2With(fresh());
    const raw = encodeSave(v2 as unknown as SaveV4);
    storage.setItem("miasto.save", raw);
    const loaded = await new LocalStorageSaveStore({ storage }).load();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") return;
    expect(loaded.migratedFrom).toBe(2);
    expect(loaded.save.version).toBe(4);
    expect(storage.getItem("miasto.save.premigration.v2.0")).toBe(raw);
    const boot = await loadGame(new LocalStorageSaveStore({ storage }));
    expect(boot.kind).toBe("ok");
  });

  it("nowa gra nie ma telefonu w ekwipunku, księdze ani zapisie", () => {
    const state = reducer(fresh(), { type: "leave" });
    const saved = serializeState(state, 1)!;
    expect(saved.version).toBe(CURRENT_SAVE_VERSION);
    expect(JSON.stringify(saved)).not.toContain("item.phone");
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures celowo budują dawny format SaveV3 bez wyglądu */
describe("migracja SaveV3 -> SaveV4: wygląd postaci", () => {
  type Json = Record<string, any>;
  const fresh = () => hydrateState(migrated(v1Save(SEED, { forestPose: null })));

  /** Dawny zapis V3: bieżący zapis bez `player.appearance`. */
  function v3Of(state: ReturnType<typeof hydrateState>): Json {
    const base = clone(serializeState(state, 1_000)) as unknown as Json;
    base.version = 3;
    delete base.player.appearance;
    return base;
  }

  it("dodaje domyślny wygląd i nie zmienia niczego poza wersją", () => {
    const v3 = v3Of(autoComplete(reducer(fresh(), { type: "leave" })));
    const out = migrateV3ToV4(clone(v3));
    expect(out.version).toBe(4);
    expect((out.player as Json).appearance).toEqual(DEFAULT_APPEARANCE);
    const { appearance: _a, ...playerRest } = out.player as Json;
    void _a;
    expect({ ...out, version: 3, player: playerRest }).toEqual(v3);
  });

  it("nie modyfikuje wejścia, jest deterministyczna i odrzuca zły format", () => {
    const v3 = v3Of(fresh());
    const snapshot = JSON.stringify(v3);
    expect(migrateV3ToV4(clone(v3))).toEqual(migrateV3ToV4(clone(v3)));
    expect(JSON.stringify(v3)).toBe(snapshot);
    expect(() => migrateV3ToV4({ ...clone(v3), version: 4 })).toThrow();
    expect(() => migrateV3ToV4({ ...clone(v3), player: null })).toThrow();
  });

  it("pełny łańcuch: zapis V3 przechodzi walidację V4, postęp (most, odznaki, pieniądze) zostaje, a gra się wczytuje z domyślnym wyglądem", () => {
    const done = autoComplete(reducer(fresh(), { type: "leave" }));
    const out = migratePayload(v3Of(done), 3);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const state = hydrateState(out.save);
    expect(state.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(state.bridge.built).toBe(true);
    expect(state.wallet).toBe(done.wallet);
    expect(state.badges).toEqual(done.badges);
    expect(state.quests.completed["quest.bridge_01"]).toBeDefined();
  });

  it("magazyn: zapis V3 jest migrowany, kopia przed migracją zawiera oryginał, a gra się ładuje", async () => {
    const storage = new MemoryStorage();
    const raw = encodeSave(v3Of(fresh()) as unknown as SaveV4);
    storage.setItem("miasto.save", raw);
    const loaded = await new LocalStorageSaveStore({ storage }).load();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") return;
    expect(loaded.migratedFrom).toBe(3);
    expect(loaded.save.version).toBe(4);
    expect(loaded.save.player.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(storage.getItem("miasto.save.premigration.v3.0")).toBe(raw);
    expect((await loadGame(new LocalStorageSaveStore({ storage }))).kind).toBe("ok");
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
