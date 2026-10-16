import { describe, expect, it } from "vitest";
import { QUEST_BRIDGE_01 } from "../content/quests";
import { reducer, type Command } from "../core/apply";
import { initialState, type GameState } from "../core/state";
import { Autosaver } from "../save/autosave";
import { hydrateState } from "../save/hydrate";
import { loadGame } from "../save/loader";
import { MemoryStorage } from "../save/memoryStorage";
import { LocalStorageSaveStore } from "../save/store";
import { harvestTargets, inForest, newPlaying, run } from "../testkit";
import { harvestOf } from "../world/harvest";
import { forestChestsOf, forestObject, forestWalkOf, syncHarvestedColliders } from "../world/lookup";
import { countOf } from "./containers";
import type { ViewPose } from "./interaction";
import { CHEST_WINDOW_DELAY_MS, ForestInteractor } from "./interactor";
import { questProgress } from "./quests";

const SEED = 4242;
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const standing = (target: { x: number; z: number }, d: number, from = Math.PI / 3): ViewPose => {
  const pose = { x: target.x + Math.cos(from) * d, z: target.z + Math.sin(from) * d, yaw: 0 };
  pose.yaw = yawTo(target.x - pose.x, target.z - pose.z);
  return pose;
};

function session(initial: GameState) {
  const h = { state: initial, pose: null as ViewPose | null, time: 5000, log: [] as Command[] };
  const interactor = new ForestInteractor({
    getState: () => h.state,
    dispatch: (c) => {
      h.log.push(c);
      h.state = reducer(h.state, c);
    },
    getPose: () => h.pose,
    now: () => h.time,
  });
  const fetchChest = (id: string) => {
    const chest = forestChestsOf(SEED).find((c) => c.id === id)!;
    h.pose = standing(chest, 1.6);
    interactor.poll();
    interactor.press();
    h.time += CHEST_WINDOW_DELAY_MS + 5;
    interactor.poll();
    interactor.press();
    interactor.poll();
  };
  const harvestNearest = (kind: "tree" | "rock", need: number, item: "resource.wood" | "resource.stone") => {
    for (const t of harvestTargets(SEED)) {
      if (countOf(h.state.slots, item) >= need) break;
      if (t.kind !== kind || h.state.harvested.includes(t.id)) continue;
      const obj = forestObject(SEED, t.id)!;
      h.pose = standing(obj, 1.6, 1.1);
      const snap = interactor.poll();
      if (snap.target?.id !== t.id || snap.prompt?.key !== "E") continue;
      interactor.press();
    }
  };
  return { h, interactor, fetchChest, harvestNearest };
}

const fresh = () => inForest(run(newPlaying(SEED), { type: "board.read", id: QUEST_BRIDGE_01 }, { type: "quest.accept", id: QUEST_BRIDGE_01 }));

