#!/usr/bin/env node
/**
 * Potok optymalizacji zasobów 3D (V1): oryginały glTF -> zoptymalizowane GLB + wspólne tekstury WebP + manifest.
 *
 *   npm run assets:build                       # oryginały z .assets-src/ (patrz docs/projekt/zasoby-3d.md)
 *   npm run assets:build -- --src <katalog|zip>
 *   npm run assets:build -- --update-hashes    # świadome przyjęcie nowych oryginałów (zapis sum SHA-256)
 *
 * Wynik jest deterministyczny dla tych samych oryginałów i wersji narzędzi. Oryginałów nie ma w repozytorium ani w bundlu.
 *
 * Decyzje:
 *  - GLB zawierają tylko geometrię (meshopt + kwantyzacja) i nazwy materiałów. Tekstury i parametry materiałów
 *    są wspólne (manifest.materials/textures), dzięki czemu jeden materiał obsługuje wszystkie instancje i modele.
 *  - Tekstury: WebP, maks. 1024 px (wariant LOW 512 px). Normalne tylko dla kory.
 *  - LOD1 dla drzew: uproszczenie meshoptimizer; do zatwierdzenia wizualnego w V2.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO, PropertyType } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { compactPrimitive, dedup, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import {
  BARK_MATERIALS, DEFAULT_SOURCE_DIR, EXTRA_MATERIALS, MESH, MODELS, PACK, PIPELINE_VERSION, SCALE_CLASSES, TEXTURE,
  VERTEX_COLOR_AO_MATERIALS,
} from "./config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "public/models");
const HASH_FILE = path.join(ROOT, "scripts/assets/source-hashes.json");

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const updateHashes = args.includes("--update-hashes");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const rimraf = (p) => fs.rmSync(p, { recursive: true, force: true });

function resolveSource() {
  const given = argValue("--src");
  let dir = path.resolve(ROOT, given ?? DEFAULT_SOURCE_DIR);
  if (!fs.existsSync(dir)) {
    throw new Error(`Brak oryginałów: ${dir}. Pobierz paczkę (docs/projekt/zasoby-3d.md) i podaj --src.`);
  }
  if (dir.endsWith(".zip")) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "megakit-"));
    const zipHash = sha256(fs.readFileSync(dir));
    if (zipHash !== PACK.archive.sha256) {
      throw new Error(`Archiwum ma inną sumę SHA-256 (${zipHash}) niż zatwierdzone (${PACK.archive.sha256}).`);
    }
    execFileSync("unzip", ["-q", dir, "-d", tmp]);
    dir = tmp;
  }
  const gltfDir = fs.existsSync(path.join(dir, "glTF")) ? path.join(dir, "glTF") : dir;
  const licenseFile = [path.join(dir, "License_Pro.txt"), path.join(gltfDir, "License_Pro.txt")].find(fs.existsSync);
  if (!licenseFile) throw new Error("Brak License_Pro.txt w katalogu oryginałów.");
  return { gltfDir, licenseFile };
}

function makeIO() {
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.ERROR))
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
}

function primTriangles(prim) {
  const idx = prim.getIndices();
  return (idx ? idx.getCount() : prim.getAttribute("POSITION").getCount()) / 3;
}

function docStats(doc) {
  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      triangles += primTriangles(prim);
      vertices += prim.getAttribute("POSITION").getCount();
      primitives++;
    }
  }
  return { triangles, vertices, drawCalls: primitives };
}

function measure(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const bark = [];
  const barkAbove = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const isBark = BARK_MATERIALS.includes(prim.getMaterial()?.getName() ?? "");
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], v[k]);
          max[k] = Math.max(max[k], v[k]);
        }
        if (isBark && v[1] >= 0.2 && v[1] <= 0.5) bark.push(Math.hypot(v[0], v[2]));
        if (isBark && v[1] >= 0.2) barkAbove.push([v[1], Math.hypot(v[0], v[2])]);
      }
    }
  }
  // Początek układu modeli leży w podstawie pnia; promień = 80. percentyl odległości punktów kory na wysokości 0,2-0,5 m, poniżej dolnych gałęzi sosen
  // (pomija odstające gałęzie).
  // Gdy w tym pasie jest mało wierzchołków (np. brzozy, olbrzymie sosny i martwe drzewa z paczki Pro mają pierścienie kory co ok. 1 m),
  // bierzemy najniższy pierścień powyżej 0,2 m (poniżej pierwszych konarów) i jego medianę.
  let trunkRadius = null;
  if (bark.length >= 8) {
    bark.sort((a, b) => a - b);
    trunkRadius = bark[Math.floor(bark.length * 0.8)];
  } else if (barkAbove.length > 0) {
    const y0 = Math.min(...barkAbove.map(([y]) => y));
    const ring = barkAbove.filter(([y]) => y <= y0 + 0.3).map(([, r]) => r).sort((a, b) => a - b);
    trunkRadius = ring[Math.floor(ring.length / 2)];
  }
  return { min, max, trunkRadius };
}

function materialSignature(m) {
  const base = m.getBaseColorTexture();
  const normal = m.getNormalTexture();
  return {
    name: m.getName(),
    // Liście wiśni w oryginale mają tryb BLEND; w grze ich nie mieszamy (sortowanie tysięcy kart psuje obraz i kosztuje),
    // więc traktujemy je jak pozostałe liście: odcięcie alfa (MASK, próg 0,5).
    alphaMode: m.getAlphaMode() === "BLEND" ? "MASK" : m.getAlphaMode(),
    alphaCutoff: m.getAlphaMode() === "MASK" ? round(m.getAlphaCutoff(), 3) : m.getAlphaMode() === "BLEND" ? 0.5 : null,
    doubleSided: m.getDoubleSided(),
    baseColorFactor: m.getBaseColorFactor().map((v) => round(v, 3)),
    metallic: round(m.getMetallicFactor(), 3),
    roughness: round(m.getRoughnessFactor(), 3),
    albedoUri: base ? base.getURI() : null,
    normalUri: normal ? normal.getURI() : null,
  };
}

/**
 * Rozlewa kolor krawędzi liści w przezroczysty obszar (oryginał ma tam biel), żeby mipmapy i filtrowanie
 * nie dawały jasnej obwódki wokół liści i płatków.
 */
