import { describe, expect, it } from "vitest";
import { FOREST_START_REGION } from "./bounds";
import {
  NORMAL_EPS,
  bumpModifier,
  createBaseTerrain,
  createTerrain,
  hasTerrainVersion,
  makeField,
  padModifier,
  withModifiers,
} from "./terrain";

const GRID: [number, number][] = [];
for (let x = -140; x <= 140; x += 28) for (let z = -140; z <= 140; z += 28) GRID.push([x + 0.37, z - 0.61]);

describe("teren: determinizm i zróżnicowanie", () => {
  it("ten sam seed i wersja dają identyczne wysokości, normalne i nachylenia", () => {
    const a = createTerrain(2030, 2);
    const b = createTerrain(2030, 2);
    for (const [x, z] of GRID) {
      expect(a.height(x, z)).toBe(b.height(x, z));
      expect(a.normal(x, z)).toEqual(b.normal(x, z));
      expect(a.slope(x, z)).toBe(b.slope(x, z));
    }
  });

  it("różne seedy dają różny teren", () => {
    const sigs = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) {
      const t = createTerrain(seed, 2);
      sigs.add(GRID.map(([x, z]) => t.height(x, z).toFixed(4)).join(","));
    }
    expect(sigs.size).toBe(25);
  });

  it("złote wartości terenu v2 (roboczego) dla seeda 2030", () => {
    const t = createTerrain(2030, 2);
    expect([0, 50, -73.5].map((x) => Number(t.height(x, x / 2 + 1).toFixed(4)))).toMatchInlineSnapshot(`
      [
        1.316,
        0.3333,
        -0.2724,
      ]
    `);
  });

  it("wersja 1 to płaski prototyp, nieznana wersja jest odrzucana", () => {
    const flat = createTerrain(123, 1);
    expect(flat.height(10, -20)).toBe(0);
    expect(flat.slope(10, -20)).toBe(0);
    expect(flat.normal(10, -20)).toEqual({ x: -0, y: 1, z: -0 });
    expect(hasTerrainVersion(1) && hasTerrainVersion(2)).toBe(true);
    expect(hasTerrainVersion(99)).toBe(false);
    expect(() => createTerrain(1, 99)).toThrow();
  });

  it("wysokość mieści się w amplitudzie i teren jest ciągły oraz łagodny", () => {
    const t = createTerrain(77, 2);
    let max = 0;
    let steepest = 0;
    for (let x = -150; x <= 150; x += 1.5) {
      for (let z = -150; z <= 150; z += 1.5) {
        const h = t.height(x, z);
        max = Math.max(max, Math.abs(h));
        expect(Math.abs(t.height(x + 0.01, z) - h)).toBeLessThan(0.02);
        steepest = Math.max(steepest, t.slope(x, z));
      }
    }
    expect(max).toBeLessThanOrEqual(2.4);
    expect(max).toBeGreaterThan(0.3);
    expect(steepest).toBeLessThan(15);
  });
});

describe("teren: spójność wysokości, normalnych i nachylenia", () => {
  it("normalna jest jednostkowa, skierowana w górę i prostopadła do stycznych", () => {
    const t = createTerrain(5, 2);
    for (const [x, z] of GRID) {
      const n = t.normal(x, z);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 12);
      expect(n.y).toBeGreaterThan(0);
      const e = NORMAL_EPS;
      const tx = { x: 2 * e, y: t.height(x + e, z) - t.height(x - e, z), z: 0 };
      const tz = { x: 0, y: t.height(x, z + e) - t.height(x, z - e), z: 2 * e };
      expect(n.x * tx.x + n.y * tx.y + n.z * tx.z).toBeCloseTo(0, 10);
      expect(n.x * tz.x + n.y * tz.y + n.z * tz.z).toBeCloseTo(0, 10);
    }
  });

  it("nachylenie równa się kątowi między normalną a pionem", () => {
    const t = createTerrain(5, 2);
    for (const [x, z] of GRID) {
      expect(t.slope(x, z)).toBeCloseTo((Math.acos(t.normal(x, z).y) * 180) / Math.PI, 9);
    }
  });

  it("płaszczyzna analityczna: znane normalne i nachylenie", () => {
    const plane = makeField((x) => 0.5 * x + 3);
    const n = plane.normal(10, 20);
    const len = Math.sqrt(1.25);
    expect(n.x).toBeCloseTo(-0.5 / len, 12);
    expect(n.y).toBeCloseTo(1 / len, 12);
    expect(n.z).toBeCloseTo(0, 12);
    expect(plane.slope(10, 20)).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 9);
    expect(plane.height(4, 0)).toBe(5);
  });
});

