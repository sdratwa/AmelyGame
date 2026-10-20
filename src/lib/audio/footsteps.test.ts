import { describe, expect, it } from "vitest";
import {
  FootstepScheduler,
  NPC_STEP_SOUND,
  NPC_VARIATION,
  PLAYER_STRIDE,
  PLAYER_VARIATION,
  StepVoicing,
  npcStepAttenuationDb,
  npcStepFade,
  npcStepGain,
  npcStepLowpass,
} from "./footsteps";
import { mulberry32 } from "./testkit";

function walk(sched: FootstepScheduler, speed: number, seconds: number, opts: { frozen?: boolean } = {}) {
  const dt = 0.05;
  let steps = 0;
  const times: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    if (sched.update(speed * dt, dt, Boolean(opts.frozen))) {
      steps++;
      times.push(t);
    }
  }
  return { steps, times };
}

describe("FootstepScheduler (kroki gracza z przebytej drogi)", () => {
  it("liczba kroków odpowiada przebytemu dystansowi", () => {
    const r = walk(new FootstepScheduler(), 3.2, 10);
    const expected = (3.2 * 10) / PLAYER_STRIDE.walkStride;
    expect(Math.abs(r.steps - expected)).toBeLessThanOrEqual(2);
  });

  it("bieg (Shift) daje częstsze kroki", () => {
    const walking = walk(new FootstepScheduler(), 3.2, 10).steps;
    const running = walk(new FootstepScheduler(), 5.6, 10).steps;
    expect(running).toBeGreaterThan(walking);
  });

  it("stanie, obracanie kamery i napieranie na przeszkodę (prawie zerowe przesunięcie) nie dają kroków", () => {
    const s = new FootstepScheduler();
    expect(walk(s, 0, 10).steps).toBe(0);
    expect(walk(s, 0.1, 10).steps).toBe(0);
    expect(walk(s, 0.3, 10).steps).toBe(0);
    expect(s.walking).toBe(false);
  });

  it("napieranie na drzewo nie przyspiesza kroków: liczy się tylko faktyczne przesunięcie", () => {
    const free = walk(new FootstepScheduler(), 3.2, 10).steps;
    const s = new FootstepScheduler();
    let steps = 0;
    for (let t = 0; t < 10; t += 0.05) {
      // klawisz wciśnięty cały czas, ale co druga klatka kolizja cofa ruch
      const moved = Math.round(t / 0.05) % 2 === 0 ? 3.2 * 0.05 : 0;
      if (s.update(moved, 0.05, false)) steps++;
    }
    expect(steps).toBeLessThanOrEqual(free);
  });

  it("pierwszy krok słychać krótko po ruszeniu, a po zatrzymaniu kroki kończą się od razu", () => {
    const s = new FootstepScheduler();
    const r = walk(s, 3.2, 3);
    expect(r.times[0]).toBeLessThan(0.5);
    expect(walk(s, 0, 1).steps).toBe(0);
    expect(s.walking).toBe(false);
    expect(walk(s, 3.2, 1).steps).toBeGreaterThanOrEqual(1);
  });

  it("zamrożenie ruchu (dialog, okno, pauza) wycisza kroki, a teleportacja nie jest krokiem", () => {
    expect(walk(new FootstepScheduler(), 3.2, 10, { frozen: true }).steps).toBe(0);
    expect(new FootstepScheduler().update(50, 0.05, false)).toBe(false);
  });

  it("limit częstotliwości: nawet przy skokach prędkości odstęp między krokami nie spada poniżej minimum", () => {
    const s = new FootstepScheduler();
    const times: number[] = [];
    let now = 0;
    for (let i = 0; i < 400; i++) {
      const dt = 0.01;
      now += dt;
      if (s.update(0.2, dt, false)) times.push(now);
    }
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(PLAYER_STRIDE.minInterval - 1e-9);
  });

  it("kroki biegu są oznaczone jako bieg", () => {
    const s = new FootstepScheduler();
    for (let i = 0; i < 40; i++) s.update(0.28, 0.05, false);
    expect(s.running).toBe(true);
    expect(walk(new FootstepScheduler(), 3.2, 2).steps).toBeGreaterThan(0);
  });
});

