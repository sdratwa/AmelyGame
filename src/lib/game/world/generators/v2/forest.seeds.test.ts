import { describe, expect, it } from "vitest";
import { parseObjectId, sectorOf } from "../../bounds";
import type { WorldObject } from "../../objects";
import { buildForest, createForest, pickShowcaseSectors, type ForestWorld } from ".";

const seedAt = (i: number) => (Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
const circleR = (o: WorldObject) => (o.collider?.shape === "circle" ? o.collider.r : 0);

function checkSectors(forest: ForestWorld, sectors: readonly { ix: number; iz: number }[], label: string) {
  const region = forest.region;
  for (const { ix, iz } of sectors) {
    const sector = forest.sector(ix, iz);
    const ids = new Set<string>();
    for (const o of sector.objects) {
      expect(ids.has(o.id), `${label} ${o.id} duplikat`).toBe(false);
      ids.add(o.id);
      const parsed = parseObjectId(o.id);
      const s = sectorOf(region, o.x, o.z);
      expect(parsed && s && parsed.ix === s.ix && parsed.iz === s.iz && s.ix === ix && s.iz === iz, `${label} ${o.id} sektor`).toBe(true);
      expect(Number.isFinite(o.x + o.y + o.z), `${label} ${o.id} skończone`).toBe(true);
      expect(Math.abs(o.y - forest.terrain.height(o.x, o.z)), `${label} ${o.id} y`).toBeLessThan(1.1e-4);
      expect(forest.geometry.waterGap(o.x, o.z), `${label} ${o.id} woda`).toBeGreaterThanOrEqual(circleR(o) - 1e-9);
      if (o.kind === "tree" || o.kind === "rock") expect(o.collider, `${label} ${o.id} kolizja`).toBeDefined();
    }
    const colliders = sector.objects.filter((o) => o.collider?.shape === "circle");
    for (let i = 0; i < colliders.length; i++) {
      for (let j = i + 1; j < colliders.length; j++) {
        const a = colliders[i];
        const b = colliders[j];
        const rr = circleR(a) + circleR(b);
        expect((a.x - b.x) ** 2 + (a.z - b.z) ** 2, `${label} ${a.id} / ${b.id}`).toBeGreaterThanOrEqual(rr * rr - 1e-6);
      }
    }
  }
}

describe("W1a: stabilność dla setek seedów", () => {
  it("plan jest poprawny dla 300 seedów: rzeka 10-14 m na wschodzie, lądowiska po właściwych brzegach, ścieżki z dala od wody", () => {
    for (let i = 0; i < 300; i++) {
      const seed = seedAt(i);
      const forest = createForest(seed);
      const geo = forest.geometry;
      const label = `seed ${seed}`;
      const pts = geo.river.points;
      expect(pts[0].z, label).toBeLessThanOrEqual(-150);
      expect(pts[pts.length - 1].z, label).toBeGreaterThanOrEqual(150);
      for (let z = -150; z <= 150; z += 10) {
        const r = geo.riverAt(z);
        expect(r.w * 2, label).toBeGreaterThanOrEqual(10);
        expect(r.w * 2, label).toBeLessThanOrEqual(14);
        expect(r.x, label).toBeGreaterThan(90);
        expect(r.x, label).toBeLessThan(118);
      }
      const west = forest.features.poi("poi.bridge_landing_west")!;
      const east = forest.features.poi("poi.bridge_landing_east")!;
      expect(geo.riverAt(west.z).x, label).toBeGreaterThan(west.x);
      expect(geo.riverAt(east.z).x, label).toBeLessThan(east.x);
      expect(forest.features.poi("poi.start"), label).toBeDefined();
      for (const t of geo.trails) {
        for (const p of t.points) expect(geo.waterGap(p.x, p.z), `${label} ${t.id}`).toBeGreaterThan(2);
      }
      const hills = forest.plan.terrain.filter((r) => r.kind === "bump");
      expect(hills.length, label).toBeGreaterThanOrEqual(10);
      expect(forest.plan.terrain.filter((r) => r.kind === "river"), label).toHaveLength(1);
      expect(forest.plan.terrain.filter((r) => r.kind === "trail"), label).toHaveLength(4);
    }
  }, 120_000);

  it("trzy sektory na seed (róg, środek, brzeg rzeki) są poprawne dla 300 seedów", () => {
    for (let i = 0; i < 300; i++) {
      const seed = seedAt(i);
      const forest = createForest(seed);
      checkSectors(forest, [{ ix: 0, iz: 0 }, { ix: 4, iz: 5 }, { ix: 7, iz: 3 }], `seed ${seed}`);
    }
  }, 180_000);

  it("pełne generowanie wszystkich sektorów jest poprawne i spójne dla 60 seedów", () => {
    for (let i = 0; i < 60; i++) {
      const seed = seedAt(1000 + i);
      const forest = createForest(seed);
      const sectors = forest.allSectors();
      expect(sectors).toHaveLength(100);
      checkSectors(forest, sectors, `seed ${seed}`);
      const trees = sectors.reduce((n, s) => n + s.objects.filter((o) => o.kind === "tree").length, 0);
      expect(trees, `seed ${seed}`).toBeGreaterThan(1000);
      expect(trees, `seed ${seed}`).toBeLessThan(3200);
    }
  }, 240_000);

  it("pełna walidacja świata (rzeka, most, ścieżki, kolizje, zbocza) bez naruszeń dla 14 seedów", () => {
    for (let i = 0; i < 14; i++) {
      const seed = seedAt(2000 + i);
      const { world } = buildForest(seed);
      expect(world.report.violations, `seed ${seed}`).toEqual([]);
    }
  }, 240_000);

  it("dla każdego z 80 seedów istnieje sektor wzorcowy do prototypu V2", () => {
    for (let i = 0; i < 80; i++) {
      const seed = seedAt(3000 + i);
      const forest = createForest(seed);
      const best = pickShowcaseSectors(forest, 3);
      expect(best[0].qualifies, `seed ${seed}`).toBe(true);
    }
  }, 240_000);
});
