import { describe, expect, it } from "vitest";
import { BIRD_IDS, DEFAULT_WILDLIFE_CONFIG, WildlifeScheduler, type BirdEvent } from "./wildlife";
import { mulberry32 } from "./testkit";

function run(seed: number, hours: (t: number) => number, seconds: number, opts: { dialog?: boolean; active?: () => number } = {}) {
  const s = new WildlifeScheduler(mulberry32(seed));
  const events: { t: number; e: BirdEvent }[] = [];
  const dt = 0.2;
  for (let t = 0; t < seconds; t += dt) {
    const e = s.tick(dt, { hour: hours(t), dialog: Boolean(opts.dialog), activeEffects: opts.active?.() ?? 0 });
    if (e) events.push({ t, e });
  }
  return events;
}

describe("WildlifeScheduler", () => {
  it("w dzień przerwy są nieregularne i mieszczą się w rozsądnym przedziale", () => {
    const ev = run(1, () => 12, 3600);
    expect(ev.length).toBeGreaterThan(80);
    const gaps = ev.slice(1).map((x, i) => x.t - ev[i].t);
    const distinct = new Set(gaps.map((g) => Math.round(g)));
    expect(distinct.size).toBeGreaterThan(10);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3.5);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(40);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(13);
    expect(mean).toBeLessThan(30);
  });

  it("nie powtarza tego samego dźwięku pod rząd i używa wszystkich trzech", () => {
    const ev = run(2, () => 12, 3600);
    for (let i = 1; i < ev.length; i++) expect(ev[i].e.sound).not.toBe(ev[i - 1].e.sound);
    expect(new Set(ev.map((x) => x.e.sound))).toEqual(new Set(BIRD_IDS));
  });

  it("losuje głośność, ton, kierunek i odległość 15-60 m (nigdy przy uchu)", () => {
    const ev = run(3, () => 12, 7200).map((x) => x.e);
    const c = DEFAULT_WILDLIFE_CONFIG;
    for (const e of ev) {
      expect(e.distance).toBeGreaterThanOrEqual(c.distance[0]);
      expect(e.distance).toBeLessThanOrEqual(c.distance[1]);
      expect(e.rate).toBeGreaterThanOrEqual(1 - c.pitch - 1e-9);
      expect(e.rate).toBeLessThanOrEqual(1 + c.pitch + 1e-9);
      expect(e.gain).toBeGreaterThan(0);
      expect(e.gain).toBeLessThanOrEqual(1.0001);
      expect(e.height).toBeGreaterThanOrEqual(c.height[0]);
    }
    expect(new Set(ev.map((e) => Math.round(e.gain * 20))).size).toBeGreaterThan(5);
    expect(new Set(ev.map((e) => Math.round(e.rate * 100))).size).toBeGreaterThan(5);
    const sectors = new Set(ev.map((e) => Math.floor((e.bearing / (Math.PI * 2)) * 8)));
    expect(sectors.size).toBe(8);
    expect(Math.max(...ev.map((e) => e.distance))).toBeGreaterThan(50);
  });

  it("kolejne nawoływania nie dochodzą z tego samego kierunku", () => {
    const ev = run(4, () => 12, 3600).map((x) => x.e);
    const sep = DEFAULT_WILDLIFE_CONFIG.minBearingSeparation;
    let violations = 0;
    for (let i = 1; i < ev.length; i++) {
      const d = Math.abs(ev[i].bearing - ev[i - 1].bearing) % (Math.PI * 2);
      if (Math.min(d, Math.PI * 2 - d) < sep - 1e-9) violations++;
    }
    expect(violations / ev.length).toBeLessThan(0.02);
  });

  it("w nocy nie ma dziennych ptaków, a po świcie wracają", () => {
    expect(run(5, () => 1, 3600)).toHaveLength(0);
    expect(run(5, () => 23, 3600)).toHaveLength(0);
    expect(run(5, () => 6.5, 600).length).toBeGreaterThan(5);
  });

  it("rano jest więcej zdarzeń niż w południe i wieczorem", () => {
    const morning = run(6, () => 7, 3600).length;
    const noon = run(6, () => 12, 3600).length;
    const evening = run(6, () => 19.5, 3600).length;
    expect(morning).toBeGreaterThan(noon * 1.3);
    expect(evening).toBeLessThan(noon * 0.6);
  });

  it("nie przekracza limitu jednoczesnych efektów i ponawia próbę później", () => {
    const s = new WildlifeScheduler(mulberry32(7));
    let fired = 0;
    for (let t = 0; t < 600; t += 0.2) if (s.tick(0.2, { hour: 12, dialog: false, activeEffects: 2 })) fired++;
    expect(fired).toBe(0);
    let after = 0;
    for (let t = 0; t < 60; t += 0.2) if (s.tick(0.2, { hour: 12, dialog: false, activeEffects: 1 })) after++;
    expect(after).toBeGreaterThan(0);
  });

  it("podczas dialogu zdarzeń jest wyraźnie mniej i są cichsze", () => {
    const normal = run(8, () => 12, 3600);
    const dialog = run(8, () => 12, 3600, { dialog: true });
    expect(dialog.length).toBeLessThan(normal.length * 0.5);
    const avg = (ev: typeof normal) => ev.reduce((a, x) => a + x.e.gain, 0) / ev.length;
    expect(avg(dialog)).toBeLessThan(avg(normal));
  });

  it("jest deterministyczny dla tego samego generatora i nie używa Math.random", () => {
    const a = run(9, () => 12, 600);
    const b = run(9, () => 12, 600);
    expect(a).toEqual(b);
  });
});
