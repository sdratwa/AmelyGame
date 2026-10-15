/**
 * Konfiguracja potoku zasobów 3D (V1). Jedyne źródło prawdy o tym, które modele z paczki trafiają do gry,
 * pod jakimi stabilnymi id, w jakiej skali i z jakimi kolizjami.
 * Zmiana tutaj + `npm run assets:build` regeneruje cały katalog `public/models/` z oryginałów.
 */

export const PIPELINE_VERSION = 1;

export const PACK = {
  id: "quaternius-stylized-nature-megakit-standard",
  name: "Stylized Nature MegaKit [Standard]",
  version: "Standard (free), wydanie 2024",
  author: "Quaternius",
  license: {
    id: "CC0-1.0",
    name: "Creative Commons Zero v1.0 Universal (Public Domain Dedication)",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    textFile: "licenses/quaternius-stylized-nature-megakit-standard.txt",
  },
  sourceUrl: "https://quaternius.itch.io/stylized-nature-megakit",
  homepage: "https://quaternius.com/packs/stylizednaturemegakit.html",
  downloadedAt: "2026-10-15",
  archive: {
    name: "Stylized Nature MegaKit[Standard].zip",
    bytes: 104_088_529,
    sha256: "298f6732b872e4cf7b30e6e7abf9641c7f6dc6b326df37ac089533ed7e3d58c9",
  },
  attribution: {
    required: false,
    suggested: "Modele roślin i skał: Quaternius, Stylized Nature MegaKit (CC0).",
  },
  approval: "Pakiet i wersja Standard zatwierdzone przez autora projektu 15.10.2026 (etap V1).",
};

/** Domyślny katalog oryginałów (poza repozytorium, w .gitignore). */
export const DEFAULT_SOURCE_DIR = ".assets-src/quaternius-stylized-nature-megakit-standard";

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
export const VERTEX_COLOR_AO_MATERIALS = ["Bark_NormalTree", "Bark_TwistedTree"];

/** Materiały kory: z nich mierzymy promień pnia na potrzeby kolizji. */
export const BARK_MATERIALS = ["Bark_NormalTree", "Bark_TwistedTree"];

const TREE_LOD = { ratio: 0.3, error: 0.08 };

/**
 * category: tree | bush | undergrowth | grass | flower | mushroom | rock
 * baseScale: mnożnik do rozmiaru naturalnego w metrach (gracz ma ok. 1,7 m).
 * collision: "trunk" (promień mierzony z kory), "footprint" (ślad skały), albo null (da się przejść).
 */
export const MODELS = [
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
