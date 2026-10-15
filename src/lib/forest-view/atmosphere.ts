/**
 * Pora dnia -> światło, niebo i mgła (czyste dane, bez Three.js). Kolory w sRGB 0-1.
 * Zakres kluczy jest dobrany pod miękki, lekko baśniowy las: ciepłe słońce, chłodniejsze cienie, jasna zielonkawa mgiełka.
 */
export type Rgb = readonly [number, number, number];

export type AtmosphereState = {
  hour: number;
  /** Kierunek DO słońca (wektor jednostkowy; y > 0 = nad horyzontem). Przy zachodzie przechodzi na księżyc. */
  sunDir: readonly [number, number, number];
  sunColor: Rgb;
  sunIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  fogColor: Rgb;
  /** Mnożnik gęstości mgły (poranek gęstszy, południe rzadsze). */
  fogDensity: number;
  skyZenith: Rgb;
  skyHorizon: Rgb;
  exposure: number;
  /** 0 w nocy, 1 w dzień: steruje cząstkami i blaskiem słońca. */
  daylight: number;
};

type Key = {
  h: number;
  sun: Rgb;
  sunI: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiI: number;
  fog: Rgb;
  fogK: number;
  zenith: Rgb;
  horizon: Rgb;
  exposure: number;
};

const KEYS_V2A: readonly Key[] = [
  { h: 0, sun: [0.55, 0.65, 1], sunI: 0.35, hemiSky: [0.22, 0.3, 0.5], hemiGround: [0.08, 0.1, 0.12], hemiI: 0.55, fog: [0.1, 0.14, 0.22], fogK: 1.1, zenith: [0.02, 0.05, 0.14], horizon: [0.1, 0.15, 0.25], exposure: 1.0 },
  { h: 5, sun: [0.6, 0.65, 1], sunI: 0.4, hemiSky: [0.25, 0.32, 0.5], hemiGround: [0.09, 0.11, 0.12], hemiI: 0.6, fog: [0.16, 0.2, 0.3], fogK: 1.2, zenith: [0.06, 0.1, 0.24], horizon: [0.3, 0.3, 0.4], exposure: 1.0 },
  { h: 6.5, sun: [1, 0.62, 0.38], sunI: 1.6, hemiSky: [0.45, 0.5, 0.62], hemiGround: [0.22, 0.2, 0.15], hemiI: 0.75, fog: [0.78, 0.7, 0.62], fogK: 1.5, zenith: [0.32, 0.46, 0.7], horizon: [0.95, 0.74, 0.56], exposure: 1.0 },
  { h: 8, sun: [1, 0.86, 0.66], sunI: 2.5, hemiSky: [0.55, 0.68, 0.85], hemiGround: [0.3, 0.3, 0.2], hemiI: 0.9, fog: [0.78, 0.84, 0.82], fogK: 1.3, zenith: [0.28, 0.5, 0.82], horizon: [0.78, 0.86, 0.9], exposure: 1.0 },
  { h: 12, sun: [1, 0.95, 0.84], sunI: 3.0, hemiSky: [0.55, 0.72, 0.95], hemiGround: [0.3, 0.32, 0.2], hemiI: 1.0, fog: [0.74, 0.86, 0.9], fogK: 0.9, zenith: [0.2, 0.46, 0.85], horizon: [0.72, 0.86, 0.94], exposure: 1.0 },
  { h: 16.5, sun: [1, 0.88, 0.7], sunI: 2.7, hemiSky: [0.55, 0.68, 0.9], hemiGround: [0.3, 0.3, 0.2], hemiI: 0.95, fog: [0.78, 0.84, 0.82], fogK: 1.0, zenith: [0.24, 0.46, 0.82], horizon: [0.8, 0.84, 0.82], exposure: 1.0 },
  { h: 19, sun: [1, 0.64, 0.36], sunI: 1.8, hemiSky: [0.5, 0.52, 0.66], hemiGround: [0.24, 0.2, 0.15], hemiI: 0.75, fog: [0.86, 0.68, 0.55], fogK: 1.3, zenith: [0.28, 0.36, 0.62], horizon: [1, 0.64, 0.42], exposure: 1.0 },
  { h: 20.5, sun: [0.75, 0.5, 0.6], sunI: 0.7, hemiSky: [0.34, 0.36, 0.56], hemiGround: [0.14, 0.13, 0.14], hemiI: 0.6, fog: [0.42, 0.36, 0.46], fogK: 1.3, zenith: [0.1, 0.14, 0.34], horizon: [0.55, 0.38, 0.45], exposure: 1.0 },
  { h: 22, sun: [0.55, 0.65, 1], sunI: 0.35, hemiSky: [0.22, 0.3, 0.5], hemiGround: [0.08, 0.1, 0.12], hemiI: 0.55, fog: [0.1, 0.14, 0.22], fogK: 1.1, zenith: [0.02, 0.05, 0.14], horizon: [0.1, 0.15, 0.25], exposure: 1.0 },
  { h: 24, sun: [0.55, 0.65, 1], sunI: 0.35, hemiSky: [0.22, 0.3, 0.5], hemiGround: [0.08, 0.1, 0.12], hemiI: 0.55, fog: [0.1, 0.14, 0.22], fogK: 1.1, zenith: [0.02, 0.05, 0.14], horizon: [0.1, 0.15, 0.25], exposure: 1.0 },
];

