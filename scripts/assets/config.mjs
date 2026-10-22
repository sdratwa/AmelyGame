/**
 * Konfiguracja potoku zasobów 3D (V1). Jedyne źródło prawdy o tym, które modele z paczki trafiają do gry,
 * pod jakimi stabilnymi id, w jakiej skali i z jakimi kolizjami.
 * Zmiana tutaj + `npm run assets:build` regeneruje cały katalog `public/models/` z oryginałów.
 */

export const PIPELINE_VERSION = 1;

export const PACK = {
  id: "quaternius-stylized-nature-megakit-pro",
  name: "Stylized Nature MegaKit [Pro]",
  version: "Pro (zakup), wydanie 2024",
  author: "Quaternius",
  license: {
    id: "CC0-1.0",
    name: "Creative Commons Zero v1.0 Universal (Public Domain Dedication)",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    textFile: "licenses/quaternius-stylized-nature-megakit-pro.txt",
  },
  sourceUrl: "https://quaternius.itch.io/stylized-nature-megakit",
  homepage: "https://quaternius.com/packs/stylizednaturemegakit.html",
  downloadedAt: "2026-10-20",
  archive: {
    name: "Stylized Nature MegaKit[Pro].zip",
    bytes: 180_523_530,
    sha256: "f7d3ffc8c56e885eea8bf8a0d83e248a378fe0f01ebb9eee69407b8eb5d8b493",
  },
  attribution: {
    required: false,
    suggested: "Modele roślin i skał: Quaternius, Stylized Nature MegaKit (CC0).",
  },
  approval:
    "Wersja Standard zatwierdzona 15.10.2026 (etap V1). Wersja Pro (zakup autora) jest nadzbiorem: 31 modeli Standard ma w niej "
    + "bajt w bajt identyczną geometrię i pliki glTF (sprawdzone SHA-256), więc modele gry się nie zmieniają. "
    + "Nowe modele Pro są na razie tylko w prototypie /dev/forest-pro (decyzja o wejściu do gry po obejrzeniu prototypu).",
};

/** Domyślny katalog oryginałów (poza repozytorium, w .gitignore). */
export const DEFAULT_SOURCE_DIR = ".assets-src/quaternius-stylized-nature-megakit-pro";

export const TEXTURE = {
  /** Maks. rozmiar boku tekstury dla profilu HIGH/MEDIUM i dla profilu LOW. */
  fullMax: 1024,
  lowMax: 512,
  webp: { quality: 82, alphaQuality: 92, effort: 6 },
  webpNormal: { quality: 90, effort: 6 },
};

export const MESH = {
  quantizePosition: 14,
  quantizeNormal: 10,
  quantizeTexcoord: 12,
  quantizeColor: 8,
};

/** Materiały, dla których kolor wierzchołków jest realnym AO/cieniowaniem (kora). Dla reszty to maska wiatru. */
export const VERTEX_COLOR_AO_MATERIALS = ["Bark_NormalTree", "Bark_TwistedTree", "Bark_Birch", "Bark_Pine", "Bark_DeadTree"];

/** Materiały kory: z nich mierzymy promień pnia na potrzeby kolizji. */
export const BARK_MATERIALS = ["Bark_NormalTree", "Bark_TwistedTree", "Bark_Birch", "Bark_Pine", "Bark_DeadTree"];

/**
 * Dodatkowe materiały, których nie ma w żadnym pliku glTF: kopia materiału bazowego z inną teksturą albedo
 * (wersje pustynne skał z paczki Pro: `Rocks_Desert_Diffuse.png`, `PathRocks_Desert_Diffuse.png`).
 */
export const EXTRA_MATERIALS = [
  { name: "Rocks_Desert", base: "Rocks", albedoUri: "Rocks_Desert_Diffuse.png" },
  { name: "PathRocks_Desert", base: "PathRocks", albedoUri: "PathRocks_Desert_Diffuse.png" },
];

const TREE_LOD = { ratio: 0.3, error: 0.08 };

/**
 * category: tree | bush | undergrowth | grass | flower | mushroom | rock | decor (kamyki, płatki) | path (płyty brukowe)
 * materialRename: { Rocks: "Rocks_Desert" } = wariant tego samego modelu z innym materiałem (osobny GLB)
 * baseScale: mnożnik do rozmiaru naturalnego w metrach (gracz ma ok. 1,7 m).
 * collision: "trunk" (promień mierzony z kory), "footprint" (ślad skały), albo null (da się przejść).
 */
