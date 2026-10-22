import { describe, expect, it } from "vitest";
import { reducer } from "../game/core/apply";
import { getClock } from "../game/core/clock";
import { newPlaying } from "../game/testkit";
import { serializeState } from "../game/save/serialize";
import { hydrateState } from "../game/save/hydrate";

describe("pora dnia online", () => {
  it("ten sam czas serwera wygrywa z różnym czasem zapisów i lokalną pauzą", () => {
    const a = { ...newPlaying(), elapsed: 10 };
    const b = { ...newPlaying(), elapsed: 900, pauses: [{ reason: "ui.panel", owner: "test" }] };
    const first = reducer(a, { type: "world.clock", elapsed: 250 });
    const second = reducer(b, { type: "world.clock", elapsed: 250 });
    expect(getClock(first.worldElapsed!)).toEqual(getClock(second.worldElapsed!));
    const paused = reducer(second, { type: "tick", dt: 1 });
    expect(paused.elapsed).toBe(900);
    expect(paused.health).toBe(second.health);
    expect(reducer(paused, { type: "world.clock", elapsed: 260 }).worldElapsed).toBe(260);
  });

  it("lokalny tick i ustawienie godziny nie przesuwają pory dnia online; drenaż używa wspólnej nocy", () => {
    const state = reducer({ ...newPlaying(), elapsed: 0, health: 100, drainAcc: 0 }, { type: "world.clock", elapsed: 260 });
    expect(getClock(state.elapsed).isDay).toBe(true);
    expect(getClock(state.worldElapsed!).isDay).toBe(false);
    const next = reducer(state, { type: "tick", dt: 5 });
    expect(next.worldElapsed).toBe(260);
    expect(next.health).toBe(99);
    expect(reducer(next, { type: "dev.setClock", elapsed: 360 })).toBe(next);
  });

  it("nie zapisuje zegara serwera jako postępu; odrzuca błędne dane", () => {
    const state = newPlaying();
    for (const elapsed of [NaN, Infinity, -1]) {
      expect(reducer(state, { type: "world.clock", elapsed })).toBe(state);
    }
    const online = reducer(state, { type: "world.clock", elapsed: 1000 });
    const save = serializeState(online, 1)!;
    expect(save).toEqual(serializeState(state, 1));
    expect(hydrateState(save).worldElapsed).toBeUndefined();
    expect(reducer(state, { type: "tick", dt: 1 }).elapsed).toBe(state.elapsed + 1);
  });
});