/**
 * Tabela V2b ("lato"): dłuższy dzień (wschód 5:00, zachód 21:00), więc 7:00 i 19:00 to złota godzina ze słońcem ok. 21 stopni,
 * a nie nocne światło. Cienie dostają jaśniejsze, chłodniejsze światło z nieba i ciepłe odbicie od ziemi.
 */
const KEYS_SUMMER: readonly Key[] = [
  { h: 0, sun: [0.55, 0.65, 1], sunI: 0.4, hemiSky: [0.26, 0.34, 0.56], hemiGround: [0.1, 0.12, 0.14], hemiI: 0.7, fog: [0.12, 0.17, 0.26], fogK: 1.1, zenith: [0.02, 0.05, 0.14], horizon: [0.1, 0.15, 0.25], exposure: 1.0 },
  { h: 4.25, sun: [0.6, 0.66, 1], sunI: 0.45, hemiSky: [0.3, 0.38, 0.58], hemiGround: [0.12, 0.13, 0.14], hemiI: 0.75, fog: [0.2, 0.25, 0.36], fogK: 1.2, zenith: [0.08, 0.12, 0.28], horizon: [0.34, 0.34, 0.46], exposure: 1.0 },
  { h: 5.5, sun: [1, 0.66, 0.42], sunI: 1.7, hemiSky: [0.5, 0.56, 0.7], hemiGround: [0.3, 0.27, 0.2], hemiI: 1.0, fog: [0.82, 0.74, 0.66], fogK: 1.5, zenith: [0.34, 0.48, 0.72], horizon: [0.96, 0.76, 0.58], exposure: 1.0 },
  { h: 7, sun: [1, 0.84, 0.62], sunI: 2.6, hemiSky: [0.62, 0.74, 0.92], hemiGround: [0.42, 0.38, 0.26], hemiI: 1.3, fog: [0.82, 0.84, 0.78], fogK: 1.35, zenith: [0.32, 0.54, 0.84], horizon: [0.9, 0.82, 0.68], exposure: 1.0 },
  { h: 9.5, sun: [1, 0.93, 0.8], sunI: 2.9, hemiSky: [0.6, 0.75, 0.96], hemiGround: [0.4, 0.37, 0.25], hemiI: 1.2, fog: [0.78, 0.87, 0.88], fogK: 1.0, zenith: [0.24, 0.5, 0.85], horizon: [0.78, 0.88, 0.92], exposure: 1.0 },
  { h: 12, sun: [1, 0.96, 0.86], sunI: 3.0, hemiSky: [0.6, 0.76, 0.97], hemiGround: [0.4, 0.38, 0.26], hemiI: 1.2, fog: [0.76, 0.88, 0.9], fogK: 0.85, zenith: [0.2, 0.47, 0.86], horizon: [0.74, 0.87, 0.95], exposure: 1.0 },
  { h: 16, sun: [1, 0.92, 0.78], sunI: 2.9, hemiSky: [0.6, 0.74, 0.95], hemiGround: [0.4, 0.37, 0.25], hemiI: 1.2, fog: [0.8, 0.86, 0.84], fogK: 0.95, zenith: [0.24, 0.48, 0.84], horizon: [0.82, 0.86, 0.86], exposure: 1.0 },
  { h: 19, sun: [1, 0.74, 0.46], sunI: 2.6, hemiSky: [0.6, 0.64, 0.82], hemiGround: [0.4, 0.32, 0.22], hemiI: 1.25, fog: [0.9, 0.76, 0.62], fogK: 1.25, zenith: [0.3, 0.4, 0.68], horizon: [1, 0.72, 0.5], exposure: 1.0 },
  { h: 20.4, sun: [1, 0.56, 0.36], sunI: 1.4, hemiSky: [0.46, 0.46, 0.64], hemiGround: [0.26, 0.2, 0.17], hemiI: 0.85, fog: [0.74, 0.54, 0.5], fogK: 1.35, zenith: [0.2, 0.26, 0.52], horizon: [0.96, 0.56, 0.42], exposure: 1.0 },
  { h: 21.6, sun: [0.7, 0.55, 0.75], sunI: 0.6, hemiSky: [0.34, 0.36, 0.58], hemiGround: [0.16, 0.15, 0.16], hemiI: 0.75, fog: [0.34, 0.3, 0.42], fogK: 1.3, zenith: [0.08, 0.12, 0.3], horizon: [0.45, 0.32, 0.44], exposure: 1.0 },
  { h: 23, sun: [0.55, 0.65, 1], sunI: 0.4, hemiSky: [0.26, 0.34, 0.56], hemiGround: [0.1, 0.12, 0.14], hemiI: 0.7, fog: [0.12, 0.17, 0.26], fogK: 1.1, zenith: [0.02, 0.05, 0.14], horizon: [0.1, 0.15, 0.25], exposure: 1.0 },
  { h: 24, sun: [0.55, 0.65, 1], sunI: 0.4, hemiSky: [0.26, 0.34, 0.56], hemiGround: [0.1, 0.12, 0.14], hemiI: 0.7, fog: [0.12, 0.17, 0.26], fogK: 1.1, zenith: [0.02, 0.05, 0.14], horizon: [0.1, 0.15, 0.25], exposure: 1.0 },
];

