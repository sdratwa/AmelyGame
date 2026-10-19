import * as THREE from "three";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { TrollAsset } from "@/lib/assets/characters";
import { readGlbDocument, publicDir } from "@/lib/assets/glbTestkit";
import { NpcLayer } from "@/lib/forest-view/npc";
import { forestOf, forestWalkOf } from "@/lib/game/world/lookup";
import { loadTestTroll } from "./testkit";
import { prepareTrollMaterials, readImagePixels, TROLL_FALLBACK_ROUGHNESS } from "./trollMaterials";
import { bakeRoughness, classifyTexel, TROLL_ROUGHNESS, type Pixels } from "./trollSurface";

type Atlas = { base: Pixels; mr: Pixels; normal: Pixels };
let atlas: Atlas;

async function decode(bytes: Uint8Array): Promise<Pixels> {
  const { data, info } = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

beforeAll(async () => {
  const doc = await readGlbDocument(publicDir("characters", "troll.forest.glb"));
  const byName = Object.fromEntries(doc.getRoot().listTextures().map((t) => [t.getName(), t.getImage()!]));
  atlas = { base: await decode(byName.Troll_basecolor), mr: await decode(byName.Troll_metalrough), normal: await decode(byName.Troll_normal) };
}, 30_000);

const px = (r: number, g: number, b: number): Pixels => ({ width: 1, height: 1, data: new Uint8Array([r, g, b, 255]) });

describe("troll: diagnoza oryginalnego materiału (przyczyna połysku)", () => {
  it("mapa MR z pliku jest lakierowana: chropowatość ok. 0,3 na prawie całej powierzchni, metaliczność 0", () => {
    const { data } = atlas.mr;
    let glossy = 0;
    let metal = 0;
    let sum = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const rough = data[i + 1] / 255;
      sum += rough;
      if (rough < 0.4) glossy++;
      metal += data[i + 2] / 255;
    }
    expect(sum / n).toBeLessThan(0.35);
    expect(glossy / n).toBeGreaterThan(0.9);
    expect(metal / n).toBeLessThan(0.02);
  });

  it("w oczach chropowatość z mapy MR spada do zera (lustro), a normalne mają tam ostry wał (źródło migoczących punktów)", () => {
    const w = atlas.mr.width;
    const g = (x: number, y: number) => atlas.mr.data[(y * w + x) * 4 + 1];
    for (const [cx, cy] of [
      [1307, 720],
      [1093, 840],
    ]) {
      let min = 255;
      let rimNormal = 0;
      for (let y = cy - 40; y <= cy + 40; y++) {
        for (let x = cx - 40; x <= cx + 40; x++) {
          min = Math.min(min, g(x, y));
          const i = (y * w + x) * 4;
          const nx = atlas.normal.data[i] / 127.5 - 1;
          const ny = atlas.normal.data[i + 1] / 127.5 - 1;
          rimNormal = Math.max(rimNormal, Math.hypot(nx, ny));
        }
      }
      expect(min).toBeLessThan(5);
      expect(rimNormal).toBeGreaterThan(0.5);
    }
  });
});

