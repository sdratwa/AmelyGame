import type { ForestSector, ForestWorld } from "./forest";

export type ShowcaseMetrics = {
  trees: number;
  treeGroups: number;
  treeScaleSpread: number;
  rocks: number;
  ferns: number;
  lowVegetation: number;
  pathLength: number;
  heightRange: number;
  nearWater: boolean;
};

export type ShowcaseSector = {
  ix: number;
  iz: number;
  id: string;
  score: number;
  /** Czy sektor spełnia wszystkie progi (drzewa różnej wielkości, skały, paprocie, runo, ścieżka, zróżnicowana wysokość). */
  qualifies: boolean;
  metrics: ShowcaseMetrics;
};

const LOW_KINDS = new Set(["grass", "flower", "plant", "clover"]);

function groupOf(variant: string | undefined): string {
  if (variant?.startsWith("pine")) return "pine";
  if (variant?.startsWith("twisted")) return "ancient";
  return "broadleaf";
}

export function showcaseMetrics(forest: ForestWorld, sector: ForestSector): ShowcaseMetrics {
  const groups = new Set<string>();
  let minScale = Infinity;
  let maxScale = 0;
  let trees = 0;
  let rocks = 0;
  let ferns = 0;
  let low = 0;
  for (const o of sector.objects) {
    if (o.kind === "tree") {
      trees++;
      groups.add(groupOf(o.variant));
      const s = o.scale ?? 1;
      minScale = Math.min(minScale, s);
      maxScale = Math.max(maxScale, s);
    } else if (o.kind === "rock") rocks++;
    else if (o.kind === "fern") ferns++;
    else if (LOW_KINDS.has(o.kind)) low++;
  }
  const b = sector.bounds;
  let hMin = Infinity;
  let hMax = -Infinity;
  let nearWater = false;
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const x = b.minX + ((b.maxX - b.minX) * i) / 6;
      const z = b.minZ + ((b.maxZ - b.minZ) * j) / 6;
      const h = forest.terrain.height(x, z);
      hMin = Math.min(hMin, h);
      hMax = Math.max(hMax, h);
      if (forest.geometry.waterGap(x, z) < 6) nearWater = true;
    }
  }
  return {
    trees,
    treeGroups: groups.size,
    treeScaleSpread: trees > 0 ? maxScale - minScale : 0,
    rocks,
    ferns,
    lowVegetation: low,
    pathLength: forest.geometry.trailLengthIn(b),
    heightRange: hMax - hMin,
    nearWater,
  };
}

const THRESHOLDS = { trees: 8, treeGroups: 2, treeScaleSpread: 0.3, rocks: 2, ferns: 10, lowVegetation: 60, pathLength: 12, heightRange: 0.6 };

/**
 * Wybiera reprezentatywne sektory do prototypu wizualnego V2: z drzewami różnej wielkości i gatunku, skałami, paprociami,
 * niską roślinnością, fragmentem ścieżki i zróżnicowaną wysokością terenu, ale bez rzeki. Sektory nie są modyfikowane
 * ani wyrównywane – to istniejące sektory świata, więc ich gęstość pozostaje naturalnie zróżnicowana.
 */
export function pickShowcaseSectors(forest: ForestWorld, count = 3): ShowcaseSector[] {
  const out: ShowcaseSector[] = [];
  for (const sector of forest.allSectors()) {
    const m = showcaseMetrics(forest, sector);
    const ratio = (v: number, t: number) => Math.min(1.5, v / t);
    const qualifies =
      !m.nearWater &&
      m.trees >= THRESHOLDS.trees &&
      m.treeGroups >= THRESHOLDS.treeGroups &&
      m.treeScaleSpread >= THRESHOLDS.treeScaleSpread &&
      m.rocks >= THRESHOLDS.rocks &&
      m.ferns >= THRESHOLDS.ferns &&
      m.lowVegetation >= THRESHOLDS.lowVegetation &&
      m.pathLength >= THRESHOLDS.pathLength &&
      m.heightRange >= THRESHOLDS.heightRange;
    const score =
      ratio(m.trees, THRESHOLDS.trees) +
      ratio(m.treeGroups, THRESHOLDS.treeGroups) +
      ratio(m.treeScaleSpread, THRESHOLDS.treeScaleSpread) +
      ratio(m.rocks, THRESHOLDS.rocks) +
      ratio(m.ferns, THRESHOLDS.ferns) +
      ratio(m.lowVegetation, THRESHOLDS.lowVegetation) +
      ratio(m.pathLength, THRESHOLDS.pathLength) +
      ratio(m.heightRange, THRESHOLDS.heightRange) -
      (m.nearWater ? 4 : 0);
    out.push({ ix: sector.ix, iz: sector.iz, id: sector.id, score, qualifies, metrics: m });
  }
  out.sort((a, b) => Number(b.qualifies) - Number(a.qualifies) || b.score - a.score || a.iz - b.iz || a.ix - b.ix);
  return out.slice(0, count);
}
