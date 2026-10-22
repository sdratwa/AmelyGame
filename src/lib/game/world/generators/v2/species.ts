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
  | "mushroom"
  // Grupy tylko z paczki Pro (katalog `SPECIES_ALL`, tryb deweloperski prototypu /dev/forest-pro).
  | "birch"
  | "giantpine"
  | "tallthick"
  | "blossom"
  | "dead"
  | "bushbig"
  | "bushlong"
  | "wide"
  | "wheat"
  | "rockbig"
  | "rockdesert"
  | "rockbigdesert"
  | "mushroomcap"
  | "bracket"
  | "pebble"
  | "petal"
  | "rockpath";

/** Warstwa gatunku: warstwy rozsiewu lasu plus `decor` (kamyki, płatki) i `path` (płyty brukowe) ustawiane osobnymi regułami. */
export type SpeciesLayer = LayerId | "decor" | "path";

export type Species = {
  /** Identyfikator modelu w manifeście (`rodzaj.wariant`). */
  model: string;
  kind: string;
  variant: string;
  layer: SpeciesLayer;
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
  layer: SpeciesLayer,
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

/**
 * Gatunki z paczki Stylized Nature MegaKit [Pro], których nie ma w Standard (85 modeli) plus 6 pustynnych wariantów skał.
 * Wartości policzone z `public/models/manifest.json` (rozmiary po `baseScale`, promień pnia z kory). Generator v2 ich NIE używa:
 * trafiają tylko do katalogu `SPECIES_ALL` używanego w trybie deweloperskim, więc zamrożony świat v2 się nie zmienia.
 */
export const SPECIES_PRO: readonly Species[] = [
  sp("tree.birch.1", "tree", "birch", 0.157, 1.2, 1.96, [0.85, 1.3], 8.23, 6378),
  sp("tree.birch.2", "tree", "birch", 0.156, 1.2, 2.0, [0.85, 1.3], 8.12, 6645),
  sp("tree.birch.3", "tree", "birch", 0.116, 1.45, 2.39, [0.85, 1.3], 8.01, 5821),
  sp("tree.birch.4", "tree", "birch", 0.15, 1.2, 1.99, [0.85, 1.3], 6.97, 5784),
  sp("tree.birch.5", "tree", "birch", 0.13, 1.2, 2.01, [0.85, 1.3], 8.23, 5106),
  sp("tree.cherry.1", "tree", "blossom", 0.487, 2.2, 3.67, [0.85, 1.25], 6.69, 12876),
  sp("tree.cherry.2", "tree", "blossom", 0.571, 1.85, 3.11, [0.85, 1.25], 5.78, 13172),
  sp("tree.cherry.3", "tree", "blossom", 0.401, 2.5, 4.15, [0.85, 1.25], 7.24, 14739),
  sp("tree.cherry.4", "tree", "blossom", 0.506, 2.0, 3.33, [0.85, 1.25], 6.68, 12391),
  sp("tree.cherry.5", "tree", "blossom", 0.491, 1.95, 3.25, [0.85, 1.25], 6.69, 12590),
  sp("tree.giantpine.1", "tree", "giantpine", 0.464, 2.1, 3.48, [0.8, 1.3], 12.02, 7482),
  sp("tree.giantpine.2", "tree", "giantpine", 0.461, 2.7, 4.46, [0.8, 1.3], 11.83, 7400),
  sp("tree.giantpine.3", "tree", "giantpine", 0.453, 2.65, 4.39, [0.8, 1.3], 9.18, 7296),
  sp("tree.giantpine.4", "tree", "giantpine", 0.463, 2.85, 4.71, [0.8, 1.3], 11.68, 6794),
  sp("tree.giantpine.5", "tree", "giantpine", 0.523, 3.35, 5.56, [0.8, 1.3], 11.16, 6988),
  sp("tree.tallthick.1", "tree", "tallthick", 0.59, 1.55, 2.58, [0.8, 1.3], 8.24, 7968),
  sp("tree.tallthick.2", "tree", "tallthick", 0.59, 1.3, 2.16, [0.8, 1.3], 8.35, 7129),
  sp("tree.tallthick.3", "tree", "tallthick", 0.609, 1.5, 2.54, [0.8, 1.3], 8.41, 7984),
  sp("tree.tallthick.4", "tree", "tallthick", 0.609, 1.65, 2.78, [0.8, 1.3], 8.4, 7304),
  sp("tree.tallthick.5", "tree", "tallthick", 0.623, 1.45, 2.41, [0.8, 1.3], 10.37, 7202),
  sp("tree.dead.1", "tree", "dead", 0.305, 1.1, 1.84, [0.8, 1.3], 5.7, 6169),
  sp("tree.dead.2", "tree", "dead", 0.385, 1.2, 2.02, [0.8, 1.3], 6.89, 6557),
  sp("tree.dead.3", "tree", "dead", 0.316, 1.15, 1.93, [0.8, 1.3], 7.97, 5802),
  sp("tree.dead.4", "tree", "dead", 0.388, 1.45, 2.39, [0.8, 1.3], 7.66, 5702),
  sp("tree.dead.5", "tree", "dead", 0.397, 1.5, 2.52, [0.8, 1.3], 9.86, 5648),
  sp("tree.pine.2", "tree", "pine", 0.199, 1.7, 2.86, [0.8, 1.4], 7.38, 3648),
  sp("tree.pine.4", "tree", "pine", 0.312, 1.75, 2.9, [0.8, 1.4], 10.24, 3370),
  sp("tree.twisted.2", "ancient", "ancient", 0.793, 2.2, 3.7, [0.9, 1.3], 13.26, 9134),
  sp("tree.twisted.4", "ancient", "ancient", 0.751, 2.35, 3.95, [0.9, 1.3], 13.12, 9600),
  sp("tree.twisted.5", "ancient", "ancient", 0.763, 2.0, 3.32, [0.9, 1.3], 10.96, 10104),
  sp("bush.large", "bush", "bushbig", null, 1.18, 1.28, [0.7, 1.5], 2.28, 864),
  sp("bush.large_flowers", "bush", "bushbig", null, 1.22, 1.33, [0.7, 1.5], 2.28, 1209),
  sp("bush.long.1", "bush", "bushlong", null, 0.54, 0.59, [0.7, 1.5], 1.66, 522),
  sp("bush.long.2", "bush", "bushlong", null, 0.52, 0.56, [0.7, 1.5], 1.93, 5393),
  sp("fern.2", "fern", "fern", null, 0, 0.54, [0.8, 1.6], 0.47, 180),
  sp("plant.2", "plant", "leafy", null, 0, 0.55, [0.8, 1.4], 1.25, 446),
  sp("plant.3", "plant", "leafy", null, 0, 0.74, [0.8, 1.4], 0.56, 560),
  sp("plant.4", "plant", "leafy", null, 0, 0.74, [0.8, 1.4], 1.26, 560),
  sp("plant.5", "plant", "leafy", null, 0, 0.61, [0.8, 1.4], 1.11, 550),
  sp("plant.6", "plant", "leafy", null, 0, 0.39, [0.8, 1.4], 0.74, 180),
  sp("plant.2_big", "plant", "leafy", null, 0, 0.48, [0.8, 1.4], 1.94, 434),
  sp("grass.wheat", "grass", "wheat", null, 0, 0.28, [0.8, 1.5], 0.89, 1190),
  sp("grass.wide_short", "grass", "wide", null, 0, 0.27, [0.8, 1.5], 0.65, 370),
  sp("grass.wide_tall", "grass", "wide", null, 0, 0.26, [0.8, 1.5], 0.72, 506),
  sp("flower.1_single", "flower", "flower", null, 0, 0.12, [0.8, 1.4], 0.69, 135),
  sp("flower.1_group", "flower", "flower", null, 0, 0.41, [0.8, 1.4], 0.67, 1571),
  sp("flower.2_single", "flower", "flower", null, 0, 0.16, [0.8, 1.4], 0.76, 293),
  sp("flower.2_group", "flower", "flower", null, 0, 0.34, [0.8, 1.4], 0.71, 942),
  sp("flower.6", "flower", "flower", null, 0, 0.39, [0.8, 1.4], 0.13, 93),
  sp("flower.6_2", "flower", "flower", null, 0, 0.38, [0.8, 1.4], 0.12, 109),
  sp("flower.7_single", "flower", "flower", null, 0, 0.23, [0.8, 1.4], 0.71, 286),
  sp("flower.7_group", "flower", "flower", null, 0, 0.41, [0.8, 1.4], 0.77, 1078),
  sp("mushroom.laetiporus", "mushroom", "bracket", null, 0, 0.48, [0.6, 1.6], 0.54, 3216),
  sp("mushroom.oyster", "mushroom", "bracket", null, 0, 0.6, [0.6, 1.6], 0.89, 1640),
  sp("mushroom.redcap", "mushroom", "mushroomcap", null, 0, 0.51, [0.6, 1.6], 0.55, 704),
  sp("rock.medium.4", "rock", "rock", 1.57, 0, 1.89, [1, 1], 2.48, 400),
  sp("rock.big.1", "rock", "rockbig", 2.05, 0, 2.6, [1, 1], 4.58, 1736),
  sp("rock.big.2", "rock", "rockbig", 2.461, 0, 2.91, [1, 1], 3.81, 1944),
  sp("pebble.round.1", "decor", "pebble", null, 0, 0.25, [0.8, 1.2], 0.1, 136),
  sp("pebble.round.2", "decor", "pebble", null, 0, 0.22, [0.8, 1.2], 0.09, 114),
  sp("pebble.round.3", "decor", "pebble", null, 0, 0.24, [0.8, 1.2], 0.1, 128),
  sp("pebble.round.4", "decor", "pebble", null, 0, 0.23, [0.8, 1.2], 0.1, 126),
  sp("pebble.round.5", "decor", "pebble", null, 0, 0.21, [0.8, 1.2], 0.1, 124),
  sp("pebble.square.1", "decor", "pebble", null, 0, 0.22, [0.8, 1.2], 0.13, 104),
  sp("pebble.square.2", "decor", "pebble", null, 0, 0.2, [0.8, 1.2], 0.14, 78),
  sp("pebble.square.3", "decor", "pebble", null, 0, 0.19, [0.8, 1.2], 0.16, 52),
  sp("pebble.square.4", "decor", "pebble", null, 0, 0.17, [0.8, 1.2], 0.17, 48),
  sp("pebble.square.5", "decor", "pebble", null, 0, 0.23, [0.8, 1.2], 0.15, 72),
  sp("pebble.square.6", "decor", "pebble", null, 0, 0.23, [0.8, 1.2], 0.14, 65),
  sp("petal.1", "decor", "petal", null, 0, 0.23, [0.8, 1.2], 0.24, 13),
  sp("petal.2", "decor", "petal", null, 0, 0.34, [0.8, 1.2], 0.24, 15),
  sp("petal.3", "decor", "petal", null, 0, 0.31, [0.8, 1.2], 0.19, 15),
  sp("petal.4", "decor", "petal", null, 0, 0.16, [0.8, 1.2], 0.25, 30),
  sp("petal.5", "decor", "petal", null, 0, 0.42, [0.8, 1.2], 0.29, 15),
  sp("petal.6", "decor", "petal", null, 0, 0.33, [0.8, 1.2], 0.54, 71),
  sp("rockpath.round_small.1", "path", "rockpath", null, 0, 0.74, [0.8, 1.2], 0.11, 998),
  sp("rockpath.round_small.2", "path", "rockpath", null, 0, 0.68, [0.8, 1.2], 0.1, 1126),
  sp("rockpath.round_small.3", "path", "rockpath", null, 0, 0.65, [0.8, 1.2], 0.11, 1002),
  sp("rockpath.round_thin", "path", "rockpath", null, 0, 1.04, [0.8, 1.2], 0.11, 2254),
  sp("rockpath.round_wide", "path", "rockpath", null, 0, 1.06, [0.8, 1.2], 0.11, 3500),
  sp("rockpath.square_small.1", "path", "rockpath", null, 0, 0.51, [0.8, 1.2], 0.15, 783),
  sp("rockpath.square_small.2", "path", "rockpath", null, 0, 0.5, [0.8, 1.2], 0.15, 559),
  sp("rockpath.square_small.3", "path", "rockpath", null, 0, 0.54, [0.8, 1.2], 0.17, 568),
  sp("rockpath.square_thin", "path", "rockpath", null, 0, 0.99, [0.8, 1.2], 0.18, 1793),
  sp("rockpath.square_wide", "path", "rockpath", null, 0, 1.03, [0.8, 1.2], 0.18, 2256),
  sp("rock.medium.1.desert", "rock", "rockdesert", 1.32, 0, 1.61, [1, 1], 2.26, 342),
  sp("rock.medium.2.desert", "rock", "rockdesert", 1.175, 0, 1.52, [1, 1], 1.9, 244),
  sp("rock.medium.3.desert", "rock", "rockdesert", 1.465, 0, 1.74, [1, 1], 2.32, 522),
  sp("rock.medium.4.desert", "rock", "rockdesert", 1.57, 0, 1.89, [1, 1], 2.48, 400),
  sp("rock.big.1.desert", "rock", "rockbigdesert", 2.05, 0, 2.6, [1, 1], 4.58, 1736),
  sp("rock.big.2.desert", "rock", "rockbigdesert", 2.461, 0, 2.91, [1, 1], 3.81, 1944),
];

/** Katalog pełny (Standard + Pro): 116 modeli paczki + 6 wariantów pustynnych. Kolejność: najpierw tabela v2. */
export const SPECIES_ALL: readonly Species[] = [...SPECIES, ...SPECIES_PRO];
export const SPECIES_ALL_BY_MODEL: ReadonlyMap<string, Species> = new Map(SPECIES_ALL.map((s) => [s.model, s]));

/** Indeks grup gatunków wybranego katalogu (kolejność w grupie = kolejność w katalogu). */
export function groupIndex(catalog: readonly Species[]): ReadonlyMap<SpeciesGroup, readonly Species[]> {
  const map = new Map<SpeciesGroup, Species[]>();
  for (const s of catalog) {
    const list = map.get(s.group);
    if (list) list.push(s);
    else map.set(s.group, [s]);
  }
  return map;
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
