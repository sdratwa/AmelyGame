import type { DayModel, Rgb } from "./atmosphere";

/**
 * Strojenie wyglądu lasu (V2b). Czyste dane bez Three.js: presety, suwaki panelu i paleta materiałów.
 * Wszystko tu jest wizualne: nie zmienia świata, liczby ani pozycji obiektów, ID modeli ani zapisów.
 * Zmiana presetu nie przeładowuje modeli ani nie generuje świata od nowa (uniformy shaderów + parametry świateł).
 */
export type PresetId = "ORIGINAL" | "NATURAL" | "FAIRYTALE";

export const PRESET_IDS: readonly PresetId[] = ["ORIGINAL", "NATURAL", "FAIRYTALE"];

/** Parametry dostępne w panelu VISUAL TUNING. Wartości neutralne (1, 1, 1, 1, 1, 0, 1) odtwarzają V2a. */
export type VisualTuning = {
  /** Mnożnik ekspozycji z tabeli pory dnia. */
  exposure: number;
  /** Mnożnik światła otoczenia (półsfera). */
  ambient: number;
  /** Mnożnik natężenia słońca. */
  sun: number;
  /** Intensywność cieni 0-1: 1 = cień całkowicie zasłania słońce, 0 = brak cieni. */
  shadow: number;
  /** Nasycenie zieleni 0-1,5 (dotyczy tylko zielonych pikseli: kwiaty i kora zostają). */
  greenSaturation: number;
  /** Kolor mgły (#rrggbb) mieszany z kolorem pory dnia w ilości `fogTintAmount`. */
  fogTint: string;
  fogTintAmount: number;
  /** Mnożnik gęstości mgły. */
  fogDensity: number;
};

/** Korekta jednego materiału (na tekstury GLB; w przestrzeni liniowej). */
export type MaterialGrade = {
  /** Mnożnik albedo (liniowy). */
  gain: Rgb;
  /** Dodatkowe nasycenie materiału (1 = bez zmian). */
  sat: number;
  /** Jak mocno normalne liści pochylamy ku górze (0-1): jaśniejszy spód koron i spokojniejsze cieniowanie kart. */
  up: number;
  /** Kolor docelowy (liniowy) dla płaskich tekstur liści; zachowuje zmienność jasności tekstury względem `refLum`. */
  tint?: { color: Rgb; amount: number; refLum: number };
  /** Delikatna, deterministyczna zmienność jasności na powierzchni kart i wokół (0 = brak). */
  variation: number;
};

/** Parametry presetu, których nie ma w panelu (zapisywane w JSON razem z suwakami). */
export type VisualLook = {
  dayModel: DayModel;
  shadowBias: number;
  shadowNormalBias: number;
  /** Promień rozmycia cienia w teksellach (PCF); 1 = twardy (V2a). */
  shadowRadius: number;
  /** Mnożnik koloru światła odbitego od ziemi (półsfera od dołu). */
  groundBounce: number;
  /** `v2a`: grunt z V2a; `natural`: ściółka i ścieżki V2b. */
  groundStyle: "v2a" | "natural";
  /** Amplituda szumu szczegółu na gruncie (0 = brak). */
  groundDetail: number;
  /** Mnożnik jasności cząstek pyłu. */
  particleBoost: number;
  palette: Record<string, MaterialGrade>;
};

export type VisualConfig = {
  preset: PresetId;
  tuning: VisualTuning;
  look: VisualLook;
};

export const NEUTRAL_TUNING: VisualTuning = {
  exposure: 1,
  ambient: 1,
  sun: 1,
  shadow: 1,
  greenSaturation: 1,
  fogTint: "#c8dcd2",
  fogTintAmount: 0,
  fogDensity: 1,
};

export const MATERIAL_IDS = [
  "bark_normaltree",
  "bark_twistedtree",
  "leaves_pine",
  "leaves_normaltree",
  "leaves_twistedtree",
  "leaves",
  "grass",
  "flowers",
  "mushrooms",
  "rocks",
  "ground",
] as const;

const ONE: Rgb = [1, 1, 1];
const grade = (p: Partial<MaterialGrade> = {}): MaterialGrade => ({ gain: ONE, sat: 1, up: 0, variation: 0, ...p });

const IDENTITY_PALETTE: Record<string, MaterialGrade> = Object.fromEntries(MATERIAL_IDS.map((id) => [id, grade()]));

