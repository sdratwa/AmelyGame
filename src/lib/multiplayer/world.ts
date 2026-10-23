import { authoritativeForestOf, forestChestsOf } from "../game/world/lookup";
import { chestCollider } from "../game/world/chests";
import { WalkWorld } from "../game/world/walk";
import { generateWorld, fingerprintWorld } from "../game/world/registry";
import { fingerprintOf } from "../game/world/fingerprint";
import { CURRENT_GEN_VERSION } from "../game/world/registry";
import { idleMotion, type WorldConfig } from "./protocol";
export function createInstance(
  worldInstanceId = "world_001",
  worldSeed = 2030,
) {
  const ref = { seed: worldSeed, genVersion: CURRENT_GEN_VERSION };
  const forest = authoritativeForestOf(ref);
  const objects = forest.allSectors().flatMap((s) => s.colliders);
  const walk = new WalkWorld({
    regions: structuredClone([forest.region]),
    terrain: forest.terrain,
    objects: structuredClone([
      ...objects,
      ...forestChestsOf(ref).map(chestCollider),
    ]),
    barriers: structuredClone(forest.plan.barriers),
    passages: structuredClone(forest.plan.passages),
  });
  const base = generateWorld(worldSeed, CURRENT_GEN_VERSION);
  const config: WorldConfig = {
    worldId: "forest_start",
    worldInstanceId,
    worldSeed,
    generatorVersion: CURRENT_GEN_VERSION,
    fingerprint: fingerprintWorld(base),
  };
  // Connected component, every edge verified by actual movement; deterministic grid on the western bank.
  const nodes = new Map<string, { x: number; z: number }>();
  for (let x = -140; x <= 60; x += 2)
    for (let z = -140; z <= 140; z += 2)
      if (!walk.checkPoint(x, z)) nodes.set(`${x},${z}`, { x, z });
  const origin = [...nodes.values()].sort(
    (a, b) => Math.hypot(a.x + 100, a.z) - Math.hypot(b.x + 100, b.z),
  )[0];
  if (!origin) throw Error("Brak bezpiecznych startów");
  const seen = new Set<string>([`${origin.x},${origin.z}`]);
  const queue = origin ? [origin] : [];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dz] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ]) {
      const key = `${p.x + dx},${p.z + dz}`;
      const q = nodes.get(key);
      if (!q || seen.has(key)) continue;
      const moved = walk.move(p, q);
      if (Math.hypot(moved.x - q.x, moved.z - q.z) > 0.01) continue;
      seen.add(key);
      queue.push(q);
    }
  }
  const chosen = origin ? [origin] : [];
  for (let i = 1; i < 8; i++) {
    const target = {
      x: origin.x + (i % 2) * 60,
      z: origin.z + Math.floor(i / 2) * 12,
    };
    const next = queue
      .filter((p) => chosen.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 8))
      .sort(
        (a, b) =>
          Math.hypot(a.x - target.x, a.z - target.z) -
          Math.hypot(b.x - target.x, b.z - target.z),
      )[0];
    if (!next) throw Error("Brak bezpiecznych startów");
    chosen.push(next);
  }
  return {
    config,
    walk,
    spawns: chosen.map((p) =>
      idleMotion(p.x, forest.terrain.height(p.x, p.z), p.z),
    ),
    resultDigest: fingerprintOf({
      objects,
      plan: forest.plan,
      heights: chosen.map((p) => forest.terrain.height(p.x, p.z)),
    }),
  };
}
