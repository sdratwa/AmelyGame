import { describe, expect, it } from "vitest";
import { applyCommand } from "../core/apply";
import { CHEST_RANGE, HARVEST_PROMPT_RANGE, HARVEST_RANGE, CHEST_PROMPT_RANGE } from "../core/constants";
import type { GameState } from "../core/state";
import { harvestOf } from "../world/harvest";
import { forestChestsOf, forestObject } from "../world/lookup";
import { harvestTargets, inForest, newPlaying, run, unlockToolOrder } from "../testkit";
import { slotsFrom } from "../testkit";
import { describePrompt, interactionCommand, pickInteraction, type ViewPose } from "./interaction";
import { countOf } from "./containers";

const SEED = 777;
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
/** Gracz stoi w odległości d od punktu i patrzy na niego (z kątem odchylenia `off`). */
const standing = (target: { x: number; z: number }, d: number, from = 0, off = 0): ViewPose => {
  const dir = { x: Math.cos(from), z: Math.sin(from) };
  const pose = { x: target.x + dir.x * d, z: target.z + dir.z * d, yaw: 0 };
  pose.yaw = yawTo(target.x - pose.x, target.z - pose.z) + off;
  return pose;
};

const forestState = (extra: Partial<GameState> = {}) => ({ ...inForest(newPlaying(SEED)), ...extra }) as GameState;
const withTools = (s: GameState) => ({ ...s, slots: slotsFrom(["item.phone", "item.saw", "item.pickaxe"]) });

