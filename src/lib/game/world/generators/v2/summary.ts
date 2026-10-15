import type { ForestWorld } from "./forest";

export type KindStats = { total: number; per100m2: number; sectorMin: number; sectorMedian: number; sectorMax: number };

export type ForestSummary = {
  sectors: number;
  areaM2: number;
  totalObjects: number;
  colliders: number;
  byKind: Record<string, KindStats>;
  byModel: Record<string, number>;
  trianglesLod0: number;
  /** Przybliżone trójkąty w LOD 0 dla najgęstszego okna 7 x 7 sektorów. */
  trianglesWorstWindow: number;
};

/** Zestawienie liczby obiektów i gęstości (do raportu i testów); liczy wszystkie sektory. */
export function summarizeForest(forest: ForestWorld, triangles?: ReadonlyMap<string, number>): ForestSummary {
  const sectors = forest.allSectors();
  const area = (forest.region.bounds.maxX - forest.region.bounds.minX) * (forest.region.bounds.maxZ - forest.region.bounds.minZ);
  const perKind = new Map<string, number[]>();
  for (const s of sectors) for (const kind of Object.keys(s.counts)) if (!perKind.has(kind)) perKind.set(kind, new Array(sectors.length).fill(0));
  const byModel: Record<string, number> = {};
  let colliders = 0;
  let total = 0;
  let tris = 0;
  const sectorTris: number[] = [];
  sectors.forEach((s, i) => {
    let t = 0;
    for (const [kind, n] of Object.entries(s.counts)) perKind.get(kind)![i] = n;
    for (const [model, list] of s.byModel) {
      byModel[model] = (byModel[model] ?? 0) + list.length;
      t += (triangles?.get(model) ?? 0) * list.length;
    }
    sectorTris.push(t);
    tris += t;
    colliders += s.colliders.length;
    total += s.objects.length;
  });
  const byKind: Record<string, KindStats> = {};
  for (const [kind, list] of perKind) {
    const sorted = [...list].sort((a, b) => a - b);
    const sum = list.reduce((a, b) => a + b, 0);
    byKind[kind] = {
      total: sum,
      per100m2: (sum / area) * 100,
      sectorMin: sorted[0],
      sectorMedian: sorted[sorted.length >> 1],
      sectorMax: sorted[sorted.length - 1],
    };
  }
  const { nx, nz } = forest.sectorGrid;
  let worst = 0;
  for (let iz = 0; iz + 7 <= nz || iz === 0; iz++) {
    for (let ix = 0; ix + 7 <= nx || ix === 0; ix++) {
      let sum = 0;
      for (let dz = 0; dz < Math.min(7, nz); dz++) {
        for (let dx = 0; dx < Math.min(7, nx); dx++) sum += sectorTris[(iz + dz) * nx + ix + dx];
      }
      worst = Math.max(worst, sum);
    }
  }
  return { sectors: sectors.length, areaM2: area, totalObjects: total, colliders, byKind, byModel, trianglesLod0: tris, trianglesWorstWindow: worst };
}