describe("troll: klasyfikacja tekseli", () => {
  it("rozpoznaje klasy z koloru albedo i chropowatości MR", () => {
    expect(classifyTexel(0, 0, 0, 0)).toBe("gap");
    expect(classifyTexel(230, 200, 160, 0.02)).toBe("eye");
    expect(classifyTexel(238, 190, 150, 0.3)).toBe("skin");
    expect(classifyTexel(215, 120, 130, 0.3)).toBe("nose");
    expect(classifyTexel(225, 232, 236, 0.3)).toBe("hair");
    expect(classifyTexel(110, 150, 70, 0.3)).toBe("hair");
    expect(classifyTexel(225, 60, 30, 0.3)).toBe("accessory");
  });

  it("wypieka mapę z tabeli: klasy dostają swoje chropowatości, a granice są rozmyte", () => {
    const base: Pixels = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) };
    const mr: Pixels = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) };
    for (let i = 0; i < 16; i++) {
      const skin = i % 4 < 2;
      base.data.set(skin ? [238, 190, 150, 255] : [225, 232, 236, 255], i * 4);
      mr.data.set([255, 77, 0, 255], i * 4);
    }
    const out = bakeRoughness(base, mr, 4);
    expect(out.counts.skin).toBe(8);
    expect(out.counts.hair).toBe(8);
    const rough = (x: number, y: number) => out.data[y * 4 + x] / 255;
    expect(rough(0, 1)).toBeGreaterThan(TROLL_ROUGHNESS.skin - 0.005);
    expect(rough(0, 1)).toBeLessThan(TROLL_ROUGHNESS.skin + 0.04);
    expect(rough(1, 1)).toBeGreaterThan(TROLL_ROUGHNESS.skin);
    expect(rough(1, 1)).toBeLessThan(TROLL_ROUGHNESS.hair);
    expect(() => bakeRoughness(px(0, 0, 0), { width: 2, height: 1, data: new Uint8Array(8) }, 1)).toThrow();
  });

  it("na prawdziwym atlasie nie zostaje żaden połyskliwy teksel, a udziały klas są rozsądne", () => {
    const out = bakeRoughness(atlas.base, atlas.mr);
    let min = 255;
    let max = 0;
    let sum = 0;
    for (const v of out.data) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
    }
    expect(min / 255).toBeGreaterThanOrEqual(0.69);
    expect(max / 255).toBeLessThanOrEqual(0.96);
    expect(sum / out.data.length / 255).toBeGreaterThan(0.85);
    expect(out.share.hair + out.share.skin).toBeGreaterThan(0.9);
    expect(out.share.nose).toBeGreaterThan(0.002);
    expect(out.share.eye).toBeGreaterThan(0.002);
    // oczy (miejsca, gdzie MR miało zero) nie są lustrem, tylko ok. 0,7-0,8
    const eye = out.data[360 * out.size + 653] / 255;
    expect(eye).toBeGreaterThanOrEqual(0.69);
    expect(eye).toBeLessThan(0.82);
  });
});

