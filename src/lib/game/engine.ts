export const SECONDS_PER_GAME_HOUR = 20;
export const HOURS_PER_DAY = 24;
export const SECONDS_PER_DAY = SECONDS_PER_GAME_HOUR * HOURS_PER_DAY;
export const DAYS_PER_SEASON = 30;
export const START_YEAR = 2030;
export const START_WALLET = 1_000_000;
export const MAX_HEALTH = 100;
export const INVENTORY_SLOTS = 8;
export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 18;

export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABEL: Record<Season, string> = {
  winter: "Zima",
  spring: "Wiosna",
  summer: "Lato",
  autumn: "Jesień",
};

export type ItemId =
  | "phone"
  | "hotdog"
  | "sandwich"
  | "water"
  | "coffee"
  | "chocolate";

export type Item = {
  id: ItemId;
  name: string;
  emoji: string;
  heal: number;
  price: number;
  description: string;
};

export const ITEMS: Record<ItemId, Item> = {
  phone: {
    id: "phone",
    name: "Telefon",
    emoji: "📱",
    heal: 0,
    price: 0,
    description: "Twój telefon. Nigdy go nie stracisz.",
  },
  hotdog: {
    id: "hotdog",
    name: "Hot-dog",
    emoji: "🌭",
    heal: 25,
    price: 12,
    description: "Gorący i sycący.",
  },
  sandwich: {
    id: "sandwich",
    name: "Kanapka",
    emoji: "🥪",
    heal: 20,
    price: 9,
    description: "Szybka przekąska na drogę.",
  },
  coffee: {
    id: "coffee",
    name: "Kawa",
    emoji: "☕",
    heal: 10,
    price: 7,
    description: "Rozgrzewa w zimowy dzień.",
  },
  chocolate: {
    id: "chocolate",
    name: "Czekolada",
    emoji: "🍫",
    heal: 8,
    price: 5,
    description: "Mała porcja energii.",
  },
  water: {
    id: "water",
    name: "Woda",
    emoji: "💧",
    heal: 5,
    price: 3,
    description: "Orzeźwia, ale niewiele leczy.",
  },
};

export const SHOP_ITEMS: ItemId[] = [
  "hotdog",
  "sandwich",
  "coffee",
  "chocolate",
  "water",
];

export type House = {
  id: string;
  name: string;
  price: number;
  phone: string;
  wallColor: string;
  roofColor: string;
  doorColor: string;
  roofStyle: "gable" | "hip" | "flat";
  hasChimney: boolean;
  hasGarage: boolean;
};

export type ClockInfo = {
  day: number;
  dayInSeason: number;
  hour: number;
  minute: number;
  isDay: boolean;
  season: Season;
  year: number;
};

export function getClock(elapsedSeconds: number): ClockInfo {
  const dayIndex = Math.floor(elapsedSeconds / SECONDS_PER_DAY);
  const secondsIntoDay = elapsedSeconds - dayIndex * SECONDS_PER_DAY;
  const hoursIntoDay = secondsIntoDay / SECONDS_PER_GAME_HOUR;
  const clockHours = (DAY_START_HOUR + hoursIntoDay) % HOURS_PER_DAY;
  const hour = Math.floor(clockHours);
  const minute = Math.floor((clockHours - hour) * 60);
  const seasonIndex = Math.floor(dayIndex / DAYS_PER_SEASON) % SEASONS.length;
  return {
    day: dayIndex,
    dayInSeason: (dayIndex % DAYS_PER_SEASON) + 1,
    hour,
    minute,
    isDay: hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR,
    season: SEASONS[seasonIndex],
    year:
      START_YEAR +
      Math.floor(dayIndex / (DAYS_PER_SEASON * SEASONS.length)),
  };
}