describe("M1/C1: grywalny fragment questa w jednym przebiegu (E, ekwipunek, dziennik, zapis)", () => {
  it("skrzynie -> narzędzia -> drewno i kamień wyłącznie przez interakcje; zapis, zamknięcie i kontynuacja zachowują wszystko", async () => {
    const s = session(fresh());
    s.fetchChest("chest.bridge.saw");
    s.fetchChest("chest.bridge.pickaxe");
    expect(countOf(s.h.state.slots, "item.saw")).toBe(1);
    expect(countOf(s.h.state.slots, "item.pickaxe")).toBe(1);
    expect(s.h.state.chests["chest.bridge.saw"]).toEqual({ opened: true, taken: true });
    expect(s.h.state.chests["chest.bridge.blueprint"]).toBeUndefined();
    const stage0 = questProgress(s.h.state, QUEST_BRIDGE_01)!.stages[0];
    expect(stage0.done).toBe(true);

    s.harvestNearest("tree", 5, "resource.wood");
    s.harvestNearest("rock", 10, "resource.stone");
    expect(countOf(s.h.state.slots, "resource.wood")).toBeGreaterThanOrEqual(5);
    expect(countOf(s.h.state.slots, "resource.stone")).toBeGreaterThanOrEqual(10);
    const materials = questProgress(s.h.state, QUEST_BRIDGE_01)!.stages[2];
    expect(materials.objectives.map((o) => o.done)).toEqual([true, true]);
    expect(s.h.state.harvested.length).toBeGreaterThan(2);

    const storage = new MemoryStorage();
    const store = new LocalStorageSaveStore({ storage });
    const saver = new Autosaver({ store, now: () => 1 });
    saver.update(s.h.state);
    saver.flush();
    await new Promise((r) => setTimeout(r, 0));
    saver.dispose();

    const boot = await loadGame(new LocalStorageSaveStore({ storage }));
    expect(boot.kind).toBe("ok");
    if (boot.kind !== "ok") return;
    const loaded = reducer(initialState, { type: "game.load", save: boot.save });
    expect(loaded.chests).toEqual(s.h.state.chests);
    expect(loaded.harvested).toEqual(s.h.state.harvested);
    expect(loaded.slots).toEqual(s.h.state.slots);
    expect(loaded.ledger).toEqual(s.h.state.ledger);
    expect(loaded.quests).toEqual(s.h.state.quests);
    expect(hydrateState(boot.save).harvested).toEqual(s.h.state.harvested);

    // Po wczytaniu: pobrane skrzynie nie dają nic drugi raz, zebrane obiekty nie są celem, postęp zadania jest ten sam.
    const after = session(inForest(loaded));
    after.fetchChest("chest.bridge.saw");
    after.fetchChest("chest.bridge.pickaxe");
    expect(countOf(after.h.state.slots, "item.saw")).toBe(1);
    expect(countOf(after.h.state.slots, "item.pickaxe")).toBe(1);
    expect(after.h.state.ledger.gained["item.saw"]).toBe(1);
    const gone = s.h.state.harvested[0];
    const obj = forestObject(SEED, gone)!;
    after.h.pose = standing(obj, 1.6, 1.1);
    expect(after.interactor.poll().target?.id).not.toBe(gone);
    expect(questProgress(after.h.state, QUEST_BRIDGE_01)!.stages.map((st) => st.done)).toEqual(questProgress(s.h.state, QUEST_BRIDGE_01)!.stages.map((st) => st.done));
  }, 60_000);

  it("zapis w trakcie: skrzynia otwarta, lecz niezabrana, wraca otwarta z przedmiotem w środku", async () => {
    const s = session(fresh());
    const chest = forestChestsOf(SEED).find((c) => c.id === "chest.bridge.pickaxe")!;
    s.h.pose = standing(chest, 1.6);
    s.interactor.press();
    expect(s.h.state.chests["chest.bridge.pickaxe"]).toEqual({ opened: true, taken: false });

    const storage = new MemoryStorage();
    const saver = new Autosaver({ store: new LocalStorageSaveStore({ storage }), now: () => 1 });
    saver.update(s.h.state);
    saver.flush();
    await new Promise((r) => setTimeout(r, 0));
    saver.dispose();
    const boot = await loadGame(new LocalStorageSaveStore({ storage }));
    if (boot.kind !== "ok") throw new Error("oczekiwano ok");
    const back = session(inForest(reducer(initialState, { type: "game.load", save: boot.save })));
    expect(back.h.state.chests["chest.bridge.pickaxe"]).toEqual({ opened: true, taken: false });
    back.h.pose = standing(chest, 1.6);
    expect(back.interactor.poll().prompt?.text).toBe("Zobacz zawartość skrzyni");
    back.interactor.press();
    back.interactor.takeFromWindow();
    expect(countOf(back.h.state.slots, "item.pickaxe")).toBe(1);
  });
});

describe("M1/C1: zasoby na zachodnim brzegu i kolizje zebranych obiektów", () => {
  it("na 24 seedach jest dość drzew i skał, by zebrać 5 drewna i 10 kamieni (z zapasem), a surowce mieszczą się w jednym stosie", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const list = harvestTargets(seed);
      const wood = list.filter((t) => t.kind === "tree").reduce((n, t) => n + (harvestOf(forestObject(seed, t.id)!)?.amount ?? 0), 0);
      const stone = list.filter((t) => t.kind === "rock").reduce((n, t) => n + (harvestOf(forestObject(seed, t.id)!)?.amount ?? 0), 0);
      expect(wood, `drewno, seed ${seed}`).toBeGreaterThanOrEqual(15);
      expect(stone, `kamień, seed ${seed}`).toBeGreaterThanOrEqual(30);
    }
  }, 120_000);

  it("zebrane drzewo przestaje blokować ruch (kolizja usunięta), a cofnięcie zbioru przywraca ją", () => {
    const tree = harvestTargets(SEED).find((t) => {
      const o = forestObject(SEED, t.id)!;
      return t.kind === "tree" && o.collider?.shape === "circle";
    })!;
    const obj = forestObject(SEED, tree.id)!;
    const r = obj.collider?.shape === "circle" ? obj.collider.r : 0.5;
    const walk = forestWalkOf(SEED);
    const from = { x: obj.x - r - 0.5, z: obj.z };
    const to = { x: obj.x + r + 0.5, z: obj.z };
    syncHarvestedColliders(SEED, []);
    const blocked = walk.move(from, to);
    expect(Math.hypot(blocked.x - to.x, blocked.z - to.z)).toBeGreaterThan(0.3);
    syncHarvestedColliders(SEED, [tree.id]);
    const open = walk.move(from, to);
    expect(open.x).toBeCloseTo(to.x, 1);
    syncHarvestedColliders(SEED, []);
    const again = walk.move(from, to);
    expect(Math.hypot(again.x - to.x, again.z - to.z)).toBeGreaterThan(0.3);
  });
});
