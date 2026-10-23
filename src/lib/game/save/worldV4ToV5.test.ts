import { expect, it } from "vitest";
import { initialState } from "../core/state";
import { startLoading } from "../systems/session";
import { serializeState } from "./serialize";
import { migrateWorldV3ToV4 } from "./worldV3ToV4";
import { migrateWorldToLatest, migrateWorldV4ToV5 } from "./worldV4ToV5";
import { verifyWorld } from "./loader";
import { fingerprintWorld, generateWorld } from "../world/registry";

const saveAt = (genVersion: number) => {
  const started = startLoading({ ...initialState, name: "Ala" }, 2030, "save-test").state;
  const old = { ...started, phase: "playing" as const, world: { ...started.world!, genVersion, fingerprint: fingerprintWorld(generateWorld(2030, genVersion)) } };
  return serializeState(old, 123)!;
};

it("stary zapis v4 pozostaje czytelny bez migracji (stare zasady skał)", () => {
  expect(verifyWorld(saveAt(4)).ok).toBe(true);
});

it("migracja v4→v5 zachowuje postęp i zmienia tylko wersję świata, odcisk i historię generatora", () => {
  const save = saveAt(4);
  const migrated = migrateWorldV4ToV5(save);
  expect(migrated.world.genVersion).toBe(5);
  expect(migrated.world.fingerprint).toBe(fingerprintWorld(generateWorld(2030, 5)));
  expect(migrated.world.genHistory.at(-1)).toMatchObject({ version: 5 });
  expect(migrated.player).toEqual(save.player);
  expect(migrated.quests).toEqual(save.quests);
  expect(migrated.harvested).toEqual(save.harvested);
  expect(save.world.genVersion).toBe(4);
});

it("migracja odrzuca zapis w złej wersji, a v3 przechodzi przez v4 do v5", () => {
  expect(() => migrateWorldV4ToV5(saveAt(5))).toThrow();
  expect(() => migrateWorldV4ToV5(saveAt(3))).toThrow();
  expect(migrateWorldToLatest(saveAt(3), migrateWorldV3ToV4).world.genVersion).toBe(5);
  expect(migrateWorldToLatest(saveAt(4), migrateWorldV3ToV4).world.genVersion).toBe(5);
});
