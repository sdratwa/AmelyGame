import type { GameState } from "./state";

export type SharedWorld = { revision: number; harvested: string[]; bridgeBuilt: boolean };

export function applySharedWorld(state: GameState, world: SharedWorld): GameState {
  if (state.bridge.built === world.bridgeBuilt && state.harvested.length === world.harvested.length && state.harvested.every((id, i) => id === world.harvested[i])) return state;
  return { ...state, savedBridge: state.bridge.built ? state.bridge : state.savedBridge, harvested: [...world.harvested], bridge: { built: world.bridgeBuilt, builtAt: world.bridgeBuilt ? (state.bridge.builtAt ?? state.elapsed) : null } };
}
