import { applyCommand, type Command } from "../game/core/apply";
import { hydrateState } from "../game/save/hydrate";
import { validateSaveV4 } from "../game/save/validate";
import { forestObject } from "../game/world/lookup";
import { harvestOf } from "../game/world/harvest";
import type { WorldConfig } from "./protocol";

export { type SharedWorld, applySharedWorld } from "../game/core/sharedWorld";
import { type SharedWorld, applySharedWorld } from "../game/core/sharedWorld";
export type WorldCommand = Extract<Command, { type: "harvest" | "bridge.build" }>;
export type WorldReply = { requestId: number; accepted: boolean; world: SharedWorld };
export const emptySharedWorld = (): SharedWorld => ({ revision: 0, harvested: [], bridgeBuilt: false });
export function isWorldCommand(command: Command): command is WorldCommand {
  return command.type === "harvest" || command.type === "bridge.build";
}

/** The server owns world mutations; a local save is only evidence of personal inventory. */
export function resolveWorldCommand(world: SharedWorld, config: WorldConfig, command: unknown, save: unknown): { accepted: boolean; world: SharedWorld } {
  if (!command || typeof command !== "object") return { accepted: false, world };
  if ((command as { type?: unknown }).type === "world.restore") {
    const checked = validateSaveV4(save);
    if (!checked.ok || checked.value.world.seed !== config.worldSeed || checked.value.world.genVersion !== config.generatorVersion || checked.value.world.fingerprint !== config.fingerprint) return { accepted: false, world };
    const ref = { seed: config.worldSeed, genVersion: config.generatorVersion };
    if (checked.value.harvested.some((id) => { const object = forestObject(ref, id); return !object || !harvestOf(object); })) return { accepted: false, world };
    const harvested = [...new Set([...world.harvested, ...checked.value.harvested])];
    if (harvested.length > 5000) return { accepted: false, world };
    const bridgeBuilt = world.bridgeBuilt || checked.value.bridge.built;
    const changed = harvested.length !== world.harvested.length || bridgeBuilt !== world.bridgeBuilt;
    return { accepted: true, world: changed ? { revision: world.revision + 1, harvested, bridgeBuilt } : world };
  }
  const c = command as WorldCommand;
  if (!isWorldCommand(c) || Object.keys(c).some((k) => !["type", "at", ...(c.type === "harvest" ? ["objectId"] : [])].includes(k))) return { accepted: false, world };
  const checked = validateSaveV4(save);
  if (!checked.ok || checked.value.world.seed !== config.worldSeed || checked.value.world.genVersion !== config.generatorVersion || checked.value.world.fingerprint !== config.fingerprint) return { accepted: false, world };
  const state = applySharedWorld({ ...hydrateState(checked.value), view: "forest" }, world);
  const out = applyCommand(state, c);
  const accepted = out.events.some((e) => e.type === "resource.harvested" || e.type === "bridge.built");
  return { accepted, world: accepted ? { revision: world.revision + 1, harvested: out.state.harvested, bridgeBuilt: out.state.bridge.built } : world };
}

