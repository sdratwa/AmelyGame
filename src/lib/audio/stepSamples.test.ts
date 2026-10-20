import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fadeEnds, findStepCut, measureStep, peakOf, planLevels, toMono } from "./stepSamples";

const RATE = 48000;
const ROOT = path.resolve(__dirname, "../../..");

/** Krótki odgłos uderzenia (wykładniczo gasnący szum) na tle cichego szumu. */
function synthStep(amplitude: number, impactAt = 0.12, seconds = 1, seed = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let a = seed >>> 0;
  const noise = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 2147483648 - 1;
  };
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE - impactAt;
    out[i] = noise() * 0.0003 + (t >= 0 ? noise() * amplitude * Math.exp(-t * 28) : 0);
  }
  return out;
}

function readWav16(file: string): { channels: number; samples: Float32Array } {
  const buf = fs.readFileSync(file);
  const channels = buf.readUInt16LE(22);
  let at = 12;
  while (at < buf.length - 8) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") {
      const count = Math.floor(Math.min(size, buf.length - at - 8) / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(at + 8 + i * 2) / 32768;
      return { channels, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("brak bloku data");
}

describe("analiza próbek kroków", () => {
  it("znajduje uderzenie i przycina nagranie do kroku z krótkim zapasem przed nim", () => {
    const mono = synthStep(0.2);
    const cut = findStepCut(mono, RATE);
    expect(cut.impact / RATE).toBeGreaterThan(0.11);
    expect(cut.impact / RATE).toBeLessThan(0.15);
    expect((cut.impact - cut.start) / RATE).toBeCloseTo(0.015, 2);
    expect((cut.end - cut.start) / RATE).toBeLessThanOrEqual(0.52);
    expect((cut.end - cut.start) / RATE).toBeGreaterThan(0.2);
  });

  it("ciche nagranie bez uderzenia zwraca cały zakres", () => {
    const cut = findStepCut(new Float32Array(RATE), RATE);
    expect(cut).toEqual({ start: 0, end: RATE, impact: 0 });
  });

  it("downmix do mono uśrednia kanały", () => {
    const stereo = new Float32Array([1, 0, 0.5, 0.5]);
    expect(Array.from(toMono(stereo, 2))).toEqual([0.5, 0.5]);
    expect(Array.from(toMono(new Float32Array([0.25, 0.5]), 1))).toEqual([0.25, 0.5]);
  });

  it("plan poziomów wyrównuje RMS do wspólnego celu bez przekroczenia sufitu szczytów", () => {
    const measures = [
      { rmsDb: -50, peakDb: -25 },
      { rmsDb: -42, peakDb: -20 },
      { rmsDb: -40, peakDb: -19 },
    ];
    const plan = planLevels(measures, -6);
    measures.forEach((m, i) => {
      expect(m.rmsDb + plan.gainDb[i]).toBeCloseTo(plan.targetRmsDb, 6);
      expect(m.peakDb + plan.gainDb[i]).toBeLessThanOrEqual(-6 + 1e-9);
    });
    expect(Math.max(...plan.gainDb) - Math.min(...plan.gainDb)).toBeGreaterThan(5);
  });

  it("po wyrównaniu różne głośności nagrań dają ten sam poziom kroku (+-0,1 dB), a szum tła nie rośnie ponad szum po wzmocnieniu", () => {
    const sources = [0.01, 0.04, 0.12].map((a, i) => synthStep(a, 0.12, 1, i + 1));
    const prepared = sources.map((mono) => {
      const cut = findStepCut(mono, RATE);
      const step = mono.slice(cut.start, cut.end);
      fadeEnds(step, RATE);
      return step;
    });
    const before = prepared.map((p) => measureStep(p, RATE));
    expect(Math.max(...before.map((m) => m.rmsDb)) - Math.min(...before.map((m) => m.rmsDb))).toBeGreaterThan(10);
    const plan = planLevels(before, -6);
    prepared.forEach((p, i) => {
      const g = 10 ** (plan.gainDb[i] / 20);
      for (let k = 0; k < p.length; k++) p[k] *= g;
    });
    const after = prepared.map((p) => measureStep(p, RATE));
    for (const m of after) {
      expect(m.rmsDb).toBeCloseTo(plan.targetRmsDb, 1);
      expect(m.peakDb).toBeLessThanOrEqual(-6 + 0.01);
    }
  });

  it("wejście i wyjście przycięcia są wygaszone (bez trzasku)", () => {
    const s = new Float32Array(RATE / 2).fill(0.5);
    fadeEnds(s, RATE);
    expect(s[0]).toBe(0);
    expect(Math.abs(s[s.length - 1])).toBeLessThan(1e-3);
    expect(s[RATE / 4]).toBe(0.5);
    expect(peakOf(s)).toBe(0.5);
  });
});

describe("dostarczone nagrania kroków (WAV)", () => {
  const dir = path.join(ROOT, "assets/source/audio/footsteps");
  const files = [1, 2, 3, 4].map((n) => path.join(dir, `light-footstep-${n}.wav`));

  it("są w materiałach źródłowych, a nie w zasobach publicznych", () => {
    for (const f of files) expect(fs.existsSync(f)).toBe(true);
    const publicFiles = fs.readdirSync(path.join(ROOT, "public/audio"));
    expect(publicFiles.some((f) => f.endsWith(".wav"))).toBe(false);
  });

  it("różnią się głośnością, a po analizie i stałej poprawce każdy krok ma ten sam RMS i szczyt poniżej -6 dBFS", () => {
    const steps = files.map((f) => {
      const wav = readWav16(f);
      const mono = toMono(wav.samples, wav.channels);
      const cut = findStepCut(mono, RATE);
      const step = mono.slice(cut.start, cut.end);
      fadeEnds(step, RATE);
      return { step, seconds: step.length / RATE };
    });
    for (const s of steps) {
      expect(s.seconds).toBeGreaterThan(0.2);
      expect(s.seconds).toBeLessThanOrEqual(0.52);
    }
    const before = steps.map((s) => measureStep(s.step, RATE));
    expect(Math.max(...before.map((m) => m.rmsDb)) - Math.min(...before.map((m) => m.rmsDb))).toBeGreaterThan(4);
    const plan = planLevels(before, -6);
    const after = steps.map((s, i) => {
      const g = 10 ** (plan.gainDb[i] / 20);
      return measureStep(s.step.map((x) => x * g), RATE);
    });
    for (const m of after) {
      expect(m.rmsDb).toBeCloseTo(plan.targetRmsDb, 1);
      expect(m.peakDb).toBeLessThanOrEqual(-6 + 0.01);
    }
  });
});
