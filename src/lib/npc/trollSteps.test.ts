import { beforeEach, describe, expect, it } from "vitest";
import { sceneNodeName, type TrollAsset } from "@/lib/assets/characters";
import { trollPlacement } from "@/lib/forest-view/npc";
import { forestOf, forestWalkOf } from "@/lib/game/world/lookup";
import { loadTestTroll } from "./testkit";
import { buildTrollAnimations, STEP_MIN_WEIGHT, TrollNpc, type TrollStep } from "./troll";
import { detectFootfalls, FootfallTracker, type Footfall } from "./trollSteps";

const SEED = 2030;
const DT = 1 / 60;
let asset: TrollAsset;

beforeEach(async () => {
  asset = await loadTestTroll();
});

const make = () => {
  const forest = forestOf(SEED);
  const place = trollPlacement(forest);
  const npc = new TrollNpc({ asset, walk: forestWalkOf(SEED), terrain: forest.terrain, home: place.home, faceTo: place.faceTo, seed: SEED, castShadow: false, receiveShadow: false });
  const steps: (TrollStep & { anim: string; weight: number; t: number })[] = [];
  let clock = 0;
  npc.setStepListener((s) => steps.push({ ...s, anim: npc.animator.state, weight: npc.animator.weightOf("walk"), t: clock }));
  const run = (seconds: number, player: { x: number; z: number }) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      npc.update(DT, player);
      clock += DT;
    }
  };
  return { npc, place, steps, run, far: { x: place.home.x + 60, z: place.home.z } };
};

describe("kontakty stóp w klipie Walk", () => {
  it("klip ma dokładnie dwa kontakty na cykl: lewa i prawa stopa naprzemiennie, w różnych fazach", () => {
    const set = buildTrollAnimations(asset);
    const f = set.footfalls;
    expect(f.footfalls).toHaveLength(2);
    expect(new Set(f.footfalls.map((x) => x.foot))).toEqual(new Set([0, 1]));
    expect(f.duration).toBeGreaterThan(1);
    const [a, b] = f.footfalls;
    const gap = b.time - a.time;
    // cykl nie musi być symetryczny (mocap), ale kroki nie mogą się zlewać
    expect(Math.min(gap, f.duration - gap)).toBeGreaterThan(0.3 * f.duration);
    for (const x of f.footfalls) {
      expect(x.time).toBeGreaterThanOrEqual(0);
      expect(x.time).toBeLessThan(f.duration);
    }
  });

  it("w chwili kontaktu kostka danej stopy jest nisko, a w środku wymachu wysoko", () => {
    const walk = asset.clips.find((c) => /walk/i.test(c.name))!;
    const ankles = ["mixamorig:LeftFoot", "mixamorig:RightFoot"].map((n) => asset.scene.getObjectByName(sceneNodeName(n))!) as [never, never];
    const analysis = detectFootfalls(asset.scene, walk, ankles, asset.scale);
    for (const ff of analysis.footfalls) {
      const i = Math.round((ff.time / analysis.duration) * 120) % 120;
      const h = analysis.heights[ff.foot];
      const max = Math.max(...h);
      expect(h[i]).toBeLessThan(0.45 * max);
      expect(max).toBeGreaterThan(0.05);
    }
  });

  it("analiza nie zmienia pozy szkieletu", () => {
    const hips = asset.scene.getObjectByName(sceneNodeName("mixamorig:Hips"))!;
    const before = hips.position.clone();
    const walk = asset.clips.find((c) => /walk/i.test(c.name))!;
    const ankles = ["mixamorig:LeftFoot", "mixamorig:RightFoot"].map((n) => asset.scene.getObjectByName(sceneNodeName(n))!) as [never, never];
    detectFootfalls(asset.scene, walk, ankles, asset.scale);
    expect(hips.position.distanceTo(before)).toBeLessThan(1e-9);
  });
});

describe("FootfallTracker", () => {
  const analysis = { duration: 1.4, footfalls: [{ time: 0.2, foot: 0 }, { time: 0.8, foot: 1 }] as Footfall[] };
  const feed = (t: tracker, from: number, to: number, dt: number, active = true) => {
    for (let time = from; time <= to + 1e-9; time += dt) t.update({ active, time });
  };
  type tracker = FootfallTracker;

  it("wyzwala dokładnie jeden krok na kontakt, w kolejności lewa-prawa, przez wiele cykli", () => {
    const got: Footfall[] = [];
    const t = new FootfallTracker(analysis, (f) => got.push(f));
    feed(t, 0, 1.4 * 5, DT);
    // czas klipu zawija się modulo cykl
    expect(got.length).toBeGreaterThanOrEqual(9);
    expect(got.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < got.length; i++) expect(got[i].foot).not.toBe(got[i - 1].foot);
  });

  it("nie wyzwala kroku w klatce wejścia w stan, po przerwie ani po dużym skoku czasu (crossfade, pauza)", () => {
    const got: Footfall[] = [];
    const t = new FootfallTracker(analysis, (f) => got.push(f));
    t.update({ active: true, time: 0.19 });
    expect(got).toHaveLength(0);
    t.update({ active: false, time: 0.21 });
    t.update({ active: true, time: 0.3 });
    expect(got).toHaveLength(0);
    t.update({ active: true, time: 1.1 });
    expect(got).toHaveLength(0);
  });

  it("zatrzymana animacja (czas stoi) i zerowa prędkość nie dają kroków", () => {
    const got: Footfall[] = [];
    const t = new FootfallTracker(analysis, (f) => got.push(f));
    for (let i = 0; i < 300; i++) t.update({ active: true, time: 0.2 });
    for (let i = 0; i < 300; i++) t.update({ active: false, time: 0.2 + i * 0.01 });
    expect(got).toHaveLength(0);
  });

  it("tempo kroków podąża za tempem animacji (szybszy czas klipu = więcej kroków na sekundę)", () => {
    const count = (speed: number) => {
      const got: Footfall[] = [];
      const t = new FootfallTracker(analysis, (f) => got.push(f));
      let time = 0;
      for (let i = 0; i < 60 * 10; i++) {
        time += DT * speed;
        t.update({ active: true, time });
      }
      return got.length;
    };
    expect(count(1.5)).toBeGreaterThan(count(1) * 1.3);
    expect(count(0.5)).toBeLessThan(count(1) * 0.7);
  });
});

