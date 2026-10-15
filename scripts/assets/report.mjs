#!/usr/bin/env node
/** Raport z manifestu: modele, rozmiary, trójkąty, wywołania rysowania, tekstury i sumy. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const m = JSON.parse(fs.readFileSync(path.join(root, "public/models/manifest.json"), "utf8"));
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;

console.log("MODELE");
console.log("id".padEnd(24), "kat.".padEnd(12), "tri".padStart(6), "src tri".padStart(8), "draw".padStart(5), "GLB".padStart(10), "LOD1 tri".padStart(9), "LOD1 GLB".padStart(10), "kolizja");
for (const x of m.models) {
  const l1 = x.lod[1];
  console.log(
    x.id.padEnd(24), x.category.padEnd(12), String(x.triangles).padStart(6), String(x.sourceTriangles).padStart(8),
    String(x.drawCalls).padStart(5), kb(x.bytes).padStart(10), (l1 ? String(l1.triangles) : "-").padStart(9),
    (l1 ? kb(l1.bytes) : "-").padStart(10), x.collision ? `r=${x.collision.r} h=${x.collision.height}` : "brak",
  );
}
console.log("\nTEKSTURY (oryginał -> 1024 / 512)");
for (const t of m.textures) {
  console.log(t.id.padEnd(28), t.kind.padEnd(7), `${t.sourceSize.join("x")}`.padEnd(10), kb(t.sourceBytes).padStart(10), "->", `${t.full.width}x${t.full.height}`.padEnd(10), kb(t.full.bytes).padStart(10), "|", `${t.low.width}x${t.low.height}`.padEnd(9), kb(t.low.bytes).padStart(9));
}
console.log("\nMATERIAŁY");
for (const x of m.materials) console.log(x.id.padEnd(24), x.alphaMode.padEnd(7), `albedo=${x.albedo}`, x.normal ? `normal=${x.normal}` : "", x.vertexColors ? "vertexColors" : "");
const t = m.totals;
const srcTex = m.textures.reduce((a, x) => a + x.sourceBytes, 0);
console.log("\nSUMY");
console.log(`modele: ${t.models}, pliki GLB (z LOD): ${t.glbFiles}, GLB razem: ${mb(t.glbBytes)}`);
console.log(`tekstury: ${t.textureCount} (oryginały ${mb(srcTex)}) -> 1024 px: ${mb(t.textureBytesFull)}, 512 px: ${mb(t.textureBytesLow)}; materiały: ${t.materialCount}`);
console.log(`razem do pobrania: HIGH/MEDIUM ${mb(t.totalBytesFull)}, LOW ${mb(t.totalBytesLow)}`);
console.log(`oryginalne trójkąty: ${m.models.reduce((a, x) => a + x.sourceTriangles, 0)}, po optymalizacji: ${m.models.reduce((a, x) => a + x.triangles, 0)}`);
