import { describe, expect, it } from "vitest";
import { DEFAULT_FOOTSTEP_CONFIG, FootstepScheduler } from "./footsteps";
import { mulberry32 } from "./testkit";

function walk(sched: FootstepScheduler, speed: number, seconds: number, opts: { frozen?: boolean } = {}) {
  const dt = 0.05;
  let steps = 0;
  const times: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const e = sched.update({ distance: speed * dt, dt, frozen: Boolean(opts.frozen) });
    steps += e.length;
    for (let i = 0; i < e.length; i++) times.push(t);
  }
  return { steps, times };
}

const make = (variants = 4, seed = 1) => new FootstepScheduler(mulberry32(seed), () => variants);

describe("FootstepScheduler", () => {
  it("liczba kroków odpowiada przebytemu dystansowi", () => {
    const r = walk(make(), 3.2, 10);
    const expected = (3.2 * 10) / DEFAULT_FOOTSTEP_CONFIG.walkStride;
    expect(Math.abs(r.steps - expected)).toBeLessThanOrEqual(2);
  });

  it("bieg (Shift) przyspiesza kroki", () => {
    const walking = walk(make(), 3.2, 10).steps;
    const running = walk(make(), 5.6, 10).steps;
    expect(running / walking).toBeGreaterThan(1.1);
    expect(running).toBeGreaterThan(walking);
  });

  it("stanie i samo obracanie kamery (brak przemieszczenia) nie dają kroków", () => {
    const s = make();
    expect(walk(s, 0, 10).steps).toBe(0);
    expect(walk(s, 0.1, 10).steps).toBe(0);
    expect(s.walking).toBe(false);
  });

  it("pierwszy krok słychać krótko po ruszeniu, a po zatrzymaniu krok się kończy od razu", () => {
    const s = make();
    const r = walk(s, 3.2, 3);
    expect(r.times[0]).toBeLessThan(0.5);
    expect(walk(s, 0, 1).steps).toBe(0);
    expect(s.walking).toBe(false);
    const again = walk(s, 3.2, 1);
    expect(again.steps).toBeGreaterThanOrEqual(1);
  });

  it("zamrożenie ruchu (dialog, okno) wycisza kroki", () => {
    expect(walk(make(), 3.2, 10, { frozen: true }).steps).toBe(0);
  });

  it("teleportacja nie jest krokiem", () => {
    const s = make();
    expect(s.update({ distance: 50, dt: 0.05, frozen: false })).toEqual([]);
  });

  it("warianty i ton są losowane, bez powtórki tego samego wariantu pod rząd", () => {
    const s = make(4, 3);
    const variants: number[] = [];
    const rates = new Set<number>();
    for (let i = 0; i < 400; i++) {
      for (const e of s.update({ distance: 1.4, dt: 0.4, frozen: false })) {
        variants.push(e.variant);
        rates.add(Math.round(e.rate * 100));
      }
    }
    expect(new Set(variants)).toEqual(new Set([0, 1, 2, 3]));
    for (let i = 1; i < variants.length; i++) expect(variants[i]).not.toBe(variants[i - 1]);
    expect(rates.size).toBeGreaterThan(4);
  });

  it("działa z jednym wariantem (pojedynczy krok w pliku)", () => {
    const s = make(1);
    const r = walk(s, 3.2, 5);
    expect(r.steps).toBeGreaterThan(5);
  });

  it("kroki biegu są głośniejsze i oznaczone jako bieg", () => {
    const s = make();
    const e = [];
    for (let i = 0; i < 40; i++) e.push(...s.update({ distance: 0.28, dt: 0.05, frozen: false }));
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((x) => x.run)).toBe(true);
    expect(s.running).toBe(true);
  });
});