function bleedEdges(rgba, width, height, passes) {
  const valid = new Uint8Array(width * height);
  for (let i = 0; i < valid.length; i++) valid[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = valid.slice();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (valid[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const j = ny * width + nx;
            if (!valid[j]) continue;
            r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
          }
        }
        if (n > 0) {
          rgba[i * 4] = Math.round(r / n); rgba[i * 4 + 1] = Math.round(g / n); rgba[i * 4 + 2] = Math.round(b / n);
          next[i] = 1;
        }
      }
    }
    valid.set(next);
  }
}

async function loadTexture(file, meta, isMasked) {
  if (!isMasked || !meta.hasAlpha) return sharp(file);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  bleedEdges(data, info.width, info.height, 12);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

const texId = (uri) => path.basename(uri, path.extname(uri)).toLowerCase();

function stripToGeometry(doc, modelId) {
  const root = doc.getRoot();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) throw new Error(`${modelId}: prymityw bez materiału`);
      const color = prim.getAttribute("COLOR_0");
      if (!color) {
        if (VERTEX_COLOR_AO_MATERIALS.includes(mat.getName())) throw new Error(`${modelId}: materiał ${mat.getName()} wymaga COLOR_0`);
        continue;
      }
      let allWhite = true;
      const v = [0, 0, 0, 0];
      for (let i = 0; i < color.getCount() && allWhite; i++) {
        color.getElement(i, v);
        if (v[0] < 0.99 || v[1] < 0.99 || v[2] < 0.99) allWhite = false;
      }
      if (allWhite) prim.setAttribute("COLOR_0", null);
    }
  }
  for (const m of root.listMaterials()) {
    m.setBaseColorTexture(null);
    m.setNormalTexture(null);
    m.setEmissiveTexture(null);
    m.setOcclusionTexture(null);
    m.setMetallicRoughnessTexture(null);
  }
  for (const t of root.listTextures()) t.dispose();
}

/**
 * LOD1: uproszczenie każdego prymitywu osobno (meshoptimizer, z atrybutami normalnych i UV).
 * Flaga Prune usuwa najdrobniejsze oddzielne elementy (cienkie gałązki), bez niej siatka drzew praktycznie
 * się nie upraszcza, bo składa się z rozłącznych powłok.
 */