describe("StepVoicing (losowanie próbek i zmienność)", () => {
  it("używa wszystkich czterech próbek, nigdy tej samej dwa razy z rzędu", () => {
    const v = new StepVoicing(mulberry32(3), PLAYER_VARIATION);
    const seq = Array.from({ length: 800 }, () => v.next("p", 4, false).sample);
    expect(new Set(seq)).toEqual(new Set([0, 1, 2, 3]));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it("pierwsza próbka nie jest zawsze ta sama", () => {
    const firsts = new Set(Array.from({ length: 30 }, (_, seed) => new StepVoicing(mulberry32(seed + 1), PLAYER_VARIATION).next("p", 4, false).sample));
    expect(firsts.size).toBeGreaterThan(1);
  });

  it("zmienność gracza: tempo 0,96-1,04, głośność +-8%; bieg głośniejszy", () => {
    const v = new StepVoicing(mulberry32(5), PLAYER_VARIATION);
    const walkEvents = Array.from({ length: 400 }, () => v.next("p", 4, false));
    for (const e of walkEvents) {
      expect(e.rate).toBeGreaterThanOrEqual(0.96);
      expect(e.rate).toBeLessThanOrEqual(1.04);
      expect(e.gain).toBeGreaterThanOrEqual(0.92 - 1e-9);
      expect(e.gain).toBeLessThanOrEqual(1.08 + 1e-9);
    }
    expect(new Set(walkEvents.map((e) => e.rate.toFixed(3))).size).toBeGreaterThan(50);
    const runEvents = Array.from({ length: 400 }, () => v.next("p", 4, true));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(runEvents.map((e) => e.gain))).toBeGreaterThan(mean(walkEvents.map((e) => e.gain)));
  });

  it("troll jest cięższy: niższe tempo próbek (0,90-0,98) niż gracz", () => {
    const v = new StepVoicing(mulberry32(5), NPC_VARIATION);
    for (let i = 0; i < 300; i++) {
      const e = v.next("p", 4, false);
      expect(e.rate).toBeGreaterThanOrEqual(0.9);
      expect(e.rate).toBeLessThanOrEqual(0.98);
    }
  });

  it("dwa głosowania z różnych generatorów są niezależne: wzajemne losowania nie zmieniają sekwencji", () => {
    const alone = new StepVoicing(mulberry32(11), NPC_VARIATION);
    const aloneSeq = Array.from({ length: 50 }, () => alone.next("p", 4, false).sample);
    const a = new StepVoicing(mulberry32(11), NPC_VARIATION);
    const b = new StepVoicing(mulberry32(99), PLAYER_VARIATION);
    const mixed: number[] = [];
    for (let i = 0; i < 50; i++) {
      b.next("p", 4, false);
      b.next("p", 4, true);
      mixed.push(a.next("p", 4, false).sample);
    }
    expect(mixed).toEqual(aloneSeq);
  });
});

describe("model dźwięku trolla (odległość)", () => {
  it("0-3 m bez tłumienia, 3-10 m stopniowo, 10-25 m wyraźnie ciszej, >30-40 m praktycznie niesłyszalnie", () => {
    expect(npcStepGain(0)).toBeCloseTo(1, 5);
    expect(npcStepGain(3)).toBeCloseTo(1, 5);
    let prev = 1;
    for (const d of [4, 6, 8, 10, 15, 20, 25, 30, 35, 39.9]) {
      const g = npcStepGain(d);
      expect(g).toBeLessThan(prev);
      prev = g;
    }
    expect(npcStepGain(10)).toBeLessThan(0.45);
    expect(npcStepGain(10)).toBeGreaterThan(0.25);
    expect(npcStepGain(25)).toBeLessThan(0.15);
    expect(npcStepAttenuationDb(35)).toBeLessThan(-30);
    expect(npcStepGain(NPC_STEP_SOUND.cullDistance)).toBe(0);
    expect(npcStepGain(80)).toBe(0);
  });

  it("końcowe wygaszenie zaczyna się dopiero daleko i jest ciągłe", () => {
    expect(npcStepFade(NPC_STEP_SOUND.fadeStart)).toBe(1);
    expect(npcStepFade(NPC_STEP_SOUND.cullDistance)).toBe(0);
    expect(npcStepFade(34)).toBeGreaterThan(0);
    expect(npcStepFade(34)).toBeLessThan(1);
  });

  it("dalsze kroki są ciemniejsze (filtr dolnoprzepustowy), ale nie poniżej minimum", () => {
    expect(npcStepLowpass(2)).toBeGreaterThan(npcStepLowpass(20));
    expect(npcStepLowpass(500)).toBe(NPC_STEP_SOUND.lowpass.min);
  });
});
