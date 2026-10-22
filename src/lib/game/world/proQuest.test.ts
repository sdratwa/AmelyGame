import { describe, expect, it } from "vitest";
import { QUEST_BRIDGE_01 } from "../content/quests";
import { anchorsOf, autoComplete, harvestTargets, inForest, newPlaying } from "../testkit";
import type { GameState } from "../core/state";
import { distance2 } from "./anchors";
import { fingerprintWorld, generateWorld } from "./registry";
import { harvestOf } from "./harvest";
import { authoritativeForestOf, forestBridgeOf, forestChestsOf, forestOf, forestWalkOf } from "./lookup";
import { BRIDGE_FLAG, FOREST_START, forestEntryPose, isValidForestPosition, safeForestPose } from "./generators/v2";
import { BRIDGE_NEED, SUPPLY_FACTOR } from "./generators/v2/validate";
import { computeReachability, reachesNear } from "./walk";
import type { WorldRef } from "./types";

const SEEDS = [1, 2030, 777, 31337, 4000000000, 42];
const VERSIONS = [2, 3] as const;
const ref = (seed: number, genVersion: number): WorldRef => ({ seed, genVersion });

/** Stan gry na świecie wskazanej wersji generatora (v2 = zamrożone zapisy, v3 = nowe gry w lesie Pro). */
function playingOn(seed: number, genVersion: number): GameState {
  const s = newPlaying(seed);
  if (s.world!.genVersion === genVersion) return s;
  const base = generateWorld(seed, genVersion);
  return { ...s, world: { ...s.world!, genVersion, fingerprint: fingerprintWorld(base), anchors: base.forest?.anchors ?? null } };
}

describe("Quest 1 w lesie: ten sam przebieg na v2 i v3", () => {
  it("wszystkie kotwice (trzy skrzynie, troll) są osiągalne bez przedmiotów, a brzeg za rzeką dopiero po moście", () => {
    for (const genVersion of VERSIONS) {
      for (const seed of SEEDS) {
        const label = `v${genVersion} seed ${seed}`;
        const world = ref(seed, genVersion);
        const anchors = generateWorld(seed, genVersion).forest!.anchors;
        const walk = forestWalkOf(world);
        const reach = computeReachability(walk, FOREST_START, { cell: 2 });
        for (const [id, p] of Object.entries(anchors.chests)) expect(reachesNear(reach, p.x, p.z, 2.5), `${label} ${id}`).toBe(true);
        expect(reachesNear(reach, anchors.troll.x, anchors.troll.z, 2.5), `${label} troll`).toBe(true);
        expect(reachesNear(reach, anchors.beyond.x, anchors.beyond.z, anchors.beyond.radius), `${label} za rzeką bez mostu`).toBe(false);
        const open = computeReachability(walk, FOREST_START, { cell: 2, flags: { has: (f: string) => f === BRIDGE_FLAG } });
        expect(reachesNear(open, anchors.beyond.x, anchors.beyond.z, anchors.beyond.radius), `${label} za rzeką po moście`).toBe(true);
      }
    }
  }, 600_000);

  it("troll nie stoi w kolizji, skrzynie są na stronie gracza, a start jest poprawną pozycją", () => {
    for (const genVersion of VERSIONS) {
      for (const seed of SEEDS) {
        const label = `v${genVersion} seed ${seed}`;
        const world = ref(seed, genVersion);
        const forest = authoritativeForestOf(world);
        const anchors = anchorsOf(playingOn(seed, genVersion));
        expect(forest.collidersNear(anchors.troll.x, anchors.troll.z, 0.6), `${label} troll`).toEqual([]);
        for (const c of forestChestsOf(world)) {
          const river = forest.geometry.riverAt(c.z);
          expect(c.x, `${label} ${c.id}`).toBeLessThan(river.x - river.w);
          expect(distance2(c, anchors.start), label).toBeGreaterThan(5);
        }
        const entry = forestEntryPose();
        expect(isValidForestPosition(forest, entry.x, entry.z), `${label} start`).toBe(true);
        expect(safeForestPose(world, entry, false)).toEqual(entry);
      }
    }
  }, 600_000);

  it("zasoby na zachodnim brzegu starczą na most z zapasem (>= 3x), też w lesie Pro", () => {
    for (const genVersion of VERSIONS) {
      for (const seed of SEEDS) {
        const world = ref(seed, genVersion);
        const reach = computeReachability(forestWalkOf(world), FOREST_START, { cell: 2 });
        let wood = 0;
        let stone = 0;
        for (const o of authoritativeForestOf(world).allObjects()) {
          const h = harvestOf(o);
          if (!h || !reachesNear(reach, o.x, o.z, 2.5)) continue;
          if (h.kind === "tree") wood += h.amount;
          else stone += h.amount;
        }
        expect(wood, `v${genVersion} seed ${seed} drewno`).toBeGreaterThanOrEqual(SUPPLY_FACTOR * BRIDGE_NEED.wood);
        expect(stone, `v${genVersion} seed ${seed} kamień`).toBeGreaterThanOrEqual(SUPPLY_FACTOR * BRIDGE_NEED.stone);
      }
    }
  }, 600_000);

  it("lądowiska mostu są poza wydmami: teren v3 pokrywa się z v2 przy brzegach rzeki", () => {
    for (const seed of SEEDS) {
      const v2 = forestOf(ref(seed, 2));
      const v3 = forestOf(ref(seed, 3));
      const l2 = forestBridgeOf(ref(seed, 2));
      const l3 = forestBridgeOf(ref(seed, 3));
      for (const side of ["west", "east"] as const) {
        expect(l3[side].x).toBe(l2[side].x);
        expect(l3[side].z).toBe(l2[side].z);
        expect(Math.abs(v3.terrain.height(l3[side].x, l3[side].z) - v2.terrain.height(l2[side].x, l2[side].z)), `seed ${seed} ${side}`).toBeLessThan(0.15);
      }
    }
  }, 120_000);

  it("pozyskiwanie: w obu wersjach są drzewa i skały każdego rozmiaru potrzebnego w questcie (s/m/l)", () => {
    for (const genVersion of VERSIONS) {
      for (const seed of [2030, 777]) {
        const list = harvestTargets(ref(seed, genVersion));
        for (const kind of ["tree", "rock"] as const) {
          expect(list.filter((t) => t.kind === kind).length, `v${genVersion} seed ${seed} ${kind}`).toBeGreaterThanOrEqual(5);
        }
        expect(new Set(list.filter((t) => t.kind === "tree").map((t) => t.size)).size, `v${genVersion} drzewa`).toBeGreaterThanOrEqual(2);
      }
    }
  }, 120_000);

  it("autoComplete (solver bez softlocka) przechodzi cały quest na v2 i na v3", () => {
    for (const genVersion of VERSIONS) {
      for (const seed of [2030, 777]) {
        const done = autoComplete(inForest(playingOn(seed, genVersion)));
        expect(done.quests.completed[QUEST_BRIDGE_01], `v${genVersion} seed ${seed}`).toBeDefined();
        expect(done.world!.genVersion).toBe(genVersion);
      }
    }
  }, 600_000);
});
