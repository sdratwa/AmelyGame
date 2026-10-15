import { atmosphereAt, type Rgb } from "./atmosphere";
import { HUE_SWAP_TO_GREEN, STABLE_NORMAL } from "./disposition";
import { srgbToLinear, type MaterialGrade, type VisualConfig } from "./visual";

/**
 * Szacunek koloru piksela bez GPU: te same wzory co w shaderach Three.js (Lambert + półsfera + ACES), użyte do
 * kalibracji presetów i do testów regresji ("pnie czytelne w cieniu", "sosny nie są czarne"). To model uproszczony
 * (bez AO z wierzchołków, bez odbić, bez mgły), więc służy do porównań między presetami, nie jako ostateczny wygląd.
 */
export const REFERENCE_ALBEDO_SRGB: Readonly<Record<string, Rgb>> = {
  bark_normaltree: [140, 89, 67],
  bark_twistedtree: [85, 77, 72],
  leaves_pine: [50, 87, 0],
  leaves_normaltree: [88, 123, 1],
  leaves_twistedtree: [167, 23, 24],
  leaves: [115, 132, 46],
  grass: [110, 190, 0],
  rocks: [78, 89, 64],
  ground: [86, 112, 52],
};

const LUM: Rgb = [0.2126, 0.7152, 0.0722];
const lumOf = (c: Rgb) => c[0] * LUM[0] + c[1] * LUM[1] + c[2] * LUM[2];
const toLin = (c: Rgb): Rgb => [srgbToLinear(c[0] * 255), srgbToLinear(c[1] * 255), srgbToLinear(c[2] * 255)];
const refLin = (id: string): Rgb => {
  const c = REFERENCE_ALBEDO_SRGB[id];
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
};

/** Mirror korekty z shaderów (`grading.ts`): zamiana kanałów / tint, nasycenie, mnożnik albedo. Wejście i wyjście liniowe. */
export function gradeAlbedo(id: string, source: Rgb, grade: MaterialGrade, greenSaturation: number): Rgb {
  const l0 = lumOf(source);
  let c: Rgb = HUE_SWAP_TO_GREEN.has(id) ? [source[1], source[0], source[2]] : source;
  if (grade.tint) {
    const k = l0 / grade.tint.refLum;
    const t: Rgb = [grade.tint.color[0] * k, grade.tint.color[1] * k, grade.tint.color[2] * k];
    c = [c[0] + (t[0] - c[0]) * grade.tint.amount, c[1] + (t[1] - c[1]) * grade.tint.amount, c[2] + (t[2] - c[2]) * grade.tint.amount];
  }
  const l = lumOf(c);
  const greenness = Math.min(1, Math.max(0, ((c[1] - Math.max(c[0], c[2])) / Math.max(l, 0.02)) * 2));
  const sat = grade.sat * (1 + (greenSaturation - 1) * greenness);
  return [
    (l + (c[0] - l) * sat) * grade.gain[0],
    (l + (c[1] - l) * sat) * grade.gain[1],
    (l + (c[2] - l) * sat) * grade.gain[2],
  ];
}

function acesChannel(x: number): number {
  const a = x * (x + 0.0245786) - 0.000090537;
  const b = x * (0.983729 * x + 0.432951) + 0.238081;
  return a / b;
}

/** ACES Filmic jak w Three.js (ekspozycja / 0,6, macierze wejścia i wyjścia). Wejście liniowe, wyjście liniowe 0-1. */
export function acesFilmic(c: Rgb, exposure: number): Rgb {
  const k = exposure / 0.6;
  const r = c[0] * k;
  const g = c[1] * k;
  const b = c[2] * k;
  const i0 = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const i1 = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const i2 = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const f0 = acesChannel(i0);
  const f1 = acesChannel(i1);
  const f2 = acesChannel(i2);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(1.60475 * f0 - 0.53108 * f1 - 0.07367 * f2),
    clamp(-0.10208 * f0 + 1.10813 * f1 - 0.00605 * f2),
    clamp(-0.00327 * f0 - 0.07276 * f1 + 1.07602 * f2),
  ];
}

export function linearToSrgb255(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
}

export type Surface = "top" | "sunSide" | "shadeSide" | "under";

export type ShadeSample = { srgb: Rgb; luminance: number };

const NORMALS: Record<Surface, readonly [number, number, number]> = {
  top: [0, 1, 0],
  sunSide: [1, 0, 0],
  shadeSide: [-1, 0, 0],
  under: [0, -1, 0],
};

