import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  PRO_ZONES,
  PRO_ZONE_IDS,
  TOUR_WARMUP_SECONDS,
  VIEW_KINDS,
  VIEW_PROFILES,
  buildForestWindow,
  buildGroundMesh,
  buildGroundTexture,
  buildTourLegs,
  desertWeightFn,
  createFoliageUniforms,
  parseZoneParam,
  tourDuration,
  tourLegAt,
  tourPose,
  tuneMaterial,
  viewKindOf,
  zoneSector,
} from ".";

describe("Prototyp Pro: rodzaje widoku i odległości", () => {
  it("kamyki i płatki to `decor`, płyty brukowe to `path`, a każdy profil jakości zna odległość dla każdego rodzaju", () => {
    expect(viewKindOf("pebble")).toBe("decor");
    expect(viewKindOf("petal")).toBe("decor");
    expect(viewKindOf("rockpath")).toBe("path");
    expect(viewKindOf("tree")).toBe("tree");
    expect(viewKindOf("clover")).toBe("plant");
    for (const profile of Object.values(VIEW_PROFILES)) {
      for (const kind of VIEW_KINDS) expect(profile.distance[kind], kind).toBeGreaterThan(0);
      // Płyty bruku widać dalej niż drobne ozdoby, żeby droga nie "migała" przy marszu.
      expect(profile.distance.path).toBeGreaterThan(profile.distance.decor);
    }
  });
});

describe("Prototyp Pro: materiały liści z paczki Pro", () => {
  const make = (id: string) => {
    const m = new THREE.MeshStandardMaterial();
    m.userData.assetMaterialId = id;
    return m;
  };

  it("nowe materiały liści dostają wiatr i korektę, a nieznane materiały nie są ruszane", () => {
    const u = createFoliageUniforms();
    const birch = make("leaves_birch");
    tuneMaterial(birch, u, undefined, true);
    expect(birch.userData.forestTuned).toBe(true);
    expect(birch.onBeforeCompile).toBeTypeOf("function");
    const unknown = make("some_other_material");
    tuneMaterial(unknown, u, undefined, true);
    expect(unknown.userData.forestTuned).toBeUndefined();
  });

  it("tryb oryginalnych kolorów paczki ma osobny klucz programu i nie zamienia czerwieni starych drzew na zieleń", () => {
    const u = createFoliageUniforms();
    const game = make("leaves_twistedtree");
    const pack = make("leaves_twistedtree");
    tuneMaterial(game, u);
    tuneMaterial(pack, u, undefined, true);
    expect(game.customProgramCacheKey()).not.toBe(pack.customProgramCacheKey());
    const shader = (m: THREE.Material) => {
      const s = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: "#include <common>\n#include <begin_vertex>",
        fragmentShader: "#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>",
      };
      m.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as never);
      return s.fragmentShader;
    };
    expect(shader(pack)).not.toBe(shader(game));
  });
});

