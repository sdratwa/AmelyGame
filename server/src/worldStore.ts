import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { emptySharedWorld, type SharedWorld } from "../../src/lib/multiplayer/sharedWorld";
import type { WorldConfig } from "../../src/lib/multiplayer/protocol";
import { forestObject } from "../../src/lib/game/world/lookup";
import { harvestOf } from "../../src/lib/game/world/harvest";
import { fingerprintWorld, generateWorld } from "../../src/lib/game/world/registry";

export class WorldStore {
  constructor(private path: string, private config: WorldConfig, private allowV3Migration = false, private allowV4Migration = false) {}
  load(): SharedWorld {
    if (!existsSync(this.path)) return emptySharedWorld();
    const data = JSON.parse(readFileSync(this.path, "utf8"));
    const world = data.world as SharedWorld;
    const ref = { seed: this.config.worldSeed, genVersion: this.config.generatorVersion };
    const previous = data.config as WorldConfig | undefined;
    const same = previous && previous.worldId === this.config.worldId && previous.worldInstanceId === this.config.worldInstanceId && previous.worldSeed === this.config.worldSeed;
    // v4 -> v5 (fizyka skał): pozycje, ID i kolizje kołowe są takie same, więc stan wspólnego świata przechodzi bez zmian.
    const migratingV4 = !!same && previous.generatorVersion === 4 && this.config.generatorVersion === 5 &&
      previous.fingerprint === fingerprintWorld(generateWorld(this.config.worldSeed, 4));
    if (migratingV4 && !this.allowV4Migration) throw Error("Świat v4 wymaga jawnej migracji: uruchom serwer z MIGRATE_WORLD_V4=1. Plik zachowano.");
    const migratingV3 = previous?.generatorVersion === 3 && this.config.generatorVersion >= 4 &&
      previous.worldId === this.config.worldId && previous.worldInstanceId === this.config.worldInstanceId &&
      previous.worldSeed === this.config.worldSeed &&
      previous.fingerprint === fingerprintWorld(generateWorld(this.config.worldSeed, 3));
    if (migratingV3 && !this.allowV3Migration) throw Error("Świat v3 wymaga jawnej migracji: uruchom serwer z MIGRATE_WORLD_V3=1. Plik zachowano.");
    if (data.version !== 1 || (!migratingV3 && !migratingV4 && JSON.stringify(data.config) !== JSON.stringify(this.config)) || !world ||
      !Number.isSafeInteger(world.revision) || world.revision < 0 || typeof world.bridgeBuilt !== "boolean" ||
      !Array.isArray(world.harvested) || world.harvested.length > 5000 || new Set(world.harvested).size !== world.harvested.length ||
      world.harvested.some((id) => { const object = typeof id === "string" ? forestObject(ref, id) : null; return !object || !harvestOf(object); })) {
      throw Error("Niepoprawny lub niezgodny zapis wspólnego świata. Zachowano plik; start pokoju przerwany.");
    }
    if (migratingV3 || migratingV4) {
      const tag = migratingV3 ? "v3" : "v4";
      const backup = `${this.path}.${tag}.bak`;
      if (existsSync(backup)) throw Error(`Kopia świata ${tag} już istnieje; migracja wymaga ręcznej kontroli.`);
      copyFileSync(this.path, backup);
      this.save(world);
    }
    return world;
  }
  save(world: SharedWorld) {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify({ version: 1, config: this.config, world }));
    renameSync(`${this.path}.tmp`, this.path);
  }
}
