import { describe, expect, it } from "vitest";
import { CURRENT_GEN_VERSION, fingerprintWorld, generateWorld, hasGenerator, type WorldRef } from "../..";
import { authoritativeForestOf, forestChestsOf, forestObject, forestOf, forestWalkOf, worldRefOf } from "../../lookup";
import type { WorldObject } from "../../objects";
import { PRO_OPTIONS, PRO_TUNING, createForest } from "../v2";
import { gameplayDigest, WORLD_GEN_V3 } from "./world";

const SEEDS = [1, 2030, 777, 4000000000];
const key = (o: WorldObject) => JSON.stringify(o);
const ref = (seed: number): WorldRef => ({ seed, genVersion: 3 });

describe("generator świata v3 (las Pro, warstwa autorytatywna)", () => {
  it("jest zarejestrowany; bieżącą wersją nowych gier jest v5 (fizyka skał), a v3 pozostaje zamrożony", () => {
    expect(WORLD_GEN_V3).toBe(3);
    expect(hasGenerator(3)).toBe(true);
    expect(CURRENT_GEN_VERSION).toBe(5);
  });

  it("jest deterministyczny i zwraca niezależne kopie", () => {
    for (const seed of SEEDS) {
      expect(generateWorld(seed, 3)).toEqual(generateWorld(seed, 3));
      expect(fingerprintWorld(generateWorld(seed, 3))).toBe(fingerprintWorld(generateWorld(seed, 3)));
    }
    const a = generateWorld(5, 3);
    a.forest!.anchors.start.x = 999;
    expect(generateWorld(5, 3).forest!.anchors.start.x).not.toBe(999);
  });

  it("ma te same domy i kotwice questa co v2 (ten sam plan), ale inny odcisk", () => {
    for (const seed of SEEDS) {
      const v2 = generateWorld(seed, 2);
      const v3 = generateWorld(seed, 3);
      expect(v3.houses).toEqual(v2.houses);
      expect(v3.forest!.anchors).toEqual(v2.forest!.anchors);
      expect(v3.genVersion).toBe(3);
      expect(v3.forest!.planDigest).not.toBe(v2.forest!.planDigest);
      expect(fingerprintWorld(v3)).not.toBe(fingerprintWorld(v2));
    }
  });

  it("odcisk v3 zależy od seeda, a nie od ustawień kosmetycznych (kolory, pęknięcia, trawa, kwiaty)", () => {
    const prints = new Set(SEEDS.map((s) => fingerprintWorld(generateWorld(s, 3))));
    expect(prints.size).toBe(SEEDS.length);
    const base = gameplayDigest();
    expect(gameplayDigest({ ...PRO_OPTIONS, tuning: { ...PRO_TUNING, flowerScale: 9, grass: { ...PRO_TUNING.grass, scale: 3 } } })).toBe(base);
    expect(gameplayDigest({ ...PRO_OPTIONS, tuning: { ...PRO_TUNING, rocks: { ...PRO_TUNING.rocks, mediumShare: 0.9 } } })).not.toBe(base);
    expect(gameplayDigest({ ...PRO_OPTIONS, tuning: { ...PRO_TUNING, dunes: { ...PRO_TUNING.dunes, amplitude: 3.1 } } })).not.toBe(base);
  });

  it("forestOf/authoritativeForestOf: liczba = v2, WorldRef v3 = las Pro; cache jest rozdzielony po wersji", () => {
    expect(worldRefOf(7)).toEqual({ seed: 7, genVersion: 2 });
    const v2 = forestOf(2030);
    const v3 = forestOf(ref(2030));
    expect(v3).not.toBe(v2);
    expect(forestOf(ref(2030))).toBe(v3);
    expect(forestOf({ seed: 2030, genVersion: 2 })).toBe(v2);
    expect(authoritativeForestOf(ref(2030))).not.toBe(v3);
    expect(v3.geometry.weightProfiles.map((p) => p.id)).toContain("pro_desert");
    expect(v2.geometry.weightProfiles.map((p) => p.id)).not.toContain("pro_desert");
  });

  it("warstwa autorytatywna (gameplay) to dokładnie drzewa i skały z pełnego lasu: te same ID, pozycje, kolizje", () => {
    const seed = 2030;
    const auth = authoritativeForestOf(ref(seed));
    const all = forestOf(ref(seed));
    const { nx, nz } = all.sectorGrid;
    expect(auth.sectorGrid).toEqual(all.sectorGrid);
    let compared = 0;
    for (let iz = 0; iz < nz; iz += 2) {
      for (let ix = 0; ix < nx; ix += 2) {
        const want = all.sector(ix, iz).objects.filter((o) => o.collider).map(key);
        const got = auth.sector(ix, iz).objects.map(key);
        expect(got).toEqual(want);
        expect(auth.sector(ix, iz).colliders.map(key)).toEqual(all.sector(ix, iz).colliders.map(key));
        compared += got.length;
      }
    }
    expect(compared).toBeGreaterThan(100);
  }, 180_000);

  it("teren (z wydmami) jest taki sam w obu warstwach, a kosmetyka nie zmienia obiektów gameplay", () => {
    const auth = createForest(2030, { pro: PRO_OPTIONS, layers: "gameplay" });
    const all = createForest(2030, { pro: PRO_OPTIONS });
    for (const [x, z] of [[-100, -50], [40, 60], [90, -90], [20, 20], [-60, 110]]) {
      expect(auth.terrain.height(x, z)).toBe(all.terrain.height(x, z));
    }
    expect(auth.plan).toEqual(all.plan);
  });

  it("ustawienia widoku (jakość, opcje kosmetyczne) nie wpływają na autorytatywną warstwę", () => {
    const a = createForest(777, { pro: PRO_OPTIONS, layers: "gameplay" });
    const b = createForest(777, {
      pro: { ...PRO_OPTIONS, tuning: { ...PRO_TUNING, flowerScale: 3, grass: { ...PRO_TUNING.grass, scale: 2, perCell: 4 } } },
      layers: "gameplay",
    });
    for (const [ix, iz] of [[0, 0], [3, 4], [7, 2], [5, 9]]) {
      expect(b.sector(ix, iz).objects.map(key)).toEqual(a.sector(ix, iz).objects.map(key));
    }
  });

  it("świat chodzenia v3 jest liczony z warstwy gameplay w rozsądnym czasie i zna skrzynie z kotwic", () => {
    const t0 = performance.now();
    const walk = forestWalkOf(ref(2030));
    const seconds = (performance.now() - t0) / 1000;
    expect(seconds).toBeLessThan(60);
    expect(walk).toBe(forestWalkOf(ref(2030)));
    const chests = forestChestsOf(ref(2030));
    expect(chests).toHaveLength(3);
    expect(chests.map((c) => [c.x, c.z])).toEqual(forestChestsOf({ seed: 2030, genVersion: 2 }).map((c) => [c.x, c.z]));
  }, 120_000);

  it("forestObject znajduje drzewa i skały po ID w świecie v3 (ten sam ID w obu warstwach)", () => {
    const auth = authoritativeForestOf(ref(2030));
    const sample = auth.sector(4, 4).objects.slice(0, 5);
    expect(sample.length).toBeGreaterThan(0);
    for (const o of sample) expect(forestObject(ref(2030), o.id)).toEqual(o);
    const all = forestOf(ref(2030));
    for (const o of sample) expect(all.sector(4, 4).objects.find((x) => x.id === o.id)).toEqual(o);
  }, 120_000);
});
