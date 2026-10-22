import { describe, expect, it } from "vitest";
import { DEFAULT_HEAD_METRICS, type HeadMetrics } from "../head";
import { triangleCount } from "../meshData";
import { findItem } from "../registry";
import { HAIR_GENERATORS } from "./index";

const ids = ["hair.01", "hair.02"] as const;
const generatorOf = (id: string) => {
  const item = findItem(id, "hair")!;
  if (item.source.kind !== "procedural") throw new Error("oczekiwano generatora proceduralnego");
  return { item, build: HAIR_GENERATORS[item.source.generator] };
};

describe("fryzury proceduralne", () => {
  for (const id of ids) {
    const { item, build } = generatorOf(id);
    const head = DEFAULT_HEAD_METRICS;
    const data = build(head);
    const [cx, cy, cz] = head.center;
    const [rx, ry, rz] = head.radii;

    it(`${id}: siatka jest poprawna (liczby skończone, indeksy w zakresie, nie jest pusta)`, () => {
      expect(data.positions.length).toBeGreaterThan(0);
      expect(data.positions.length % 3).toBe(0);
      expect(data.normals.length).toBe(data.positions.length);
      expect(data.uvs.length / 2).toBe(data.positions.length / 3);
      for (const v of data.positions) expect(Number.isFinite(v)).toBe(true);
      for (const v of data.normals) expect(Number.isFinite(v)).toBe(true);
      const n = data.positions.length / 3;
      for (const i of data.indices) expect(i).toBeLessThan(n);
      expect(data.indices.length % 3).toBe(0);
    });

    it(`${id}: mieści się w budżecie trójkątów z rejestru`, () => {
      expect(triangleCount(data)).toBeGreaterThan(200);
      expect(triangleCount(data)).toBeLessThanOrEqual(item.triangleBudget);
    });

    it(`${id}: otacza czaszkę, nie odjeżdża od głowy i zostawia twarz odsłoniętą`, () => {
      let maxY = -Infinity;
      for (let i = 0; i < data.positions.length; i += 3) {
        const x = data.positions[i] - cx;
        const y = data.positions[i + 1] - cy;
        const z = data.positions[i + 2] - cz;
        maxY = Math.max(maxY, y);
        expect(Math.abs(x)).toBeLessThan(rx * 2.2);
        expect(Math.abs(z)).toBeLessThan(rz * 2.4);
        expect(y).toBeGreaterThan(-ry * 1.6);
        // Pas twarzy: środek przodu, od brody do tuż nad oczami; fryzura tu nie wchodzi.
        const faceBand = z > rz * 0.8 && Math.abs(x) < 0.04 && y > -0.1 && y < 0.02;
        expect(faceBand).toBe(false);
      }
      expect(maxY).toBeGreaterThan(ry * 0.95);
      expect(maxY).toBeLessThan(ry * 1.5);
    });

    it(`${id}: jest deterministyczna (ten sam wynik przy ponownym wywołaniu)`, () => {
      const again = build(head);
      expect(Array.from(again.positions)).toEqual(Array.from(data.positions));
      expect(Array.from(again.indices)).toEqual(Array.from(data.indices));
    });

    it(`${id}: skaluje się z zmierzoną głową (przesunięcie środka przesuwa fryzurę)`, () => {
      const moved: HeadMetrics = { center: [cx, cy + 0.1, cz], radii: head.radii };
      const m = build(moved);
      expect(m.positions[1] - data.positions[1]).toBeCloseTo(0.1, 4);
    });
  }

  it("obie fryzury są różne (inna liczba trójkątów albo inny kształt)", () => {
    const a = generatorOf("hair.01").build(DEFAULT_HEAD_METRICS);
    const b = generatorOf("hair.02").build(DEFAULT_HEAD_METRICS);
    expect(a.indices.length === b.indices.length && a.positions.every((v, i) => v === b.positions[i])).toBe(false);
  });
});
