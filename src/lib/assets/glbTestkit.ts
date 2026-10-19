import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

/**
 * Narzędzia testów dla modeli GLB z teksturami WebP. GLTFLoader nie dekoduje obrazów w Node (brak DOM), więc do testów
 * struktury czytamy plik przez gltf-transform, usuwamy tekstury (geometria, szkielet i animacje zostają bez zmian) i
 * parsujemy go zwykłym GLTFLoaderem. Pełny GLB z teksturami jest sprawdzany osobno przez `readGlbDocument`.
 */
export const readGlbDocument = (file: string) => new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);

export async function parseWithoutTextures(file: string): Promise<GLTF> {
  const doc = await readGlbDocument(file);
  const root = doc.getRoot();
  for (const t of root.listTextures()) t.dispose();
  for (const e of root.listExtensionsUsed()) e.dispose();
  const bytes = await new NodeIO().writeBinary(doc);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new GLTFLoader().parseAsync(buf, "");
}

export const publicDir = (...parts: string[]) => path.join(process.cwd(), "public", ...parts);

export const readJsonFile = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
