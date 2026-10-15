import { QUALITY_PROFILES, type QualityId, type QualityProfile } from "@/lib/assets";

/** Kategorie obiektów z punktu widzenia widoczności (odcięcia odległościowe i rzadzenie). */
export type ViewKind = "tree" | "rock" | "bush" | "fern" | "plant" | "grass" | "flower" | "mushroom";

export const VIEW_KINDS: readonly ViewKind[] = ["tree", "rock", "bush", "fern", "plant", "grass", "flower", "mushroom"];

/** Obiekty rzucające cień (reszta tylko go odbiera): tanie dla GPU i bez znaczenia wizualnego dla niskiej roślinności. */
export const SHADOW_CASTERS: ReadonlySet<ViewKind> = new Set(["tree", "rock", "bush"]);

export function viewKindOf(kind: string): ViewKind {
  switch (kind) {
    case "tree":
    case "rock":
    case "bush":
    case "fern":
    case "grass":
    case "flower":
    case "mushroom":
      return kind;
    default:
      return "plant";
  }
}

/**
 * Profil widoku prototypu (V2a). Kontroluje wyłącznie widoczność i szczegółowość: układ świata (pozycje, kolizje, ID)
 * pochodzi z generatora i nie zależy od jakości. Wartości są punktem wyjścia do strojenia po pomiarach w przeglądarce.
 */
export type ForestViewProfile = {
  id: QualityId;
  /** Profil zasobów V1 (tekstury, normalne, materiał, LOD, mnożnik odległości LOD, gęstość dekoracji). */
  assets: QualityProfile;
  /** Maks. odległość rysowania (m) dla każdej kategorii; za nią obiekt jest odcinany. */
  distance: Record<ViewKind, number>;
  /** Odległość kamery (m), w której mgła osiąga ok. 96% (Exp2). Mgła tuszuje odcięcie najdalszych obiektów. */
  fogVisibility: number;
  shadows: {
    enabled: boolean;
    mapSize: number;
    /** Promień (m) wokół gracza pokryty mapą cieni. */
    distance: number;
    /** Obiekty rzucające cień w tym promieniu od kamery zostają także poza stożkiem widzenia (cień nie znika przy obrocie głowy). */
    keepRange: number;
  };
  /** Rozdzielczość tekstury gruntu (px) dla okna 3 x 3 sektory. */
  groundTexture: number;
  /** Rozmiar oczka siatki gruntu (m). */
  groundCell: number;
  /** Mnożnik rozdzielczości renderowania względem min(devicePixelRatio, pixelRatioCap). */
  renderScale: number;
  pixelRatioCap: number;
  atmosphere: { sky: boolean; particles: number; wind: boolean };
};

const dist = (tree: number, small: number): Record<ViewKind, number> => ({
  tree,
  rock: tree * 0.85,
  bush: tree * 0.7,
  fern: small * 1.35,
  plant: small * 1.1,
  grass: small,
  flower: small * 1.2,
  mushroom: small * 0.9,
});

export const VIEW_PROFILES: Record<QualityId, ForestViewProfile> = {
  LOW: {
    id: "LOW",
    assets: QUALITY_PROFILES.LOW,
    distance: dist(60, 22),
    fogVisibility: 58,
    shadows: { enabled: false, mapSize: 1024, distance: 30, keepRange: 0 },
    groundTexture: 1024,
    groundCell: 1.25,
    renderScale: 0.8,
    pixelRatioCap: 1,
    atmosphere: { sky: true, particles: 0, wind: false },
  },
  MEDIUM: {
    id: "MEDIUM",
    assets: QUALITY_PROFILES.MEDIUM,
    distance: dist(95, 34),
    fogVisibility: 90,
    shadows: { enabled: true, mapSize: 1536, distance: 42, keepRange: 22 },
    groundTexture: 1536,
    groundCell: 0.9,
    renderScale: 1,
    pixelRatioCap: 1.5,
    atmosphere: { sky: true, particles: 120, wind: true },
  },
  HIGH: {
    id: "HIGH",
    assets: QUALITY_PROFILES.HIGH,
    distance: dist(140, 48),
    fogVisibility: 130,
    shadows: { enabled: true, mapSize: 2048, distance: 62, keepRange: 30 },
    groundTexture: 2048,
    groundCell: 0.7,
    renderScale: 1,
    pixelRatioCap: 2,
    atmosphere: { sky: true, particles: 280, wind: true },
  },
};

export function getViewProfile(id: QualityId): ForestViewProfile {
  return VIEW_PROFILES[id];
}

export type ViewOverrides = {
  fog: boolean;
  shadows: boolean;
  /** Wymuszony poziom LOD do porównań; null = automatycznie. */
  forceLod: 0 | 1 | null;
  wind: boolean;
  /** Mnożnik wszystkich odległości rysowania (tryb obciążeniowy). */
  distanceScale: number;
};

export const DEFAULT_OVERRIDES: ViewOverrides = { fog: true, shadows: true, forceLod: null, wind: true, distanceScale: 1 };
