import type { QuadrantLayout } from "./geometry";
import { SHOWCASE_PROFILES } from "./showcaseProfiles";
import { SPECIES_ALL, type Species } from "./species";

/**
 * Tryb deweloperski prototypu lasu z paczką Pro (`/dev/forest-pro`). Wszystko tu jest opcjonalne i domyślnie wyłączone:
 * bez `ForestOptions.pro` generator v2 działa dokładnie jak dotąd (te same obiekty, te same odciski), więc zapisy, quest i
 * produkcyjny las zostają nietknięte. Włączenie do gry wymaga osobnej decyzji (generator v3, kotwice questa, migracje).
 */
export type PavingOptions = {
  /** Identyfikator ścieżki z planu, którą brukujemy (domyślnie droga główna do mostu). */
  trailId: string;
  /** Długość (m) fragmentu bruku przy starcie i przy moście, gdzie bruk jest gęsty i ciągły. */
  endZone: number;
  /** Prawdopodobieństwo, że fragment (łata) środkowego odcinka drogi jest brukowany. */
  middleChance: number;
  /** Długość łaty bruku w środkowej części (m). */
  patchLength: number;
};

/** Skupisko szumu (skala w m, próg, dolna wartość, średnia i drobna zmienność), jak `CLUSTER` w rozsiewie. */
export type ClusterTuning = { s1: number; lo: number; hi: number; floor: number; m0: number; s2: number; amp: number };

/**
 * Trawa w kępach (Preview_1/2): jedna decyzja akceptacji na kępę, wokół niej `members` kępek w promieniu `spread` (m),
 * wspólny gatunek dominujący, większa skala i osobne skupiska (łaty bez trawy). Gęstość (na 100 m2, liczona w kępkach) pochodzi z profilu.
 */
export type ProGrassTuning = {
  cell: number;
  perCell: number;
  members: readonly [number, number];
  spread: number;
  /** Mnożnik skali kępki ponad zakres gatunku (Preview ma większe i zwarte kępy). */
  scale: number;
  /** Udział kępek w kępie, które mają gatunek dominujący (reszta losowana z wag profilu). */
  dominant: number;
  cluster: ClusterTuning;
};

/** Wydmy pustyni (Preview_3): przesunięcie wysokości terenu tylko w ćwiartce C, wygaszane przy rzece, ścieżkach i obszarach wolnych. */
export type ProDuneTuning = {
  /** Amplituda (m) przy pełnej wadze ćwiartki C. */
  amplitude: number;
  /** Długość fali grzbietów (m) i rozciągnięcie wzdłuż osi z. */
  wavelength: number;
  stretch: number;
  /** Strefa bez wydm przy rzece (od brzegu, m) i szerokość pasa narastania. */
  riverClear: number;
  riverRamp: number;
  /** To samo dla ścieżek (od krawędzi) i obszarów wolnych (start, lądowiska mostu). */
  trailClear: number;
  trailRamp: number;
  clearRamp: number;
};

/**
 * Formacje skalne (Preview_1/3): zamiast skupiska małych skał kotwica skały może stać się zwartą grupą dużych głazów.
 * Szansa na formację pochodzi z profilu (`ProMix.formations`), reszta jest tutaj.
 */
export type ProRockTuning = {
  /** Liczba głazów w formacji (włącznie z kotwicą). */
  members: readonly [number, number];
  /** Skala kotwicy (absolutna, wobec modelu po `baseScale`); pozostałe głazy mają 0,55-0,8 tej skali. */
  scale: readonly [number, number];
  /** Udział średnich skał (zamiast Rock_Big) wśród głazów poza kotwicą. */
  mediumShare: number;
};

/** Parametry strojenia trybu Pro (jedno miejsce; wszystkie wartości do dostrojenia po obejrzeniu prototypu). */
export type ProTuning = {
  grass: ProGrassTuning;
  /** Mnożnik skali kwiatów w trybie Pro (modele Pro są większe od Standard). */
  flowerScale: number;
  rocks: ProRockTuning;
  dunes: ProDuneTuning;
};