describe("M1/C1: wybór obiektu do interakcji", () => {
  it("skrzynia: podpowiedź w zasięgu ok. 2 m i tylko przy patrzeniu w jej stronę", () => {
    const chest = forestChestsOf(SEED).find((c) => c.id === "chest.bridge.saw")!;
    const state = unlockToolOrder(forestState());
    const t = pickInteraction(state, standing(chest, 2));
    expect(t).toMatchObject({ kind: "chest", id: "chest.bridge.saw", action: "open", locked: false });
    expect(describePrompt(state, t!)).toEqual({ key: "E", text: "Otwórz skrzynię", tone: "action" });
    // patrzy w przeciwną stronę, w bok o 90 stopni -> brak celu
    expect(pickInteraction(state, standing(chest, 2, 0, Math.PI))).toBeNull();
    expect(pickInteraction(state, standing(chest, 2, 0, Math.PI / 2))).toBeNull();
    // lekkie odchylenie od środka nadal celuje
    expect(pickInteraction(state, standing(chest, 2, 0, 0.3))?.kind).toBe("chest");
  });

  it("dystans: poza zasięgiem podpowiedzi nie ma celu, a zasięg podpowiedzi jest mniejszy od zasięgu silnika", () => {
    expect(CHEST_PROMPT_RANGE).toBeLessThan(CHEST_RANGE);
    expect(HARVEST_PROMPT_RANGE).toBeLessThan(HARVEST_RANGE);
    const chest = forestChestsOf(SEED)[0];
    const state = forestState();
    expect(pickInteraction(state, standing(chest, CHEST_PROMPT_RANGE - 0.05))?.kind).toBe("chest");
    expect(pickInteraction(state, standing(chest, CHEST_PROMPT_RANGE + 0.2))).toBeNull();
  });

  it("stan skrzyni: otwarta z przedmiotem pokazuje zawartość, pusta nie jest celem, a skrzynię pilnowaną przez trolla opisuje blokada", () => {
    const saw = forestChestsOf(SEED).find((c) => c.id === "chest.bridge.saw")!;
    const opened = forestState({ chests: { "chest.bridge.saw": { opened: true, taken: false } } });
    const t = pickInteraction(opened, standing(saw, 1.8))!;
    expect(t).toMatchObject({ kind: "chest", action: "peek" });
    expect(describePrompt(opened, t).text).toBe("Zobacz zawartość skrzyni");
    expect(interactionCommand(t, standing(saw, 1.8))).toBeNull();
    const taken = forestState({ chests: { "chest.bridge.saw": { opened: true, taken: true } } });
    expect(pickInteraction(taken, standing(saw, 1.8))).toBeNull();

    // Kolejność questa: skrzynia z narzędziem jest zamknięta, dopóki gracz nie zdobędzie schematu (komunikat o schemacie).
    const early = forestState();
    const locked = pickInteraction(early, standing(saw, 1.8))!;
    expect(locked).toMatchObject({ kind: "chest", locked: true, lockReason: "order" });
    expect(describePrompt(early, locked)).toMatchObject({ key: null, tone: "blocked" });
    expect(describePrompt(early, locked).text).toContain("schemat mostu");
    expect(pickInteraction(unlockToolOrder(early), standing(saw, 1.8))).toMatchObject({ locked: false, lockReason: null });

    const blueprint = forestChestsOf(SEED).find((c) => c.id === "chest.bridge.blueprint")!;
    const state = forestState();
    const g = pickInteraction(state, standing(blueprint, 1.8))!;
    expect(g).toMatchObject({ kind: "chest", locked: true });
    const prompt = describePrompt(state, g);
    expect(prompt.key).toBeNull();
    expect(prompt.tone).toBe("blocked");
    // Silnik nie otworzy skrzyni trolla nawet po wymuszeniu komendy: brak obejścia mechaniki trolla.
    const out = applyCommand(state, { type: "chest.open", id: "chest.bridge.blueprint", at: { x: blueprint.x + 1.5, z: blueprint.z } });
    expect(out.state.chests["chest.bridge.blueprint"]).toBeUndefined();
    expect(out.events.some((e) => e.type === "chest.open_failed")).toBe(true);
  });

  it("drzewa i skały: cel to obiekt na celowniku, podpowiedź zależy od narzędzia i rozmiaru, a pozyskane obiekty znikają z wyboru", () => {
    const targets = harvestTargets(SEED);
    const tree = targets.find((t) => t.kind === "tree" && t.size === "l")!;
    const rock = targets.find((t) => t.kind === "rock" && t.size === "m")!;
    const state = forestState();
    for (const target of [tree, rock]) {
      const obj = forestObject(SEED, target.id)!;
      const pose = standing(obj, 2.2);
      // Wokół może stać inny obiekt bliżej celownika; sprawdzamy, że wybór jest poprawnym obiektem tego rodzaju w zasięgu.
      const picked = pickInteraction(state, pose);
      expect(picked?.kind, target.id).toBeDefined();
      const info = harvestOf(forestObject(SEED, picked!.id)!)!;
      expect(info.kind).toBe(picked!.kind);
    }
    // Wyspa: brak narzędzia -> komunikat bez klawisza; z narzędziem -> akcja z ilością.
    const obj = forestObject(SEED, tree.id)!;
    const pose = standing(obj, 2);
    const noTool = pickInteraction(state, pose)!;
    if (noTool.kind === "tree") expect(describePrompt(state, noTool)).toMatchObject({ key: null, tone: "blocked", text: expect.stringContaining("piły") });
    const equipped = withTools(state);
    const t = pickInteraction(equipped, pose)!;
    const prompt = describePrompt(equipped, t);
    expect(prompt.key).toBe("E");
    expect(prompt.text).toMatch(t.kind === "tree" ? /^Zetnij .* drzewo \(drewno \+\d\)$/ : /^Rozbij .* skałę \(kamień \+\d\)$/);
    const gone = { ...equipped, harvested: [t.id] };
    expect(pickInteraction(gone, pose)?.id).not.toBe(t.id);
  });

  it("zawsze, gdy podpowiedź jest widoczna, silnik przyjmie komendę (dystans podpowiedzi < dystans silnika); po przyjęciu cel znika i nie da się powtórzyć", () => {
    let checked = 0;
    for (const tgt of harvestTargets(SEED).slice(0, 60)) {
      const obj = forestObject(SEED, tgt.id)!;
      const equipped = withTools(forestState());
      const pose = standing(obj, 2);
      const picked = pickInteraction(equipped, pose);
      if (!picked) continue;
      const cmd = interactionCommand(picked, pose)!;
      const out = applyCommand(equipped, cmd);
      expect(out.state, `${picked.id}`).not.toBe(equipped);
      expect(out.state.harvested).toContain(picked.id);
      const again = applyCommand(out.state, cmd);
      expect(again.state).toBe(out.state);
      expect(pickInteraction(out.state, pose)?.id).not.toBe(picked.id);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("poza lasem, po śmierci albo przy złych danych nie ma celu; brak narzędzia nie zmienia stanu przy wymuszonej komendzie", () => {
    const chest = forestChestsOf(SEED)[0];
    const pose = standing(chest, 2);
    const world = run(forestState(), { type: "leave" });
    expect(pickInteraction(world, pose)).toBeNull();
    expect(pickInteraction({ ...forestState(), dead: true }, pose)).toBeNull();
    expect(pickInteraction(forestState(), { x: Number.NaN, z: 0, yaw: 0 })).toBeNull();
    const tree = harvestTargets(SEED).find((t) => t.kind === "tree")!;
    const s = forestState();
    const out = applyCommand(s, { type: "harvest", objectId: tree.id, at: tree.at });
    expect(out.state.harvested).toEqual([]);
    expect(countOf(out.state.slots, "resource.wood")).toBe(0);
  });
});
