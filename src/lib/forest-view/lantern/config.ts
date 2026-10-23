/**
 * Parametry renderowania lampy naftowej (czyste dane, bez Three.js). To konfiguracja WIZUALNA i LOKALNA: służy do
 * strojenia w panelu Diagnostyka, nie jest częścią stanu gry, zapisu ani sieci. Autorytatywny jest wyłącznie stan
 * włączona/wyłączona (`GameState.lantern`, `Player.lanternOn`); migotanie, intensywność i LOD liczy każdy klient sam.
 *
 * Jednostki: metry, stopnie, kelwiny; kolory jako `#rrggbb` (sRGB). `intensity` to natężenie oświetlenia powierzchni
 * (w jednostkach sceny three.js, tych samych co `sunIntensity` w `atmosphere.ts`) w odległości `referenceDistance`.
 */
export type ShadowQuality = "low" | "medium" | "high";

export type LanternConfig = {
  // --- światło główne ---
  lightEnabled: boolean;
  lightColor: string;
  /** Gdy włączone, barwę światła wyznacza `temperatureK` (przeliczenie na RGB), a nie `lightColor`. */
  useTemperature: boolean;
  temperatureK: number;
  /** Natężenie oświetlenia w odległości `referenceDistance` (jednostki sceny). */
  intensity: number;
  /** Promień silnego oświetlenia (m): do niego światło jest mocne, dalej wygasa płynnie. */
  radius: number;
  /** Zasięg wygaszania jako wielokrotność `radius`: światło spada do zera (gładko, bez odcięcia) na `radius * fadeReach`. */
  fadeReach: number;
  referenceDistance: number;
  /** Wykładnik zaniku z odległością (2 = fizyczne prawo odwrotnych kwadratów; mniej = łagodniejszy zanik z bliska). */
  decay: number;
  /** Przesunięcie źródła światła względem płomienia w pionie (m). */
  heightOffset: number;

  // --- migotanie ---
  flickerEnabled: boolean;
  flickerSpeed: number;
  flickerIntensity: number;
  flickerColorVariation: number;

  // --- blask płomienia ---
  flameEmissive: number;
  glowSize: number;
  glowOpacity: number;
  glowColor: string;

  // --- widoczność z daleka ---
  farGlowEnabled: boolean;
  farGlowMaxDistance: number;
  /** Minimalna średnica blasku na ekranie (px) niezależnie od odległości. */
  farGlowMinPixelSize: number;
  farGlowFadeStart: number;
  farGlowFadeEnd: number;
  /** 0 = mgła nie wpływa na blask, 1 = blask słabnie jak każdy obiekt we mgle. */
  fogInteraction: number;

  // --- wydajność ---
  nearDistance: number;
  midDistance: number;
  /** Jasność rzeczywistego światła w strefie MID względem NEAR. */
  midLightScale: number;
  shadowsEnabled: boolean;
  shadowQuality: ShadowQuality;
  maxLights: number;

  // --- mocowanie do dłoni (układ kości, metry, stopnie) ---
  attachX: number;
  attachY: number;
  attachZ: number;
  attachRotX: number;
  attachRotY: number;
  attachRotZ: number;
  attachScale: number;
};

export const DEFAULT_LANTERN_CONFIG: Readonly<LanternConfig> = {
  lightEnabled: true,
  lightColor: "#FFBD55",
  useTemperature: false,
  temperatureK: 2200,
  intensity: 1.5,
  radius: 5,
  fadeReach: 2,
  referenceDistance: 5,
  decay: 1.3,
  heightOffset: 0.05,

  flickerEnabled: true,
  flickerSpeed: 1,
  flickerIntensity: 0.1,
  flickerColorVariation: 0.15,

  flameEmissive: 1.5,
  glowSize: 0.8,
  glowOpacity: 0.55,
  glowColor: "#FFA640",

  farGlowEnabled: true,
  farGlowMaxDistance: 150,
  farGlowMinPixelSize: 6,
  farGlowFadeStart: 60,
  farGlowFadeEnd: 170,
  fogInteraction: 0.35,

  nearDistance: 12,
  midDistance: 30,
  midLightScale: 0.6,
  shadowsEnabled: false,
  shadowQuality: "medium",
  maxLights: 3,

  // Hak lampy w środku dłoni; korpus zwisa wzdłuż osi palców kości (obrót 180° wokół X odwraca lampę do góry nogami względem kości).
  attachX: 0,
  attachY: 0.06,
  attachZ: 0.02,
  attachRotX: 180,
  attachRotY: 0,
  attachRotZ: 0,
  attachScale: 1,
};

