/**
 * Wykrywanie pojedynczych kroków w nagraniu (używane przez potok `npm run assets:audio`; tylko składnia usuwalna
 * przez `--experimental-strip-types`, bo skrypt importuje ten plik bezpośrednio).
 * Plik z jednym krokiem daje jeden segment, sekwencja kroków daje po jednym segmencie na krok.
 */

export type StepSegment = { start: number; end: number };

export type OnsetOptions = {
  /** Okno obwiedni (s). */
  windowSeconds?: number;
  /** Próg początku względem szczytu całego nagrania. */
  startRatio?: number;
  /** Próg końca względem szczytu bieżącego segmentu. */
  endRatio?: number;
  /** Minimalny odstęp między początkami kroków (s). */
  minGapSeconds?: number;
  /** Najdłuższy pojedynczy krok (s). */
  maxStepSeconds?: number;
  /** Zapas przed początkiem kroku (s). */
  preRollSeconds?: number;
};

export type StepAnalysis = { kind: "single" | "sequence" | "silent"; segments: StepSegment[] };

/** Obwiednia RMS (po jednym punkcie na okno). */
export function rmsEnvelope(samples: Float32Array, sampleRate: number, windowSeconds: number): { env: Float32Array; hop: number } {
  const hop = Math.max(1, Math.round(sampleRate * windowSeconds));
  const count = Math.ceil(samples.length / hop);
  const env = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    const from = i * hop;
    const to = Math.min(samples.length, from + hop);
    for (let j = from; j < to; j++) sum += samples[j] * samples[j];
    env[i] = Math.sqrt(sum / Math.max(1, to - from));
  }
  return { env, hop };
}

export function detectSteps(samples: Float32Array, sampleRate: number, options: OnsetOptions = {}): StepAnalysis {
  const { windowSeconds = 0.01, startRatio = 0.2, endRatio = 0.12, minGapSeconds = 0.18, maxStepSeconds = 0.6, preRollSeconds = 0.015 } = options;
  const { env, hop } = rmsEnvelope(samples, sampleRate, windowSeconds);
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  if (peak < 1e-4) return { kind: "silent", segments: [] };

  const startThreshold = peak * startRatio;
  const minGap = Math.max(1, Math.round(minGapSeconds / windowSeconds));
  const maxLen = Math.max(1, Math.round(maxStepSeconds / windowSeconds));
  const duration = samples.length / sampleRate;
  const segments: StepSegment[] = [];

  let i = 0;
  while (i < env.length) {
    if (env[i] < startThreshold) {
      i++;
      continue;
    }
    const begin = i;
    let segPeak = env[i];
    let end = i;
    while (end < env.length && end - begin < maxLen) {
      segPeak = Math.max(segPeak, env[end]);
      if (env[end] < segPeak * endRatio && end > begin + 1) break;
      end++;
    }
    const start = Math.max(0, (begin * hop) / sampleRate - preRollSeconds);
    segments.push({ start: round(start), end: round(Math.min(duration, (end * hop) / sampleRate)) });
    i = Math.max(end, begin + minGap);
  }

  if (segments.length === 0) return { kind: "silent", segments: [] };
  return { kind: segments.length === 1 ? "single" : "sequence", segments };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