function simplifyPrimitives(doc, { ratio, error }) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION").getArray();
      const nrm = prim.getAttribute("NORMAL").getArray();
      const uv = prim.getAttribute("TEXCOORD_0").getArray();
      const count = pos.length / 3;
      const attrs = new Float32Array(count * 5);
      for (let i = 0; i < count; i++) {
        attrs.set([nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]], i * 5);
      }
      const indices = new Uint32Array(prim.getIndices().getArray());
      const target = Math.floor((indices.length * ratio) / 3) * 3;
      const [next] = MeshoptSimplifier.simplifyWithAttributes(
        indices, pos, 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], null, target, error, ["Prune"],
      );
      prim.getIndices().setArray(next);
      compactPrimitive(prim);
    }
  }
}

function primitiveSignature(doc, rename) {
  return doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives().map((p) => {
    const name = p.getMaterial().getName();
    return rename?.[name] ?? name;
  })).sort().join(",");
}

function assertGeometryIntact(doc, srcPath, modelId, rename) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const sem of ["POSITION", "NORMAL", "TEXCOORD_0"]) {
        if (!prim.getAttribute(sem)) throw new Error(`${modelId}: po optymalizacji brak atrybutu ${sem}`);
      }
    }
  }
  const expected = srcSignatures.get(srcPath);
  const expectedRenamed = rename ? expected.split(",").map((n) => rename[n] ?? n).sort().join(",") : expected;
  if (expectedRenamed !== primitiveSignature(doc)) {
    throw new Error(`${modelId}: materiały po optymalizacji (${primitiveSignature(doc)}) różnią się od źródła (${expectedRenamed})`);
  }
}

const srcSignatures = new Map();

async function buildGlb(io, srcPath, modelId, lod, rename) {
  const doc = await io.read(srcPath);
  srcSignatures.set(srcPath, primitiveSignature(doc));
  stripToGeometry(doc, modelId);
  if (rename) {
    for (const m of doc.getRoot().listMaterials()) if (rename[m.getName()]) m.setName(rename[m.getName()]);
  }
  if (lod) {
    await doc.transform(weld());
    simplifyPrimitives(doc, lod);
  }
  // UV zostają mimo braku tekstur w GLB (tekstury są współdzielone poza plikiem); materiały nie mogą się zlać po zdjęciu tekstur.
  const steps = [prune({ keepAttributes: true }), dedup({ propertyTypes: [PropertyType.ACCESSOR] }), meshopt({ encoder: MeshoptEncoder, level: "high", ...MESH })];
  await doc.transform(...steps);
  assertGeometryIntact(doc, srcPath, modelId, rename);
  const glb = await io.writeBinary(doc);
  return { glb, ...docStats(doc), bounds: measure(doc) };
}