export const MODELS_STANDARD = [
  ...[1, 2, 3, 4, 5].map((n) => ({
    id: `tree.common.${n}`, source: `CommonTree_${n}`, category: "tree", subcategory: "broadleaf",
    baseScale: 1, collision: "trunk", lod: TREE_LOD, lod1MinDistance: 35,
    tags: ["las", "drzewo-liściaste", "baśniowe"],
  })),
  ...[1, 3, 5].map((n) => ({
    id: `tree.pine.${n}`, source: `Pine_${n}`, category: "tree", subcategory: "conifer",
    baseScale: 1, collision: "trunk", lod: TREE_LOD, lod1MinDistance: 35,
    tags: ["las", "sosna"],
  })),
  ...[1, 3].map((n) => ({
    id: `tree.twisted.${n}`, source: `TwistedTree_${n}`, category: "tree", subcategory: "ancient",
    baseScale: 0.7, collision: "trunk", lod: { ratio: 0.2, error: 0.1 }, lod1MinDistance: 50,
    tags: ["las", "stare-drzewo", "baśniowe", "punkt-orientacyjny"],
  })),
  { id: "bush.common", source: "Bush_Common", category: "bush", subcategory: "leafy", baseScale: 1, collision: null, tags: ["las", "krzew"] },
  { id: "bush.common_flowers", source: "Bush_Common_Flowers", category: "bush", subcategory: "flowering", baseScale: 1, collision: null, tags: ["las", "krzew", "kwiaty", "baśniowe"] },
  { id: "fern.1", source: "Fern_1", category: "undergrowth", subcategory: "fern", baseScale: 0.6, collision: null, tags: ["las", "runo", "paproć"] },
  { id: "plant.1", source: "Plant_1", category: "undergrowth", subcategory: "leafy", baseScale: 0.8, collision: null, tags: ["las", "runo"] },
  { id: "plant.1_big", source: "Plant_1_Big", category: "undergrowth", subcategory: "leafy", baseScale: 0.7, collision: null, tags: ["las", "runo"] },
  { id: "plant.7", source: "Plant_7", category: "undergrowth", subcategory: "groundcover", baseScale: 1, collision: null, tags: ["las", "runo", "przy-ziemi"] },
  { id: "plant.7_big", source: "Plant_7_Big", category: "undergrowth", subcategory: "groundcover", baseScale: 1, collision: null, tags: ["las", "runo", "przy-ziemi"] },
  { id: "clover.1", source: "Clover_1", category: "undergrowth", subcategory: "clover", baseScale: 0.7, collision: null, tags: ["las", "runo", "koniczyna"] },
  { id: "clover.2", source: "Clover_2", category: "undergrowth", subcategory: "clover", baseScale: 0.7, collision: null, tags: ["las", "runo", "koniczyna"] },
  { id: "grass.common_short", source: "Grass_Common_Short", category: "grass", subcategory: "common", baseScale: 0.5, collision: null, tags: ["las", "trawa"] },
  { id: "grass.common_tall", source: "Grass_Common_Tall", category: "grass", subcategory: "common", baseScale: 0.45, collision: null, tags: ["las", "trawa"] },
  { id: "grass.wispy_short", source: "Grass_Wispy_Short", category: "grass", subcategory: "wispy", baseScale: 0.5, collision: null, tags: ["las", "trawa"] },
  { id: "grass.wispy_tall", source: "Grass_Wispy_Tall", category: "grass", subcategory: "wispy", baseScale: 0.45, collision: null, tags: ["las", "trawa"] },
  { id: "flower.3_single", source: "Flower_3_Single", category: "flower", subcategory: "single", baseScale: 0.35, collision: null, tags: ["las", "kwiat", "baśniowe"] },
  { id: "flower.3_group", source: "Flower_3_Group", category: "flower", subcategory: "group", baseScale: 0.4, collision: null, tags: ["las", "kwiat", "baśniowe"] },
  { id: "flower.4_single", source: "Flower_4_Single", category: "flower", subcategory: "single", baseScale: 0.35, collision: null, tags: ["las", "kwiat", "baśniowe"] },
  { id: "flower.4_group", source: "Flower_4_Group", category: "flower", subcategory: "group", baseScale: 0.4, collision: null, tags: ["las", "kwiat", "baśniowe"] },
  { id: "mushroom.common", source: "Mushroom_Common", category: "mushroom", subcategory: "cap", baseScale: 1, collision: null, tags: ["las", "grzyb", "baśniowe"] },
  ...[1, 2, 3].map((n) => ({
    id: `rock.medium.${n}`, source: `Rock_Medium_${n}`, category: "rock", subcategory: "boulder",
    baseScale: 1, collision: "footprint", tags: ["las", "skała"],
  })),
];

