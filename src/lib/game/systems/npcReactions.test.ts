import { describe, expect, it, vi } from "vitest";
import { RIDDLE_BY_ID } from "../content/riddles";
import { applyCommand, reducer, type Command } from "../core/apply";
import type { GameEvent } from "../core/events";
import type { GameState } from "../core/state";
import { hydrateState } from "../save/hydrate";
import { serializeState } from "../save/serialize";
import { validateSaveV3 } from "../save/validate";
import { anchorsOf, inForest, near, newPlaying, run, unlockToolOrder } from "../testkit";
import { dispatchWithReactions, reactionsFor, type NpcReaction } from "./npcReactions";

const BRIDGE = "quest.bridge_01" as const;
const SEED = 777;

const fresh = () => inForest(run(newPlaying(SEED), { type: "board.read", id: BRIDGE }, { type: "quest.accept", id: BRIDGE }));
const chestAt = (s: GameState, id: string) => (anchorsOf(s).chests as Record<string, { x: number; z: number }>)[id];
const step = (s: GameState, c: Command): { state: GameState; events: GameEvent[] } => applyCommand(s, c);

const confronted = () => {
  let s = fresh();
  const t = anchorsOf(s).troll;
  s = step(s, { type: "troll.talk", at: near(t) }).state;
  const out = step(s, { type: "troll.choose", choice: "fight" });
  return { state: inForest(out.state), events: out.events };
};

describe("adapter reakcji NPC: zdarzenia silnika -> animacja trolla", () => {
  it("próba otwarcia skrzyni pilnowanej przez trolla kończy się gniewem trolla; stan gry zmienia tylko silnik", () => {
    const s = fresh();
    const at = near(chestAt(s, "chest.bridge.blueprint"), 1.2);
    const out = step(s, { type: "chest.open", id: "chest.bridge.blueprint", at });
    expect(out.events.some((e) => e.type === "chest.open_failed" && e.reason === "guarded")).toBe(true);
    expect(reactionsFor(out.events)).toEqual([{ npc: "troll", kind: "angry", cause: "chest.open_failed" }]);
  });

  it("skrzynie z narzędziami (piła, kilof) nie wywołują gniewu: ani otwarte po zdobyciu schematu, ani zamknięte przed nim", () => {
    const early = fresh();
    for (const id of ["chest.bridge.saw", "chest.bridge.pickaxe"] as const) {
      const out = step(early, { type: "chest.open", id, at: near(chestAt(early, id), 1.2) });
      expect(out.events.some((e) => e.type === "chest.open_failed" && e.reason === "order"), id).toBe(true);
      expect(reactionsFor(out.events), id).toEqual([]);
    }
    const s = unlockToolOrder(early);
    for (const id of ["chest.bridge.saw", "chest.bridge.pickaxe"] as const) {
      const out = step(s, { type: "chest.open", id, at: near(chestAt(s, id), 1.2) });
      expect(reactionsFor(out.events), id).toEqual([]);
    }
  });

  it("konfiskata przedmiotów i zła odpowiedź na zagadkę wywołują gniew; dobra odpowiedź nie", () => {
    const { state, events } = confronted();
    expect(events.map((e) => e.type)).toContain("troll.confiscated");
    expect(reactionsFor(events).map((r) => r.cause)).toEqual(["troll.confiscated"]);

    const ready = inForest({ ...state, elapsed: state.troll.lockUntil, health: 100 });
    const talk = step(ready, { type: "troll.talk", at: near(anchorsOf(ready).troll) }).state;
    const riddle = RIDDLE_BY_ID.get(talk.dialog!.riddle!)!;
    const wrong = step(talk, { type: "riddle.answer", value: riddle.answer + 1 });
    expect(reactionsFor(wrong.events).map((r) => r.cause)).toEqual(["troll.riddle_answered"]);
    const good = step(talk, { type: "riddle.answer", value: riddle.answer });
    expect(reactionsFor(good.events)).toEqual([]);
  });

  it("jedna zła odpowiedź = jedna reakcja (bez duplikatów i bez reakcji na samo zamknięcie rozmowy)", () => {
    expect(reactionsFor([])).toEqual([]);
    const { state } = confronted();
    const ready = inForest({ ...state, elapsed: state.troll.lockUntil, health: 100 });
    const talk = step(ready, { type: "troll.talk", at: near(anchorsOf(ready).troll) });
    expect(reactionsFor(talk.events)).toEqual([]);
    expect(reactionsFor(step(talk.state, { type: "dialog.close" }).events)).toEqual([]);
  });

  it("dispatchWithReactions: stan po komendzie jest identyczny jak z samym reducerem, a reakcja trafia do prezentacji", () => {
    const s = fresh();
    const command: Command = { type: "chest.open", id: "chest.bridge.blueprint", at: near(chestAt(s, "chest.bridge.blueprint"), 1.2) };
    let state = s;
    const seen: NpcReaction[] = [];
    dispatchWithReactions(state, command, (c) => (state = reducer(state, c)), (r) => seen.push(r));
    expect(state).toEqual(reducer(s, command));
    expect(seen).toHaveLength(1);

    const unlocked = unlockToolOrder(s);
    const ok: Command = { type: "chest.open", id: "chest.bridge.saw", at: near(chestAt(s, "chest.bridge.saw"), 1.2) };
    const onReaction = vi.fn();
    let state2 = unlocked;
    dispatchWithReactions(state2, ok, (c) => (state2 = reducer(state2, c)), onReaction);
    expect(state2).toEqual(reducer(unlocked, ok));
    expect(onReaction).not.toHaveBeenCalled();
  });
});

describe("zapis SaveV3 i stan questa po integracji modeli 3D", () => {
  it("zapis nie zawiera niczego z warstwy prezentacji (animacje, patrol, pivoty pokryw) i zachowuje kształt SaveV3", () => {
    let s = unlockToolOrder(fresh());
    s = step(s, { type: "chest.open", id: "chest.bridge.saw", at: near(chestAt(s, "chest.bridge.saw"), 1.2) }).state;
    const save = serializeState(s, 1)!;
    expect(save.version).toBe(3);
    expect(Object.keys(save.troll).sort()).toEqual(["attempts", "deposit", "lockUntil", "phase"]);
    const text = JSON.stringify(save).toLowerCase();
    for (const word of ["angry", "patrol", "hinge", "pivot", "animation", "lid"]) expect(text, word).not.toContain(word);
    const valid = validateSaveV3(JSON.parse(JSON.stringify(save)));
    expect(valid.ok).toBe(true);
    expect(serializeState(hydrateState(save), 1)).toEqual(save);
  });

  it("gniew trolla nie zmienia zapisu: zapis po nieudanym otwarciu skrzyni jest równy zapisowi przed", () => {
    const s = fresh();
    const out = step(s, { type: "chest.open", id: "chest.bridge.blueprint", at: near(chestAt(s, "chest.bridge.blueprint"), 1.2) });
    expect(serializeState(out.state, 5)).toEqual(serializeState(s, 5));
  });

  it("stany skrzyń są niezależne: otwarcie jednej nie rusza pozostałych (pokrywy w widoku czytają ten sam stan)", () => {
    let s = unlockToolOrder(fresh());
    s = step(s, { type: "chest.open", id: "chest.bridge.saw", at: near(chestAt(s, "chest.bridge.saw"), 1.2) }).state;
    expect(s.chests["chest.bridge.saw"]?.opened).toBe(true);
    expect(s.chests["chest.bridge.pickaxe"]).toBeUndefined();
    expect(s.chests["chest.bridge.blueprint"]).toBeUndefined();
  });
});