async function main() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const { gltfDir, licenseFile } = resolveSource();
  const io = makeIO();
  const readIO = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN));

  const ids = new Set();
  for (const m of MODELS) {
    if (ids.has(m.id)) throw new Error(`Zduplikowane id modelu: ${m.id}`);
    ids.add(m.id);
  }

  // 1. Wczytanie oryginałów, spójność materiałów, sumy kontrolne.
  const sourceHashes = {};
  const hashFile = (rel) => {
    sourceHashes[rel] = sha256(fs.readFileSync(path.join(gltfDir, rel)));
  };
  sourceHashes["License_Pro.txt"] = sha256(fs.readFileSync(licenseFile));

  const origDocs = new Map();
  const materials = new Map();
  for (const model of MODELS) {
    const file = `${model.source}.gltf`;
    const doc = await readIO.read(path.join(gltfDir, file));
    origDocs.set(model.id, doc);
    hashFile(file);
    hashFile(`${model.source}.bin`);
    for (const mat of doc.getRoot().listMaterials()) {
      const sig = materialSignature(mat);
      const prev = materials.get(sig.name);
      if (prev && JSON.stringify(prev) !== JSON.stringify(sig)) {
        throw new Error(`Materiał ${sig.name} ma różne definicje w modelach (${model.id}). Wymagana decyzja.`);
      }
      materials.set(sig.name, sig);
    }
  }
  for (const extra of EXTRA_MATERIALS) {
    const base = materials.get(extra.base);
    if (!base) throw new Error(`Materiał dodatkowy ${extra.name}: brak materiału bazowego ${extra.base}`);
    materials.set(extra.name, { ...base, name: extra.name, albedoUri: extra.albedoUri });
  }
  const textureUris = new Set();
  for (const sig of materials.values()) {
    if (sig.albedoUri) textureUris.add(sig.albedoUri);
    if (sig.normalUri) textureUris.add(sig.normalUri);
  }
  for (const uri of textureUris) hashFile(uri);

  const storedHashes = fs.existsSync(HASH_FILE) ? JSON.parse(fs.readFileSync(HASH_FILE, "utf8")) : null;
  if (!storedHashes || updateHashes) {
    fs.writeFileSync(HASH_FILE, JSON.stringify({ pack: PACK.id, archiveSha256: PACK.archive.sha256, files: sourceHashes }, null, 2) + "\n");
    console.log(`Zapisano sumy oryginałów: ${path.relative(ROOT, HASH_FILE)}`);
  } else {
    const bad = Object.entries(sourceHashes).filter(([k, v]) => storedHashes.files[k] !== v);
    if (bad.length > 0) {
      throw new Error(`Oryginały różnią się od zatwierdzonych (SHA-256): ${bad.map(([k]) => k).join(", ")}`);
    }
  }

  // 2. Wyjście.
  for (const d of ["glb", "textures", "licenses"]) {
    rimraf(path.join(OUT, d));
    fs.mkdirSync(path.join(OUT, d), { recursive: true });
  }
  fs.copyFileSync(licenseFile, path.join(OUT, PACK.license.textFile));

  // 3. Tekstury.
  const textures = [];
  for (const uri of [...textureUris].sort()) {
    const id = texId(uri);
    const src = path.join(gltfDir, uri);
    const meta = await sharp(src).metadata();
    const isNormal = [...materials.values()].some((m) => m.normalUri === uri);
    const masked = [...materials.values()].some((m) => m.alphaMode === "MASK" && m.albedoUri === uri);
    const encode = async (max, file) => {
      const img = (await loadTexture(src, meta, masked)).resize({ width: max, height: max, fit: "inside", withoutEnlargement: true });
      const webpOpts = isNormal ? TEXTURE.webpNormal : TEXTURE.webp;
      const { data, info } = await img.webp(webpOpts).toBuffer({ resolveWithObject: true });
      fs.writeFileSync(path.join(OUT, file), data);
      return { file, width: info.width, height: info.height, bytes: data.length };
    };
    const full = await encode(TEXTURE.fullMax, `textures/${id}.webp`);
    const low = await encode(TEXTURE.lowMax, `textures/${id}.512.webp`);
    textures.push({
      id, kind: isNormal ? "normal" : "albedo", colorSpace: isNormal ? "linear" : "srgb",
      hasAlpha: Boolean(meta.hasAlpha), sourceFile: uri,
      sourceSize: [meta.width, meta.height], sourceBytes: fs.statSync(src).size,
      full, low,
    });
  }

  // 4. Materiały współdzielone.
  const materialEntries = [...materials.values()].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({
    id: s.name.toLowerCase(),
    sourceName: s.name,
    albedo: s.albedoUri ? texId(s.albedoUri) : null,
    normal: s.normalUri ? texId(s.normalUri) : null,
    baseColorFactor: s.baseColorFactor,
    alphaMode: s.alphaMode,
    alphaCutoff: s.alphaCutoff,
    doubleSided: s.doubleSided,
    vertexColors: VERTEX_COLOR_AO_MATERIALS.includes(s.name),
    metalness: s.metallic,
    roughness: s.roughness,
  }));

  // 5. Modele.
  const models = [];
  for (const cfg of MODELS) {
    const srcPath = path.join(gltfDir, `${cfg.source}.gltf`);
    const orig = origDocs.get(cfg.id);
    const origBounds = measure(orig);
    const origStats = docStats(orig);
    const lod0 = await buildGlb(io, srcPath, cfg.id, null, cfg.materialRename);
    const file0 = `glb/${cfg.id}.glb`;
    fs.writeFileSync(path.join(OUT, file0), lod0.glb);

    const s = cfg.baseScale;
    const size = origBounds.max.map((v, i) => round((v - origBounds.min[i]) * s, 3));
    const usedMats = [...new Set(orig.getRoot().listMeshes().flatMap((m) => m.listPrimitives().map((p) => (cfg.materialRename?.[p.getMaterial().getName()] ?? p.getMaterial().getName()).toLowerCase())))];

    let collision = null;
    if (cfg.collision === "trunk") {
      if (origBounds.trunkRadius == null) throw new Error(`${cfg.id}: brak kory do pomiaru pnia`);
      collision = { shape: "circle", r: round(origBounds.trunkRadius * s, 3), height: size[1], source: "measured-trunk" };
    } else if (cfg.collision === "footprint") {
      const r = ((size[0] + size[2]) / 4) * 0.85;
      collision = { shape: "circle", r: round(r, 3), height: size[1], source: "estimated-footprint" };
    }

    const levels = [{ level: 0, file: file0, triangles: lod0.triangles, vertices: lod0.vertices, drawCalls: lod0.drawCalls, bytes: lod0.glb.length, minDistance: 0 }];
    if (cfg.lod) {
      const lod1 = await buildGlb(io, srcPath, cfg.id, cfg.lod, cfg.materialRename);
      const file1 = `glb/${cfg.id}.lod1.glb`;
      fs.writeFileSync(path.join(OUT, file1), lod1.glb);
      const drift = lod1.bounds.max.map((v, i) => Math.abs(v - lod0.bounds.max[i]) + Math.abs(lod1.bounds.min[i] - lod0.bounds.min[i]));
      levels.push({
        level: 1, file: file1, triangles: lod1.triangles, vertices: lod1.vertices, drawCalls: lod1.drawCalls, bytes: lod1.glb.length,
        minDistance: cfg.lod1MinDistance, simplify: cfg.lod, boundsDrift: round(Math.max(...drift) * s, 3),
      });
    }

    models.push({
      id: cfg.id,
      name: cfg.source.replace(/_/g, " "),
      pack: PACK.id,
      sourceName: cfg.source,
      sourceFile: `glTF/${cfg.source}.gltf`,
      author: PACK.author,
      license: PACK.license.id,
      attribution: PACK.attribution.suggested,
      category: cfg.category,
      subcategory: cfg.subcategory,
      tags: cfg.tags,
      file: file0,
      bytes: lod0.glb.length,
      triangles: lod0.triangles,
      vertices: lod0.vertices,
      drawCalls: lod0.drawCalls,
      sourceTriangles: origStats.triangles,
      materials: usedMats,
      baseScale: s,
      bounds: { min: origBounds.min.map((v) => round(v * s, 3)), max: origBounds.max.map((v) => round(v * s, 3)), size },
      collision,
      lod: levels,
      placeholder: false,
      approvedAt: "2026-10-15",
      visualReview: "pending-v2",
    });
  }

  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const glbBytes = sum(models, (m) => sum(m.lod, (l) => l.bytes));
  const textureBytesFull = sum(textures, (t) => t.full.bytes);
  const textureBytesLow = sum(textures, (t) => t.low.bytes);
  const manifest = {
    schemaVersion: 1,
    pipeline: {
      version: PIPELINE_VERSION,
      tools: {
        "@gltf-transform/core": pkgVersion("@gltf-transform/core"),
        "@gltf-transform/functions": pkgVersion("@gltf-transform/functions"),
        meshoptimizer: pkgVersion("meshoptimizer"),
        sharp: pkgVersion("sharp"),
      },
      mesh: MESH,
      textures: { fullMax: TEXTURE.fullMax, lowMax: TEXTURE.lowMax, format: "webp" },
      sourceHashesFile: "scripts/assets/source-hashes.json",
    },
    packs: [{ ...PACK, textFileSha256: sourceHashes["License_Pro.txt"] }],
    scaleClasses: SCALE_CLASSES,
    textures,
    materials: materialEntries,
    models,
    totals: {
      models: models.length,
      glbFiles: sum(models, (m) => m.lod.length),
      glbBytes,
      textureCount: textures.length,
      textureBytesFull,
      textureBytesLow,
      materialCount: materialEntries.length,
      totalBytesFull: glbBytes + textureBytesFull,
      totalBytesLow: glbBytes + textureBytesLow,
    },
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Gotowe: ${models.length} modeli, ${textures.length} tekstur, ${materialEntries.length} materiałów -> ${path.relative(ROOT, OUT)}`);
}

function pkgVersion(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")).version;
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
