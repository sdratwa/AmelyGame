import { describe, expect, it } from "vitest";
import { initialState, reducer } from "../game/engine";
import { serializeState } from "../game/save/serialize";
import { LocalStorageSaveStore, type KeyValueStorage } from "../game/save/store";
import { fingerprintWorld, generateWorld } from "../game/world/registry";
import { loadOnlineGame, onlineSavePrefix } from "./save";
import type { Player, WorldConfig } from "./protocol";

const config: WorldConfig = { worldId: "forest_start", worldInstanceId: "world_001", worldSeed: 2030, generatorVersion: 4, fingerprint: fingerprintWorld(generateWorld(2030, 4)) };
const player = { playerId: "first-session", name: "Odkrywca", x: 12, z: 18, bodyYaw: 0 } as Player;
function storage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

describe("trwały postęp online", () => {
  it("ponowne wejście z nowym playerId odtwarza quest, przedmioty, świat i pozycję bez zmiany solo", async () => {
    const memory = storage();
    const solo = new LocalStorageSaveStore({ storage: memory });
    const online = () => new LocalStorageSaveStore({ storage: memory, prefix: onlineSavePrefix(config) });
    const soloState = reducer(reducer({ ...initialState, name: "Solo" }, { type: "startLoading", seed: 42, saveId: "solo" }), { type: "worldReady" });
    const soloSave = serializeState(soloState, 1)!;
    expect(await solo.save(soloSave)).toEqual({ ok: true });
    const boot = await loadOnlineGame(online(), config, player);
    if (boot.kind !== "ok") throw Error(boot.kind);
    let state = reducer(initialState, { type: "game.load", save: boot.save });
    state = reducer(state, { type: "quest.accept", id: "quest.bridge_01" });
    state = { ...state, elapsed: 20, ledger: { gained: { ...state.ledger.gained, "item.pickaxe": 1, "item.bridge_blueprint": 1 }, spent: state.ledger.spent }, slots: [{ id: "item.pickaxe", count: 1 }, { id: "item.bridge_blueprint", count: 1 }, ...state.slots.slice(2)], forestPose: { x: 70, z: 80, yaw: 1.5 }, bridge: { built: true, builtAt: 10 } };
    expect(state.quests.accepted["quest.bridge_01"]).toBeDefined();
    const saved = serializeState(state, 2)!;
    expect(await online().save(saved)).toEqual({ ok: true });
    const resumed = await loadOnlineGame(online(), config, { ...player, playerId: "reconnected", x: 99 });
    expect(resumed.kind).toBe("ok");
    if (resumed.kind !== "ok") throw Error(resumed.kind);
    expect(resumed.save).toEqual(saved);
    expect(await solo.load()).toMatchObject({ kind: "ok", save: soloSave });
  });

  it("nie zastępuje postępu przy niezgodnym świecie ani uszkodzonym zapisie", async () => {
    const memory = storage();
    const prefix = onlineSavePrefix(config);
    const store = new LocalStorageSaveStore({ storage: memory, prefix });
    const boot = await loadOnlineGame(store, config, player);
    if (boot.kind !== "ok") throw Error(boot.kind);
    await store.save(boot.save);
    expect((await loadOnlineGame(store, { ...config, worldSeed: 99 }, player)).kind).toBe("world_mismatch");
    expect(await store.load()).toMatchObject({ kind: "ok", save: boot.save });
    memory.setItem(prefix, "broken");
    expect((await loadOnlineGame(store, config, player)).kind).toBe("corrupt");
    expect(memory.getItem(prefix)).toBe("broken");
  });
});
