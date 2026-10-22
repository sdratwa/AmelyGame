/**
 * Manifest zasobów 3D (`public/models/manifest.json`), generowany przez `npm run assets:build`.
 * Każdy model używany w grze musi mieć w nim wpis (id, licencja, trójkąty, kolizja, LOD, status).
 */

/** `decor` = kamyki i płatki (drobne ozdoby), `path` = płyty brukowe (tylko paczka Pro). */
export type AssetCategory = "tree" | "bush" | "undergrowth" | "grass" | "flower" | "mushroom" | "rock" | "decor" | "path";

export const ASSET_CATEGORIES: readonly AssetCategory[] = [
  "tree", "bush", "undergrowth", "grass", "flower", "mushroom", "rock", "decor", "path",
];

/** Uproszczona kolizja modelu w metrach, dla instancji o skali 1 (uwzględnia `baseScale`). Brak = da się przejść. */
export type ModelCollision = {
  shape: "circle";
  r: number;
  height: number;
  source: "measured-trunk" | "estimated-footprint";
};

export type LodLevel = {
  level: number;
  file: string;
  triangles: number;
  vertices: number;
  drawCalls: number;
  bytes: number;
  /** Odległość kamery (m) od której poziom jest używany w profilu HIGH. */
  minDistance: number;
  simplify?: { ratio: number; error: number };
  boundsDrift?: number;
};

export type ModelEntry = {
  id: string;
  name: string;
  pack: string;
  sourceName: string;
  sourceFile: string;
  author: string;
  license: string;
  attribution: string;
  category: AssetCategory;
  subcategory: string;
  tags: string[];
  file: string;
  bytes: number;
  triangles: number;
  vertices: number;
  drawCalls: number;
  sourceTriangles: number;
  materials: string[];
  baseScale: number;
  bounds: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
  collision: ModelCollision | null;
  lod: LodLevel[];
  placeholder: boolean;
  approvedAt: string | null;
  visualReview: string;
};

export type TextureVariant = { file: string; width: number; height: number; bytes: number };

export type TextureEntry = {
  id: string;
  kind: "albedo" | "normal";
  colorSpace: "srgb" | "linear";
  hasAlpha: boolean;
  sourceFile: string;
  sourceSize: [number, number];
  sourceBytes: number;
  full: TextureVariant;
  low: TextureVariant;
};

export type MaterialEntry = {
  id: string;
  sourceName: string;
  albedo: string | null;
  normal: string | null;
  baseColorFactor: [number, number, number, number];
  alphaMode: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff: number | null;
  doubleSided: boolean;
  vertexColors: boolean;
  metalness: number;
  roughness: number;
};

export type PackEntry = {
  id: string;
  name: string;
  version: string;
  author: string;
  license: { id: string; name: string; url: string; textFile: string };
  sourceUrl: string;
  homepage: string;
  downloadedAt: string;
  archive: { name: string; bytes: number; sha256: string };
  attribution: { required: boolean; suggested: string };
  approval: string;
  textFileSha256: string;
};

export type ScaleClassId = "s" | "m" | "l";

export type RockScaleClasses = {
  note: string;
  appliesTo: string[];
  classes: Record<ScaleClassId, { scale: [number, number]; harvestHint: number }>;
  proportionJitter: { x: number; y: number; z: number };
  maxTiltRad: number;
  yawRange: [number, number];
};

export type AssetManifest = {
  schemaVersion: 1;
  pipeline: { version: number; tools: Record<string, string>; [k: string]: unknown };
  packs: PackEntry[];
  scaleClasses: { rock: RockScaleClasses };
  textures: TextureEntry[];
  materials: MaterialEntry[];
  models: ModelEntry[];
  totals: {
    models: number;
    glbFiles: number;
    glbBytes: number;
    textureCount: number;
    textureBytesFull: number;
    textureBytesLow: number;
    materialCount: number;
    totalBytesFull: number;
    totalBytesLow: number;
  };
};

