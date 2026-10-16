import { describe, expect, it } from "vitest";
import { reducer, type Command } from "../core/apply";
import type { GameState } from "../core/state";
import { harvestTargets, inForest, newPlaying, run, slotsFrom } from "../testkit";
import { forestChestsOf, forestObject } from "../world/lookup";
import { countOf } from "./containers";
import { CHEST_WINDOW_DELAY_MS, ForestInteractor, OPEN_CONFIRM_TIMEOUT_MS } from "./interactor";
import type { ViewPose } from "./interaction";
import { questProgress } from "./quests";

const SEED = 777;
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const standing = (target: { x: number; z: number }, d: number, from = 0): ViewPose => {
  const pose = { x: target.x + Math.cos(from) * d, z: target.z + Math.sin(from) * d, yaw: 0 };
  pose.yaw = yawTo(target.x - pose.x, target.z - pose.z);
  return pose;
};

function harness(initial?: GameState) {
  const h = {
    state: initial ?? inForest(run(newPlaying(SEED), { type: "quest.accept", id: "quest.bridge_01" })),
    pose: null as ViewPose | null,
    time: 1000,
    dispatched: [] as Command[],
  };
  const interactor = new ForestInteractor({
    getState: () => h.state,
    dispatch: (c) => {
      h.dispatched.push(c);
      h.state = reducer(h.state, c);
    },
    getPose: () => h.pose,
    now: () => h.time,
  });
  return { h, interactor, advance: (ms: number) => void (h.time += ms) };
}

const chest = (id: string) => forestChestsOf(SEED).find((c) => c.id === id)!;

