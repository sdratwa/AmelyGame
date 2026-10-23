import { forestObject, forestWalkOf } from "../world/lookup";
import { fingerprintWorld, generateWorld } from "../world/registry";
import type { SaveV5 } from "./schema";
import { verifyWorld } from "./loader";

/** Jawna migracja geometrii; magazyn SaveStore tworzy kopię starego zapisu podczas save(). */
export function migrateWorldV3ToV4(save: SaveV5): SaveV5 {
  if (save.world.genVersion !== 3 || !verifyWorld(save).ok) throw Error("Zapis świata v3 nie przeszedł walidacji.");
  const old = { seed: save.world.seed, genVersion: 3 };
  const next = { seed: save.world.seed, genVersion: 4 };
  for (const id of save.harvested) {
    const before = forestObject(old, id);
    const after = forestObject(next, id);
    if (!before || !after || before.kind !== after.kind || before.x !== after.x || before.z !== after.z)
      throw Error(`Obiekt ${id} zmienił położenie; migracja przerwana.`);
  }
  let pose = save.player.forestPose;
  if (pose && forestWalkOf(next).checkPoint(pose.x, pose.z)) {
    const safe = Array.from({ length: 10 }, (_, i) => i + 1).flatMap((r) =>
      [[r, 0], [-r, 0], [0, r], [0, -r]].map(([dx, dz]) => ({ x: pose!.x + dx, z: pose!.z + dz, yaw: pose!.yaw })));
    pose = safe.find((p) => !forestWalkOf(next).checkPoint(p.x, p.z)) ?? null;
    if (!pose) throw Error("Nie znaleziono bezpiecznej pozycji gracza w nowym świecie.");
  }
  const base = generateWorld(save.world.seed, 4);
  const migrated: SaveV5 = {
    ...save,
    world: { ...save.world, genVersion: 4, fingerprint: fingerprintWorld(base), genHistory: [...save.world.genHistory, { version: 4, atElapsed: save.time.elapsed }] },
    player: { ...save.player, forestPose: pose },
  };
  if (!verifyWorld(migrated).ok) throw Error("Nowy świat nie przeszedł walidacji.");
  return migrated;
}
