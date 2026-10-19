#!/usr/bin/env node
/**
 * Potok postaci: `assets/source/deer_cartoon_3d_model.glb` -> `public/characters/deer.forest.glb` + wpis w `characters.json`.
 *
 *   npm run assets:deer
 *
 * Źródło (Tripo, preset czworonoga): jedna siatka ze skórą (19 798 trójkątów) pod węzłem `Armature`, jeden materiał,
 * trzy tekstury JPEG 1024 x 1024 (kolor, normalne, metaliczność/chropowatość), szkielet 41 kości i jedna animacja
 * `preset:quadruped:walk` (2,583 s, w miejscu). Przód modelu to -X, góra to +Y; głowa jest obrócona o ok. 90° względem
 * ciała (pysk w stronę +Z), co koryguje warstwa kości głowy w grze (`head` w manifeście), a nie plik.
 * Wariant gry:
 *  - geometria, szkielet, nazwy kości i animacja zostają NIETKNIĘTE (sprawdzane po zapisie),
 *  - tekstury w WebP (kolor 85, normalne 90, MR 90) w oryginalnej rozdzielczości, bez atlasu (jeden materiał już jest),
 *  - węzeł siatki i materiał dostają czytelne nazwy (`Deer_Body`, `Deer`).
 * Oryginał zostaje w `assets/source/`. Wpis jelenia jest dopisywany do manifestu bez ruszania wpisów innych postaci.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import sharp from "sharp";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "assets/source/deer_cartoon_3d_model.glb");
const OUT_DIR = path.join(ROOT, "public/characters");
const FILE = "deer.forest.glb";
const QUALITY = { basecolor: 85, normal: 90, rm: 90 };
/** Wysokość jelenia ze zwieńczeniem poroża w świecie (m): zwierzę z baśni, nieco większe od rzeczywistego daniela. */
const TARGET_HEIGHT = 1.8;
/** Korekta głowy (kąty w układzie modelu: przód -X, góra +Y, obrót o oś pionową i o oś boczną Z): pysk do przodu, lekko uniesiony. */
const HEAD = { bone: "tripoHead_0", yawDeg: -83, pitchDeg: -12 };

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(SRC);
const root = doc.getRoot();

const sourceTris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
const sourceSkin = root.listSkins()[0];
const sourceClips = root.listAnimations().map((a) => ({ name: a.getName(), channels: a.listChannels().length }));
if (root.listMeshes().length !== 1 || root.listMaterials().length !== 1 || root.listTextures().length !== 3) throw new Error("Oczekiwano 1 siatki, 1 materiału i 3 tekstur.");
if (sourceSkin.listJoints().length !== 41) throw new Error(`Oczekiwano 41 kości, jest ${sourceSkin.listJoints().length}.`);

const meshNode = root.listNodes().find((n) => n.getMesh());
const sourceMeshName = meshNode.getName();
meshNode.setName("Deer_Body");
meshNode.getMesh().setName("Deer_Body");
const material = root.listMaterials()[0];
material.setName("Deer");

doc.createExtension(EXTTextureWebP).setRequired(true);
const textureSizes = [];
for (const texture of root.listTextures()) {
  const name = texture.getName() || texture.getURI();
  const kind = /basecolor/i.test(name) ? "basecolor" : /normal/i.test(name) ? "normal" : /_rm/i.test(name) ? "rm" : null;
  if (!kind) throw new Error(`Nieznana tekstura: ${name}`);
  const webp = await sharp(Buffer.from(texture.getImage())).removeAlpha().webp({ quality: QUALITY[kind] }).toBuffer();
  texture.setImage(new Uint8Array(webp)).setMimeType("image/webp").setName(`Deer_${kind}`).setURI("");
  textureSizes.push({ name: texture.getName(), size: texture.getSize(), bytes: webp.length });
}

const glb = await io.writeBinary(doc);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, FILE), glb);

// Kontrola wyniku: te same trójkąty, kości i kanały animacji; wartości animacji i geometria bez zmian.
const check = await io.readBinary(glb);
const cr = check.getRoot();
const checkTris = cr.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
if (checkTris !== sourceTris) throw new Error(`Liczba trójkątów się zmieniła: ${sourceTris} -> ${checkTris}.`);
const jointNames = (skin) => skin.listJoints().map((j) => j.getName());
if (JSON.stringify(jointNames(cr.listSkins()[0])) !== JSON.stringify(jointNames(sourceSkin))) throw new Error("Zmieniła się lista kości.");
const clips = cr.listAnimations().map((a) => ({ name: a.getName(), channels: a.listChannels().length }));
if (JSON.stringify(clips) !== JSON.stringify(sourceClips)) throw new Error("Zmieniły się animacje.");
const positions = (r) => Array.from(r.listMeshes()[0].listPrimitives()[0].getAttribute("POSITION").getArray());
if (JSON.stringify(positions(cr)) !== JSON.stringify(positions(root))) throw new Error("Zmieniła się geometria.");

/** Obwiednia w pozie wiązania po skinningu (jednostki sceny); `getBounds` z gltf-transform pomija skórę. */
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
const bounds = await measureRestBounds(glb);
if (!(bounds.max[1] - bounds.min[1] > 0)) throw new Error("Nie udało się zmierzyć wysokości postaci.");

const duration = (name) => round(cr.listAnimations().find((a) => a.getName() === name).listSamplers().reduce((m, s) => Math.max(m, s.getInput().getMax([])[0]), 0), 3);
const entry = {
  id: "deer.forest",
  file: FILE,
  bytes: glb.length,
  triangles: checkTris,
  vertices: cr.listMeshes()[0].listPrimitives()[0].getAttribute("POSITION").getCount(),
  bones: sourceSkin.listJoints().length,
  meshNode: "Deer_Body",
  hipsBone: "tripoRoot",
  clips: clips.map((c) => ({ ...c, duration: duration(c.name) })),
  sourceHeight: round(bounds.max[1] - bounds.min[1], 7),
  sourceBounds: { min: bounds.min.map((v) => round(v, 7)), max: bounds.max.map((v) => round(v, 7)) },
  targetHeight: TARGET_HEIGHT,
  forward: "-x",
  head: HEAD,
  feet: ["tripo0_Left_Limb_4", "tripo0_Right_Limb_4", "tripo1_Left_Limb_4", "tripo1_Right_Limb_4"],
  textures: textureSizes,
  source: {
    file: "assets/source/deer_cartoon_3d_model.glb",
    sha256: sha256(fs.readFileSync(SRC)),
    bytes: fs.statSync(SRC).size,
    author: "dostarczone przez autora projektu Miasto",
    note: `Szkielet 41 kości i jedna animacja ${clips[0].name} (w miejscu, bez Idle) bez zmian; głowa obrócona o ok. 90° względem ciała (korekta w grze); oryginalna nazwa siatki ${sourceMeshName}.`,
  },
};

const manifestPath = path.join(OUT_DIR, "characters.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { schemaVersion: 1, characters: [] };
manifest.characters = [...manifest.characters.filter((c) => c.id !== entry.id), entry];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${entry.id}: ${glb.length} B, ${checkTris} trójkątów, ${entry.bones} kości, klipy ${JSON.stringify(entry.clips)}, wysokość źródła ${entry.sourceHeight}, tekstury ${textureSizes.map((t) => `${t.name} ${t.bytes} B`).join(", ")}`);
