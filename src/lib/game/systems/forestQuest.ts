import { ITEMS, type ItemId } from "../content/items";
import { RIDDLE_BY_ID, RIDDLES } from "../content/riddles";
import { RECIPE_BRIDGE_01 } from "../content/quests";
import { nextDayStart, gameHoursToSeconds } from "../core/clock";
import { BUILD_RANGE, CHEST_RANGE, RIDDLE_LOCK_HOURS, TROLL_RANGE } from "../core/constants";
import type { ChestId, RegionId } from "../core/ids";
import { rngStream } from "../core/rng";
import { result, unchanged, withToast, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";
import { distance2, type Point2 } from "../world/anchors";
import { addToPile, addToSlots, canAdd, confiscate, countOf, gain, recover, removeFromSlots, spend } from "./containers";

export type At = Point2;

/** Zawartość skrzyń questa (dane): jedna rzecz na skrzynię. */
export const CHEST_CONTENTS: Readonly<Record<string, ItemId>> = {
  "chest.bridge.pickaxe": "item.pickaxe",
  "chest.bridge.saw": "item.saw",
  "chest.bridge.blueprint": "item.bridge_blueprint",
};

const validAt = (at: unknown): at is At =>
  typeof at === "object" && at !== null && Number.isFinite((at as At).x) && Number.isFinite((at as At).z);

const alive = (state: GameState) => state.phase === "playing" && !state.dead && state.world?.anchors != null;

function chestPoint(state: GameState, id: string): Point2 | null {
  const anchors = state.world?.anchors;
  if (!anchors) return null;
  return (anchors.chests as Record<string, Point2 | undefined>)[id] ?? null;
}

const fail = (state: GameState, text: string, event: CommandResult["events"][number]): CommandResult =>
  result(withToast(state, text, "error"), event);

/* ---------- skrzynie ---------- */

export function openChest(state: GameState, id: ChestId, at: At): CommandResult {
  if (!alive(state) || !validAt(at)) return unchanged(state);
  const anchors = state.world!.anchors!;
  const point = chestPoint(state, id);
  if (!point || !(id in CHEST_CONTENTS)) return unchanged(state);
  if (distance2(at, point) > CHEST_RANGE) return unchanged(state);
  if (state.chests[id]?.opened) return unchanged(state);
  if (anchors.troll.guards === id && state.troll.phase !== "solved") {
    return fail(state, "Troll pilnuje tej skrzyni. Porozmawiaj z nim.", { type: "chest.open_failed", id, reason: "guarded" });
  }
  return result(
    withToast({ ...state, chests: { ...state.chests, [id]: { opened: true, taken: false } } }, "Skrzynia otwarta."),
    { type: "chest.opened", id },
  );
}

export function takeChest(state: GameState, id: ChestId, at: At): CommandResult {
  if (!alive(state) || !validAt(at)) return unchanged(state);
  const point = chestPoint(state, id);
  const item = CHEST_CONTENTS[id];
  const chest = state.chests[id];
  if (!point || !item || !chest?.opened || chest.taken) return unchanged(state);
  if (distance2(at, point) > CHEST_RANGE) return unchanged(state);
  if (!canAdd(state.slots, item, 1)) {
    return fail(state, "Ekwipunek pełny. Zrób miejsce, a przedmiot zostanie w skrzyni.", {
      type: "chest.take_failed",
      id,
      reason: "inventory_full",
    });
  }
  const { slots } = addToSlots(state.slots, item, 1);
  return result(
    withToast(
      {
        ...state,
        slots,
        ledger: gain(state.ledger, item, 1),
        chests: { ...state.chests, [id]: { opened: true, taken: true } },
      },
      `Zdobyto: ${ITEMS[item].name}`,
    ),
    { type: "chest.taken", id, item },
  );
}

/* ---------- pozyskiwanie ---------- */

export type HarvestCommand = { objectId: string; kind: "tree" | "rock"; size: "s" | "m" | "l" };
const HARVEST_AMOUNT = { s: 1, m: 2, l: 5 } as const;

export function harvest(state: GameState, cmd: HarvestCommand): CommandResult {
  if (state.phase !== "playing" || state.dead) return unchanged(state);
  if (typeof cmd.objectId !== "string" || cmd.objectId.length === 0 || cmd.objectId.length > 80) return unchanged(state);
  if (!(cmd.kind === "tree" || cmd.kind === "rock") || !(cmd.size in HARVEST_AMOUNT)) return unchanged(state);
  if (state.harvested.includes(cmd.objectId)) return unchanged(state);
  const tool: ItemId = cmd.kind === "tree" ? "item.saw" : "item.pickaxe";
  const resource: ItemId = cmd.kind === "tree" ? "resource.wood" : "resource.stone";
  if (countOf(state.slots, tool) < 1) {
    return fail(state, cmd.kind === "tree" ? "Potrzebujesz piły, aby pozyskać drewno." : "Potrzebujesz kilofa, aby pozyskać kamień.", {
      type: "harvest.failed",
      objectId: cmd.objectId,
      reason: "no_tool",
    });
  }
  const amount = HARVEST_AMOUNT[cmd.size];
  if (!canAdd(state.slots, resource, amount)) {
    return fail(state, "Ekwipunek pełny. Zrób miejsce na surowce.", {
      type: "harvest.failed",
      objectId: cmd.objectId,
      reason: "inventory_full",
    });
  }
  const { slots } = addToSlots(state.slots, resource, amount);
  return result(
    withToast(
      {
        ...state,
        slots,
        ledger: gain(state.ledger, resource, amount),
        harvested: [...state.harvested, cmd.objectId],
      },
      `${ITEMS[resource].name} +${amount}`,
    ),
    { type: "resource.harvested", objectId: cmd.objectId, item: resource, amount },
  );
}

/* ---------- troll i zagadki ---------- */

/** Stała dla zapisu kolejność zagadek (tasowanie z seeda), kolejna próba = kolejna zagadka. */
export function riddleFor(seed: number, attempts: number) {
  const order = RIDDLES.map((_, i) => i);
  const rng = rngStream(seed, "troll.riddles");
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return RIDDLES[order[attempts % order.length]];
}

const nearTroll = (state: GameState, at: At) =>
  distance2(at, state.world!.anchors!.troll) <= TROLL_RANGE;

export function talkToTroll(state: GameState, at: At): CommandResult {
  if (!alive(state) || !validAt(at) || state.dialog) return unchanged(state);
  if (!nearTroll(state, at)) return unchanged(state);
  const t = state.troll;
  if (t.phase !== "solved" && state.elapsed < t.lockUntil) {
    return fail(state, t.phase === "confronted" && t.attempts === 0 ? "Troll odpoczywa. Wróć następnego dnia." : "Troll jeszcze się zastanawia. Wróć za jakiś czas.", {
      type: "troll.locked",
      until: t.lockUntil,
    });
  }
  const npc = state.world!.anchors!.troll.npc;
  if (t.phase === "unmet") {
    return result({ ...state, dialog: { npc, stage: "intro", riddle: null } }, { type: "troll.dialog_opened", stage: "intro" });
  }
  if (t.phase === "confronted") {
    const riddle = riddleFor(state.world!.seed, t.attempts);
    return result({ ...state, dialog: { npc, stage: "riddle", riddle: riddle.id } }, { type: "troll.dialog_opened", stage: "riddle" });
  }
  return unchanged(state);
}

export function chooseTroll(state: GameState, choice: "fight" | "talk"): CommandResult {
  const dialog = state.dialog;
  if (!dialog || dialog.stage !== "intro" || state.troll.phase !== "unmet" || !state.world?.anchors) return unchanged(state);
  if (choice === "talk") {
    const riddle = riddleFor(state.world.seed, state.troll.attempts);
    return result({ ...state, dialog: { ...dialog, stage: "riddle", riddle: riddle.id } }, { type: "troll.dialog_opened", stage: "riddle" });
  }
  if (choice !== "fight") return unchanged(state);
  const taken = confiscate(state.slots);
  let deposit = state.troll.deposit;
  for (const s of taken.taken) deposit = addToPile(deposit, s.id, s.count);
  const next: GameState = {
    ...state,
    slots: taken.slots,
    selected: 0,
    dialog: null,
    view: "world",
    forestPose: null,
    troll: { ...state.troll, phase: "confronted", lockUntil: nextDayStart(state.elapsed), deposit },
  };
  return result(
    withToast(next, "Troll był szybszy! Zabrał twoje rzeczy i odesłał cię do miasta. Wróć jutro i rozwiąż jego zagadkę.", "error"),
    { type: "troll.confiscated", items: taken.taken },
  );
}

export function closeDialog(state: GameState): CommandResult {
  if (!state.dialog) return unchanged(state);
  return result({ ...state, dialog: null }, { type: "troll.dialog_closed" });
}

export function answerRiddle(state: GameState, value: number): CommandResult {
  const dialog = state.dialog;
  if (!dialog || dialog.stage !== "riddle" || !dialog.riddle || !state.world?.anchors) return unchanged(state);
  const riddle = RIDDLE_BY_ID.get(dialog.riddle);
  if (!riddle || typeof value !== "number" || !Number.isFinite(value)) return unchanged(state);
  const attempts = state.troll.attempts + 1;
  if (value !== riddle.answer) {
    const lockUntil = Math.max(state.troll.lockUntil, state.elapsed + gameHoursToSeconds(RIDDLE_LOCK_HOURS));
    return result(
      withToast(
        { ...state, dialog: null, troll: { ...state.troll, attempts, lockUntil } },
        "To nie jest dobra odpowiedź. Troll prosi, abyś pomyślał i wrócił za godzinę.",
        "error",
      ),
      { type: "troll.riddle_answered", correct: false, riddle: riddle.id },
    );
  }
  const back = recover(state.slots, state.troll.deposit);
  const left = back.pile.length > 0;
  return result(
    withToast(
      {
        ...state,
        dialog: null,
        slots: back.slots,
        troll: { ...state.troll, phase: "solved", attempts, lockUntil: 0, deposit: back.pile },
      },
      left
        ? "Brawo! Troll odsuwa się od skrzyni, ale część rzeczy nie mieści ci się w ekwipunku. Zrób miejsce i odbierz resztę."
        : "Brawo! Troll odsuwa się od skrzyni i oddaje twoje rzeczy.",
    ),
    { type: "troll.riddle_answered", correct: true, riddle: riddle.id },
    ...(back.moved.length > 0 ? [{ type: "troll.deposit_recovered" as const, items: back.moved, remaining: back.pile }] : []),
  );
}

/** Odbiór reszty depozytu po rozwiązaniu zagadki (np. gdy ekwipunek był pełny). */
export function claimDeposit(state: GameState, at: At): CommandResult {
  if (!alive(state) || !validAt(at) || state.troll.phase !== "solved" || state.troll.deposit.length === 0) return unchanged(state);
  if (!nearTroll(state, at)) return unchanged(state);
  const back = recover(state.slots, state.troll.deposit);
  if (back.moved.length === 0) {
    return fail(state, "Ekwipunek pełny. Zrób miejsce, aby odebrać rzeczy.", { type: "troll.claim_failed", reason: "inventory_full" });
  }
  return result(
    withToast({ ...state, slots: back.slots, troll: { ...state.troll, deposit: back.pile } }, back.pile.length ? "Odebrano część rzeczy. Reszta czeka u trolla." : "Odebrano wszystkie rzeczy."),
    { type: "troll.deposit_recovered", items: back.moved, remaining: back.pile },
  );
}

/* ---------- most i odkrycie ---------- */

export function buildBridge(state: GameState, at: At): CommandResult {
  if (!alive(state) || !validAt(at)) return unchanged(state);
  const anchors = state.world!.anchors!;
  if (state.bridge.built) return unchanged(state);
  if (distance2(at, anchors.bridge.west) > BUILD_RANGE) {
    return fail(state, "Tutaj kiedyś stał most. Podejdź do zachodniego brzegu rzeki.", { type: "bridge.build_failed", reason: "not_at_site" });
  }
  if (countOf(state.slots, RECIPE_BRIDGE_01.blueprint) < 1) {
    return fail(state, "Potrzebujesz schematu mostu.", { type: "bridge.build_failed", reason: "no_blueprint" });
  }
  if (RECIPE_BRIDGE_01.requires.some((r) => countOf(state.slots, r.id) < r.count)) {
    return fail(state, "Brakuje materiałów na most.", { type: "bridge.build_failed", reason: "missing_materials" });
  }
  let slots = state.slots;
  let ledger = state.ledger;
  for (const r of RECIPE_BRIDGE_01.requires) {
    slots = removeFromSlots(slots, r.id, r.count).slots;
    ledger = spend(ledger, r.id, r.count);
  }
  return result(
    withToast({ ...state, slots, ledger, bridge: { built: true, builtAt: state.elapsed } }, "Most odbudowany! Rzeka jest już przejezdna."),
    { type: "bridge.built" },
  );
}

export function discoverRegion(state: GameState, id: RegionId, at: At): CommandResult {
  if (!alive(state) || !validAt(at)) return unchanged(state);
  const beyond = state.world!.anchors!.beyond;
  if (id !== beyond.region || state.discovered.includes(id) || !state.bridge.built) return unchanged(state);
  if (distance2(at, beyond) > beyond.radius) return unchanged(state);
  return result(withToast({ ...state, discovered: [...state.discovered, id] }, "Odkryto nowy obszar!"), {
    type: "region.discovered",
    id,
  });
}
