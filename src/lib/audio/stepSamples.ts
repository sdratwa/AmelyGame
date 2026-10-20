/**
 * Analiza i przygotowanie próbek kroków (używane przez potok `npm run assets:audio`; tylko składnia usuwalna przez
 * `--experimental-strip-types`, bo skrypt importuje ten plik bezpośrednio). Czysta logika: bez Web Audio i bez plików.
 *
 * Dostarczone nagrania mają ok. 1 s, ale sam krok to początek, a reszta to wybrzmienie i szum tła. Analiza znajduje
 * uderzenie, przycina nagranie do kroku (z krótkim zapasem przed uderzeniem, żeby dźwięk zaczynał się razem ze zdarzeniem
 * STEP), mierzy głośność przyciętego kroku i wylicza stałą poprawkę poziomu (bez kompresji i bez limitera).
 */

export type StepCut = {
  /** Indeksy próbek w nagraniu źródłowym: początek i koniec przycięcia oraz uderzenie (maksimum obwiedni). */
  start: number;
  end: number;
  impact: number;
};

export type StepCutOptions = {
  /** Okno obwiedni (s). */
  windowSeconds?: number;
  /** Zapas przed uderzeniem (s). */
  preRollSeconds?: number;
  /** Uderzenia szukamy w tym początkowym fragmencie nagrania (s). */
  searchSeconds?: number;
  /** Koniec kroku: obwiednia poniżej szczytu o tyle dB (dłużej niż `holdSeconds`). */
  tailBelowDb?: number;
  holdSeconds?: number;
  minTailSeconds?: number;
  maxTailSeconds?: number;
};

export const STEP_CUT_DEFAULTS: Required<StepCutOptions> = {
  windowSeconds: 0.004,
  preRollSeconds: 0.015,
  searchSeconds: 0.35,
  tailBelowDb: 34,
  holdSeconds: 0.05,
  minTailSeconds: 0.22,
  maxTailSeconds: 0.5,
};

/** Mono z przeplecionych kanałów (średnia). */
export function toMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels === 1) return interleaved.slice();
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += interleaved[i * channels + c];
    out[i] = sum / channels;
  }
  return out;
}

/** Filtr górnoprzepustowy pierwszego rzędu (usuwa stałą i dudnienie, które nie są słyszalne jako krok). */
export function highPass(samples: Float32Array, sampleRate: number, hz = 80): Float32Array {
  const out = new Float32Array(samples.length);
  const a = Math.exp((-2 * Math.PI * hz) / sampleRate);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const y = a * (prevOut + samples[i] - prevIn);
    prevIn = samples[i];
    prevOut = y;
    out[i] = y;
  }
  return out;
}

/** Obwiednia RMS: jeden punkt na okno. */
export function envelope(samples: Float32Array, sampleRate: number, windowSeconds: number): { env: Float32Array; hop: number } {
  const hop = Math.max(1, Math.round(sampleRate * windowSeconds));
  const env = new Float32Array(Math.ceil(samples.length / hop));
  for (let w = 0; w < env.length; w++) {
    let sum = 0;
    const from = w * hop;
    const to = Math.min(samples.length, from + hop);
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    env[w] = Math.sqrt(sum / Math.max(1, to - from));
  }
  return { env, hop };
}

const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));

export const peakOf = (samples: Float32Array): number => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
};

/** Znajduje uderzenie kroku i przycina do niego nagranie (mono). Cisza zwraca cały zakres. */
export function findStepCut(mono: Float32Array, sampleRate: number, options: StepCutOptions = {}): StepCut {
  const o = { ...STEP_CUT_DEFAULTS, ...options };
  const { env, hop } = envelope(highPass(mono, sampleRate), sampleRate, o.windowSeconds);
  const searchWindows = Math.min(env.length, Math.max(1, Math.round(o.searchSeconds / o.windowSeconds)));
  let best = 0;
  for (let w = 1; w < searchWindows; w++) if (env[w] > env[best]) best = w;
  if (env[best] < 1e-7) return { start: 0, end: mono.length, impact: 0 };
  const impact = best * hop;
  const start = Math.max(0, impact - Math.round(o.preRollSeconds * sampleRate));
  const floor = env[best] * 10 ** (-o.tailBelowDb / 20);
  const hold = Math.max(1, Math.round(o.holdSeconds / o.windowSeconds));
  const minEnd = best + Math.round(o.minTailSeconds / o.windowSeconds);
  const maxEnd = Math.min(env.length, best + Math.round(o.maxTailSeconds / o.windowSeconds));
  let endWindow = maxEnd;
  for (let w = Math.max(best + 1, minEnd); w + hold <= maxEnd; w++) {
    let quiet = true;
    for (let k = 0; k < hold; k++) {
      if (env[w + k] > floor) {
        quiet = false;
        break;
      }
    }
    if (quiet) {
      endWindow = w;
      break;
    }
  }
  return { start, end: Math.min(mono.length, endWindow * hop), impact };
}

/** Wejście (krótkie) i wyjście (dłuższe, cosinusowe) przycięcia: bez trzasku na końcach, bez zmiany reszty. */
export function fadeEnds(samples: Float32Array, sampleRate: number, inSeconds = 0.003, outSeconds = 0.08): void {
  const n = samples.length;
  const fin = Math.min(Math.round(inSeconds * sampleRate), n >> 1);
  const fout = Math.min(Math.round(outSeconds * sampleRate), n >> 1);
  for (let i = 0; i < fin; i++) samples[i] *= i / fin;
  for (let i = 0; i < fout; i++) samples[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fout);
}

/** Głośność kroku: RMS po filtrze górnoprzepustowym (dBFS) i szczyt (dBFS). */
export function measureStep(samples: Float32Array, sampleRate: number): { rmsDb: number; peakDb: number } {
  const hp = highPass(samples, sampleRate);
  let sum = 0;
  for (let i = 0; i < hp.length; i++) sum += hp[i] * hp[i];
  return { rmsDb: 10 * Math.log10(Math.max(sum / Math.max(1, hp.length), 1e-18)), peakDb: toDb(peakOf(samples)) };
}

export type LevelPlan = {
  /** Stała poprawka (dB) dla każdej próbki, w kolejności wejścia. */
  gainDb: number[];
  /** Docelowy poziom RMS (dBFS) wspólny dla wszystkich próbek. */
  targetRmsDb: number;
};

/**
 * Wyrównanie poziomów: wszystkie próbki dostają ten sam RMS kroku. Cel wynika z próbki o największym stosunku szczytu do
 * RMS, tak aby żaden szczyt nie przekroczył `peakCeilingDb` (bez limitera i bez kompresji, czyli bez zmiany charakteru).
 */
export function planLevels(measures: readonly { rmsDb: number; peakDb: number }[], peakCeilingDb = -6): LevelPlan {
  const targetRmsDb = Math.min(...measures.map((m) => peakCeilingDb - (m.peakDb - m.rmsDb)));
  return { gainDb: measures.map((m) => targetRmsDb - m.rmsDb), targetRmsDb };
}
