import type { House } from "../content/houses";
import type { ItemStack } from "../content/items";
import type { BadgeId, RegionId } from "../core/ids";
import type { CharacterAppearanceV1 } from "@/lib/character/appearance";
import type { LanternState } from "../content/equipment";
import type { ChestState, ForestPose, Ledger, TrollPhase } from "../core/state";

/** Bieżąca wersja formatu zapisu (SaveVN). Zmiana struktury = nowa wersja + migracja. */
export const CURRENT_SAVE_VERSION = 5;

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
 * SaveV5 (bieżący): SaveV4 + stan stałej lampy naftowej (`player.lantern`, tylko flaga `enabled`; parametry światła i
 * geometria nie należą do zapisu). SaveV4 to SaveV3 + wygląd postaci gracza (`player.appearance`). SaveV3 to SaveV1 +
 * ekwipunek ze stosami i księgą, zadania, skrzynie, troll z depozytem, pozyskane obiekty, most, odkryte regiony i
 * odznaki. Kotwice świata (pozycje skrzyń itd.) NIE są zapisywane: wynikają z (seed, genVersion) i są chronione
 * odciskiem świata.
 */
export type SaveV5 = {
  version: 5;
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
    appearance: CharacterAppearanceV1;
    lantern: LanternState;
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

/**
 * SaveV4 (zamrożony): poprzedni format, identyczny z SaveV5 poza brakiem `player.lantern`. Czytany wyłącznie przez
 * migrację v4 -> v5, która dodaje wyłączoną lampę i nic poza nią.
 */
export type SaveV4 = Omit<SaveV5, "version" | "player"> & {
  version: 4;
  player: Omit<SaveV5["player"], "lantern">;
};

/**
 * SaveV3 (zamrożony): poprzedni format, identyczny z SaveV4 poza brakiem `player.appearance`. Czytany wyłącznie przez
 * migrację v3 -> v4, która dodaje domyślny wygląd i nic poza nim.
 */
export type SaveV3 = Omit<SaveV4, "version" | "player"> & {
  version: 3;
  player: Omit<SaveV4["player"], "appearance">;
};

/** Stos przedmiotu w zamrożonym formacie V2: id jest zwykłym napisem, bo przedmioty usunięte z gry (telefon) nie są już w `ItemId`. */
type LegacyStack = { id: string; count: number };

/**
 * SaveV2 (zamrożony): format sprzed SaveV3, identyczny z nim poza tym, że ekwipunek, księga i depozyt mogły zawierać
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
export type Save = SaveV5;

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
