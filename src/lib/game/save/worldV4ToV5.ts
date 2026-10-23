import { forestObject, forestWalkOf } from "../world/lookup";
import { fingerprintWorld, generateWorld } from "../world/registry";
import type { SaveV5 } from "./schema";
import { verifyWorld } from "./loader";

/**
 * Jawna migracja świata v4 -> v5 (fizyka skał v1). Generator v5 nie zmienia pozycji, ID, kolizji kołowych ani losowań:
 * dodaje skałom profil pionowy (`WorldObject.rock`). Zapis v4 pozostaje czytelny bez migracji i ma stare zasady (skała =
 * nieskończona ściana); migracja przenosi go do świata, w którym skały można przeskakiwać i na nich stawać.
 * Magazyn zapisu tworzy kopię starego zapisu podczas `save()`. Nie zmienia postępu (ekwipunek, questy, zebrane obiekty).
 */
export function migrateWorldV4ToV5(save: SaveV5): SaveV5 {
  if (save.world.genVersion !== 4 || !verifyWorld(save).ok) throw Error("Zapis świata v4 nie przeszedł walidacji.");
  const old = { seed: save.world.seed, genVersion: 4 };
  const next = { seed: save.world.seed, genVersion: 5 };
  for (const id of save.harvested) {
    const before = forestObject(old, id);
    const after = forestObject(next, id);
    if (!before || !after || before.kind !== after.kind || before.x !== after.x || before.z !== after.z)
      throw Error(`Obiekt ${id} zmienił położenie; migracja przerwana.`);
  }
  const pose = save.player.forestPose;
  if (pose && forestWalkOf(next).checkPoint(pose.x, pose.z)) throw Error("Pozycja gracza koliduje w nowym świecie; migracja przerwana.");
  const migrated: SaveV5 = {
    ...save,
    world: { ...save.world, genVersion: 5, fingerprint: fingerprintWorld(generateWorld(save.world.seed, 5)), genHistory: [...save.world.genHistory, { version: 5, atElapsed: save.time.elapsed }] },
  };
  if (!verifyWorld(migrated).ok) throw Error("Nowy świat nie przeszedł walidacji.");
  return migrated;
}

/** Podnosi zapis ze świata v3 lub v4 do v5 (v3 przechodzi najpierw przez v4). */
export function migrateWorldToLatest(save: SaveV5, migrateV3ToV4: (s: SaveV5) => SaveV5): SaveV5 {
  const v4 = save.world.genVersion === 3 ? migrateV3ToV4(save) : save;
  return migrateWorldV4ToV5(v4);
}