describe("teren: modyfikacje", () => {
  const base = createBaseTerrain(2030, 2);

  it("spłaszczenie: stała wysokość wewnątrz, gładkie wtopienie, brak wpływu poza zasięgiem", () => {
    const target = base.height(40, 30);
    const t = withModifiers(base, [padModifier({ id: "pad.a", x: 40, z: 30, radius: 6, blend: 8, height: target })]);
    for (const [dx, dz] of [[0, 0], [3, 3], [-5, 2], [6, 0]]) expect(t.height(40 + dx, 30 + dz)).toBeCloseTo(target, 12);
    expect(t.slope(40, 30)).toBeLessThan(0.01);
    expect(t.height(40 + 14, 30)).toBeCloseTo(base.height(54, 30), 12);
    expect(t.height(40 + 20, 30)).toBe(base.height(60, 30));
    let prev = t.height(46, 30);
    for (let r = 46; r <= 54; r += 0.05) {
      const h = t.height(r, 30);
      expect(Math.abs(h - prev)).toBeLessThan(0.05);
      prev = h;
    }
  });

  it("wzniesienie i zagłębienie zmieniają teren tylko lokalnie", () => {
    const t = withModifiers(base, [
      bumpModifier({ id: "hill", x: -60, z: 10, radius: 20, amplitude: 3 }),
      bumpModifier({ id: "gully", x: 60, z: 10, radius: 10, amplitude: -2 }),
    ]);
    expect(t.height(-60, 10)).toBeCloseTo(base.height(-60, 10) + 3, 12);
    expect(t.height(60, 10)).toBeCloseTo(base.height(60, 10) - 2, 12);
    expect(t.height(0, 100)).toBe(base.height(0, 100));
    expect(t.height(-40, 10)).toBe(base.height(-40, 10));
  });

  it("indeksowanie modyfikacji daje ten sam wynik co pełne przejście (także na granicach komórek)", () => {
    const mods = [];
    for (let i = 0; i < 60; i++) {
      const x = -140 + (i * 37) % 280;
      const z = -140 + (i * 91) % 280;
      mods.push(i % 2 ? padModifier({ id: `p${i}`, x, z, radius: 4, blend: 9, height: 1 }) : bumpModifier({ id: `b${i}`, x, z, radius: 18, amplitude: 1.5 }));
    }
    const t = withModifiers(base, mods);
    for (let x = -150; x <= 150; x += 3.7) {
      for (let z = -150; z <= 150; z += 4.1) {
        let h = base.height(x, z);
        for (const m of mods) h = m.apply(x, z, h);
        expect(t.height(x, z)).toBe(h);
      }
    }
  });

  it("createTerrain z modyfikacjami = baza + withModifiers; powtórzone ID jest błędem", () => {
    const mods = [bumpModifier({ id: "h", x: 0, z: 0, radius: 10, amplitude: 1 })];
    expect(createTerrain(2030, 2, { modifiers: mods }).height(0, 0)).toBe(withModifiers(base, mods).height(0, 0));
    expect(() => withModifiers(base, [...mods, ...mods])).toThrow();
  });

  it("modyfikacje nie zmieniają terenu bazowego", () => {
    const before = base.height(0, 0);
    withModifiers(base, [bumpModifier({ id: "h", x: 0, z: 0, radius: 10, amplitude: 5 })]);
    expect(base.height(0, 0)).toBe(before);
    expect(FOREST_START_REGION.sectorSize).toBe(30);
  });
});