export const PRO_GROUND: ProGroundTuning = {
  crackCell: 0.25,
  crackWidth: 0.021,
  crackStrength: 0.53,
  crackPatchScale: 16,
  crackPatchThreshold: 0.5,
  rippleTilt: 0.05,
  rippleTone: 0.05,
  crackFadeNear: 0,
  crackFadeFar: 18,
};

/**
 * Wygląd gruntu w trybie Pro (widok, `forest-view/ground.ts` i shader gruntu): spękana ziemia w dużych płatach (pustynia i ścieżki)
 * rysowana w shaderze (komórki Voronoi, niezależne od rozdzielczości tekstury) oraz fale piasku na pustyni.
 */
export type ProGroundTuning = {
  /** Spękana ziemia: rozmiar komórki (m), szerokość linii pęknięcia (m), siła przyciemnienia (0-1). */
  crackCell: number;
  crackWidth: number;
  crackStrength: number;
  /** Skala płatów spękanej ziemi w pustyni (m) i próg pokrycia (0-1; większy = mniej płatów). */
  crackPatchScale: number;
  crackPatchThreshold: number;
  /** Siła pochylenia normalnej przez fale piasku (0 = brak) i zmienność koloru piasku (0-1). */
  rippleTilt: number;
  rippleTone: number;
  /** Pęknięcia pełne do `crackFadeNear` m od kamery i znikają do `crackFadeFar` m. */
  crackFadeNear: number;
  crackFadeFar: number;
};

export type ProOptions = {
  /** Katalog gatunków (domyślnie wszystkie modele Pro). */
  catalog: readonly Species[];
  /** Cztery strefy-ćwiartki z miękkimi granicami. */
  quadrants: QuadrantLayout;
  /** Brukowanie drogi głównej (płyty RockPath i kamyki Pebble). */
  paving: PavingOptions | null;
  /** Strojenie trawy, skał i terenu; brak = zachowanie jak przed poprawką (pojedyncze kępki). */
  tuning?: ProTuning;
};

/**
 * Układ prototypu: szew w (0, 0), pas przejścia 40 m (czysta strefa dopiero 20 m od szwu).
 * A (NW) jesienna łąka, B (SW) las iglasty, C (SE) pustynia, D (NE) mix wszystkiego. Zamiana ćwiartek = zamiana wpisów.
 */
export const PRO_QUADRANT_LAYOUT: QuadrantLayout = {
  profiles: {
    a: SHOWCASE_PROFILES.pro_autumn,
    b: SHOWCASE_PROFILES.pro_conifer,
    c: SHOWCASE_PROFILES.pro_desert,
    d: SHOWCASE_PROFILES.pro_mix,
  },
  seamX: 0,
  seamZ: 0,
  feather: 40,
  dropZoneKinds: ["dense_forest", "sunny_forest"],
};

export const PRO_PAVING: PavingOptions = { trailId: "trail.main", endZone: 45, middleChance: 0.45, patchLength: 14 };

export const PRO_TUNING: ProTuning = {
  grass: {
    cell: 3,
    perCell: 2,
    members: [5, 11],
    spread: 1,
    scale: 0.8,
    dominant: 0.7,
    cluster: { s1: 9, lo: 0.32, hi: 0.62, floor: 0.05, m0: 0.5, s2: 4, amp: 0.3 },
  },
  flowerScale: 1.25,
  rocks: { members: [3, 5], scale: [1.2, 1.8], mediumShare: 0.35 },
  dunes: { amplitude: 2.4, wavelength: 42, stretch: 1.5, riverClear: 8, riverRamp: 22, trailClear: 2, trailRamp: 9, clearRamp: 10 },
};

export const PRO_OPTIONS: ProOptions = {
  catalog: SPECIES_ALL,
  quadrants: PRO_QUADRANT_LAYOUT,
  paving: PRO_PAVING,
  tuning: PRO_TUNING,
};
