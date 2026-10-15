import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseObjectId, sectorOf } from "../../bounds";
import { computeReachability, reachesNear } from "../../walk";
import { ribbonGap } from "../../shape";
import type { WorldObject } from "../../objects";
import {
  BRIDGE_FLAG,
  BRIDGE_PASSAGE_ID,
  DEFAULT_PROFILES,
  FOREST_START,
  RIVER_BARRIER_ID,
  buildForest,
  createForest,
  type ForestWorld,
  type ProfileTable,
} from ".";

const built = new Map<number, ReturnType<typeof buildForest>>();
function full(seed: number) {
  let b = built.get(seed);
  if (!b) {
    b = buildForest(seed);
    built.set(seed, b);
  }
  return b;
}

const deg = (tan: number) => (Math.atan(tan) * 180) / Math.PI;
const circleR = (o: WorldObject) => (o.collider?.shape === "circle" ? o.collider.r : 0);
const key = (o: WorldObject) => JSON.stringify(o);

function withDensity(layer: keyof ProfileTable["mixed_forest"]["density"], factor: number): ProfileTable {
  const out = {} as Record<string, ProfileTable["mixed_forest"]>;
  for (const [id, p] of Object.entries(DEFAULT_PROFILES)) out[id] = { ...p, density: { ...p.density, [layer]: p.density[layer] * factor } };
  return out as ProfileTable;
}

describe("W1a: determinizm i nazwane strumienie", () => {
  it("ten sam seed, wersja i wariant dają identyczny świat; seed i wariant go zmieniają", () => {
    const a = buildForest(2030);
    const b = buildForest(2030);
    expect(a.world.fingerprint).toBe(b.world.fingerprint);
    expect(a.world.objects.map(key)).toEqual(b.world.objects.map(key));
    expect(a.world.plan).toEqual(b.world.plan);
    const variant = buildForest(2030, { variant: 1 });
    expect(variant.world.fingerprint).not.toBe(a.world.fingerprint);
    const prints = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) prints.add(createForest(seed).allSectors().map((s) => s.objects.length).join(","));
    expect(prints.size).toBe(10);
  });

  it("odcisk świata jest zamrożony dla znanych seedów (zmiana = nowa wersja generatora)", () => {
    expect(full(1).world.fingerprint).toBe("fp1:16fb736fc90465");
    expect(full(2030).world.fingerprint).toBe("fp1:0cb8232069bf5a");
    expect(full(4000000000).world.fingerprint).toBe("fp1:1735c3b9e1edac");
  });

  it("zmiana liczby jednej warstwy nie przesuwa drzew, skał ani pozostałych warstw", () => {
    const base = createForest(77).allObjects();
    for (const [layer, kinds] of [
      ["flower", ["flower"]],
      ["grass", ["grass"]],
      ["fern", ["fern"]],
    ] as const) {
      const changed = createForest(77, { profiles: withDensity(layer, 0.2) }).allObjects();
      const keep = (o: WorldObject) => !kinds.includes(o.kind as never);
      expect(changed.filter(keep).map(key)).toEqual(base.filter(keep).map(key));
      expect(changed.filter((o) => !keep(o)).length).toBeLessThan(base.filter((o) => !keep(o)).length);
    }
    const noRocks = createForest(77, { profiles: withDensity("rock", 0) }).allObjects();
    const trees = (list: WorldObject[]) => list.filter((o) => o.kind === "tree").map(key);
    expect(noRocks.filter((o) => o.kind === "rock")).toHaveLength(0);
    expect(trees(noRocks)).toEqual(trees(base));
  });

  it("plan świata nie zależy od profili roślinności", () => {
    expect(createForest(5, { profiles: withDensity("tree", 0.5) }).plan).toEqual(createForest(5).plan);
  });

  it("generator v2 nie używa funkcji, których wynik może się różnić między silnikami JS", () => {
    const dir = __dirname;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/Math\.(sin|cos|tan|atan2?|exp|pow|log\d*|hypot|random)\(/);
      expect(text, file).not.toMatch(/from\s+["'](react|three|next|@react-three|@\/components)/);
      expect(text, file).not.toMatch(/\.glb|\.gltf|BufferGeometry|THREE\./);
    }
  });
});

