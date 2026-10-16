import { describe, expect, it } from "vitest";
import { anchorsFromFeatures } from "./anchors";
import { chestCollider, CHEST_HALF_X, CHEST_HALF_Z } from "./chests";
import { FOREST_START } from "./generators/v2";
import { forestChestsOf, forestOf, forestWalkOf } from "./lookup";
import { computeReachability, reachesNear } from "./walk";

const SEEDS = [1, 2, 7, 42, 99, 2030, 4000000000, 123456, 777777, 31337];
const CIRCLE_R = Math.hypot(CHEST_HALF_X, CHEST_HALF_Z);

describe("M1/C1: skrzynie na kotwicach świata", () => {
  it("pozycje to dokładnie kotwice W1b i są deterministyczne (te same dla tego samego seeda, różne między seedami)", () => {
    const prints = new Set<string>();
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      const anchors = anchorsFromFeatures(forest.features, FOREST_START);
      const chests = forestChestsOf(seed);
      expect(chests.map((c) => c.id).sort()).toEqual(["chest.bridge.blueprint", "chest.bridge.pickaxe", "chest.bridge.saw"]);
      for (const c of chests) {
        const a = anchors.chests[c.id];
        expect(c.x).toBe(a.x);
        expect(c.z).toBe(a.z);
      }
      expect(forestChestsOf(seed)).toBe(chests);
      prints.add(chests.map((c) => `${c.x},${c.z}`).join("|"));
    }
    expect(prints.size).toBe(SEEDS.length);
  });

  it("skrzynia stoi na terenie: podstawa nie wisi nad ziemią i nie jest zagłębiona, spadki pod podstawą są łagodne", () => {
    let worst = 0;
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      for (const c of forestChestsOf(seed)) {
        const cos = Math.cos(c.yaw);
        const sin = Math.sin(c.yaw);
        const heights: number[] = [forest.terrain.height(c.x, c.z)];
        for (const [lx, lz] of [[CHEST_HALF_X, CHEST_HALF_Z], [-CHEST_HALF_X, CHEST_HALF_Z], [CHEST_HALF_X, -CHEST_HALF_Z], [-CHEST_HALF_X, -CHEST_HALF_Z]]) {
          heights.push(forest.terrain.height(c.x + lx * cos + lz * sin, c.z - lx * sin + lz * cos));
        }
        const lo = Math.min(...heights);
        const hi = Math.max(...heights);
        expect(c.y, `${seed} ${c.id}`).toBeCloseTo(lo, 9);
        worst = Math.max(worst, hi - lo);
      }
    }
    // Polany mają płaskie podłoże (pady terenu): różnica wysokości pod całą podstawą jest rzędu centymetrów.
    expect(worst).toBeLessThan(0.15);
  });

  it("nie koliduje z drzewami ani skałami, nie leży przy wodzie i nie blokuje przejścia (wszystkie punkty kluczowe pozostają osiągalne)", () => {
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      const walk = forestWalkOf(seed);
      const chests = forestChestsOf(seed);
      for (const c of chests) {
        for (const o of forest.collidersNear(c.x, c.z, 3)) {
          const r = o.collider?.shape === "circle" ? o.collider.r : o.radius;
          expect(Math.hypot(o.x - c.x, o.z - c.z), `${seed} ${c.id} vs ${o.id}`).toBeGreaterThan(r + CIRCLE_R + 0.8);
        }
        expect(forest.geometry.waterGap(c.x, c.z)).toBeGreaterThan(8);
        const own = chestCollider(c);
        expect(walk.objectBlocking(c.x, c.z, 0.01)?.id).toBe(own.id);
      }
      const reach = computeReachability(walk, FOREST_START, { cell: 1 });
      for (const c of chests) expect(reachesNear(reach, c.x, c.z, 1.6), `${seed} ${c.id}`).toBe(true);
      const west = forest.features.poi("poi.bridge_landing_west")!;
      expect(reachesNear(reach, west.x, west.z, 1.5)).toBe(true);
      // Okrąg 2 m wokół skrzyni da się obejść dookoła: skrzynia nie zamyka polany.
      for (const c of chests) {
        let free = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          if (walk.isWalkable(c.x + Math.cos(a) * 2, c.z + Math.sin(a) * 2)) free++;
        }
        expect(free, `${seed} ${c.id}`).toBeGreaterThanOrEqual(12);
      }
    }
  }, 120_000);

  it("kolizja skrzyni: gracz idący w skrzynię zatrzymuje się przed nią, z każdej strony", () => {
    const seed = 2030;
    const walk = forestWalkOf(seed);
    for (const c of forestChestsOf(seed)) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const from = { x: c.x + Math.cos(a) * 2.2, z: c.z + Math.sin(a) * 2.2 };
        if (!walk.isWalkable(from.x, from.z)) continue;
        const moved = walk.move(from, { x: c.x, z: c.z });
        expect(Math.hypot(moved.x - c.x, moved.z - c.z)).toBeGreaterThan(0.4);
      }
    }
  });
});
