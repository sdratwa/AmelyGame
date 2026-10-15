import type { RegionId, SectorId } from "../core/ids";

/** Układ współrzędnych świata: 1 jednostka = 1 metr, x i z poziomo, y w górę. */
export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

export function boundsContain(b: Bounds, x: number, z: number, margin = 0): boolean {
  return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

/**
 * Region świata jako dane: własne granice i rozmiar sektora (różne regiony mogą mieć różne rozmiary).
 * `unlockedBy` to flaga świata; bez niej region jest dostępny od początku.
 */
export type RegionDef = {
  id: RegionId;
  bounds: Bounds;
  sectorSize: number;
  unlockedBy?: string;
};

/** Początkowy las: 300 x 300 m, sektory 30 x 30 m (dane z dokumentacji, nie ostateczny układ lokacji). */
export const FOREST_START_REGION: RegionDef = {
  id: "region.forest_start",
  bounds: { minX: -150, minZ: -150, maxX: 150, maxZ: 150 },
  sectorSize: 30,
};

export function defineRegion(region: RegionDef): RegionDef {
  const { bounds: b } = region;
  const finite = [b.minX, b.minZ, b.maxX, b.maxZ, region.sectorSize].every(Number.isFinite);
  if (!finite || b.minX >= b.maxX || b.minZ >= b.maxZ || region.sectorSize <= 0) {
    throw new Error(`Niepoprawny region ${region.id}`);
  }
  if (regionKey(region).includes(".") || regionKey(region) === "") {
    throw new Error(`Identyfikator regionu ${region.id} nie może zawierać dodatkowych kropek`);
  }
  return region;
}

/** Część identyfikatora regionu bez prefiksu `region.` (np. `forest_start`). */
export function regionKey(region: Pick<RegionDef, "id">): string {
  return region.id.slice("region.".length);
}

export function regionUnlocked(region: RegionDef, flags: { has(flag: string): boolean }): boolean {
  return !region.unlockedBy || flags.has(region.unlockedBy);
}

export type SectorCoord = { regionId: RegionId; ix: number; iz: number };

export function sectorCount(region: RegionDef): { nx: number; nz: number } {
  return {
    nx: Math.ceil((region.bounds.maxX - region.bounds.minX) / region.sectorSize),
    nz: Math.ceil((region.bounds.maxZ - region.bounds.minZ) / region.sectorSize),
  };
}

/**
 * Sektor punktu. Granice sektorów są domknięte od dołu (x = minX + k * rozmiar należy do sektora k),
 * a krawędź maksymalna regionu należy do ostatniego sektora. Poza regionem: null.
 * Sektory są tylko logiczną siatką – nie wpływają na ruch.
 */
export function sectorOf(region: RegionDef, x: number, z: number): SectorCoord | null {
  if (!boundsContain(region.bounds, x, z)) return null;
  const { nx, nz } = sectorCount(region);
  const ix = Math.min(nx - 1, Math.floor((x - region.bounds.minX) / region.sectorSize));
  const iz = Math.min(nz - 1, Math.floor((z - region.bounds.minZ) / region.sectorSize));
  return { regionId: region.id, ix, iz };
}

export function sectorId(region: Pick<RegionDef, "id">, ix: number, iz: number): SectorId {
  return `sector.${regionKey(region)}.${ix}_${iz}`;
}

export function parseSectorId(id: string): { regionKey: string; ix: number; iz: number } | null {
  const m = /^sector\.([a-z0-9_]+)\.(\d+)_(\d+)$/.exec(id);
  return m ? { regionKey: m[1], ix: Number(m[2]), iz: Number(m[3]) } : null;
}

export function sectorBounds(region: RegionDef, ix: number, iz: number): Bounds {
  const { bounds: b, sectorSize: s } = region;
  return {
    minX: b.minX + ix * s,
    minZ: b.minZ + iz * s,
    maxX: Math.min(b.maxX, b.minX + (ix + 1) * s),
    maxZ: Math.min(b.maxZ, b.minZ + (iz + 1) * s),
  };
}

/**
 * Sektory, które przecina prostokąt (np. obwiednia obiektu na granicy sektorów).
 * Obszar jest przycinany do regionu; zwykły dotyk linii podziału nie dodaje sąsiedniego sektora.
 */
export function sectorsOverlapping(region: RegionDef, area: Bounds): SectorCoord[] {
  const b = region.bounds;
  if (!boundsOverlap(area, b)) return [];
  const { nx, nz } = sectorCount(region);
  const s = region.sectorSize;
  const lo = (v: number, min: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor((v - min) / s)));
  const hi = (v: number, min: number, n: number) => Math.max(0, Math.min(n - 1, Math.ceil((v - min) / s) - 1));
  const ix0 = lo(Math.max(area.minX, b.minX), b.minX, nx);
  const iz0 = lo(Math.max(area.minZ, b.minZ), b.minZ, nz);
  const ix1 = Math.max(ix0, hi(Math.min(area.maxX, b.maxX), b.minX, nx));
  const iz1 = Math.max(iz0, hi(Math.min(area.maxZ, b.maxZ), b.minZ, nz));
  const out: SectorCoord[] = [];
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) out.push({ regionId: region.id, ix, iz });
  }
  return out;
}

/** Pierwszy dostępny region zawierający punkt (regiony nie powinny na siebie zachodzić). */
export function regionAt(
  regions: readonly RegionDef[],
  x: number,
  z: number,
  flags?: { has(flag: string): boolean },
  margin = 0,
): RegionDef | null {
  for (const region of regions) {
    if (flags && !regionUnlocked(region, flags)) continue;
    if (boundsContain(region.bounds, x, z, margin)) return region;
  }
  return null;
}

const OBJECT_ID = /^([a-z][a-z0-9_]*)\.([a-z0-9_]+)\.(\d+)_(\d+)\.(\d+)$/;

/**
 * Stabilny identyfikator obiektu: `rodzaj.region.ix_iz.numer`, np. `tree.forest_start.3_4.17`.
 * Sektor i numer nadaje generator w chwili tworzenia; ID nie zmienia się, gdy obiekt zostanie ruszony.
 */
export function objectId(kind: string, region: Pick<RegionDef, "id">, ix: number, iz: number, n: number): string {
  if (!/^[a-z][a-z0-9_]*$/.test(kind)) throw new Error(`Niepoprawny rodzaj obiektu: ${kind}`);
  return `${kind}.${regionKey(region)}.${ix}_${iz}.${n}`;
}

export function parseObjectId(
  id: string,
): { kind: string; regionKey: string; ix: number; iz: number; n: number } | null {
  const m = OBJECT_ID.exec(id);
  return m ? { kind: m[1], regionKey: m[2], ix: Number(m[3]), iz: Number(m[4]), n: Number(m[5]) } : null;
}
