import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../game/core/rng";
import { MODELS } from "../../../scripts/assets/config.mjs";
import {
  AssetLibrary, AssetLoadError, ManifestError, QUALITY_PROFILES, composePlacementMatrix, createInstancedModel, indexManifest,
  instancedCost, parseManifest, pickLodIndex, pickRock, placementCollider, type AssetManifest, type Placement,
} from "./index";

const MODELS_DIR = path.resolve(__dirname, "../../../public/models");
const raw = JSON.parse(fs.readFileSync(path.join(MODELS_DIR, "manifest.json"), "utf8"));
const manifest: AssetManifest = parseManifest(raw);
const idx = indexManifest(manifest);

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function diskLibrary(profile = QUALITY_PROFILES.HIGH, extra: Partial<ConstructorParameters<typeof AssetLibrary>[0]> = {}) {
  const requested: string[] = [];
  const lib = new AssetLibrary({
    profile,
    baseUrl: "/models",
    loadManifestJson: async () => raw,
    loadGlb: async (url) => {
      const file = path.join(MODELS_DIR, url.replace(/^\/models\//, ""));
      const buf = fs.readFileSync(file);
      return gltfLoader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
    },
    loadTexture: async (url) => {
      requested.push(url);
      expect(fs.existsSync(path.join(MODELS_DIR, url.replace(/^\/models\//, "")))).toBe(true);
      return new THREE.Texture();
    },
    ...extra,
  });
  return { lib, requested };
}

describe("manifest zasobów: kompletność i pliki", () => {
  it("jest poprawny strukturalnie i referencyjnie", () => {
    expect(manifest.models.length).toBe(MODELS.length);
    expect(manifest.totals.models).toBe(manifest.models.length);
  });

  it("lista modeli w konfiguracji potoku = wpisy w manifeście (każdy używany model jest w manifeście)", () => {
    expect(manifest.models.map((m) => m.id)).toEqual(MODELS.map((m: { id: string }) => m.id));
  });

  it("wszystkie pliki GLB, LOD, tekstury i tekst licencji istnieją, a rozmiary się zgadzają", () => {
    let glb = 0;
    for (const m of manifest.models) {
      for (const l of m.lod) {
        const p = path.join(MODELS_DIR, l.file);
        expect(fs.existsSync(p), l.file).toBe(true);
        expect(fs.statSync(p).size, l.file).toBe(l.bytes);
        glb += l.bytes;
      }
    }
    expect(glb).toBe(manifest.totals.glbBytes);
    for (const t of manifest.textures) {
      for (const v of [t.full, t.low]) {
        expect(fs.statSync(path.join(MODELS_DIR, v.file)).size, v.file).toBe(v.bytes);
      }
    }
    for (const p of manifest.packs) expect(fs.existsSync(path.join(MODELS_DIR, p.license.textFile))).toBe(true);
  });

  it("w katalogu nie ma plików spoza manifestu (brak osieroconych i brak oryginałów w bundlu)", () => {
    const listed = new Set<string>(["manifest.json"]);
    manifest.models.forEach((m) => m.lod.forEach((l) => listed.add(l.file)));
    manifest.textures.forEach((t) => (listed.add(t.full.file), listed.add(t.low.file)));
    manifest.packs.forEach((p) => listed.add(p.license.textFile));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else found.push(path.relative(MODELS_DIR, full).split(path.sep).join("/"));
      }
    };
    walk(MODELS_DIR);
    expect(found.filter((f) => !listed.has(f))).toEqual([]);
    expect(found.some((f) => /\.(gltf|bin|png|fbx|obj)$/i.test(f))).toBe(false);
  });

  it("licencje: CC0, autor, źródło i atrybucja zapisane; brak placeholderów; paczka zatwierdzona", () => {
    for (const p of manifest.packs) {
      expect(p.license.id).toBe("CC0-1.0");
      expect(p.sourceUrl).toMatch(/^https:\/\//);
      expect(p.approval.length).toBeGreaterThan(10);
      const license = fs.readFileSync(path.join(MODELS_DIR, p.license.textFile), "utf8");
      expect(license).toContain("CC0 1.0");
    }
    for (const m of manifest.models) {
      expect(m.license, m.id).toBe("CC0-1.0");
      expect(m.author, m.id).toBe("Quaternius");
      expect(m.placeholder, m.id).toBe(false);
      expect(m.approvedAt, m.id).not.toBeNull();
      expect(m.attribution.length, m.id).toBeGreaterThan(5);
    }
  });

  it("zawiera komplet kategorii wymaganych przez prototyp lasu", () => {
    const by = (c: string) => manifest.models.filter((m) => m.category === c);
    expect(by("tree").length).toBeGreaterThanOrEqual(3);
    expect(new Set(by("tree").map((m) => m.subcategory)).size).toBeGreaterThanOrEqual(3);
    expect(by("undergrowth").length).toBeGreaterThanOrEqual(4);
    expect(manifest.models.some((m) => m.subcategory === "fern")).toBe(true);
    expect(by("bush").length).toBeGreaterThanOrEqual(2);
    expect(by("grass").length).toBeGreaterThanOrEqual(2);
    expect(by("rock").length).toBeGreaterThanOrEqual(3);
  });

  it("budżety: materiały, tekstury, rozmiar i trójkąty", () => {
    expect(manifest.materials.length).toBeLessThanOrEqual(12);
    expect(manifest.textures.length).toBeLessThanOrEqual(14);
    expect(manifest.totals.totalBytesFull).toBeLessThan(4 * 1024 * 1024);
    for (const t of manifest.textures) {
      expect(Math.max(t.full.width, t.full.height)).toBeLessThanOrEqual(1024);
      expect(Math.max(t.low.width, t.low.height)).toBeLessThanOrEqual(512);
    }
    for (const m of manifest.models) {
      expect(m.triangles, m.id).toBeLessThanOrEqual(10_500);
      expect(m.drawCalls, m.id).toBeLessThanOrEqual(2);
    }
  });

  it("kolizje drzew są mniejsze niż korona, a rozsądne względem pnia; LOD1 jest lżejszy", () => {
    for (const m of manifest.models.filter((x) => x.category === "tree")) {
      expect(m.collision, m.id).not.toBeNull();
      expect(m.collision!.r, m.id).toBeGreaterThan(0.1);
      expect(m.collision!.r, m.id).toBeLessThan(1.5);
      expect(m.lod.length, m.id).toBe(2);
      expect(m.lod[1].triangles, m.id).toBeLessThan(m.lod[0].triangles);
    }
    for (const m of manifest.models.filter((x) => x.category === "rock")) expect(m.collision!.r).toBeGreaterThan(0.5);
    for (const m of manifest.models.filter((x) => ["grass", "flower", "undergrowth", "bush"].includes(x.category))) {
      expect(m.collision, m.id).toBeNull();
    }
  });
});

describe("walidator manifestu odrzuca błędy", () => {
  const clone = () => JSON.parse(JSON.stringify(raw));
  it.each([
    ["brak licencji paczki", (m: AssetManifest) => void ((m.packs[0] as { license?: unknown }).license = undefined)],
    ["brak trójkątów", (m: AssetManifest) => void (m.models[0].triangles = 0)],
    ["duplikat id", (m: AssetManifest) => void (m.models[1].id = m.models[0].id)],
    ["nieznany materiał", (m: AssetManifest) => void (m.models[0].materials = ["nie-ma"])],
    ["nieznana tekstura", (m: AssetManifest) => void (m.materials[0].albedo = "nie-ma")],
    ["brak flagi placeholder", (m: AssetManifest) => void delete (m.models[0] as Partial<typeof m.models[0]>).placeholder],
    ["LOD1 cięższy od LOD0", (m: AssetManifest) => void (m.models[0].lod[1].triangles = 999_999)],
    ["zła wersja schematu", (m: AssetManifest) => void ((m as { schemaVersion: number }).schemaVersion = 2)],
  ])("%s", (_name, mutate) => {
    const m = clone();
    mutate(m);
    expect(() => parseManifest(m)).toThrow(ManifestError);
  });
});

describe("ładowanie modeli (prawdziwe pliki GLB przez GLTFLoader + meshopt)", () => {
  it("ładuje wszystkie modele; geometria zgadza się z manifestem", async () => {
    const { lib } = diskLibrary();
    const report = await lib.preload();
    expect(report.failed).toEqual([]);
    expect(report.loaded.length).toBe(manifest.models.length);
    for (const entry of manifest.models) {
      const asset = lib.getLoaded(entry.id)!;
      expect(asset.fallback).toBe(false);
      expect(asset.levels.length).toBe(entry.lod.length);
      asset.levels.forEach((lod, i) => {
        expect(lod.triangles, `${entry.id} lod${i}`).toBe(entry.lod[i].triangles);
        expect(lod.parts.length).toBe(entry.lod[i].drawCalls);
      });
      const box = new THREE.Box3();
      for (const part of asset.levels[0].parts) box.union(part.geometry.boundingBox!);
      const size = box.getSize(new THREE.Vector3());
      entry.bounds.size.forEach((expected, k) => {
        expect(Math.abs(size.getComponent(k) - expected) / expected, `${entry.id} oś ${k}`).toBeLessThan(0.02);
      });
      for (const part of asset.levels[0].parts) {
        expect(part.geometry.getAttribute("position").array).toBeInstanceOf(Float32Array);
        expect(part.geometry.getAttribute("uv")).toBeDefined();
        expect(entry.materials).toContain(part.materialId);
      }
    }
  });

  it("materiały i geometrie są współdzielone; liczba materiałów = liczba z manifestu", async () => {
    const { lib } = diskLibrary();
    await lib.preload();
    const stats = lib.stats();
    expect(stats.materials).toBe(manifest.materials.length);
    expect(stats.textures).toBeLessThanOrEqual(manifest.textures.length);
    expect(stats.models).toBe(manifest.models.length);
    const a = lib.getLoaded("tree.common.1")!.levels[0].parts.find((p) => p.materialId === "leaves_normaltree")!;
    const b = lib.getLoaded("tree.common.2")!.levels[0].parts.find((p) => p.materialId === "leaves_normaltree")!;
    expect(a.material).toBe(b.material);
    expect(a.geometry).not.toBe(b.geometry);
  });

  it("cache: powtórne load zwraca ten sam obiekt i nie ładuje ponownie", async () => {
    let glbCalls = 0;
    const base = diskLibrary().lib;
    void base;
    const { lib } = diskLibrary(QUALITY_PROFILES.HIGH, {
      loadGlb: async (url) => {
        glbCalls++;
        const buf = fs.readFileSync(path.join(MODELS_DIR, url.replace(/^\/models\//, "")));
        return gltfLoader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
      },
    });
    const [a, b] = await Promise.all([lib.load("rock.medium.1"), lib.load("rock.medium.1")]);
    expect(a).toBe(b);
    await lib.load("rock.medium.1");
    expect(glbCalls).toBe(1);
  });

  it("profile: LOW ładuje tylko LOD1 drzew, tekstury 512 px i brak normalnych; HIGH ładuje normalne i LOD0+LOD1", async () => {
    const low = diskLibrary(QUALITY_PROFILES.LOW);
    const treeLow = await low.lib.load("tree.common.1");
    expect(treeLow.levels.map((l) => l.level)).toEqual([1]);
    expect(low.requested.length).toBeGreaterThan(0);
    expect(low.requested.every((u) => u.endsWith(".512.webp"))).toBe(true);
    expect(low.requested.some((u) => u.includes("_normal.512"))).toBe(false);
    const rockLow = await low.lib.load("rock.medium.1");
    expect(rockLow.levels.map((l) => l.level)).toEqual([0]);
    expect(rockLow.levels[0].parts[0].material).toBeInstanceOf(THREE.MeshLambertMaterial);

    const high = diskLibrary(QUALITY_PROFILES.HIGH);
    const treeHigh = await high.lib.load("tree.common.1");
    expect(treeHigh.levels.map((l) => l.level)).toEqual([0, 1]);
    expect(high.requested.some((u) => u.includes("bark_normaltree_normal.webp"))).toBe(true);
    const bark = treeHigh.levels[0].parts.find((p) => p.materialId === "bark_normaltree")!.material as THREE.MeshStandardMaterial;
    expect(bark.normalMap).not.toBeNull();
    expect(bark.vertexColors).toBe(true);
    const leaves = treeHigh.levels[0].parts.find((p) => p.materialId === "leaves_normaltree")!.material as THREE.MeshStandardMaterial;
    expect(leaves.alphaTest).toBeCloseTo(0.2);
    expect(leaves.side).toBe(THREE.DoubleSide);
    expect(leaves.alphaToCoverage).toBe(true);
    expect(leaves.map!.flipY).toBe(false);
    expect(leaves.map!.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("obsługa błędów: brak modelu, uszkodzony GLB, brak tekstury, brak manifestu; ponowienie po błędzie", async () => {
    const errors: AssetLoadError[] = [];
    const { lib } = diskLibrary(QUALITY_PROFILES.HIGH, { onError: (e) => errors.push(e) });
    await expect(lib.load("nie.istnieje")).rejects.toMatchObject({ kind: "model", assetId: "nie.istnieje" });

    let broken = true;
    const { lib: flaky } = diskLibrary(QUALITY_PROFILES.HIGH, {
      onError: (e) => errors.push(e),
      loadGlb: async (url) => {
        if (broken) throw new Error("sieć");
        const buf = fs.readFileSync(path.join(MODELS_DIR, url.replace(/^\/models\//, "")));
        return gltfLoader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
      },
    });
    await expect(flaky.load("rock.medium.2")).rejects.toBeInstanceOf(AssetLoadError);
    const fallback = await flaky.loadOrFallback("rock.medium.2");
    expect(fallback.fallback).toBe(true);
    expect(fallback.levels[0].triangles).toBeGreaterThan(0);
    expect(flaky.stats().fallbackModels).toBe(1);
    expect(flaky.loadOrFallback("rock.medium.2")).toBe(flaky.loadOrFallback("rock.medium.2"));
    broken = false;
    const real = await flaky.load("rock.medium.2");
    expect(real.fallback).toBe(false);

    const { lib: texFail } = diskLibrary(QUALITY_PROFILES.HIGH, { loadTexture: async () => { throw new Error("404"); } });
    await expect(texFail.load("rock.medium.1")).rejects.toMatchObject({ kind: "texture" });

    const { lib: noManifest } = diskLibrary(QUALITY_PROFILES.HIGH, { loadManifestJson: async () => { throw new Error("HTTP 404"); } });
    await expect(noManifest.load("rock.medium.1")).rejects.toMatchObject({ kind: "manifest" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("dispose zwalnia cache", async () => {
    const { lib } = diskLibrary();
    await lib.load("bush.common");
    await lib.dispose();
    expect(lib.stats().models).toBe(0);
  });
});

describe("instancing", () => {
  function scatter(n: number, seed = 1): Placement[] {
    const rnd = mulberry32(seed);
    return Array.from({ length: n }, () => ({ x: (rnd() - 0.5) * 200, y: 0, z: (rnd() - 0.5) * 200, yaw: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.6 }));
  }

  it("1000 drzew = tyle InstancedMesh co części modelu, bez kopii geometrii i materiałów", async () => {
    const { lib } = diskLibrary();
    const asset = await lib.load("tree.pine.1");
    const placements = scatter(1000);
    const inst = createInstancedModel(asset, placements, { profile: QUALITY_PROFILES.HIGH });
    const meshes = inst.group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBe(asset.levels.reduce((a, l) => a + l.parts.length, 0));
    for (const mesh of meshes) {
      const part = asset.levels.flatMap((l) => l.parts).find((p) => p.geometry === mesh.geometry);
      expect(part, "geometria współdzielona").toBeDefined();
      expect(mesh.material).toBe(part!.material);
    }
    expect(inst.counts()).toEqual([1000, 0]);
    expect(instancedCost(asset, inst.counts())).toEqual({ triangles: asset.levels[0].triangles * 1000, drawCalls: 2 });
    inst.dispose();
  });

  it("updateLods przydziela instancje wg odległości i zachowuje liczbę", async () => {
    const { lib } = diskLibrary();
    const asset = await lib.load("tree.common.3");
    const placements = scatter(600, 7);
    const inst = createInstancedModel(asset, placements, { profile: QUALITY_PROFILES.HIGH });
    inst.updateLods(new THREE.Vector3(0, 1.7, 0));
    const [near, far] = inst.counts();
    expect(near + far).toBe(600);
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(0);
    const expectedFar = placements.filter((p) => Math.hypot(p.x, p.y - 1.7, p.z) >= asset.levels[1].minDistance).length;
    expect(far).toBe(expectedFar);
    const cost = instancedCost(asset, inst.counts());
    expect(cost.triangles).toBe(near * asset.levels[0].triangles + far * asset.levels[1].triangles);
    expect(cost.triangles).toBeLessThan(600 * asset.levels[0].triangles);
    const lowMed = pickLodIndex(asset, 20, QUALITY_PROFILES.LOW);
    expect(lowMed).toBe(1);
    inst.dispose();
  });

  it("macierz instancji uwzględnia pozycję, obrót, skalę osi i pochylenie", () => {
    const m = composePlacementMatrix(new THREE.Matrix4(), { x: 1, y: 2, z: 3, yaw: Math.PI / 2, scale: [1, 2, 1] });
    const p = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(1, 5);
    expect(p.z).toBeCloseTo(2, 5);
    expect(new THREE.Vector3(0, 1, 0).applyMatrix4(m).y).toBeCloseTo(4, 5);
  });
});

describe("skały S/M/L (wariant A) i kolizje", () => {
  it("klasy mają rosnące rozmiary, ograniczoną zmienność proporcji i są powtarzalne dla ziarna", () => {
    const cfg = manifest.scaleClasses.rock;
    const sample = (cls: "s" | "m" | "l", seed: number, n = 200) => {
      const rnd = mulberry32(seed);
      return Array.from({ length: n }, () => pickRock(manifest, cls, rnd));
    };
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const avg = (cls: "s" | "m" | "l") => mean(sample(cls, 3).map((p) => (p.scale[0] + p.scale[1] + p.scale[2]) / 3));
    expect(avg("s")).toBeLessThan(avg("m"));
    expect(avg("m")).toBeLessThan(avg("l"));
    for (const cls of ["s", "m", "l"] as const) {
      const [lo, hi] = cfg.classes[cls].scale;
      for (const p of sample(cls, 11)) {
        const base = (p.scale[0] + p.scale[1] + p.scale[2]) / 3;
        expect(base).toBeGreaterThan(lo * 0.8);
        expect(base).toBeLessThan(hi * 1.2);
        expect(p.scale[0] / p.scale[2]).toBeLessThan((1 + cfg.proportionJitter.x) / (1 - cfg.proportionJitter.z) + 1e-9);
        expect(p.scale[1] / p.scale[0]).toBeLessThan(1.5);
        expect(cfg.appliesTo).toContain(p.modelId);
        expect(Math.abs(p.tiltX)).toBeLessThanOrEqual(cfg.maxTiltRad);
      }
    }
    expect(sample("m", 5)).toEqual(sample("m", 5));
    expect(new Set(sample("l", 9).map((p) => p.modelId)).size).toBe(3);
    expect(cfg.classes.s.harvestHint).toBe(1);
    expect(cfg.classes.m.harvestHint).toBe(2);
    expect(cfg.classes.l.harvestHint).toBe(5);
  });

  it("placementCollider skaluje promień z modelu i zwraca null dla roślin", () => {
    const tree = idx.model.get("tree.common.1")!;
    expect(placementCollider(tree, 2)!.r).toBeCloseTo(tree.collision!.r * 2);
    const rock = idx.model.get("rock.medium.1")!;
    expect(placementCollider(rock, [2, 5, 4])!.r).toBeCloseTo(rock.collision!.r * 3);
    expect(placementCollider(idx.model.get("grass.common_short")!)).toBeNull();
  });
});