export type ShadeOptions = {
  surface: Surface;
  /** Czy powierzchnia jest w cieniu innych obiektów (cień pochłania `shadow` udziału słońca). */
  shadowed: boolean;
};

/** Szacowany kolor piksela (sRGB 0-255 i luminancja 0-255) materiału `id` o danej porze dnia w konfiguracji `config`. */
export function estimatePixel(id: string, hour: number, config: VisualConfig, options: ShadeOptions): ShadeSample {
  const atmo = atmosphereAt(hour, config.look.dayModel);
  const grade = config.look.palette[id];
  const albedo = gradeAlbedo(id, refLin(id), grade, config.tuning.greenSaturation);

  const sunDirXZ = Math.hypot(atmo.sunDir[0], atmo.sunDir[2]);
  // Słońce "stoi" po stronie +X powierzchni bocznych: kąt padania zależy tylko od wysokości słońca.
  const sunVec: [number, number, number] = [sunDirXZ, atmo.sunDir[1], 0];
  const base = NORMALS[options.surface];
  const up = grade.up;
  const n0: [number, number, number] = [base[0] * (1 - up), base[1] * (1 - up) + up, base[2] * (1 - up)];
  const len = Math.hypot(n0[0], n0[1], n0[2]) || 1;
  const n: [number, number, number] = [n0[0] / len, n0[1] / len, n0[2] / len];

  const sunLin = toLin(atmo.sunColor);
  const skyLin = toLin(atmo.hemiSky);
  const gndLin = toLin(atmo.hemiGround).map((v) => v * config.look.groundBounce) as unknown as Rgb;
  const nl = Math.max(0, n[0] * sunVec[0] + n[1] * sunVec[1] + n[2] * sunVec[2]);
  const vis = options.shadowed ? 1 - config.tuning.shadow : 1;
  const sunI = atmo.sunIntensity * config.tuning.sun * nl * vis;
  const hemiT = 0.5 + 0.5 * n[1];
  const hemiI = atmo.hemiIntensity * config.tuning.ambient;

  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const ambient = (gndLin[k] + (skyLin[k] - gndLin[k]) * hemiT) * hemiI;
    out[k] = (albedo[k] * (sunLin[k] * sunI + ambient)) / Math.PI;
  }
  const mapped = acesFilmic(out, atmo.exposure * config.tuning.exposure);
  const srgb: Rgb = [linearToSrgb255(mapped[0]), linearToSrgb255(mapped[1]), linearToSrgb255(mapped[2])];
  return { srgb, luminance: 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2] };
}

export type Vec3 = readonly [number, number, number];
export type NormalShading = {
  /** Normalna z wierzchołków bez odwracania na tylnej ściance (materiały z `STABLE_NORMAL`). */
  stableFace: boolean;
  /** Zabezpieczenie przed `normalize` wektora zerowego po pochyleniu normalnej ku górze. */
  guard: boolean;
};

/** Zachowanie sprzed poprawki (V2b przy pierwszym wydaniu). */
export const LEGACY_SHADING: NormalShading = { stableFace: false, guard: false };

/** Zachowanie shadera dla materiału `id`; `fix` = false odtwarza błąd (`uFix` = 0). */
export function normalShadingOf(id: string, fix = true): NormalShading {
  return { stableFace: fix && STABLE_NORMAL.has(id), guard: fix };
}

const normalize3 = (v: Vec3): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Mirror normalnej liścia/źdźbła z fragment shadera (`normal_fragment_begin` Three.js dla `DoubleSide`,
 * `STABLE_NORMAL_FRAGMENT`, `NORMAL_UP_FRAGMENT`) we współrzędnych świata ("w górę" = +Y). Bez poprawki normalna jest
 * odwracana na tylnej ściance, a `normalize` wektora zerowego daje NaN (czarne piksele).
 */
export function foliageNormal(vertexNormal: Vec3, frontFacing: boolean, up: number, shading: NormalShading): [number, number, number] {
  const n0 = normalize3(vertexNormal);
  const sign = shading.stableFace || frontFacing ? 1 : -1;
  const m: [number, number, number] = [n0[0] * sign * (1 - up), n0[1] * sign * (1 - up) + up, n0[2] * sign * (1 - up)];
  if (shading.guard && m[0] * m[0] + m[1] * m[1] + m[2] * m[2] < 0.0004) return [0, 1, 0];
  return normalize3(m);
}
