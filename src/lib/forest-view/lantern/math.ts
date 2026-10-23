import { kelvinToRgb } from "../bridgeLamps";
import { cutoffOf, type LanternConfig } from "./config";

/**
 * Czysta matematyka lampy naftowej (bez Three.js i bez DOM): zanik światła, strefy LOD, migotanie, widoczność
 * blasku z daleka i zasłanianie przez teren. Wszystko deterministyczne i testowalne w Node.
 */

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Rgb = readonly [number, number, number];

// ---------------------------------------------------------------- zanik światła

/** Okno wygaszania three.js: `(1 - (d/c)^4)^2`, równe 1 przy źródle, 0 na `cutoff` i bez załamania (gładkie, brak twardej krawędzi). */
export function distanceWindow(distance: number, cutoff: number): number {
  if (!(cutoff > 0)) return 1;
  if (distance >= cutoff) return 0;
  const r = Math.max(0, distance) / cutoff;
  const w = 1 - r * r * r * r;
  return w * w;
}

/**
 * Natężenie oświetlenia powierzchni (jednostki sceny) w odległości `distance` od płomienia. To dokładnie ten sam wzór,
 * który liczy shader `PointLight` w three.js (`I / d^decay * okno`), z `I = intensity * referenceDistance^decay`,
 * więc w `referenceDistance` (bez okna) wynik to `intensity`.
 */
export function lanternIrradiance(distance: number, cfg: Pick<LanternConfig, "intensity" | "referenceDistance" | "decay" | "radius" | "fadeReach">): number {
  const candela = cfg.intensity * Math.pow(cfg.referenceDistance, cfg.decay);
  const falloff = 1 / Math.max(Math.pow(Math.max(distance, 0), cfg.decay), 0.01);
  return candela * falloff * distanceWindow(distance, cutoffOf(cfg));
}

// ---------------------------------------------------------------- LOD

export type LanternLod = "near" | "mid" | "far";

type LodCfg = Pick<LanternConfig, "nearDistance" | "midDistance" | "midLightScale">;

/** NEAR: do `nearDistance` (pełne światło, opcjonalne cienie); MID: do `midDistance`; FAR: dalej (sam blask, bez PointLight i cieni). */
export function lanternLod(distance: number, cfg: Pick<LanternConfig, "nearDistance" | "midDistance">): LanternLod {
  if (distance <= cfg.nearDistance) return "near";
  if (distance <= cfg.midDistance) return "mid";
  return "far";
}

/** Szerokość pasma, w którym światło strefy MID gaśnie do zera tuż za `midDistance` (bez nagłego znikania). */
export function lightFadeBand(cfg: Pick<LanternConfig, "midDistance">): number {
  return Math.max(2, cfg.midDistance * 0.15);
}

/**
 * Mnożnik jasności rzeczywistego światła zależny od odległości od kamery: 1 w NEAR, płynnie do `midLightScale` w MID,
 * potem do zera w krótkim paśmie za MID. Dalej 0, czyli lampa nie zajmuje już żadnego `PointLight`.
 */
export function lightScaleAt(distance: number, cfg: LodCfg): number {
  if (distance <= cfg.nearDistance) return 1;
  if (distance <= cfg.midDistance) return lerp(1, cfg.midLightScale, smooth((distance - cfg.nearDistance) / (cfg.midDistance - cfg.nearDistance)));
  const band = lightFadeBand(cfg);
  if (distance >= cfg.midDistance + band) return 0;
  return cfg.midLightScale * (1 - smooth((distance - cfg.midDistance) / band));
}

export type LightCandidate = { id: string; distance: number; scale: number; priority: boolean };

/**
 * Wybiera, które lampy dostają rzeczywiste światło: tylko te z dodatnim mnożnikiem, lokalna (priorytet) pierwsza,
 * potem według odległości (przy remisie według identyfikatora, więc wynik jest stabilny), najwyżej `max` sztuk.
 */
export function selectLightCandidates(candidates: readonly LightCandidate[], max: number): LightCandidate[] {
  const cap = Math.max(0, Math.floor(max));
  return candidates
    .filter((c) => c.scale > 0.001)
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, cap);
}

// ---------------------------------------------------------------- migotanie

const frac = (v: number) => v - Math.floor(v);

/**
 * Nieregularny, ciągły szum w zakresie [-1, 1] (suma trzech sinusów o niewspółmiernych częstotliwościach, amplitudy
 * 0,5 + 0,3 + 0,2, więc nigdy nie wychodzi poza zakres). `time` w sekundach pomnożonych przez prędkość migotania,
 * `seed` rozsynchronizowuje lampy różnych graczy. Liczone lokalnie, nigdy nie wysyłane przez sieć.
 */
