#!/usr/bin/env node
/**
 * Potok postaci: `assets/source/forest_troll_animated.glb` -> `public/characters/troll.forest.glb` + `characters.json`.
 *
 *   npm run assets:troll
 *
 * Źródło (Blender + Mixamo): 22 siatki (tripo_part_N) pod węzłem `Troll_Rig` (obrót 90° wokół X i skala 0,01), 22 materiały,
 * 66 tekstur (kolor, normalne, metaliczność/chropowatość), jeden szkielet Mixamo (65 kości w skórze) i 7 animacji
 * (Walk, Idle, Nervous, Surprised, Happy, Dance, Angry). Wariant gry:
 *  - szkielet, nazwy kości i animacje zostają NIETKNIĘTE (te same węzły, te same kanały i próbki),
 *  - 22 siatki scalone w jedną siatkę ze skórą (JOINTS_0/WEIGHTS_0 kopiowane 1:1), więc jeden materiał i jedno wywołanie rysowania,
 *  - 66 tekstur złożone w trzy atlasy 2048 x 2048 (kolor, normalne, MR) z marginesem 8 px i rozszerzeniem krawędzi
 *    (brak przeciekania kolorów między kafelkami w mipmapach); UV przeliczone na atlas,
 *  - dwa największe kafelki (1024) skurczone do 1008 px, żeby zmieściły się obok siebie z marginesem w atlasie 2048 (-1,6 % liniowo),
 *    pozostałe w pełnej rozdzielczości,
 *  - tekstury w WebP (kolor 82, normalne 90, MR 90), próbnik z CLAMP_TO_EDGE.
 * Oryginał zostaje w `assets/source/`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, TextureInfo } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import sharp from "sharp";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "assets/source/forest_troll_animated.glb");
const OUT_DIR = path.join(ROOT, "public/characters");
const FILE = "troll.forest.glb";
const ATLAS = 2048;
const PAD = 8;
const BIG_CONTENT = ATLAS / 2 - 2 * PAD;
const QUALITY = { base: 82, normal: 90, mr: 90 };

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();
const sourceTris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
const sourceSkin = root.listSkins()[0];
const sourceClips = root.listAnimations().map((a) => ({ name: a.getName(), channels: a.listChannels().length }));

const meshNodes = root
  .listNodes()
  .filter((n) => n.getMesh())
  .sort((a, b) => Number(a.getName().replace(/\D+/g, "")) - Number(b.getName().replace(/\D+/g, "")));
if (meshNodes.length !== 22) throw new Error(`Oczekiwano 22 siatek, jest ${meshNodes.length}.`);
const parents = new Set(meshNodes.map((n) => n.getParentNode()));
if (parents.size !== 1) throw new Error("Siatki mają różnych rodziców.");
const parent = [...parents][0];
for (const n of meshNodes) {
  if (n.getSkin() !== sourceSkin) throw new Error(`${n.getName()}: siatka nie używa wspólnego szkieletu.`);
  const t = n.getTranslation();
  const s = n.getScale();
  const r = n.getRotation();
  if (t.some((v) => v !== 0) || s.some((v) => v !== 1) || r.some((v, i) => v !== [0, 0, 0, 1][i])) throw new Error(`${n.getName()}: transformacja węzła siatki nie jest tożsamością.`);
}

const parts = meshNodes.map((node) => {
  const prims = node.getMesh().listPrimitives();
  if (prims.length !== 1) throw new Error(`${node.getName()}: oczekiwano jednego prymitywu.`);
  const prim = prims[0];
  const mat = prim.getMaterial();
  const textures = { base: mat.getBaseColorTexture(), normal: mat.getNormalTexture(), mr: mat.getMetallicRoughnessTexture() };
  const size = textures.base.getSize();
  for (const t of Object.values(textures)) {
    if (!t) throw new Error(`${node.getName()}: brakuje tekstury.`);
    const s = t.getSize();
    if (s[0] !== size[0] || s[1] !== size[1]) throw new Error(`${node.getName()}: rozmiary tekstur różnią się.`);
  }
  if (mat.getMetallicFactor() !== 1 || mat.getRoughnessFactor() !== 1 || mat.getBaseColorFactor().some((v) => v !== 1) || mat.getNormalScale() !== 1) {
    throw new Error(`${node.getName()}: współczynniki materiału różnią się od 1 (atlas zakłada wspólny materiał).`);
  }
  return { node, prim, textures, size };
});

// Układ kafelków: półki od największych; dwa kafelki 1024 dostają treść 1008 px, reszta bez zmian.
const items = parts.map((p, i) => ({ i, content: p.size[0] >= 1024 ? BIG_CONTENT : p.size[0] })).sort((a, b) => b.content - a.content || a.i - b.i);
const layout = new Array(parts.length);
let x = 0;
let y = 0;
let shelf = 0;
for (const it of items) {
  const w = it.content + 2 * PAD;
  if (x + w > ATLAS) {
    x = 0;
    y += shelf;
    shelf = 0;
  }
  if (y + w > ATLAS) throw new Error("Atlas 2048 jest za mały.");
  layout[it.i] = { x: x + PAD, y: y + PAD, size: it.content };
  x += w;
  shelf = Math.max(shelf, w);
}
const usedRows = y + shelf;

async function buildAtlas(kind, background, webpOptions) {
  const composites = [];
  for (const [i, part] of parts.entries()) {
    const L = layout[i];
    let img = sharp(Buffer.from(part.textures[kind].getImage()));
    if (L.size !== part.size[0]) img = img.resize(L.size, L.size, { kernel: "lanczos3" });
    const { data, info } = await img
      .removeAlpha()
      .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: "copy" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    composites.push({ input: data, raw: { width: info.width, height: info.height, channels: 3 }, left: L.x - PAD, top: L.y - PAD });
  }
  const out = await sharp({ create: { width: ATLAS, height: ATLAS, channels: 3, background } })
    .composite(composites)
    .webp(webpOptions)
    .toBuffer();
  return new Uint8Array(out);
}

const atlases = {
  base: await buildAtlas("base", { r: 110, g: 110, b: 110 }, { quality: QUALITY.base }),
  normal: await buildAtlas("normal", { r: 128, g: 128, b: 255 }, { quality: QUALITY.normal }),
  mr: await buildAtlas("mr", { r: 255, g: 80, b: 0 }, { quality: QUALITY.mr }),
};

// Scalenie geometrii.
const totalVerts = parts.reduce((n, p) => n + p.prim.getAttribute("POSITION").getCount(), 0);
const totalIdx = parts.reduce((n, p) => n + p.prim.getIndices().getCount(), 0);
const position = new Float32Array(totalVerts * 3);
const normal = new Float32Array(totalVerts * 3);
const uv = new Float32Array(totalVerts * 2);
const joints = new Uint8Array(totalVerts * 4);
const weights = new Float32Array(totalVerts * 4);
const indices = totalVerts < 65535 ? new Uint16Array(totalIdx) : new Uint32Array(totalIdx);
let vOff = 0;
let iOff = 0;
const uvOutside = { min: 1, max: 0 };
for (const [i, part] of parts.entries()) {
  const p = part.prim;
  const n = p.getAttribute("POSITION").getCount();
  const jointsAttr = p.getAttribute("JOINTS_0");
  if (jointsAttr.getComponentType() !== 5121) throw new Error("JOINTS_0 w innym formacie niż UNSIGNED_BYTE.");
  position.set(p.getAttribute("POSITION").getArray(), vOff * 3);
  normal.set(p.getAttribute("NORMAL").getArray(), vOff * 3);
  joints.set(jointsAttr.getArray(), vOff * 4);
  weights.set(p.getAttribute("WEIGHTS_0").getArray(), vOff * 4);
  const srcUv = p.getAttribute("TEXCOORD_0").getArray();
  const L = layout[i];
  for (let k = 0; k < n; k++) {
    const u = srcUv[k * 2];
    const v = srcUv[k * 2 + 1];
    uvOutside.min = Math.min(uvOutside.min, u, v);
    uvOutside.max = Math.max(uvOutside.max, u, v);
    if (u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001) throw new Error(`${part.node.getName()}: UV poza [0,1] (atlas wymaga powtarzania).`);
    uv[(vOff + k) * 2] = (L.x + Math.min(1, Math.max(0, u)) * L.size) / ATLAS;
    uv[(vOff + k) * 2 + 1] = (L.y + Math.min(1, Math.max(0, v)) * L.size) / ATLAS;
  }
  const idx = p.getIndices().getArray();
  for (let k = 0; k < idx.length; k++) indices[iOff + k] = idx[k] + vOff;
  vOff += n;
  iOff += idx.length;
}

const buffer = root.listBuffers()[0];
const acc = (name, type, array, normalized = false) => doc.createAccessor(name, buffer).setType(type).setArray(array).setNormalized(normalized);
const textureOf = (name, bytes) => doc.createTexture(name).setImage(bytes).setMimeType("image/webp");
const baseTex = textureOf("Troll_basecolor", atlases.base);
const normalTex = textureOf("Troll_normal", atlases.normal);
const mrTex = textureOf("Troll_metalrough", atlases.mr);
doc.createExtension(EXTTextureWebP).setRequired(true);
const material = doc
  .createMaterial("Troll")
  .setBaseColorFactor([1, 1, 1, 1])
  .setMetallicFactor(1)
  .setRoughnessFactor(1)
  .setDoubleSided(true)
  .setBaseColorTexture(baseTex)
  .setNormalTexture(normalTex)
  .setMetallicRoughnessTexture(mrTex);
for (const info of [material.getBaseColorTextureInfo(), material.getNormalTextureInfo(), material.getMetallicRoughnessTextureInfo()]) {
  info.setWrapS(TextureInfo.WrapMode.CLAMP_TO_EDGE).setWrapT(TextureInfo.WrapMode.CLAMP_TO_EDGE);
}
const prim = doc
  .createPrimitive()
  .setAttribute("POSITION", acc("Troll.pos", "VEC3", position))
  .setAttribute("NORMAL", acc("Troll.nrm", "VEC3", normal))
  .setAttribute("TEXCOORD_0", acc("Troll.uv", "VEC2", uv))
  .setAttribute("JOINTS_0", acc("Troll.joints", "VEC4", joints))
  .setAttribute("WEIGHTS_0", acc("Troll.weights", "VEC4", weights))
  .setIndices(acc("Troll.idx", "SCALAR", indices))
  .setMaterial(material);
const mergedNode = doc.createNode("Troll_Body").setMesh(doc.createMesh("Troll_Body").addPrimitive(prim)).setSkin(sourceSkin);
parent.addChild(mergedNode);
for (const n of meshNodes) {
  const mesh = n.getMesh();
  n.dispose();
  mesh.dispose();
}
await doc.transform(prune());

const glb = await io.writeBinary(doc);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, FILE), glb);

// Kontrola wyniku: szkielet i animacje identyczne co do kanałów, trójkąty bez zmian.
const check = await io.readBinary(glb);
const cr = check.getRoot();
const checkTris = cr.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
if (checkTris !== sourceTris) throw new Error(`Liczba trójkątów się zmieniła: ${sourceTris} -> ${checkTris}.`);
const jointNames = (skin) => skin.listJoints().map((j) => j.getName());
if (JSON.stringify(jointNames(cr.listSkins()[0])) !== JSON.stringify(jointNames(sourceSkin))) throw new Error("Zmieniła się lista kości.");
const clips = cr.listAnimations().map((a) => ({ name: a.getName(), channels: a.listChannels().length }));
if (JSON.stringify(clips) !== JSON.stringify(sourceClips)) throw new Error("Zmieniły się animacje.");


/**
 * Obwiednia postaci w pozie wiązania po skinningu (jednostki sceny, z obrotem i skalą węzła `Troll_Rig`). `getBounds`
 * z gltf-transform tu nie działa (pomija skórę), więc liczymy ją Three.js na kopii pliku bez tekstur (GLTFLoader nie
 * dekoduje obrazów w Node).
 */