describe("W1a: sektory", () => {
  it("las ma 100 sektorów 30 x 30 m, a każdy obiekt należy do dokładnie jednego sektora zgodnie z ID", () => {
    const { world, forest } = full(1);
    expect(forest.sectorTotal).toBe(100);
    const ids = new Set<string>();
    let sum = 0;
    for (const s of forest.allSectors()) {
      sum += s.objects.length;
      for (const o of s.objects) {
        expect(ids.has(o.id)).toBe(false);
        ids.add(o.id);
        const at = sectorOf(forest.region, o.x, o.z)!;
        expect([at.ix, at.iz]).toEqual([s.ix, s.iz]);
        const parsed = parseObjectId(o.id)!;
        expect([parsed.ix, parsed.iz]).toEqual([s.ix, s.iz]);
        expect(o.x).toBeGreaterThanOrEqual(s.bounds.minX);
        expect(o.x).toBeLessThanOrEqual(s.bounds.maxX);
        expect(o.z).toBeGreaterThanOrEqual(s.bounds.minZ);
        expect(o.z).toBeLessThanOrEqual(s.bounds.maxZ);
      }
      expect(Object.values(s.counts).reduce((a, b) => a + b, 0)).toBe(s.objects.length);
      expect([...s.byModel.values()].reduce((a, l) => a + l.length, 0)).toBe(s.objects.length);
    }
    expect(sum).toBe(world.objects.length);
    expect(ids.size).toBe(world.objects.length);
  });

  it("dowolny sektor jest odtwarzalny z samego seeda, niezależnie od kolejności, marginesów i pamięci podręcznej", () => {
    for (const seed of [3, 2030, 90001]) {
      const reference = createForest(seed);
      const coords: [number, number][] = [[0, 0], [9, 9], [9, 0], [0, 9], [4, 6], [8, 3]];
      const expected = coords.map(([ix, iz]) => reference.sector(ix, iz).objects.map(key));

      const fresh = coords.map(([ix, iz]) => createForest(seed).sector(ix, iz).objects.map(key));
      expect(fresh).toEqual(expected);

      const reversed = createForest(seed);
      for (const s of [...reference.allSectors()].reverse()) reversed.sector(s.ix, s.iz);
      expect(coords.map(([ix, iz]) => reversed.sector(ix, iz).objects.map(key))).toEqual(expected);

      const wide = createForest(seed, { halo: 7 });
      expect(coords.map(([ix, iz]) => wide.sector(ix, iz).objects.map(key))).toEqual(expected);

      reference.clearCache();
      expect(coords.map(([ix, iz]) => reference.sector(ix, iz).objects.map(key))).toEqual(expected);
      reference.dropSector(4, 6);
      expect(reference.sector(4, 6).objects.map(key)).toEqual(expected[4]);
    }
  }, 60_000);

  it("pełny świat z potoku W0 to dokładnie suma leniwych sektorów", () => {
    const { world } = full(2030);
    const lazy = createForest(2030).allObjects();
    expect(world.objects.map(key)).toEqual(lazy.map(key));
  });

  it("okno 7 x 7: pierwsze zapytanie liczy 49 sektorów, ruch w obrębie sektora nic nie robi, krok dokłada tylko brzeg", () => {
    const forest = createForest(11);
    const win = forest.createWindow(3);
    const first = win.update(-1, -1)!;
    expect(first.current).toHaveLength(49);
    expect(first.enter).toHaveLength(49);
    expect(forest.generatedSectors).toBe(49);
    expect(win.update(-2.5, -0.5)).toBeNull();
    expect(forest.generatedSectors).toBe(49);
    const step = win.update(1, -1)!;
    expect(step.enter).toHaveLength(7);
    expect(step.leave).toHaveLength(7);
    expect(forest.generatedSectors).toBe(56);
    const back = win.update(-1, -1)!;
    expect(back.enter).toHaveLength(7);
    expect(forest.generatedSectors).toBe(56);
    const corner = createForest(11).createWindow(3).update(-149, -149)!;
    expect(corner.current).toHaveLength(16);
  });

  it("collidersNear zwraca te same kolizje co przeszukanie pełne, także na granicy sektorów", () => {
    const { world, forest } = full(2030);
    const all = world.objects.filter((o) => o.collider);
    for (const [x, z] of [[-30, -30], [0, 0], [-60.1, 29.9], [45, -75]]) {
      const expected = all.filter((o) => (o.x - x) ** 2 + (o.z - z) ** 2 <= (circleR(o) + 6) ** 2).map((o) => o.id).sort();
      expect(forest.collidersNear(x, z, 6).map((o) => o.id).sort()).toEqual(expected);
    }
  });
});

