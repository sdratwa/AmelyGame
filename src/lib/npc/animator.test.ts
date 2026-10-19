import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { sceneNodeName, type TrollAsset } from "@/lib/assets/characters";
import { NpcAnimator } from "./animator";
import { loadTestTroll } from "./testkit";
import { buildTrollAnimations, TROLL_CLIPS, TROLL_FADE } from "./troll";

let asset: TrollAsset;
let animator: NpcAnimator;
let changes: { from: string | null; to: string; kind: string }[];
let finished: string[];

const run = (seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) animator.update(dt);
};

const make = (procedural = false) => {
  const set = buildTrollAnimations(asset);
  changes = [];
  finished = [];
  return new NpcAnimator(asset.scene, {
    clips: set.clips,
    states: procedural ? set.states.map((s) => (s.id === "idle" ? { ...s, procedural: true } : s)) : set.states,
    base: "idle",
    procedural: procedural ? [{ bone: sceneNodeName("mixamorig:Head"), amp: [0.02, 0.09, 0.015], freq: [0.13, 0.08, 0.1] }] : undefined,
    onChange: (c) => changes.push(c),
    onFinished: (id) => finished.push(id),
  });
};

const clipDuration = (id: string) => asset.clips.find((c) => c.name === TROLL_CLIPS[id as keyof typeof TROLL_CLIPS])!.duration;

beforeEach(async () => {
  asset = await loadTestTroll();
  animator = make();
});