/** V2a: pierwotna krzywa i tabela (preset ORIGINAL). Summer: długi letni dzień (V2b). */
export type DayModel = "v2a" | "summer";

const MODELS: Record<DayModel, { keys: readonly Key[]; rise: number; span: number; peak: number }> = {
  v2a: { keys: KEYS_V2A, rise: 6, span: 12, peak: 58 },
  summer: { keys: KEYS_SUMMER, rise: 5, span: 16, peak: 56 },
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (t: number) => t * t * (3 - 2 * t);

export const DEFAULT_HOUR = 10.5;

/** Wysokość słońca nad horyzontem (stopnie): w modelu V2a 6:00-18:00 (maks. 58), w modelu letnim 5:00-21:00 (maks. 56). */
export function sunElevationDeg(hour: number, model: DayModel = "v2a"): number {
  const h = ((hour % 24) + 24) % 24;
  const m = MODELS[model];
  return m.peak * Math.sin(((h - m.rise) / m.span) * Math.PI);
}

/** Nocą ten sam kierunek służy za światło księżyca (kolor i natężenie z tabeli kluczy), więc nigdy nie schodzi poniżej ok. 6 stopni. */
export function sunDirection(hour: number, model: DayModel = "v2a"): [number, number, number] {
  const h = ((hour % 24) + 24) % 24;
  const m = MODELS[model];
  const el = (Math.max(Math.abs(sunElevationDeg(h, model)), 6) * Math.PI) / 180;
  const azimuth = ((h - m.rise) / m.span) * Math.PI;
  const x = Math.cos(el) * Math.cos(azimuth + 0.6);
  const z = Math.cos(el) * Math.sin(azimuth + 0.6) * -1;
  return [x, Math.sin(el), z];
}

export function atmosphereAt(hourIn: number, model: DayModel = "v2a"): AtmosphereState {
  const hour = ((hourIn % 24) + 24) % 24;
  const keys = MODELS[model].keys;
  let i = 0;
  while (i < keys.length - 2 && hour >= keys[i + 1].h) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = smooth((hour - a.h) / (b.h - a.h));
  const elevation = sunElevationDeg(hour, model);
  return {
    hour,
    sunDir: sunDirection(hour, model),
    sunColor: mix3(a.sun, b.sun, t),
    sunIntensity: mix(a.sunI, b.sunI, t),
    hemiSky: mix3(a.hemiSky, b.hemiSky, t),
    hemiGround: mix3(a.hemiGround, b.hemiGround, t),
    hemiIntensity: mix(a.hemiI, b.hemiI, t),
    fogColor: mix3(a.fog, b.fog, t),
    fogDensity: mix(a.fogK, b.fogK, t),
    skyZenith: mix3(a.zenith, b.zenith, t),
    skyHorizon: mix3(a.horizon, b.horizon, t),
    exposure: mix(a.exposure, b.exposure, t),
    daylight: Math.min(1, Math.max(0, (elevation + 4) / 14)),
  };
}