describe("Prototyp Pro: trasa pomiarowa przez 4 strefy", () => {
  it("strefy leżą w czterech różnych ćwiartkach, a sektor strefy zawiera jej środek", () => {
    expect(PRO_ZONE_IDS).toEqual(["a", "b", "c", "d"]);
    const quads = new Set(PRO_ZONE_IDS.map((id) => `${Math.sign(PRO_ZONES[id].x)}${Math.sign(PRO_ZONES[id].z)}`));
    expect(quads.size).toBe(4);
    for (const id of PRO_ZONE_IDS) {
      const s = zoneSector(id);
      expect(s.ix).toBeGreaterThanOrEqual(0);
      expect(s.ix).toBeLessThan(10);
      expect(s.iz).toBeGreaterThanOrEqual(0);
      expect(s.iz).toBeLessThan(10);
      expect(-150 + s.ix * 30).toBeLessThanOrEqual(PRO_ZONES[id].x);
      expect(-150 + (s.ix + 1) * 30).toBeGreaterThan(PRO_ZONES[id].x);
    }
    expect(parseZoneParam("C")).toBe("c");
    expect(parseZoneParam("x")).toBeNull();
    expect(parseZoneParam(null)).toBeNull();
  });

  it("okno Pro to cały las 10 x 10 sektorów z 4 strefami, a trasa ma 4 okręgi i drogę, której pozy są skończone", () => {
    const win = buildForestWindow({ pro: true, radius: 5, sector: zoneSector("a") });
    expect(win.sectors).toHaveLength(100);
    expect(win.forest.pro).not.toBeNull();
    const legs = buildTourLegs(win);
    expect(legs.map((l) => l.id)).toEqual(["a", "b", "c", "d", "road"]);
    expect(tourDuration(legs)).toBeGreaterThan(80);
    for (const leg of legs) {
      expect(leg.length).toBeGreaterThan(10);
      expect(leg.seconds).toBeGreaterThan(TOUR_WARMUP_SECONDS * 2);
      for (const t of [0, leg.seconds / 3, leg.seconds - 0.01]) {
        const p = tourPose(leg, t);
        expect(Number.isFinite(p.x + p.z + p.yaw + p.pitch)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(-150);
        expect(p.x).toBeLessThanOrEqual(150);
      }
    }
    // Okręgi stref leżą w obrębie swojej ćwiartki (w czystej strefie, poza pasem przejścia).
    for (const leg of legs.slice(0, 4)) {
      const c = PRO_ZONES[leg.id as keyof typeof PRO_ZONES];
      for (const p of leg.points) {
        expect(Math.sign(p.x)).toBe(Math.sign(c.x));
        expect(Math.sign(p.z)).toBe(Math.sign(c.z));
      }
    }
    // Droga biegnie od startu na zachodzie do mostu na wschodzie.
    const road = legs[4];
    expect(road.points[0].x).toBeLessThan(road.points[road.points.length - 1].x);
  }, 120_000);

  it("tourLegAt przydziela czas do odcinków i kończy się po ostatnim", () => {
    const legs = [
      { id: "a", seconds: 10 },
      { id: "b", seconds: 5 },
    ] as never;
    expect(tourLegAt(legs, 0)).toEqual({ index: 0, local: 0 });
    expect(tourLegAt(legs, 12)).toEqual({ index: 1, local: 2 });
    expect(tourLegAt(legs, 15)).toBeNull();
  });
});

describe("Prototyp Pro: spękana ziemia i piasek (dane gruntu)", () => {
  it("maska pęknięć (alfa tekstury) jest w płatach pustyni i na ścieżkach, a gdzie indziej zero; bez Pro alfa = 255", () => {
    const win = buildForestWindow({ pro: true, radius: 5, sector: zoneSector("c") });
    const tex = buildGroundTexture({ forest: win.forest, bounds: win.windowBounds, objects: win.objects, size: 512 });
    let desertCracked = 0;
    let desertTotal = 0;
    let pathCracked = 0;
    let pathTotal = 0;
    let forestCracked = 0;
    for (let j = 0; j < tex.size; j++) {
      for (let i = 0; i < tex.size; i++) {
        const x = win.windowBounds.minX + (i + 0.5) * tex.metersPerPixel;
        const z = win.windowBounds.minZ + (j + 0.5) * tex.metersPerPixel;
        const alpha = tex.data[(j * tex.size + i) * 4 + 3];
        const gap = win.forest.geometry.trailGap(x, z);
        if (gap < -0.5) {
          pathTotal++;
          if (alpha > 128) pathCracked++;
        } else if (x > 60 && z > 60 && win.forest.geometry.waterGap(x, z) > 8) {
          desertTotal++;
          if (alpha > 128) desertCracked++;
        } else if (x < -60 && gap > 6) {
          if (alpha > 0) forestCracked++;
        }
      }
    }
    expect(desertCracked / desertTotal).toBeGreaterThan(0.15);
    expect(desertCracked / desertTotal).toBeLessThan(0.8);
    // Brukowana droga główna jest bez pęknięć, więc wystarczy, że ścieżki ziemne je mają.
    expect(pathTotal).toBeGreaterThan(100);
    expect(pathCracked).toBeGreaterThan(0);
    expect(forestCracked).toBe(0);
    const plain = buildForestWindow({ radius: 1 });
    const plainTex = buildGroundTexture({ forest: plain.forest, bounds: plain.windowBounds, objects: plain.objects, size: 64 });
    for (let k = 3; k < plainTex.data.length; k += 4) expect(plainTex.data[k]).toBe(255);
  }, 120_000);

  it("atrybut pustyni jest tylko w trybie Pro: 0 w A i B, blisko 1 w głębi C", () => {
    const win = buildForestWindow({ pro: true, radius: 5, sector: zoneSector("c") });
    const at = desertWeightFn(win.forest)!;
    expect(at(-100, -100)).toBeLessThan(0.01);
    expect(at(-100, 100)).toBeLessThan(0.01);
    // W głębi C (daleko od szwu) pustynia ma pełną wagę. Punkt wyszukujemy na siatce, bo dokładne miejsce zależy od układu
    // rzeki i stref przyrody w danym świecie (strefa nadrzeczna o wyższym priorytecie zabiera wagę pustyni).
    let deepest = 0;
    for (let x = 50; x <= 140; x += 10) for (let z = 50; z <= 140; z += 10) deepest = Math.max(deepest, at(x, z));
    expect(deepest).toBeGreaterThan(0.9);
    expect(desertWeightFn(buildForestWindow({ radius: 1 }).forest)).toBeNull();
    const mesh = buildGroundMesh(win.forest.terrain, win.windowBounds, 6, at);
    expect(mesh.desert).toBeDefined();
    expect(mesh.desert!.length).toBe(mesh.vertexCount);
    expect(buildGroundMesh(win.forest.terrain, win.windowBounds, 6).desert).toBeUndefined();
  }, 120_000);
});
