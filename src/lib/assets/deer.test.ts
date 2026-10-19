import { createHash } from "node:crypto";
import fs from "node:fs";
import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDeerAnimations } from "@/lib/npc/deer";
import { HeadRig } from "@/lib/npc/headRig";
import { boneCentroid, headHeading, loadTestDeer } from "@/lib/npc/testkit";
import { CharacterLoadError, DEER_ID, DEER_WALK_CLIP, loadDeerAsset, sceneNodeName, type CharactersManifest, type DeerAsset, type DeerEntry } from "./characters";
import { parseWithoutTextures, publicDir, readGlbDocument, readJsonFile } from "./glbTestkit";

const manifest = () => readJsonFile(publicDir("characters/characters.json")) as CharactersManifest;
const entry = () => manifest().characters.find((c) => c.id === DEER_ID)! as DeerEntry;

let asset: DeerAsset;
beforeAll(async () => {
  asset = await loadTestDeer();
});

describe("jeleń: struktura plików GLB", () => {
  it("źródło: jedna siatka ze skórą (19 798 trójkątów), jeden materiał, trzy tekstury JPEG 1024, 41 kości i jedna animacja Walk", async () => {
    const root = (await readGlbDocument(entry().source.file)).getRoot();
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listMaterials()).toHaveLength(1);
    expect(root.listTextures()).toHaveLength(3);
    for (const t of root.listTextures()) {
      expect(t.getMimeType()).toBe("image/jpeg");
      expect(t.getSize()).toEqual([1024, 1024]);
    }
    const tris = root.listMeshes()[0].listPrimitives().reduce((n, p) => n + p.getIndices()!.getCount() / 3, 0);
    expect(tris).toBe(19798);
    expect(root.listSkins()[0].listJoints()).toHaveLength(41);
    const anims = root.listAnimations();
    expect(anims.map((a) => a.getName())).toEqual([DEER_WALK_CLIP]);
    expect(anims[0].listChannels()).toHaveLength(123);
    expect(Math.max(...anims[0].listSamplers().map((s) => s.getInput()!.getMax([])[0]))).toBeCloseTo(2.583, 2);
  });

  it("manifest zgadza się z plikiem i z oryginałem (rozmiar, SHA-256); oryginał zostaje w assets/source", () => {
    const e = entry();
    expect(fs.statSync(publicDir("characters", e.file)).size).toBe(e.bytes);
    const src = fs.readFileSync(e.source.file);
    expect(src.length).toBe(e.source.bytes);
    expect(e.source.sha256).toBe(createHash("sha256").update(src).digest("hex"));
    expect(e.triangles).toBe(19798);
    expect(e.bones).toBe(41);
    expect(e.forward).toBe("-x");
    expect(e.clips.map((c) => c.name)).toEqual([DEER_WALK_CLIP]);
    expect(e.targetHeight).toBeGreaterThan(1.5);
    expect(e.targetHeight).toBeLessThan(2.2);
  });

  it("wariant gry: geometria, kości i animacja bez zmian co do wartości; tekstury w WebP 1024, jeden materiał", async () => {
    const e = entry();
    const game = (await readGlbDocument(publicDir("characters", e.file))).getRoot();
    const src = (await readGlbDocument(e.source.file)).getRoot();
    expect(game.listMeshes()).toHaveLength(1);
    expect(game.listMaterials()).toHaveLength(1);
    expect(game.listTextures()).toHaveLength(3);
    for (const t of game.listTextures()) {
      expect(t.getMimeType()).toBe("image/webp");
      expect(t.getSize()).toEqual([1024, 1024]);
    }
    const attr = (r: typeof game, name: string) => Array.from(r.listMeshes()[0].listPrimitives()[0].getAttribute(name)!.getArray()!);
    for (const name of ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]) expect(attr(game, name), name).toEqual(attr(src, name));
    const index = (r: typeof game) => Array.from(r.listMeshes()[0].listPrimitives()[0].getIndices()!.getArray()!);
    expect(index(game)).toEqual(index(src));
    const joints = (r: typeof game) => r.listSkins()[0].listJoints().map((j) => j.getName());
    expect(joints(game)).toEqual(joints(src));
    const data = (r: typeof game) =>
      r
        .listAnimations()[0]
        .listChannels()
        .map((c) => [`${c.getTargetNode()!.getName()}.${c.getTargetPath()}`, Array.from(c.getSampler()!.getInput()!.getArray()!), Array.from(c.getSampler()!.getOutput()!.getArray()!)] as const)
        .sort((a, b) => a[0].localeCompare(b[0]));
    expect(data(game)).toEqual(data(src));
    expect(fs.statSync(publicDir("characters", e.file)).size).toBeLessThan(e.source.bytes);
  });

  it("jedna siatka ze skórą, jeden materiał standardowy i 41 kości po załadowaniu (jedno wywołanie rysowania)", () => {
    const skinned: THREE.SkinnedMesh[] = [];
    asset.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    expect(skinned).toHaveLength(1);
    expect(skinned[0].skeleton.bones).toHaveLength(41);
    expect(Array.isArray(skinned[0].material)).toBe(false);
    expect((skinned[0].material as THREE.Material).type).toBe("MeshStandardMaterial");
    expect(asset.triangles).toBe(19798);
    expect(asset.clips.map((c) => c.name)).toEqual([DEER_WALK_CLIP]);
    for (const bone of [entry().head.bone, ...entry().feet, "tripoRoot", "tripoSpine_4"]) expect(asset.scene.getObjectByName(sceneNodeName(bone)), bone).toBeDefined();
  });
});

