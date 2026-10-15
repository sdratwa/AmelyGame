import { describe, expect, it } from "vitest";
import { getClock, gameHoursToSeconds, nextDayStart } from "./clock";
import { SECONDS_PER_DAY } from "./constants";

describe("nextDayStart", () => {
  it("zwraca początek następnego dnia gry (kolejne 06:00)", () => {
    expect(nextDayStart(0)).toBe(SECONDS_PER_DAY);
    expect(nextDayStart(SECONDS_PER_DAY - 0.1)).toBe(SECONDS_PER_DAY);
    expect(nextDayStart(12 * 20)).toBe(SECONDS_PER_DAY);
  });

  it("w chwili granicy dnia przechodzi na kolejny dzień", () => {
    expect(nextDayStart(SECONDS_PER_DAY)).toBe(2 * SECONDS_PER_DAY);
  });

  it("wynik wypada o 06:00 i jest nowym dniem", () => {
    for (const elapsed of [1, 100, 479.9, 480, 1234.5, 99999]) {
      const clock = getClock(nextDayStart(elapsed));
      expect(clock.hour).toBe(6);
      expect(clock.minute).toBe(0);
      expect(clock.day).toBe(getClock(elapsed).day + 1);
    }
  });
});

describe("gameHoursToSeconds", () => {
  it("jedna godzina gry to 20 s", () => {
    expect(gameHoursToSeconds(1)).toBe(20);
    expect(gameHoursToSeconds(24)).toBe(SECONDS_PER_DAY);
  });
});
