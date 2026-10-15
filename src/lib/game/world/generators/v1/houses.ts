/**
 * ZAMROŻONE (generator świata v1). Nie zmieniaj tego pliku – zapisy gry odtwarzają
 * świat z (seed, wersja generatora) i porównują odcisk. Zmiany wprowadzaj
 * w nowej wersji generatora (v2), a stare zapisy migruj jawnie.
 * Pilnuje tego world/generators/frozen.test.ts.
 */
import type { House, HouseLevel } from "../../../content/houses";

const MIN_PRICE = 200_000;
const MAX_PRICE = 500_000;

const WALL_COLORS = ["#b9ad98", "#a89f8f", "#c8b79a", "#9a9486", "#b7a58a", "#cbbfa8"];
const ROOF_COLORS = ["#d0662a", "#c4572a", "#b8502a", "#b0662e", "#c97a3a", "#a8523a"];
const DOOR_COLORS = ["#5b3a22", "#6b4423", "#3f5a3a", "#4a3a5a", "#7a2e2a"];
const STREETS = ["Zielona", "Lipowa", "Polna", "Krótka", "Słoneczna", "Leśna"];

export const V1_HOUSE_COUNT = 2;

function levelForPrice(price: number): HouseLevel {
  if (price < 275_000) return 1;
  if (price < 350_000) return 2;
  if (price < 425_000) return 3;
  return 4;
}

function generateHouse(id: string, rnd: () => number): House {
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
  const raw = MIN_PRICE + rnd() * (MAX_PRICE - MIN_PRICE);
  const price = Math.min(MAX_PRICE, Math.max(MIN_PRICE, Math.round(raw / 1000) * 1000));
  const phone = Array.from({ length: 6 }, () => Math.floor(rnd() * 10)).join("");
  return {
    id,
    name: `ul. ${pick(STREETS)} ${1 + Math.floor(rnd() * 40)}`,
    level: levelForPrice(price),
    price,
    phone,
    owned: false,
    wallColor: pick(WALL_COLORS),
    roofColor: pick(ROOF_COLORS),
    doorColor: pick(DOOR_COLORS),
    flip: rnd() > 0.5,
  };
}

export function generateHousesV1(rnd: () => number): House[] {
  return Array.from({ length: V1_HOUSE_COUNT }, (_, i) => generateHouse(`dom-${i + 1}`, rnd));
}
