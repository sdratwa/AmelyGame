import type { BodyHideRule } from "./bodyRegions";
import { IDENTITY_FIT, type PartFit } from "./fit";
import type { ShellSpec } from "./clothing/deriveShell";

export type SlotId = "hair" | "top" | "bottom" | "shoes";
export const SLOTS: readonly SlotId[] = ["hair", "top", "bottom", "shoes"];

/** Skąd pochodzi geometria elementu. */
export type ItemSource =
  /** Generowana w kodzie (prototyp; nie jest finalnym assetem graficznym). */
  | { kind: "procedural"; generator: string }
  /** Powłoka wyprowadzona z bazowej siatki na tym samym szkielecie (bez ręcznego modelowania). */
  | { kind: "derived"; shell: ShellSpec }
  /**
   * Osobny GLB (np. z Tripo3D); `file` względem `/characters/` (poziom LOD0 = oryginał). Siatka leży już w układzie
   * lokalnym kości głowy (`head_bone_local`), więc montujemy ją bez żadnej automatycznej korekty skali ani przesunięcia.
   * `lods` to miejsce na uproszczone wersje (LOD1/LOD2); dziś używany jest tylko poziom 0, generowania LOD nie ma.
   */
  | { kind: "glb"; file: string; space: "head_bone_local"; lods?: readonly GlbLod[] };

export type GlbLod = { level: 0 | 1 | 2; file: string; /** Orientacyjna odległość kamery (m), od której warto użyć poziomu. */ minDistance?: number };

/** `ready`: geometria istnieje i jest ładowana; `missing_asset`: slot jest gotowy, ale brakuje zasobu (nie udajemy, że działa). */
export type ItemStatus = "ready" | "missing_asset";

export type CatalogItem = {
  /** Stabilny identyfikator zapisywany w save i używany w multiplayerze. */
  id: string;
  slot: SlotId;
  name: string;
  source: ItemSource;
  status: ItemStatus;
  /** Czy to prototyp proceduralny/pochodny, a nie finalny asset. */
  prototype: boolean;
  /** Limit trójkątów elementu (sprawdzany testem). */
  triangleBudget: number;
  /** Fragmenty bazowej siatki niewidoczne pod elementem. */
  hides?: readonly BodyHideRule[];
  /** Domyślne dopasowanie (fryzury: względem czaszki). */
  fit?: Readonly<PartFit>;
  /** Uwaga widoczna w panelu kreatora (np. brakujący asset). */
  note?: string;
  /** Pochodzenie elementu (dokumentacja i panel), np. `Tripo3D`; brak = kod gry. */
  origin?: string;
  /** Kategoria katalogowa (np. fryzura `Short`). */
  category?: string;
  /** Dla której postaci bazowej element jest dostępny; brak = dla każdej. */
  availableFor?: readonly ("female" | "male")[];
  /**
   * Kolor domyślny elementu. Dla fryzur GLB biały (`#ffffff`) oznacza oryginalny kolor z tekstury (bez przebarwiania);
   * każdy inny kolor przebarwia fryzurę z zachowaniem szczegółów tekstury. Brak = kolor domyślny wyglądu.
   */
  defaultColor?: string;
};

/** Pliki GLB elementu w kolejności poziomów LOD (zawsze zawiera poziom 0). */
export function glbLods(item: CatalogItem): readonly GlbLod[] {
  if (item.source.kind !== "glb") return [];
  const rest = (item.source.lods ?? []).filter((l) => l.level !== 0);
  return [{ level: 0 as const, file: item.source.file }, ...rest].sort((a, b) => a.level - b.level);
}

/** Plik dla poziomu LOD (dziś zawsze LOD0, dopóki nie ma uproszczonych wersji; brakujący poziom wraca do najbliższego niższego). */
export function glbFileForLod(item: CatalogItem, level: 0 | 1 | 2 = 0): string | null {
  const lods = glbLods(item);
  if (lods.length === 0) return null;
  let chosen = lods[0];
  for (const l of lods) if (l.level <= level) chosen = l;
  return chosen.file;
}

