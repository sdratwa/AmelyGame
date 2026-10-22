import { initialState, reducer } from "../game/engine";
import { loadGame, type BootResult } from "../game/save/loader";
import { serializeState } from "../game/save/serialize";
import type { SaveStore } from "../game/save/store";
import type { Player, WorldConfig } from "./protocol";

export function onlineSavePrefix(config: WorldConfig): string {
  return `miasto.online.${encodeURIComponent(config.worldInstanceId)}`;
}

/** Osobisty postęp online, niezależny od sesji transportu i zapisu solo. */
export async function loadOnlineGame(store: SaveStore, config: WorldConfig, player: Player): Promise<BootResult> {
  const loaded = await loadGame(store);
  if (loaded.kind === "ok") {
    const world = loaded.save.world;
    if (world.seed !== config.worldSeed || world.genVersion !== config.generatorVersion || world.fingerprint !== config.fingerprint) {
      return { kind: "world_mismatch", save: loaded.save, reason: "Zapis online pochodzi z innej wersji świata serwera. Zachowano dotychczasowy postęp." };
    }
    return loaded;
  }
  if (loaded.kind !== "none") return loaded;
  let state = reducer({ ...initialState, name: player.name }, { type: "startLoading", seed: config.worldSeed, saveId: player.playerId });
  state = reducer(state, { type: "worldReady" });
  state = { ...state, tutorialDone: true, forestPose: { x: player.x, z: player.z, yaw: player.bodyYaw } };
  const save = serializeState(state, 0)!;
  if (save.world.genVersion !== config.generatorVersion || save.world.fingerprint !== config.fingerprint) {
    return { kind: "world_mismatch", save, reason: "Nowa gra nie pasuje do świata serwera." };
  }
  return { kind: "ok", save, source: "primary" };
}
