export type HouseLevel = 1 | 2 | 3 | 4;
export const MAX_HOUSE_LEVEL: HouseLevel = 4;

export const HOUSE_LEVEL_NAME: Record<HouseLevel, string> = {
  1: "Chatka",
  2: "Domek",
  3: "Dom z poddaszem",
  4: "Rezydencja",
};

export const MIN_HOUSE_PRICE = 200_000;
export const MAX_HOUSE_PRICE = 500_000;

/** Poziom domu wynika z ceny: im drożej, tym bardziej rozbudowany. */
export function houseLevelForPrice(price: number): HouseLevel {
  if (price < 275_000) return 1;
  if (price < 350_000) return 2;
  if (price < 425_000) return 3;
  return 4;
}

const UPGRADE_COSTS: Record<1 | 2 | 3, number> = {
  1: 60_000,
  2: 90_000,
  3: 130_000,
};

/** Koszt ulepszenia z danego poziomu na następny (null = poziom maksymalny). */
export function houseUpgradeCost(level: HouseLevel): number | null {
  return level >= MAX_HOUSE_LEVEL ? null : UPGRADE_COSTS[level as 1 | 2 | 3];
}

export type House = {
  id: string;
  name: string;
  level: HouseLevel;
  price: number;
  phone: string;
  owned: boolean;
  wallColor: string;
  roofColor: string;
  doorColor: string;
  flip: boolean;
};

export const WALL_COLORS = [
  "#b9ad98",
  "#a89f8f",
  "#c8b79a",
  "#9a9486",
  "#b7a58a",
  "#cbbfa8",
];
export const ROOF_COLORS = ["#d0662a", "#c4572a", "#b8502a", "#b0662e", "#c97a3a", "#a8523a"];
export const DOOR_COLORS = ["#5b3a22", "#6b4423", "#3f5a3a", "#4a3a5a", "#7a2e2a"];
export const STREETS = ["Zielona", "Lipowa", "Polna", "Krótka", "Słoneczna", "Leśna"];
