import { describe, expect, it } from "vitest";
import { rngStream } from "../core/rng";
import { SpatialIndex, type Indexed } from "./spatialIndex";

const obj = (id: string, x: number, z: number, radius = 0): Indexed => ({ id, x, z, radius });

function randomObjects(n: number, seed = 1): Indexed[] {
  const rnd = rngStream(seed, "idx");
  return Array.from({ length: n }, (_, i) => obj(`o.${i}`, (rnd() - 0.5) * 300, (rnd() - 0.5) * 300, rnd() < 0.2 ? 0.5 + rnd() * 6 : 0.3));
}

const bruteRadius = (items: Indexed[], x: number, z: number, r: number) =>
  items
    .filter((o) => (o.x - x) ** 2 + (o.z - z) ** 2 <= (o.radius + r) ** 2)
    .map((o) => o.id)
    .sort();

function bruteArea(items: Indexed[], a: { minX: number; minZ: number; maxX: number; maxZ: number }) {
  return items
    .filter((o) => {
      const cx = Math.max(a.minX, Math.min(a.maxX, o.x));
      const cz = Math.max(a.minZ, Math.min(a.maxZ, o.z));
      return (o.x - cx) ** 2 + (o.z - cz) ** 2 <= o.radius ** 2;
    })
    .map((o) => o.id)
    .sort();
}

