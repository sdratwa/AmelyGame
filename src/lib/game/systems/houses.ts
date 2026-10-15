import { result, unchanged, withToast, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";
import {
  DOOR_COLORS,
  HOUSE_LEVEL_NAME,
  MAX_HOUSE_PRICE,
  MIN_HOUSE_PRICE,
  ROOF_COLORS,
  STREETS,
  WALL_COLORS,
  houseLevelForPrice,
  houseUpgradeCost,
  type House,
  type HouseLevel,
} from "../content/houses";

export function generateHouse(
  id: string,
  rnd: () => number = Math.random,
): House {
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
  const raw = MIN_HOUSE_PRICE + rnd() * (MAX_HOUSE_PRICE - MIN_HOUSE_PRICE);
  const price = Math.min(
    MAX_HOUSE_PRICE,
    Math.max(MIN_HOUSE_PRICE, Math.round(raw / 1000) * 1000),
  );
  const phone = Array.from({ length: 6 }, () => Math.floor(rnd() * 10)).join("");
  return {
    id,
    name: `ul. ${pick(STREETS)} ${1 + Math.floor(rnd() * 40)}`,
    level: houseLevelForPrice(price),
    price,
    phone,
    owned: false,
    wallColor: pick(WALL_COLORS),
    roofColor: pick(ROOF_COLORS),
    doorColor: pick(DOOR_COLORS),
    flip: rnd() > 0.5,
  };
}

export function buyHouse(state: GameState, id: string): CommandResult {
  if (state.dead || !state.tutorialDone) return unchanged(state);
  const house = state.houses.find((h) => h.id === id);
  if (!house || house.owned) return unchanged(state);
  if (state.wallet < house.price) {
    return result(withToast(state, "Za mało pieniędzy na ten dom.", "error"));
  }
  return result(
    withToast(
      {
        ...state,
        wallet: state.wallet - house.price,
        houses: state.houses.map((h) =>
          h.id === house.id ? { ...h, owned: true } : h,
        ),
      },
      `Kupiono dom: ${house.name}`,
    ),
    { type: "house.bought", id: house.id, price: house.price },
  );
}

export function upgradeHouse(state: GameState, id: string): CommandResult {
  if (state.dead) return unchanged(state);
  const house = state.houses.find((h) => h.id === id);
  if (!house || !house.owned) return unchanged(state);
  const cost = houseUpgradeCost(house.level);
  if (cost === null) return unchanged(state);
  if (state.wallet < cost) {
    return result(withToast(state, "Za mało pieniędzy na ulepszenie.", "error"));
  }
  const level = (house.level + 1) as HouseLevel;
  return result(
    withToast(
      {
        ...state,
        wallet: state.wallet - cost,
        houses: state.houses.map((h) => (h.id === house.id ? { ...h, level } : h)),
      },
      `Ulepszono dom: poziom ${level} – ${HOUSE_LEVEL_NAME[level]}`,
    ),
    { type: "house.upgraded", id: house.id, level, cost },
  );
}