export type LanternGroupId = "light" | "flicker" | "glow" | "far" | "perf" | "attach";

export const LANTERN_GROUP_LABELS: Record<LanternGroupId, string> = {
  light: "Światło główne",
  flicker: "Migotanie",
  glow: "Blask płomienia",
  far: "Widoczność z daleka",
  perf: "Wydajność",
  attach: "Mocowanie lampy",
};

type Base = { label: string; group: LanternGroupId };
export type NumberParam = Base & { kind: "number"; key: NumberKey; min: number; max: number; step: number; unit?: string };
export type BooleanParam = Base & { kind: "boolean"; key: BooleanKey };
export type ColorParam = Base & { kind: "color"; key: ColorKey };
export type SelectParam = Base & { kind: "select"; key: "shadowQuality"; options: readonly { value: ShadowQuality; label: string }[] };
export type LanternParam = NumberParam | BooleanParam | ColorParam | SelectParam;

type KeysOf<T> = { [K in keyof LanternConfig]: LanternConfig[K] extends T ? K : never }[keyof LanternConfig];
export type NumberKey = KeysOf<number>;
export type BooleanKey = KeysOf<boolean>;
export type ColorKey = "lightColor" | "glowColor";

const n = (group: LanternGroupId, key: NumberKey, label: string, min: number, max: number, step: number, unit?: string): NumberParam => ({ kind: "number", group, key, label, min, max, step, unit });
const b = (group: LanternGroupId, key: BooleanKey, label: string): BooleanParam => ({ kind: "boolean", group, key, label });

/** Jedyne źródło etykiet i zakresów: panel Diagnostyka renderuje się z tej listy, a `sanitizeLanternConfig` przycina wartości do niej. */
export const LANTERN_PARAMS: readonly LanternParam[] = [
  b("light", "lightEnabled", "Light Enabled"),
  { kind: "color", group: "light", key: "lightColor", label: "Light Color" },
  b("light", "useTemperature", "Use Color Temperature"),
  n("light", "temperatureK", "Color Temperature", 1000, 4000, 50, "K"),
  n("light", "intensity", "Intensity (przy Reference Distance)", 0, 10, 0.05),
  n("light", "radius", "Effective Radius", 1, 15, 0.1, "m"),
  n("light", "fadeReach", "Fade Reach (× promień)", 1.1, 4, 0.05),
  n("light", "referenceDistance", "Reference Distance", 0.5, 15, 0.1, "m"),
  n("light", "decay", "Decay / Attenuation", 0.5, 3, 0.05),
  n("light", "heightOffset", "Light Height Offset", -0.5, 1.5, 0.01, "m"),

  b("flicker", "flickerEnabled", "Flicker Enabled"),
  n("flicker", "flickerSpeed", "Flicker Speed", 0.2, 4, 0.05),
  n("flicker", "flickerIntensity", "Flicker Intensity", 0, 0.5, 0.01),
  n("flicker", "flickerColorVariation", "Flicker Color Variation", 0, 1, 0.01),

  n("glow", "flameEmissive", "Flame Emissive Intensity", 0, 4, 0.05),
  n("glow", "glowSize", "Glow Size", 0.1, 3, 0.05, "m"),
  n("glow", "glowOpacity", "Glow Opacity", 0, 1, 0.01),
  { kind: "color", group: "glow", key: "glowColor", label: "Glow Color" },

  b("far", "farGlowEnabled", "Far Glow Enabled"),
  n("far", "farGlowMaxDistance", "Far Glow Max Distance", 20, 400, 5, "m"),
  n("far", "farGlowMinPixelSize", "Far Glow Minimum Pixel Size", 0, 24, 0.5, "px"),
  n("far", "farGlowFadeStart", "Far Glow Fade Start", 5, 300, 5, "m"),
  n("far", "farGlowFadeEnd", "Far Glow Fade End", 10, 400, 5, "m"),
  n("far", "fogInteraction", "Fog Interaction", 0, 1, 0.05),

  n("perf", "nearDistance", "Near LOD Distance", 2, 60, 1, "m"),
  n("perf", "midDistance", "Mid LOD Distance", 5, 120, 1, "m"),
  n("perf", "midLightScale", "Mid Light Scale", 0, 1, 0.05),
  b("perf", "shadowsEnabled", "Shadows Enabled"),
  {
    kind: "select",
    group: "perf",
    key: "shadowQuality",
    label: "Shadow Quality",
    options: [
      { value: "low", label: "niska (256)" },
      { value: "medium", label: "średnia (512)" },
      { value: "high", label: "wysoka (1024)" },
    ],
  },
  n("perf", "maxLights", "Max Active Dynamic Lantern Lights", 0, 4, 1),

  n("attach", "attachX", "Position X", -0.3, 0.3, 0.005, "m"),
  n("attach", "attachY", "Position Y", -0.3, 0.3, 0.005, "m"),
  n("attach", "attachZ", "Position Z", -0.3, 0.3, 0.005, "m"),
  n("attach", "attachRotX", "Rotation X", -180, 180, 1, "°"),
  n("attach", "attachRotY", "Rotation Y", -180, 180, 1, "°"),
  n("attach", "attachRotZ", "Rotation Z", -180, 180, 1, "°"),
  n("attach", "attachScale", "Scale", 0.3, 2.5, 0.05),
];

