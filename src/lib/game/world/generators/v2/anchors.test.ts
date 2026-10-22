import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateWorld, fingerprintWorld, anchorsFromFeatures, distance2, harvestOf } from "../..";
import { CURRENT_GEN_VERSION } from "../../registry";
import { computeReachability, reachesNear } from "../../walk";
import { BRIDGE_NEED, MIN_ANCHOR_FROM_START, MIN_CHEST_SPACING, SUPPLY_FACTOR } from "./validate";
import { buildForest, createForest, FOREST_START } from ".";

const seedAt = (i: number) => (Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
const report = process.env.W1B_REPORT === "1";

describe("W1b: generator świata v2 (zapisywalny)", () => {
  it("jest zarejestrowany, deterministyczny i ma stabilny odcisk dla znanych seedów", () => {
    // v2 jest zamrożony i nadal zapisywalny; nowe gry używają v3 (patrz generators/v3/world.test.ts).
    expect(CURRENT_GEN_VERSION).toBeGreaterThanOrEqual(2);
    for (const seed of [1, 2030, 777, 4000000000]) {
      expect(generateWorld(seed, 2)).toEqual(generateWorld(seed, 2));
      expect(fingerprintWorld(generateWorld(seed, 2))).toBe(fingerprintWorld(generateWorld(seed, 2)));
    }
    expect(fingerprintWorld(generateWorld(1, 2))).toBe("fp1:006ce794502340");
    expect(fingerprintWorld(generateWorld(2030, 2))).toBe("fp1:1eb6e9ff488396");
    expect(fingerprintWorld(generateWorld(777, 2))).toBe("fp1:1d9c51b07b48df");
  });

  it("zwraca niezależne kopie (zmiana wyniku nie psuje kolejnych odczytów)", () => {
    const a = generateWorld(5, 2);
    a.houses[0].owned = true;
    a.forest!.anchors.start.x = 999;
    const b = generateWorld(5, 2);
    expect(b.houses[0].owned).toBe(false);
    expect(b.forest!.anchors.start.x).toBe(FOREST_START.x);
  });

  it("odcisk zależy od kotwic: ten sam seed i wersja = te same pozycje, inny seed = inne", () => {
    const a = generateWorld(11, 2).forest!;
    const b = generateWorld(12, 2).forest!;
    expect(a.anchors).not.toEqual(b.anchors);
    expect(a.planDigest).not.toBe(b.planDigest);
    expect(generateWorld(11, 1).forest).toBeUndefined();
  });
});

describe("W1b: kotwice questa w planie (300 seedów)", () => {
  it("trzy skrzynie na różnych polanach, troll przy skrzyni ze schematem, odstępy i strona rzeki", () => {
    for (let i = 0; i < 300; i++) {
      const seed = seedAt(i);
      const forest = createForest(seed);
      const label = `seed ${seed}`;
      const anchors = anchorsFromFeatures(forest.features, FOREST_START);
      const ids = Object.keys(anchors.chests).sort();
      expect(ids, label).toEqual(["chest.bridge.blueprint", "chest.bridge.pickaxe", "chest.bridge.saw"]);
      const clearings = ids.map((id) => forest.features.pois.find((p) => p.kind === "chest" && p.props?.chestId === id)!.props!.clearing);
      expect(new Set(clearings).size, label).toBe(3);
      const pts = Object.entries(anchors.chests);
      for (let a = 0; a < pts.length; a++) {
        expect(distance2(pts[a][1], anchors.start), `${label} start`).toBeGreaterThanOrEqual(MIN_ANCHOR_FROM_START);
        for (let b = a + 1; b < pts.length; b++) expect(distance2(pts[a][1], pts[b][1]), label).toBeGreaterThanOrEqual(MIN_CHEST_SPACING);
        const river = forest.geometry.riverAt(pts[a][1].z);
        expect(pts[a][1].x, label).toBeLessThan(river.x - river.w - 3);
        expect(forest.geometry.waterGap(pts[a][1].x, pts[a][1].z), label).toBeGreaterThan(3);
      }
      expect(anchors.troll.guards, label).toBe("chest.bridge.blueprint");
      const d = distance2(anchors.troll, anchors.chests["chest.bridge.blueprint"]);
      expect(d, label).toBeGreaterThan(2.5);
      expect(d, label).toBeLessThan(4);
      expect(distance2(anchors.troll, anchors.start), label).toBeGreaterThanOrEqual(MIN_ANCHOR_FROM_START);
      expect(anchors.beyond.x, label).toBeGreaterThan(anchors.bridge.east.x);
      expect(anchors.bridge.west.x, label).toBeLessThan(anchors.bridge.east.x);
    }
  }, 120_000);

  it("pozycje losuje się raz z seeda: kolejność skrzyń różni się między seedami", () => {
    const orders = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const a = generateWorld(seedAt(i), 2).forest!.anchors;
      orders.add(
        Object.entries(a.chests)
          .sort((x, y) => (x[1].x < y[1].x ? -1 : 1))
          .map(([id]) => id)
          .join(">"),
      );
    }
    expect(orders.size).toBeGreaterThanOrEqual(4);
  });
});

