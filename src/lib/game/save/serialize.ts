import type { GameState } from "../core/state";
import type { SaveV1 } from "./schema";

/**
 * Whitelista pól trwałych. Nowe pole stanu NIE trafia do zapisu, dopóki nie
 * zostanie tu świadomie dodane (razem z wersją schematu i migracją).
 * Zwraca null, gdy gra nie jest w stanie nadającym się do zapisu.
 */
export function serializeState(state: GameState, savedAt: number): SaveV1 | null {
  if (state.phase !== "playing" || !state.world) return null;
  return {
    version: 1,
    saveId: state.world.saveId,
    savedAt,
    world: {
      seed: state.world.seed,
      genVersion: state.world.genVersion,
      fingerprint: state.world.fingerprint,
      genHistory: state.world.genHistory.map((h) => ({ ...h })),
    },
    time: { elapsed: state.elapsed },
    player: {
      name: state.name,
      health: state.health,
      drainAcc: state.drainAcc,
      dead: state.dead,
      deaths: state.deaths,
      wallet: state.wallet,
      slots: [...state.slots],
      selected: state.selected,
      forestPose: state.forestPose ? { ...state.forestPose } : null,
    },
    tutorial: { done: state.tutorialDone },
    houses: state.houses.map((h) => ({ ...h })),
  };
}