export function flickerNoise(time: number, seed: number, channel = 0): number {
  const p = frac(seed * 0.618034 + channel * 0.37) * TAU;
  const f = channel === 0 ? [0.9, 2.3, 5.1] : [0.5, 1.7, 3.9];
  return 0.5 * Math.sin(time * TAU * f[0] + p) + 0.3 * Math.sin(time * TAU * f[1] + p * 1.7 + 1.3) + 0.2 * Math.sin(time * TAU * f[2] + p * 2.9 + 2.1);
}

export type FlickerSample = { intensity: number; colorShift: number };

/** Mnożnik natężenia (około 1, nigdy poniżej 0,5) i przesunięcie barwy w [-1, 1] (0 przy wyłączonym migotaniu). */
export function flickerSample(time: number, seed: number, cfg: Pick<LanternConfig, "flickerEnabled" | "flickerSpeed" | "flickerIntensity" | "flickerColorVariation">): FlickerSample {
  if (!cfg.flickerEnabled) return { intensity: 1, colorShift: 0 };
  const t = time * cfg.flickerSpeed;
  return {
    intensity: Math.max(0.5, 1 + cfg.flickerIntensity * flickerNoise(t, seed, 0)),
    colorShift: cfg.flickerColorVariation * flickerNoise(t, seed, 1),
  };
}

const hexToRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

/** Bazowa barwa światła (sRGB 0-1): z temperatury albo z koloru wprost. */
export function baseLightColor(cfg: Pick<LanternConfig, "useTemperature" | "temperatureK" | "lightColor">): Rgb {
  if (cfg.useTemperature) {
    const c = kelvinToRgb(cfg.temperatureK);
    return [c.r, c.g, c.b];
  }
  return hexToRgb(cfg.lightColor);
}

/** Subtelna zmiana odcienia: dodatni `shift` ociepla (mniej zieleni i błękitu), ujemny lekko rozjaśnia ku żółci. Wynik zawsze w [0, 1]. */
export function shiftWarmth(rgb: Rgb, shift: number): Rgb {
  const s = clamp(shift, -1, 1);
  return [rgb[0], clamp(rgb[1] * (1 - 0.18 * s), 0, 1), clamp(rgb[2] * (1 - 0.45 * s), 0, 1)];
}

// ---------------------------------------------------------------- blask z daleka

/** Najmniejsza widoczność blasku w pełnym dniu (lampa działa o każdej porze, ale w dzień ledwo ją widać). */
export const DAY_GLOW_FLOOR = 0.25;
/** Górna granica średnicy blasku na ekranie (px), żeby bliski halos nie zasłaniał widoku. */
export const GLOW_MAX_PIXELS = 160;

export const nightFactor = (daylight: number) => DAY_GLOW_FLOOR + (1 - DAY_GLOW_FLOOR) * (1 - clamp(daylight, 0, 1));

type FarCfg = Pick<LanternConfig, "farGlowEnabled" | "farGlowMaxDistance" | "farGlowFadeStart" | "farGlowFadeEnd" | "midDistance">;

/**
 * Widoczność blasku zależna tylko od odległości, 0..1. Do `farGlowFadeStart` pełna, potem liniowo słabnie do
 * `farGlowFadeEnd`; powyżej `farGlowMaxDistance` blask jest wyłączony (z krótkim wygaszeniem ostatnich 10% zasięgu,
 * żeby nie znikał skokowo). Przy wyłączonym `farGlowEnabled` blask kończy się na strefie MID.
 */
export function glowDistanceFactor(distance: number, cfg: FarCfg): number {
  const max = cfg.farGlowEnabled ? cfg.farGlowMaxDistance : cfg.midDistance;
  if (distance >= max) return 0;
  const fade = 1 - clamp((distance - cfg.farGlowFadeStart) / Math.max(1, cfg.farGlowFadeEnd - cfg.farGlowFadeStart), 0, 1);
  const taper = clamp((max - distance) / (0.1 * max), 0, 1);
  return fade * taper;
}

/** Współczynnik mgły (przepuszczalność `FogExp2`) przeskalowany `fogInteraction`: 1 = brak wpływu mgły, spada ku przepuszczalności. */
export function fogGlowFactor(distance: number, fogDensity: number, fogInteraction: number): number {
  const transmittance = Math.exp(-Math.pow(Math.max(0, fogDensity) * Math.max(0, distance), 2));
  return lerp(1, transmittance, clamp(fogInteraction, 0, 1));
}