describe("jeleń: orientacja, wymiary i skala", () => {
  it("przód to -X, góra to +Y: głowa leży z przodu, ogon z tyłu, kopyta na ziemi w pozie wiązania", () => {
    asset.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(asset.scene, true);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(size.z * 1.8);
    expect(box.min.y).toBeCloseTo(0, 2);
    const head = asset.scene.getObjectByName("tripoHead_0")!.getWorldPosition(new THREE.Vector3());
    const tail = asset.scene.getObjectByName("bone_40")!.getWorldPosition(new THREE.Vector3());
    expect(head.x).toBeLessThan(tail.x - 0.3);
    expect(head.y).toBeGreaterThan(0.55);
  });

  it("realistyczna wielkość w baśniowym stylu: ok. 1,8 m z porożem, grzbiet ok. 1 m, długość ciała ok. 1,4 m", () => {
    expect(asset.scale).toBeCloseTo(entry().targetHeight / entry().sourceHeight, 6);
    asset.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(asset.scene, true);
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(asset.scale);
    expect(size.y).toBeCloseTo(1.8, 1);
    expect(size.x).toBeGreaterThan(1.2);
    expect(size.x).toBeLessThan(1.6);
    const back = asset.scene.getObjectByName("tripoSpine_1")!.getWorldPosition(new THREE.Vector3()).y * asset.scale;
    expect(back).toBeGreaterThan(0.85);
    expect(back).toBeLessThan(1.2);
  });

  it("głowa w pliku jest obrócona o ok. 90° względem ciała, a korekta z manifestu ustawia pysk do przodu (marsz i postój)", () => {
    const e = entry();
    const raw = headHeading(asset);
    expect(Math.abs(raw.lateralDeg)).toBeGreaterThan(70);
    const rig = new HeadRig({ head: asset.scene.getObjectByName(sceneNodeName(e.head.bone))!, neck: asset.scene.getObjectByName("tripoSpine_4"), correction: e.head });
    const anims = buildDeerAnimations(asset);
    const mixer = new THREE.AnimationMixer(asset.scene);
    const walk = anims.clips.find((c) => c.name === DEER_WALK_CLIP)!;
    mixer.clipAction(walk).play();
    const yaws: number[] = [];
    for (let i = 0; i < 16; i++) {
      mixer.setTime((i / 16) * walk.duration);
      rig.apply({ yaw: 0, pitch: 0 });
      const h = headHeading(asset);
      yaws.push(h.yawDeg);
      expect(Math.abs(h.lateralDeg), `t=${i}`).toBeLessThan(14);
    }
    const mean = yaws.reduce((a, b) => a + b, 0) / yaws.length;
    expect(Math.abs(mean)).toBeLessThan(6);
    for (const y of yaws) expect(Math.abs(y)).toBeLessThan(16);
    mixer.stopAllAction();
    mixer.uncacheRoot(asset.scene);
    rig.dispose();
  });

  it("pomiar obwiedni głowy po korekcie: pysk jest przed szyją, a nie z boku", () => {
    const e = entry();
    const rig = new HeadRig({ head: asset.scene.getObjectByName(sceneNodeName(e.head.bone))!, neck: asset.scene.getObjectByName("tripoSpine_4"), correction: e.head });
    rig.apply({ yaw: 0, pitch: 0 });
    asset.scene.updateMatrixWorld(true);
    asset.skinned.skeleton.update();
    const muzzle = boneCentroid(asset, "bone_21");
    const neck = asset.scene.getObjectByName("tripoSpine_4")!.getWorldPosition(new THREE.Vector3());
    expect(neck.x - muzzle.x).toBeGreaterThan(0.07);
    expect(Math.abs(muzzle.z - neck.z)).toBeLessThan(0.06);
    rig.dispose();
  });
});