export function formatClock(clock: ClockInfo): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(clock.hour)}:${pad(clock.minute)}`;
}

/** Health lost per real second. */
export function drainPerSecond(
  season: Season,
  isDay: boolean,
  sheltered: boolean,
): number {
  if (sheltered) return 0;
  if (season === "winter") return isDay ? 1 / 10 : 1 / 5;
  return isDay ? 0 : 1 / 10;
}

export type View = "world" | "forest" | "shop";
export type Phase = "name" | "loading" | "playing";

export type GameState = {
  phase: Phase;
  name: string;
  view: View;
  tutorialDone: boolean;
  elapsed: number;
  health: number;
  drainAcc: number;
  wallet: number;
  slots: (ItemId | null)[];
  selected: number;
  dead: boolean;
  deaths: number;
  houses: House[];
  toast: { id: number; text: string; tone: "ok" | "error" } | null;
};

export function initialSlots(): (ItemId | null)[] {
  return Array.from({ length: INVENTORY_SLOTS }, (_, i) =>
    i === 0 ? "phone" : null,
  );
}

export const initialState: GameState = {
  phase: "name",
  name: "",
  view: "world",
  tutorialDone: false,
  elapsed: 0,
  health: MAX_HEALTH,
  drainAcc: 0,
  wallet: START_WALLET,
  slots: initialSlots(),
  selected: 0,
  dead: false,
  deaths: 0,
  houses: [],
  toast: null,
};

export type Action =
  | { type: "setName"; name: string }
  | { type: "startLoading" }
  | { type: "worldReady"; houses: House[] }
  | { type: "tick"; dt: number }
  | { type: "enter"; view: View }
  | { type: "leave" }
  | { type: "buy"; item: ItemId }
  | { type: "select"; slot: number }
  | { type: "eat" }
  | { type: "respawn" }
  | { type: "clearToast"; id: number };

let toastCounter = 0;
const toast = (text: string, tone: "ok" | "error" = "ok") => ({
  id: ++toastCounter,
  text,
  tone,
});

export function isSheltered(state: Pick<GameState, "view">): boolean {
  return state.view === "shop";
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "setName":
      return { ...state, name: action.name };

    case "startLoading": {
      const name = state.name.trim();
      if (!name) return state;
      return { ...state, name, phase: "loading" };
    }

    case "worldReady":
      if (state.phase !== "loading") return state;
      return { ...state, phase: "playing", houses: action.houses };

    case "tick": {
      if (state.phase !== "playing" || state.dead || !state.tutorialDone) {
        return state;
      }
      const dt = Math.max(0, action.dt);
      const elapsed = state.elapsed + dt;
      const clock = getClock(elapsed);
      const rate = drainPerSecond(clock.season, clock.isDay, isSheltered(state));
      let acc = state.drainAcc + rate * dt;
      let health = state.health;
      while (acc >= 1 - 1e-9 && health > 0) {
        acc -= 1;
        health -= 1;
      }
      if (health <= 0) {
        return {
          ...state,
          elapsed,
          health: 0,
          drainAcc: 0,
          dead: true,
          deaths: state.deaths + 1,
        };
      }
      return { ...state, elapsed, health, drainAcc: acc };
    }

    case "enter": {
      if (state.phase !== "playing" || state.dead || state.view !== "world") {
        return state;
      }
      if (!state.tutorialDone && action.view !== "forest") return state;
      return {
        ...state,
        view: action.view,
        tutorialDone: state.tutorialDone || action.view === "forest",
      };
    }

    case "leave":
      return state.view === "world" ? state : { ...state, view: "world" };

    case "buy": {
      if (state.dead) return state;
      const item = ITEMS[action.item];
      const free = state.slots.indexOf(null);
      if (free === -1) {
        return {
          ...state,
          toast: toast("Ekwipunek pełny (maks. 8 przedmiotów).", "error"),
        };
      }
      if (state.wallet < item.price) {
        return { ...state, toast: toast("Za mało pieniędzy.", "error") };
      }
      const slots = [...state.slots];
      slots[free] = item.id;
      return {
        ...state,
        slots,
        wallet: state.wallet - item.price,
        toast: toast(`Kupiono: ${item.name} (−${item.price} zł)`),
      };
    }

    case "select":
      if (action.slot < 0 || action.slot >= INVENTORY_SLOTS) return state;
      return { ...state, selected: action.slot };

    case "eat": {
      if (state.dead) return state;
      const id = state.slots[state.selected];
      if (!id) return state;
      const item = ITEMS[id];
      if (item.heal <= 0) return state;
      const slots = [...state.slots];
      slots[state.selected] = null;
      const health = Math.min(MAX_HEALTH, state.health + item.heal);
      return {
        ...state,
        slots,
        health,
        selected: 0,
        toast: toast(`${item.name}: +${health - state.health}% życia`),
      };
    }

    case "respawn":
      if (!state.dead) return state;
      return {
        ...state,
        dead: false,
        health: MAX_HEALTH,
        drainAcc: 0,
        view: "world",
        slots: initialSlots(),
        selected: 0,
        toast: toast("Odradzasz się z telefonem. Reszta rzeczy przepadła."),
      };

    case "clearToast":
      return state.toast?.id === action.id ? { ...state, toast: null } : state;

    default:
      return state;
  }
}

const WALL_COLORS = [
  "#f4e3c1",
  "#e8b4a0",
  "#b5d0e6",
  "#c9dfb3",
  "#e6d3f0",
  "#f2c879",
  "#d7d7d7",
];
const ROOF_COLORS = ["#a23b2a", "#5b3a29", "#2f4858", "#6b7a8f", "#7a2e4d", "#3a5a40"];
const DOOR_COLORS = ["#7a4a21", "#1d4e89", "#2d6a4f", "#9b2226", "#333"];
const STREETS = ["Zielona", "Lipowa", "Polna", "Krótka", "Słoneczna", "Leśna"];

export function generateHouse(
  id: string,
  rnd: () => number = Math.random,
): House {
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
  const price = Math.round((200_000 + rnd() * 300_000) / 1000) * 1000;
  const phone = Array.from({ length: 6 }, () => Math.floor(rnd() * 10)).join("");
  return {
    id,
    name: `Dom, ul. ${pick(STREETS)} ${1 + Math.floor(rnd() * 40)}`,
    price: Math.min(500_000, Math.max(200_000, price)),
    phone,
    wallColor: pick(WALL_COLORS),
    roofColor: pick(ROOF_COLORS),
    doorColor: pick(DOOR_COLORS),
    roofStyle: pick(["gable", "hip", "flat"] as const),
    hasChimney: rnd() > 0.4,
    hasGarage: rnd() > 0.5,
  };
}

export function formatMoney(value: number): string {
  return `${value.toLocaleString("pl-PL").replace(/\s/g, " ")} zł`;
}

export function formatPhone(phone: string): string {
  return `${phone.slice(0, 3)}-${phone.slice(3)}`;
}