export const ORIGINAL_CONFIG: VisualConfig = {
  preset: "ORIGINAL",
  tuning: NEUTRAL_TUNING,
  look: {
    dayModel: "v2a",
    shadowBias: -0.0004,
    shadowNormalBias: 0.05,
    shadowRadius: 1,
    groundBounce: 1,
    groundStyle: "v2a",
    groundDetail: 0,
    particleBoost: 1,
    palette: IDENTITY_PALETTE,
  },
};

/** sRGB (0-255) -> liniowy. */
export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const lin = (r: number, g: number, b: number): Rgb => [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Średnie kolory (liniowe) płaskich tekstur liści z manifestu V1 - punkt odniesienia dla `tint`. */
export const LEAF_REFERENCE = {
  pine: lin(50, 87, 0),
  normaltree: lin(88, 123, 1),
  twistedOriginal: lin(167, 23, 24),
} as const;

const NATURAL_PALETTE: Record<string, MaterialGrade> = {
  ...IDENTITY_PALETTE,
  bark_normaltree: grade({ gain: [1.35, 1.35, 1.35], sat: 0.85, variation: 0.1 }),
  bark_twistedtree: grade({ gain: [1.85, 1.8, 1.75], sat: 0.9, variation: 0.1 }),
  leaves_pine: grade({
    up: 0.45,
    variation: 0.22,
    tint: { color: lin(66, 118, 80), amount: 1, refLum: lum(LEAF_REFERENCE.pine) },
  }),
  leaves_normaltree: grade({
    up: 0.45,
    variation: 0.2,
    tint: { color: lin(98, 136, 52), amount: 1, refLum: lum(LEAF_REFERENCE.normaltree) },
  }),
  leaves_twistedtree: grade({
    up: 0.45,
    variation: 0.2,
    tint: { color: lin(86, 118, 52), amount: 1, refLum: lum(LEAF_REFERENCE.twistedOriginal) },
  }),
  leaves: grade({ gain: [0.92, 0.92, 0.9], sat: 0.85, up: 0.4, variation: 0.1 }),
  grass: grade({ gain: [0.78, 0.8, 0.7], sat: 0.7, up: 0.5, variation: 0.1 }),
  flowers: grade({ gain: [0.9, 0.9, 0.9], sat: 0.82, up: 0.3 }),
  mushrooms: grade({ gain: [0.9, 0.9, 0.9], sat: 0.9 }),
  rocks: grade({ gain: [1.5, 1.45, 1.4], sat: 0.8, variation: 0.08 }),
  ground: grade({ gain: [1.15, 1.12, 1.08], sat: 1 }),
};

export const NATURAL_CONFIG: VisualConfig = {
  preset: "NATURAL",
  tuning: {
    exposure: 1.1,
    ambient: 1.75,
    sun: 0.9,
    shadow: 0.55,
    greenSaturation: 0.85,
    fogTint: "#cfe0d2",
    fogTintAmount: 0.3,
    fogDensity: 0.9,
  },
  look: {
    dayModel: "summer",
    shadowBias: -0.0003,
    shadowNormalBias: 0.07,
    shadowRadius: 2.6,
    groundBounce: 1.7,
    groundStyle: "natural",
    groundDetail: 0.12,
    particleBoost: 1,
    palette: NATURAL_PALETTE,
  },
};

const FAIRYTALE_PALETTE: Record<string, MaterialGrade> = {
  ...NATURAL_PALETTE,
  leaves_pine: { ...NATURAL_PALETTE.leaves_pine, tint: { color: lin(58, 122, 96), amount: 1, refLum: lum(LEAF_REFERENCE.pine) } },
  leaves_normaltree: { ...NATURAL_PALETTE.leaves_normaltree, tint: { color: lin(104, 146, 66), amount: 1, refLum: lum(LEAF_REFERENCE.normaltree) } },
  leaves_twistedtree: { ...NATURAL_PALETTE.leaves_twistedtree, tint: { color: lin(92, 128, 70), amount: 1, refLum: lum(LEAF_REFERENCE.twistedOriginal) } },
  flowers: grade({ gain: [1, 1, 1], sat: 0.95, up: 0.3 }),
};

export const FAIRYTALE_CONFIG: VisualConfig = {
  preset: "FAIRYTALE",
  tuning: {
    exposure: 1.15,
    ambient: 1.95,
    sun: 0.85,
    shadow: 0.45,
    greenSaturation: 0.95,
    fogTint: "#d4dcf0",
    fogTintAmount: 0.45,
    fogDensity: 1.25,
  },
  look: {
    ...NATURAL_CONFIG.look,
    groundBounce: 1.8,
    particleBoost: 1.7,
    palette: FAIRYTALE_PALETTE,
  },
};

export const PRESETS: Record<PresetId, VisualConfig> = {
  ORIGINAL: ORIGINAL_CONFIG,
  NATURAL: NATURAL_CONFIG,
  FAIRYTALE: FAIRYTALE_CONFIG,
};

export const DEFAULT_PRESET: PresetId = "NATURAL";

export function parsePreset(text: string | null | undefined): PresetId | null {
  const p = (text ?? "").toUpperCase();
  return (PRESET_IDS as readonly string[]).includes(p) ? (p as PresetId) : null;
}

export function presetConfig(id: PresetId): VisualConfig {
  return structuredClone(PRESETS[id]);
}

export type TuningKey = keyof VisualTuning;

/** Zakresy suwaków panelu (także walidacja przy wczytywaniu JSON). */
export const TUNING_RANGES: Record<Exclude<TuningKey, "fogTint">, { min: number; max: number; step: number; label: string }> = {
  exposure: { min: 0.5, max: 2, step: 0.01, label: "Ekspozycja" },
  ambient: { min: 0, max: 2.5, step: 0.01, label: "Światło otoczenia" },
  sun: { min: 0, max: 2.5, step: 0.01, label: "Słońce" },
  shadow: { min: 0, max: 1, step: 0.01, label: "Intensywność cieni" },
  greenSaturation: { min: 0, max: 1.5, step: 0.01, label: "Nasycenie zieleni" },
  fogTintAmount: { min: 0, max: 1, step: 0.01, label: "Udział koloru mgły" },
  fogDensity: { min: 0, max: 3, step: 0.01, label: "Gęstość mgły" },
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex: string): Rgb {
  const h = HEX.test(hex) ? hex : "#ffffff";
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
}

/** Przycina wartości do zakresów i poprawia kolor mgły; nieznane lub nieliczbowe pola bierze z `base`. */
export function sanitizeTuning(input: Partial<VisualTuning> | undefined, base: VisualTuning = NEUTRAL_TUNING): VisualTuning {
  const out = { ...base };
  for (const key of Object.keys(TUNING_RANGES) as (keyof typeof TUNING_RANGES)[]) {
    const v = input?.[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      const r = TUNING_RANGES[key];
      out[key] = Math.min(r.max, Math.max(r.min, v));
    }
  }
  if (typeof input?.fogTint === "string" && HEX.test(input.fogTint)) out.fogTint = input.fogTint.toLowerCase();
  return out;
}

/** Kolor mgły po zmieszaniu koloru pory dnia z kolorem własnym (sRGB). */
export function tintedFog(base: Rgb, tuning: VisualTuning): Rgb {
  const t = hexToRgb(tuning.fogTint);
  const k = tuning.fogTintAmount;
  return [base[0] + (t[0] - base[0]) * k, base[1] + (t[1] - base[1]) * k, base[2] + (t[2] - base[2]) * k];
}

export type VisualJson = {
  format: "forest-visual/1";
  preset: PresetId;
  /** True, gdy suwaki różnią się od zapisanego presetu. */
  modified: boolean;
  hour: number;
  quality: string;
  tuning: VisualTuning;
  look: VisualLook;
};

export function isModified(config: VisualConfig): boolean {
  const base = PRESETS[config.preset].tuning;
  return (Object.keys(base) as TuningKey[]).some((k) => base[k] !== config.tuning[k]);
}

export function visualToJson(config: VisualConfig, hour: number, quality: string): VisualJson {
  return { format: "forest-visual/1", preset: config.preset, modified: isModified(config), hour, quality, tuning: config.tuning, look: config.look };
}

/** Wczytuje JSON z `visualToJson` (także zapisany wcześniej). Zwraca null dla nieprawidłowych danych. */
export function visualFromJson(text: string): { config: VisualConfig; hour: number | null } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Partial<VisualJson>;
  if (j.format !== "forest-visual/1") return null;
  const preset = parsePreset(j.preset) ?? "NATURAL";
  const base = presetConfig(preset);
  const look: VisualLook = { ...base.look, ...(j.look ?? {}), palette: { ...base.look.palette, ...(j.look?.palette ?? {}) } };
  if (look.dayModel !== "v2a" && look.dayModel !== "summer") look.dayModel = base.look.dayModel;
  if (look.groundStyle !== "v2a" && look.groundStyle !== "natural") look.groundStyle = base.look.groundStyle;
  const hour = typeof j.hour === "number" && Number.isFinite(j.hour) ? ((j.hour % 24) + 24) % 24 : null;
  return { config: { preset, tuning: sanitizeTuning(j.tuning, base.tuning), look }, hour };
}
