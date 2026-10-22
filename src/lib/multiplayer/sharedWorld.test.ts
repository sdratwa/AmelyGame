import { describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../../../server/src/server";
import { WorldStore } from "../../../server/src/worldStore";
import { MultiplayerClient } from "./client";
import { GameCommands } from "./commands";
import { emptySharedWorld, resolveWorldCommand } from "./sharedWorld";
import { createInstance } from "./world";
import { grantItem, harvestTargets, newPlaying } from "../game/testkit";
import { serializeState } from "../game/save/serialize";
import { validateSaveV4 } from "../game/save/validate";
import { reducer } from "../game/core/apply";
import { RECIPE_BRIDGE_01 } from "../game/content/quests";
import { countOf } from "../game/systems/containers";
import { forestBridgeOf, forestWalkOf, syncBridgeColliders, syncHarvestedColliders } from "../game/world/lookup";
import { BRIDGE_FLAG } from "../game/world/generators/v2/plan";

const ref = { seed: 2030, genVersion: 3 };
const config = createInstance().config;
function prepared() {
  let state = { ...newPlaying(2030), view: "forest" as const };
  for (const id of ["item.saw", "item.pickaxe", "item.bridge_blueprint"] as const) state = grantItem(state, id, 1) as typeof state;
  for (const item of RECIPE_BRIDGE_01.requires) state = grantItem(state, item.id, item.count) as typeof state;
  return state;
}
async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw Error("Timed out waiting for shared world");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("shared multiplayer world", () => {
  it("validates inventory, target, command and world; ignores personal world deltas", () => {
    const tree = harvestTargets(ref).find((t) => t.kind === "tree")!;
    const state = prepared();
    const command = { type: "harvest" as const, objectId: tree.id, at: tree.at };
    const world = emptySharedWorld();
    const save = serializeState(state, 0)!;
    expect(resolveWorldCommand(world, config, command, save).accepted).toBe(true);
    for (const invalid of [{ ...command, playerId: "spoof" }, { ...command, objectId: "absent" }, { ...command, at: null }, { type: "game.load", save }]) {
      expect(resolveWorldCommand(world, config, invalid, save)).toEqual({ accepted: false, world });
    }
    expect(resolveWorldCommand(world, config, command, { ...save, world: { ...save.world, seed: 1 } }).accepted).toBe(false);
    expect(resolveWorldCommand(world, config, command, serializeState({ ...newPlaying(2030), view: "forest" }, 0)).accepted).toBe(false);
    const accepted = resolveWorldCommand(world, config, command, save);
    expect(resolveWorldCommand(accepted.world, config, command, save).accepted).toBe(false);
    const synced = reducer({ ...state, elapsed: 0 }, { type: "world.sync", world: { ...accepted.world, bridgeBuilt: true } });
    expect(validateSaveV4(serializeState(synced, 0)).ok).toBe(true);
    const reset = reducer({ ...synced, discovered: ["region.beyond_bridge"] }, { type: "world.sync", world });
    expect(reset.bridge.built).toBe(false);
    expect(validateSaveV4(serializeState(reset, 0)).ok).toBe(true);
  });

  it("merges existing online saves without resurrecting resources or losing a built bridge", () => {
    const targets = harvestTargets(ref);
    const first = { ...prepared(), harvested: [targets[0].id], bridge: { built: true, builtAt: 0 } };
    const restored = resolveWorldCommand(emptySharedWorld(), config, { type: "world.restore" }, serializeState(first, 0));
    expect(restored.accepted).toBe(true);
    const second = { ...prepared(), harvested: [targets[1].id] };
    const merged = resolveWorldCommand(restored.world, config, { type: "world.restore" }, serializeState(second, 0));
    expect(merged.world.harvested).toEqual([targets[0].id, targets[1].id]);
    expect(merged.world.bridgeBuilt).toBe(true);
    expect(resolveWorldCommand(merged.world, config, { type: "world.restore" }, serializeState(second, 0)).world).toEqual(merged.world);
    expect(resolveWorldCommand(merged.world, config, { type: "world.restore" }, serializeState({ ...first, harvested: ["nonexistent"] }, 0)).accepted).toBe(false);
    const solo = new GameCommands(first, () => {});
    solo.dispatch({ type: "world.clock", elapsed: 20 });
    expect(solo.current.bridge).toEqual(first.bridge);
  });

  it("persists room state atomically and refuses to overwrite corrupt or incompatible data", () => {
    const dir = mkdtempSync(join(tmpdir(), "miasto-world-"));
    try {
      const path = join(dir, "world.json");
      const store = new WorldStore(path, config);
      expect(store.load()).toEqual(emptySharedWorld());
      const world = { revision: 2, harvested: [harvestTargets(ref)[0].id], bridgeBuilt: true };
      store.save(world);
      expect(new WorldStore(path, config).load()).toEqual(world);
      expect(() => new WorldStore(path, { ...config, worldSeed: 42 }).load()).toThrow();
      writeFileSync(path, "corrupt");
      expect(() => store.load()).toThrow();
      expect(readFileSync(path, "utf8")).toBe("corrupt");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("two clients arbitrate harvest/build, update collisions, and hydrate a late join/reconnect", async () => {
    const server = createServer();
    await server.listen(0, "127.0.0.1");
    const address = server.transport.server!.address();
    if (!address || typeof address === "string") throw Error("port");
    const endpoint = `ws://127.0.0.1:${address.port}`;
    await matchMaker.createRoom("forest", { worldInstanceId: "world_001" });
    const a = new MultiplayerClient(), b = new MultiplayerClient(), late = new MultiplayerClient();
    try {
      await a.connect(endpoint);
      await b.connect(endpoint);
      // Leave room in resource stacks for harvesting.
      let sa = grantItem({ ...newPlaying(2030), view: "forest" }, "item.saw", 1);
      sa = grantItem(sa, "item.pickaxe", 1);
      let sb = structuredClone(sa);
      const qa = new GameCommands(sa, (state) => { sa = state; }, a);
      const qb = new GameCommands(sb, (state) => { sb = state; }, b);
      a.subscribeWorld(qa.sync); b.subscribeWorld(qb.sync);
      for (const kind of ["tree", "rock"] as const) {
        const target = harvestTargets(ref).find((t) => t.kind === kind)!;
        const command = { type: "harvest" as const, objectId: target.id, at: target.at };
        qa.dispatch(command); qb.dispatch(command);
        qa.dispatch({ type: "select", slot: 2 });
        await until(() => sa.harvested.includes(target.id) && sb.harvested.includes(target.id));
        const item = kind === "tree" ? "resource.wood" : "resource.stone";
        expect(countOf(sa.slots, item) > 0).not.toBe(countOf(sb.slots, item) > 0);
        expect(sa.selected).toBe(2);
        syncHarvestedColliders(ref, sb.harvested);
        expect(forestWalkOf(ref).index.get(target.id)).toBeUndefined();
      }
      qa.dispatch({ type: "game.load", save: serializeState(prepared(), 0)! });
      qb.dispatch({ type: "game.load", save: serializeState(prepared(), 0)! });
      qa.dispatch({ type: "enter", view: "forest" }); qb.dispatch({ type: "enter", view: "forest" });
      const at = sa.world!.anchors!.bridge.west;
      qa.dispatch({ type: "bridge.build", at }); qb.dispatch({ type: "bridge.build", at });
      await until(() => sa.bridge.built && sb.bridge.built);
      for (const item of RECIPE_BRIDGE_01.requires) expect(countOf(sa.slots, item.id) + countOf(sb.slots, item.id)).toBe(item.count);
      expect(sa.harvested).toEqual(sb.harvested);
      expect(validateSaveV4(serializeState(sb, 0)).ok).toBe(true);
      syncBridgeColliders(ref, true);
      const layout = forestBridgeOf(ref);
      const walk = forestWalkOf(ref);
      const blocked = walk.move(layout.west, layout.east);
      expect(Math.hypot(blocked.x - layout.east.x, blocked.z - layout.east.z)).toBeGreaterThan(1);
      for (const state of [sa, sb]) {
        const flags = new Set(state.bridge.built ? [BRIDGE_FLAG] : []);
        const crossed = walk.move(layout.west, layout.east, flags);
        expect(Math.hypot(crossed.x - layout.east.x, crossed.z - layout.east.z)).toBeLessThan(0.01);
      }
      await late.connect(endpoint);
      expect(late.world).toEqual(a.world);
      expect(late.world?.bridgeBuilt).toBe(true);
      b.disconnect();
      await b.connect(endpoint);
      expect(b.world).toEqual(a.world);
      b.disconnect();
      const before = sb;
      qb.dispatch({ type: "harvest", objectId: harvestTargets(ref)[3].id, at: harvestTargets(ref)[3].at });
      expect(sb).toBe(before);
    } finally {
      a.disconnect(); b.disconnect(); late.disconnect();
      syncHarvestedColliders(ref, []);
      syncBridgeColliders(ref, false);
      await server.gracefullyShutdown(false);
    }
  }, 30000);
});
