import { createHash } from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTestTroll } from "@/lib/npc/testkit";
import { CharacterLoadError, loadTrollAsset, sceneNodeName, TROLL_ID, TROLL_REQUIRED_CLIPS, type CharactersManifest, type TrollAsset } from "./characters";
import { parseWithoutTextures, publicDir, readGlbDocument, readJsonFile } from "./glbTestkit";

const manifest = () => readJsonFile(publicDir("characters/characters.json")) as CharactersManifest;
const entry = () => manifest().characters.find((c) => c.id === TROLL_ID)!;
const approxTextureBytes = (sizes: number[][]) => sizes.reduce((n, [w, h]) => n + w * h * 4 * (4 / 3), 0);

let asset: TrollAsset;
beforeAll(async () => {
  asset = await loadTestTroll();
});

describe("troll: struktura plików GLB", () => {
  it("źródło: 22 siatki, 22 materiały, 66 tekstur, 13299 trójkątów, szkielet 65 kości i 7 animacji (Walk, Idle, Nervous, Surprised, Happy, Dance, Angry)", async () => {
    const doc = await readGlbDocument(entry().source.file);
    const root = doc.getRoot();
    expect(root.listMeshes()).toHaveLength(22);
    expect(root.listMaterials()).toHaveLength(22);
    expect(root.listTextures()).toHaveLength(66);
    const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices()!.getCount() / 3, 0), 0);
    expect(tris).toBe(13299);
    expect(root.listSkins()).toHaveLength(1);
    expect(root.listSkins()[0].listJoints()).toHaveLength(65);
    const clips = Object.fromEntries(root.listAnimations().map((a) => [a.getName(), Math.max(...a.listSamplers().map((s) => s.getInput()!.getMax([])[0]))]));
    expect(Object.keys(clips).sort()).toEqual([...TROLL_REQUIRED_CLIPS].sort());
    expect(clips.Walk).toBeCloseTo(1.433, 2);
    expect(clips.Idle).toBeCloseTo(4.033, 2);
    expect(clips.Nervous).toBeCloseTo(7.033, 2);
    expect(clips.Surprised).toBeCloseTo(4.033, 2);
    expect(clips.Happy).toBeCloseTo(3.633, 2);
    expect(clips.Dance).toBeCloseTo(14.767, 2);
    expect(clips.Angry).toBeCloseTo(3.3, 2);
  });

  it("manifest zgadza się z plikiem i z oryginałem (rozmiar, SHA-256); oryginał zostaje w assets/source", () => {
    const e = entry();
    expect(fs.statSync(publicDir("characters", e.file)).size).toBe(e.bytes);
    const src = fs.readFileSync(e.source.file);
    expect(src.length).toBe(e.source.bytes);
    expect(e.source.sha256).toBe(createHash("sha256").update(src).digest("hex"));
    expect(e.triangles).toBe(13299);
    expect(e.bones).toBe(65);
  });

  it("wariant gry: jedna siatka ze skórą, jeden materiał, trzy atlasy WebP; trójkąty, kości i animacje bez zmian", async () => {
    const e = entry();
    const game = (await readGlbDocument(publicDir("characters", e.file))).getRoot();
    const src = (await readGlbDocument(e.source.file)).getRoot();
    expect(game.listMeshes()).toHaveLength(1);
    expect(game.listMeshes()[0].listPrimitives()).toHaveLength(1);
    expect(game.listMaterials()).toHaveLength(1);
    expect(game.listTextures()).toHaveLength(3);
    for (const t of game.listTextures()) {
      expect(t.getMimeType()).toBe("image/webp");
      expect(t.getSize()).toEqual([2048, 2048]);
    }
    const tris = game.listMeshes()[0].listPrimitives()[0].getIndices()!.getCount() / 3;
    expect(tris).toBe(13299);
    const jointNames = (r: typeof game) => r.listSkins()[0].listJoints().map((j) => j.getName());
    expect(jointNames(game)).toEqual(jointNames(src));
    const nodeNames = (r: typeof game) => r.listNodes().map((n) => n.getName()).filter((n) => n.startsWith("mixamorig") || n === "Troll_Rig").sort();
    expect(nodeNames(game)).toEqual(nodeNames(src));
    // Animacje: te same klipy, kanały i próbki co do wartości (optymalizacja nie dotyka ani kości, ani animacji).
    const channels = (r: typeof game) =>
      r.listAnimations().map((a) => ({
        name: a.getName(),
        channels: a
          .listChannels()
          .map((c) => `${c.getTargetNode()!.getName()}.${c.getTargetPath()}`)
          .sort(),
        data: a
          .listChannels()
          .sort((x, y) => `${x.getTargetNode()!.getName()}.${x.getTargetPath()}`.localeCompare(`${y.getTargetNode()!.getName()}.${y.getTargetPath()}`))
          .map((c) => [Array.from(c.getSampler()!.getInput()!.getArray()!), Array.from(c.getSampler()!.getOutput()!.getArray()!)]),
      }));
    const a = channels(game);
    const b = channels(src);
    expect(a.map((x) => x.name)).toEqual(b.map((x) => x.name));
    for (let i = 0; i < a.length; i++) {
      expect(a[i].channels).toEqual(b[i].channels);
      expect(a[i].data).toEqual(b[i].data);
    }
  });

  it("UV po scaleniu leżą w [0, 1] i w całości w obrębie atlasu, a wagi skóry są znormalizowane", async () => {
    const prim = (await readGlbDocument(publicDir("characters", entry().file))).getRoot().listMeshes()[0].listPrimitives()[0];
    const uv = prim.getAttribute("TEXCOORD_0")!.getArray()!;
    expect(Math.min(...uv)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uv)).toBeLessThanOrEqual(1);
    const w = prim.getAttribute("WEIGHTS_0")!.getArray()!;
    for (let i = 0; i < w.length; i += 4 * 97) expect(w[i] + w[i + 1] + w[i + 2] + w[i + 3]).toBeCloseTo(1, 2);
    expect(entry().atlas.rowsUsed).toBeLessThanOrEqual(2048);
  });
});

