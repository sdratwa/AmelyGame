import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FOREST_START_REGION, objectId, sectorOf } from "./bounds";
import { FeatureMap, type EnvironmentZone, type PointOfInterest } from "./features";
import { makeObject, type WorldObject } from "./objects";
import { buildWorld, materializeTerrain, type WorldRecipe } from "./pipeline";
import { createBaseTerrain } from "./terrain";
import { fingerprintOf } from "./fingerprint";

const R = FOREST_START_REGION;

/** Przepis testowy: generyczny, bez docelowych lokacji lasu. */
function demoRecipe(overrides: Partial<WorldRecipe> = {}, treeCount = 2500): WorldRecipe {
  return {
    regions: [R],
    start: { x: -120, z: 0 },
    walk: {},
    plan({ rng, base }) {
      const r = rng("anchors");
      const terrain: WorldRecipe extends never ? never : import("./pipeline").TerrainRequest[] = [];
      const pois: PointOfInterest[] = [];
      for (let i = 0; i < 3; i++) {
        const x = -100 + r() * 160;
        const z = -100 + r() * 200;
        terrain.push({ kind: "pad", id: `pad.demo${i}`, x, z, radius: 4, blend: 6 });
        pois.push({ id: `poi.demo${i}`, kind: "demo", x, z, radius: 4, mustReach: true, tags: ["demo"], props: { base: base.height(x, z) } });
      }
      terrain.push({ kind: "bump", id: "bump.hill", x: -30, z: 40, radius: 25, amplitude: 1.5 });
      const zones: EnvironmentZone[] = [
        { id: "zone.demo_wide", kind: "grove", shape: { type: "circle", x: 0, z: 0, r: 60 }, tags: ["dense"], priority: 1 },
        { id: "zone.demo_core", kind: "clearing", shape: { type: "circle", x: 0, z: 0, r: 10 }, tags: ["open"], priority: 5 },
      ];
      return {
        terrain,
        pois,
        zones,
        barriers: [{ id: "barrier.river", kind: "river", shape: { type: "band", points: [{ x: 105, z: -150 }, { x: 105, z: 150 }], halfWidth: 6 } }],
        passages: [{ id: "passage.bridge", requiresFlag: "bridge.built", shape: { type: "rect", minX: 95, maxX: 115, minZ: -3, maxZ: 3 } }],
      };
    },
    place({ rng, terrain, features }) {
      const r = rng("trees");
      const counters = new Map<string, number>();
      const out: WorldObject[] = [];
      let guard = 0;
      while (out.length < treeCount && guard++ < treeCount * 5) {
        const x = -148 + r() * 296;
        const z = -148 + r() * 296;
        const dense = features.zonesAt(x, z).some((zone) => zone.tags?.includes("open"));
        if (dense) continue;
        if (Math.hypot(x + 120, z) < 5) continue;
        if (features.poisNear(x, z, 0).length > 0) continue;
        const s = sectorOf(R, x, z)!;
        const key = `${s.ix}_${s.iz}`;
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        out.push(makeObject({ id: objectId("tree", R, s.ix, s.iz, n), kind: "tree", x, z, y: terrain.height(x, z), collider: { shape: "circle", r: 0.35 } }));
      }
      return out;
    },
    ...overrides,
  };
}

