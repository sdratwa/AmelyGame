import { expect, it } from "vitest";
import { initialState } from "../core/state";
import { startLoading } from "../systems/session";
import { serializeState } from "./serialize";
import { migrateWorldV3ToV4 } from "./worldV3ToV4";
import { fingerprintWorld, generateWorld } from "../world/registry";

it("migracja v3→v4 zachowuje postęp i zmienia tylko wersję świata oraz odcisk", () => {
  const started = startLoading({ ...initialState, name: "Ala" }, 2030, "save-test").state;
  const old = { ...started, phase: "playing" as const, world: { ...started.world!, genVersion: 3, fingerprint: fingerprintWorld(generateWorld(2030, 3)) } };
  const save = serializeState(old, 123)!;
  const migrated = migrateWorldV3ToV4(save);
  expect(migrated.world.genVersion).toBe(4);
  expect(migrated.world.fingerprint).toBe(fingerprintWorld(generateWorld(2030, 4)));
  expect(migrated.player).toEqual(save.player);
  expect(migrated.quests).toEqual(save.quests);
  expect(migrated.harvested).toEqual(save.harvested);
  expect(save.world.genVersion).toBe(3);
});