describe("animator trolla: stany i mapowanie klipów", () => {
  it("startuje w Idle; mapuje stany na 7 klipów z pliku, a Talk nie istnieje i nie jest udawany", () => {
    expect(animator.state).toBe("idle");
    expect(animator.states.sort()).toEqual(["angry", "dance", "happy", "idle", "nervous", "surprised", "walk"]);
    expect(Object.values(TROLL_CLIPS).sort()).toEqual(asset.clips.map((c) => c.name).sort());
    expect(animator.has("talk")).toBe(false);
    expect(animator.setBase("talk")).toBe(false);
    expect(animator.trigger("talk")).toBe(false);
    expect(animator.state).toBe("idle");
  });

  it("pętle to Walk i Idle, reakcje jednorazowe to Nervous, Surprised, Happy, Dance i Angry", () => {
    expect(animator.setBase("surprised")).toBe(false);
    expect(animator.setBase("walk")).toBe(true);
    expect(animator.setBase("idle")).toBe(true);
    for (const id of ["nervous", "surprised", "happy", "dance", "angry"]) {
      expect(animator.trigger(id), id).toBe(true);
      expect(animator.cancel() || animator.locked).toBe(true);
      run(clipDuration(id) + 1);
      expect(animator.isReacting, id).toBe(false);
    }
  });

  it("czasy przejść mieszczą się w 0,2-0,4 s", () => {
    for (const fade of Object.values(TROLL_FADE)) {
      expect(fade).toBeGreaterThanOrEqual(0.2);
      expect(fade).toBeLessThanOrEqual(0.4);
    }
  });

  it("Idle -> Walk: crossfade (wagi sumują się do 1, nigdy dwa klipy pełną wagą), po 0,3 s pełna waga chodu", () => {
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

  it("Walk zapętla się: czas klipu wraca do początku bez zatrzymania", () => {
    animator.setBase("walk");
    const times: number[] = [];
    for (let i = 0; i < 60 * 5; i++) {
      animator.update(1 / 60);
      times.push(animator.stateTime);
    }
    const wraps = times.filter((t, i) => i > 0 && t < times[i - 1]).length;
    expect(wraps).toBe(Math.floor(5 / clipDuration("walk")));
    expect(Math.max(...times)).toBeLessThanOrEqual(clipDuration("walk") + 1e-3);
  });

  it("Idle zapętla się w nieskończoność bez zdarzeń zakończenia", () => {
    run(clipDuration("idle") * 3 + 0.5);
    expect(animator.state).toBe("idle");
    expect(finished).toEqual([]);
  });

  it("tempo kroków podąża za prędkością w świecie (współczynnik tempa stanu lokomocji)", () => {
    animator.setBase("walk");
    run(0.5);
    const start = animator.stateTime;
    animator.setLocomotionSpeed(0.5);
    run(0.8);
    const advanced = animator.stateTime - start;
    expect(advanced).toBeGreaterThan(0.36);
    expect(advanced).toBeLessThan(0.44);
  });
});

describe("animator trolla: reakcje jednorazowe i zdarzenie zakończenia klipu", () => {
  it.each(["surprised", "happy", "dance", "angry"] as const)("%s gra raz, od początku do końca, bez przerwania, i wraca do Idle", (id) => {
    const duration = clipDuration(id);
    expect(animator.trigger(id)).toBe(true);
    expect(animator.state).toBe(id);
    expect(animator.locked).toBe(true);
    let last = -1;
    let monotonic = true;
    for (let t = 0; t < duration - 0.05; t += 1 / 60) {
      animator.update(1 / 60);
      if (animator.stateTime < last) monotonic = false;
      last = animator.stateTime;
      expect(finished, `${id} t=${t.toFixed(2)}`).toEqual([]);
    }
    expect(monotonic).toBe(true);
    run(0.2);
    expect(finished).toEqual([id]);
    expect(animator.isReacting).toBe(false);
    expect(animator.state).toBe("idle");
    run(duration + 1);
    expect(finished).toEqual([id]);
    expect(changes.filter((c) => c.to === id)).toHaveLength(1);
    expect(changes.map((c) => c.kind)).toEqual(["base", "reaction", "return"]);
  });

  it("zakończenie klipu jest zdarzeniem miksera, więc nie zależy od kroku czasu (30, 60 i 144 kl./s)", () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      animator.dispose();
      animator = make();
      animator.trigger("angry");
      let t = 0;
      let at = -1;
      while (t < 8 && at < 0) {
        animator.update(dt);
        t += dt;
        if (finished.length > 0) at = t;
      }
      expect(finished).toEqual(["angry"]);
      expect(at).toBeGreaterThanOrEqual(clipDuration("angry") - 1e-6);
      expect(at).toBeLessThan(clipDuration("angry") + 0.1);
    }
  });

  it("w trakcie reakcji, której nie wolno przerwać, kolejna jest odrzucana (bez restartu), a zmiana bazy czeka na koniec", () => {
    animator.trigger("angry");
    run(1);
    const time = animator.stateTime;
    expect(animator.trigger("angry")).toBe(false);
    expect(animator.trigger("happy")).toBe(false);
    expect(animator.cancel()).toBe(false);
    expect(animator.stateTime).toBeGreaterThanOrEqual(time);
    expect(animator.setBase("walk")).toBe(true);
    expect(animator.state).toBe("angry");
    run(clipDuration("angry"));
    expect(animator.isReacting).toBe(false);
    expect(animator.state).toBe("walk");
  });

  it("Nervous można przerwać płynnie zmianą bazy albo cancel; Surprised, Happy, Dance i Angry nie", () => {
    animator.trigger("nervous");
    run(1);
    expect(animator.locked).toBe(false);
    expect(animator.setBase("walk")).toBe(true);
    expect(animator.state).toBe("walk");
    expect(animator.isReacting).toBe(false);
    run(0.1);
    const w = animator.weights();
    expect((w.walk ?? 0) + (w.nervous ?? 0)).toBeCloseTo(1, 2);
    animator.setBase("idle");
    animator.trigger("nervous");
    expect(animator.cancel()).toBe(true);
    expect(animator.state).toBe("idle");
    for (const id of ["surprised", "happy", "dance", "angry"]) {
      animator.trigger(id);
      expect(animator.locked, id).toBe(true);
      expect(animator.cancel(), id).toBe(false);
      run(clipDuration(id) + 0.5);
    }
  });

  it("łańcuch Happy -> Dance: każdy klip w całości, płynne przejście bez przerwy, na końcu powrót do Idle", () => {
    expect(animator.trigger("happy", { then: ["dance"] })).toBe(true);
    const order: string[] = [];
    let maxSum = 0;
    let minSum = 2;
    let maxLoopOverlap = 0;
    const total = clipDuration("happy") + clipDuration("dance") + 2;
    for (let t = 0; t < total; t += 1 / 60) {
      animator.update(1 / 60);
      if (order[order.length - 1] !== animator.state) order.push(animator.state);
      const w = animator.weights();
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      maxSum = Math.max(maxSum, sum);
      if (t > 0.1) minSum = Math.min(minSum, sum);
      // dwa klipy pełnym wpływem naraz = suma wag znacznie ponad 1
    }
    maxLoopOverlap = maxSum;
    expect(order).toEqual(["happy", "dance", "idle"]);
    expect(finished).toEqual(["happy", "dance"]);
    expect(maxLoopOverlap).toBeLessThan(1.02);
    expect(minSum).toBeGreaterThan(0.98);
  });

  it("łańcuch jest odrzucany w całości, jeśli któryś klip nie istnieje (nic nie jest zagrane)", () => {
    expect(animator.trigger("happy", { then: ["moonwalk"] })).toBe(false);
    expect(animator.isReacting).toBe(false);
    expect(animator.state).toBe("idle");
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
    expect(finished).toEqual(["talk"]);
  });

  it("stan podstawowy bez klipu to błąd, nie ciche udawanie", () => {
    expect(() => new NpcAnimator(asset.scene, { clips: [], states: [{ id: "idle", clip: "brak", loop: true }], base: "idle" })).toThrow(/idle/);
  });

  it("dispose w trakcie animacji: koniec zdarzeń, brak błędów przy dalszych krokach, powtórne dispose jest bezpieczne", () => {
    animator.trigger("dance");
    run(2);
    animator.dispose();
    expect(() => run(clipDuration("dance") + 1)).not.toThrow();
    expect(finished).toEqual([]);
    expect(() => animator.dispose()).not.toThrow();
  });
});

