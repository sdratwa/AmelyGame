import { INVENTORY_SLOTS, MAX_HEALTH, START_WALLET } from "./constants";
import type { House } from "../content/houses";
import type { ItemId } from "../content/items";

export type View = "world" | "forest" | "shop";
export type Phase = "name" | "loading" | "playing";

/** Jawny powód zatrzymania zegara: para (powód, właściciel). */
export type PauseEntry = { reason: string; owner: string };

/** Tożsamość świata wygenerowanego dla tej gry (trwała, zapisywana). */
export type WorldInfo = {
  saveId: string;
  seed: number;
  genVersion: number;
  fingerprint: string;
  genHistory: { version: number; atElapsed: number }[];
};

/** Ostatnia pozycja i kierunek gracza w lesie (trwałe). yaw w radianach. */
export type ForestPose = { x: number; z: number; yaw: number };

export type Toast = { id: number; text: string; tone: "ok" | "error" };

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
  world: WorldInfo | null;
  forestPose: ForestPose | null;
  toast: Toast | null;
  toastSeq: number;
  pauses: PauseEntry[];
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
  world: null,
  forestPose: null,
  toast: null,
  toastSeq: 0,
  pauses: [],
};