export type GlowInput = {
  distance: number;
  daylight: number;
  fogDensity: number;
  /** Płynna widoczność względem terenu, 1 = bez przeszkód, 0 = za wzgórzem. */
  occlusion: number;
  /** Mnożnik migotania blasku (około 1). */
  flicker: number;
};

/** Końcowa nieprzezroczystość sprite'a blasku (0..1). */
export function glowOpacity(cfg: FarCfg & Pick<LanternConfig, "glowOpacity" | "fogInteraction">, g: GlowInput): number {
  const o = cfg.glowOpacity * glowDistanceFactor(g.distance, cfg) * nightFactor(g.daylight) * fogGlowFactor(g.distance, g.fogDensity, cfg.fogInteraction) * clamp(g.occlusion, 0, 1) * g.flicker;
  return clamp(o, 0, 1);
}

/** Rozmiar boku sprite'a w metrach świata: nie mniej niż `farGlowMinPixelSize` px na ekranie i nie więcej niż `GLOW_MAX_PIXELS`. */
export function glowWorldSize(distance: number, cfg: Pick<LanternConfig, "glowSize" | "farGlowMinPixelSize">, pixelWorld: number): number {
  const perPixel = Math.max(0, pixelWorld) * Math.max(distance, 0.01);
  const wanted = Math.max(cfg.glowSize, cfg.farGlowMinPixelSize * perPixel);
  return Math.min(wanted, Math.max(GLOW_MAX_PIXELS * perPixel, cfg.farGlowMinPixelSize * perPixel));
}

/** Rozmiar jednego piksela ekranu w metrach na 1 m odległości: `2 tan(fov/2) / wysokość widoku`. */
export function pixelWorldAt1m(fovRad: number, viewportHeightPx: number): number {
  return (2 * Math.tan(fovRad / 2)) / Math.max(1, viewportHeightPx);
}

/** Wygładzenie wykładnicze niezależne od liczby klatek na sekundę. */
export function approach(current: number, target: number, dt: number, rate: number): number {
  return target + (current - target) * Math.exp(-Math.max(0, rate) * Math.max(0, dt));
}

// ---------------------------------------------------------------- teren

export type Vec3 = { x: number; y: number; z: number };

/**
 * Czy teren zasłania linię od obserwatora do płomienia: próbkuje wysokość terenu co ~`step` metrów (nie więcej niż
 * `maxSamples`) i sprawdza, czy leży powyżej linii wzroku. Końce odcinka są pomijane, żeby sam grunt pod lampą
 * lub kamerą nie liczył się jako przeszkoda. Drzewa i skały obsługuje test głębi karty graficznej.
 */
export function terrainBlocks(from: Vec3, to: Vec3, heightAt: (x: number, z: number) => number, step = 3, maxSamples = 48): boolean {
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (len < step * 2) return false;
  const n = Math.min(maxSamples, Math.max(2, Math.ceil(len / step)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (t < 0.03 || t > 0.97) continue;
    const x = lerp(from.x, to.x, t);
    const z = lerp(from.z, to.z, t);
    const y = lerp(from.y, to.y, t);
    if (heightAt(x, z) > y) return true;
  }
  return false;
}

// ---------------------------------------------------------------- mocowanie

export type AttachTransform = {
  position: readonly [number, number, number];
  /** Obrót Eulera (rad, kolejność XYZ). */
  rotation: readonly [number, number, number];
  scale: number;
};

/**
 * Transformacja lampy względem kości dłoni. Model szkieletu jest skalowany (kości dziedziczą skalę), więc przesunięcie
 * i skalę dzielimy przez `parentScale`, żeby lampa miała rozmiar zadany w metrach niezależnie od skali postaci.
 */
export function attachTransform(cfg: Pick<LanternConfig, "attachX" | "attachY" | "attachZ" | "attachRotX" | "attachRotY" | "attachRotZ" | "attachScale">, parentScale: number): AttachTransform {
  const k = parentScale > 1e-6 ? 1 / parentScale : 1;
  const rad = Math.PI / 180;
  return {
    position: [cfg.attachX * k, cfg.attachY * k, cfg.attachZ * k],
    rotation: [cfg.attachRotX * rad, cfg.attachRotY * rad, cfg.attachRotZ * rad],
    scale: cfg.attachScale * k,
  };
}
