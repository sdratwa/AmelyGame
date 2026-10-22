import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptySharedWorld, type SharedWorld } from "../../src/lib/multiplayer/sharedWorld";
import type { WorldConfig } from "../../src/lib/multiplayer/protocol";
import { forestObject } from "../../src/lib/game/world/lookup";
import { harvestOf } from "../../src/lib/game/world/harvest";

export class WorldStore {
  constructor(private path: string, private config: WorldConfig) {}
  load(): SharedWorld {
    if (!existsSync(this.path)) return emptySharedWorld();
    const data = JSON.parse(readFileSync(this.path, "utf8"));
    const world = data.world as SharedWorld;
    const ref = { seed: this.config.worldSeed, genVersion: this.config.generatorVersion };
    if (data.version !== 1 || JSON.stringify(data.config) !== JSON.stringify(this.config) || !world ||
      !Number.isSafeInteger(world.revision) || world.revision < 0 || typeof world.bridgeBuilt !== "boolean" ||
      !Array.isArray(world.harvested) || world.harvested.length > 5000 || new Set(world.harvested).size !== world.harvested.length ||
      world.harvested.some((id) => { const object = typeof id === "string" ? forestObject(ref, id) : null; return !object || !harvestOf(object); })) {
      throw Error("Niepoprawny lub niezgodny zapis wspólnego świata. Zachowano plik; start pokoju przerwany.");
    }
    return world;
  }
  save(world: SharedWorld) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify({ version: 1, config: this.config, world }));
    renameSync(`${this.path}.tmp`, this.path);
  }
}
