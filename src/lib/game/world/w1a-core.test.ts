import { describe, expect, it } from "vitest";
import { FOREST_START_REGION } from "./bounds";
import { makeObject } from "./objects";
import { buildWorld, materializeTerrain, prepareWorld, type TerrainRequest, type WorldRecipe } from "./pipeline";
import { SegmentIndex } from "./polyline";
import { ribbonGap, shapeBounds, shapeContains, shapeIntersectsCircle, type Shape } from "./shape";
import { createBaseTerrain, riverModifier, trailModifier, withModifiers } from "./terrain";
import { WalkWorld } from "./walk";

const R = FOREST_START_REGION;

const ribbon: Shape = {
  type: "ribbon",
  points: [
    { x: 100, z: -170, w: 5 },
    { x: 104, z: 0, w: 7 },
    { x: 100, z: 170, w: 5 },
  ],
};

describe("wstęga o zmiennej szerokości (shape ribbon)", () => {
  it("zawiera punkty w obrębie lokalnej półszerokości i interpoluje szerokość", () => {
    expect(shapeContains(ribbon, 100, -100)).toBe(true);
    expect(shapeContains(ribbon, 104, 0)).toBe(true);
    expect(shapeContains(ribbon, 110.9, 0)).toBe(true);
    expect(shapeContains(ribbon, 111.5, 0)).toBe(false);
    expect(shapeContains(ribbon, 90, -150)).toBe(false);
  });

  it("przecięcie z kołem uwzględnia promień", () => {
    expect(shapeIntersectsCircle(ribbon, 111.5, 0, 0.8)).toBe(true);
    expect(shapeIntersectsCircle(ribbon, 112.5, 0, 0.8)).toBe(false);
  });

  it("obwiednia obejmuje całą wstęgę z największą szerokością", () => {
    const b = shapeBounds(ribbon);
    expect(b.minX).toBeCloseTo(93, 6);
    expect(b.maxX).toBeCloseTo(111, 6);
    expect(b.minZ).toBe(-177);
    expect(b.maxZ).toBe(177);
  });

  it("ribbonGap jest ujemny wewnątrz i równy odległości od brzegu na zewnątrz", () => {
    expect(ribbonGap(ribbon as Extract<Shape, { type: "ribbon" }>, 104, 0)).toBeCloseTo(-7, 6);
    expect(ribbonGap(ribbon as Extract<Shape, { type: "ribbon" }>, 114, 0)).toBeCloseTo(3, 6);
  });

  it("bariera-wstęga zatrzymuje ruch gracza, a przejście z flagą go przepuszcza", () => {
    const walk = new WalkWorld({
      regions: [R],
      terrain: createBaseTerrain(1, 1),
      barriers: [{ id: "barrier.river", kind: "river", shape: ribbon }],
      passages: [
        { id: "passage.bridge", requiresFlag: "bridge.built", opens: ["barrier.river"], shape: { type: "band", points: [{ x: 90, z: 0 }, { x: 120, z: 0 }], halfWidth: 2 } },
      ],
    });
    const blocked = walk.move({ x: 90, z: -100 }, { x: 120, z: -100 });
    expect(blocked.x).toBeLessThan(100);
    expect(blocked.blocked[0]?.reason).toBe("barrier");
    const closed = walk.move({ x: 90, z: 0 }, { x: 120, z: 0 });
    expect(closed.x).toBeLessThan(100);
    const open = walk.move({ x: 90, z: 0 }, { x: 120, z: 0 }, new Set(["bridge.built"]));
    expect(open.x).toBeCloseTo(120, 3);
  });
});

describe("indeks segmentów łamanych", () => {
  it("zwraca ten sam wynik co przeszukanie pełne", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ x: i * 7 + Math.sin(i) * 5, z: Math.cos(i * 0.7) * 30, w: 2 + (i % 3) }));
    const idx = new SegmentIndex(20, 16);
    idx.addPolyline(pts);
    const brute = (x: number, z: number) => {
      let best = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
        const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
        best = Math.min(best, d - (a.w + (b.w - a.w) * t));
      }
      return best;
    };
    for (let k = 0; k < 400; k++) {
      const x = -20 + ((k * 37) % 260);
      const z = -60 + ((k * 53) % 120);
      const hit = idx.nearest(x, z);
      const expected = brute(x, z);
      if (expected <= 20) expect(hit?.gap).toBeCloseTo(expected, 9);
      else expect(hit).toBeNull();
    }
  });

  it("długość łuku rośnie wzdłuż łamanej", () => {
    const idx = new SegmentIndex(5, 8);
    idx.addPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]);
    expect(idx.nearest(5, 1)?.s).toBeCloseTo(5, 9);
    expect(idx.nearest(11, 5)?.s).toBeCloseTo(15, 9);
  });
});

