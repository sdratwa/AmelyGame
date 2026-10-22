import * as THREE from "three";
import type { LevelSelector, ModelAsset } from "@/lib/assets";
import type { ModelBatch } from "./window";
import { SHADOW_CASTERS, type ForestViewProfile, type ViewKind, type ViewOverrides } from "./profiles";

/** Skład rzadzenia: tylko drobna roślinność; drzewa, skały i krzewy nigdy nie znikają "z gęstości". */
const THINNED: ReadonlySet<ViewKind> = new Set(["grass", "flower", "plant", "fern", "mushroom", "decor"]);

/** Histereza LOD: powrót do wyższej jakości dopiero po przekroczeniu 92% progu, w którym nastąpiło przełączenie. */
export const LOD_HYSTERESIS = 0.92;
/** Rozrzut progu LOD między instancjami (+-12%): pierścień drzew nie zmienia sylwetek w jednej klatce. */
export const LOD_JITTER = 0.12;

export type SelectorContext = {
  profile: ForestViewProfile;
  overrides: ViewOverrides;
  camera: THREE.Vector3;
  frustum: THREE.Frustum;
  /** Wyłączone, gdy cienie są wyłączone: wtedy też rzucające cień podlegają odcinaniu frustum. */
  shadowKeepRange: number;
};

const sphere = new THREE.Sphere();

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Indeks poziomu w `asset.levels`, który odpowiada wymuszonemu LOD (brak poziomu = najbliższy załadowany). */
export function forcedLevelIndex(asset: ModelAsset, forced: 0 | 1): number {
  let best = 0;
  for (let i = 0; i < asset.levels.length; i++) {
    if (asset.levels[i].level <= forced) best = i;
  }
  return best;
}

/** Poziom LOD dla odległości z histerezą i rozrzutem progów; `previous` < 0 = bez historii. */
export function chooseLevel(asset: ModelAsset, distance: number, lodScale: number, jitter: number, previous: number): number {
  const last = asset.levels.length - 1;
  if (last <= 0) return 0;
  const threshold = (i: number) => asset.levels[i].minDistance * lodScale * (1 + LOD_JITTER * jitter);
  let level = previous >= 0 && previous <= last ? previous : 0;
  while (level < last && distance >= threshold(level + 1)) level++;
  while (level > 0 && distance < threshold(level) * LOD_HYSTERESIS) level--;
  return level;
}

export function frustumFor(camera: THREE.PerspectiveCamera, fovMargin = 1.18): THREE.Frustum {
  const wide = camera.clone();
  wide.fov = Math.min(150, camera.fov * fovMargin);
  wide.updateProjectionMatrix();
  wide.updateMatrixWorld(true);
  const m = new THREE.Matrix4().multiplyMatrices(wide.projectionMatrix, wide.matrixWorldInverse);
  return new THREE.Frustum().setFromProjectionMatrix(m);
}

/**
 * Reguła widoczności jednej partii instancji: odcięcie odległościowe wg kategorii, rzadzenie drobnej roślinności
 * (stałe w czasie, rosnące z odległością), frustum culling na poziomie instancji (poza zasięgiem cieni dla obiektów
 * rzucających cień, żeby cień nie znikał po odwróceniu głowy) i LOD z histerezą. Nie zmienia świata, tylko widok.
 */
export function createBatchSelector(ctx: SelectorContext, batch: ModelBatch, asset: ModelAsset): LevelSelector {
  const { profile, overrides, camera, frustum } = ctx;
  const maxDistance = Math.min(profile.distance[batch.kind] * overrides.distanceScale, 400);
  const thinned = THINNED.has(batch.kind);
  const density = batch.kind === "fern" ? Math.sqrt(profile.assets.decorDensity) : profile.assets.decorDensity;
  const casts = profile.shadows.enabled && overrides.shadows && SHADOW_CASTERS.has(batch.kind);
  const keepRange = casts ? ctx.shadowKeepRange : 0;
  const lodScale = profile.assets.lodDistanceScale;
  const forced = overrides.forceLod === null ? -1 : forcedLevelIndex(asset, overrides.forceLod);
  const fadeStart = maxDistance * 0.55;
  const { rank, radius, centerY, jitter } = batch;

  return (i, x, y, z, previous) => {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const dz = z - camera.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxDistance) return -1;
    if (thinned && rank[i] >= density * (1 - smoothstep(fadeStart, maxDistance, d))) return -1;
    if (d > keepRange) {
      sphere.center.set(x, y + centerY[i], z);
      sphere.radius = radius[i];
      if (!frustum.intersectsSphere(sphere)) return -1;
    }
    if (forced >= 0) return forced;
    return chooseLevel(asset, d, lodScale, jitter[i], previous);
  };
}
