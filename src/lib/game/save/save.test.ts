import { describe, expect, it } from "vitest";
import { applyCommand, reducer, type Command } from "../core/apply";
import { initialState, type GameState } from "../core/state";
import { Autosaver } from "./autosave";
import { decodeSave, encodeSave } from "./codec";
import { hydrateState } from "./hydrate";
import { loadGame, verifyWorld } from "./loader";
import { migratePayload, type SchemaConfig } from "./migrate";
import { MemoryStorage } from "./memoryStorage";
import { createNewGameParams } from "./newGame";
import { SAVE_TOP_LEVEL_KEYS, type SaveV2 } from "./schema";
import { serializeState } from "./serialize";
import { LocalStorageSaveStore, type KeyValueStorage, type SaveOutcome, type SaveStore } from "./store";
import { validateSaveV2 } from "./validate";
import { canonicalize, fingerprintOf, hashHex } from "../world/fingerprint";

function run(state: GameState, ...commands: Command[]): GameState {
  return commands.reduce(reducer, state);
}

function newGame(seed = 777, saveId = "save_test0001", name = "Ola"): GameState {
  return run(
    initialState,
    { type: "setName", name },
    { type: "startLoading", seed, saveId },
    { type: "worldReady" },
  );
}

function started(seed = 777, saveId = "save_test0001"): GameState {
  return run(newGame(seed, saveId), { type: "enter", view: "forest" }, { type: "leave" });
}

/** Gra z postępem: zakupy, dom, czas, pozycja w lesie. */
function progressed(seed = 777, saveId = "save_test0001"): GameState {
  let s = newGame(seed, saveId);
  s = run(
    s,
    { type: "enter", view: "forest" },
    { type: "forest.pose", pose: { x: 12.5, z: -7.25, yaw: 1.2 } },
    { type: "leave" },
    { type: "buy", item: "item.hotdog" },
    { type: "select", slot: 1 },
    { type: "tick", dt: 37.5 },
  );
  const cheapest = [...s.houses].sort((a, b) => a.price - b.price)[0];
  return run(s, { type: "buyHouse", id: cheapest.id }, { type: "upgradeHouse", id: cheapest.id });
}

const save = (s: GameState, savedAt = 1_000): SaveV2 => {
  const out = serializeState(s, savedAt);
  if (!out) throw new Error("stan nie nadaje się do zapisu");
  return out;
};

function makeStore(storage: KeyValueStorage = new MemoryStorage(), schema?: SchemaConfig) {
  return { storage, store: new LocalStorageSaveStore({ storage, schema }) };
}

describe("E1.1 nowa gra dostaje własny seed", () => {
  it("parametry nowej gry pochodzą z entropii i są różne", () => {
    const a = createNewGameParams();
    const b = createNewGameParams();
    expect(Number.isInteger(a.seed) && a.seed >= 0 && a.seed <= 0xffff_ffff).toBe(true);
    expect(a.saveId).toMatch(/^save_[0-9a-f]{16}$/);
    expect(a.saveId).not.toBe(b.saveId);
  });

  it("entropia jest wstrzykiwalna i deterministyczna w testach", () => {
    let n = 0;
    const entropy = () => ++n * 1000;
    expect(createNewGameParams(entropy)).toEqual({ seed: 1000, saveId: "save_000007d000000bb8" });
  });

  it("silnik zapisuje seed w stanie i generuje z niego świat", () => {
    const a = newGame(1, "save_a");
    const b = newGame(2, "save_b");
    expect(a.world?.seed).toBe(1);
    expect(b.world?.seed).toBe(2);
    expect(a.world?.fingerprint).not.toBe(b.world?.fingerprint);
    expect(a.houses).not.toEqual(b.houses);
  });

  it("odrzuca niepoprawny seed i pusty saveId", () => {
    const named = run(initialState, { type: "setName", name: "Ola" });
    for (const bad of [{ seed: -1, saveId: "x" }, { seed: 1.5, saveId: "x" }, { seed: NaN, saveId: "x" }, { seed: 5, saveId: "" }]) {
      expect(applyCommand(named, { type: "startLoading", ...bad }).state).toBe(named);
    }
  });
});

