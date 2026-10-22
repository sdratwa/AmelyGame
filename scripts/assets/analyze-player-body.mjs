#!/usr/bin/env node
/**
 * Analiza bazowej siatki gracza (tylko odczyt, nic nie zapisuje): regiony wag, granice, kolory atlasu i wymiary głowy.
 * Wynik jest podstawą decyzji, czy z siatki da się bezpiecznie wygenerować ubrania i jak dopasować fryzury.
 *
 *   node scripts/assets/analyze-player-body.mjs [plik.glb] [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? path.join(root, "public/characters/Miasto_Dziewczynka_9_animacji_beta.glb");
const asJson = args.includes("--json");

/** Region ciała dla kości (nazwy Mixamo bez prefiksu `mixamorig:`). */
export function regionOfBone(name) {
  const n = name.replace(/^mixamorig:?/, "");
  if (/^HeadTop|^Head$|^Neck/.test(n)) return n.startsWith("Neck") ? "neck" : "head";
  if (/Hand/.test(n)) return n.startsWith("Left") ? "handL" : "handR";
  if (/Shoulder|Arm|ForeArm/.test(n)) return n.startsWith("Left") ? "armL" : "armR";
  if (/ToeBase|Toe_End|Foot/.test(n)) return n.startsWith("Left") ? "footL" : "footR";
  if (/UpLeg|Leg/.test(n)) return n.startsWith("Left") ? "legL" : "legR";
  if (/^Spine/.test(n)) return "torso";
  if (/^Hips/.test(n)) return "hips";
  return "other";
}

const io = new NodeIO();
const doc = await io.read(file);
const rootDoc = doc.getRoot();
const mesh = rootDoc.listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const skin = rootDoc.listSkins()[0];
const joints = skin.listJoints();
const pos = prim.getAttribute("POSITION");
const uv = prim.getAttribute("TEXCOORD_0");
const J = prim.getAttribute("JOINTS_0");
const W = prim.getAttribute("WEIGHTS_0");
const idx = prim.getIndices();
const n = pos.getCount();

const regions = new Array(n);
const headWeight = new Float32Array(n);
const p = [0, 0, 0];
const jv = [0, 0, 0, 0];
const wv = [0, 0, 0, 0];
for (let i = 0; i < n; i++) {
  J.getElement(i, jv);
  W.getElement(i, wv);
  const acc = {};
  for (let k = 0; k < 4; k++) {
    if (wv[k] <= 0) continue;
    const r = regionOfBone(joints[jv[k]].getName());
    acc[r] = (acc[r] ?? 0) + wv[k];
  }
  let best = "other";
  let bw = -1;
  for (const [r, w] of Object.entries(acc)) if (w > bw) { bw = w; best = r; }
  regions[i] = best;
  headWeight[i] = acc.head ?? 0;
}

