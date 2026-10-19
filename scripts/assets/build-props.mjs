#!/usr/bin/env node
/**
 * Potok rekwizytów (poza paczką Quaternius): `assets/source/*.glb` -> `public/props/*.glb` + `public/props/props.json`.
 *
 *   npm run assets:props
 *
 * Skrzynia ze skarbem (treasure_chest_3d_model.glb, dostarczona przez autora) ma trzy siatki: korpus (tripo_part_0),
 * pokrywę (tripo_part_1) i zamek (tripo_part_2), każda z własną teksturą koloru, bez zawiasu i bez animacji. Potok:
 *  - wylicza pivot zawiasu z geometrii pokrywy (tylna krawędź, dolna linia pokrywy) i tworzy węzeł `Lid_Hinge`,
 *  - przesuwa wierzchołki pokrywy do układu zawiasu (obrót wokół początku układu = obrót wokół zawiasu),
 *  - zamek zostaje nieruchomy względem korpusu (węzeł `Chest_Lock`), bo wystaje z korpusu pod pokrywę,
 *  - zmniejsza tekstury (korpus 4096 -> 2048, WebP), nie zmienia geometrii poza przesunięciem pokrywy,
 *  - zapisuje metadane (pivot, oś, kąt, wymiary, rozmiary tekstur, SHA-256 oryginału) w props.json.
 * Oryginał zostaje w `assets/source/`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "assets/source/treasure_chest_3d_model.glb");
const OUT_DIR = path.join(ROOT, "public/props");
const FILE = "chest.treasure.glb";
const WEBP_QUALITY = 82;
/** Najdłuższy bok tekstury w grze: korpus 4096 -> 2048 (ok. 2 piksele na milimetr przy skali 1 m), reszta bez zmian. */
const MAX_TEXTURE = 2048;
const HINGE_EDGE_BAND = 0.02;

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const src = await io.read(SRC);
const srcMeshes = Object.fromEntries(
  src
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh())
    .map((n) => [n.getName(), n.getMesh()]),
);
for (const name of ["tripo_part_0", "tripo_part_1", "tripo_part_2"]) {
  if (!srcMeshes[name]) throw new Error(`Źródło nie ma węzła ${name}: struktura skrzyni się zmieniła.`);
}

function readPrimitive(mesh) {
  const prims = mesh.listPrimitives();
  if (prims.length !== 1) throw new Error(`${mesh.getName()}: oczekiwano jednego prymitywu.`);
  const p = prims[0];
  return {
    position: Float32Array.from(p.getAttribute("POSITION").getArray()),
    normal: Float32Array.from(p.getAttribute("NORMAL").getArray()),
    uv: Float32Array.from(p.getAttribute("TEXCOORD_0").getArray()),
    indices: Uint32Array.from(p.getIndices().getArray()),
    material: p.getMaterial(),
  };
}

const parts = { body: readPrimitive(srcMeshes.tripo_part_0), lid: readPrimitive(srcMeshes.tripo_part_1), lock: readPrimitive(srcMeshes.tripo_part_2) };

function bounds(pos) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  }
  return { min, max };
}

const lidBounds = bounds(parts.lid.position);
let hingeY = Infinity;
for (let i = 0; i < parts.lid.position.length; i += 3) {
  if (parts.lid.position[i + 2] <= lidBounds.min[2] + HINGE_EDGE_BAND) hingeY = Math.min(hingeY, parts.lid.position[i + 1]);
}
const hinge = [round((lidBounds.min[0] + lidBounds.max[0]) / 2, 3), round(hingeY, 3), round(lidBounds.min[2], 3)];

const doc = new Document();
doc.getRoot().getAsset().generator = "miasto build-props";
const webp = doc.createExtension(EXTTextureWebP).setRequired(true);
void webp;
const buffer = doc.createBuffer();
const textureInfo = [];