describe("E1.2 zapis i odczyt zachowują stan trwały", () => {
  it("round-trip przez magazyn jest bez strat", async () => {
    const s = progressed();
    const original = save(s);
    const { store } = makeStore();
    expect(await store.save(original)).toEqual({ ok: true });
    const loaded = await store.load();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") return;
    expect(loaded.source).toBe("primary");
    expect(loaded.save).toEqual(original);
    const restored = hydrateState(loaded.save);
    expect(serializeState(restored, original.savedAt)).toEqual(original);
    expect(restored.world).toEqual(s.world);
    expect(restored.forestPose).toEqual({ x: 12.5, z: -7.25, yaw: 1.2 });
    expect(restored.houses).toEqual(s.houses);
    expect(restored.houses.some((h) => h.owned && h.level > 1)).toBe(true);
  });

  it("komenda game.load odtwarza stan i emituje zdarzenie", () => {
    const original = save(progressed());
    const out = applyCommand(initialState, { type: "game.load", save: original });
    expect(out.state).toEqual(hydrateState(original));
    expect(out.events).toContainEqual({ type: "game.loaded", saveId: original.saveId });
  });

  it("zapis w stanie śmierci też wraca spójnie", async () => {
    const s = run(started(), ...Array.from({ length: 15 }, () => ({ type: "tick", dt: 100 }) as const));
    expect(s.dead).toBe(true);
    const { store } = makeStore();
    await store.save(save(s));
    const loaded = await store.load();
    if (loaded.kind !== "ok") throw new Error("oczekiwano ok");
    const restored = hydrateState(loaded.save);
    expect(restored.dead).toBe(true);
    expect(restored.health).toBe(0);
    expect(restored.deaths).toBe(s.deaths);
  });
});

describe("E1.3 odświeżenie strony nie resetuje postępu", () => {
  it("nowa instancja magazynu na tym samym storage wznawia grę, bez stanu okien", async () => {
    const storage = new MemoryStorage();
    const before = run(progressed(), { type: "enter", view: "forest" }, { type: "pause.add", reason: "modal.test", owner: "ui" });
    expect(before.pauses.length).toBeGreaterThan(0);

    const first = new LocalStorageSaveStore({ storage });
    await first.save(save(before));

    const second = new LocalStorageSaveStore({ storage });
    const boot = await loadGame(second);
    expect(boot.kind).toBe("ok");
    if (boot.kind !== "ok") return;
    const after = reducer(initialState, { type: "game.load", save: boot.save });

    expect(after.phase).toBe("playing");
    expect(after.wallet).toBe(before.wallet);
    expect(after.slots).toEqual(before.slots);
    expect(after.houses).toEqual(before.houses);
    expect(after.elapsed).toBe(before.elapsed);
    expect(after.forestPose).toEqual(before.forestPose);
    expect(after.tutorialDone).toBe(true);
    expect(after.view).toBe("world");
    expect(after.pauses).toEqual([]);
    expect(after.toast).toBeNull();
  });

  it("autosave zapisuje istotną zmianę po debounce i ostatni stan przy flush", async () => {
    const { store, storage } = makeStore();
    const timers = fakeTimers();
    const saver = new Autosaver({ store, now: () => 5, timers });
    let s = started();
    saver.update(s);
    timers.runAll();
    await tick();
    s = run(s, { type: "buy", item: "item.hotdog" });
    saver.update(s);
    s = run(s, { type: "tick", dt: 3 });
    saver.update(s);
    saver.flush();
    await tick();

    const loaded = await new LocalStorageSaveStore({ storage }).load();
    if (loaded.kind !== "ok") throw new Error("oczekiwano ok");
    expect(loaded.save.player.wallet).toBe(s.wallet);
    expect(loaded.save.time.elapsed).toBe(3);
    expect(loaded.save.player.slots).toEqual(s.slots);
  });
});

