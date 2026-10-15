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

const KEYS: readonly Key[] = [
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

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: Rgb, b: Rgb, t: number): Rgb => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (t: number) => t * t * (3 - 2 * t);

export const DEFAULT_HOUR = 10.5;

/** Wysokość słońca nad horyzontem (stopnie) o danej godzinie: 6:00 wschód, 18:00 zachód, maks. ok. 58 stopni. */
export function sunElevationDeg(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return 58 * Math.sin(((h - 6) / 12) * Math.PI);
}

/** Nocą ten sam kierunek służy za światło księżyca (kolor i natężenie z tabeli kluczy), więc nigdy nie schodzi poniżej ok. 6 stopni. */
export function sunDirection(hour: number): [number, number, number] {
  const h = ((hour % 24) + 24) % 24;
  const el = (Math.max(Math.abs(sunElevationDeg(h)), 6) * Math.PI) / 180;
  const azimuth = ((h - 6) / 12) * Math.PI;
  const x = Math.cos(el) * Math.cos(azimuth + 0.6);
  const z = Math.cos(el) * Math.sin(azimuth + 0.6) * -1;
  return [x, Math.sin(el), z];
}

export function atmosphereAt(hourIn: number): AtmosphereState {
  const hour = ((hourIn % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth((hour - a.h) / (b.h - a.h));
  const elevation = sunElevationDeg(hour);
  return {
    hour,
    sunDir: sunDirection(hour),
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
