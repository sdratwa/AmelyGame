import { DEFAULT_APPEARANCE } from "@/lib/character/appearance";
import { result, unchanged, type CommandResult } from "../core/result";
import {
  initialLedger,
  initialQuests,
  initialSlots,
  initialTroll,
  type ForestPose,
  type GameState,
  type View,
} from "../core/state";
import { CURRENT_GEN_VERSION, fingerprintWorld, generateWorld } from "../world";
import { isForestPose } from "../core/pose";

export function setName(state: GameState, name: string): CommandResult {
  return result({ ...state, name });
}

const isUint32 = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff;

/** Nowa gra: seed i saveId przychodzą z zewnątrz (entropia), a świat powstaje deterministycznie z seeda. */
export function startLoading(state: GameState, seed: number, saveId: string): CommandResult {
  const name = state.name.trim();
  if (!name || !isUint32(seed) || !saveId) return unchanged(state);
  const base = generateWorld(seed, CURRENT_GEN_VERSION);
  return result(
    {
      ...state,
      name,
      phase: "loading",
      houses: base.houses,
      forestPose: null,
      appearance: { ...DEFAULT_APPEARANCE },
      slots: initialSlots(),
      ledger: initialLedger(),
      selected: 0,
      quests: initialQuests(),
      chests: {},
      troll: initialTroll(),
      harvested: [],
      bridge: { built: false, builtAt: null },
      discovered: [],
      badges: [],
      dialog: null,
      world: {
        saveId,
        seed,
        genVersion: base.genVersion,
        fingerprint: fingerprintWorld(base),
        genHistory: [],
        anchors: base.forest?.anchors ?? null,
      },
    },
    { type: "game.started", name },
  );
}

export function worldReady(state: GameState): CommandResult {
  if (state.phase !== "loading" || !state.world) return unchanged(state);
  return result({ ...state, phase: "playing" }, { type: "world.ready" });
}

export function setForestPose(state: GameState, pose: ForestPose): CommandResult {
  if (state.phase !== "playing" || !isForestPose(pose)) return unchanged(state);
  const cur = state.forestPose;
  if (cur && cur.x === pose.x && cur.z === pose.z && cur.yaw === pose.yaw) {
    return unchanged(state);
  }
  return result({ ...state, forestPose: { x: pose.x, z: pose.z, yaw: pose.yaw } });
}

export function enterView(state: GameState, view: View): CommandResult {
  if (state.phase !== "playing" || state.dead || state.view !== "world") {
    return unchanged(state);
  }
  // Samouczek: dopóki gracz nie przyjmie zadania z tablicy ogłoszeń, nie wchodzi do lasu, sklepu ani domów.
  if (!state.tutorialDone) return unchanged(state);
  return result({ ...state, view }, { type: "view.entered", view });
}

export function leaveView(state: GameState): CommandResult {
  if (state.view === "world") return unchanged(state);
  return result({ ...state, view: "world" }, { type: "view.left", from: state.view });
}

export function clearToast(state: GameState, id: number): CommandResult {
  return state.toast?.id === id
    ? result({ ...state, toast: null })
    : unchanged(state);
}
