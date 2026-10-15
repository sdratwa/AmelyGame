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
import { CURRENT_SAVE_VERSION, type SaveV1, type SaveV2 } from "./schema";
import { serializeState } from "./serialize";
import { LocalStorageSaveStore } from "./store";
import { validateSaveV1 } from "./validateV1";
import { validateSaveV2 } from "./validate";

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

function migrated(v1: SaveV1): SaveV2 {
  const out = migratePayload(clone(v1), 1);
  if (!out.ok) throw new Error(out.error);
  return out.save;
}

describe("migracja SaveV1 -> SaveV2: dane gracza i miasto", () => {
  it("zachowuje miasto, domy (własność i poziom), pieniądze, zdrowie, czas, imię i tutorial", () => {
    const v1 = v1Save();
    const v2 = migrated(v1);
    expect(v2.version).toBe(CURRENT_SAVE_VERSION);
    expect(v2.version).toBe(2);
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
      { id: "item.phone", count: 1 },
      { id: "item.hotdog", count: 1 },
      null,
      { id: "item.water", count: 1 },
      null,
      null,
      { id: "item.coffee", count: 1 },
      null,
    ]);
    expect(v2.player.ledger).toEqual({
      gained: { "item.phone": 1, "item.hotdog": 1, "item.water": 1, "item.coffee": 1 },
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
    expect(v2.player.slots.filter(Boolean)).toHaveLength(8);
    expect(v2.player.ledger.gained["item.hotdog"]).toBe(2);
    const state = hydrateState(v2);
    expect(state.dead).toBe(true);
  });
});

describe("migracja SaveV1 -> SaveV2: generator świata", () => {
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
    expect(verifyWorld(v1Save() as unknown as SaveV2)).toEqual({ ok: true });
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

describe("migracja SaveV1 -> SaveV2: pozycja w lesie", () => {
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

describe("migracja SaveV1 -> SaveV2: bezpieczeństwo i zgodność", () => {
  it("stary zapis nadal da się odczytać i zwalidować jako SaveV1, a koperta wskazuje migrację", () => {
    const v1 = v1Save();
    expect(validateSaveV1(v1).ok).toBe(true);
    expect(validateSaveV2(v1).ok).toBe(false);
    const decoded = decodeSave(encodeSave(v1 as unknown as SaveV2));
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
    const raw = encodeSave(v1Save() as unknown as SaveV2);
    storage.setItem("miasto.save", raw);
    const store = new LocalStorageSaveStore({ storage });
    const loaded = await store.load();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") return;
    expect(loaded.migratedFrom).toBe(1);
    expect(loaded.save.version).toBe(2);
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
      expect(validateSaveV2(v2).ok).toBe(true);
      expect(verifyWorld(v2)).toEqual({ ok: true });
    }
  });
});
