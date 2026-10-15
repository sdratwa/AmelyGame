import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";
import { AssetLibrary, ROCK_SINK, type QualityId } from "@/lib/assets";
import {
  BENCHMARK_SECONDS,
  DEFAULT_OVERRIDES,
  DEFAULT_SEED,
  EYE_HEIGHT,
  FirstPersonController,
  ForestInstancer,
  FrameStats,
  LOD_HYSTERESIS,
  MODEL_LOOK,
  VIEW_PROFILES,
  atmosphereAt,
  benchmarkPose,
  buildBenchmarkRoute,
  buildForestWindow,
  buildGroundMesh,
  buildGroundTexture,
  buildWaterMesh,
  chooseLevel,
  forcedLevelIndex,
  forwardOf,
  hash01,
  parseSectorParam,
  stressRadius,
  sunElevationDeg,
  type ForestWindow,
  type ViewOverrides,
} from ".";

const MODELS_DIR = path.resolve(__dirname, "../../../public/models");
const raw = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, "manifest.json"), "utf8"));
const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function diskLibrary(id: QualityId) {
  return new AssetLibrary({
    profile: VIEW_PROFILES[id].assets,
    baseUrl: "/models",
    loadManifestJson: async () => raw,
    loadGlb: async (url) => {
      const buf = fs.readFileSync(path.join(MODELS_DIR, url.replace(/^\/models\//, "")));
      return gltf.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
    },
    loadTexture: async (url) => {
      expect(fs.existsSync(path.join(MODELS_DIR, url.replace(/^\/models\//, ""))), url).toBe(true);
      return new THREE.Texture();
    },
  });
}

const windows = new Map<string, ForestWindow>();
function win(seed = DEFAULT_SEED, radius = 1): ForestWindow {
  const key = `${seed}:${radius}`;
  let w = windows.get(key);
  if (!w) {
    w = buildForestWindow({ seed, radius });
    windows.set(key, w);
  }
  return w;
}

function camera(x: number, y: number, z: number, yaw = 0, aspect = 16 / 9) {
  const cam = new THREE.PerspectiveCamera(70, aspect, 0.1, 600);
  cam.position.set(x, y, z);
  cam.rotation.order = "YXZ";
  cam.rotation.y = yaw;
  cam.updateMatrixWorld(true);
  return cam;
}

describe("V2a: wybór sektora i okno lasu z generatora W1a", () => {
  it("domyślny seed i sektor wzorcowy są deterministyczne i kwalifikują się do prototypu", () => {
    const a = buildForestWindow({});
    const b = buildForestWindow({});
    expect(a.seed).toBe(DEFAULT_SEED);
    expect(a.sector).toEqual(b.sector);
    expect(a.showcase.map((s) => s.id)).toEqual(b.showcase.map((s) => s.id));
    expect(a.sector.id).toBe(a.showcase[0].id);
    expect(a.showcase[0].qualifies).toBe(true);
    expect(a.batches.map((x) => [x.modelId, x.placements.length])).toEqual(b.batches.map((x) => [x.modelId, x.placements.length]));
    const other = buildForestWindow({ seed: 7 });
    expect(other.showcase[0].id === a.showcase[0].id && other.instanceCount === a.instanceCount).toBe(false);
  });

  it("okno 3 x 3 i 7 x 7: rozmiary, strefa chodzenia i obiekty tylko z generatora", () => {
    const w = win();
    expect(w.sectors).toHaveLength(9);
    expect(w.windowBounds.maxX - w.windowBounds.minX).toBe(90);
    expect(w.walkBounds.maxX - w.walkBounds.minX).toBeLessThanOrEqual(60);
    const ids = new Set(w.objects.map((o) => o.id));
    for (const o of w.forest.allObjects().filter((x) => ids.has(x.id))) expect(w.objects.find((q) => q.id === o.id)).toBe(o);
    const big = win(DEFAULT_SEED, 3);
    expect(big.sectors).toHaveLength(49);
    expect(big.windowBounds.maxX - big.windowBounds.minX).toBe(210);
    expect(big.instanceCount).toBeGreaterThan(w.instanceCount * 3);
  });

  it("wybór sektora z parametru i obsługa ?stress", () => {
    expect(parseSectorParam("4_5")).toEqual({ ix: 4, iz: 5 });
    expect(parseSectorParam("abc")).toBeNull();
    expect(stressRadius(49)).toBe(3);
    expect(stressRadius(9)).toBe(1);
    expect(stressRadius(25)).toBe(2);
    expect(stressRadius(48)).toBeNull();
    expect(stressRadius(4)).toBeNull();
    const w = buildForestWindow({ seed: 3, sector: { ix: 0, iz: 9 } });
    expect(w.sector.id).toBe("sector.forest_start.0_9");
    expect(w.sectors).toHaveLength(9);
    const clamped = buildForestWindow({ seed: 3, sector: { ix: 99, iz: -4 } });
    expect(clamped.sector.id).toBe("sector.forest_start.9_0");
  });

  it("pozycje instancji zgadzają się z wysokością terenu (skały zagłębione o ROCK_SINK)", () => {
    const w = win();
    let n = 0;
    for (const batch of w.batches) {
      batch.placements.forEach((p, i) => {
        const h = w.forest.terrain.height(p.x, p.z);
        const scale = p.scale ?? 1;
        const sy = typeof scale === "number" ? scale : scale[1];
        const sink = batch.kind === "rock" ? ROCK_SINK * sy : 0;
        expect(Math.abs(p.y - (h - sink)), `${batch.ids[i]}`).toBeLessThan(2e-4);
        n++;
      });
    }
    expect(n).toBe(w.instanceCount);
    expect(w.instanceCount + w.hiddenCount).toBe(w.objects.length);
  });

  it("odmiany magiczne są ukryte tylko w widoku, a w świecie zostają (kolizje i ID bez zmian)", () => {
    const w = win();
    for (const id of Object.keys(MODEL_LOOK)) expect(w.batches.some((b) => b.modelId === id)).toBe(false);
    expect(w.hiddenCount).toBeGreaterThanOrEqual(0);
    expect(w.objects.some((o) => o.variant === "7" || o.variant === "7_big")).toBe(w.hiddenCount > 0);
  });

  it("start jest przechodni, leży na ścieżce w wybranym sektorze i patrzy wzdłuż niej", () => {
    for (const seed of [DEFAULT_SEED, 1, 4000000000]) {
      const w = win(seed);
      const s = w.start;
      expect(w.walk.isWalkable(s.x, s.z)).toBe(true);
      const sec = w.sectors.find((q) => q.id === w.sector.id)!;
      expect(s.x).toBeGreaterThanOrEqual(sec.bounds.minX);
      expect(s.x).toBeLessThanOrEqual(sec.bounds.maxX);
      expect(w.forest.geometry.trailGap(s.x, s.z)).toBeLessThan(0.2);
      const f = forwardOf(s.yaw);
      expect(w.forest.geometry.trailGap(s.x + f.x * 3, s.z + f.z * 3)).toBeLessThan(1.5);
    }
  });

  it("hash rozrzutu jest stały i równomierny", () => {
    expect(hash01("tree.forest_start.1_1.1")).toBe(hash01("tree.forest_start.1_1.1"));
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += hash01(`grass.x.${i}`);
    expect(sum / 2000).toBeGreaterThan(0.46);
    expect(sum / 2000).toBeLessThan(0.54);
  });
});

describe("V2a: sterowanie pierwszoosobowe i kolizje", () => {
  it("idzie po ścieżce zgodnie z wysokością terenu, a oczy są na stałej wysokości nad gruntem", () => {
    const w = win();
    const c = new FirstPersonController(w.walk, w.forest.terrain, w.start);
    for (let i = 0; i < 240; i++) c.update(1 / 60, { forward: 1, right: 0, sprint: false });
    expect(Math.hypot(c.state.x - w.start.x, c.state.z - w.start.z)).toBeGreaterThan(5);
    expect(Math.abs(c.state.eyeY - (w.forest.terrain.height(c.state.x, c.state.z) + EYE_HEIGHT))).toBeLessThan(0.35);
  });

  it("ten sam ruch w 30, 60 i 144 FPS daje tę samą drogę (niezależnie od FPS)", () => {
    const w = win();
    const run = (fps: number) => {
      const c = new FirstPersonController(w.walk, w.forest.terrain, w.start);
      const steps = Math.round(fps * 1.5);
      for (let i = 0; i < steps; i++) c.update(1 / fps, { forward: 1, right: 0, sprint: false });
      return c.state;
    };
    const a = run(30);
    const b = run(60);
    const d = run(144);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.25);
    expect(Math.hypot(d.x - b.x, d.z - b.z)).toBeLessThan(0.25);
    const c = new FirstPersonController(w.walk, w.forest.terrain, w.start);
    const before = { x: c.state.x, z: c.state.z };
    c.update(5, { forward: 1, right: 0, sprint: true });
    expect(Math.hypot(c.state.x - before.x, c.state.z - before.z)).toBeLessThanOrEqual(0.62);
  });

  it("nie da się przejść przez pnie drzew ani skały, z żadnego kierunku", () => {
    const w = win();
    const solids = w.objects.filter((o) => o.collider && w.walkBounds.minX + 4 < o.x && o.x < w.walkBounds.maxX - 4 && w.walkBounds.minZ + 4 < o.z && o.z < w.walkBounds.maxZ - 4);
    expect(solids.length).toBeGreaterThan(20);
    let tested = 0;
    for (const o of solids.filter((_, i) => i % 3 === 0).slice(0, 40)) {
      const r = o.collider?.shape === "circle" ? o.collider.r : o.radius;
      for (const angle of [0, 1.7, 3.3, 5.0]) {
        const sx = o.x + Math.cos(angle) * (r + 2.2);
        const sz = o.z + Math.sin(angle) * (r + 2.2);
        if (!w.walk.isWalkable(sx, sz)) continue;
        const c = new FirstPersonController(w.walk, w.forest.terrain, { x: sx, z: sz, yaw: Math.atan2(sx - o.x, sz - o.z) });
        for (let i = 0; i < 120; i++) c.update(1 / 60, { forward: 1, right: 0, sprint: true });
        expect(Math.hypot(c.state.x - o.x, c.state.z - o.z), o.id).toBeGreaterThanOrEqual(r + w.walk.config.playerRadius - 0.02);
        tested++;
      }
    }
    expect(tested).toBeGreaterThan(40);
  });

  it("granica strefy chodzenia zatrzymuje gracza", () => {
    const w = win();
    const c = new FirstPersonController(w.walk, w.forest.terrain, w.start);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      c.state.yaw = yaw;
      for (let i = 0; i < 1500; i++) c.update(1 / 60, { forward: 1, right: 0, sprint: true });
      expect(c.state.x).toBeGreaterThanOrEqual(w.walkBounds.minX);
      expect(c.state.x).toBeLessThanOrEqual(w.walkBounds.maxX);
      expect(c.state.z).toBeGreaterThanOrEqual(w.walkBounds.minZ);
      expect(c.state.z).toBeLessThanOrEqual(w.walkBounds.maxZ);
    }
  });

  it("obrót myszą ogranicza pochylenie, a kierunek przodu jest zgodny z kamerą", () => {
    const w = win();
    const c = new FirstPersonController(w.walk, w.forest.terrain, w.start);
    c.look(0, -100000);
    expect(c.state.pitch).toBeLessThanOrEqual(1.45);
    c.look(0, 100000);
    expect(c.state.pitch).toBeGreaterThanOrEqual(-1.45);
    const cam = camera(0, 0, 0, 0.7);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const f = forwardOf(0.7);
    expect(dir.x).toBeCloseTo(f.x, 6);
    expect(dir.z).toBeCloseTo(f.z, 6);
  });
});

describe("V2a: LOD, odcinanie i instancing dla profili jakości", () => {
  it("histereza LOD: brak migotania przy ruchu wokół progu i rozrzut progów między instancjami", async () => {
    const lib = diskLibrary("HIGH");
    const asset = await lib.load("tree.common.1");
    expect(asset.levels).toHaveLength(2);
    const t = asset.levels[1].minDistance;
    expect(chooseLevel(asset, t * 0.5, 1, 0, -1)).toBe(0);
    expect(chooseLevel(asset, t * 1.01, 1, 0, 0)).toBe(1);
    expect(chooseLevel(asset, t * 0.97, 1, 0, 1)).toBe(1);
    expect(chooseLevel(asset, t * (LOD_HYSTERESIS - 0.01), 1, 0, 1)).toBe(0);
    expect(chooseLevel(asset, t * 0.97, 1, 0, 0)).toBe(0);
    const levels = new Set([-1, -0.5, 0, 0.5, 1].map((j) => chooseLevel(asset, t * 1.05, 1, j, -1)));
    expect(levels.size).toBe(2);
    expect(forcedLevelIndex(asset, 0)).toBe(0);
    expect(forcedLevelIndex(asset, 1)).toBe(1);
    await lib.dispose();
  });

  it("wszystkie profile ładują prawdziwe GLB bez zastępników, a świat jest ten sam (zmienia się tylko widoczność)", async () => {
    const w = win();
    const cam = camera(w.start.x, 1.7, w.start.z, 0);
    const results: Record<string, ReturnType<ForestInstancer["update"]>> = {};
    for (const id of ["LOW", "MEDIUM", "HIGH"] as const) {
      const lib = diskLibrary(id);
      const inst = new ForestInstancer(lib, w, VIEW_PROFILES[id], DEFAULT_OVERRIDES);
      const { failed } = await inst.init();
      expect(failed, id).toEqual([]);
      results[id] = inst.update(cam);
      expect(results[id].total, id).toBe(w.instanceCount);
      expect(results[id].fallbackModels, id).toBe(0);
      expect(results[id].visible, id).toBeGreaterThan(100);
      expect(results[id].visible, id).toBeLessThanOrEqual(w.instanceCount);
      expect(results[id].activeModels, id).toBeGreaterThan(15);
      inst.dispose();
      await lib.dispose();
    }
    expect(results.LOW.triangles).toBeLessThan(results.HIGH.triangles);
    expect(results.LOW.visible).toBeLessThan(results.HIGH.visible);
  }, 60_000);

  it("wymuszenie LOD0 i LOD1 działa, a kolejne zmiany ustawień nie zgłaszają błędów", async () => {
    const w = win();
    const cam = camera(w.start.x, 1.7, w.start.z, 0.4);
    const lib = diskLibrary("HIGH");
    const inst = new ForestInstancer(lib, w, VIEW_PROFILES.HIGH, DEFAULT_OVERRIDES);
    await inst.init();
    const auto = inst.update(cam);
    expect(auto.perLevel[0]).toBeGreaterThan(0);
    expect(auto.perLevel[1]).toBeGreaterThan(0);
    const run = (o: Partial<ViewOverrides>) => {
      const next = { ...DEFAULT_OVERRIDES, ...o };
      inst.setOverrides(next);
      return inst.update(cam);
    };
    const l0 = run({ forceLod: 0 });
    expect(l0.perLevel[1]).toBe(0);
    expect(l0.triangles).toBeGreaterThan(auto.triangles);
    const l1 = run({ forceLod: 1 });
    expect(l1.perLevel[1]).toBeGreaterThan(auto.perLevel[1]);
    expect(l1.triangles).toBeLessThan(l0.triangles);
    const noShadow = run({ shadows: false });
    expect(noShadow.visible).toBeGreaterThan(0);
    run({ fog: false, wind: false, distanceScale: 2 });
    const back = run({});
    expect(back.visible).toBe(auto.visible);
    expect(Math.abs(back.triangles - auto.triangles) / auto.triangles).toBeLessThan(0.03);
    inst.dispose();
    await lib.dispose();
  }, 60_000);

  it("rzadzenie i zasięgi zależą od profilu: LOW pokazuje mniej instancji niż HIGH przy tym samym świecie", async () => {
    const w = win();
    const cam = camera(w.start.x, 1.7, w.start.z, 0);
    const count = async (id: QualityId) => {
      const lib = diskLibrary(id);
      const inst = new ForestInstancer(lib, w, VIEW_PROFILES[id], { ...DEFAULT_OVERRIDES, distanceScale: 3 });
      await inst.init();
      inst.update(cam);
      const total = inst.stats.visible;
      inst.dispose();
      await lib.dispose();
      return total;
    };
    const low = await count("LOW");
    const high = await count("HIGH");
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThan(0);
  }, 60_000);

  it("frustum culling ukrywa obiekty za plecami kamery, ale zostawia rzucające cień w zasięgu cieni", async () => {
    const w = win();
    const lib = diskLibrary("HIGH");
    const noShadowProfile = { ...VIEW_PROFILES.HIGH, shadows: { ...VIEW_PROFILES.HIGH.shadows, enabled: false } };
    const forward = camera(w.start.x, 1.7, w.start.z, 0);
    const a = new ForestInstancer(lib, w, noShadowProfile, DEFAULT_OVERRIDES);
    await a.init();
    const fw = a.update(forward).visible;
    const wide = a.update(camera(w.start.x, 1.7, w.start.z, 0, 4)).visible;
    expect(fw).toBeLessThan(wide);
    expect(fw).toBeLessThan(a.stats.total * 0.75);
    a.dispose();
    const b = new ForestInstancer(lib, w, VIEW_PROFILES.HIGH, DEFAULT_OVERRIDES);
    await b.init();
    const withShadows = b.update(forward);
    expect(withShadows.visible).toBeGreaterThan(fw);
    b.dispose();
    await lib.dispose();
  }, 60_000);
});

describe("V2a: grunt, woda, atmosfera, statystyki", () => {
  it("siatka gruntu leży na terenie W0, a woda tylko tam, gdzie rzeka przecina okno", () => {
    const w = win();
    const mesh = buildGroundMesh(w.forest.terrain, w.windowBounds, 1.5);
    expect(mesh.triangleCount).toBe(60 * 60 * 2);
    for (let k = 0; k < mesh.vertexCount; k += 37) {
      const x = mesh.positions[k * 3];
      const z = mesh.positions[k * 3 + 2];
      expect(mesh.positions[k * 3 + 1]).toBeCloseTo(w.forest.terrain.height(x, z), 4);
    }
    expect(buildWaterMesh(w.forest, w.windowBounds)).toBeNull();
    const east = buildForestWindow({ seed: DEFAULT_SEED, sector: { ix: 7, iz: 5 } });
    const water = buildWaterMesh(east.forest, east.windowBounds);
    expect(water).not.toBeNull();
    expect(water!.triangleCount).toBeGreaterThan(10);
  });

  it("tekstura gruntu jest deterministyczna, ma ścieżkę jaśniejszą i bardziej brązową niż trawa", () => {
    const w = win();
    const inputs = { forest: w.forest, bounds: w.windowBounds, objects: w.objects, size: 256 };
    const a = buildGroundTexture(inputs);
    const b = buildGroundTexture(inputs);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    const path = [0, 0, 0, 0];
    const grass = [0, 0, 0, 0];
    for (let j = 0; j < a.size; j++) {
      for (let i = 0; i < a.size; i++) {
        const x = w.windowBounds.minX + (i + 0.5) * a.metersPerPixel;
        const z = w.windowBounds.minZ + (j + 0.5) * a.metersPerPixel;
        const gap = w.forest.geometry.trailGap(x, z);
        const k = (j * a.size + i) * 4;
        const bucket = gap < -0.3 ? path : gap > 3 && w.forest.geometry.waterGap(x, z) > 6 ? grass : null;
        if (!bucket) continue;
        bucket[0] += a.data[k];
        bucket[1] += a.data[k + 1];
        bucket[2] += a.data[k + 2];
        bucket[3]++;
        expect(a.data[k + 3]).toBe(255);
      }
    }
    expect(path[3]).toBeGreaterThan(200);
    expect(grass[3]).toBeGreaterThan(2000);
    const p = path.slice(0, 3).map((v) => v / path[3]);
    const g = grass.slice(0, 3).map((v) => v / grass[3]);
    expect(p[0]).toBeGreaterThan(g[0] + 30);
    expect(g[1]).toBeGreaterThan(g[0]);
  });

  it("atmosfera zmienia się płynnie przez dobę, dzień jest jaśniejszy od nocy, a kierunek słońca jest jednostkowy", () => {
    let prev = atmosphereAt(0);
    for (let h = 0.1; h <= 24; h += 0.1) {
      const a = atmosphereAt(h);
      expect(Math.hypot(...a.sunDir)).toBeCloseTo(1, 6);
      expect(a.sunDir[1]).toBeGreaterThan(0);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(a.fogColor[k] - prev.fogColor[k])).toBeLessThan(0.12);
        expect(Math.abs(a.skyZenith[k] - prev.skyZenith[k])).toBeLessThan(0.12);
      }
      expect(Math.abs(a.sunIntensity - prev.sunIntensity)).toBeLessThan(0.7);
      prev = a;
    }
    expect(atmosphereAt(12).sunIntensity).toBeGreaterThan(atmosphereAt(2).sunIntensity * 3);
    expect(atmosphereAt(12).daylight).toBe(1);
    expect(atmosphereAt(1).daylight).toBe(0);
    expect(sunElevationDeg(12)).toBeGreaterThan(50);
    expect(sunElevationDeg(0)).toBeLessThan(0);
    expect(atmosphereAt(24).hour).toBe(0);
  });

  it("statystyki klatek: bieżący i średni FPS, percentyle", () => {
    const s = new FrameStats(0.5, true);
    for (let i = 0; i < 60; i++) s.push(1000 / 60);
    for (let i = 0; i < 5; i++) s.push(50);
    s.push(NaN);
    s.push(-1);
    expect(s.frameCount).toBe(65);
    expect(s.currentFps).toBeLessThan(60);
    expect(s.averageFps).toBeGreaterThan(40);
    expect(s.averageFps).toBeLessThan(60);
    const sum = s.summary();
    expect(sum.maxMs).toBe(50);
    expect(sum.medianMs).toBeCloseTo(1000 / 60, 3);
    expect(sum.onePercentLowFps).toBeCloseTo(20, 3);
    s.reset();
    expect(s.averageFps).toBe(0);
  });

  it("profile jakości mają rosnące zasięgi i szczegółowość, a nie zmieniają układu świata", () => {
    const { LOW, MEDIUM, HIGH } = VIEW_PROFILES;
    for (const kind of Object.keys(LOW.distance) as (keyof typeof LOW.distance)[]) {
      expect(LOW.distance[kind]).toBeLessThan(MEDIUM.distance[kind]);
      expect(MEDIUM.distance[kind]).toBeLessThan(HIGH.distance[kind]);
    }
    expect(LOW.shadows.enabled).toBe(false);
    expect(HIGH.shadows.distance).toBeGreaterThan(MEDIUM.shadows.distance);
    expect(HIGH.shadows.mapSize).toBeGreaterThan(MEDIUM.shadows.mapSize);
    expect(LOW.assets.decorDensity).toBeLessThan(HIGH.assets.decorDensity);
    expect(HIGH.groundTexture).toBeGreaterThan(LOW.groundTexture);
    expect(LOW.renderScale).toBeLessThan(HIGH.renderScale);
  });

  it("trasa testu FPS leży w strefie chodzenia i jest ciągła", () => {
    const w = win();
    const route = buildBenchmarkRoute(w);
    expect(route.length).toBeGreaterThan(8);
    let prev = benchmarkPose(route, 0);
    for (let t = 0.1; t <= BENCHMARK_SECONDS; t += 0.1) {
      const p = benchmarkPose(route, t);
      expect(p.x).toBeGreaterThan(w.walkBounds.minX);
      expect(p.x).toBeLessThan(w.walkBounds.maxX);
      expect(p.z).toBeGreaterThan(w.walkBounds.minZ);
      expect(p.z).toBeLessThan(w.walkBounds.maxZ);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(0.5);
      prev = p;
    }
    const first = benchmarkPose(route, 0);
    expect(w.walk.isWalkable(first.x, first.z)).toBe(true);
  });
});