describe("potok budowy świata (W0)", () => {
  it("ten sam seed i wersja dają identyczny wynik, także przy ponownym zbudowaniu", () => {
    const a = buildWorld(demoRecipe(), 2030, 2);
    const b = buildWorld(demoRecipe(), 2030, 2);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.objects).toEqual(b.objects);
    expect(a.plan).toEqual(b.plan);
    for (const [x, z] of [[0, 0], [-77, 33], [140, -140]]) expect(a.terrain.height(x, z)).toBe(b.terrain.height(x, z));
  });

  it("różne seedy i różne wersje terenu dają różne światy", () => {
    const prints = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) prints.add(buildWorld(demoRecipe({}, 300), seed, 2).fingerprint);
    expect(prints.size).toBe(8);
    expect(buildWorld(demoRecipe({}, 300), 5, 1).fingerprint).not.toBe(buildWorld(demoRecipe({}, 300), 5, 2).fingerprint);
  });

  it("wariant (variant+1) daje deterministycznie inny układ", () => {
    const v0 = buildWorld(demoRecipe({}, 300), 11, 2);
    const v1 = buildWorld(demoRecipe({}, 300), 11, 2, { variant: 1 });
    const v1b = buildWorld(demoRecipe({}, 300), 11, 2, { variant: 1 });
    expect(v1.fingerprint).toBe(v1b.fingerprint);
    expect(v1.fingerprint).not.toBe(v0.fingerprint);
  });

  it("brak cyklu: spłaszczenia wynikają z terenu bazowego, a obiekty stoją na terenie końcowym", () => {
    const w = buildWorld(demoRecipe(), 2030, 2);
    for (const r of w.plan.terrain.filter((t) => t.kind === "pad")) {
      expect(w.terrain.height(r.x, r.z)).toBeCloseTo(w.base.height(r.x, r.z), 12);
      expect(w.terrain.slope(r.x, r.z)).toBeLessThan(0.01);
    }
    expect(w.terrain.height(-30, 40)).toBeCloseTo(w.base.height(-30, 40) + 1.5, 12);
    for (const o of w.objects) expect(o.y).toBe(w.terrain.height(o.x, o.z));
    expect(w.terrain.modifiers.map((m) => m.kind)).toEqual(["bump", "pad", "pad", "pad"]);
  });

  it("kolejność żądań w planie nie zmienia terenu poza ustaloną kolejnością rodzajów", () => {
    const base = createBaseTerrain(9, 2);
    const reqs = [
      { kind: "pad", id: "pad.a", x: 0, z: 0, radius: 4, blend: 5 },
      { kind: "bump", id: "bump.a", x: 2, z: 0, radius: 20, amplitude: 2 },
    ] as const;
    const t1 = materializeTerrain(base, reqs);
    const t2 = materializeTerrain(base, [reqs[1], reqs[0]]);
    for (const [x, z] of [[0, 0], [3, 1], [8, 0], [15, 2]]) expect(t1.height(x, z)).toBe(t2.height(x, z));
  });

  it("dodanie strumienia RNG w planie nie przesuwa rozsiewu drzew (niezależne strumienie)", () => {
    const base = demoRecipe({}, 400);
    const noisy = demoRecipe({ plan: (ctx) => { ctx.rng("extra.stream")(); return base.plan(ctx); } }, 400);
    expect(buildWorld(noisy, 3, 2).objects).toEqual(buildWorld(base, 3, 2).objects);
  });

  it("walidacja: poprawny świat przechodzi, osiągalność liczona od startu", () => {
    const w = buildWorld(demoRecipe(), 2030, 2);
    expect(w.report).toEqual({ ok: true, violations: [] });
    expect(w.walk.index.size).toBe(w.objects.length);
  });

  it("walidacja: cel za rzeką bez mostu jest nieosiągalny", () => {
    const recipe = demoRecipe({
      plan: (ctx) => {
        const plan = demoRecipe().plan(ctx);
        return { ...plan, pois: [...(plan.pois ?? []), { id: "poi.across", kind: "demo", x: 130, z: 20, mustReach: true }] };
      },
    });
    const w = buildWorld(recipe, 2030, 2);
    expect(w.report.ok).toBe(false);
    expect(w.report.violations).toEqual([expect.objectContaining({ code: "unreachable", id: "poi.across" })]);
  });

  it("walidacja: zablokowany start, obiekt poza regionem i błędna prośba o teren", () => {
    const blockedStart = buildWorld(demoRecipe({ start: { x: -200, z: 0 } }, 50), 1, 2);
    expect(blockedStart.report.violations.map((v) => v.code)).toContain("start_blocked");
    const outside = buildWorld(
      demoRecipe({
        place: ({ terrain }) => [makeObject({ id: "tree.forest_start.0_0.1", kind: "tree", x: 400, z: 0, y: terrain.height(400, 0) })],
      }),
      1,
      2,
    );
    expect(outside.report.violations.map((v) => v.code)).toContain("out_of_bounds");
    const badReq = buildWorld(
      demoRecipe({ plan: () => ({ terrain: [{ kind: "pad", id: "pad.bad", x: 999, z: 0, radius: 3, blend: 2 }] }), place: () => [] }),
      1,
      2,
    );
    expect(badReq.report.violations.map((v) => v.code)).toContain("bad_terrain_request");
  });

  it("identyfikatory obiektów są stabilne i zgodne z sektorem obiektu", () => {
    const w = buildWorld(demoRecipe(), 2030, 2);
    const ids = new Set(w.objects.map((o) => o.id));
    expect(ids.size).toBe(w.objects.length);
    for (const o of w.objects) {
      const s = sectorOf(R, o.x, o.z)!;
      expect(o.id.startsWith(`tree.forest_start.${s.ix}_${s.iz}.`)).toBe(true);
    }
  });

  it("blokady ruchu w zbudowanym świecie: rzeka i most", () => {
    const w = buildWorld(demoRecipe({}, 100), 2030, 2);
    expect(w.walk.isWalkable(105, 50)).toBe(false);
    expect(w.walk.isWalkable(105, 0, new Set(["bridge.built"]))).toBe(true);
    expect(fingerprintOf(w.objects)).toBe(fingerprintOf(buildWorld(demoRecipe({}, 100), 2030, 2).objects));
  });
});

