import type { House } from "../content/houses";
import type { ItemId } from "../content/items";
import type { ForestPose } from "../core/state";

/** Bieżąca wersja formatu zapisu (SaveVN). Zmiana struktury = nowa wersja + migracja. */
export const CURRENT_SAVE_VERSION = 1;

/**
 * Trwały zapis gry. Tylko dane JSON – bez obiektów Three.js, bez stanu okien,
 * komunikatów, widoku, stosu pauz ani innych danych sesji.
 *
 * Quest, skrzynie, minimapa itd. dojdą w kolejnych wersjach (SaveV2+), każda z migracją.
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
    slots: (ItemId | null)[];
    selected: number;
    forestPose: ForestPose | null;
  };
  tutorial: { done: boolean };
  houses: House[];
};

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
] as const;
