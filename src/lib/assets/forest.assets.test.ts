import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROCK_JITTER,
  ROCK_MAX_TILT,
  SPECIES,
  createForest,
  summarizeForest,
} from "@/lib/game/world/generators/v2";
import { ROCK_CLASSES } from "@/lib/game/world/generators/v2/species";
import { ROCK_SINK, groupPlacements, objectModelId, objectToPlacement, parseManifest, placementCollider, sectorPlacements } from "./index";

const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../public/models/manifest.json"), "utf8"));
const manifest = parseManifest(raw);
const entries = new Map(manifest.models.map((m) => [m.id, m]));

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

describe("W1a + V1: tabela gatunków zgodna z manifestem", () => {
  it("każdy gatunek istnieje w manifeście, a rozmiary, kolizje i trójkąty się zgadzają", () => {
    expect(SPECIES).toHaveLength(manifest.models.length);
    for (const s of SPECIES) {
      const e = entries.get(s.model);
      expect(e, s.model).toBeDefined();
      if (!e) continue;
      const cat = s.layer === "ancient" ? "tree" : s.layer === "plant" ? "undergrowth" : s.layer === "fern" ? "undergrowth" : s.layer;
      expect(e.category, s.model).toBe(cat);
      expect(s.triangles, s.model).toBe(e.triangles);
      expect(near(s.height, e.bounds.size[1], 0.01), `${s.model} wysokość`).toBe(true);
      expect(near(s.footprint, Math.max(e.bounds.size[0], e.bounds.size[2]) / 2, 0.02), `${s.model} podstawa`).toBe(true);
      if (e.collision) expect(near(s.collider ?? -1, e.collision.r, 0.01), `${s.model} kolizja`).toBe(true);
      else expect(s.collider, `${s.model} bez kolizji`).toBeNull();
    }
  });

  it("klasy rozmiaru skał, rozrzut proporcji i pochylenie są kopią manifestu", () => {
    const rock = manifest.scaleClasses.rock;
    for (const id of ["s", "m", "l"] as const) expect([...ROCK_CLASSES[id].scale]).toEqual(rock.classes[id].scale);
    for (const id of ["s", "m", "l"] as const) expect(ROCK_CLASSES[id].harvest).toBe(rock.classes[id].harvestHint);
    expect(ROCK_JITTER).toEqual(rock.proportionJitter);
    expect(ROCK_MAX_TILT).toBe(rock.maxTiltRad);
  });
});

describe("W1a + V1: obiekty wygenerowanego lasu a manifest", () => {
  const forest = createForest(2030);
  const sectors = [forest.sector(3, 4), forest.sector(0, 0), forest.sector(7, 5), forest.sector(5, 5)];

  it("wszystkie identyfikatory modeli użyte przez obiekty istnieją w manifeście, a skale mieszczą się w zakresie gatunku", () => {
    let n = 0;
    for (const sector of sectors) {
      for (const o of sector.objects) {
        n++;
        const id = objectModelId(o);
        expect(entries.has(id), id).toBe(true);
        const sp = SPECIES.find((s) => s.model === id)!;
        const scale = o.scaleXYZ ?? o.scale ?? 1;
        const sx = typeof scale === "number" ? scale : scale[0];
        const sy = typeof scale === "number" ? scale : scale[1];
        if (o.kind === "rock") {
          expect(sy, o.id).toBeGreaterThan(0.2);
          expect(sy, o.id).toBeLessThan(1.6);
        } else {
          expect(sx, o.id).toBeGreaterThanOrEqual(sp.scale[0] - 1e-9);
          expect(sx, o.id).toBeLessThanOrEqual(sp.scale[1] + 1e-9);
        }
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it("kolizja obiektu to promień z manifestu razy skala (skały: średnia skal X i Z)", () => {
    for (const sector of sectors) {
      for (const o of sector.objects) {
        const e = entries.get(objectModelId(o))!;
        const want = placementCollider(e, o.scaleXYZ ?? o.scale ?? 1);
        if (!want) {
          expect(o.collider, o.id).toBeUndefined();
          continue;
        }
        expect(o.collider?.shape, o.id).toBe("circle");
        if (o.collider?.shape === "circle") expect(near(o.collider.r, want.r, 0.011), `${o.id} ${o.collider.r} vs ${want.r}`).toBe(true);
      }
    }
  });
});

describe("W1a + V1: adapter instancingu", () => {
  const forest = createForest(2030);
  const sector = forest.sector(3, 4);

  it("pozycje są grupowane po modelu, a liczba instancji zgadza się z obiektami sektora", () => {
    const groups = groupPlacements(sector.objects);
    let n = 0;
    for (const [model, list] of groups) {
      expect(entries.has(model), model).toBe(true);
      n += list.length;
    }
    expect(n).toBe(sector.objects.length);
    const cached = sectorPlacements(sector);
    expect(sectorPlacements(sector)).toBe(cached);
    expect([...cached.keys()].sort()).toEqual([...groups.keys()].sort());
    for (const [model, objs] of sector.byModel) expect(cached.get(model)).toHaveLength(objs.length);
  });

  it("skała jest zagłębiona w terenie, a skala i pochylenie przechodzą do instancji", () => {
    const rocks = forest.allSectors().flatMap((s) => s.objects.filter((o) => o.kind === "rock"));
    expect(rocks.length).toBeGreaterThan(20);
    for (const rock of rocks.slice(0, 20)) {
      const p = objectToPlacement(rock);
      expect(p.scale).toEqual(rock.scaleXYZ);
      const sy = rock.scaleXYZ![1];
      expect(p.y).toBeCloseTo(rock.y - ROCK_SINK * sy, 9);
      expect([p.tiltX, p.tiltZ]).toEqual([rock.tilt?.[0], rock.tilt?.[1]]);
      expect(Math.abs(p.tiltX ?? 0)).toBeLessThanOrEqual(ROCK_MAX_TILT + 1e-9);
      expect(Math.abs(p.tiltZ ?? 0)).toBeLessThanOrEqual(ROCK_MAX_TILT + 1e-9);
    }
    const tree = sector.objects.find((o) => o.kind === "tree")!;
    const tp = objectToPlacement(tree);
    expect(tp.y).toBe(tree.y);
    expect(tp.scale).toBe(tree.scale);
  });
});

describe("W1a + V1: budżet trójkątów", () => {
  it("najgęstsze okno 7 x 7 sektorów mieści się w rozsądnym budżecie trójkątów LOD 0", () => {
    const tris = new Map(manifest.models.map((m) => [m.id, m.triangles]));
    for (const seed of [1, 2030]) {
      const sum = summarizeForest(createForest(seed), tris);
      expect(sum.sectors).toBe(100);
      expect(sum.trianglesLod0).toBeGreaterThan(sum.trianglesWorstWindow * 0.5);
      expect(sum.trianglesWorstWindow).toBeGreaterThan(0);
      expect(sum.trianglesWorstWindow).toBeLessThan(14_000_000);
    }
  }, 60_000);
});