describe("modyfikatory terenu: rzeka i ścieżka", () => {
  const base = createBaseTerrain(7, 2);
  const river = riverModifier({
    id: "river.t",
    points: [{ x: 100, z: -60, w: 6 }, { x: 100, z: 60, w: 6 }],
    waterY: [0, 0],
    depth: 1,
    bankWidth: 4,
    bankRise: 0.8,
    blend: 20,
  });

  it("koryto jest wklęsłe, brzeg wznosi się łagodnie, a daleko teren pozostaje naturalny", () => {
    const t = withModifiers(base, [river]);
    expect(t.height(100, 0)).toBeCloseTo(-1, 9);
    expect(t.height(106, 0)).toBeCloseTo(0, 9);
    expect(t.height(110, 0)).toBeCloseTo(0.8, 9);
    expect(t.height(140, 0)).toBe(base.height(140, 0));
    expect(t.height(100, 150)).toBe(base.height(100, 150));
  });

  it("profil jest ciągły i bez stromych uskoków", () => {
    const t = withModifiers(base, [river]);
    let max = 0;
    for (let x = 80; x <= 140; x += 0.1) max = Math.max(max, Math.abs(t.height(x + 0.1, 0) - t.height(x, 0)) / 0.1);
    expect(max).toBeLessThan(0.7);
  });

  it("ścieżka ma stałą wysokość w pasie i wtapia się w otoczenie", () => {
    const trail = trailModifier({ id: "trail.t", points: [{ x: -50, z: 0 }, { x: 50, z: 0 }], y: [1, 1], halfWidth: 1.2, blend: 4 });
    const t = withModifiers(base, [trail]);
    expect(t.height(0, 0)).toBe(1);
    expect(t.height(0, 1.1)).toBe(1);
    expect(t.height(0, 30)).toBe(base.height(0, 30));
    const edge = t.height(0, 1.2 + 4);
    expect(edge).toBeCloseTo(base.height(0, 5.2), 9);
  });
});

describe("materializeTerrain: kolejność i odwołania do terenu", () => {
  const base = createBaseTerrain(21, 2);
  const requests: TerrainRequest[] = [
    { kind: "pad", id: "pad.a", x: 50, z: 50, radius: 3, blend: 5, reference: "shaped" },
    { kind: "bump", id: "bump.a", x: 50, z: 50, radius: 30, amplitude: 2 },
    { kind: "trail", id: "trail.a", points: [{ x: -40, z: 0 }, { x: 0, z: 0 }, { x: 40, z: 10 }], halfWidth: 1, blend: 3, smoothWindow: 8 },
  ];

  it("pad z referencją shaped bierze wysokość po wzniesieniach, nawet gdy jest pierwszy w planie", () => {
    const t = materializeTerrain(base, requests);
    const expected = withModifiers(base, [
      { id: "b", kind: "bump", bounds: { minX: 20, minZ: 20, maxX: 80, maxZ: 80 }, apply: (x, z, h) => h + 2 * 0.5 * (1 + Math.cos((Math.PI * Math.hypot(x - 50, z - 50)) / 30)) },
    ]).height(50, 50);
    expect(t.height(50, 50)).toBeCloseTo(expected, 9);
    expect(t.modifiers.map((m) => m.kind)).toEqual(["bump", "trail", "pad"]);
  });

  it("wynik nie zależy od kolejności wejścia w obrębie różnych rodzajów", () => {
    const a = materializeTerrain(base, requests);
    const b = materializeTerrain(base, [...requests].reverse());
    for (const [x, z] of [[0, 0], [50, 50], [30, 5], [-20, 0]]) expect(a.height(x, z)).toBe(b.height(x, z));
  });

  it("odgałęzienie przypięte do ścieżki zaczyna na jej powierzchni", () => {
    const t = materializeTerrain(base, [
      { kind: "trail", id: "trail.main", points: [{ x: -60, z: 0 }, { x: 60, z: 0 }], halfWidth: 1.3, blend: 3.5, smoothWindow: 10 },
      { kind: "trail", id: "trail.side", points: [{ x: 0, z: 0 }, { x: 0, z: 60 }], halfWidth: 1, blend: 3.5, smoothWindow: 8, anchorStart: true, anchorLength: 12 },
    ]);
    expect(t.height(0, 0.5)).toBeCloseTo(t.height(0.5, 0), 1);
    let max = 0;
    for (let z = -2; z < 20; z += 0.25) max = Math.max(max, Math.abs(t.height(0, z + 0.25) - t.height(0, z)) / 0.25);
    expect(max).toBeLessThan(0.3);
  });
});

describe("potok: prepareWorld, walidacja przepisu, indeks kolizji", () => {
  const recipe = (extra: Partial<WorldRecipe> = {}): WorldRecipe => ({
    regions: [R],
    start: { x: -100, z: 0 },
    plan: () => ({ terrain: [{ kind: "bump", id: "bump.x", x: 0, z: 0, radius: 20, amplitude: 1 }] }),
    place: ({ terrain }) => [
      makeObject({ id: "tree.forest_start.0_0.1", kind: "tree", x: -100, z: 50, y: terrain.height(-100, 50), collider: { shape: "circle", r: 0.3 } }),
      makeObject({ id: "grass.forest_start.0_0.1", kind: "grass", x: -90, z: 50, y: terrain.height(-90, 50), radius: 0.2 }),
    ],
    ...extra,
  });

  it("prepareWorld daje ten sam teren i plan co buildWorld", () => {
    const prepared = prepareWorld(recipe(), 5, 2);
    const built = buildWorld(recipe(), 5, 2);
    expect(prepared.plan).toEqual(built.plan);
    expect(prepared.terrain.height(3, 4)).toBe(built.terrain.height(3, 4));
  });

  it("walidacja przepisu dopisuje własne naruszenia do raportu", () => {
    const ok = buildWorld(recipe(), 5, 2);
    expect(ok.report.ok).toBe(true);
    const bad = buildWorld(recipe({ validate: () => [{ code: "moja_regula", id: "x", message: "test" }] }), 5, 2);
    expect(bad.report.ok).toBe(false);
    expect(bad.report.violations.map((v) => v.code)).toContain("moja_regula");
    expect(bad.fingerprint).toBe(ok.fingerprint);
  });

  it("indeks chodzenia trzyma tylko obiekty z kolizją, ale świat zwraca wszystkie", () => {
    const w = buildWorld(recipe(), 5, 2);
    expect(w.objects).toHaveLength(2);
    expect(w.walk.index.size).toBe(1);
  });
});