describe("punkty charakterystyczne i strefy jako dane", () => {
  const w = buildWorld(demoRecipe({}, 100), 2030, 2);

  it("strefy: zawieranie punktu, priorytety i tagi", () => {
    expect(w.features.zonesAt(0, 0).map((z) => z.id)).toEqual(["zone.demo_core", "zone.demo_wide"]);
    expect(w.features.zonesAt(50, 0).map((z) => z.id)).toEqual(["zone.demo_wide"]);
    expect(w.features.zonesAt(100, 100)).toEqual([]);
    expect(w.features.zonesWithTag("dense").map((z) => z.id)).toEqual(["zone.demo_wide"]);
  });

  it("punkty: wyszukiwanie w promieniu i po ID; duplikaty są błędem", () => {
    const poi = w.plan.pois![0];
    expect(w.features.poi(poi.id)).toBe(poi);
    expect(w.features.poisNear(poi.x, poi.z, 0.1).map((p) => p.id)).toContain(poi.id);
    expect(() => new FeatureMap([poi, poi])).toThrow();
    expect(() => new FeatureMap([], [w.plan.zones![0], w.plan.zones![0]])).toThrow();
  });

  it("nowe rodzaje punktów i stref nie wymagają zmian w generatorze (czyste dane)", () => {
    const extra = new FeatureMap(
      [{ id: "poi.cokolwiek", kind: "dowolny_rodzaj", x: 1, z: 2, props: { jasnosc: 0.5, nazwa: "x" } }],
      [{ id: "zone.cokolwiek", kind: "inny", shape: { type: "band", points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], halfWidth: 2 } }],
    );
    expect(extra.zonesAt(5, 1)).toHaveLength(1);
    expect(extra.poi("poi.cokolwiek")?.props?.jasnosc).toBe(0.5);
  });
});

describe("niezależność od renderera i modeli", () => {
  const dir = __dirname;
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("moduły świata nie importują React, Three.js, Next ani komponentów", () => {
    expect(sources.length).toBeGreaterThan(8);
    for (const file of sources) {
      const text = readFileSync(join(dir, file), "utf8");
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} importuje ${spec}`).not.toMatch(/^(react|three|next|@react-three|@\/components)|\/components\//);
      }
    }
  });

  it("kolizje i teren nie odwołują się do modeli GLB ani siatek", () => {
    for (const file of sources) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/\.glb|\.gltf|BufferGeometry|THREE\./);
    }
  });
});

describe("wydajność budowy świata", () => {
  it("5000 drzew, teren z modyfikacjami i BFS 300 x 300 m mieszczą się w budżecie", () => {
    const t0 = performance.now();
    const w = buildWorld(demoRecipe({}, 5000), 42, 2);
    const ms = performance.now() - t0;
    expect(w.objects.length).toBe(5000);
    expect(w.report.ok).toBe(true);
    expect(ms).toBeLessThan(8000);
  });
});
