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