const seq = (n) => Array.from({ length: n }, (_, i) => i + 1);
const T = (id, source, subcategory, baseScale, lod, lod1MinDistance, tags) => ({
  id, source, category: "tree", subcategory, baseScale, collision: "trunk", lod, lod1MinDistance, tags: ["las", "pro", ...tags],
});
const G = (id, source, category, subcategory, baseScale, tags, extra = {}) => ({
  id, source, category, subcategory, baseScale, collision: null, tags: ["las", "pro", ...tags], ...extra,
});

/** Modele z paczki Pro, których nie ma w Standard (wszystkie 85, nic nie jest pomijane; decyzja o wieku po obejrzeniu prototypu). */
export const MODELS_PRO_ONLY = [
  ...seq(5).map((n) => T(`tree.birch.${n}`, `Birch_${n}`, "birch", 0.6, TREE_LOD, 35, ["brzoza"])),
  ...seq(5).map((n) => T(`tree.cherry.${n}`, `CherryBlossom_${n}`, "blossom", 0.5, TREE_LOD, 35, ["wiśnia", "kwitnące", "baśniowe"])),
  ...seq(5).map((n) => T(`tree.giantpine.${n}`, `GiantPine_${n}`, "giantpine", 0.7, TREE_LOD, 45, ["sosna-olbrzymia"])),
  ...seq(5).map((n) => T(`tree.tallthick.${n}`, `TallThick_${n}`, "tallthick", 0.55, TREE_LOD, 40, ["wysokie-drzewo"])),
  ...seq(5).map((n) => T(`tree.dead.${n}`, `DeadTree_${n}`, "dead", 0.6, { ratio: 0.4, error: 0.1 }, 35, ["martwe-drzewo"])),
  ...[2, 4].map((n) => T(`tree.pine.${n}`, `Pine_${n}`, "conifer", 1, TREE_LOD, 35, ["sosna"])),
  ...[2, 4, 5].map((n) => T(`tree.twisted.${n}`, `TwistedTree_${n}`, "ancient", 0.7, { ratio: 0.2, error: 0.1 }, 50, ["stare-drzewo", "baśniowe"])),
  G("bush.large", "Bush_Large", "bush", "leafy", 0.7, ["krzew"]),
  G("bush.large_flowers", "Bush_Large_Flowers", "bush", "flowering", 0.7, ["krzew", "kwiaty"]),
  G("bush.long.1", "Bush_Long_1", "bush", "leafy", 0.7, ["krzew"]),
  G("bush.long.2", "Bush_Long_2", "bush", "leafy", 0.7, ["krzew"]),
  G("fern.2", "Fern_2", "undergrowth", "fern", 0.6, ["runo", "paproć"]),
  ...[2, 3, 4, 5, 6].map((n) => G(`plant.${n}`, `Plant_${n}`, "undergrowth", "leafy", 0.8, ["runo"])),
  G("plant.2_big", "Plant_2_Big", "undergrowth", "leafy", 0.7, ["runo"]),
  G("grass.wheat", "Grass_Wheat", "grass", "wheat", 0.5, ["trawa", "zboże"]),
  G("grass.wide_short", "Grass_Wide_Short", "grass", "wide", 0.5, ["trawa"]),
  G("grass.wide_tall", "Grass_Wide_Tall", "grass", "wide", 0.45, ["trawa"]),
  G("flower.1_single", "Flower_1_Single", "flower", "single", 0.45, ["kwiat"]),
  G("flower.1_group", "Flower_1_Group", "flower", "group", 0.45, ["kwiat"]),
  G("flower.2_single", "Flower_2_Single", "flower", "single", 0.45, ["kwiat"]),
  G("flower.2_group", "Flower_2_Group", "flower", "group", 0.45, ["kwiat"]),
  G("flower.6", "Flower_6", "flower", "ground", 0.8, ["kwiat", "przy-ziemi"]),
  G("flower.6_2", "Flower_6_2", "flower", "ground", 0.8, ["kwiat", "przy-ziemi"]),
  G("flower.7_single", "Flower_7_Single", "flower", "single", 0.45, ["kwiat"]),
  G("flower.7_group", "Flower_7_Group", "flower", "group", 0.45, ["kwiat"]),
  G("mushroom.laetiporus", "Mushroom_Laetiporus", "mushroom", "bracket", 0.7, ["grzyb"]),
  G("mushroom.oyster", "Mushroom_Oyster", "mushroom", "bracket", 0.5, ["grzyb"]),
  G("mushroom.redcap", "Mushroom_RedCap", "mushroom", "cap", 0.6, ["grzyb", "baśniowe"]),
  { id: "rock.medium.4", source: "Rock_Medium_4", category: "rock", subcategory: "boulder", baseScale: 1, collision: "footprint", tags: ["las", "pro", "skała"] },
  { id: "rock.big.1", source: "Rock_Big_1", category: "rock", subcategory: "boulder", baseScale: 1, collision: "footprint", tags: ["las", "pro", "skała", "głaz"] },
  { id: "rock.big.2", source: "Rock_Big_2", category: "rock", subcategory: "boulder", baseScale: 1, collision: "footprint", tags: ["las", "pro", "skała", "głaz"] },
  ...seq(5).map((n) => G(`pebble.round.${n}`, `Pebble_Round_${n}`, "decor", "pebble", 1, ["kamyk"])),
  ...seq(6).map((n) => G(`pebble.square.${n}`, `Pebble_Square_${n}`, "decor", "pebble", 1, ["kamyk"])),
  ...seq(6).map((n) => G(`petal.${n}`, `Petal_${n}`, "decor", "petal", 1, ["płatek"])),
  ...seq(3).map((n) => G(`rockpath.round_small.${n}`, `RockPath_Round_Small_${n}`, "path", "round", 1, ["bruk"])),
  G("rockpath.round_thin", "RockPath_Round_Thin", "path", "round", 1, ["bruk"]),
  G("rockpath.round_wide", "RockPath_Round_Wide", "path", "round", 1, ["bruk"]),
  ...seq(3).map((n) => G(`rockpath.square_small.${n}`, `RockPath_Square_Small_${n}`, "path", "square", 1, ["bruk"])),
  G("rockpath.square_thin", "RockPath_Square_Thin", "path", "square", 1, ["bruk"]),
  G("rockpath.square_wide", "RockPath_Square_Wide", "path", "square", 1, ["bruk"]),
];

