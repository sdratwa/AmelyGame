import { describe, expect, it } from "vitest";
import { applyCommand, reducer, type Command } from "./apply";
import { isTimePaused, pauseReasons } from "./pause";
import { initialState, type GameState } from "./state";

const playing = (over: Partial<GameState> = {}): GameState => ({
  ...initialState,
  phase: "playing",
  tutorialDone: true,
  ...over,
});

const run = (s: GameState, cmds: Command[]) => cmds.reduce(reducer, s);

const add = (reason: string, owner: string): Command => ({
  type: "pause.add",
  reason,
  owner,
});
const remove = (reason: string, owner: string): Command => ({
  type: "pause.remove",
  reason,
  owner,
});

describe("powody pauzy zegara", () => {
  it("bez powodów zegar idzie", () => {
    const s = playing();
    expect(pauseReasons(s)).toEqual([]);
    expect(reducer(s, { type: "tick", dt: 5 }).elapsed).toBe(5);
  });

  it("powody systemowe wynikają ze stanu", () => {
    expect(pauseReasons(initialState)).toEqual(["system.not_playing", "system.tutorial"]);
    expect(pauseReasons(playing({ dead: true }))).toEqual(["system.dead"]);
    expect(pauseReasons(playing({ tutorialDone: false }))).toEqual(["system.tutorial"]);
  });

  it("jawna pauza zatrzymuje czas i drenaż", () => {
    const s = run(playing(), [add("modal.dialog", "npc.troll.bridge")]);
    expect(isTimePaused(s)).toBe(true);
    const after = reducer(s, { type: "tick", dt: 60 });
    expect(after.elapsed).toBe(0);
    expect(after.health).toBe(100);
  });

  it("zamknięcie jednego dialogu nie wznawia zegara, gdy drugi trwa", () => {
    let s = run(playing(), [
      add("modal.dialog", "npc.troll.bridge"),
      add("modal.riddle", "npc.troll.bridge"),
    ]);
    s = run(s, [remove("modal.dialog", "npc.troll.bridge")]);
    expect(isTimePaused(s)).toBe(true);
    expect(reducer(s, { type: "tick", dt: 10 }).elapsed).toBe(0);
    s = run(s, [remove("modal.riddle", "npc.troll.bridge")]);
    expect(isTimePaused(s)).toBe(false);
    expect(reducer(s, { type: "tick", dt: 10 }).elapsed).toBe(10);
  });

  it("ten sam powód od dwóch właścicieli wymaga dwóch zdjęć", () => {
    let s = run(playing(), [add("modal.dialog", "a"), add("modal.dialog", "b")]);
    s = run(s, [remove("modal.dialog", "a")]);
    expect(isTimePaused(s)).toBe(true);
    s = run(s, [remove("modal.dialog", "b")]);
    expect(isTimePaused(s)).toBe(false);
  });

  it("dodanie jest idempotentne, a usunięcie nieistniejącego nic nie psuje", () => {
    const once = run(playing(), [add("modal.dialog", "a")]);
    const twice = run(once, [add("modal.dialog", "a")]);
    expect(twice.pauses).toHaveLength(1);
    expect(twice).toBe(once);
    const noop = run(playing(), [remove("modal.dialog", "a")]);
    expect(noop.pauses).toEqual([]);
  });

  it("odrzuca puste powody i zarezerwowane powody systemowe", () => {
    const s = run(playing(), [
      add("", "a"),
      add("modal.dialog", ""),
      add("system.dead", "a"),
    ]);
    expect(s.pauses).toEqual([]);
  });

  it("clearOwner zdejmuje wszystkie powody właściciela, ale nie cudze", () => {
    let s = run(playing(), [
      add("modal.dialog", "a"),
      add("modal.riddle", "a"),
      add("modal.dialog", "b"),
    ]);
    s = run(s, [{ type: "pause.clearOwner", owner: "a" }]);
    expect(s.pauses).toEqual([{ reason: "modal.dialog", owner: "b" }]);
    expect(isTimePaused(s)).toBe(true);
  });

  it("pauza trwa także podczas martwej postaci i nie jest kasowana przez odrodzenie", () => {
    let s = run(playing({ dead: true }), [add("modal.dialog", "a")]);
    s = run(s, [{ type: "respawn" }]);
    expect(s.dead).toBe(false);
    expect(isTimePaused(s)).toBe(true);
  });

  it("emituje zdarzenie przy zmianie powodów pauzy", () => {
    const s = playing();
    const added = applyCommand(s, add("modal.dialog", "a"));
    expect(added.events).toEqual([
      { type: "time.pause_changed", paused: true, reasons: ["modal.dialog"] },
    ]);
    const second = applyCommand(added.state, add("modal.riddle", "a"));
    expect(second.events).toEqual([
      {
        type: "time.pause_changed",
        paused: true,
        reasons: ["modal.dialog", "modal.riddle"],
      },
    ]);
    const first = applyCommand(second.state, remove("modal.dialog", "a"));
    expect(first.events).toEqual([
      { type: "time.pause_changed", paused: true, reasons: ["modal.riddle"] },
    ]);
    const resumed = applyCommand(first.state, remove("modal.riddle", "a"));
    expect(resumed.events).toEqual([
      { type: "time.pause_changed", paused: false, reasons: [] },
    ]);
    expect(applyCommand(resumed.state, remove("modal.riddle", "a")).events).toEqual([]);
  });
});
