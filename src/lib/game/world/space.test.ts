import { describe, expect, it } from "vitest";
import {
  FOREST_START_REGION,
  boundsContain,
  defineRegion,
  objectId,
  parseObjectId,
  parseSectorId,
  regionAt,
  sectorBounds,
  sectorCount,
  sectorId,
  sectorOf,
  sectorsOverlapping,
  type RegionDef,
} from "./bounds";
import { shapeBounds, shapeContains, shapeIntersectsCircle } from "./shape";

const R = FOREST_START_REGION;

describe("region i sektory", () => {
  it("początkowy las: 300 x 300 m, sektory 30 m, siatka 10 x 10", () => {
    expect(R.bounds).toEqual({ minX: -150, minZ: -150, maxX: 150, maxZ: 150 });
    expect(sectorCount(R)).toEqual({ nx: 10, nz: 10 });
  });

  it("granice sektorów są domknięte od dołu, krawędź maksymalna należy do ostatniego sektora", () => {
    expect(sectorOf(R, -150, -150)).toMatchObject({ ix: 0, iz: 0 });
    expect(sectorOf(R, -120.0001, 0)?.ix).toBe(0);
    expect(sectorOf(R, -120, 0)?.ix).toBe(1);
    expect(sectorOf(R, 149.999, 0)?.ix).toBe(9);
    expect(sectorOf(R, 150, 150)).toMatchObject({ ix: 9, iz: 9 });
    expect(sectorOf(R, 150.001, 0)).toBeNull();
    expect(sectorOf(R, 0, -150.001)).toBeNull();
  });

  it("każdy punkt regionu należy do dokładnie jednego sektora, którego granice go zawierają", () => {
    for (let x = -150; x <= 150; x += 7.3) {
      for (let z = -150; z <= 150; z += 11.1) {
        const s = sectorOf(R, x, z);
        expect(s).not.toBeNull();
        const b = sectorBounds(R, s!.ix, s!.iz);
        expect(boundsContain(b, x, z)).toBe(true);
      }
    }
  });

  it("identyfikatory sektorów i obiektów są stabilne i odwracalne", () => {
    expect(sectorId(R, 3, 4)).toBe("sector.forest_start.3_4");
    expect(parseSectorId("sector.forest_start.3_4")).toEqual({ regionKey: "forest_start", ix: 3, iz: 4 });
    expect(parseSectorId("sector.3_4")).toBeNull();
    const id = objectId("tree", R, 3, 4, 17);
    expect(id).toBe("tree.forest_start.3_4.17");
    expect(parseObjectId(id)).toEqual({ kind: "tree", regionKey: "forest_start", ix: 3, iz: 4, n: 17 });
    expect(parseObjectId("tree.17")).toBeNull();
    expect(() => objectId("Tree!", R, 0, 0, 0)).toThrow();
  });

  it("obsługuje regiony o innym rozmiarze i niepodzielnych granicach", () => {
    const odd: RegionDef = defineRegion({
      id: "region.beyond_bridge",
      bounds: { minX: 150, minZ: -40, maxX: 275, maxZ: 40 },
      sectorSize: 50,
      unlockedBy: "bridge.built",
    });
    expect(sectorCount(odd)).toEqual({ nx: 3, nz: 2 });
    expect(sectorBounds(odd, 2, 1)).toEqual({ minX: 250, minZ: 10, maxX: 275, maxZ: 40 });
    expect(sectorOf(odd, 275, 40)).toMatchObject({ ix: 2, iz: 1 });
    expect(sectorId(odd, 1, 0)).toBe("sector.beyond_bridge.1_0");
  });

  it("walidacja regionu odrzuca niepoprawne dane", () => {
    expect(() => defineRegion({ ...R, sectorSize: 0 })).toThrow();
    expect(() => defineRegion({ ...R, bounds: { minX: 5, maxX: 1, minZ: 0, maxZ: 1 } })).toThrow();
    expect(() => defineRegion({ ...R, id: "region.a.b" })).toThrow();
  });

  it("regionAt uwzględnia odblokowanie regionu flagą", () => {
    const beyond = defineRegion({
      id: "region.beyond_bridge",
      bounds: { minX: 150, minZ: -40, maxX: 250, maxZ: 40 },
      sectorSize: 50,
      unlockedBy: "bridge.built",
    });
    const regions = [R, beyond];
    expect(regionAt(regions, 200, 0, new Set())).toBeNull();
    expect(regionAt(regions, 200, 0, new Set(["bridge.built"]))?.id).toBe(beyond.id);
    expect(regionAt(regions, 0, 0, new Set())?.id).toBe(R.id);
  });
});

describe("obiekty przecinające kilka sektorów", () => {
  const touching = (cx: number, cz: number, r: number) =>
    sectorsOverlapping(R, { minX: cx - r, minZ: cz - r, maxX: cx + r, maxZ: cz + r }).map((s) => `${s.ix}_${s.iz}`);

  it("obiekt wewnątrz sektora należy do jednego sektora", () => {
    expect(touching(-135, -135, 2)).toEqual(["0_0"]);
  });
  it("obiekt na granicy dwóch sektorów należy do obu", () => {
    expect(touching(-120, -135, 2).sort()).toEqual(["0_0", "1_0"]);
  });
  it("obiekt na rogu czterech sektorów należy do czterech", () => {
    expect(touching(-120, -120, 2).sort()).toEqual(["0_0", "0_1", "1_0", "1_1"]);
  });
  it("zwykły dotyk linii podziału nie dodaje sąsiada", () => {
    expect(touching(-135, -135, 15)).toEqual(["0_0"]);
  });
  it("przycina do regionu, a obiekt poza regionem nie ma sektorów", () => {
    expect(touching(150, 0, 5).every((s) => s.startsWith("9_"))).toBe(true);
    expect(touching(400, 0, 5)).toEqual([]);
  });
});

describe("kształty", () => {
  it("okrąg, prostokąt i pas (rzeka)", () => {
    expect(shapeContains({ type: "circle", x: 0, z: 0, r: 2 }, 1.9, 0)).toBe(true);
    expect(shapeContains({ type: "circle", x: 0, z: 0, r: 2 }, 2.1, 0)).toBe(false);
    expect(shapeContains({ type: "rect", minX: 0, minZ: 0, maxX: 2, maxZ: 2 }, 2, 2)).toBe(true);
    const river = { type: "band", points: [{ x: 100, z: -150 }, { x: 110, z: 0 }, { x: 100, z: 150 }], halfWidth: 6 } as const;
    expect(shapeContains(river, 108, 0)).toBe(true);
    expect(shapeContains(river, 90, 0)).toBe(false);
    expect(shapeIntersectsCircle(river, 90, 0, 6)).toBe(false);
    expect(shapeIntersectsCircle(river, 103, 0, 3)).toBe(true);
    expect(shapeBounds(river)).toEqual({ minX: 94, minZ: -156, maxX: 116, maxZ: 156 });
  });
});