describe("prepareTrollMaterials", () => {
  let asset: TrollAsset;
  beforeAll(async () => {
    asset = await loadTestTroll();
  });

  const textured = async () => {
    const troll = await loadTestTroll();
    const mat = troll.skinned.material as THREE.MeshStandardMaterial;
    const image = (p: Pixels) => ({ width: p.width, height: p.height, pixels: p });
    const base = new THREE.Texture(image(atlas.base) as unknown as HTMLImageElement);
    const mr = new THREE.Texture(image(atlas.mr) as unknown as HTMLImageElement);
    const normal = new THREE.Texture(image(atlas.normal) as unknown as HTMLImageElement);
    mat.map = base;
    mat.roughnessMap = mr;
    mat.metalnessMap = mr;
    mat.normalMap = normal;
    const readPixels = (img: unknown) => (img as { pixels: Pixels }).pixels;
    return { troll, mat, base, mr, normal, readPixels };
  };

  it("bez tekstur wchodzi w tryb zapasowy: jednolity matowy materiał, oryginał nietknięty", () => {
    const material = asset.skinned.material as THREE.MeshStandardMaterial;
    const before = { metalness: material.metalness, roughness: material.roughness, map: material.map };
    const m = prepareTrollMaterials(asset);
    expect(m.mode).toBe("matte");
    expect(m.fallbackReason).toBeTruthy();
    expect(asset.skinned.material).toBe(m.matte);
    expect(m.matte).not.toBe(m.original);
    expect(m.matte.metalness).toBe(0);
    expect(m.matte.roughness).toBe(TROLL_FALLBACK_ROUGHNESS);
    expect(m.matte.roughnessMap).toBeNull();
    expect(m.original).toBe(material);
    expect({ metalness: m.original.metalness, roughness: m.original.roughness, map: m.original.map }).toEqual(before);
    m.dispose();
    expect(asset.skinned.material).toBe(material);
  });

  it("zachowuje tekstury koloru i normalnych, wypieka chropowatość, odłącza metaliczność", async () => {
    const { troll, mat, base, normal, readPixels } = await textured();
    const m = prepareTrollMaterials(troll, { readPixels });
    expect(m.fallbackReason).toBeNull();
    expect(m.matte.map).toBe(base);
    expect(m.matte.normalMap).toBe(normal);
    expect(m.matte.metalness).toBe(0);
    expect(m.matte.metalnessMap).toBeNull();
    expect(m.matte.roughness).toBe(1);
    const rough = m.matte.roughnessMap as THREE.DataTexture;
    expect(rough).toBeInstanceOf(THREE.DataTexture);
    expect(rough.colorSpace).toBe(THREE.NoColorSpace);
    expect(rough.image.width).toBe(1024);
    expect(mat.roughnessMap).not.toBe(rough);
    expect(m.matte.envMapIntensity).toBeLessThan(1);
    const r = m.report();
    expect(r.metalness).toBe(0);
    expect(r.roughnessMap).toBe("wypieczona");
    expect(r.classes).toEqual(TROLL_ROUGHNESS);
    expect(m.report("original").roughnessMap).toBe("z pliku (MR)");
    expect(m.report("original").classes).toBeNull();
  });

  it("przełącza ORIGINAL/MATTE bez dodatkowych siatek i materiałów na rysowaniu", async () => {
    const { troll, readPixels } = await textured();
    const meshes = () => {
      const list: THREE.Mesh[] = [];
      troll.scene.traverse((o) => (o as THREE.Mesh).isMesh && list.push(o as THREE.Mesh));
      return list;
    };
    const m = prepareTrollMaterials(troll, { readPixels });
    expect(meshes()).toHaveLength(1);
    expect(troll.skinned.material).toBe(m.matte);
    m.setMode("original");
    expect(troll.skinned.material).toBe(m.original);
    expect(m.mode).toBe("original");
    m.setMode("matte");
    expect(troll.skinned.material).toBe(m.matte);
    expect(meshes()).toHaveLength(1);
    expect(Array.isArray(troll.skinned.material)).toBe(false);
  });

  it("nie zmienia geometrii, szkieletu, wag skinningu ani animacji", async () => {
    const { troll, readPixels } = await textured();
    const g = troll.skinned.geometry;
    const hash = () => {
      let h = 0;
      for (const name of ["position", "normal", "uv", "skinIndex", "skinWeight"]) {
        const a = g.getAttribute(name).array as ArrayLike<number>;
        for (let i = 0; i < a.length; i += 97) h = (h * 31 + Math.round(a[i] * 1e4)) | 0;
      }
      return h;
    };
    const before = { hash: hash(), bones: troll.skinned.skeleton.bones.length, clips: troll.clips.map((c) => `${c.name}:${c.tracks.length}:${c.duration}`), index: g.getIndex()!.count };
    const m = prepareTrollMaterials(troll, { readPixels });
    m.setMode("original");
    m.setMode("matte");
    expect({ hash: hash(), bones: troll.skinned.skeleton.bones.length, clips: troll.clips.map((c) => `${c.name}:${c.tracks.length}:${c.duration}`), index: g.getIndex()!.count }).toEqual(before);
    expect(before.clips).toHaveLength(7);
    expect(before.bones).toBe(65);
  });

  it("dispose zwraca oryginał siatce i zwalnia tylko klon oraz wypieczoną mapę (współdzielone tekstury zostają)", async () => {
    const { troll, mat, base, mr, readPixels } = await textured();
    const m = prepareTrollMaterials(troll, { readPixels });
    const events: string[] = [];
    m.matte.addEventListener("dispose", () => events.push("matte"));
    m.original.addEventListener("dispose", () => events.push("original"));
    (m.matte.roughnessMap as THREE.Texture).addEventListener("dispose", () => events.push("baked"));
    base.addEventListener("dispose", () => events.push("base"));
    mr.addEventListener("dispose", () => events.push("mr"));
    m.dispose();
    m.dispose();
    expect(events.sort()).toEqual(["baked", "matte"]);
    expect(troll.skinned.material).toBe(mat);
    m.setMode("original");
    expect(troll.skinned.material).toBe(mat);
    troll.dispose();
    expect(events).toContain("original");
    expect(events).toContain("base");
    expect(events).toContain("mr");
  });

  it("nie zakłada, że obraz da się odczytać: błąd odczytu i niezgodne rozmiary dają tryb zapasowy zamiast wyjątku", async () => {
    const { troll } = await textured();
    const m = prepareTrollMaterials(troll, {
      readPixels: (img) => {
        throw new Error(`nie czytam ${typeof img}`);
      },
    });
    expect(m.fallbackReason).toContain("nie czytam");
    expect(m.matte.roughnessMap).toBeNull();
    expect(m.matte.roughness).toBe(TROLL_FALLBACK_ROUGHNESS);
    expect(readImagePixels(null)).toBeNull();
    expect(readImagePixels({ width: 4, height: 4 })).toBeNull();
    const t2 = await textured();
    const odd = prepareTrollMaterials(t2.troll, { readPixels: () => ({ width: 3, height: 3, data: new Uint8Array(36) }) });
    expect(odd.fallbackReason).toBeTruthy();
  });

  it("ogranicza warstwy MeshPhysicalMaterial (clearcoat, sheen, transmission, iridescence, specular)", async () => {
    const troll = await loadTestTroll();
    const physical = new THREE.MeshPhysicalMaterial({ clearcoat: 1, sheen: 1, transmission: 0.6, iridescence: 1, specularIntensity: 1, metalness: 0.8, roughness: 0.1 });
    troll.skinned.material = physical;
    const m = prepareTrollMaterials(troll);
    expect(m.original).toBe(physical);
    const clone = m.matte as THREE.MeshPhysicalMaterial;
    expect(clone.isMeshPhysicalMaterial).toBe(true);
    expect([clone.clearcoat, clone.sheen, clone.transmission, clone.iridescence, clone.metalness]).toEqual([0, 0, 0, 0, 0]);
    expect(clone.specularIntensity).toBeLessThanOrEqual(0.5);
    expect(physical.clearcoat).toBe(1);
    expect(physical.transmission).toBe(0.6);
    expect(m.report().physical).toMatchObject({ clearcoat: 0, sheen: 0, transmission: 0 });
    expect(m.report("original").physical).toMatchObject({ clearcoat: 1, transmission: 0.6 });
  });
});

