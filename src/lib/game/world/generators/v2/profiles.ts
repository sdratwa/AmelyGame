import type { RockClass } from "./species";

/**
 * Profile środowiskowe jako dane. Strefy w planie świata wskazują profil przez `kind`; generator miesza profile
 * płynnie na granicach stref, więc renderer nie zawiera żadnej logiki doboru roślinności.
 */
export type ProfileId = "mixed_forest" | "sunny_forest" | "dense_forest" | "clearing" | "riverside";

export const PROFILE_IDS: readonly ProfileId[] = ["mixed_forest", "sunny_forest", "dense_forest", "clearing", "riverside"];

export type DensityLayer = "tree" | "ancient" | "rock" | "bush" | "fern" | "plant" | "grass" | "flower";

/** Profile prototypu /dev/forest-pro (paczka Pro): cztery strefy 300x300 m. Nie należą do generatora v2. */
export type ShowcaseProfileId = "pro_autumn" | "pro_conifer" | "pro_desert" | "pro_mix";

export const SHOWCASE_PROFILE_IDS: readonly ShowcaseProfileId[] = ["pro_autumn", "pro_conifer", "pro_desert", "pro_mix"];

export type AnyProfileId = ProfileId | ShowcaseProfileId;

/**
 * Dodatkowe wagi gatunków z paczki Pro (tylko tryb deweloperski, opcjonalne; brak = 0). Wagi grup w obrębie warstwy są względne
 * względem grup bazowych z `mix`, a udziały (`rockBig`, `rockDesert`) i szanse są z przedziału 0..1. Wszystkie wartości mieszają się
 * liniowo na granicach stref, tak samo jak reszta profilu.
 */
export type ProMix = {
  tree?: Partial<Record<"birch" | "giantpine" | "tallthick" | "blossom" | "dead", number>>;
  bush?: Partial<Record<"bushbig" | "bushlong", number>>;
  grass?: Partial<Record<"wide" | "wheat", number>>;
  /** Wagi grzybów względem pospolitego (waga 1): kapelusz czerwony i półkowe. */
  mushroom?: Partial<Record<"mushroomcap" | "bracket", number>>;
  /** Udział dużych głazów (Rock_Big) wśród skał klasy L. */
  rockBig?: number;
  /** Udział pustynnych wariantów (tekstura Rocks_Desert) wśród skał. */
  rockDesert?: number;
  /** Szansa na kępę płatków pod drzewem kwitnącym. */
  petals?: number;
  /** Szansa na kępę kamyków przy skale. */
  pebbles?: number;
  /** Szansa (0-1), że kotwica skały jest formacją dużych głazów (zamiast zwykłego skupiska). */
  formations?: number;
};

export type EnvironmentProfile = {
  id: AnyProfileId;
  label: string;
  /** Średnia gęstość docelowa na 100 m² (przed wpływem skupisk, terenu i rzadzenia). Dla skał i kwiatów: sztuki. */
  density: Record<DensityLayer, number>;
  /** Szansa (0..1) na kępę grzybów u podstawy pojedynczego drzewa. */
  mushroomChance: number;
  /** Wagi względne grup gatunków w obrębie warstwy. */
  /** Gatunki z paczki Pro (tylko prototyp); profile v2 tego pola nie mają. */
  pro?: ProMix;
  mix: {
    tree: { broadleaf: number; pine: number };
    bush: { plain: number; flowering: number };
    plant: { leafy: number; ground: number; clover: number };
    grass: { common: number; wispy: number };
    rock: Record<RockClass, number>;
  };
};

export type ProfileTable = Readonly<Record<ProfileId, EnvironmentProfile>>;

/** Profil bazowy: używany wszędzie tam, gdzie żadna strefa nie ma wpływu. */
export const BASE_PROFILE: ProfileId = "mixed_forest";

export const DEFAULT_PROFILES: ProfileTable = {
  mixed_forest: {
    id: "mixed_forest",
    label: "Las mieszany",
    density: { tree: 3.4, ancient: 0.02, rock: 0.25, bush: 1.3, fern: 3.8, plant: 2.5, grass: 14, flower: 1.2 },
    mushroomChance: 0.07,
    mix: {
      tree: { broadleaf: 1.2, pine: 1 },
      bush: { plain: 0.8, flowering: 0.2 },
      plant: { leafy: 1, ground: 1, clover: 0.7 },
      grass: { common: 1, wispy: 0.8 },
      rock: { s: 0.62, m: 0.3, l: 0.08 },
    },
  },
  sunny_forest: {
    id: "sunny_forest",
    label: "Rzadki, słoneczny las",
    density: { tree: 2.0, ancient: 0.014, rock: 0.2, bush: 1.0, fern: 2.0, plant: 2.0, grass: 22, flower: 3.0 },
    mushroomChance: 0.02,
    mix: {
      tree: { broadleaf: 1.6, pine: 0.7 },
      bush: { plain: 0.55, flowering: 0.45 },
      plant: { leafy: 0.6, ground: 1, clover: 1.4 },
      grass: { common: 1.2, wispy: 0.8 },
      rock: { s: 0.65, m: 0.28, l: 0.07 },
    },
  },
  dense_forest: {
    id: "dense_forest",
    label: "Gęsty las",
    density: { tree: 5.6, ancient: 0.04, rock: 0.3, bush: 2.0, fern: 6.5, plant: 3.0, grass: 6, flower: 0.4 },
    mushroomChance: 0.16,
    mix: {
      tree: { broadleaf: 0.9, pine: 1.3 },
      bush: { plain: 0.92, flowering: 0.08 },
      plant: { leafy: 1.5, ground: 0.8, clover: 0.2 },
      grass: { common: 0.7, wispy: 1.2 },
      rock: { s: 0.55, m: 0.33, l: 0.12 },
    },
  },
  clearing: {
    id: "clearing",
    label: "Polana",
    density: { tree: 0, ancient: 0, rock: 0.35, bush: 0.3, fern: 0.5, plant: 1.5, grass: 24, flower: 6.0 },
    mushroomChance: 0,
    mix: {
      tree: { broadleaf: 1, pine: 1 },
      bush: { plain: 0.5, flowering: 0.5 },
      plant: { leafy: 0.4, ground: 0.8, clover: 1.6 },
      grass: { common: 1.2, wispy: 0.9 },
      rock: { s: 0.7, m: 0.25, l: 0.05 },
    },
  },
  riverside: {
    id: "riverside",
    label: "Brzeg rzeki",
    density: { tree: 2.4, ancient: 0.012, rock: 1.1, bush: 2.4, fern: 6.5, plant: 4.0, grass: 18, flower: 2.0 },
    mushroomChance: 0.05,
    mix: {
      tree: { broadleaf: 1.8, pine: 0.4 },
      bush: { plain: 0.75, flowering: 0.25 },
      plant: { leafy: 1.6, ground: 0.6, clover: 0.5 },
      grass: { common: 0.9, wispy: 1.2 },
      rock: { s: 0.45, m: 0.38, l: 0.17 },
    },
  },
};
