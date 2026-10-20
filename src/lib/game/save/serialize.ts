import type { ItemStack } from "../content/items";
import type { GameState } from "../core/state";
import type { SaveV3 } from "./schema";

const stacks = (list: readonly (ItemStack | null)[]) => list.map((s) => (s ? { id: s.id, count: s.count } : null));
const record = <T extends object>(map: Record<string, T>) =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { ...v }]));

/**
 * Whitelista pól trwałych. Nowe pole stanu NIE trafia do zapisu, dopóki nie
 * zostanie tu świadomie dodane (razem z wersją schematu i migracją).
 * Zwraca null, gdy gra nie jest w stanie nadającym się do zapisu.
 */
export function serializeState(state: GameState, savedAt: number): SaveV3 | null {
  if (state.phase !== "playing" || !state.world) return null;
  return {
    version: 3,
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
      slots: stacks(state.slots),
      ledger: { gained: { ...state.ledger.gained }, spent: { ...state.ledger.spent } },
      selected: state.selected,
      forestPose: state.forestPose ? { ...state.forestPose } : null,
    },
    tutorial: { done: state.tutorialDone },
    houses: state.houses.map((h) => ({ ...h })),
    quests: {
      accepted: record(state.quests.accepted),
      completed: record(state.quests.completed),
      read: [...state.quests.read],
    },
    chests: record(state.chests),
    troll: {
      phase: state.troll.phase,
      lockUntil: state.troll.lockUntil,
      attempts: state.troll.attempts,
      deposit: stacks(state.troll.deposit) as ItemStack[],
    },
    harvested: [...state.harvested],
    bridge: { built: state.bridge.built, builtAt: state.bridge.builtAt },
    discovered: [...state.discovered],
    badges: [...state.badges],
  };
}