describe("W1a: teren i obiekty", () => {
  it("y każdego obiektu to wysokość terenu końcowego, a dane są skończone", () => {
    const { world } = full(1);
    for (const o of world.objects) {
      expect(Number.isFinite(o.x + o.y + o.z + o.radius)).toBe(true);
      expect(Math.abs(o.y - world.terrain.height(o.x, o.z))).toBeLessThan(1.1e-4);
    }
  });

  it("teren jest łagodny: bez stromych zboczy, wyraźne wzgórza i zagłębienia, ścieżki wygładzone", () => {
    for (const seed of [1, 2030, 555]) {
      const { world, forest } = full(seed);
      let maxTan = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let z = -150; z <= 150; z += 2) {
        for (let x = -150; x <= 150; x += 2) {
          const h = world.terrain.height(x, z);
          if (forest.geometry.waterGap(x, z) > 0) {
            const g = world.terrain.gradient(x, z);
            maxTan = Math.max(maxTan, Math.sqrt(g.dx * g.dx + g.dz * g.dz));
          }
          if (x < 80) {
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
      }
      expect(deg(maxTan)).toBeLessThan(33);
      expect(hi - lo).toBeGreaterThan(2.5);
      expect(hi - lo).toBeLessThan(12);
      for (const t of forest.geometry.trails) {
        for (let i = 0; i + 1 < t.points.length; i++) {
          const a = t.points[i];
          const b = t.points[i + 1];
          const run = Math.hypot(b.x - a.x, b.z - a.z);
          expect(deg(Math.abs(world.terrain.height(b.x, b.z) - world.terrain.height(a.x, a.z)) / run), t.id).toBeLessThan(10);
          const g = world.terrain.gradient(a.x, a.z);
          expect(deg(Math.hypot(g.dx, g.dz)), t.id).toBeLessThan(12);
        }
      }
    }
  });

  it("drzewa mają różne gatunki i rozmiary, a skały trzy klasy rozmiaru", () => {
    const { world } = full(1);
    const trees = world.objects.filter((o) => o.kind === "tree");
    const groups = new Set(trees.map((o) => o.variant!.split(".")[0]));
    expect([...groups].sort()).toEqual(["common", "pine", "twisted"]);
    const scales = trees.map((o) => o.scale!);
    expect(Math.max(...scales) / Math.min(...scales)).toBeGreaterThan(1.5);
    const rocks = world.objects.filter((o) => o.kind === "rock");
    expect(new Set(rocks.map((o) => o.tags![0]))).toEqual(new Set(["size_s", "size_m", "size_l"]));
    for (const r of rocks) {
      expect(r.scaleXYZ).toBeDefined();
      expect(Math.abs(r.tilt![0])).toBeLessThanOrEqual(0.0801);
    }
  });
});

describe("W1a: rzeka", () => {
  it("rzeka ma 10-14 m szerokości, leży we wschodniej części i przecina całą wysokość mapy z zapasem", () => {
    for (const seed of [1, 2030, 4000000000]) {
      const { forest } = full(seed);
      const pts = forest.geometry.river.points;
      expect(pts[0].z).toBeLessThanOrEqual(-150);
      expect(pts[pts.length - 1].z).toBeGreaterThanOrEqual(150);
      for (let z = -150; z <= 150; z += 5) {
        const r = forest.geometry.riverAt(z);
        expect(r.w * 2).toBeGreaterThanOrEqual(10);
        expect(r.w * 2).toBeLessThanOrEqual(14);
        expect(r.x).toBeGreaterThan(90);
        expect(r.x).toBeLessThan(118);
      }
      const xs = pts.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
    }
  });

  it("dno koryta jest głębsze niż brzegi, brzeg ma naturalną skarpę", () => {
    const { world, forest } = full(1);
    for (const z of [-100, -40, 20, 90]) {
      const r = forest.geometry.riverAt(z);
      const bed = world.terrain.height(r.x, z);
      const edge = world.terrain.height(r.x + r.w + 0.2, z);
      const bank = world.terrain.height(r.x + r.w + 5, z);
      expect(bed).toBeLessThan(edge - 0.7);
      expect(bank).toBeGreaterThan(edge + 0.3);
    }
  });

  it("żaden obiekt nie stoi w wodzie, a kolizje nie wchodzą w koryto", () => {
    for (const seed of [1, 2030]) {
      const { world, forest } = full(seed);
      for (const o of world.objects) expect(forest.geometry.waterGap(o.x, o.z), o.id).toBeGreaterThanOrEqual(circleR(o) - 1e-9);
      const shape = world.plan.barriers!.find((b) => b.id === RIVER_BARRIER_ID)!.shape;
      if (shape.type !== "ribbon") throw new Error("bariera rzeki powinna być wstęgą");
      for (const o of world.objects.filter((x) => x.kind === "tree" || x.kind === "rock")) {
        expect(ribbonGap(shape, o.x, o.z), o.id).toBeGreaterThanOrEqual(circleR(o) - 1e-9);
      }
    }
  });

  it("rzeka jest barierą: nie ma obejścia bez mostu, także przy krawędziach mapy, a po fladze mostu przejście działa", () => {
    for (const seed of [1, 2030, 4000000000]) {
      const { world, forest } = full(seed);
      expect(world.report.violations).toEqual([]);
      const reach = computeReachability(world.walk, FOREST_START, { cell: 1 });
      for (let z = -149; z <= 149; z += 1) {
        const r = forest.geometry.riverAt(z);
        expect(reach.has(r.x + r.w + 2, z), `z=${z}`).toBe(false);
        expect(reach.has(r.x, z)).toBe(false);
      }
      const east = world.features.poi("poi.bridge_landing_east")!;
      const west = world.features.poi("poi.bridge_landing_west")!;
      expect(reachesNear(reach, west.x, west.z, 1.5)).toBe(true);
      expect(reachesNear(reach, east.x, east.z, 3)).toBe(false);

      const open = computeReachability(world.walk, FOREST_START, { cell: 2, flags: new Set([BRIDGE_FLAG]) });
      expect(reachesNear(open, east.x, east.z, 3)).toBe(true);
      const stub = forest.geometry.trails.find((t) => t.stub)!;
      const end = stub.points[stub.points.length - 1];
      expect(reachesNear(open, end.x, end.z, 3)).toBe(true);

      const closed = world.walk.move(west, east);
      expect(closed.x).toBeLessThan(forest.geometry.riverAt(west.z).x);
      const crossed = world.walk.move(west, east, new Set([BRIDGE_FLAG]));
      expect(Math.hypot(crossed.x - east.x, crossed.z - east.z)).toBeLessThan(1);
    }
  }, 60_000);

  it("ruch wzdłuż północnej i południowej krawędzi mapy nie omija rzeki", () => {
    for (const seed of [1, 2030, 4000000000]) {
      const { world, forest } = full(seed);
      for (const z of [-149.4, 149.4]) {
        const r = forest.geometry.riverAt(z);
        let start: { x: number; z: number } | null = null;
        for (let dx = 3; dx < 25 && !start; dx += 0.5) {
          if (world.walk.isWalkable(r.x - r.w - dx, z)) start = { x: r.x - r.w - dx, z };
        }
        expect(start).not.toBeNull();
        let pos = start!;
        for (let i = 0; i < 40; i++) pos = world.walk.move(pos, { x: pos.x + 4, z });
        for (let i = 0; i < 40; i++) pos = world.walk.move(pos, { x: pos.x + 4, z: z > 0 ? 149.9 : -149.9 });
        expect(pos.x).toBeLessThan(r.x - r.w + 1);
      }
    }
  }, 60_000);

  it("miejsce mostu jest tylko danymi: lądowiska po obu brzegach, przejście otwierane flagą, brak mostu w obiektach", () => {
    const { world, forest } = full(1);
    const site = world.features.poi("poi.bridge_site")!;
    expect(site.props?.requiresFlag).toBe(BRIDGE_FLAG);
    const west = world.features.poi("poi.bridge_landing_west")!;
    const east = world.features.poi("poi.bridge_landing_east")!;
    expect(west.mustReach).toBe(true);
    expect(forest.geometry.riverAt(west.z).x).toBeGreaterThan(west.x);
    expect(forest.geometry.riverAt(east.z).x).toBeLessThan(east.x);
    const passage = world.plan.passages!.find((p) => p.id === BRIDGE_PASSAGE_ID)!;
    expect(passage.requiresFlag).toBe(BRIDGE_FLAG);
    expect(passage.opens).toEqual([RIVER_BARRIER_ID]);
    expect(world.objects.some((o) => /bridge|bridge_/.test(o.kind))).toBe(false);
  });
});

describe("W1a: ścieżki", () => {
  it("są cztery ścieżki, wszystkie przechodnie, a zachodnie osiągalne od startu", () => {
    const { world, forest } = full(1);
    expect(forest.geometry.trails.map((t) => t.id)).toEqual(["trail.main", "trail.branch_a", "trail.branch_b", "trail.east_stub"]);
    expect(world.report.violations.filter((v) => v.code.startsWith("path"))).toEqual([]);
    const reach = computeReachability(world.walk, FOREST_START, { cell: 1 });
    for (const t of forest.geometry.trails.filter((x) => !x.stub)) {
      for (const p of t.points) expect(reachesNear(reach, p.x, p.z, 1.5), `${t.id} ${p.x},${p.z}`).toBe(true);
    }
  });

  it("korytarz ścieżki jest wolny od kolizji z zapasem na gracza, a obiekty nie leżą na jej osi", () => {
    for (const seed of [1, 2030, 7]) {
      const { world, forest } = full(seed);
      for (const o of world.objects) {
        const gap = forest.geometry.trailGap(o.x, o.z);
        if (o.collider) expect(gap, o.id).toBeGreaterThanOrEqual(circleR(o) + 0.59);
        else if (o.kind === "bush") expect(gap, o.id).toBeGreaterThanOrEqual(0.49);
        else expect(gap, o.id).toBeGreaterThanOrEqual(-0.1001);
      }
    }
  });

  it("odgałęzienia kończą się polanami bez drzew", () => {
    const { world, forest } = full(1);
    for (const id of ["poi.clearing_a", "poi.clearing_b"]) {
      const poi = world.features.poi(id)!;
      const near = world.objects.filter((o) => o.kind === "tree" && Math.hypot(o.x - poi.x, o.z - poi.z) < 6);
      expect(near, id).toHaveLength(0);
    }
    const branches = forest.geometry.trails.filter((t) => t.id.startsWith("trail.branch"));
    for (const t of branches) {
      const end = t.points[t.points.length - 1];
      expect(Math.min(...["a", "b", "c", "d"].map((c) => {
        const p = world.features.poi(`poi.clearing_${c}`);
        return p ? Math.hypot(p.x - end.x, p.z - end.z) : Infinity;
      }))).toBeLessThan(1);
    }
  });
});

describe("W1a: kolizje i nakładanie", () => {
  it("żadne dwa obiekty z kolizją nie nakładają się, a drzewa mają odstęp od skał", () => {
    for (const seed of [1, 2030, 31337]) {
      const { world } = full(seed);
      const colliders = world.objects.filter((o) => o.collider);
      expect(colliders.length).toBeGreaterThan(500);
      for (const o of colliders) {
        for (const other of world.walk.index.queryRadius(o.x, o.z, circleR(o) + 4)) {
          if (other.id <= o.id) continue;
          const d = Math.hypot(other.x - o.x, other.z - o.z);
          expect(d, `${o.id} / ${other.id}`).toBeGreaterThanOrEqual(circleR(o) + circleR(other));
        }
      }
    }
  });

  it("kolizje obiektów są w indeksie chodzenia, a gracz nie przechodzi przez pień ani skałę", () => {
    const { world } = full(1);
    const tree = world.objects.find((o) => o.kind === "tree" && o.x > -100 && o.x < 50)!;
    const from = { x: tree.x - 6, z: tree.z };
    const out = world.walk.move(from, { x: tree.x + 6, z: tree.z });
    expect(world.walk.objectBlocking(out.x, out.z)).toBeNull();
    expect(Math.hypot(out.x - tree.x, out.z - tree.z)).toBeGreaterThanOrEqual(circleR(tree) + world.walk.config.playerRadius - 1e-6);
  });
});

describe("W1a: strefy środowiskowe i profile", () => {
  it("plan zawiera strefy czterech profili jako dane, każda z kształtem i priorytetem", () => {
    const { world } = full(1);
    const kinds = new Set(world.plan.zones!.map((z) => z.kind));
    expect([...kinds].sort()).toEqual(["clearing", "dense_forest", "riverside", "sunny_forest"]);
    for (const z of world.plan.zones!) {
      expect(["circle", "ribbon"]).toContain(z.shape.type);
      expect(z.priority).toBeGreaterThan(0);
      expect(Object.keys(DEFAULT_PROFILES)).toContain(z.kind);
    }
  });

  it("gęstość drzew w gęstym lesie jest wyraźnie większa niż w rzadkim, a polany są puste", () => {
    let dense = 0;
    let denseArea = 0;
    let sunny = 0;
    let sunnyArea = 0;
    let clearingTrees = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { world } = full(seed);
      for (const z of world.plan.zones!) {
        if (z.shape.type !== "circle") continue;
        const core = z.shape.r * 0.5;
        const trees = world.objects.filter((o) => o.kind === "tree" && Math.hypot(o.x - (z.shape as { x: number }).x, o.z - (z.shape as { z: number }).z) < core).length;
        const area = Math.PI * core * core;
        if (z.kind === "dense_forest") {
          dense += trees;
          denseArea += area;
        } else if (z.kind === "sunny_forest") {
          sunny += trees;
          sunnyArea += area;
        } else if (z.kind === "clearing") clearingTrees += trees;
      }
    }
    expect(dense / denseArea).toBeGreaterThan(1.5 * (sunny / sunnyArea));
    expect(clearingTrees).toBe(0);
  });

  it("profile są konfigurowalne: wyzerowanie gęstości usuwa warstwę, plan i teren zostają", () => {
    const empty = createForest(9, { profiles: withDensity("tree", 0) });
    const normal = createForest(9);
    const trees = (f: ForestWorld) => f.allObjects().filter((o) => o.kind === "tree" && !o.variant!.startsWith("twisted"));
    expect(trees(empty)).toHaveLength(0);
    expect(trees(normal).length).toBeGreaterThan(500);
    expect(empty.terrain.height(10, 10)).toBe(normal.terrain.height(10, 10));
  });

  it("roślinność zależy od typu terenu: paprocie gęstsze nad wodą, skały na brzegu rzeki", () => {
    let nearFern = 0;
    let farFern = 0;
    let nearRock = 0;
    let farRock = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { world, forest } = full(seed);
      for (const o of world.objects) {
        const gap = forest.geometry.riverAt(o.z).x - o.x;
        const west = gap > 0;
        if (!west) continue;
        const d = gap - forest.geometry.riverAt(o.z).w;
        if (o.kind === "fern") {
          if (d < 30) nearFern++;
          else if (d > 70) farFern++;
        }
        if (o.kind === "rock") {
          if (d < 30) nearRock++;
          else if (d > 70) farRock++;
        }
      }
    }
    // powierzchnie: pas 30 m przy rzece kontra pas od 70 m do ok. 190 m od niej
    expect(nearFern / 30).toBeGreaterThan(1.3 * (farFern / 100));
    expect(nearRock / 30).toBeGreaterThan(1.5 * (farRock / 100));
  });

  it("gęstość różni się między sektorami: są skupiska i prześwity", () => {
    const { forest } = full(1);
    const trees = forest.allSectors().map((s) => s.counts.tree ?? 0);
    const mean = trees.reduce((a, b) => a + b, 0) / trees.length;
    const sd = Math.sqrt(trees.reduce((a, b) => a + (b - mean) ** 2, 0) / trees.length);
    expect(sd / mean).toBeGreaterThan(0.3);
    expect(Math.max(...trees)).toBeGreaterThan(2 * Math.min(...trees.filter((n) => n > 0)));
    expect(new Set(trees).size).toBeGreaterThan(15);
  });
});

describe("W1a: wydajność generowania", () => {
  it("sektor liczy się w kilka milisekund, całe okno 7 x 7 szybko, a ruch w sektorze nic nie kosztuje", () => {
    const forest = createForest(2030);
    const t0 = performance.now();
    const win = forest.createWindow(3);
    win.update(0, 0);
    const windowMs = performance.now() - t0;
    expect(forest.generatedSectors).toBe(49);
    expect(windowMs).toBeLessThan(1500);
    const t1 = performance.now();
    for (let i = 0; i < 2000; i++) win.update(0.01 * i, 0.01 * i);
    expect(performance.now() - t1).toBeLessThan(100);
    expect(forest.generatedSectors).toBe(49);
    const t2 = performance.now();
    for (const s of forest.allSectors()) expect(s.objects.length).toBeGreaterThan(0);
    expect(performance.now() - t2).toBeLessThan(3000);
  });

  it("pełny świat z walidacją i odciskiem buduje się w budżecie", () => {
    const t0 = performance.now();
    const { world } = buildForest(42);
    expect(world.report.ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(6000);
    expect(world.objects.length).toBeGreaterThan(15_000);
    expect(world.objects.length).toBeLessThan(40_000);
  });
});