async function measureRestBounds(bytes) {
  const copy = await io.readBinary(bytes);
  for (const t of copy.getRoot().listTextures()) t.dispose();
  for (const e of copy.getRoot().listExtensionsUsed()) e.dispose();
  const plain = await new NodeIO().writeBinary(copy);
  const gltf = await new GLTFLoader().parseAsync(plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength), "");
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    for (let i = 0; i < o.geometry.getAttribute("position").count; i++) {
      o.getVertexPosition(i, v);
      box.expandByPoint(v.applyMatrix4(o.matrixWorld));
    }
  });
  return { min: box.min.toArray(), max: box.max.toArray() };
}
const sourceBounds = await measureRestBounds(glb);
if (!(sourceBounds.max[1] - sourceBounds.min[1] > 0)) throw new Error("Nie udało się zmierzyć wysokości postaci.");

const manifestPath = path.join(OUT_DIR, "characters.json");
const entry = {
  id: "troll.forest",
  file: FILE,
  bytes: glb.length,
  triangles: checkTris,
  vertices: totalVerts,
  bones: sourceSkin.listJoints().length,
  meshNode: "Troll_Body",
  hipsBone: "mixamorig:Hips",
  clips: clips.map((c) => ({ ...c, duration: round(cr.listAnimations().find((a) => a.getName() === c.name).listSamplers().reduce((m, s) => Math.max(m, s.getInput().getMax([])[0]), 0), 3) })),
  /** Wysokość postaci w pozie wiązania (jednostki modelu); skala do świata = targetHeight / sourceHeight. */
  sourceHeight: round(sourceBounds.max[1] - sourceBounds.min[1], 7),
  sourceBounds: { min: sourceBounds.min.map((v) => round(v, 7)), max: sourceBounds.max.map((v) => round(v, 7)) },
  /** Przód modelu (kierunek, w który patrzą palce stóp) w układzie sceny; zgodny z konwencją azymutu `atan2(dx, dz)`. */
  forward: "+z",
  rigNode: "Troll_Rig",
  targetHeight: 2.7,
  atlas: { size: ATLAS, padding: PAD, rowsUsed: usedRows, textures: ["Troll_basecolor", "Troll_normal", "Troll_metalrough"].map((n, i) => ({ name: n, bytes: Object.values(atlases)[i].length })) },
  optimisation: { before: { meshes: 22, materials: 22, textures: 66 }, after: { meshes: 1, materials: 1, textures: 3 } },
  source: {
    file: "assets/source/forest_troll_animated.glb",
    sha256: sha256(fs.readFileSync(SRC)),
    bytes: fs.statSync(SRC).size,
    author: "dostarczone przez autora projektu Miasto",
    note: "Szkielet Mixamo (65 kości w skórze) i 7 animacji (Walk, Idle, Nervous, Surprised, Happy, Dance, Angry) bez zmian; Walk jest w miejscu (bez root motion).",
  },
};
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { schemaVersion: 1, characters: [] };
manifest.characters = [entry, ...manifest.characters.filter((c) => c.id !== entry.id)];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${entry.id}: ${glb.length} B, ${checkTris} trójkątów, atlas ${ATLAS}² (użyte wiersze ${usedRows}), klipy ${JSON.stringify(entry.clips)}, wysokość źródła ${entry.sourceHeight}`);
