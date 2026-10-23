import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstance } from "./world";
import { fingerprintWorld, generateWorld } from "../game/world/registry";
import { WorldStore } from "../../../server/src/worldStore";

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

it("migracja wspólnego świata v3→v4 zachowuje stan i oryginalny plik", () => {
  const dir = mkdtempSync(join(tmpdir(), "miasto-world-"));
  paths.push(dir);
  const path = join(dir, "world.json");
  const config = createInstance().config;
  const oldConfig = { ...config, generatorVersion: 3, fingerprint: fingerprintWorld(generateWorld(config.worldSeed, 3)) };
  const world = { revision: 7, bridgeBuilt: true, harvested: [] };
  const oldRaw = JSON.stringify({ version: 1, config: oldConfig, world });
  writeFileSync(path, oldRaw);
  expect(() => new WorldStore(path, config).load()).toThrow("MIGRATE_WORLD_V3=1");
  expect(new WorldStore(path, config, true).load()).toEqual(world);
  expect(readFileSync(`${path}.v3.bak`, "utf8")).toBe(oldRaw);
  expect(JSON.parse(readFileSync(path, "utf8")).config).toEqual(config);
});

it("migracja wspólnego świata v4→v5 wymaga jawnej flagi, zachowuje stan i oryginalny plik", () => {
  const dir = mkdtempSync(join(tmpdir(), "miasto-world-"));
  paths.push(dir);
  const path = join(dir, "world.json");
  const config = createInstance().config;
  const oldConfig = { ...config, generatorVersion: 4, fingerprint: fingerprintWorld(generateWorld(config.worldSeed, 4)) };
  const world = { revision: 3, bridgeBuilt: false, harvested: [] };
  const oldRaw = JSON.stringify({ version: 1, config: oldConfig, world });
  writeFileSync(path, oldRaw);
  expect(() => new WorldStore(path, config).load()).toThrow("MIGRATE_WORLD_V4=1");
  expect(() => new WorldStore(path, config, true).load()).toThrow("MIGRATE_WORLD_V4=1");
  expect(new WorldStore(path, config, false, true).load()).toEqual(world);
  expect(readFileSync(`${path}.v4.bak`, "utf8")).toBe(oldRaw);
  expect(JSON.parse(readFileSync(path, "utf8")).config).toEqual(config);
  expect(new WorldStore(path, config).load()).toEqual(world);
});
