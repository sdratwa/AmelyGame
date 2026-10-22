import type { EnvironmentProfile, ShowcaseProfileId } from "./profiles";

/**
 * Cztery profile prototypu lasu Pro (dev, /dev/forest-pro). Układ zgodny z podglądami paczki:
 *  - A `pro_autumn`: Preview_1, jesienna łąka (brzozy, czerwone stare drzewa, głazy, kwiaty),
 *  - B `pro_conifer`: Preview_2, gęsty las iglasty (olbrzymie sosny, wysokie iglaki, paprocie, pszenica),
 *  - C `pro_desert`: Preview_3, pustynia (martwe drzewa, skały w wersji pustynnej, sucha trawa),
 *  - D `pro_mix`: wszystko naraz (wiśnie z płatkami, wszystkie krzewy, kwiaty i grzyby).
 * Gęstość trawy liczona w kępkach (kępy po 5-11 kępek, patrz `PRO_TUNING.grass`). Gęstości celowo nie są obniżone: prototyp ma pokazać koszt wydajnościowy; decyzje o wycięciu modeli zapadają po obejrzeniu.
 */
export const SHOWCASE_PROFILES: Readonly<Record<ShowcaseProfileId, EnvironmentProfile>> = {
  pro_autumn: {
    id: "pro_autumn",
    label: "A: jesienna łąka (Preview_1)",
    density: { tree: 2.4, ancient: 0.06, rock: 0.6, bush: 1.2, fern: 1.5, plant: 2.0, grass: 48, flower: 4.0 },
    mushroomChance: 0.1,
    pro: {
      tree: { birch: 2.4 },
      bush: { bushbig: 0.5 },
      grass: { wide: 1 },
      mushroom: { mushroomcap: 1.4, bracket: 0.3 },
      rockBig: 0.45,
      rockDesert: 0,
      pebbles: 0.7,
      formations: 0.12,
    },
    mix: {
      tree: { broadleaf: 0.25, pine: 0.15 },
      bush: { plain: 0.6, flowering: 0.4 },
      plant: { leafy: 1, ground: 1, clover: 0.5 },
      grass: { common: 1, wispy: 0.6 },
      rock: { s: 0.45, m: 0.35, l: 0.2 },
    },
  },
  pro_conifer: {
    id: "pro_conifer",
    label: "B: gęsty las iglasty (Preview_2)",
    density: { tree: 4.4, ancient: 0.03, rock: 0.3, bush: 0.8, fern: 5.5, plant: 3.0, grass: 40, flower: 0.6 },
    mushroomChance: 0.16,
    pro: {
      tree: { giantpine: 1.4, tallthick: 0.8 },
      bush: { bushlong: 0.5 },
      grass: { wheat: 0.6 },
      mushroom: { mushroomcap: 0.3, bracket: 1.2 },
      rockBig: 0.1,
      rockDesert: 0,
      pebbles: 0.3,
      formations: 0.03,
    },
    mix: {
      tree: { broadleaf: 0.35, pine: 1.0 },
      bush: { plain: 0.9, flowering: 0.1 },
      plant: { leafy: 1.4, ground: 0.8, clover: 0.6 },
      grass: { common: 0.5, wispy: 1 },
      rock: { s: 0.55, m: 0.33, l: 0.12 },
    },
  },
  pro_desert: {
    id: "pro_desert",
    label: "C: pustynia (Preview_3)",
    density: { tree: 0.7, ancient: 0.012, rock: 0.8, bush: 0.25, fern: 0.1, plant: 0.4, grass: 26, flower: 0.3 },
    mushroomChance: 0,
    pro: {
      tree: { dead: 3.0 },
      bush: { bushlong: 0.4 },
      grass: { wheat: 1.2 },
      rockBig: 0.35,
      rockDesert: 1,
      pebbles: 0.85,
      formations: 0.3,
    },
    mix: {
      tree: { broadleaf: 0.04, pine: 0.06 },
      bush: { plain: 1, flowering: 0.05 },
      plant: { leafy: 0.5, ground: 1.5, clover: 0.1 },
      grass: { common: 0.5, wispy: 1.2 },
      rock: { s: 0.5, m: 0.32, l: 0.18 },
    },
  },
  pro_mix: {
    id: "pro_mix",
    label: "D: mieszany, wszystkie modele",
    density: { tree: 3.2, ancient: 0.04, rock: 0.5, bush: 1.6, fern: 3.0, plant: 3.0, grass: 40, flower: 3.5 },
    mushroomChance: 0.11,
    pro: {
      tree: { birch: 0.8, giantpine: 0.5, tallthick: 0.5, blossom: 1.2, dead: 0.2 },
      bush: { bushbig: 0.6, bushlong: 0.6 },
      grass: { wide: 0.6, wheat: 0.5 },
      mushroom: { mushroomcap: 1, bracket: 1 },
      rockBig: 0.3,
      rockDesert: 0.15,
      petals: 1,
      pebbles: 0.5,
      formations: 0.1,
    },
    mix: {
      tree: { broadleaf: 1, pine: 0.8 },
      bush: { plain: 0.6, flowering: 0.4 },
      plant: { leafy: 1.2, ground: 1, clover: 0.6 },
      grass: { common: 1, wispy: 0.8 },
      rock: { s: 0.5, m: 0.32, l: 0.18 },
    },
  },
};