describe("E1.4 ten sam seed = identyczny świat", () => {
  it("dwie nowe gry z tym samym seedem mają identyczne obiekty i odcisk", () => {
    const a = newGame(31337, "save_a");
    const b = newGame(31337, "save_b");
    expect(a.houses).toEqual(b.houses);
    expect(a.world?.fingerprint).toBe(b.world?.fingerprint);
  });

  it("zapisany świat przechodzi weryfikację i odtwarza się z seeda", () => {
    expect(verifyWorld(save(progressed(4242)))).toEqual({ ok: true });
  });
});

describe("E1.5 uszkodzony zapis nie niszczy poprawnej kopii", () => {
  async function twoSaves() {
    const { store, storage } = makeStore();
    const s1 = progressed();
    const s2 = run(s1, { type: "buy", item: "item.water" });
    await store.save(save(s1, 1));
    await store.save(save(s2, 2));
    return { store, storage, s1, s2 };
  }

  it("po zapisach istnieje kopia poprzedniego poprawnego stanu", async () => {
    const { storage, s1 } = await twoSaves();
    const bak = decodeSave(storage.getItem("miasto.save.bak") ?? "");
    expect(bak.kind).toBe("ok");
    if (bak.kind === "ok") expect(bak.save.player.wallet).toBe(s1.wallet);
  });

  it("uszkodzony główny zapis: odczyt z kopii, oryginał uszkodzenia zachowany, kopia nietknięta", async () => {
    const { storage, s1 } = await twoSaves();
    const bakBefore = storage.getItem("miasto.save.bak");
    const primary = storage.getItem("miasto.save") ?? "";
    const broken = primary.slice(0, Math.floor(primary.length / 2));
    storage.setItem("miasto.save", broken);

    const loaded = await new LocalStorageSaveStore({ storage }).load();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") return;
    expect(loaded.source).toBe("backup");
    expect(loaded.recoveredBecause?.length).toBeGreaterThan(0);
    expect(loaded.save.player.wallet).toBe(s1.wallet);
    expect(storage.getItem("miasto.save.bak")).toBe(bakBefore);
    expect(storage.getItem("miasto.save.corrupt")).toBe(broken);
    const repaired = decodeSave(storage.getItem("miasto.save") ?? "");
    expect(repaired.kind).toBe("ok");
  });

  it("zapis z zachowaną strukturą, ale zmienioną treścią, odpada na sumie kontrolnej", async () => {
    const { storage } = await twoSaves();
    const tampered = (storage.getItem("miasto.save") ?? "").replace(/"wallet":\d+/, '"wallet":999999999');
    expect(decodeSave(tampered).kind).toBe("invalid");
    storage.setItem("miasto.save", tampered);
    const loaded = await new LocalStorageSaveStore({ storage }).load();
    expect(loaded.kind === "ok" && loaded.source).toBe("backup");
  });

  it("gdy uszkodzone są oba zapisy: nic nie jest kasowane ani nadpisywane", async () => {
    const { storage } = await twoSaves();
    storage.setItem("miasto.save", "{zepsute");
    storage.setItem("miasto.save.bak", "{tez-zepsute");
    const loaded = await new LocalStorageSaveStore({ storage }).load();
    expect(loaded.kind).toBe("corrupt");
    expect(storage.getItem("miasto.save")).toBe("{zepsute");
    expect(storage.getItem("miasto.save.bak")).toBe("{tez-zepsute");
    expect(storage.getItem("miasto.save.corrupt")).toBe("{zepsute");
    expect(storage.getItem("miasto.save.corrupt.bak")).toBe("{tez-zepsute");
  });

  it("zapis nad uszkodzonym głównym nie rotuje go do kopii i zachowuje jego treść", async () => {
    const { storage, s1 } = await twoSaves();
    const bakBefore = storage.getItem("miasto.save.bak");
    storage.setItem("miasto.save", "{zepsute");
    const store = new LocalStorageSaveStore({ storage });
    expect(await store.save(save(s1, 9))).toEqual({ ok: true });
    expect(storage.getItem("miasto.save.bak")).toBe(bakBefore);
    expect(storage.getItem("miasto.save.corrupt")).toBe("{zepsute");
  });

  it("błąd zapisu głównego (np. brak miejsca) zostawia poprzedni poprawny zapis", async () => {
    const { storage, s2 } = await twoSaves();
    const before = storage.getItem("miasto.save");
    const failing: KeyValueStorage = {
      get length() { return storage.length; },
      key: (i) => storage.key(i),
      getItem: (k) => storage.getItem(k),
      removeItem: (k) => storage.removeItem(k),
      setItem: (k, v) => {
        if (k === "miasto.save") throw new Error("QuotaExceededError");
        storage.setItem(k, v);
      },
    };
    const outcome = await new LocalStorageSaveStore({ storage: failing }).save(save(run(s2, { type: "buy", item: "item.hotdog" }), 3));
    expect(outcome.ok).toBe(false);
    expect(storage.getItem("miasto.save")).toBe(before);
    const loaded = await new LocalStorageSaveStore({ storage }).load();
    expect(loaded.kind).toBe("ok");
  });

  it("nie zapisuje niepoprawnych danych", async () => {
    const { store, storage } = makeStore();
    const bad = { ...save(progressed()), player: { ...save(progressed()).player, health: 1000 } } as SaveV2;
    const outcome = await store.save(bad);
    expect(outcome.ok).toBe(false);
    expect(storage.getItem("miasto.save")).toBeNull();
  });

  it("zapis w nowszej wersji nie jest nadpisywany ani podmieniany kopią", async () => {
    const { storage, s1 } = await twoSaves();
    const newer = JSON.stringify({ format: "miasto-save", envelope: 1, checksum: hashHex(canonicalize({ version: 99 })), payload: { version: 99 } });
    storage.setItem("miasto.save", newer);
    const store = new LocalStorageSaveStore({ storage });
    const loaded = await store.load();
    expect(loaded.kind).toBe("unsupported");
    const outcome = await store.save(save(s1, 5));
    expect(outcome.ok).toBe(false);
    expect(storage.getItem("miasto.save")).toBe(newer);
  });

  it("nowa gra (inny saveId) archiwizuje poprzedni zapis, zamiast go gubić", async () => {
    const { storage, s2 } = await twoSaves();
    const oldPrimary = storage.getItem("miasto.save");
    const store = new LocalStorageSaveStore({ storage });
    await store.save(save(newGame(5, "save_inna"), 10));
    expect(storage.getItem("miasto.save.archive.0")).toBe(oldPrimary);
    const archived = decodeSave(storage.getItem("miasto.save.archive.0") ?? "");
    expect(archived.kind === "ok" && archived.save.player.wallet).toBe(s2.wallet);
  });

  it("reset usuwa zapis, kopie i archiwa, ale nie cudze klucze", async () => {
    const { storage } = await twoSaves();
    storage.setItem("inna.aplikacja", "x");
    storage.setItem("miasto.savefoo", "x");
    await new LocalStorageSaveStore({ storage }).reset();
    expect((storage as MemoryStorage).keys().sort()).toEqual(["inna.aplikacja", "miasto.savefoo"]);
  });
});

