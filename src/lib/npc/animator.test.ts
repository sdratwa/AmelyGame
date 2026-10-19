import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { sceneNodeName, type TrollAsset } from "@/lib/assets/characters";
import { NpcAnimator } from "./animator";
import { loadTestTroll } from "./testkit";
import { buildTrollAnimations, TROLL_CLIPS } from "./troll";

let asset: TrollAsset;
let animator: NpcAnimator;
let changes: { from: string | null; to: string; kind: string }[];

const run = (seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) animator.update(dt);
};

beforeEach(async () => {
  asset = await loadTestTroll();
  const set = buildTrollAnimations(asset);
  changes = [];
  animator = new NpcAnimator(asset.scene, {
    clips: set.clips,
    states: set.states,
    base: "idle",
    procedural: [{ bone: sceneNodeName("mixamorig:Head"), amp: [0.02, 0.09, 0.015], freq: [0.13, 0.08, 0.1] }],
    onChange: (c) => changes.push(c),
  });
});

describe("animator trolla: stany i przejścia", () => {
  it("startuje w Idle; walk i angry istnieją, a Talk nie (nie jest udawany)", () => {
    expect(animator.state).toBe("idle");
    expect(animator.has("walk")).toBe(true);
    expect(animator.has("angry")).toBe(true);
    expect(animator.has("talk")).toBe(false);
    expect(animator.setBase("talk")).toBe(false);
    expect(animator.trigger("talk")).toBe(false);
    expect(animator.state).toBe("idle");
    expect(animator.states.sort()).toEqual(["angry", "idle", "walk"]);
  });

  it("Idle -> walk: płynne przejście (wagi sumują się do 1), po 0,25 s pełna waga chodu", () => {
    expect(animator.setBase("walk")).toBe(true);
    expect(animator.state).toBe("walk");
    run(0.1);
    const mid = animator.weights();
    expect(mid.walk).toBeGreaterThan(0.2);
    expect(mid.walk).toBeLessThan(0.8);
    expect(mid.idle).toBeGreaterThan(0.2);
    expect((mid.walk ?? 0) + (mid.idle ?? 0)).toBeCloseTo(1, 2);
    run(0.3);
    const done = animator.weights();
    expect(done.walk).toBeCloseTo(1, 3);
    expect(done.idle ?? 0).toBeLessThan(0.01);
  });

  it("walk zapętla się: czas klipu wraca do początku bez zatrzymania", () => {
    animator.setBase("walk");
    const times: number[] = [];
    for (let i = 0; i < 60 * 5; i++) {
      animator.update(1 / 60);
      times.push(animator.stateTime);
    }
    const wraps = times.filter((t, i) => i > 0 && t < times[i - 1]).length;
    expect(wraps).toBe(2);
    expect(Math.max(...times)).toBeLessThanOrEqual(2.334);
  });

  it("tempo kroków podąża za prędkością w świecie (współczynnik tempa stanu lokomocji)", () => {
    animator.setBase("walk");
    run(0.5);
    const start = animator.stateTime;
    animator.setLocomotionSpeed(0.5);
    run(1);
    const advanced = animator.stateTime - start;
    expect(advanced).toBeGreaterThan(0.45);
    expect(advanced).toBeLessThan(0.55);
  });

  it("angry: gra jednorazowo ok. 3,5 s i wraca do stanu podstawowego (Idle), bez powtórzenia", () => {
    expect(animator.trigger("angry")).toBe(true);
    expect(animator.state).toBe("angry");
    expect(animator.isReacting).toBe(true);
    run(3.0);
    expect(animator.state).toBe("angry");
    run(0.45);
    expect(animator.isReacting).toBe(false);
    expect(animator.state).toBe("idle");
    run(1.0);
    expect(animator.state).toBe("idle");
    expect(changes.filter((c) => c.to === "angry")).toHaveLength(1);
    expect(changes.map((c) => c.kind)).toEqual(["base", "reaction", "return"]);
    const total = changes.length;
    run(4);
    expect(changes).toHaveLength(total);
  });

  it("w trakcie gniewu kolejny gniew jest ignorowany (bez restartu), a zmiana bazy czeka na koniec reakcji", () => {
    animator.trigger("angry");
    run(1);
    const time = animator.stateTime;
    expect(animator.trigger("angry")).toBe(false);
    expect(animator.stateTime).toBeGreaterThanOrEqual(time);
    expect(animator.setBase("walk")).toBe(true);
    expect(animator.state).toBe("angry");
    run(2.6);
    expect(animator.isReacting).toBe(false);
    expect(animator.state).toBe("walk");
  });

  it("po gniewie można wywołać go ponownie", () => {
    animator.trigger("angry");
    run(3.6);
    expect(animator.isReacting).toBe(false);
    expect(animator.trigger("angry")).toBe(true);
  });

  it("nowy klip i stan (np. talk z innego pliku) dodaje się bez zmian w logice animatora", () => {
    const talk = new THREE.AnimationClip("talk_01", 2, []);
    animator.registerClip(talk);
    expect(animator.has("talk")).toBe(false);
    animator.registerState({ id: "talk", clip: "talk_01", loop: false, fade: 0.2 });
    expect(animator.has("talk")).toBe(true);
    expect(animator.trigger("talk")).toBe(true);
    run(2.1);
    expect(animator.isReacting).toBe(false);
    expect(animator.state).toBe("idle");
  });

  it("stan podstawowy bez klipu to błąd, nie ciche udawanie", () => {
    expect(() => new NpcAnimator(asset.scene, { clips: [], states: [{ id: "idle", clip: "brak", loop: true }], base: "idle" })).toThrow(/idle/);
    expect(TROLL_CLIPS.idle).toBe("idle");
  });
});

describe("animator trolla: Idle proceduralny", () => {
  const head = () => asset.scene.getObjectByName(sceneNodeName("mixamorig:Head"))!;

  it("w Idle głowa delikatnie się porusza (kilka stopni), poza Idle warstwa proceduralna wygasa", () => {
    run(1);
    const samples: number[] = [];
    const ref = new THREE.Quaternion();
    for (let i = 0; i < 60 * 14; i++) {
      animator.update(1 / 60);
      if (i === 0) ref.copy(head().quaternion);
      samples.push(ref.angleTo(head().quaternion));
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.01);
    expect(Math.max(...samples)).toBeLessThan(0.2);
    expect(animator.proceduralWeight).toBeCloseTo(1, 2);
    animator.setBase("walk");
    run(1.5);
    expect(animator.proceduralWeight).toBeLessThan(0.1);
    animator.trigger("angry");
    run(0.5);
    expect(animator.proceduralWeight).toBeLessThan(0.05);
  });

  it("ruch proceduralny nie kumuluje się: ta sama faza daje tę samą pozę", () => {
    run(0.5);
    const q1 = head().quaternion.clone();
    const t1 = animator.stateTime;
    run(50);
    expect(Number.isFinite(t1)).toBe(true);
    const norm = head().quaternion.length();
    expect(norm).toBeCloseTo(1, 5);
    expect(q1.angleTo(head().quaternion)).toBeLessThan(0.3);
  });
});
