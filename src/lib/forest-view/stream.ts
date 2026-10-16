import type { QualityId } from "@/lib/assets";
import type { Bounds } from "@/lib/game/world/bounds";

/**
 * Planowanie streamingu sektorów lasu (czysta logika, bez Three.js). Las ma sektory siatki `nx x nz`; wokół gracza
 * trzymamy okno o promieniu `radius` sektorów (Chebyshev). Wyładowujemy dopiero sektory poza `radius + evictMargin`,
 * więc ruch tam i z powrotem na granicy sektorów nie powoduje ładowania i zwalniania w kółko (histereza).
 */
export type SectorCoord = { ix: number; iz: number };
export type SectorGrid = { nx: number; nz: number };

export const sectorKey = (c: SectorCoord): string => `${c.ix}_${c.iz}`;

/** Promień okna sektorów (30 m każdy) wg jakości: pokrywa zasięg mgły danego profilu (patrz profiles.ts). */
export const STREAM_RADIUS: Record<QualityId, number> = { LOW: 2, MEDIUM: 3, HIGH: 4 };
/** Rozdzielczość tekstury gruntu jednego sektora (px); MEDIUM ~17 px/m jak w prototypie. */
export const TILE_PIXELS: Record<QualityId, number> = { LOW: 320, MEDIUM: 512, HIGH: 512 };
/** Zapas tekstury poza sektorem (m): filtrowanie dwuliniowe i mipmapy na krawędzi czytają dane sąsiada, więc szwów nie widać. */
export const TILE_PAD = 1;
/** Sektory (Chebyshev) ładowane przed pokazaniem lasu; reszta okna dociąga się w tle. */
export const INITIAL_RING = 2;

export type StreamPlan = {
  center: SectorCoord;
  /** Sektory do załadowania, od najbliższych pozycji gracza. */
  load: SectorCoord[];
  /** Klucze załadowanych sektorów, które wypadły poza okno z zapasem. */
  evict: string[];
};

const cheb = (a: SectorCoord, b: SectorCoord) => Math.max(Math.abs(a.ix - b.ix), Math.abs(a.iz - b.iz));

/** Sektor zawierający punkt (współrzędne poza lasem są przycinane do skrajnych sektorów). */
export function sectorCoordAt(region: { bounds: Bounds; sectorSize: number }, grid: SectorGrid, x: number, z: number): SectorCoord {
  const ix = Math.floor((x - region.bounds.minX) / region.sectorSize);
  const iz = Math.floor((z - region.bounds.minZ) / region.sectorSize);
  return { ix: Math.max(0, Math.min(grid.nx - 1, ix)), iz: Math.max(0, Math.min(grid.nz - 1, iz)) };
}

export function sectorsAround(grid: SectorGrid, center: SectorCoord, radius: number): SectorCoord[] {
  const out: SectorCoord[] = [];
  for (let iz = Math.max(0, center.iz - radius); iz <= Math.min(grid.nz - 1, center.iz + radius); iz++) {
    for (let ix = Math.max(0, center.ix - radius); ix <= Math.min(grid.nx - 1, center.ix + radius); ix++) out.push({ ix, iz });
  }
  return out;
}

export function sectorCenter(region: { bounds: Bounds; sectorSize: number }, c: SectorCoord): { x: number; z: number } {
  return {
    x: region.bounds.minX + (c.ix + 0.5) * region.sectorSize,
    z: region.bounds.minZ + (c.iz + 0.5) * region.sectorSize,
  };
}

export function planStream(
  region: { bounds: Bounds; sectorSize: number },
  grid: SectorGrid,
  x: number,
  z: number,
  radius: number,
  loaded: ReadonlySet<string>,
  evictMargin = 1,
): StreamPlan {
  const center = sectorCoordAt(region, grid, x, z);
  const dist = (c: SectorCoord) => {
    const p = sectorCenter(region, c);
    return (p.x - x) ** 2 + (p.z - z) ** 2;
  };
  const load = sectorsAround(grid, center, radius)
    .filter((c) => !loaded.has(sectorKey(c)))
    .sort((a, b) => dist(a) - dist(b) || a.iz - b.iz || a.ix - b.ix);
  const evict: string[] = [];
  for (const key of loaded) {
    const [ix, iz] = key.split("_").map(Number);
    if (cheb({ ix, iz }, center) > radius + evictMargin) evict.push(key);
  }
  return { center, load, evict: evict.sort() };
}

/** Granice tekstury sektora z zapasem. */
export function tileTextureBounds(sector: Bounds, pad = TILE_PAD): Bounds {
  return { minX: sector.minX - pad, minZ: sector.minZ - pad, maxX: sector.maxX + pad, maxZ: sector.maxZ + pad };
}

/** Przeskalowuje UV siatki sektora (0..1) do wnętrza tekstury z zapasem. */
export function padUvs(uvs: Float32Array, sectorSize: number, pad = TILE_PAD): void {
  const span = sectorSize + 2 * pad;
  const lo = pad / span;
  const k = sectorSize / span;
  for (let i = 0; i < uvs.length; i++) uvs[i] = lo + uvs[i] * k;
}