describe("TrollNpc: kroki z animacji Walk", () => {
  it("podczas patrolu daje kroki w tempie animacji (2 na cykl), ze stanu walk i z pełną wagą", () => {
    const { npc, steps, run, far } = make();
    run(60, far);
    const cycle = buildTrollAnimations(asset).footfalls.duration;
    expect(steps.length).toBeGreaterThan(10);
    for (const s of steps) {
      expect(s.anim).toBe("walk");
      expect(s.weight).toBeGreaterThanOrEqual(STEP_MIN_WEIGHT);
      expect(s.speed).toBeGreaterThan(0.15);
    }
    const gaps: number[] = [];
    for (let i = 1; i < steps.length; i++) if (steps[i].t - steps[i - 1].t < 1) gaps.push(steps[i].t - steps[i - 1].t);
    expect(gaps.length).toBeGreaterThan(5);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(cycle * 0.3);
    expect(mean).toBeLessThan(cycle * 0.7);
    expect(npc.stepsEmitted).toBe(steps.length);
  });

  it("pozycja zdarzenia to pozycja trolla w świecie, a stopy zmieniają się naprzemiennie", () => {
    const { npc, steps, run, far } = make();
    run(40, far);
    expect(steps.length).toBeGreaterThan(6);
    const last = steps[steps.length - 1];
    expect(Math.hypot(last.x - npc.x, last.z - npc.z)).toBeLessThan(4);
    for (let i = 1; i < steps.length; i++) if (steps[i].t - steps[i - 1].t < 1) expect(steps[i].foot).not.toBe(steps[i - 1].foot);
  });

  it("w Idle (stoi, np. w pauzie patrolu) kroków nie ma, a flaga stepping jest wyłączona", () => {
    const { npc, steps, run, far } = make();
    run(90, far);
    let idleFrames = 0;
    for (let i = 0; i < 60 * 90; i++) {
      const before = steps.length;
      npc.update(DT, far);
      if (npc.animator.state !== "walk") {
        idleFrames++;
        expect(steps.length).toBe(before);
        expect(npc.stepping).toBe(false);
      }
    }
    expect(idleFrames).toBeGreaterThan(60);
  });

  it("żaden krok nie powstaje poza stanem walk: Surprised, Angry, Idle i przejścia (crossfade)", () => {
    const { npc, steps, run, far } = make();
    run(30, far);
    npc.react("angry");
    const before = steps.length;
    for (let i = 0; i < 60 * 3; i++) {
      npc.update(DT, far);
      if (npc.animator.state === "angry") expect(npc.stepping).toBe(false);
    }
    expect(steps.length).toBe(before);
    for (const s of steps) expect(s.anim).toBe("walk");
  });

  it("w spotkaniu (zauważenie, Surprised, dialog) nie ma kroków, a podczas dialogu troll stoi", () => {
    const { npc, place, steps, run } = make();
    run(20, { x: place.home.x + 60, z: place.home.z });
    const behaviors = new Set<string>();
    let inDialog = 0;
    const stepAt = steps.length;
    npc.setStepListener((s) => steps.push({ ...s, anim: npc.animator.state, weight: npc.animator.weightOf("walk"), t: 0 }));
    for (let i = 0; i < 60 * 60; i++) {
      const before = steps.length;
      const d = Math.max(3, 40 - i * DT * 3);
      npc.update(DT, { x: npc.x + d, z: npc.z });
      if (steps.length > before) behaviors.add(npc.encounterState);
      if (npc.encounterState === "dialog") {
        inDialog++;
        expect(steps.length).toBe(before);
        expect(npc.stepping).toBe(false);
      }
    }
    expect(inDialog).toBeGreaterThan(60);
    expect(steps.length).toBeGreaterThan(stepAt);
    for (const b of behaviors) expect(["patrol", "alert"]).toContain(b);
  });

  it("po usunięciu odbiorcy i po dispose nie ma zdarzeń", () => {
    const { npc, steps, run, far } = make();
    run(30, far);
    const n = steps.length;
    npc.setStepListener(null);
    run(30, far);
    expect(steps.length).toBe(n);
    const again: unknown[] = [];
    npc.setStepListener((s) => again.push(s));
    npc.dispose();
    npc.update(DT, far);
    expect(again).toHaveLength(0);
  });
});
