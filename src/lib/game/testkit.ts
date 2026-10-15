import type { ItemId, ItemStack } from "./content/items";
import { INVENTORY_SLOTS } from "./core/constants";

/** Tylko testy: lista przedmiotów (po jednej sztuce) lub stosów zamieniona na pełną tablicę miejsc ekwipunku. */
export function slotsFrom(list: readonly (ItemId | ItemStack | null)[]): (ItemStack | null)[] {
  const out: (ItemStack | null)[] = Array.from({ length: INVENTORY_SLOTS }, () => null);
  list.forEach((entry, i) => {
    out[i] = entry === null ? null : typeof entry === "string" ? { id: entry, count: 1 } : { ...entry };
  });
  return out;
}

import { reducer, type Command } from "./core/apply";
import { initialState, type GameState } from "./core/state";
import type { Point2 } from "./world/anchors";

export function run(state: GameState, ...commands: Command[]): GameState {
  return commands.reduce(reducer, state);
}

/** Nowa gra w trakcie (po tutorialu), świat z danego seeda. */
export function newPlaying(seed = 777, name = "Ola", saveId = "save_test0001"): GameState {
  const s = run(initialState, { type: "setName", name }, { type: "startLoading", seed, saveId }, { type: "worldReady" });
  return { ...s, tutorialDone: true };
}

export const anchorsOf = (s: GameState) => {
  const a = s.world?.anchors;
  if (!a) throw new Error("brak kotwic");
  return a;
};

export const near = (p: Point2, dx = 0.5, dz = 0): Point2 => ({ x: p.x + dx, z: p.z + dz });

import { RIDDLE_BY_ID } from "./content/riddles";
import { ITEMS } from "./content/items";
import { MAX_HEALTH } from "./core/constants";
import { countOf } from "./systems/containers";
import { CHEST_CONTENTS } from "./systems/forestQuest";

const healed = (s: GameState): GameState => (s.dead ? s : { ...s, health: MAX_HEALTH });

/**
 * Bezglowy "solver": z dowolnego poprawnego stanu doprowadza quest do końca samymi komendami silnika
 * (dowód braku softlocka w testach). Zwraca stan końcowy lub rzuca, gdy utknie.
 */
export function autoComplete(start: GameState): GameState {
  let s = start;
  const a = anchorsOf(s);
  const step = (...c: Command[]) => {
    s = run(s, ...c);
  };
  const guard = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`autoComplete: utknięto: ${what}`);
  };
  if (s.dead) step({ type: "respawn" });
  step({ type: "dialog.close" }, { type: "leave" });
  step({ type: "board.read", id: "quest.bridge_01" }, { type: "quest.accept", id: "quest.bridge_01" });
  s.slots.forEach((_, i) => step({ type: "discard", slot: i }));

  const chestAt = (id: keyof typeof CHEST_CONTENTS) => (a.chests as Record<string, Point2>)[id];
  const getChest = (id: keyof typeof CHEST_CONTENTS) => {
    step({ type: "chest.open", id: id as never, at: chestAt(id) }, { type: "chest.take", id: id as never, at: chestAt(id) });
  };
  getChest("chest.bridge.pickaxe");
  getChest("chest.bridge.saw");

  for (let attempt = 0; s.troll.phase !== "solved" && attempt < 40; attempt++) {
    if (s.dead) step({ type: "respawn" });
    if (s.elapsed < s.troll.lockUntil) {
      s = healed({ ...s, elapsed: s.troll.lockUntil });
    }
    step({ type: "troll.talk", at: near(a.troll) });
    if (s.dialog?.stage === "intro") step({ type: "troll.choose", choice: "talk" });
    guard(s.dialog?.stage === "riddle", "brak zagadki");
    step({ type: "riddle.answer", value: RIDDLE_BY_ID.get(s.dialog!.riddle!)!.answer });
  }
  guard(s.troll.phase === "solved", "troll nie rozwiązany");
  s.slots.forEach((slot, i) => {
    if (slot && ITEMS[slot.id].discardable) step({ type: "discard", slot: i });
  });
  for (let i = 0; i < 6 && s.troll.deposit.length > 0; i++) {
    step({ type: "troll.claim", at: near(a.troll) });
    s.slots.forEach((slot, j) => {
      if (slot && ITEMS[slot.id].discardable) step({ type: "discard", slot: j });
    });
  }
  getChest("chest.bridge.blueprint");
  guard(countOf(s.slots, "item.pickaxe") === 1 && countOf(s.slots, "item.saw") === 1, "brak narzędzi");
  guard(countOf(s.slots, "item.bridge_blueprint") === 1, "brak schematu");

  let n = 0;
  while (countOf(s.slots, "resource.wood") < 5) step({ type: "harvest", objectId: `tree.auto.${n++}`, kind: "tree", size: "l" });
  while (countOf(s.slots, "resource.stone") < 10) step({ type: "harvest", objectId: `rock.auto.${n++}`, kind: "rock", size: "l" });
  step({ type: "bridge.build", at: near(a.bridge.west) });
  guard(s.bridge.built, "most niezbudowany");
  guard(!!s.quests.completed["quest.bridge_01"], "quest nieukończony");
  return s;
}
