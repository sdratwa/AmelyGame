import { describe, expect, it } from "vitest";
import { FOREST_START_REGION } from "@/lib/game/world/bounds";
import { VIEW_PROFILES } from "./profiles";
import {
  INITIAL_RING,
  STREAM_RADIUS,
  TILE_PAD,
  padUvs,
  planStream,
  sectorCoordAt,
  sectorKey,
  sectorsAround,
  tileTextureBounds,
  type SectorGrid,
} from "./stream";

const region = FOREST_START_REGION;
const grid: SectorGrid = { nx: 10, nz: 10 };
const at = (ix: number, iz: number) => ({
  x: region.bounds.minX + (ix + 0.5) * region.sectorSize,
  z: region.bounds.minZ + (iz + 0.5) * region.sectorSize,
});

describe("F1: planowanie streamingu sektorów", () => {
  it("sektor punktu jest przycinany do siatki lasu 10 x 10 (30 m)", () => {
    expect(sectorCoordAt(region, grid, -149.9, -149.9)).toEqual({ ix: 0, iz: 0 });
    expect(sectorCoordAt(region, grid, 149.9, 149.9)).toEqual({ ix: 9, iz: 9 });
    expect(sectorCoordAt(region, grid, -500, 900)).toEqual({ ix: 0, iz: 9 });
    expect(sectorCoordAt(region, grid, -120, -120)).toEqual({ ix: 1, iz: 1 });
    expect(sectorCoordAt(region, grid, -120.0001, 0)).toEqual({ ix: 0, iz: 5 });
  });

  it("okno ma (2r+1)^2 sektorów w środku lasu i jest przycinane na brzegu", () => {
    for (const r of [1, 2, 3, 4]) {
      expect(sectorsAround(grid, { ix: 4, iz: 5 }, r)).toHaveLength((2 * r + 1) ** 2);
    }
    const corner = sectorsAround(grid, { ix: 0, iz: 0 }, 3);
    expect(corner).toHaveLength(16);
    expect(corner.every((c) => c.ix >= 0 && c.iz >= 0 && c.ix <= 3 && c.iz <= 3)).toBe(true);
  });

  it("promień okna pokrywa zasięg mgły każdej jakości, a MEDIUM jest domyślną jakością", () => {
    for (const q of ["LOW", "MEDIUM", "HIGH"] as const) {
      const guaranteed = STREAM_RADIUS[q] * region.sectorSize;
      expect(guaranteed).toBeGreaterThanOrEqual(VIEW_PROFILES[q].fogVisibility * 0.9);
    }
    expect(STREAM_RADIUS.LOW).toBeLessThan(STREAM_RADIUS.MEDIUM);
    expect(STREAM_RADIUS.MEDIUM).toBeLessThan(STREAM_RADIUS.HIGH);
    expect(INITIAL_RING).toBeLessThanOrEqual(STREAM_RADIUS.LOW);
  });

  it("ładuje najpierw sektor gracza i najbliższe, deterministycznie", () => {
    const p = at(4, 5);
    const a = planStream(region, grid, p.x, p.z, 3, new Set());
    const b = planStream(region, grid, p.x, p.z, 3, new Set());
    expect(a).toEqual(b);
    expect(a.center).toEqual({ ix: 4, iz: 5 });
    expect(a.load).toHaveLength(49);
    expect(sectorKey(a.load[0])).toBe("4_5");
    const d = (c: { ix: number; iz: number }) => Math.hypot(c.ix - 4, c.iz - 5);
    for (let i = 1; i < a.load.length; i++) expect(d(a.load[i])).toBeGreaterThanOrEqual(d(a.load[i - 1]) - 1e-9);
    expect(a.evict).toEqual([]);
  });

  it("nie ładuje drugi raz załadowanych sektorów i zwalnia dopiero poza promieniem + 1", () => {
    const first = planStream(region, grid, at(4, 4).x, at(4, 4).z, 2, new Set());
    const loaded = new Set(first.load.map(sectorKey));
    const same = planStream(region, grid, at(4, 4).x, at(4, 4).z, 2, loaded);
    expect(same.load).toEqual([]);
    expect(same.evict).toEqual([]);

    const step = planStream(region, grid, at(5, 4).x, at(5, 4).z, 2, loaded);
    expect(step.load.map(sectorKey).sort()).toEqual(["7_2", "7_3", "7_4", "7_5", "7_6"]);
    expect(step.evict).toEqual([]);

    const far = planStream(region, grid, at(6, 4).x, at(6, 4).z, 2, loaded);
    expect(far.evict.sort()).toEqual(["2_2", "2_3", "2_4", "2_5", "2_6"]);
  });

  it("ruch tam i z powrotem na granicy sektorów nie powoduje ładowania ani zwalniania w kółko", () => {
    const loaded = new Set(planStream(region, grid, at(4, 4).x, at(4, 4).z, 3, new Set()).load.map(sectorKey));
    const border = region.bounds.minX + 5 * region.sectorSize;
    let churn = 0;
    for (let i = 0; i < 40; i++) {
      const x = border + (i % 2 === 0 ? -0.2 : 0.2);
      const plan = planStream(region, grid, x, at(4, 4).z, 3, loaded);
      for (const c of plan.load) loaded.add(sectorKey(c));
      for (const k of plan.evict) loaded.delete(k);
      if (i >= 4) churn += plan.load.length + plan.evict.length;
    }
    expect(churn).toBe(0);
    expect(loaded.size).toBeLessThanOrEqual(8 * 7);
  });

  it("spacer przez cały las: zestaw załadowanych sektorów jest ograniczony i zawsze zawiera sąsiedztwo gracza", () => {
    const r = 3;
    const loaded = new Set<string>();
    let peak = 0;
    for (let x = region.bounds.minX + 1; x < region.bounds.maxX - 1; x += 2) {
      const z = 0;
      const plan = planStream(region, grid, x, z, r, loaded);
      for (const c of plan.load) loaded.add(sectorKey(c));
      for (const k of plan.evict) loaded.delete(k);
      peak = Math.max(peak, loaded.size);
      const here = sectorCoordAt(region, grid, x, z);
      for (const c of sectorsAround(grid, here, r)) expect(loaded.has(sectorKey(c))).toBe(true);
    }
    expect(peak).toBeLessThanOrEqual((2 * (r + 1) + 1) * (2 * r + 1 + 1));
  });

  it("tekstura płytki ma zapas na krawędziach, a UV wskazują wnętrze tekstury", () => {
    const b = { minX: 0, minZ: 30, maxX: 30, maxZ: 60 };
    expect(tileTextureBounds(b)).toEqual({ minX: -TILE_PAD, minZ: 30 - TILE_PAD, maxX: 30 + TILE_PAD, maxZ: 60 + TILE_PAD });
    const uvs = new Float32Array([0, 0, 1, 1, 0.5, 0.5]);
    padUvs(uvs, 30, TILE_PAD);
    expect(uvs[0]).toBeCloseTo(1 / 32, 6);
    expect(uvs[2]).toBeCloseTo(31 / 32, 6);
    expect(uvs[4]).toBeCloseTo(0.5, 6);
  });
});
