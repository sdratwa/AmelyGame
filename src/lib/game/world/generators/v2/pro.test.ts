import { describe, expect, it } from "vitest";
import { parseObjectId, sectorOf } from "../../bounds";
import type { WorldObject } from "../../objects";
import {
  PRO_OPTIONS,
  PRO_PAVING,
  PRO_TUNING,
  QUADRANT_IDS,
  SPECIES,
  SPECIES_ALL,
  SPECIES_PRO,
  buildForest,
  createForest,
  groupIndex,
  type ForestWorld,
} from ".";
import { createDuneOffset } from "./dunes";
import { PolylineWalker, buildPaving } from "./paving";

const SEED = 2030;
const circleR = (o: WorldObject) => (o.collider?.shape === "circle" ? o.collider.r : 0);
const key = (o: WorldObject) => JSON.stringify(o);
const v2Ids = new Set(SPECIES.map((s) => s.model));
const modelOf = (o: WorldObject) => (o.variant ? `${o.kind}.${o.variant}` : o.kind);

function allObjects(forest: ForestWorld): WorldObject[] {
  return forest.allSectors().flatMap((s) => [...s.objects]);
}

function distToPolyline(pts: readonly { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}

let proForest: ForestWorld | null = null;
const pro = () => (proForest ??= createForest(SEED, { pro: PRO_OPTIONS }));

describe("Prototyp Pro: generator v2 bez opcji `pro` pozostaje nietknięty", () => {
  it("domyślny las nie zawiera modeli spoza tabeli v2, a puste opcje nie zmieniają świata", () => {
    const a = buildForest(SEED);
    const b = buildForest(SEED, {});
    expect(a.forest.pro).toBeNull();
    expect(a.world.fingerprint).toBe(b.world.fingerprint);
    for (const o of a.world.objects) expect(v2Ids.has(modelOf(o)), modelOf(o)).toBe(true);
  }, 60_000);

  it("tryb Pro zmienia tylko wynik generatora, a plan świata (rzeka, ścieżki, polany) pozostaje taki sam", () => {
    const plain = createForest(SEED);
    const p = pro();
    expect(p.plan).toEqual(plain.plan);
    expect(p.pro).not.toBeNull();
  });
});

describe("Prototyp Pro: strefy-ćwiartki", () => {
  it("wagi czterech ćwiartek sumują się do 1 w całym regionie, a szew daje po 0,25", () => {
    const g = pro().geometry;
    const w = new Float64Array(4);
    for (let x = -150; x <= 150; x += 7.5) {
      for (let z = -150; z <= 150; z += 7.5) {
        g.quadrantWeights(x, z, w);
        expect(w[0] + w[1] + w[2] + w[3], `${x},${z}`).toBeCloseTo(1, 12);
        for (const v of w) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
    g.quadrantWeights(0, 0, w);
    for (const v of w) expect(v).toBeCloseTo(0.25, 12);
  });

  it("czyste strefy leżą w narożnikach: A na północnym zachodzie, B na południowym zachodzie, C na południowym wschodzie, D na północnym wschodzie", () => {
    const g = pro().geometry;
    const w = new Float64Array(4);
    const corners: [number, number][] = [
      [-70, -70],
      [-70, 70],
      [70, 70],
      [70, -70],
    ];
    corners.forEach(([x, z], i) => {
      g.quadrantWeights(x, z, w);
      expect(w[i], QUADRANT_IDS[i]).toBe(1);
    });
  });

  it("bez trybu ćwiartek wagi nie istnieją (null)", () => {
    expect(createForest(SEED).geometry.quadrantWeights(0, 0)).toBeNull();
  });
});

describe("Prototyp Pro: determinizm i niezależność sektorów", () => {
  it("ten sam seed daje identyczny sektor, niezależnie od kolejności generowania sąsiadów", () => {
    const a = createForest(SEED, { pro: PRO_OPTIONS });
    const b = createForest(SEED, { pro: PRO_OPTIONS });
    const first = a.sector(4, 4).objects.map(key);
    for (const [ix, iz] of [
      [3, 4],
      [5, 4],
      [4, 3],
      [4, 5],
      [9, 9],
    ])
      b.sector(ix, iz);
    expect(b.sector(4, 4).objects.map(key)).toEqual(first);
    expect(first.length).toBeGreaterThan(100);
  }, 60_000);

  it("obiekty mają unikalne ID z poprawnym sektorem i nie nakładają kolizji (poza płytami bruku, które nie mają kolizji)", () => {
    const f = pro();
    for (const [ix, iz] of [
      [2, 2],
      [2, 7],
      [7, 7],
      [7, 2],
      [4, 4],
    ]) {
      const sector = f.sector(ix, iz);
      const ids = new Set<string>();
      for (const o of sector.objects) {
        expect(ids.has(o.id), o.id).toBe(false);
        ids.add(o.id);
        const parsed = parseObjectId(o.id);
        const s = sectorOf(f.region, o.x, o.z);
        expect(parsed && s && parsed.ix === ix && parsed.iz === iz && s.ix === ix && s.iz === iz, o.id).toBe(true);
        expect(Number.isFinite(o.x + o.y + o.z), o.id).toBe(true);
        expect(f.geometry.waterGap(o.x, o.z), o.id).toBeGreaterThanOrEqual(circleR(o) - 1e-9);
      }
      const colliders = sector.objects.filter((o) => o.collider?.shape === "circle");
      for (let i = 0; i < colliders.length; i++) {
        for (let j = i + 1; j < colliders.length; j++) {
          const a = colliders[i];
          const b = colliders[j];
          const rr = circleR(a) + circleR(b);
          expect((a.x - b.x) ** 2 + (a.z - b.z) ** 2, `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(rr * rr - 1e-6);
        }
      }
    }
  }, 60_000);
});

describe("Prototyp Pro: bruk drogi głównej", () => {
  const catalog = groupIndex(SPECIES_ALL);
  const slabs = catalog.get("rockpath") ?? [];
  const pebbles = catalog.get("pebble") ?? [];

  it("katalog ma 10 płyt RockPath i 11 kamyków Pebble", () => {
    expect(slabs).toHaveLength(10);
    expect(pebbles).toHaveLength(11);
  });

  it("buildPaving jest deterministyczny, a wynik zależy od ziarna", () => {
    const trail = pro().geometry.trails.find((t) => t.id === PRO_PAVING.trailId)!;
    expect(trail).toBeDefined();
    const a = buildPaving(trail.points, PRO_PAVING, slabs, pebbles, 123);
    const b = buildPaving(trail.points, PRO_PAVING, slabs, pebbles, 123);
    const c = buildPaving(trail.points, PRO_PAVING, slabs, pebbles, 124);
    expect(a.length).toBeGreaterThan(100);
    expect(a.map((i) => [i.x, i.z, i.sp.model, i.scale, i.yaw])).toEqual(b.map((i) => [i.x, i.z, i.sp.model, i.scale, i.yaw]));
    expect(c.map((i) => i.sp.model)).not.toEqual(a.map((i) => i.sp.model));
  });

  it("bruk jest gęstszy przy starcie i przy moście niż w środku drogi", () => {
    const trail = pro().geometry.trails.find((t) => t.id === PRO_PAVING.trailId)!;
    const walker = new PolylineWalker(trail.points);
    const items = buildPaving(trail.points, PRO_PAVING, slabs, pebbles, 123).filter((i) => i.sp.layer === "path");
    const along = (i: { x: number; z: number }) => {
      let best = 0;
      let bd = Infinity;
      for (let s = 0; s <= walker.length; s += 1) {
        const f = walker.at(s);
        const d = Math.hypot(f.x - i.x, f.z - i.z);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };
    const L = walker.length;
    const ends = items.filter((i) => {
      const s = along(i);
      return s < PRO_PAVING.endZone || s > L - PRO_PAVING.endZone;
    }).length;
    const middle = items.length - ends;
    const endLen = 2 * PRO_PAVING.endZone;
    const midLen = Math.max(1, L - endLen);
    expect(ends / endLen).toBeGreaterThan(middle / midLen);
  });

  it("płyty i kamyki w świecie leżą na drodze, nie mają kolizji i nie wchodzą w koliderowe obiekty", () => {
    const f = pro();
    const trail = f.geometry.trails.find((t) => t.id === PRO_PAVING.trailId)!;
    const objects = allObjects(f);
    const paved = objects.filter((o) => o.kind === "rockpath");
    expect(paved.length).toBeGreaterThan(100);
    for (const o of paved) {
      expect(o.collider, o.id).toBeUndefined();
      expect(distToPolyline(trail.points, o.x, o.z), o.id).toBeLessThanOrEqual(trail.halfWidth + 1);
    }
    const colliders = objects.filter((o) => o.collider?.shape === "circle");
    for (const o of paved.slice(0, 400)) {
      for (const c of colliders) {
        if (Math.abs(c.x - o.x) > 6 || Math.abs(c.z - o.z) > 6) continue;
        expect(Math.hypot(c.x - o.x, c.z - o.z), `${o.id} / ${c.id}`).toBeGreaterThanOrEqual(circleR(c));
      }
    }
  }, 120_000);
});

describe("Prototyp Pro: pokrycie modeli i stref", () => {
  it("w całym lesie występuje każdy z modeli paczki (Standard + Pro), a w grach v2 nie ma żadnego z modeli Pro", () => {
    const seen = new Set(allObjects(pro()).map(modelOf));
    const missing = SPECIES_ALL.filter((s) => !seen.has(s.model)).map((s) => s.model);
    expect(missing).toEqual([]);
    const proOnly = new Set(SPECIES_PRO.map((s) => s.model));
    for (const o of allObjects(createForest(SEED))) expect(proOnly.has(modelOf(o)), modelOf(o)).toBe(false);
  }, 120_000);

  it("strefy mają swój charakter: brzozy w A, olbrzymie sosny w B, martwe drzewa i skały pustynne w C, wiśnie w D", () => {
    const objects = allObjects(pro());
    const countIn = (match: (o: WorldObject) => boolean | undefined, zone: "a" | "b" | "c" | "d") =>
      objects.filter((o) => {
        const west = o.x < -25;
        const east = o.x > 25;
        const north = o.z < -25;
        const south = o.z > 25;
        const inZone = zone === "a" ? west && north : zone === "b" ? west && south : zone === "c" ? east && south : east && north;
        return inZone && match(o);
      }).length;
    const birch = (o: WorldObject) => o.kind === "tree" && o.variant?.startsWith("birch");
    const giant = (o: WorldObject) => o.kind === "tree" && o.variant?.startsWith("giantpine");
    const dead = (o: WorldObject) => o.kind === "tree" && o.variant?.startsWith("dead");
    const desert = (o: WorldObject) => o.kind === "rock" && !!o.variant?.endsWith("desert");
    const cherry = (o: WorldObject) => o.kind === "tree" && o.variant?.startsWith("cherry");
    expect(countIn(birch, "a")).toBeGreaterThan(countIn(birch, "b"));
    expect(countIn(giant, "b")).toBeGreaterThan(countIn(giant, "a"));
    expect(countIn(dead, "c")).toBeGreaterThan(countIn(dead, "a"));
    expect(countIn(desert, "c")).toBeGreaterThan(countIn(desert, "b"));
    expect(countIn(cherry, "d")).toBeGreaterThan(countIn(cherry, "b"));
  }, 120_000);
});

describe("Prototyp Pro: trawa w kępach, formacje skalne i wydmy", () => {
  const inZoneC = (o: { x: number; z: number }) => o.x > 25 && o.z > 25;

  it("trawa tworzy zwarte kępy: wiele źdźbeł w małej odległości, a nie pojedyncze kępki", () => {
    const grass = allObjects(pro()).filter((o) => o.kind === "grass");
    expect(grass.length).toBeGreaterThan(1000);
    const cell = new Map<string, number>();
    for (const g of grass) {
      const k = `${Math.floor(g.x / 3)}_${Math.floor(g.z / 3)}`;
      cell.set(k, (cell.get(k) ?? 0) + 1);
    }
    const crowded = [...cell.values()].filter((n) => n >= 5).length;
    expect(crowded).toBeGreaterThan(cell.size * 0.2);
    // Rozsiew kęp nie dotyka zwykłego generatora: bez `pro` trawa pozostaje pojedynczymi kępkami o stałej skali.
    expect(PRO_TUNING.grass.members[0]).toBeGreaterThan(1);
  }, 120_000);

  it("trawa nie rośnie na wodzie ani na ścieżce", () => {
    const f = pro();
    for (const o of allObjects(f)) {
      if (o.kind !== "grass") continue;
      expect(f.geometry.waterGap(o.x, o.z), o.id).toBeGreaterThan(0);
      expect(f.geometry.trailGap(o.x, o.z), o.id).toBeGreaterThan(0);
    }
  }, 120_000);

  it("formacje skalne to grupy dużych głazów, występują głównie w C i są deterministyczne", () => {
    const rocks = allObjects(pro()).filter((o) => o.kind === "rock" && o.tags?.includes("size_l"));
    const big = rocks.filter((o) => o.variant?.startsWith("big"));
    expect(big.length).toBeGreaterThan(0);
    const clusterOf = (o: WorldObject) => big.filter((p) => Math.hypot(p.x - o.x, p.z - o.z) < 12).length;
    const inC = big.filter(inZoneC);
    expect(inC.length).toBeGreaterThan(big.filter((o) => o.x < -25 && o.z > 25).length);
    expect(inC.some((o) => clusterOf(o) >= 3)).toBe(true);
    const again = createForest(SEED, { pro: PRO_OPTIONS });
    const a = allObjects(again).filter((o) => o.kind === "rock").map(key);
    const b = allObjects(pro()).filter((o) => o.kind === "rock").map(key);
    expect(a).toEqual(b);
  }, 120_000);

  it("zwykły las v2 nie ma formacji ani zmienionego terenu", () => {
    const plain = createForest(SEED);
    const offset = createDuneOffset(plain.geometry, SEED, PRO_TUNING.dunes);
    expect(plain.geometry.quadrantWeights(200, 200)).toBeNull();
    expect(offset(200, 200)).toBe(0);
    expect(plain.terrain.height(100, 100)).toBe(createForest(SEED).terrain.height(100, 100));
  });

  it("wydmy: zero poza ćwiartką C, przy rzece, na ścieżkach i obszarach wolnych; wysokość obiektów zgodna z terenem", () => {
    const f = pro();
    const offset = createDuneOffset(f.geometry, SEED, PRO_TUNING.dunes);
    let maxC = 0;
    for (let x = -140; x <= 140; x += 7) {
      for (let z = -140; z <= 140; z += 7) {
        const d = offset(x, z);
        if (x < -30 || z < -30) expect(d, `${x},${z}`).toBe(0);
        if (f.geometry.waterGap(x, z) < 6 || f.geometry.trailGap(x, z) < 1.5) expect(d, `${x},${z}`).toBe(0);
        for (const c of f.geometry.keepClear) if (Math.hypot(x - c.x, z - c.z) < c.r) expect(d).toBe(0);
        if (x > 30 && z > 30) maxC = Math.max(maxC, Math.abs(d));
      }
    }
    expect(maxC).toBeGreaterThan(0.4);
    expect(maxC).toBeLessThanOrEqual(PRO_TUNING.dunes.amplitude);
    for (const o of allObjects(f).slice(0, 4000)) expect(Math.abs(o.y - f.terrain.height(o.x, o.z))).toBeLessThan(1e-4);
  }, 120_000);

  it("wydmy nie robią zbyt stromych zboczy (tangens nachylenia w C poniżej 0,6)", () => {
    const f = pro();
    for (let x = 30; x <= 140; x += 5) {
      for (let z = 30; z <= 140; z += 5) {
        const g = f.terrain.gradient(x, z);
        expect(Math.hypot(g.dx, g.dz), `${x},${z}`).toBeLessThan(0.6);
      }
    }
  }, 120_000);
});
