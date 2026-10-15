/**
 * Profile jakości grafiki zasobów. To punkt wyjścia do strojenia w V2; wartości nie są jeszcze zmierzone na docelowych urządzeniach.
 */
export type QualityId = "LOW" | "MEDIUM" | "HIGH";

export type QualityProfile = {
  id: QualityId;
  /** Wariant tekstur: "full" = max 1024 px, "low" = max 512 px. */
  textures: "full" | "low";
  normalMaps: boolean;
  /** Maks. filtrowanie anizotropowe tekstur (renderer przytnie do swojego limitu). */
  anisotropy: number;
  materialKind: "standard" | "lambert";
  /** Miękkie krawędzie liści (wymaga MSAA w rendererze). */
  alphaToCoverage: boolean;
  /** Najniższy dozwolony poziom LOD (LOW używa LOD1 od razu, jeśli model go ma). */
  minLod: number;
  /** Mnożnik odległości przełączania LOD (mniejszy = LOD1 wcześniej). */
  lodDistanceScale: number;
  /** Mnożnik gęstości roślinności i dekoracji dla generatora widoku (kolizje i świat nie zależą od niego). */
  decorDensity: number;
  shadows: boolean;
  pixelRatioCap: number;
};

export const QUALITY_PROFILES: Record<QualityId, QualityProfile> = {
  LOW: {
    id: "LOW", textures: "low", normalMaps: false, anisotropy: 1, materialKind: "lambert", alphaToCoverage: false,
    minLod: 1, lodDistanceScale: 0.4, decorDensity: 0.5, shadows: false, pixelRatioCap: 1,
  },
  MEDIUM: {
    id: "MEDIUM", textures: "full", normalMaps: false, anisotropy: 4, materialKind: "standard", alphaToCoverage: false,
    minLod: 0, lodDistanceScale: 0.7, decorDensity: 0.75, shadows: true, pixelRatioCap: 1.5,
  },
  HIGH: {
    id: "HIGH", textures: "full", normalMaps: true, anisotropy: 8, materialKind: "standard", alphaToCoverage: true,
    minLod: 0, lodDistanceScale: 1, decorDensity: 1, shadows: true, pixelRatioCap: 2,
  },
};

export const DEFAULT_QUALITY: QualityId = "MEDIUM";

export function getQualityProfile(id: QualityId): QualityProfile {
  return QUALITY_PROFILES[id];
}