describe("E1.6 niezgodny worldFingerprint nie powoduje nadpisania", () => {
  function tamperedRaw(mutate: (s: SaveV2) => SaveV2): string {
    return encodeSave(mutate(save(progressed())));
  }

  it("zły odcisk: loadGame zgłasza niezgodność, dane w magazynie są bajt w bajt te same", async () => {
    const storage = new MemoryStorage();
    const raw = tamperedRaw((s) => ({ ...s, world: { ...s.world, fingerprint: fingerprintOf("inny świat") } }));
    storage.setItem("miasto.save", raw);
    const boot = await loadGame(new LocalStorageSaveStore({ storage }));
    expect(boot.kind).toBe("world_mismatch");
    expect(storage.getItem("miasto.save")).toBe(raw);
    expect((storage as MemoryStorage).keys()).toEqual(["miasto.save"]);
  });

  it("zmieniony seed lub niezmienne pole domu też jest wykrywane", () => {
    expect(verifyWorld({ ...save(progressed()), world: { ...save(progressed()).world, seed: 1 } }).ok).toBe(false);
    const s = save(progressed());
    expect(verifyWorld({ ...s, houses: s.houses.map((h, i) => (i === 0 ? { ...h, price: h.price + 1000 } : h)) }).ok).toBe(false);
    expect(verifyWorld({ ...s, houses: s.houses.slice(1) }).ok).toBe(false);
  });

  it("zmiana danych gracza w domu (owned, level) nie jest niezgodnością", () => {
    const s = save(progressed());
    expect(verifyWorld({ ...s, houses: s.houses.map((h) => ({ ...h, owned: !h.owned, level: 1 })) })).toEqual({ ok: true });
  });

  it("nieznana wersja generatora jest zgłaszana, bez zmian w magazynie", async () => {
    const storage = new MemoryStorage();
    const raw = tamperedRaw((s) => ({ ...s, world: { ...s.world, genVersion: 7 } }));
    storage.setItem("miasto.save", raw);
    const boot = await loadGame(new LocalStorageSaveStore({ storage }));
    expect(boot.kind).toBe("world_mismatch");
    expect(storage.getItem("miasto.save")).toBe(raw);
  });

  it("po wyborze nowej gry niezgodny zapis zostaje w archiwum", async () => {
    const storage = new MemoryStorage();
    const raw = tamperedRaw((s) => ({ ...s, world: { ...s.world, fingerprint: fingerprintOf("x") } }));
    storage.setItem("miasto.save", raw);
    const store = new LocalStorageSaveStore({ storage });
    await store.save(save(newGame(9, "save_nowa"), 20));
    expect(storage.getItem("miasto.save.archive.0")).toBe(raw);
  });
});