describe("indeks przestrzenny", () => {
  it("dodawanie, pobieranie i usuwanie", () => {
    const idx = new SpatialIndex<Indexed>(30);
    idx.add(obj("a", 0, 0));
    idx.add(obj("b", 10, 10, 2));
    expect(idx.size).toBe(2);
    expect(idx.has("a") && idx.get("b")?.radius === 2).toBe(true);
    expect(() => idx.add(obj("a", 5, 5))).toThrow();
    expect(idx.remove("a")).toBe(true);
    expect(idx.remove("a")).toBe(false);
    expect(idx.queryRadius(0, 0, 5)).toEqual([]);
    expect(idx.size).toBe(1);
    expect(idx.stats().cells).toBeGreaterThan(0);
    idx.remove("b");
    expect(idx.stats().cells).toBe(0);
  });

  it("odrzuca niepoprawną geometrię i zapytania", () => {
    const idx = new SpatialIndex<Indexed>();
    expect(() => idx.add(obj("x", NaN, 0))).toThrow();
    expect(() => idx.add(obj("y", 0, 0, -1))).toThrow();
    expect(() => idx.queryRadius(0, 0, Infinity)).toThrow();
    expect(() => new SpatialIndex(0)).toThrow();
  });

  it("obiekt na granicy sektorów jest widoczny z każdej strony i bez duplikatów", () => {
    const idx = new SpatialIndex<Indexed>(30);
    idx.add(obj("rock", 30, 30, 3));
    expect(idx.cellsOf("rock")).toHaveLength(4);
    for (const [x, z] of [[27.5, 27.5], [32.5, 27.5], [27.5, 32.5], [32.5, 32.5]]) {
      expect(idx.queryRadius(x, z, 1).map((o) => o.id)).toEqual(["rock"]);
    }
    expect(idx.queryRadius(30, 30, 100)).toHaveLength(1);
    expect(idx.queryArea({ minX: 20, minZ: 20, maxX: 40, maxZ: 40 })).toHaveLength(1);
  });

  it("obiekt z promieniem sięga poza swój środek: trafia, gdy okręgi się stykają", () => {
    const idx = new SpatialIndex<Indexed>(30);
    idx.add(obj("t", 0, 0, 2));
    expect(idx.queryRadius(5, 0, 3.01)).toHaveLength(1);
    expect(idx.queryRadius(5, 0, 2.99)).toHaveLength(0);
  });

  it("wyniki zapytań zgadzają się z przeszukaniem pełnym (promień i obszar)", () => {
    const items = randomObjects(3000);
    const idx = new SpatialIndex<Indexed>(30);
    items.forEach((o) => idx.add(o));
    const rnd = rngStream(9, "q");
    for (let i = 0; i < 150; i++) {
      const x = (rnd() - 0.5) * 340;
      const z = (rnd() - 0.5) * 340;
      const r = rnd() * 40;
      expect(idx.queryRadius(x, z, r).map((o) => o.id).sort()).toEqual(bruteRadius(items, x, z, r));
      const area = { minX: x, minZ: z, maxX: x + rnd() * 60, maxZ: z + rnd() * 60 };
      expect(idx.queryArea(area).map((o) => o.id)).toEqual(bruteArea(items, area));
    }
  });

  it("kolejność wyników jest deterministyczna (odległość/ID)", () => {
    const idx = new SpatialIndex<Indexed>(30);
    idx.add(obj("c", 3, 0));
    idx.add(obj("a", 3, 0));
    idx.add(obj("b", 1, 0));
    expect(idx.queryRadius(0, 0, 10).map((o) => o.id)).toEqual(["b", "a", "c"]);
    expect(idx.queryArea({ minX: -1, minZ: -1, maxX: 10, maxZ: 1 }).map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("filtr, przenoszenie i usuwanie zachowują spójność", () => {
    const items = randomObjects(500, 4);
    const idx = new SpatialIndex<Indexed>(30);
    items.forEach((o) => idx.add(o));
    for (let i = 0; i < 500; i += 2) idx.remove(`o.${i}`);
    const remaining = items.filter((_, i) => i % 2 === 1);
    expect(idx.size).toBe(250);
    expect(idx.queryRadius(0, 0, 400).map((o) => o.id).sort()).toEqual(bruteRadius(remaining, 0, 0, 400));
    idx.move(obj("o.1", 140, 140, 1));
    expect(idx.queryRadius(140, 140, 0.5).map((o) => o.id)).toContain("o.1");
    expect(() => idx.move(obj("brak", 0, 0))).toThrow();
    expect(idx.queryRadius(0, 0, 400, { filter: (o) => o.id === "o.3" }).map((o) => o.id)).toEqual(["o.3"]);
  });

  it("obsługuje ujemne i odległe współrzędne", () => {
    const idx = new SpatialIndex<Indexed>(30);
    idx.add(obj("far", -9000, 12000, 2));
    expect(idx.queryRadius(-9001, 12000, 2).map((o) => o.id)).toEqual(["far"]);
  });
});

describe("wydajność indeksu przestrzennego", () => {
  it("20 000 obiektów: zapytania badają tylko ułamek obiektów i mieszczą się w budżecie", () => {
    const n = 20_000;
    const rnd = rngStream(3, "perf");
    const items: Indexed[] = Array.from({ length: n }, (_, i) =>
      obj(`tree.${i}`, (rnd() - 0.5) * 300, (rnd() - 0.5) * 300, 0.4 + rnd() * 0.6),
    );
    const idx = new SpatialIndex<Indexed>(30);

    const t0 = performance.now();
    items.forEach((o) => idx.add(o));
    const addMs = performance.now() - t0;

    let examinedTotal = 0;
    let found = 0;
    const queries = 5000;
    const t1 = performance.now();
    for (let i = 0; i < queries; i++) {
      const res = idx.queryRadius((rnd() - 0.5) * 300, (rnd() - 0.5) * 300, 12);
      found += res.length;
      examinedTotal += idx.lastExamined;
    }
    const queryMs = performance.now() - t1;

    const t2 = performance.now();
    for (let i = 0; i < n; i += 2) idx.remove(`tree.${i}`);
    const removeMs = performance.now() - t2;

    expect(found).toBeGreaterThan(0);
    expect(examinedTotal / queries).toBeLessThan(n * 0.1);
    expect(addMs).toBeLessThan(2000);
    expect(queryMs).toBeLessThan(2000);
    expect(removeMs).toBeLessThan(2000);
    expect(idx.size).toBe(n / 2);
  });
});