describe("animator trolla: warstwa proceduralna (opcjonalna)", () => {
  const head = () => asset.scene.getObjectByName(sceneNodeName("mixamorig:Head"))!;

  it("włączona na stanie: głowa porusza się o kilka stopni, poza nim warstwa wygasa", () => {
    animator.dispose();
    animator = make(true);
    run(1);
    const samples: number[] = [];
    const ref = new THREE.Quaternion();
    for (let i = 0; i < 60 * 14; i++) {
      animator.update(1 / 60);
      if (i === 0) ref.copy(head().quaternion);
      samples.push(ref.angleTo(head().quaternion));
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.01);
    expect(animator.proceduralWeight).toBeCloseTo(1, 2);
    animator.setBase("walk");
    run(1.5);
    expect(animator.proceduralWeight).toBeLessThan(0.1);
  });

  it("domyślnie (prawdziwy Idle z pliku) warstwa proceduralna jest wyłączona", () => {
    run(2);
    expect(animator.proceduralWeight).toBe(0);
  });
});

describe("animator trolla: suma wag przy przerwanych przejściach", () => {
  const sum = () => Object.values(animator.weights()).reduce((a, b) => a + b, 0);

  it("zmiana stanu w środku poprzedniego przejścia nie daje sumy wag różnej od 1 (brak dwóch pełnych animacji i skoku do T-pose)", () => {
    animator.setBase("walk");
    run(1);
    animator.setBase("idle");
    for (const seconds of [0.1, 0.05, 0.12]) {
      run(seconds);
      expect(Math.abs(sum() - 1)).toBeLessThan(1e-9);
    }
    animator.trigger("nervous");
    for (let i = 0; i < 40; i++) {
      run(1 / 60);
      expect(Math.abs(sum() - 1)).toBeLessThan(1e-9);
    }
    animator.cancel();
    animator.setBase("walk");
    for (let i = 0; i < 60; i++) {
      run(1 / 60);
      expect(Math.abs(sum() - 1)).toBeLessThan(1e-9);
    }
    expect(animator.weights()).toEqual({ walk: 1 });
  });

  it("powrót do klipu, który jeszcze znika, startuje od jego bieżącej wagi (bez dołka)", () => {
    animator.setBase("walk");
    run(1);
    animator.setBase("idle");
    run(0.15);
    const walkBefore = animator.weights().walk;
    expect(walkBefore).toBeGreaterThan(0.2);
    expect(walkBefore).toBeLessThan(0.8);
    animator.setBase("walk");
    expect(Math.abs(sum() - 1)).toBeLessThan(1e-9);
    expect(animator.weights().walk).toBeCloseTo(walkBefore, 6);
  });

  it("po zakończeniu przejścia nieaktywne klipy są zatrzymane (nie kosztują w mixerze)", () => {
    animator.setBase("walk");
    run(1);
    expect(animator.weights()).toEqual({ walk: 1 });
    expect(animator.mixer.existingAction(asset.clips.find((c) => c.name === "Idle")!)?.isRunning() ?? false).toBe(false);
  });
});