describe("troll: koszt renderowania i oświetlenie", () => {
  it("22 materiały / 66 tekstur zredukowane do 1 materiału / 3 tekstur, pamięć tekstur w tym samym rzędzie wielkości", async () => {
    const e = entry();
    const src = (await readGlbDocument(e.source.file)).getRoot();
    const before = approxTextureBytes(src.listTextures().map((t) => t.getSize()!));
    const after = approxTextureBytes([[2048, 2048], [2048, 2048], [2048, 2048]]);
    expect(e.optimisation.before).toEqual({ meshes: 22, materials: 22, textures: 66 });
    expect(e.optimisation.after).toEqual({ meshes: 1, materials: 1, textures: 3 });
    expect(after / before).toBeLessThan(1.35);
    expect(fs.statSync(publicDir("characters", e.file)).size).toBeLessThan(e.source.bytes / 2);
  });

  it("załadowany model ma jedną siatkę ze skórą i jeden materiał standardowy (jedno wywołanie rysowania, jeden skinning)", () => {
    const skinned: THREE.SkinnedMesh[] = [];
    asset.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    expect(skinned).toHaveLength(1);
    expect(skinned[0].skeleton.bones).toHaveLength(65);
    expect(Array.isArray(skinned[0].material)).toBe(false);
    expect((skinned[0].material as THREE.Material).type).toBe("MeshStandardMaterial");
    expect(asset.triangles).toBe(13299);
  });

  it("oświetlenie MIASTO_DEFAULT (bez mapy otoczenia): materiał jest niemetaliczny, a albedo ma umiarkowaną jasność", async () => {
    const doc = (await readGlbDocument(publicDir("characters", entry().file))).getRoot();
    const material = doc.listMaterials()[0];
    const stats = async (texture: ReturnType<typeof material.getBaseColorTexture>) => sharp(Buffer.from(texture!.getImage()!)).stats();
    const mr = await stats(material.getMetallicRoughnessTexture());
    const base = await stats(material.getBaseColorTexture());
    // Kanał B = metaliczność: bez mapy otoczenia metal wyglądałby jak czarna plama, więc musi być prawie zerowy.
    expect(mr.channels[2].mean / 255).toBeLessThan(0.05);
    // Kanał G = chropowatość (pole poza kafelkami ma wartość neutralną).
    expect(mr.channels[1].mean / 255).toBeGreaterThan(0.15);
    const luminance = (0.2126 * base.channels[0].mean + 0.7152 * base.channels[1].mean + 0.0722 * base.channels[2].mean) / 255;
    expect(luminance).toBeGreaterThan(0.25);
    expect(luminance).toBeLessThan(0.7);
    expect(material.getMetallicFactor()).toBe(1);
    expect(material.getRoughnessFactor()).toBe(1);
  });
});

describe("troll: ładowanie przez GLTFLoader i system zasobów", () => {
  it("skala daje 2,7 m wysokości w pozie wiązania", () => {
    expect(asset.scale).toBeCloseTo(2.7 / entry().sourceHeight, 6);
    asset.scene.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(asset.scene, true).getSize(new THREE.Vector3());
    expect(size.y * asset.scale).toBeGreaterThan(2.6);
    expect(size.y * asset.scale).toBeLessThan(2.8);
  });

  it("wszystkie 7 klipów z pliku jest załadowanych, z czasami zgodnymi z manifestem; nie ma klipu Talk", () => {
    expect(asset.clips.map((c) => c.name).sort()).toEqual([...TROLL_REQUIRED_CLIPS].sort());
    for (const c of entry().clips) expect(asset.clips.find((x) => x.name === c.name)!.duration).toBeCloseTo(c.duration, 2);
    expect(asset.clips.some((c) => /talk/i.test(c.name))).toBe(false);
    expect(asset.scene.getObjectByName(sceneNodeName("mixamorig:Hips"))).toBeDefined();
  });

  it("brak wpisu, pliku, kości albo animacji to czytelny błąd", async () => {
    const readJson = async (url: string) => readJsonFile(publicDir(url.replace(/^\//, "")));
    const readGlb = (url: string) => parseWithoutTextures(publicDir(url.replace(/^\//, "")));
    await expect(loadTrollAsset({ loadJson: async () => ({ schemaVersion: 1, characters: [] }), loadGlb: readGlb })).rejects.toBeInstanceOf(CharacterLoadError);
    await expect(loadTrollAsset({ loadJson: readJson, loadGlb: async () => Promise.reject(new Error("sieć")) })).rejects.toThrow(/troll\.forest/);
    const bad = (await readJson("/characters/characters.json")) as CharactersManifest;
    bad.characters[0].hipsBone = "mixamorig:Nie_Ma";
    await expect(loadTrollAsset({ loadJson: async () => bad, loadGlb: readGlb })).rejects.toThrow(/Nie_Ma/);
    await expect(
      loadTrollAsset({
        loadJson: readJson,
        loadGlb: async (url) => {
          const g = await readGlb(url);
          return { scene: g.scene, animations: g.animations.filter((c) => c.name !== "Angry") };
        },
      }),
    ).rejects.toThrow(/Angry/);
  });
});