describe("W1b: oś mostu jest wolna od przeszkód", () => {
  it("seed, w którym skała blokowała gotowy most (wykryty przy walidacji 200 seedów), jest teraz poprawny", () => {
    const { world } = buildForest(547482912);
    expect(world.report.violations).toEqual([]);
    const w = world.features.poi("poi.bridge_landing_west")!;
    const e = world.features.poi("poi.bridge_landing_east")!;
    const open = world.walk.move(w, e, new Set(["bridge.built"]));
    expect(Math.abs(open.x - e.x)).toBeLessThan(1);
    expect(world.features.pois.filter((p) => p.id.startsWith("poi.bridge_axis_")).length).toBeGreaterThanOrEqual(7);
  });
});

describe("W1b: pełna walidacja świata (200 seedów)", () => {
  it("bez naruszeń: osiągalność kotwic bez przedmiotów, zapas surowców >= 3x, rzeka bez obejścia", () => {
    const stats = { wood: [] as number[], stone: [] as number[], reachMs: [] as number[] };
    for (let i = 0; i < 200; i++) {
      const seed = seedAt(7000 + i);
      const { world, forest } = buildForest(seed);
      expect(world.report.violations, `seed ${seed}`).toEqual([]);
      const anchors = anchorsFromFeatures(world.features, FOREST_START);
      const reach = computeReachability(world.walk, FOREST_START, { cell: 2 });
      for (const p of [...Object.values(anchors.chests), anchors.troll]) {
        expect(reachesNear(reach, p.x, p.z, 2.5), `seed ${seed} osiągalność`).toBe(true);
      }
      expect(reachesNear(reach, anchors.beyond.x, anchors.beyond.z, anchors.beyond.radius), `seed ${seed} za rzeką`).toBe(false);
      let wood = 0;
      let stone = 0;
      for (const o of forest.allObjects()) {
        const h = harvestOf(o);
        if (!h || !reachesNear(reach, o.x, o.z, 2.5)) continue;
        if (h.kind === "tree") wood += h.amount;
        else stone += h.amount;
      }
      expect(wood, `seed ${seed} drewno`).toBeGreaterThanOrEqual(SUPPLY_FACTOR * BRIDGE_NEED.wood);
      expect(stone, `seed ${seed} kamień`).toBeGreaterThanOrEqual(SUPPLY_FACTOR * BRIDGE_NEED.stone);
      stats.wood.push(wood);
      stats.stone.push(stone);
    }
    const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
    const summary = {
      seeds: 200,
      wood: { min: sorted(stats.wood)[0], median: sorted(stats.wood)[100], max: sorted(stats.wood)[199] },
      stone: { min: sorted(stats.stone)[0], median: sorted(stats.stone)[100], max: sorted(stats.stone)[199] },
    };
    if (report) console.info(`W1b zapas surowców: ${JSON.stringify(summary)}`);
    if (process.env.W1B_REPORT_FILE) writeFileSync(process.env.W1B_REPORT_FILE, JSON.stringify(summary));
  }, 600_000);
});
