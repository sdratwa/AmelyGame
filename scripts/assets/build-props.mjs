#!/usr/bin/env node
/**
 * Potok zasobów rekwizytów (poza paczką Quaternius): `assets/source/*.glb` -> `public/props/*.glb` + `public/props/props.json`.
 *
 *   npm run assets:props
 *
 * Skrzynia baśniowa dostarczona przez autora (miasto_skrzynia_basniowa.glb) nie ma materiałów ani normalnych: wygląd
 * wynika wyłącznie z kolorów wierzchołków (COLOR_0, VEC4 ubyte). Potok:
 *  - scala 21 węzłów w dwie siatki: korpus i pokrywa (pokrywa zostaje dzieckiem węzła Lid_Hinge, więc współrzędne
 *    pokrywy są względem zawiasu i obrót wokół osi X jest obrotem wokół zawiasu),
 *  - liczy normalne z progiem załamania (gładkie fazy, ostre krawędzie), zachowuje kolory 1:1 (alfa == 1 jest sprawdzana),
 *  - zapisuje jeden wspólny materiał (kolory wierzchołków, bez tekstur) i metadane (pivot, wymiary, kąt otwarcia).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Document, NodeIO } from "@gltf-transform/core";
import { getBounds, weld } from "@gltf-transform/functions";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "assets/source/miasto_skrzynia_basniowa.glb");
const OUT_DIR = path.join(ROOT, "public/props");
const CREASE_ANGLE = (35 * Math.PI) / 180;

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const io = new NodeIO();
const src = await io.read(SRC);
const scene = src.getRoot().listScenes()[0];
const world = scene.listChildren()[0];
const hinge = world.listChildren().find((n) => n.getName() === "Lid_Hinge");
if (!hinge) throw new Error("Brak węzła Lid_Hinge w źródle: nie wolno zgadywać pivotu pokrywy.");
const bodyNodes = world.listChildren().filter((n) => n.getMesh());
const lidNodes = hinge.listChildren().filter((n) => n.getMesh());
if (bodyNodes.length === 0 || lidNodes.length === 0) throw new Error("Źródło nie ma korpusu albo pokrywy.");
for (const n of [...bodyNodes, ...lidNodes]) {
  const t = n.getTranslation();
  const r = n.getRotation();
  const s = n.getScale();
  if (t.some((v) => v !== 0) || r.some((v, i) => v !== [0, 0, 0, 1][i]) || s.some((v) => v !== 1)) {
    throw new Error(`Węzeł ${n.getName()} ma własną transformację; potok zakłada tożsamość względem rodzica.`);
  }
}

function mergeNodes(nodes) {
  const positions = [];
  const colors = [];
  const stats = { sourceMeshes: nodes.length, sourceTriangles: 0 };
  for (const node of nodes) {
    for (const prim of node.getMesh().listPrimitives()) {
      if (prim.getMaterial()) throw new Error(`${node.getName()}: źródło nie powinno mieć materiałów (kolory wierzchołków).`);
      const pos = prim.getAttribute("POSITION");
      const col = prim.getAttribute("COLOR_0");
      const idx = prim.getIndices();
      if (!col || !idx) throw new Error(`${node.getName()}: brak kolorów albo indeksów.`);
      const p = [0, 0, 0];
      const c = [0, 0, 0, 0];
      for (let i = 0; i < idx.getCount(); i++) {
        const v = idx.getScalar(i);
        pos.getElement(v, p);
        col.getElement(v, c);
        if (c.length === 4 && Math.abs(c[3] - 1) > 1e-6) throw new Error(`${node.getName()}: kolor wierzchołka ma alfę ${c[3]} (oczekiwano 1).`);
        positions.push(p[0], p[1], p[2]);
        colors.push(c[0], c[1], c[2]);
      }
      stats.sourceTriangles += idx.getCount() / 3;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const creased = toCreasedNormals(geometry, CREASE_ANGLE);
  return { geometry: creased, stats };
}

const body = mergeNodes(bodyNodes);
const lid = mergeNodes(lidNodes);

const doc = new Document();
doc.getRoot().getAsset().generator = "miasto build-props";
const buffer = doc.createBuffer();
const material = doc
  .createMaterial("ChestFairy")
  .setBaseColorFactor([1, 1, 1, 1])
  .setMetallicFactor(0)
  .setRoughnessFactor(0.72);

function toMesh(name, geometry) {
  const position = doc.createAccessor(`${name}.pos`, buffer).setType("VEC3").setArray(new Float32Array(geometry.getAttribute("position").array));
  const normal = doc.createAccessor(`${name}.nrm`, buffer).setType("VEC3").setArray(new Float32Array(geometry.getAttribute("normal").array));
  const linear = geometry.getAttribute("color").array;
  const bytes = new Uint8Array(linear.length);
  for (let i = 0; i < linear.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, linear[i])) * 255);
  const color = doc.createAccessor(`${name}.col`, buffer).setType("VEC3").setArray(bytes).setNormalized(true);
  const prim = doc.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setAttribute("COLOR_0", color).setMaterial(material);
  return doc.createMesh(name).addPrimitive(prim);
}

const hingePos = hinge.getTranslation();
const root = doc.createNode("Chest");
const bodyNode = doc.createNode("Chest_Body").setMesh(toMesh("Chest_Body", body.geometry));
const hingeNode = doc.createNode("Lid_Hinge").setTranslation([...hingePos]);
const lidNode = doc.createNode("Chest_Lid").setMesh(toMesh("Chest_Lid", lid.geometry));
hingeNode.addChild(lidNode);
root.addChild(bodyNode).addChild(hingeNode);
doc.createScene("Chest").addChild(root);
await doc.transform(weld());

const glb = await io.writeBinary(doc);
fs.mkdirSync(OUT_DIR, { recursive: true });
const file = "chest.fairy.glb";
fs.writeFileSync(path.join(OUT_DIR, file), glb);

const check = await io.readBinary(glb);
const triangles = check
  .getRoot()
  .listMeshes()
  .reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
const bounds = getBounds(check.getRoot().listScenes()[0]);

const manifest = {
  schemaVersion: 1,
  props: [
    {
      id: "chest.fairy",
      file,
      bytes: glb.length,
      triangles,
      bodyNode: "Chest_Body",
      hingeNode: "Lid_Hinge",
      lidNode: "Chest_Lid",
      hinge: { x: round(hingePos[0]), y: round(hingePos[1]), z: round(hingePos[2]) },
      /** Przód skrzyni (zamek) jest po stronie +Z; pokrywa rozciąga się od zawiasu ku +Z, więc otwiera ją obrót o ujemny kąt wokół osi X. */
      front: "+z",
      openAxis: "x",
      openAngleDeg: -105,
      sourceBounds: { min: bounds.min.map((v) => round(v)), max: bounds.max.map((v) => round(v)) },
      /** Skala do świata: szerokość ok. 1 m (źródło 1,19 m). */
      worldScale: 0.85,
      source: {
        file: "assets/source/miasto_skrzynia_basniowa.glb",
        sha256: sha256(fs.readFileSync(SRC)),
        sourceMeshes: body.stats.sourceMeshes + lid.stats.sourceMeshes,
        sourceTriangles: body.stats.sourceTriangles + lid.stats.sourceTriangles,
        author: "dostarczone przez autora projektu Miasto",
        note: "Źródło bez materiałów i normalnych: kolory wierzchołków (COLOR_0). Normalne liczone w potoku (próg załamania 35 stopni).",
      },
    },
  ],
};
fs.writeFileSync(path.join(OUT_DIR, "props.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`chest.fairy: ${glb.length} B, ${triangles} trójkątów, bounds ${JSON.stringify(manifest.props[0].sourceBounds)}`);