const tri = [];
const count = idx ? idx.getCount() / 3 : n / 3;
for (let t = 0; t < count; t++) {
  tri.push(idx ? [idx.getScalar(t * 3), idx.getScalar(t * 3 + 1), idx.getScalar(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2]);
}

const stats = {};
for (let i = 0; i < n; i++) {
  pos.getElement(i, p);
  const r = regions[i];
  const s = (stats[r] ??= { vertices: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
  s.vertices++;
  for (let k = 0; k < 3; k++) {
    s.min[k] = Math.min(s.min[k], p[k]);
    s.max[k] = Math.max(s.max[k], p[k]);
  }
}
const mixedTriangles = tri.filter(([a, b, c]) => !(regions[a] === regions[b] && regions[b] === regions[c])).length;
const boundaryPairs = {};
for (const [a, b, c] of tri) {
  const set = [...new Set([regions[a], regions[b], regions[c]])].sort();
  if (set.length > 1) boundaryPairs[set.join("|")] = (boundaryPairs[set.join("|")] ?? 0) + 1;
}

// Tekstura bazowa: średni kolor wierzchołków regionu (próbkowanie atlasu w UV).
const material = prim.getMaterial();
const tex = material?.getBaseColorTexture();
let colors = null;
let atlas = null;
if (tex) {
  const image = tex.getImage();
  const { data, info } = await sharp(Buffer.from(image)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  atlas = { width: info.width, height: info.height };
  const sample = (u, v) => {
    const x = Math.max(0, Math.min(info.width - 1, Math.floor((u % 1) * info.width)));
    const y = Math.max(0, Math.min(info.height - 1, Math.floor((v % 1) * info.height)));
    const o = (y * info.width + x) * 3;
    return [data[o], data[o + 1], data[o + 2]];
  };
  const acc = {};
  const uvv = [0, 0];
  for (let i = 0; i < n; i++) {
    uv.getElement(i, uvv);
    const c = sample(uvv[0], uvv[1]);
    const a = (acc[regions[i]] ??= { n: 0, sum: [0, 0, 0], sq: [0, 0, 0] });
    a.n++;
    for (let k = 0; k < 3; k++) {
      a.sum[k] += c[k];
      a.sq[k] += c[k] * c[k];
    }
  }
  colors = Object.fromEntries(
    Object.entries(acc).map(([r, a]) => {
      const mean = a.sum.map((s) => s / a.n);
      const std = a.sq.map((s, k) => Math.sqrt(Math.max(0, s / a.n - mean[k] ** 2)));
      return [r, { mean: mean.map(Math.round), std: std.map(Math.round) }];
    }),
  );
}

// Głowa: wymiary z wierzchołków o przeważającej wadze Head (tak jak dopasowanie fryzur w grze).
const head = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], n: 0 };
for (let i = 0; i < n; i++) {
  if (headWeight[i] < 0.5) continue;
  pos.getElement(i, p);
  head.n++;
  for (let k = 0; k < 3; k++) {
    head.min[k] = Math.min(head.min[k], p[k]);
    head.max[k] = Math.max(head.max[k], p[k]);
  }
}
const headDims = head.n
  ? { vertices: head.n, width: head.max[0] - head.min[0], height: head.max[1] - head.min[1], depth: head.max[2] - head.min[2], top: head.max[1], bottom: head.min[1], centerX: (head.max[0] + head.min[0]) / 2, centerZ: (head.max[2] + head.min[2]) / 2 }
  : null;

// Gładkość linii cięcia: ile trójkątów przecina dany poziom Y (im mniej, tym czystsza krawędź).
const cuts = {};
for (const [name, y] of Object.entries({ talia: 0.55, biodra: 0.5, kolano: 0.28, szyja: 0.86 })) {
  let crossing = 0;
  for (const [a, b, c] of tri) {
    const ys = [a, b, c].map((v) => (pos.getElement(v, p), p[1]));
    if (Math.min(...ys) < y && Math.max(...ys) > y) crossing++;
  }
  cuts[name] = { y, crossingTriangles: crossing };
}

const report = {
  file: path.relative(root, file),
  vertices: n,
  triangles: count,
  joints: joints.length,
  uv: !!uv,
  atlas,
  regions: Object.fromEntries(Object.entries(stats).map(([r, s]) => [r, { vertices: s.vertices, y: [+s.min[1].toFixed(3), +s.max[1].toFixed(3)], x: [+s.min[0].toFixed(3), +s.max[0].toFixed(3)] }])),
  mixedTriangles,
  boundaryPairs,
  colors,
  head: headDims,
  cuts,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Plik: ${report.file}`);
  console.log(`Wierzcholki: ${n}, trojkaty: ${count}, kosci: ${joints.length}, atlas: ${atlas ? `${atlas.width}x${atlas.height}` : "brak"}`);
  console.log("\nRegiony (dominujaca waga kosci):");
  for (const [r, s] of Object.entries(report.regions)) console.log(`  ${r.padEnd(6)} ${String(s.vertices).padStart(6)} wierzch.  Y ${s.y[0]}..${s.y[1]}  X ${s.x[0]}..${s.x[1]}`);
  console.log(`\nTrojkaty na granicach regionow: ${mixedTriangles} z ${count}`);
  for (const [pair, c] of Object.entries(boundaryPairs).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${pair}: ${c}`);
  if (colors) {
    console.log("\nSredni kolor atlasu (RGB) i odchylenie w regionie:");
    for (const [r, c] of Object.entries(colors)) console.log(`  ${r.padEnd(6)} srednia ${c.mean.join(",")}  odchylenie ${c.std.join(",")}`);
  }
  if (headDims) {
    console.log(`\nGlowa (waga Head >= 0.5): ${headDims.vertices} wierzch., szer. ${headDims.width.toFixed(3)}, wys. ${headDims.height.toFixed(3)}, gl. ${headDims.depth.toFixed(3)}, Y ${headDims.bottom.toFixed(3)}..${headDims.top.toFixed(3)}`);
  }
  console.log("\nLinie ciecia (trojkaty przecinajace poziom Y):");
  for (const [name, c] of Object.entries(cuts)) console.log(`  ${name.padEnd(7)} Y=${c.y}: ${c.crossingTriangles}`);
}
