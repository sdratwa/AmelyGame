import type { House } from "../content/houses";
import type { ItemStack } from "../content/items";
import type { BadgeId, RegionId } from "../core/ids";
import type { ChestState, ForestPose, Ledger, TrollPhase } from "../core/state";

/** Bieżąca wersja formatu zapisu (SaveVN). Zmiana struktury = nowa wersja + migracja. */
export const CURRENT_SAVE_VERSION = 3;

type LegacySlot = string | null;

/**
 * SaveV1 (zamrożony): dawny format sprzed questa; czytany wyłącznie przez migrację v1 -> v2.
 * Trwały zapis gry to tylko dane JSON – bez obiektów Three.js, bez stanu okien,
 * komunikatów, widoku, stosu pauz ani innych danych sesji.
 */
export type SaveV1 = {
  version: 1;
  saveId: string;
  /** Czas zegara ściennego (ms) – wyłącznie informacyjnie, ustawiany przez warstwę zapisu. */
  savedAt: number;
  world: {
    seed: number;
    genVersion: number;
    fingerprint: string;
    genHistory: { version: number; atElapsed: number }[];
  };
  time: { elapsed: number };
  player: {
    name: string;
    health: number;
    drainAcc: number;
    dead: boolean;
    deaths: number;
    wallet: number;
    slots: LegacySlot[];
    selected: number;
    forestPose: ForestPose | null;
  };
  tutorial: { done: boolean };
  houses: House[];
};

/**
 * SaveV3 (bieżący): SaveV1 + ekwipunek ze stosami i księgą, zadania, skrzynie, troll z depozytem, pozyskane obiekty,
 * most, odkryte regiony i odznaki. Kotwice świata (pozycje skrzyń itd.) NIE są zapisywane: wynikają z
 * (seed, genVersion) i są chronione odciskiem świata.
 */
export type SaveV3 = {
  version: 3;
  saveId: string;
  savedAt: number;
  world: SaveV1["world"];
  time: { elapsed: number };
  player: {
    name: string;
    health: number;
    drainAcc: number;
    dead: boolean;
    deaths: number;
    wallet: number;
    slots: (ItemStack | null)[];
    ledger: Ledger;
    selected: number;
    forestPose: ForestPose | null;
  };
  tutorial: { done: boolean };
  houses: House[];
  quests: {
    accepted: Record<string, { at: number }>;
    completed: Record<string, { at: number }>;
    read: string[];
  };
  chests: Record<string, ChestState>;
  troll: { phase: TrollPhase; lockUntil: number; attempts: number; deposit: ItemStack[] };
  harvested: string[];
  bridge: { built: boolean; builtAt: number | null };
  discovered: RegionId[];
  badges: BadgeId[];
};

/** Stos przedmiotu w zamrożonym formacie V2: id jest zwykłym napisem, bo przedmioty usunięte z gry (telefon) nie są już w `ItemId`. */
type LegacyStack = { id: string; count: number };

/**
 * SaveV2 (zamrożony): poprzedni format, identyczny z SaveV3 poza tym, że ekwipunek, księga i depozyt mogły zawierać
 * telefon (slot 1, `item.phone`). Czytany wyłącznie przez migrację v2 -> v3, która usuwa telefon i nic poza nim.
 */
export type SaveV2 = Omit<SaveV3, "version" | "player" | "troll"> & {
  version: 2;
  player: Omit<SaveV3["player"], "slots" | "ledger"> & {
    slots: (LegacyStack | null)[];
    ledger: { gained: Record<string, number>; spent: Record<string, number> };
  };
  troll: Omit<SaveV3["troll"], "deposit"> & { deposit: LegacyStack[] };
};

/** Aktualny format zapisu. */
export type Save = SaveV3;

/** Klucze najwyższego poziomu – używane w testach pilnujących rozdziału danych trwałych od sesji. */
export const SAVE_TOP_LEVEL_KEYS = [
  "version",
  "saveId",
  "savedAt",
  "world",
  "time",
  "player",
  "tutorial",
  "houses",
  "quests",
  "chests",
  "troll",
  "harvested",
  "bridge",
  "discovered",
  "badges",
] as const;