describe("E1.7 migracja jest bezpieczna (mechanizm, syntetyczna wersja 3)", () => {
  const v3: SchemaConfig = {
    current: 3,
    steps: { 2: (p) => ({ ...p, version: 3, schemaNote: "v3" }) },
    validate: (p) => {
      const { version, schemaNote, ...rest } = p as Record<string, unknown>;
      if (version !== 3 || schemaNote !== "v3") return { ok: false, problems: ["v3: brak pól"] };
      const base = validateSaveV2({ ...rest, version: 2 });
      return base.ok ? { ok: true, value: { ...base.value, version: 3, schemaNote } as unknown as SaveV2 } : base;
    },
  };

  const oldRaw = () => encodeSave(save(progressed()));

  it("migracja v1 -> v2 przechodzi, a oryginał zostaje w kopii przed migracją i w .bak", async () => {
    const storage = new MemoryStorage();
    const raw = oldRaw();
    storage.setItem("miasto.save", raw);
    const loaded = await new LocalStorageSaveStore({ storage, schema: v3 }).load();
    expect(loaded.kind).toBe("ok");
    if (loaded.kind !== "ok") return;
    expect(loaded.migratedFrom).toBe(2);
    expect(storage.getItem("miasto.save.premigration.v2.0")).toBe(raw);
    expect(storage.getItem("miasto.save.bak")).toBe(raw);
    const migrated = decodeSave(storage.getItem("miasto.save") ?? "", v3);
    expect(migrated.kind).toBe("ok");
    expect((migrated as { save: { version: number } }).save.version).toBe(3);
  });

  it("błąd migracji (wyjątek): oryginał nietknięty, kopia przed migracją istnieje", async () => {
    const storage = new MemoryStorage();
    const raw = oldRaw();
    storage.setItem("miasto.save", raw);
    const broken: SchemaConfig = { ...v3, steps: { 2: () => { throw new Error("bum"); } } };
    const loaded = await new LocalStorageSaveStore({ storage, schema: broken }).load();
    expect(loaded.kind).toBe("migration_failed");
    expect(storage.getItem("miasto.save")).toBe(raw);
    expect(storage.getItem("miasto.save.premigration.v2.0")).toBe(raw);
    expect(storage.getItem("miasto.save.bak")).toBeNull();
  });

  it("migracja dająca niepoprawne dane jest odrzucana, oryginał nietknięty", async () => {
    const storage = new MemoryStorage();
    const raw = oldRaw();
    storage.setItem("miasto.save", raw);
    const bad: SchemaConfig = { ...v3, steps: { 2: (p) => ({ ...p, version: 3 }) } };
    const loaded = await new LocalStorageSaveStore({ storage, schema: bad }).load();
    expect(loaded.kind).toBe("migration_failed");
    expect(storage.getItem("miasto.save")).toBe(raw);
  });

  it("brak kroku migracji i zła wersja kroku są błędami, a nie cichym pominięciem", () => {
    const payload = JSON.parse(JSON.stringify(save(progressed())));
    expect(migratePayload(payload, 2, { ...v3, steps: {} }).ok).toBe(false);
    expect(migratePayload(payload, 2, { ...v3, steps: { 2: (p) => ({ ...p, version: 5 }) } }).ok).toBe(false);
  });

  it("migracja nie modyfikuje danych wejściowych", () => {
    const payload = JSON.parse(JSON.stringify(save(progressed()))) as Record<string, unknown>;
    const snapshot = JSON.stringify(payload);
    const out = migratePayload(payload, 2, v3);
    expect(out.ok).toBe(true);
    expect(JSON.stringify(payload)).toBe(snapshot);
  });

  it("brak miejsca na kopię przed migracją przerywa migrację", async () => {
    const mem = new MemoryStorage();
    const raw = oldRaw();
    mem.setItem("miasto.save", raw);
    const noRoom: KeyValueStorage = {
      get length() { return mem.length; },
      key: (i) => mem.key(i),
      getItem: (k) => mem.getItem(k),
      removeItem: (k) => mem.removeItem(k),
      setItem: (k, v) => {
        if (k.includes("premigration")) throw new Error("Quota");
        mem.setItem(k, v);
      },
    };
    const loaded = await new LocalStorageSaveStore({ storage: noRoom, schema: v3 }).load();
    expect(loaded.kind).toBe("migration_failed");
    expect(mem.getItem("miasto.save")).toBe(raw);
  });
});