async function toTexture(name, material) {
  const srcTex = material.getBaseColorTexture();
  const image = sharp(Buffer.from(srcTex.getImage()));
  const meta = await image.metadata();
  const resize = Math.max(meta.width, meta.height) > MAX_TEXTURE;
  const out = await (resize ? image.resize(MAX_TEXTURE, MAX_TEXTURE, { fit: "fill", kernel: "lanczos3" }) : image).webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
  textureInfo.push({ node: name, sourceSize: [meta.width, meta.height], size: [out.info.width, out.info.height], bytes: out.data.length });
  return doc.createTexture(`${name}_basecolor`).setImage(new Uint8Array(out.data)).setMimeType("image/webp");
}

async function toNode(nodeName, part, offset) {
  const position = new Float32Array(part.position);
  for (let i = 0; i < position.length; i += 3) {
    position[i] -= offset[0];
    position[i + 1] -= offset[1];
    position[i + 2] -= offset[2];
  }
  const acc = (suffix, type, array) => doc.createAccessor(`${nodeName}.${suffix}`, buffer).setType(type).setArray(array);
  const material = doc
    .createMaterial(nodeName)
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(part.material.getRoughnessFactor())
    .setDoubleSided(part.material.getDoubleSided())
    .setBaseColorTexture(await toTexture(nodeName, part.material));
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", acc("pos", "VEC3", position))
    .setAttribute("NORMAL", acc("nrm", "VEC3", part.normal))
    .setAttribute("TEXCOORD_0", acc("uv", "VEC2", part.uv))
    .setIndices(acc("idx", "SCALAR", part.indices))
    .setMaterial(material);
  return doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim));
}

const root = doc.createNode("Chest");
const bodyNode = await toNode("Chest_Body", parts.body, [0, 0, 0]);
const lockNode = await toNode("Chest_Lock", parts.lock, [0, 0, 0]);
const lidNode = await toNode("Chest_Lid", parts.lid, hinge);
const hingeNode = doc.createNode("Lid_Hinge").setTranslation(hinge);
hingeNode.addChild(lidNode);
root.addChild(bodyNode).addChild(lockNode).addChild(hingeNode);
doc.createScene("Chest").addChild(root);

const glb = await io.writeBinary(doc);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, FILE), glb);

const check = await io.readBinary(glb);
const triangles = check
  .getRoot()
  .listMeshes()
  .reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
const sourceTriangles = Object.values(srcMeshes).reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
const sourceBounds = getBounds(src.getRoot().listScenes()[0]);

const manifestPath = path.join(OUT_DIR, "props.json");
const entry = {
  id: "chest.treasure",
  file: FILE,
  bytes: glb.length,
  triangles,
  bodyNode: "Chest_Body",
  hingeNode: "Lid_Hinge",
  lidNode: "Chest_Lid",
  lockNode: "Chest_Lock",
  hinge: { x: hinge[0], y: hinge[1], z: hinge[2] },
  /** Przód skrzyni (zamek) jest po stronie +Z; pokrywa rozciąga się od zawiasu ku +Z, więc otwiera ją obrót o ujemny kąt wokół osi X. */
  front: "+z",
  openAxis: "x",
  openAngleDeg: -105,
  sourceBounds: { min: sourceBounds.min.map((v) => round(v)), max: sourceBounds.max.map((v) => round(v)) },
  /** Skala do świata: model ma 1 m szerokości, więc 1:1 (collider skrzyni to 1,0 x 0,8 m). */
  worldScale: 1,
  textures: textureInfo,
  source: {
    file: "assets/source/treasure_chest_3d_model.glb",
    sha256: sha256(fs.readFileSync(SRC)),
    sourceMeshes: 3,
    sourceTriangles,
    author: "dostarczone przez autora projektu Miasto",
    note: "Trzy siatki z teksturami koloru; pivot zawiasu wyliczony z geometrii pokrywy (tylna dolna krawędź), pokrywa przesunięta do układu zawiasu.",
  },
};
const existing = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { props: [] };
const props = [...existing.props.filter((p) => p.id !== entry.id && p.id !== "chest.fairy"), entry];
fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, props }, null, 2) + "\n");
console.log(`${entry.id}: ${glb.length} B, ${triangles} trójkątów, zawias ${JSON.stringify(entry.hinge)}, tekstury ${JSON.stringify(textureInfo.map((t) => t.size.join("x")))}`);