describe("jeleń: animacje", () => {
  it("Walk chodzi w miejscu (bez root motion), a prędkość chodu z ruchu kopyt jest spokojna (0,6-1,4 m/s)", () => {
    const set = buildDeerAnimations(asset);
    expect(set.stripped).toBe(false);
    expect(set.hipsDrift).toBeLessThan(0.01);
    expect(set.nominalSpeed).toBeGreaterThan(0.6);
    expect(set.nominalSpeed).toBeLessThan(1.4);
    expect(set.clips.map((c) => c.name)).toEqual([DEER_WALK_CLIP, "deer.rest"]);
  });

  it("poza spoczynkowa ma wszystkie ścieżki chodu, stałe wartości (bez ruchu nóg) i leży na ziemi; chód jest przechylony tak, by kopyta sięgały tej samej wysokości", () => {
    const set = buildDeerAnimations(asset);
    const walk = set.clips.find((c) => c.name === DEER_WALK_CLIP)!;
    const rest = set.clips.find((c) => c.name === "deer.rest")!;
    expect(rest.tracks.map((t) => t.name).sort()).toEqual(walk.tracks.map((t) => t.name).sort());
    for (const t of rest.tracks) {
      const n = t.getValueSize();
      expect(Array.from(t.values.slice(0, n)), t.name).toEqual(Array.from(t.values.slice(n)));
    }
    const box = new THREE.Box3().setFromObject(asset.scene, true);
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(Math.abs(set.walkTilt)).toBeGreaterThan(0.02);
    expect(Math.abs(set.walkTilt)).toBeLessThan(0.25);
  });
});

describe("jeleń: ładowanie przez GLTFLoader i system zasobów", () => {
  it("brak wpisu, pliku, kości, animacji albo złej liczby kości to czytelny błąd i zwolnienie sceny", async () => {
    const readJson = async (url: string) => readJsonFile(publicDir(url.replace(/^\//, "")));
    const readGlb = (url: string) => parseWithoutTextures(publicDir(url.replace(/^\//, "")));
    await expect(loadDeerAsset({ loadJson: async () => ({ schemaVersion: 1, characters: [] }), loadGlb: readGlb })).rejects.toBeInstanceOf(CharacterLoadError);
    await expect(loadDeerAsset({ loadJson: readJson, loadGlb: async () => Promise.reject(new Error("sieć")) })).rejects.toThrow(/deer\.forest/);
    const withEntry = async (patch: (e: DeerEntry) => void) => {
      const bad = (await readJson("/characters/characters.json")) as CharactersManifest;
      patch(bad.characters.find((c) => c.id === DEER_ID) as DeerEntry);
      return bad;
    };
    const missingBone = await withEntry((e) => (e.head.bone = "Nie_Ma"));
    await expect(loadDeerAsset({ loadJson: async () => missingBone, loadGlb: readGlb })).rejects.toThrow(/Nie_Ma/);
    const wrongBones = await withEntry((e) => (e.bones = 40));
    await expect(loadDeerAsset({ loadJson: async () => wrongBones, loadGlb: readGlb })).rejects.toThrow(/41 kości/);
    await expect(
      loadDeerAsset({
        loadJson: readJson,
        loadGlb: async (url) => {
          const g = await readGlb(url);
          return { scene: g.scene, animations: [] };
        },
      }),
    ).rejects.toThrow(/preset:quadruped:walk/);
  });
});