describe("M1/C1: kontroler interakcji (E, okno skrzyni)", () => {
  it("E na zamkniętej skrzyni: komenda silnika, animacja, okno po opóźnieniu, zabranie przedmiotu, postęp zadania", () => {
    const { h, interactor, advance } = harness();
    const saw = chest("chest.bridge.saw");
    h.pose = standing(saw, 1.8);
    expect(interactor.poll().prompt).toEqual({ key: "E", text: "Otwórz skrzynię", tone: "action" });

    expect(interactor.press()).toBe(true);
    expect(h.dispatched.map((c) => c.type)).toEqual(["chest.open"]);
    expect(h.state.chests["chest.bridge.saw"]).toEqual({ opened: true, taken: false });
    expect(interactor.snapshot.opening).toBe("chest.bridge.saw");
    expect(interactor.snapshot.window).toBeNull();
    expect(interactor.snapshot.prompt).toBeNull();

    advance(CHEST_WINDOW_DELAY_MS - 10);
    expect(interactor.poll().window).toBeNull();
    advance(20);
    expect(interactor.poll().window).toMatchObject({ id: "chest.bridge.saw", item: "item.saw", taken: false });
    expect(interactor.snapshot.opening).toBeNull();

    expect(interactor.press()).toBe(true);
    expect(h.dispatched.map((c) => c.type)).toEqual(["chest.open", "chest.take"]);
    expect(countOf(h.state.slots, "item.saw")).toBe(1);
    expect(interactor.poll().window).toBeNull();
    expect(interactor.snapshot.target).toBeNull();
    expect(questProgress(h.state, "quest.bridge_01")!.stages[0].objectives.find((o) => o.id === "saw")!.done).toBe(true);
  });

  it("szybkie wielokrotne E nie otwiera ani nie wydaje nagrody dwa razy", () => {
    const { h, interactor, advance } = harness();
    const pick = chest("chest.bridge.pickaxe");
    h.pose = standing(pick, 1.5);
    for (let i = 0; i < 6; i++) expect(interactor.press()).toBe(true);
    expect(h.dispatched.filter((c) => c.type === "chest.open")).toHaveLength(1);
    expect(h.dispatched.filter((c) => c.type === "chest.take")).toHaveLength(0);
    advance(CHEST_WINDOW_DELAY_MS + 5);
    interactor.poll();
    for (let i = 0; i < 6; i++) interactor.press();
    expect(h.dispatched.filter((c) => c.type === "chest.take")).toHaveLength(1);
    expect(countOf(h.state.slots, "item.pickaxe")).toBe(1);
    expect(h.state.ledger.gained["item.pickaxe"]).toBe(1);
    // po wzięciu skrzynia nie jest już celem: E nie jest przejmowane (może zjeść jedzenie)
    expect(interactor.press()).toBe(false);
    expect(h.dispatched.filter((c) => c.type === "chest.take")).toHaveLength(1);
  });

  it("odejście od skrzyni lub zamknięcie okna: przedmiot zostaje w otwartej skrzyni i można go zabrać później", () => {
    const { h, interactor, advance } = harness();
    const saw = chest("chest.bridge.saw");
    h.pose = standing(saw, 1.8);
    interactor.press();
    advance(CHEST_WINDOW_DELAY_MS + 5);
    expect(interactor.poll().window).not.toBeNull();
    interactor.closeWindow();
    expect(interactor.snapshot.window).toBeNull();
    expect(countOf(h.state.slots, "item.saw")).toBe(0);
    expect(interactor.snapshot.prompt).toMatchObject({ key: "E", text: "Zobacz zawartość skrzyni" });

    h.pose = standing(saw, 12);
    expect(interactor.poll().prompt).toBeNull();
    expect(interactor.press()).toBe(false);

    h.pose = standing(saw, 1.4);
    expect(interactor.press()).toBe(true);
    expect(interactor.snapshot.window?.id).toBe("chest.bridge.saw");
    interactor.takeFromWindow();
    expect(countOf(h.state.slots, "item.saw")).toBe(1);
    expect(interactor.poll().window).toBeNull();
  });

  it("okno zamyka się samo, gdy gracz jest daleko od skrzyni lub opuścił las; wyjście w trakcie animacji nic nie psuje", () => {
    const a = harness();
    const saw = chest("chest.bridge.saw");
    a.h.pose = standing(saw, 1.8);
    a.interactor.press();
    a.h.state = reducer(a.h.state, { type: "leave" });
    a.advance(CHEST_WINDOW_DELAY_MS + 5);
    expect(a.interactor.poll().window).toBeNull();
    expect(a.interactor.snapshot.opening).toBeNull();
    expect(a.h.state.chests["chest.bridge.saw"]).toEqual({ opened: true, taken: false });
    a.h.state = inForest(a.h.state);
    a.h.pose = standing(saw, 1.8);
    expect(a.interactor.poll().prompt?.text).toBe("Zobacz zawartość skrzyni");

    const b = harness();
    b.h.pose = standing(saw, 1.8);
    b.interactor.press();
    b.advance(CHEST_WINDOW_DELAY_MS + 5);
    expect(b.interactor.poll().window).not.toBeNull();
    b.h.pose = standing(saw, 9);
    expect(b.interactor.poll().window).toBeNull();
  });

  it("pełny ekwipunek: zabranie nie powiodło się, okno zostaje, przedmiot nie ginie", () => {
    const { h, interactor, advance } = harness();
    const saw = chest("chest.bridge.saw");
    h.pose = standing(saw, 1.8);
    interactor.press();
    advance(CHEST_WINDOW_DELAY_MS + 5);
    interactor.poll();
    h.state = { ...h.state, slots: slotsFrom(Array.from({ length: h.state.slots.length }, () => "item.sandwich" as const)) };
    interactor.takeFromWindow();
    expect(h.state.chests["chest.bridge.saw"]).toEqual({ opened: true, taken: false });
    expect(interactor.poll().window).toMatchObject({ id: "chest.bridge.saw", taken: false });
    expect(h.state.toast?.tone).toBe("error");
    h.state = { ...h.state, slots: slotsFrom(["item.phone"]) };
    interactor.takeFromWindow();
    expect(countOf(h.state.slots, "item.saw")).toBe(1);
  });

  it("skrzynia pilnowana przez trolla: E przekazuje komendę silnikowi, ten odmawia, a okno się nie pojawia", () => {
    const { h, interactor, advance } = harness();
    const bp = chest("chest.bridge.blueprint");
    h.pose = standing(bp, 1.8);
    expect(interactor.poll().prompt).toMatchObject({ key: null, tone: "blocked" });
    expect(interactor.press()).toBe(true);
    expect(h.state.chests["chest.bridge.blueprint"]).toBeUndefined();
    expect(h.state.toast?.tone).toBe("error");
    advance(OPEN_CONFIRM_TIMEOUT_MS + 10);
    expect(interactor.poll().window).toBeNull();
    expect(interactor.snapshot.opening).toBeNull();
    expect(countOf(h.state.slots, "item.bridge_blueprint")).toBe(0);
  });

  it("zbieranie: bez narzędzia komunikat i brak zmiany, z narzędziem surowiec trafia do ekwipunku, a obiekt znika i nie da się zebrać ponownie", () => {
    const { h, interactor } = harness();
    const tree = harvestTargets(SEED).find((t) => t.kind === "tree" && t.size === "l")!;
    const obj = forestObject(SEED, tree.id)!;
    h.pose = standing(obj, 2);
    const noTool = interactor.poll();
    expect(noTool.prompt?.key).toBeNull();
    interactor.press();
    expect(h.state.harvested).toEqual([]);
    expect(h.state.toast?.tone).toBe("error");

    h.state = { ...h.state, slots: slotsFrom(["item.phone", "item.saw"]), ledger: { ...h.state.ledger, gained: { ...h.state.ledger.gained, "item.saw": 1 } } };
    const t = interactor.poll();
    expect(t.prompt?.key).toBe("E");
    const targetId = t.target!.id;
    interactor.press();
    expect(h.state.harvested).toEqual([targetId]);
    expect(countOf(h.state.slots, "resource.wood")).toBeGreaterThan(0);
    const wood = countOf(h.state.slots, "resource.wood");
    expect(interactor.poll().target?.id).not.toBe(targetId);
    h.state = reducer(h.state, { type: "harvest", objectId: targetId, at: { x: obj.x, z: obj.z } });
    expect(countOf(h.state.slots, "resource.wood")).toBe(wood);
  });

  it("poza lasem i po śmierci kontroler nie przejmuje E", () => {
    const { h, interactor } = harness();
    const saw = chest("chest.bridge.saw");
    h.pose = standing(saw, 1.8);
    h.state = reducer(h.state, { type: "leave" });
    expect(interactor.press()).toBe(false);
    h.state = inForest(h.state);
    h.state = { ...h.state, dead: true };
    expect(interactor.poll().target).toBeNull();
    expect(interactor.press()).toBe(false);
  });
});