describe("E1.8 w zapisie nie ma Three.js ani stanu tymczasowego", () => {
  const isPlain = (value: unknown): boolean => {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
    if (Array.isArray(value)) return value.every(isPlain);
    if (typeof value === "object") {
      const proto = Object.getPrototypeOf(value);
      return (proto === Object.prototype || proto === null) && Object.values(value as object).every(isPlain);
    }
    return false;
  };

  it("zapis ma tylko dozwolone klucze i same dane proste", () => {
    const s = run(progressed(), { type: "enter", view: "forest" }, { type: "pause.add", reason: "modal.a", owner: "ui" }, { type: "buy", item: "item.water" });
    expect(s.toast).not.toBeNull();
    const out = save(s);
    expect(Object.keys(out).sort()).toEqual([...SAVE_TOP_LEVEL_KEYS].sort());
    expect(isPlain(out)).toBe(true);
    const json = JSON.stringify(out);
    for (const forbidden of ["toast", "pauses", "toastSeq", "modal.a", "THREE", "isObject3D", "Mesh", "geometry", "\"view\""]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("stan tymczasowy nie wpływa na zawartość zapisu", () => {
    const base = progressed();
    const noisy = run(
      base,
      { type: "enter", view: "shop" },
      { type: "pause.add", reason: "modal.a", owner: "ui" },
      { type: "pause.add", reason: "ui.map", owner: "hud" },
    );
    expect(canonicalize(serializeState({ ...noisy, view: "world", pauses: [], toast: null, toastSeq: 0 }, 1))).toBe(
      canonicalize(serializeState({ ...base, view: "world", pauses: [], toast: null, toastSeq: 0 }, 1)),
    );
    expect(save(noisy).player).toEqual(save({ ...noisy, view: "world", pauses: [] }).player);
  });

  it("nie zapisuje gry, która jeszcze się nie rozpoczęła", () => {
    expect(serializeState(initialState, 1)).toBeNull();
    expect(serializeState({ ...newGame(), phase: "loading" }, 1)).toBeNull();
    expect(serializeState({ ...newGame(), world: null }, 1)).toBeNull();
  });

  it("wczytanie czyści stan sesji", () => {
    const s = hydrateState(save(progressed()));
    expect(s.view).toBe("world");
    expect(s.pauses).toEqual([]);
    expect(s.toast).toBeNull();
    expect(s.toastSeq).toBe(0);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- testy celowo mutują zapis na niepoprawne wartości */
describe("walidacja zapisu", () => {
  const valid = () => JSON.parse(JSON.stringify(save(progressed()))) as Record<string, any>;

  it("akceptuje poprawny zapis", () => {
    expect(validateSaveV2(valid()).ok).toBe(true);
  });

  it.each([
    ["wallet ujemny", (s: any) => (s.player.wallet = -1)],
    ["wallet ułamkowy", (s: any) => (s.player.wallet = 1.5)],
    ["health > max", (s: any) => (s.player.health = 101)],
    ["niespójne dead/health", (s: any) => (s.player.dead = true)],
    ["nieznany przedmiot", (s: any) => (s.player.slots[2] = "bomba")],
    ["zła liczba miejsc", (s: any) => s.player.slots.pop()],
    ["telefon nie w slocie 0", (s: any) => (s.player.slots[0] = null)],
    ["selected poza zakresem", (s: any) => (s.player.selected = 8)],
    ["pozycja poza lasem", (s: any) => (s.player.forestPose = { x: 500, z: 0, yaw: 0 })],
    ["pozycja NaN", (s: any) => (s.player.forestPose = { x: NaN, z: 0, yaw: 0 })],
    ["seed nie uint32", (s: any) => (s.world.seed = -5)],
    ["zły odcisk", (s: any) => (s.world.fingerprint = "abc")],
    ["brak tutorial", (s: any) => delete s.tutorial],
    ["dom: zły telefon", (s: any) => (s.houses[0].phone = "12")],
    ["dom: zły kolor", (s: any) => (s.houses[0].wallColor = "red")],
    ["duplikat id domu", (s: any) => (s.houses[1].id = s.houses[0].id)],
    ["elapsed ujemny", (s: any) => (s.time.elapsed = -1)],
    ["saveId z niedozwolonymi znakami", (s: any) => (s.saveId = "a b")],
  ])("odrzuca: %s", (_name, mutate) => {
    const s = valid();
    mutate(s);
    expect(validateSaveV2(s).ok).toBe(false);
  });

  it("odrzuca nie-obiekty", () => {
    for (const bad of [null, 5, "x", [], undefined]) expect(validateSaveV2(bad).ok).toBe(false);
  });
});

/* eslint-enable @typescript-eslint/no-explicit-any */
describe("komenda forest.pose", () => {
  it("zapisuje poprawną pozycję, odrzuca niepoprawną i nie zmienia stanu przy powtórce", () => {
    const s = newGame();
    const moved = applyCommand(s, { type: "forest.pose", pose: { x: 3, z: 4, yaw: 0.5 } });
    expect(moved.state.forestPose).toEqual({ x: 3, z: 4, yaw: 0.5 });
    expect(applyCommand(moved.state, { type: "forest.pose", pose: { x: 3, z: 4, yaw: 0.5 } }).state).toBe(moved.state);
    for (const pose of [{ x: 150, z: 0, yaw: 0 }, { x: NaN, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: Infinity }]) {
      expect(applyCommand(s, { type: "forest.pose", pose }).state).toBe(s);
    }
  });
});

function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimeout: (fn: () => void) => {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout: (h: unknown) => void pending.delete(h as number),
    runAll() {
      const fns = [...pending.values()];
      pending.clear();
      fns.forEach((fn) => fn());
    },
    count: () => pending.size,
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function recordingStore() {
  const saved: SaveV2[] = [];
  const store: SaveStore = {
    load: async () => ({ kind: "none" }),
    save: async (s): Promise<SaveOutcome> => {
      saved.push(s);
      return { ok: true };
    },
    reset: async () => {},
  };
  return { store, saved };
}

describe("Autosaver", () => {
  it("nie zapisuje przed rozpoczęciem gry", async () => {
    const { store, saved } = recordingStore();
    const timers = fakeTimers();
    const saver = new Autosaver({ store, now: () => 1, timers });
    saver.update(initialState);
    saver.flush();
    timers.runAll();
    await tick();
    expect(saved).toHaveLength(0);
  });

  it("istotna zmiana zapisuje po debounce, a sam upływ czasu dopiero po interwale", async () => {
    const { store, saved } = recordingStore();
    const timers = fakeTimers();
    const saver = new Autosaver({ store, now: () => 1, timers });
    let s = started();
    saver.update(s);
    timers.runAll();
    await tick();
    expect(saved).toHaveLength(1);

    s = run(s, { type: "tick", dt: 1 });
    saver.update(s);
    expect(timers.count()).toBe(1);
    s = run(s, { type: "tick", dt: 1 });
    saver.update(s);
    expect(timers.count()).toBe(1);
    timers.runAll();
    await tick();
    expect(saved).toHaveLength(2);
    expect(saved[1].time.elapsed).toBe(2);

    s = run(s, { type: "buy", item: "item.hotdog" });
    saver.update(s);
    timers.runAll();
    await tick();
    expect(saved).toHaveLength(3);
    expect(saved[2].player.wallet).toBe(s.wallet);
  });

  it("postęp questa (przyjęcie zadania) jest istotną zmianą – uruchamia zapis z debounce", async () => {
    const { store, saved } = recordingStore();
    const timers = fakeTimers();
    const saver = new Autosaver({ store, now: () => 1, timers });
    let s = started();
    saver.update(s);
    timers.runAll();
    await tick();
    expect(saved).toHaveLength(1);

    s = run(s, { type: "tick", dt: 1 });
    saver.update(s);
    expect(timers.count()).toBe(1);

    s = run(s, { type: "quest.accept", id: "quest.bridge_01" });
    saver.update(s);
    expect(timers.count()).toBe(2);
    timers.runAll();
    await tick();
    expect(Object.keys(saved.at(-1)?.quests.accepted ?? {})).toContain("quest.bridge_01");
  });

  it("flush bez zmian nie zapisuje drugi raz, a zapis startowy (initial) jest pomijany", async () => {
    const { store, saved } = recordingStore();
    const timers = fakeTimers();
    const s = progressed();
    const saver = new Autosaver({ store, now: () => 1, timers, initial: save(s, 0) });
    saver.update(s);
    saver.flush();
    await tick();
    expect(saved).toHaveLength(0);
    const changed = run(s, { type: "buy", item: "item.water" });
    saver.update(changed);
    saver.flush();
    await tick();
    expect(saved).toHaveLength(1);
    saver.flush();
    await tick();
    expect(saved).toHaveLength(1);
  });

  it("po dispose nic już nie zapisuje", async () => {
    const { store, saved } = recordingStore();
    const timers = fakeTimers();
    const saver = new Autosaver({ store, now: () => 1, timers });
    saver.update(newGame());
    saver.dispose();
    saver.flush();
    timers.runAll();
    await tick();
    expect(saved).toHaveLength(0);
  });

  it("nieudany zapis jest raportowany i ponawiany przy następnym flush", async () => {
    let fail = true;
    const results: SaveOutcome[] = [];
    const store: SaveStore = {
      load: async () => ({ kind: "none" }),
      save: async () => (fail ? { ok: false, error: "pełny dysk" } : { ok: true }),
      reset: async () => {},
    };
    const saver = new Autosaver({ store, now: () => 1, timers: fakeTimers(), onResult: (o) => results.push(o) });
    saver.update(newGame());
    saver.flush();
    await tick();
    fail = false;
    saver.flush();
    await tick();
    expect(results).toEqual([{ ok: false, error: "pełny dysk" }, { ok: true }]);
  });
});