/** Pustynne warianty skał (ta sama geometria, tekstura Rocks_Desert_Diffuse). Osobne pliki GLB z przemianowanym materiałem. */
export const MODELS_PRO_DESERT = [
  ...[1, 2, 3, 4].map((n) => ({
    id: `rock.medium.${n}.desert`, source: `Rock_Medium_${n}`, category: "rock", subcategory: "boulder", baseScale: 1,
    collision: "footprint", materialRename: { Rocks: "Rocks_Desert" }, tags: ["las", "pro", "skała", "pustynia"],
  })),
  ...[1, 2].map((n) => ({
    id: `rock.big.${n}.desert`, source: `Rock_Big_${n}`, category: "rock", subcategory: "boulder", baseScale: 1,
    collision: "footprint", materialRename: { Rocks: "Rocks_Desert" }, tags: ["las", "pro", "skała", "głaz", "pustynia"],
  })),
];

/** Wszystkie 116 modeli Pro (31 wspólnych ze Standard + 85 nowych) plus 6 wariantów pustynnych. */
export const MODELS = [...MODELS_STANDARD, ...MODELS_PRO_ONLY, ...MODELS_PRO_DESERT];

/**
 * Klasy rozmiaru skał (wariant A z docs/projekt/zasoby-3d.md: skalowanie modeli Rock_Medium).
 * Skala jednolita z zakresu + kontrolowana zmienność proporcji (nie deformuje nienaturalnie).
 */
export const SCALE_CLASSES = {
  rock: {
    note: "Prototypowa decyzja (wariant A): klasy S/M/L z Rock_Medium_1..3 przez skalowanie. Nie jest to styl docelowy.",
    appliesTo: ["rock.medium.1", "rock.medium.2", "rock.medium.3"],
    classes: {
      s: { scale: [0.28, 0.4], harvestHint: 1 },
      m: { scale: [0.55, 0.75], harvestHint: 2 },
      l: { scale: [0.95, 1.3], harvestHint: 5 },
    },
    /** Maks. odchylenie proporcji osi względem skali jednolitej (ułamek) i zakres losowego obrotu. */
    proportionJitter: { x: 0.12, y: 0.15, z: 0.12 },
    maxTiltRad: 0.08,
    yawRange: [0, Math.PI * 2],
  },
};
