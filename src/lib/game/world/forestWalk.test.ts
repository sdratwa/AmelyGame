import { describe, expect, it } from "vitest";
import { BRIDGE_FLAG, FOREST_START, forestEntryPose, safeForestPose } from "./generators/v2";
import { forestOf, forestWalkOf } from "./lookup";

const SEEDS = [1, 2030, 4000000000];
const OPEN = new Set([BRIDGE_FLAG]);

describe("F1: kolizje i rzeka w całym lesie (świat chodzenia niezależny od streamingu)", () => {
  it("indeks zawiera wszystkie collidery wszystkich sektorów i jest współdzielony", () => {
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      let colliders = 0;
      for (const s of forest.allSectors()) colliders += s.colliders.length;
      expect(colliders).toBeGreaterThan(500);
      const walk = forestWalkOf(seed);
      expect(forestWalkOf(seed)).toBe(walk);
      for (const s of forest.allSectors()) {
        for (const c of s.colliders.slice(0, 3)) {
          const blocked = walk.checkPoint(c.x, c.z);
          expect(blocked, c.id).not.toBeNull();
        }
      }
    }
  }, 60_000);

  it("rzeka nie ma przejścia bez mostu na całej długości, a po fladze mostu można przejść z brzegu na brzeg", () => {
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      const walk = forestWalkOf(seed);
      for (let z = -145; z <= 145; z += 5) {
        const r = forest.geometry.riverAt(z);
        const west = { x: r.x - r.w - 4, z };
        const east = { x: r.x + r.w + 4, z };
        const moved = walk.move(west, east);
        expect(moved.x, `seed=${seed} z=${z}`).toBeLessThan(r.x);
      }
      const west = forest.features.poi("poi.bridge_landing_west")!;
      const east = forest.features.poi("poi.bridge_landing_east")!;
      expect(walk.move(west, east).x).toBeLessThan(forest.geometry.riverAt(west.z).x);
      const crossed = walk.move(west, east, OPEN);
      expect(Math.hypot(crossed.x - east.x, crossed.z - east.z)).toBeLessThan(1);
      const back = walk.move(east, west, OPEN);
      expect(Math.hypot(back.x - west.x, back.z - west.z)).toBeLessThan(1);
    }
  }, 60_000);

  it("zapisana pozycja: wschodni brzeg jest poprawny tylko po zbudowaniu mostu", () => {
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      const east = forest.features.poi("poi.bridge_landing_east")!;
      const pose = { x: east.x + 1, z: east.z, yaw: 0.5 };
      expect(safeForestPose(seed, pose, false)).toEqual(forestEntryPose());
      const kept = safeForestPose(seed, pose, true);
      expect(kept.x).toBe(pose.x);
      expect(kept.z).toBe(pose.z);
      expect(safeForestPose(seed, { x: FOREST_START.x, z: FOREST_START.z, yaw: 1 }, false).yaw).toBe(1);
      expect(safeForestPose(seed, { x: 9999, z: 0, yaw: 0 }, true)).toEqual(forestEntryPose());
      expect(safeForestPose(seed, { x: Number.NaN, z: 0, yaw: 0 }, true)).toEqual(forestEntryPose());
      expect(safeForestPose(seed, null)).toEqual(forestEntryPose());
    }
  });
});