export class ManifestError extends Error {
  constructor(message: string) {
    super(`Manifest zasobów: ${message}`);
    this.name = "ManifestError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function need(cond: unknown, message: string): asserts cond {
  if (!cond) throw new ManifestError(message);
}

const str = (v: unknown) => typeof v === "string" && v.length > 0;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const vec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(num);

/** Sprawdza strukturę i spójność referencji; zwraca zwalidowany manifest albo rzuca `ManifestError`. */
export function parseManifest(raw: unknown): AssetManifest {
  need(isRecord(raw), "oczekiwano obiektu");
  need(raw.schemaVersion === 1, `nieobsługiwana wersja schematu: ${String(raw.schemaVersion)}`);
  for (const key of ["packs", "textures", "materials", "models"] as const) {
    need(Array.isArray(raw[key]), `brak tablicy ${key}`);
  }
  const m = raw as unknown as AssetManifest;

  const packIds = new Set<string>();
  for (const p of m.packs) {
    need(str(p.id) && str(p.author) && str(p.sourceUrl), "niepełny wpis paczki");
    need(isRecord(p.license) && str(p.license.id) && str(p.license.textFile) && str(p.license.url), `paczka ${p.id}: brak licencji`);
    need(typeof p.attribution?.required === "boolean", `paczka ${p.id}: brak informacji o atrybucji`);
    need(isRecord(p.archive) && /^[0-9a-f]{64}$/.test(p.archive.sha256), `paczka ${p.id}: brak sumy SHA-256 archiwum`);
    packIds.add(p.id);
  }

  const textureIds = new Set<string>();
  for (const t of m.textures) {
    need(str(t.id) && !textureIds.has(t.id), `tekstura: brak lub duplikat id (${String(t.id)})`);
    need(isRecord(t.full) && isRecord(t.low) && str(t.full.file) && str(t.low.file), `tekstura ${t.id}: brak wariantów plików`);
    need(t.kind === "albedo" || t.kind === "normal", `tekstura ${t.id}: nieznany rodzaj`);
    textureIds.add(t.id);
  }

  const materialIds = new Set<string>();
  for (const mat of m.materials) {
    need(str(mat.id) && !materialIds.has(mat.id), `materiał: brak lub duplikat id (${String(mat.id)})`);
    need(mat.albedo === null || textureIds.has(mat.albedo), `materiał ${mat.id}: nieznana tekstura ${String(mat.albedo)}`);
    need(mat.normal === null || textureIds.has(mat.normal), `materiał ${mat.id}: nieznana tekstura normalnych ${String(mat.normal)}`);
    need(["OPAQUE", "MASK", "BLEND"].includes(mat.alphaMode), `materiał ${mat.id}: zły alphaMode`);
    need(mat.alphaMode !== "MASK" || num(mat.alphaCutoff), `materiał ${mat.id}: MASK wymaga alphaCutoff`);
    materialIds.add(mat.id);
  }

  const modelIds = new Set<string>();
  for (const e of m.models) {
    need(str(e.id) && !modelIds.has(e.id), `model: brak lub duplikat id (${String(e.id)})`);
    const where = `model ${e.id}`;
    need(packIds.has(e.pack), `${where}: nieznana paczka ${String(e.pack)}`);
    need(str(e.author) && str(e.license) && str(e.attribution), `${where}: brak autora, licencji lub atrybucji`);
    need(str(e.sourceName) && str(e.sourceFile) && str(e.file), `${where}: brak nazwy źródłowej lub pliku`);
    need(ASSET_CATEGORIES.includes(e.category), `${where}: nieznana kategoria ${String(e.category)}`);
    need(num(e.triangles) && e.triangles > 0 && num(e.bytes) && e.bytes > 0, `${where}: brak liczby trójkątów lub rozmiaru`);
    need(num(e.baseScale) && e.baseScale > 0, `${where}: zły baseScale`);
    need(typeof e.placeholder === "boolean", `${where}: brak flagi placeholder`);
    need(e.approvedAt === null || str(e.approvedAt), `${where}: zły approvedAt`);
    need(isRecord(e.bounds) && vec3(e.bounds.min) && vec3(e.bounds.max) && vec3(e.bounds.size), `${where}: złe bounds`);
    need(Array.isArray(e.materials) && e.materials.length > 0, `${where}: brak materiałów`);
    for (const id of e.materials) need(materialIds.has(id), `${where}: nieznany materiał ${id}`);
    need(Array.isArray(e.lod) && e.lod.length > 0 && e.lod[0].level === 0 && e.lod[0].file === e.file, `${where}: LOD 0 musi być plikiem głównym`);
    e.lod.forEach((l, i) => {
      need(l.level === i && str(l.file) && num(l.triangles) && num(l.minDistance), `${where}: zły poziom LOD ${i}`);
      need(i === 0 || (l.minDistance > e.lod[i - 1].minDistance && l.triangles <= e.lod[i - 1].triangles), `${where}: LOD ${i} musi być dalszy i lżejszy`);
    });
    if (e.collision !== null) {
      need(e.collision.shape === "circle" && num(e.collision.r) && e.collision.r > 0 && num(e.collision.height), `${where}: zła kolizja`);
    }
    modelIds.add(e.id);
  }

  const rock = m.scaleClasses?.rock;
  need(rock && Array.isArray(rock.appliesTo) && isRecord(rock.classes), "brak scaleClasses.rock");
  for (const id of rock.appliesTo) need(modelIds.has(id), `scaleClasses.rock: nieznany model ${id}`);
  for (const cls of ["s", "m", "l"] as const) {
    const c = rock.classes[cls];
    need(c && c.scale.length === 2 && c.scale[0] > 0 && c.scale[0] <= c.scale[1], `scaleClasses.rock.${cls}: zły zakres skali`);
  }
  return m;
}

export function indexManifest(manifest: AssetManifest) {
  return {
    model: new Map(manifest.models.map((e) => [e.id, e] as const)),
    material: new Map(manifest.materials.map((e) => [e.id, e] as const)),
    texture: new Map(manifest.textures.map((e) => [e.id, e] as const)),
  };
}
