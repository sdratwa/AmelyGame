import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY } from "../core/constants";
import { getClock } from "../core/clock";
import { applyCommand } from "../core/apply";
import { newPlaying } from "../testkit";
import { devSetClock, nextClockTime } from "./devClock";

describe("nextClockTime", () => {
  it("zawsze wskazuje przyszłość i trafia w żądaną godzinę", () => {
    for (const hour of [1, 6, 12, 19.5, 23.99]) {
      for (const elapsed of [0, 50, 119.5, 360, 479.9, 2000.123]) {
        const t = nextClockTime(elapsed, hour);
        expect(t).toBeGreaterThan(elapsed);
        expect(t - elapsed).toBeLessThanOrEqual(SECONDS_PER_DAY + 1);
        const c = getClock(t + 1e-6);
        expect(c.hour + c.minute / 60).toBeCloseTo(hour, 1);
      }
    }
  });

  it("gdy już jest ta godzina, przesuwa o dobę", () => {
    const t = nextClockTime(0, 6);
    expect(t).toBeCloseTo(SECONDS_PER_DAY);
  });
});

describe("dev.setClock", () => {
  it("przesuwa tylko czas gry do przodu i niczego więcej nie zmienia", () => {
    const s = newPlaying();
    const target = nextClockTime(s.elapsed, 1);
    const next = applyCommand(s, { type: "dev.setClock", elapsed: target }).state;
    expect(next.elapsed).toBe(target);
    expect({ ...next, elapsed: s.elapsed }).toEqual(s);
  });

  it("odrzuca cofanie, brak zmiany, wartości nieskończone i zbyt duże skoki", () => {
    const s = { ...newPlaying(), elapsed: 500 };
    for (const bad of [400, 500, Number.NaN, Infinity, 500 + 3 * SECONDS_PER_DAY]) {
      expect(devSetClock(s, bad).state).toBe(s);
    }
  });
});
