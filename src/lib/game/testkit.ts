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
import { harvestOf, type HarvestKind, type HarvestSize } from "./world/harvest";
import { forestOf } from "./world/lookup";
import { FOREST_START } from "./world/generators/v2";
import { ITEMS } from "./content/items";
import { MAX_HEALTH } from "./core/constants";
import { addToSlots, countOf, gain, spend } from "./systems/containers";
import { CHEST_CONTENTS } from "./systems/forestQuest";

export type HarvestTarget = { id: string; at: Point2; kind: HarvestKind; size: HarvestSize };

const targetCache = new Map<number, HarvestTarget[]>();

/** Tylko testy: prawdziwe drzewa i skały z lasu danego seeda (zachodni brzeg, od najbliższych startu). */
export function harvestTargets(seed: number): HarvestTarget[] {
  const hit = targetCache.get(seed);
  if (hit) return hit;
  const forest = forestOf(seed);
  const out: HarvestTarget[] = [];
  for (const sector of forest.allSectors()) {
    for (const o of sector.objects) {
      const h = harvestOf(o);
      if (!h) continue;
      const river = forest.geometry.riverAt(o.z);
      if (o.x > river.x - river.w - 8) continue;
      out.push({ id: o.id, at: { x: o.x + 1.5, z: o.z }, kind: h.kind, size: h.size });
    }
  }
  out.sort((a, b) => Math.hypot(a.at.x - FOREST_START.x, a.at.z - FOREST_START.z) - Math.hypot(b.at.x - FOREST_START.x, b.at.z - FOREST_START.z) || (a.id < b.id ? -1 : 1));
  targetCache.set(seed, out);
  return out;
}

/** n-ta (cyklicznie) pozycja z listy celów danego rodzaju i rozmiaru. */
export function harvestTarget(seed: number, kind: HarvestKind, size: HarvestSize, n: number): HarvestTarget {
  const list = harvestTargets(seed).filter((t) => t.kind === kind && t.size === size);
  if (list.length === 0) throw new Error(`brak celów ${kind}/${size} w seedzie ${seed}`);
  return list[n % list.length];
}

/** Tylko testy: gracz w lesie (jeśli jest w mieście lub w sklepie). */
export function inForest(state: GameState): GameState {
  if (state.view === "forest") return state;
  return run(state, { type: "leave" }, { type: "enter", view: "forest" });
}

/**
 * Tylko testy: stan, w którym schemat mostu został już zdobyty i zużyty "na papierze" (księga: zdobyty +1, wydany +1,
 * bez przedmiotu w ekwipunku). Odblokowuje skrzynie z narzędziami (kolejność questa) bez przechodzenia przez trolla;
 * księga zostaje spójna z ekwipunkiem.
 */
export function unlockToolOrder(state: GameState): GameState {
  const bp = "item.bridge_blueprint" as const;
  if ((state.ledger.gained[bp] ?? 0) >= 1) return state;
  return { ...state, ledger: spend(gain(state.ledger, bp, 1), bp, 1) };
}

/** Tylko testy: dodaje do ekwipunku przedmiot (z wpisem w księdze), np. materiały bez zbierania w lesie. */
export function grantItem(state: GameState, id: ItemId, count: number): GameState {
  const res = addToSlots(state.slots, id, count);
  return { ...state, slots: res.slots, ledger: gain(state.ledger, id, res.added) };
}

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
  const forest = () => {
    s = inForest(s);
  };
  const guard = (cond: boolean, what: string) => {
    if (!cond) throw new Error(`autoComplete: utknięto: ${what}`);
  };
  if (s.dead) step({ type: "respawn" });
  step({ type: "dialog.close" }, { type: "leave" });
  step({ type: "board.read", id: "quest.bridge_01" }, { type: "quest.accept", id: "quest.bridge_01" });
  s.slots.forEach((_, i) => step({ type: "discard", slot: i }));
  forest();

  const chestAt = (id: keyof typeof CHEST_CONTENTS) => (a.chests as Record<string, Point2>)[id];
  const getChest = (id: keyof typeof CHEST_CONTENTS) => {
    step({ type: "chest.open", id: id as never, at: chestAt(id) }, { type: "chest.take", id: id as never, at: chestAt(id) });
  };

  for (let attempt = 0; s.troll.phase !== "solved" && attempt < 40; attempt++) {
    if (s.dead) step({ type: "respawn" });
    if (s.elapsed < s.troll.lockUntil) {
      s = healed({ ...s, elapsed: s.troll.lockUntil });
    }
    forest();
    step({ type: "troll.talk", at: near(a.troll) });
    if (s.dialog?.stage === "intro") step({ type: "troll.choose", choice: "talk" });
    guard(s.dialog?.stage === "riddle", "brak zagadki");
    step({ type: "riddle.answer", value: RIDDLE_BY_ID.get(s.dialog!.riddle!)!.answer });
  }
  guard(s.troll.phase === "solved", "troll nie rozwiązany");
  forest();
  s.slots.forEach((slot, i) => {
    if (slot && ITEMS[slot.id].discardable) step({ type: "discard", slot: i });
  });
  for (let i = 0; i < 6 && s.troll.deposit.length > 0; i++) {
    step({ type: "troll.claim", at: near(a.troll) });
    s.slots.forEach((slot, j) => {
      if (slot && ITEMS[slot.id].discardable) step({ type: "discard", slot: j });
    });
  }
  forest();
  getChest("chest.bridge.blueprint");
  // Kolejność questa: narzędzia dopiero po schemacie.
  getChest("chest.bridge.pickaxe");
  getChest("chest.bridge.saw");
  guard(countOf(s.slots, "item.pickaxe") === 1 && countOf(s.slots, "item.saw") === 1, "brak narzędzi");
  guard(countOf(s.slots, "item.bridge_blueprint") === 1, "brak schematu");

  const seed = s.world!.seed;
  const gather = (kind: HarvestKind, item: "resource.wood" | "resource.stone", need: number) => {
    const list = harvestTargets(seed).filter((t) => t.kind === kind && !s.harvested.includes(t.id));
    for (const t of list) {
      if (countOf(s.slots, item) >= need) break;
      step({ type: "harvest", objectId: t.id, at: t.at });
    }
    guard(countOf(s.slots, item) >= need, `brak surowca ${item}`);
  };
  gather("tree", "resource.wood", 5);
  gather("rock", "resource.stone", 10);
  step({ type: "bridge.build", at: near(a.bridge.west) });
  guard(s.bridge.built, "most niezbudowany");
  guard(!s.quests.completed["quest.bridge_01"], "quest nie powinien kończyć się przy budowie");
  step({ type: "region.discover", id: a.beyond.region, at: near(a.beyond) });
  guard(!!s.quests.completed["quest.bridge_01"], "quest nieukończony");
  return s;
}