export const SHADOW_QUALITIES: readonly ShadowQuality[] = ["low", "medium", "high"];
export const SHADOW_MAP_SIZE: Record<ShadowQuality, number> = { low: 256, medium: 512, high: 1024 };

const HEX = /^#[0-9a-fA-F]{6}$/;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Przycina konfigurację do dozwolonych zakresów i naprawia niespójności (kolejność progów LOD i pasma wygaszania).
 * Wartości spoza typu lub NaN zastępuje domyślnymi; nieznane klucze są odrzucane. Zawsze zwraca nowy obiekt.
 */
export function sanitizeLanternConfig(input: unknown, base: Readonly<LanternConfig> = DEFAULT_LANTERN_CONFIG): LanternConfig {
  const src = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const out: LanternConfig = { ...base };
  for (const p of LANTERN_PARAMS) {
    const v = src[p.key];
    if (v === undefined) continue;
    switch (p.kind) {
      case "number":
        if (typeof v === "number" && Number.isFinite(v)) out[p.key] = clamp(v, p.min, p.max);
        break;
      case "boolean":
        if (typeof v === "boolean") out[p.key] = v;
        break;
      case "color":
        if (typeof v === "string" && HEX.test(v)) out[p.key] = v.toUpperCase();
        break;
      case "select":
        if (typeof v === "string" && p.options.some((o) => o.value === v)) out.shadowQuality = v as ShadowQuality;
        break;
    }
  }
  // Strefy: NEAR < MID; pasmo wygaszania blasku: start < koniec; MID musi być co najmniej tak blisko jak NEAR + 1 m.
  if (out.midDistance < out.nearDistance + 1) out.midDistance = Math.min(120, out.nearDistance + 1);
  if (out.farGlowFadeEnd < out.farGlowFadeStart + 5) out.farGlowFadeEnd = Math.min(400, out.farGlowFadeStart + 5);
  out.maxLights = Math.round(out.maxLights);
  return out;
}

/** Natężenie w kandelach dla `light.intensity` three.js: `intensity` to natężenie oświetlenia w odległości odniesienia. */
export function candelaOf(cfg: Pick<LanternConfig, "intensity" | "referenceDistance" | "decay">): number {
  return cfg.intensity * Math.pow(cfg.referenceDistance, cfg.decay);
}

/** Zasięg, na którym światło gaśnie do zera (parametr `distance` światła three.js). */
export function cutoffOf(cfg: Pick<LanternConfig, "radius" | "fadeReach">): number {
  return cfg.radius * cfg.fadeReach;
}

/** Zmiana względem domyślnych: nazwy kluczy różniących się od `DEFAULT_LANTERN_CONFIG` (panel pokazuje, co dostrojono). */
export function changedKeys(cfg: LanternConfig): (keyof LanternConfig)[] {
  return (Object.keys(DEFAULT_LANTERN_CONFIG) as (keyof LanternConfig)[]).filter((k) => cfg[k] !== DEFAULT_LANTERN_CONFIG[k]);
}
