#!/usr/bin/env node
/** Diagnostyka GLB: węzły, siatki, materiały, tekstury, szkielety, animacje i obwiednia. Użycie: node scripts/assets/inspect-glb.mjs plik.glb [--tree] */
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";

const file = process.argv[2];
const tree = process.argv.includes("--tree");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const root = doc.getRoot();
console.log("plik", file, fs.statSync(file).size, "B");
console.log("extensionsUsed", root.listExtensionsUsed().map((e) => e.extensionName));
const scene = root.listScenes()[0];
const b = getBounds(scene);
console.log("bounds", b.min.map((v) => +v.toFixed(4)), b.max.map((v) => +v.toFixed(4)), "size", b.max.map((v, i) => +(v - b.min[i]).toFixed(4)));
let tris = 0;
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
console.log("meshes", root.listMeshes().length, "tris", tris, "nodes", root.listNodes().length, "skins", root.listSkins().length, "materials", root.listMaterials().length, "textures", root.listTextures().length, "animations", root.listAnimations().length);
for (const t of root.listTextures()) {
  const img = t.getImage();
  console.log(" tex", t.getName() || t.getURI(), t.getMimeType(), img?.byteLength, t.getSize());
}
for (const m of root.listMaterials()) {
  const slots = ["BaseColor", "MetallicRoughness", "Normal", "Occlusion", "Emissive"].map((s) => (m[`get${s}Texture`]?.() ? s : null)).filter(Boolean);
  console.log(" mat", m.getName(), "alphaMode", m.getAlphaMode(), "doubleSided", m.getDoubleSided(), "base", m.getBaseColorFactor().map((v) => +v.toFixed(3)), "metal", m.getMetallicFactor(), "rough", m.getRoughnessFactor(), "tex", slots.join(","));
}
const walk = (n, d) => {
  const m = n.getMesh();
  console.log(`${"  ".repeat(d)}${n.getName()}${m ? ` [mesh ${m.getName()} prims ${m.listPrimitives().length}]` : ""}${n.getSkin() ? " [skin]" : ""} t=${n.getTranslation().map((v) => +v.toFixed(4))} r=${n.getRotation().map((v) => +v.toFixed(4))} s=${n.getScale().map((v) => +v.toFixed(4))}`);
  for (const c of n.listChildren()) walk(c, d + 1);
};
if (tree) for (const n of scene.listChildren()) walk(n, 0);
else for (const n of root.listNodes().filter((n) => n.getMesh())) console.log(" meshnode", n.getName(), "parent", n.getParentNode()?.getName(), "t", n.getTranslation().map((v) => +v.toFixed(4)), "s", n.getScale().map((v) => +v.toFixed(4)));
for (const s of root.listSkins()) console.log(" skin", s.getName(), "joints", s.listJoints().length, "skeleton", s.getSkeleton()?.getName());
for (const a of root.listAnimations()) {
  let dur = 0;
  for (const ch of a.listChannels()) dur = Math.max(dur, ch.getSampler().getInput().getMax([0])[0]);
  console.log(" anim", a.getName(), "channels", a.listChannels().length, "dur", +dur.toFixed(3));
}
