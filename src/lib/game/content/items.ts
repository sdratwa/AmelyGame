export type ItemId =
  | "item.phone"
  | "item.hotdog"
  | "item.sandwich"
  | "item.water"
  | "item.coffee"
  | "item.chocolate"
  | "item.pickaxe"
  | "item.saw"
  | "item.bridge_blueprint"
  | "resource.wood"
  | "resource.stone";

export type ItemCategory = "device" | "food" | "tool" | "blueprint" | "resource";

export type Item = {
  id: ItemId;
  name: string;
  emoji: string;
  category: ItemCategory;
  heal: number;
  price: number;
  description: string;
  /** Maks. liczba sztuk w jednym miejscu ekwipunku (konfigurowalne w danych). */
  maxStack: number;
  /** Nigdy nie jest konfiskowany przez trolla ani tracony przy odrodzeniu. */
  protected: boolean;
  /** Zostaje przy odrodzeniu (jedzenie może przepaść). */
  keepOnDeath: boolean;
  /** Gracz może go wyrzucić (zwalnia miejsce); przedmioty questowe nie. */
  discardable: boolean;
  /** Komunikat po wyjęciu ze skrzyni (domyślnie "Zdobyto: <nazwa>"). */
  pickupMessage?: string;
};

export const DEFAULT_MAX_STACK = 20;

const food = (
  id: ItemId,
  name: string,
  emoji: string,
  heal: number,
  price: number,
  description: string,
): Item => ({
  id,
  name,
  emoji,
  category: "food",
  heal,
  price,
  description,
  maxStack: 1,
  protected: false,
  keepOnDeath: false,
  discardable: true,
});

export const ITEMS: Record<ItemId, Item> = {
  "item.phone": {
    id: "item.phone",
    name: "Telefon",
    emoji: "📱",
    category: "device",
    heal: 0,
    price: 0,
    description: "Twój telefon. Nigdy go nie stracisz.",
    maxStack: 1,
    protected: true,
    keepOnDeath: true,
    discardable: false,
  },
  "item.hotdog": food("item.hotdog", "Hot-dog", "🌭", 25, 12, "Gorący i sycący."),
  "item.sandwich": food("item.sandwich", "Kanapka", "🥪", 20, 9, "Szybka przekąska na drogę."),
  "item.coffee": food("item.coffee", "Kawa", "☕", 10, 7, "Rozgrzewa w zimowy dzień."),
  "item.chocolate": food("item.chocolate", "Czekolada", "🍫", 8, 5, "Mała porcja energii."),
  "item.water": food("item.water", "Woda", "💧", 5, 3, "Orzeźwia, ale niewiele leczy."),
  "item.pickaxe": {
    id: "item.pickaxe",
    name: "Kilof",
    emoji: "⛏️",
    category: "tool",
    heal: 0,
    price: 0,
    description: "Pozwala pozyskiwać kamień ze skał.",
    maxStack: 1,
    protected: false,
    keepOnDeath: true,
    discardable: false,
  },
  "item.saw": {
    id: "item.saw",
    name: "Piła",
    emoji: "🪚",
    category: "tool",
    heal: 0,
    price: 0,
    description: "Pozwala pozyskiwać drewno z drzew.",
    maxStack: 1,
    protected: false,
    keepOnDeath: true,
    discardable: false,
  },
  "item.bridge_blueprint": {
    id: "item.bridge_blueprint",
    name: "Schemat mostu",
    emoji: "📜",
    category: "blueprint",
    heal: 0,
    price: 0,
    description: "Stary plan drewnianego mostu nad rzeką.",
    pickupMessage: "Zdobyto schemat mostu",
    maxStack: 1,
    protected: false,
    keepOnDeath: true,
    discardable: false,
  },
  "resource.wood": {
    id: "resource.wood",
    name: "Drewno",
    emoji: "🪵",
    category: "resource",
    heal: 0,
    price: 0,
    description: "Surowiec do budowy.",
    maxStack: DEFAULT_MAX_STACK,
    protected: false,
    keepOnDeath: true,
    discardable: false,
  },
  "resource.stone": {
    id: "resource.stone",
    name: "Kamień",
    emoji: "🪨",
    category: "resource",
    heal: 0,
    price: 0,
    description: "Surowiec do budowy.",
    maxStack: DEFAULT_MAX_STACK,
    protected: false,
    keepOnDeath: true,
    discardable: false,
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export const isItemId = (value: unknown): value is ItemId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(ITEMS, value);

export const SHOP_ITEMS: ItemId[] = [
  "item.hotdog",
  "item.sandwich",
  "item.coffee",
  "item.chocolate",
  "item.water",
];

/** Zgodność ze starymi zapisami (SaveV1): identyfikatory bez przestrzeni nazw. */
export const LEGACY_ITEM_IDS: Readonly<Record<string, ItemId>> = {
  phone: "item.phone",
  hotdog: "item.hotdog",
  sandwich: "item.sandwich",
  water: "item.water",
  coffee: "item.coffee",
  chocolate: "item.chocolate",
};

export type ItemStack = { id: ItemId; count: number };