const TORSO_SET = ["torso", "hips", "neck", "armL", "armR", "legL", "legR"] as const;
const TOP_HEM = 0.515;
const TOP_COLLAR = 0.765;
const SLEEVE = 0.15;
const HIDE_MARGIN = 0.012;

export const CATALOG: readonly CatalogItem[] = [
  {
    id: "hair.01",
    slot: "hair",
    name: "Krótkie, potargane z grzywką",
    source: { kind: "procedural", generator: "hair01" },
    status: "ready",
    prototype: true,
    triangleBudget: 3000,
    fit: IDENTITY_FIT,
    note: "Prototyp proceduralny; w razie potrzeby można podmienić na GLB (kind: glb) bez zmian w systemie.",
  },
  {
    id: "hair.02",
    slot: "hair",
    name: "Średnie, prosty bob",
    source: { kind: "procedural", generator: "hair02" },
    status: "ready",
    prototype: true,
    triangleBudget: 3500,
    fit: IDENTITY_FIT,
    note: "Prototyp proceduralny.",
  },
  {
    id: "hair_tripo_short_01",
    slot: "hair",
    name: "Krótkie, naturalne",
    source: { kind: "glb", file: "hair/Miasto_Fryzura_HeadLocal_Wstepne_Dopasowanie.glb", space: "head_bone_local" },
    status: "ready",
    prototype: false,
    triangleBudget: 23000,
    fit: IDENTITY_FIT,
    origin: "Tripo3D",
    category: "Short",
    availableFor: ["female"],
    defaultColor: "#ffffff",
    note: "Fryzura z Tripo3D (GLB, ok. 22,5 tys. trójkątów, tekstury 2048 px), zamocowana na kości głowy; dopasowanie wstępne, wymaga oceny w przeglądarce. Biały kolor = oryginalny brąz z tekstury.",
  },
  {
    id: "top.01",
    slot: "top",
    name: "Koszulka przygodowa",
    source: {
      kind: "derived",
      shell: { regions: TORSO_SET, yMin: TOP_HEM, yMax: TOP_COLLAR, absXMax: SLEEVE, offset: 0.0085, flare: { fromY: 0.62, toY: TOP_HEM, extra: 0.006 } },
    },
    status: "ready",
    prototype: true,
    triangleBudget: 7000,
    hides: [{ regions: TORSO_SET, yMin: TOP_HEM + HIDE_MARGIN, yMax: TOP_COLLAR - HIDE_MARGIN, absXMax: SLEEVE - HIDE_MARGIN }],
    note: "Powłoka wyprowadzona z ciała (bez kołnierza i fałd); finalny wygląd wymaga osobnego modelu.",
  },
  {
    id: "bottom.01",
    slot: "bottom",
    name: "Spodnie przygodowe",
    source: {
      kind: "derived",
      shell: { regions: ["torso", "hips", "legL", "legR"], yMin: 0.085, yMax: 0.585, offset: 0.0055, flare: { fromY: 0.3, toY: 0.09, extra: 0.006 } },
    },
    status: "ready",
    prototype: true,
    triangleBudget: 11000,
    hides: [{ regions: ["torso", "hips", "legL", "legR"], yMin: 0.085 + HIDE_MARGIN, yMax: 0.585 - HIDE_MARGIN }],
    note: "Powłoka wyprowadzona z ciała (bez kieszeni i szwów); finalny wygląd wymaga osobnego modelu.",
  },
];

export function findItem(id: string | null | undefined, slot?: SlotId): CatalogItem | null {
  if (!id) return null;
  const item = CATALOG.find((c) => c.id === id);
  return item && (!slot || item.slot === slot) ? item : null;
}

export const itemsOfSlot = (slot: SlotId): CatalogItem[] => CATALOG.filter((c) => c.slot === slot);

/** Postać bazowa, na której działa personalizacja (jedyna grywalna dziś: dziewczynka). */
export const BASE_GENDER = "female" as const;

/** Czy element jest dostępny dla postaci bazowej (brak `availableFor` = dla każdej). */
export const isAvailableForBase = (item: CatalogItem): boolean => !item.availableFor || item.availableFor.includes(BASE_GENDER);
