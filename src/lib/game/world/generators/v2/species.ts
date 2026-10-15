/**
 * Tabela gatunków generatora W1a: zamrożona kopia danych potrzebnych do rozsiewu (kolizje, rozmiary, skale).
 * Świat nie zależy od manifestu GLB w czasie działania; zgodność z manifestem pilnuje test
 * (`forest.assets.test.ts`). Identyfikator modelu to `rodzaj.wariant`.
 */

export type LayerId = "tree" | "ancient" | "rock" | "bush" | "fern" | "plant" | "grass" | "flower" | "mushroom";

export type SpeciesGroup =
  | "broadleaf"
  | "pine"
  | "ancient"
  | "rock"
  | "plain"
  | "flowering"
  | "fern"
  | "leafy"
  | "ground"
  | "clover"
  | "common"
  | "wispy"
  | "flower"
  | "mushroom";

export type Species = {
  /** Identyfikator modelu w manifeście (`rodzaj.wariant`). */
  model: string;
  kind: string;
  variant: string;
  layer: LayerId;
  group: SpeciesGroup;
  /** Promień kolizji (m) dla skali 1; null = da się przejść. */
  collider: number | null;
  /** Promień odstępu (m) w rzadzeniu drzew: korony mogą się nakładać, pnie nie. */
  crown: number;
  /** Połowa większego wymiaru podstawy (m) dla skali 1 – promień obwiedni w indeksie. */
  footprint: number;
  /** Zakres losowej skali. */
  scale: readonly [number, number];
  /** Wysokość modelu (m) dla skali 1. */
  height: number;
  triangles: number;
};

const sp = (
  model: string,
  layer: LayerId,
  group: SpeciesGroup,
  collider: number | null,
  crown: number,
  footprint: number,
  scale: readonly [number, number],
  height: number,
  triangles: number,
): Species => {
  const dot = model.indexOf(".");
  return { model, kind: model.slice(0, dot), variant: model.slice(dot + 1), layer, group, collider, crown, footprint, scale, height, triangles };
};

const BROADLEAF: readonly [number, number] = [0.8, 1.35];
const PINE: readonly [number, number] = [0.8, 1.4];

export const SPECIES: readonly Species[] = [
  sp("tree.common.1", "tree", "broadleaf", 0.52, 1.3, 2.29, BROADLEAF, 7.26, 6265),
  sp("tree.common.2", "tree", "broadleaf", 0.5, 1.3, 2.23, BROADLEAF, 7.64, 5648),
  sp("tree.common.3", "tree", "broadleaf", 0.51, 1.25, 2.12, BROADLEAF, 9.43, 3505),
  sp("tree.common.4", "tree", "broadleaf", 0.54, 1.2, 1.91, BROADLEAF, 9.44, 4066),
  sp("tree.common.5", "tree", "broadleaf", 0.48, 1.2, 2.11, BROADLEAF, 7.01, 3182),
  sp("tree.pine.1", "tree", "pine", 0.2, 1.25, 2.47, PINE, 7.32, 3947),
  sp("tree.pine.3", "tree", "pine", 0.2, 1.2, 2.0, PINE, 7.39, 4964),
  sp("tree.pine.5", "tree", "pine", 0.37, 1.8, 3.21, PINE, 8.72, 1646),
  sp("tree.twisted.1", "ancient", "ancient", 0.85, 3.2, 4.73, [0.9, 1.3], 11.71, 9564),
  sp("tree.twisted.3", "ancient", "ancient", 0.76, 3.0, 4.03, [0.9, 1.3], 11.25, 10089),
  sp("rock.medium.1", "rock", "rock", 1.32, 0, 1.61, [1, 1], 2.26, 342),
  sp("rock.medium.2", "rock", "rock", 1.18, 0, 1.52, [1, 1], 1.9, 244),
  sp("rock.medium.3", "rock", "rock", 1.47, 0, 1.74, [1, 1], 2.32, 522),
  sp("bush.common", "bush", "plain", null, 0.9, 0.98, [0.7, 1.5], 1.58, 900),
  sp("bush.common_flowers", "bush", "flowering", null, 0.9, 0.98, [0.7, 1.5], 1.58, 1368),
  sp("fern.1", "fern", "fern", null, 0, 0.85, [0.8, 1.6], 0.5, 288),
  sp("plant.1", "plant", "leafy", null, 0, 0.55, [0.8, 1.4], 0.81, 120),
  sp("plant.1_big", "plant", "leafy", null, 0, 0.68, [0.8, 1.4], 1.64, 360),
  sp("plant.7", "plant", "ground", null, 0, 0.52, [0.8, 1.5], 0.25, 48),
  sp("plant.7_big", "plant", "ground", null, 0, 0.68, [0.8, 1.5], 0.25, 112),
  sp("clover.1", "plant", "clover", null, 0, 0.28, [0.8, 1.5], 0.8, 379),
  sp("clover.2", "plant", "clover", null, 0, 0.3, [0.8, 1.5], 0.89, 615),
  sp("grass.common_short", "grass", "common", null, 0, 0.19, [0.8, 1.5], 0.67, 155),
  sp("grass.common_tall", "grass", "common", null, 0, 0.23, [0.8, 1.5], 0.84, 326),
  sp("grass.wispy_short", "grass", "wispy", null, 0, 0.33, [0.8, 1.5], 0.54, 494),
  sp("grass.wispy_tall", "grass", "wispy", null, 0, 0.36, [0.8, 1.5], 0.75, 622),
  sp("flower.3_single", "flower", "flower", null, 0, 0.16, [0.8, 1.4], 0.72, 285),
  sp("flower.3_group", "flower", "flower", null, 0, 0.32, [0.8, 1.4], 0.82, 755),
  sp("flower.4_single", "flower", "flower", null, 0, 0.19, [0.8, 1.4], 0.85, 642),
  sp("flower.4_group", "flower", "flower", null, 0, 0.36, [0.8, 1.4], 0.99, 1690),
  sp("mushroom.common", "mushroom", "mushroom", null, 0, 0.39, [0.6, 1.6], 0.46, 880),
];

export const SPECIES_BY_MODEL: ReadonlyMap<string, Species> = new Map(SPECIES.map((s) => [s.model, s]));

export function speciesOfGroup(group: SpeciesGroup): readonly Species[] {
  return SPECIES.filter((s) => s.group === group);
}

/** Klasy rozmiaru skał S/M/L (kopia z manifestu, `scaleClasses.rock`); `harvest` to podpowiedź dla mechaniki surowców. */
export const ROCK_CLASSES = {
  s: { scale: [0.28, 0.4], harvest: 1 },
  m: { scale: [0.55, 0.75], harvest: 2 },
  l: { scale: [0.95, 1.3], harvest: 5 },
} as const;
export type RockClass = keyof typeof ROCK_CLASSES;
export const ROCK_CLASS_IDS: readonly RockClass[] = ["s", "m", "l"];
export const ROCK_JITTER = { x: 0.12, y: 0.15, z: 0.12 } as const;
export const ROCK_MAX_TILT = 0.08;
