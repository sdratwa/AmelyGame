import { describe, expect, it } from "vitest";
import { clipTimeScale, LOCOMOTION_CLIPS, mirrorShare, targetWeights, type AnimIntent } from "./animationState";
import { TPP_DEFAULTS } from "./config";

const intent = (patch: Partial<AnimIntent>): AnimIntent => ({ crouching: false, airborne: false, speed: 0, forward: 0, right: 0, ...patch });
const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe("targetWeights", () => {
  it("w miejscu: sam idle; kucanie w miejscu: sam crouch_idle", () => {
    expect(targetWeights(intent({}), TPP_DEFAULTS).idle).toBe(1);
    expect(targetWeights(intent({ crouching: true }), TPP_DEFAULTS).crouch_idle).toBe(1);
  });

  it("chód -> bieg: wagi sumują się do 1 w całym zakresie prędkości i przechodzą płynnie", () => {
    let prevRun = 0;
    for (let s = 0; s <= 5; s += 0.1) {
      const w = targetWeights(intent({ speed: s, forward: s }), TPP_DEFAULTS);
      expect(sum(w)).toBeCloseTo(1, 6);
      expect(w.run).toBeGreaterThanOrEqual(prevRun - 1e-9);
      prevRun = w.run;
    }
    expect(targetWeights(intent({ speed: TPP_DEFAULTS.walkSpeed, forward: 2.2 }), TPP_DEFAULTS).walk).toBeCloseTo(1, 6);
    expect(targetWeights(intent({ speed: TPP_DEFAULTS.runSpeed, forward: 4.8 }), TPP_DEFAULTS).run).toBeCloseTo(1, 6);
  });

  it("kucanie: kierunek ruchu wybiera klipy przód, tył i boki, ukos miesza dwa sąsiednie", () => {
    const at = (forward: number, right: number) => targetWeights(intent({ crouching: true, speed: Math.hypot(forward, right), forward, right }), TPP_DEFAULTS);
    expect(at(1, 0).crouch_walk_forward).toBeCloseTo(1, 6);
    expect(at(-1, 0).crouch_walk_back).toBeCloseTo(1, 6);
    expect(at(0, 1).crouch_sneak_right).toBeCloseTo(1, 6);
    expect(at(0, -1).crouch_sneak_left).toBeCloseTo(1, 6);
    const diag = at(0.7, 0.7);
    expect(diag.crouch_walk_forward).toBeCloseTo(0.5, 6);
    expect(diag.crouch_sneak_right).toBeCloseTo(0.5, 6);
    expect(sum(diag)).toBeCloseTo(1, 6);
  });

  it("w powietrzu klipy ruchu są wygaszone (gra skok)", () => {
    const w = targetWeights(intent({ airborne: true, speed: 3 }), TPP_DEFAULTS);
    for (const k of LOCOMOTION_CLIPS) expect(w[k]).toBe(0);
  });
});

describe("clipTimeScale", () => {
  it("tempo klipu rośnie z prędkością i jest ograniczone", () => {
    expect(clipTimeScale(TPP_DEFAULTS.nominalWalk, TPP_DEFAULTS.nominalWalk, TPP_DEFAULTS)).toBe(1);
    expect(clipTimeScale(0, 1.5, TPP_DEFAULTS)).toBe(TPP_DEFAULTS.animMinTimeScale);
    expect(clipTimeScale(100, 1.5, TPP_DEFAULTS)).toBe(TPP_DEFAULTS.animMaxTimeScale);
  });
});

describe("mirrorShare", () => {
  it("brak składowej w lewo = oryginał, ukos 45° = pełne odbicie, pomiędzy płynnie i bez skoków", () => {
    expect(mirrorShare(0, 1)).toBe(0);
    expect(mirrorShare(0, 0)).toBe(0);
    expect(mirrorShare(0.5, 0.5)).toBe(1);
    expect(mirrorShare(1, 0)).toBe(1);
    let prev = 0;
    for (let l = 0; l <= 1; l += 0.01) {
      const m = mirrorShare(l, 1 - l);
      expect(m).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(m - prev).toBeLessThan(0.04);
      prev = m;
    }
  });
});
