import { describe, expect, it } from "vitest";
import { SECONDS_PER_DAY, SECONDS_PER_GAME_HOUR } from "@/lib/game/core/constants";
import { getClock } from "@/lib/game/core/clock";
import { FIRST_MIDNIGHT, gameHour, midnightIndex, MidnightWatcher, NATURAL_STEP_LIMIT } from "./clock";

const H = SECONDS_PER_GAME_HOUR;

describe("zegar audio", () => {
  it("godzina zgadza się z zegarem gry", () => {
    for (const e of [0, 5, 100, 359.9, 360, 479, 480, 1234.5, 20000]) {
      const c = getClock(e);
      expect(Math.floor(gameHour(e))).toBe(c.hour);
      expect(Math.floor((gameHour(e) % 1) * 60 + 1e-6)).toBeGreaterThanOrEqual(c.minute - 1);
    }
    expect(gameHour(0)).toBeCloseTo(6);
    expect(gameHour(FIRST_MIDNIGHT)).toBeCloseTo(0);
    expect(gameHour(FIRST_MIDNIGHT - 1e-6)).toBeCloseTo(24, 4);
  });

  it("północ przypada 18 godzin po starcie doby (06:00) i co dobę", () => {
    expect(FIRST_MIDNIGHT).toBe(18 * H);
    expect(midnightIndex(FIRST_MIDNIGHT - 0.001)).toBe(-1);
    expect(midnightIndex(FIRST_MIDNIGHT)).toBe(0);
    expect(midnightIndex(FIRST_MIDNIGHT + SECONDS_PER_DAY - 0.001)).toBe(0);
    expect(midnightIndex(FIRST_MIDNIGHT + SECONDS_PER_DAY)).toBe(1);
  });
});

describe("MidnightWatcher", () => {
  const step = 0.1;

  it("przejście 23:59 -> 00:00 daje dokładnie jedno zdarzenie", () => {
    const w = new MidnightWatcher(FIRST_MIDNIGHT - 1);
    let fired = 0;
    for (let e = FIRST_MIDNIGHT - 1; e < FIRST_MIDNIGHT + 2; e += step) {
      const r = w.advance(e, 0);
      if (r.kind === "crossed") fired++;
    }
    expect(fired).toBe(1);
  });

  it("ten sam czas (pauza) i godzina 0 przez całą minutę nie powtarzają zdarzenia", () => {
    const w = new MidnightWatcher(FIRST_MIDNIGHT - 0.05);
    expect(w.advance(FIRST_MIDNIGHT + 0.05, 0)).toEqual({ kind: "crossed", midnight: 0 });
    for (let i = 0; i < 100; i++) expect(w.advance(FIRST_MIDNIGHT + 0.05, 0).kind).toBe("none");
    for (let e = FIRST_MIDNIGHT + 0.1; e < FIRST_MIDNIGHT + H / 60; e += 0.05) expect(w.advance(e, 0).kind).toBe("none");
  });

  it("każda doba daje własne zdarzenie z rosnącym numerem", () => {
    const w = new MidnightWatcher(0);
    const seen: number[] = [];
    for (let e = 0; e < SECONDS_PER_DAY * 3; e += 1) {
      const r = w.advance(e, 0);
      if (r.kind === "crossed") seen.push(r.midnight);
    }
    expect(seen).toEqual([0, 1, 2]);
  });

  it("skok o więcej niż limit naturalny nie wywołuje zdarzenia i przesuwa odniesienie", () => {
    const w = new MidnightWatcher(FIRST_MIDNIGHT - 10);
    expect(w.advance(FIRST_MIDNIGHT - 10 + NATURAL_STEP_LIMIT + 1, 0).kind).toBe("jump");
    expect(w.advance(FIRST_MIDNIGHT + 112, 0).kind).toBe("none");
  });

  it("cofnięcie czasu jest skokiem", () => {
    const w = new MidnightWatcher(FIRST_MIDNIGHT + 50);
    expect(w.advance(FIRST_MIDNIGHT - 50, 0).kind).toBe("jump");
    expect(w.advance(FIRST_MIDNIGHT - 49, 0).kind).toBe("none");
    expect(w.advance(FIRST_MIDNIGHT + 1, 0).kind).toBe("crossed");
  });

  it("zapowiedziana ręczna zmiana nawet krótkiego skoku przez północ nie wywołuje zdarzenia", () => {
    const w = new MidnightWatcher(FIRST_MIDNIGHT - 5);
    w.expectJump(FIRST_MIDNIGHT + 5, 1000);
    expect(w.advance(FIRST_MIDNIGHT - 4.9, 1010).kind).toBe("ignored");
    expect(w.advance(FIRST_MIDNIGHT + 5, 1020).kind).toBe("jump");
    expect(w.advance(FIRST_MIDNIGHT + 5.1, 1030).kind).toBe("none");
  });

  it("niezrealizowana zapowiedź skoku wygasa", () => {
    const w = new MidnightWatcher(100);
    w.expectJump(99999, 0, 1000);
    expect(w.advance(100.1, 500).kind).toBe("ignored");
    expect(w.advance(100.2, 1500).kind).toBe("none");
  });

  it("nieskończone i NaN są ignorowane", () => {
    const w = new MidnightWatcher(10);
    expect(w.advance(Number.NaN, 0).kind).toBe("ignored");
    expect(w.advance(Infinity, 0).kind).toBe("ignored");
    expect(w.elapsed).toBe(10);
  });
});
