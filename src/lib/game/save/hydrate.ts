import type { GameState } from "../core/state";
import type { SaveV1 } from "./schema";

/**
 * Stan gry z zapisu. Dane sesji (widok, komunikaty, stos pauz) startują od zera:
 * po wczytaniu gracz zawsze wraca na mapę świata.
 */
export function hydrateState(save: SaveV1): GameState {
  return {
    phase: "playing",
    name: save.player.name,
    view: "world",
    tutorialDone: save.tutorial.done,
    elapsed: save.time.elapsed,
    health: save.player.health,
    drainAcc: save.player.drainAcc,
    wallet: save.player.wallet,
    slots: [...save.player.slots],
    selected: save.player.selected,
    dead: save.player.dead,
    deaths: save.player.deaths,
    houses: save.houses.map((h) => ({ ...h })),
    world: {
      saveId: save.saveId,
      seed: save.world.seed,
      genVersion: save.world.genVersion,
      fingerprint: save.world.fingerprint,
      genHistory: save.world.genHistory.map((h) => ({ ...h })),
    },
    forestPose: save.player.forestPose ? { ...save.player.forestPose } : null,
    toast: null,
    toastSeq: 0,
    pauses: [],
  };
}
