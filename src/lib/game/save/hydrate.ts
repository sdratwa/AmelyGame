import type { ItemStack } from "../content/items";
import type { GameState } from "../core/state";
import { generateWorld, hasGenerator } from "../world";
import type { SaveV2 } from "./schema";

const stacks = (list: readonly (ItemStack | null)[]) => list.map((s) => (s ? { id: s.id, count: s.count } : null));
const record = <T extends object>(map: Record<string, T>) =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { ...v }]));

/**
 * Stan gry z zapisu. Dane sesji (widok, dialog, komunikaty, stos pauz) startują od zera:
 * po wczytaniu gracz zawsze wraca na mapę świata. Kotwice świata są odtwarzane z (seed, wersja generatora).
 */
export function hydrateState(save: SaveV2): GameState {
  const anchors = hasGenerator(save.world.genVersion)
    ? (generateWorld(save.world.seed, save.world.genVersion).forest?.anchors ?? null)
    : null;
  return {
    phase: "playing",
    name: save.player.name,
    view: "world",
    tutorialDone: save.tutorial.done,
    elapsed: save.time.elapsed,
    health: save.player.health,
    drainAcc: save.player.drainAcc,
    wallet: save.player.wallet,
    slots: stacks(save.player.slots),
    ledger: { gained: { ...save.player.ledger.gained }, spent: { ...save.player.ledger.spent } },
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
      anchors,
    },
    forestPose: save.player.forestPose ? { ...save.player.forestPose } : null,
    quests: {
      accepted: record(save.quests.accepted),
      completed: record(save.quests.completed),
      read: [...save.quests.read] as GameState["quests"]["read"],
    },
    chests: record(save.chests) as GameState["chests"],
    troll: {
      phase: save.troll.phase,
      lockUntil: save.troll.lockUntil,
      attempts: save.troll.attempts,
      deposit: stacks(save.troll.deposit) as ItemStack[],
    },
    harvested: [...save.harvested],
    bridge: { built: save.bridge.built, builtAt: save.bridge.builtAt },
    discovered: [...save.discovered],
    badges: [...save.badges],
    dialog: null,
    toast: null,
    toastSeq: 0,
    pauses: [],
  };
}