describe("NpcLayer: materiał trolla", () => {
  it("domyślnie matowy; przełącznik zmienia tylko materiał; dispose sprząta", async () => {
    const seed = 321;
    const troll = await loadTestTroll();
    const layer = new NpcLayer(troll, { forest: forestOf(seed), walk: forestWalkOf(seed), seed, castShadow: false, receiveShadow: false });
    expect(layer.materialMode).toBe("matte");
    const stats = layer.stats();
    expect(stats.materials).toBe(1);
    expect(stats.materialMode).toBe("matte");
    expect(stats.materialReport?.metalness).toBe(0);
    const matte = troll.skinned.material;
    layer.setMaterialMode("original");
    expect(layer.stats().materialMode).toBe("original");
    expect(troll.skinned.material).not.toBe(matte);
    const triangles = layer.stats().triangles;
    layer.setMaterialMode("matte");
    expect(troll.skinned.material).toBe(matte);
    expect(layer.stats().triangles).toBe(triangles);
    const events: string[] = [];
    (matte as THREE.Material).addEventListener("dispose", () => events.push("matte"));
    layer.dispose();
    expect(events).toEqual(["matte"]);
  });

  it("zaczyna w trybie podanym przez renderer (zapamiętany wybór z panelu)", async () => {
    const seed = 322;
    const troll = await loadTestTroll();
    const layer = new NpcLayer(troll, { forest: forestOf(seed), walk: forestWalkOf(seed), seed, castShadow: false, receiveShadow: false, materialMode: "original" });
    expect(layer.materialMode).toBe("original");
    expect(layer.stats().materialReport?.mode).toBe("original");
    expect(layer.stats().materialReport?.roughness).toBe(1);
    layer.dispose();
  });
});
