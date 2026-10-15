import { INVENTORY_SLOTS, MAX_HEALTH, START_WALLET } from "./constants";
import type { House } from "../content/houses";
import type { ItemStack } from "../content/items";
import type { WorldAnchors } from "../world/anchors";
import type { BadgeId, NpcId, QuestId, RegionId, RiddleId } from "./ids";

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
  /** Kotwice questa z generatora (wyliczane z seeda i wersji, nie zapisywane osobno). */
  anchors: WorldAnchors | null;
};

/** Ostatnia pozycja i kierunek gracza w lesie (trwałe). yaw w radianach. */
export type ForestPose = { x: number; z: number; yaw: number };

/** Księga przedmiotów: ile sztuk gracz kiedykolwiek zdobył i ile wydał/zużył/wyrzucił (niezmiennik: zdobyte - wydane = u gracza + w depozycie). */
export type Ledger = { gained: Record<string, number>; spent: Record<string, number> };

export type QuestsState = {
  accepted: Record<string, { at: number }>;
  completed: Record<string, { at: number }>;
  /** Zadania z tablicy, które gracz już obejrzał (znika wykrzyknik). */
  read: QuestId[];
};

export type ChestState = { opened: boolean; taken: boolean };

export type TrollPhase = "unmet" | "confronted" | "solved";

export type TrollState = {
  phase: TrollPhase;
  /** Do kiedy (czas gry) troll nie rozmawia: następny dzień po konfiskacie, godzina po błędnej odpowiedzi. */
  lockUntil: number;
  /** Liczba rozstrzygniętych prób zagadki (wyznacza kolejną zagadkę). */
  attempts: number;
  /** Trwały depozyt: przedmioty zabrane graczowi, do odzyskania po rozwiązaniu zagadki. */
  deposit: ItemStack[];
};

/** Dialog z postacią (dane sesji, nie są zapisywane). Powoduje pauzę zegara. */
export type DialogState = {
  npc: NpcId;
  stage: "intro" | "riddle";
  riddle: RiddleId | null;
};

export type BridgeState = { built: boolean; builtAt: number | null };

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
  slots: (ItemStack | null)[];
  ledger: Ledger;
  selected: number;
  dead: boolean;
  deaths: number;
  houses: House[];
  world: WorldInfo | null;
  forestPose: ForestPose | null;
  quests: QuestsState;
  chests: Record<string, ChestState>;
  troll: TrollState;
  harvested: string[];
  bridge: BridgeState;
  discovered: RegionId[];
  badges: BadgeId[];
  dialog: DialogState | null;
  toast: Toast | null;
  toastSeq: number;
  pauses: PauseEntry[];
};

export function initialSlots(): (ItemStack | null)[] {
  return Array.from({ length: INVENTORY_SLOTS }, (_, i) =>
    i === 0 ? { id: "item.phone", count: 1 } : null,
  );
}

export function initialLedger(): Ledger {
  return { gained: { "item.phone": 1 }, spent: {} };
}

export function initialQuests(): QuestsState {
  return { accepted: {}, completed: {}, read: [] };
}

export function initialTroll(): TrollState {
  return { phase: "unmet", lockUntil: 0, attempts: 0, deposit: [] };
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
  ledger: initialLedger(),
  selected: 0,
  dead: false,
  deaths: 0,
  houses: [],
  world: null,
  forestPose: null,
  quests: initialQuests(),
  chests: {},
  troll: initialTroll(),
  harvested: [],
  bridge: { built: false, builtAt: null },
  discovered: [],
  badges: [],
  dialog: null,
  toast: null,
  toastSeq: 0,
  pauses: [],
};
