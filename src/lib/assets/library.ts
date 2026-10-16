import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  type AssetManifest, type MaterialEntry, type ModelEntry, ASSET_CATEGORIES, type AssetCategory, indexManifest, parseManifest,
} from "./manifest";
import { DEFAULT_QUALITY, type QualityProfile, getQualityProfile } from "./profiles";

export type AssetErrorKind = "manifest" | "model" | "texture";

export class AssetLoadError extends Error {
  constructor(
    readonly kind: AssetErrorKind,
    readonly assetId: string,
    readonly url: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Zasób 3D (${kind}) ${assetId}: ${message}`, options);
    this.name = "AssetLoadError";
  }
}

export type LoadedPart = {
  /** Geometria współdzielona przez wszystkie instancje modelu. Nie modyfikować i nie zwalniać ręcznie. */
  geometry: THREE.BufferGeometry;
  /** Materiał współdzielony przez wszystkie modele, które go używają. */
  material: THREE.Material;
  materialId: string;
};

export type LoadedLod = { level: number; minDistance: number; triangles: number; parts: LoadedPart[] };

export type ModelAsset = {
  id: string;
  entry: ModelEntry;
  /** Tylko załadowane poziomy (profil może pomijać LOD0). Posortowane rosnąco po `level`. */
  levels: LoadedLod[];
  /** True, gdy ładowanie się nie udało i zwrócono proceduralny zastępnik (nie jest grafiką docelową). */
  fallback: boolean;
};

type GlbResult = { scene: THREE.Object3D };

export type LibraryOptions = {
  baseUrl?: string;
  profile?: QualityProfile;
  /** Podmiana ładowania (testy, SSR, własny cache). */
  loadManifestJson?: (url: string) => Promise<unknown>;
  loadGlb?: (url: string) => Promise<GlbResult>;
  loadTexture?: (url: string) => Promise<THREE.Texture>;
  onError?: (error: AssetLoadError) => void;
};

export type LibraryStats = {
  models: number;
  fallbackModels: number;
  geometries: number;
  materials: number;
  textures: number;
  triangles: number;
  approxTextureBytes: number;
};

export type PreloadReport = { loaded: string[]; failed: { id: string; error: AssetLoadError }[] };

const DEFAULT_BASE_URL = "/models";

function defaultManifestLoader(url: string): Promise<unknown> {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

export function createDefaultGlbLoader(): (url: string) => Promise<GlbResult> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return loader.parseAsync(await res.arrayBuffer(), "");
  };
}

function defaultTextureLoader(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url);
}

/** Atrybut do Float32 (po kwantyzacji meshopt/KHR_mesh_quantization dane są znormalizowanymi całkowitymi). */
function toFloatAttribute(src: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, itemSize: number): THREE.BufferAttribute {
  const out = new Float32Array(src.count * itemSize);
  const get = [src.getX.bind(src), src.getY.bind(src), src.getZ.bind(src)];
  for (let i = 0; i < src.count; i++) {
    for (let k = 0; k < itemSize; k++) out[i * itemSize + k] = get[k](i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

function bakeGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4, scale: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const position = source.getAttribute("position");
  const normal = source.getAttribute("normal");
  const uv = source.getAttribute("uv");
  const color = source.getAttribute("color");
  geometry.setAttribute("position", toFloatAttribute(position, 3));
  if (normal) geometry.setAttribute("normal", toFloatAttribute(normal, 3));
  if (uv) {
    const out = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      out[i * 2] = uv.getX(i);
      out[i * 2 + 1] = uv.getY(i);
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(out, 2));
  }
  if (color) geometry.setAttribute("color", toFloatAttribute(color, 3));
  const index = source.getIndex();
  if (index) geometry.setIndex(new THREE.BufferAttribute(index.array.slice() as Uint16Array | Uint32Array, 1));
  geometry.applyMatrix4(matrix);
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute("position").count) / 3;
}

export class AssetLibrary {
  readonly baseUrl: string;
  readonly profile: QualityProfile;

  private readonly opts: Required<Pick<LibraryOptions, "loadManifestJson" | "loadGlb" | "loadTexture">> & Pick<LibraryOptions, "onError">;
  private manifestPromise: Promise<AssetManifest> | null = null;
  private manifestIndex: ReturnType<typeof indexManifest> | null = null;
  private readonly models = new Map<string, Promise<ModelAsset>>();
  private readonly loadedModels = new Map<string, ModelAsset>();
  private readonly materials = new Map<string, Promise<THREE.Material>>();
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly fallbacks = new Map<string, ModelAsset>();
  private readonly safeModels = new Map<string, Promise<ModelAsset>>();

  constructor(options: LibraryOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.profile = options.profile ?? getQualityProfile(DEFAULT_QUALITY);
    this.opts = {
      loadManifestJson: options.loadManifestJson ?? defaultManifestLoader,
      loadGlb: options.loadGlb ?? createDefaultGlbLoader(),
      loadTexture: options.loadTexture ?? defaultTextureLoader,
      onError: options.onError,
    };
  }

  private url(file: string) {
    return `${this.baseUrl}/${file}`;
  }

  private fail(error: AssetLoadError): never {
    this.opts.onError?.(error);
    throw error;
  }

  manifest(): Promise<AssetManifest> {
    if (!this.manifestPromise) {
      const url = this.url("manifest.json");
      const promise = this.opts
        .loadManifestJson(url)
        .then(
          (raw) => parseManifest(raw),
          (cause) => {
            throw new AssetLoadError("manifest", "manifest", url, "nie udało się pobrać manifestu", { cause });
          },
        )
        .then((m) => {
          this.manifestIndex = indexManifest(m);
          return m;
        })
        .catch((e) => {
          this.manifestPromise = null;
          const error = e instanceof AssetLoadError ? e : new AssetLoadError("manifest", "manifest", url, String(e?.message ?? e), { cause: e });
          this.opts.onError?.(error);
          throw error;
        });
      this.manifestPromise = promise;
    }
    return this.manifestPromise;
  }

  private async entry(id: string): Promise<ModelEntry> {
    await this.manifest();
    const entry = this.manifestIndex?.model.get(id);
    if (!entry) this.fail(new AssetLoadError("model", id, this.url("manifest.json"), "brak wpisu w manifeście"));
    return entry;
  }

  private loadTextureShared(id: string): Promise<THREE.Texture> {
    const cached = this.textures.get(id);
    if (cached) return cached;
    const promise = (async () => {
      await this.manifest();
      const tex = this.manifestIndex?.texture.get(id);
      if (!tex) this.fail(new AssetLoadError("texture", id, "", "brak tekstury w manifeście"));
      const file = this.profile.textures === "low" ? tex.low.file : tex.full.file;
      const url = this.url(file);
      let texture: THREE.Texture;
      try {
        texture = await this.opts.loadTexture(url);
      } catch (cause) {
        this.fail(new AssetLoadError("texture", id, url, "nie udało się załadować tekstury", { cause }));
      }
      // Konwencja glTF: początek UV w lewym górnym rogu, domyślne zawijanie.
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = tex.colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = this.profile.anisotropy;
      texture.name = id;
      return texture;
    })();
    this.textures.set(id, promise);
    promise.catch(() => this.textures.delete(id));
    return promise;
  }

  /** Jeden materiał na id (dla wszystkich modeli i instancji), zależny od profilu jakości. */
  material(id: string): Promise<THREE.Material> {
    const cached = this.materials.get(id);
    if (cached) return cached;
    const promise = (async () => {
      await this.manifest();
      const def = this.manifestIndex?.material.get(id);
      if (!def) this.fail(new AssetLoadError("model", id, "", "brak materiału w manifeście"));
      return this.buildMaterial(def);
    })();
    this.materials.set(id, promise);
    promise.catch(() => this.materials.delete(id));
    return promise;
  }

  private async buildMaterial(def: MaterialEntry): Promise<THREE.Material> {
    const p = this.profile;
    const map = def.albedo ? await this.loadTextureShared(def.albedo) : null;
    const useNormal = p.normalMaps && def.normal;
    const normalMap = useNormal ? await this.loadTextureShared(def.normal as string) : null;
    const masked = def.alphaMode === "MASK";
    const common = {
      name: def.id,
      map,
      side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      vertexColors: def.vertexColors,
      alphaTest: masked ? (def.alphaCutoff ?? 0.5) : 0,
      alphaToCoverage: masked && p.alphaToCoverage,
    };
    const material =
      p.materialKind === "lambert"
        ? new THREE.MeshLambertMaterial(common)
        : new THREE.MeshStandardMaterial({ ...common, normalMap, roughness: def.roughness, metalness: def.metalness });
    const [r, g, b] = def.baseColorFactor;
    material.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    material.userData.assetMaterialId = def.id;
    return material;
  }

  private async loadLod(entry: ModelEntry, levelIndex: number): Promise<LoadedLod> {
    const level = entry.lod[levelIndex];
    const url = this.url(level.file);
    let gltf: GlbResult;
    try {
      gltf = await this.opts.loadGlb(url);
    } catch (cause) {
      this.fail(new AssetLoadError("model", entry.id, url, "nie udało się załadować pliku GLB", { cause }));
    }
    gltf.scene.updateMatrixWorld(true);
    const raw: { geometry: THREE.BufferGeometry; materialId: string }[] = [];
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const materialId = source.name.toLowerCase();
      raw.push({ geometry: bakeGeometry(mesh.geometry, mesh.matrixWorld, entry.baseScale), materialId });
      mesh.geometry.dispose();
      source.dispose();
    });
    if (raw.length === 0) this.fail(new AssetLoadError("model", entry.id, url, "plik GLB nie zawiera siatek"));
    const unknown = raw.find((r) => !entry.materials.includes(r.materialId));
    if (unknown) {
      this.fail(new AssetLoadError("model", entry.id, url, `materiał "${unknown.materialId}" nie jest zapisany w manifeście modelu`));
    }
    const parts: LoadedPart[] = [];
    for (const r of raw) parts.push({ geometry: r.geometry, materialId: r.materialId, material: await this.material(r.materialId) });
    const triangles = parts.reduce((a, part) => a + triangleCount(part.geometry), 0);
    return { level: level.level, minDistance: level.minDistance, triangles, parts };
  }

  /** Ładuje model (z cache). Odrzuca `AssetLoadError`; nieudane ładowanie nie zostaje w cache, więc można ponowić. */
  load(id: string): Promise<ModelAsset> {
    const cached = this.models.get(id);
    if (cached) return cached;
    const promise = (async () => {
      const entry = await this.entry(id);
      const first = Math.min(this.profile.minLod, entry.lod.length - 1);
      const levels: LoadedLod[] = [];
      for (let i = first; i < entry.lod.length; i++) levels.push(await this.loadLod(entry, i));
      const asset: ModelAsset = { id, entry, levels, fallback: false };
      this.loadedModels.set(id, asset);
      return asset;
    })();
    this.models.set(id, promise);
    promise.catch(() => this.models.delete(id));
    return promise;
  }

  /** Jak `load`, ale po błędzie zwraca oznaczony (`fallback: true`) proceduralny zastępnik zamiast odrzucać. */
  loadOrFallback(id: string): Promise<ModelAsset> {
    const cached = this.safeModels.get(id);
    if (cached) return cached;
    const promise = this.load(id).catch((e) => {
      if (!(e instanceof AssetLoadError)) throw e;
      return this.fallbackFor(id);
    });
    this.safeModels.set(id, promise);
    return promise;
  }

  private async fallbackFor(id: string): Promise<ModelAsset> {
    const existing = this.fallbacks.get(id);
    if (existing) return existing;
    let entry: ModelEntry | undefined;
    try {
      entry = await this.entry(id);
    } catch {
      entry = undefined;
    }
    const size = entry?.bounds.size ?? [1, 1, 1];
    const box = entry?.category === "rock" || entry?.category === "mushroom";
    const geometry = box
      ? new THREE.BoxGeometry(size[0], size[1], size[2]).translate(0, size[1] / 2, 0)
      : new THREE.ConeGeometry(Math.max(size[0], size[2]) / 2, size[1], 8).translate(0, size[1] / 2, 0);
    const material = new THREE.MeshLambertMaterial({ color: 0x9a8f7a, name: "fallback" });
    const fallbackEntry = entry ?? ({ id, category: "rock", baseScale: 1, collision: null, lod: [], materials: [], bounds: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] } } as unknown as ModelEntry);
    const asset: ModelAsset = {
      id,
      entry: fallbackEntry,
      fallback: true,
      levels: [{ level: 0, minDistance: 0, triangles: triangleCount(geometry), parts: [{ geometry, material, materialId: "fallback" }] }],
    };
    this.fallbacks.set(id, asset);
    return asset;
  }

  /** Model już załadowany (po `preload`/`load`); synchronicznie, bez zawieszania renderu. */
  getLoaded(id: string): ModelAsset | undefined {
    return this.loadedModels.get(id);
  }

  /** Ładuje podane modele równolegle (domyślnie wszystkie z manifestu lub z kategorii). Nie rzuca; zwraca raport. */
  async preload(which?: readonly string[] | { category: AssetCategory }): Promise<PreloadReport> {
    const manifest = await this.manifest();
    let ids: string[];
    if (!which) ids = manifest.models.map((m) => m.id);
    else if ("category" in which && !Array.isArray(which)) {
      const wanted = (which as { category: AssetCategory }).category;
      if (!ASSET_CATEGORIES.includes(wanted)) throw new Error(`Nieznana kategoria: ${wanted}`);
      ids = manifest.models.filter((m) => m.category === wanted).map((m) => m.id);
    } else ids = [...(which as readonly string[])];
    const report: PreloadReport = { loaded: [], failed: [] };
    await Promise.all(
      ids.map(async (id) => {
        try {
          await this.load(id);
          report.loaded.push(id);
        } catch (e) {
          report.failed.push({ id, error: e as AssetLoadError });
        }
      }),
    );
    return report;
  }

  stats(): LibraryStats {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    let triangles = 0;
    for (const asset of this.loadedModels.values()) {
      for (const lod of asset.levels) {
        triangles += lod.triangles;
        for (const part of lod.parts) {
          geometries.add(part.geometry);
          materials.add(part.material);
        }
      }
    }
    let approxTextureBytes = 0;
    const manifest = this.manifestIndex;
    if (manifest) {
      for (const [id] of this.textures) {
        const t = manifest.texture.get(id);
        if (t) {
          const v = this.profile.textures === "low" ? t.low : t.full;
          approxTextureBytes += Math.round(v.width * v.height * 4 * 1.33);
        }
      }
    }
    return {
      models: this.loadedModels.size,
      fallbackModels: this.fallbacks.size,
      geometries: geometries.size,
      materials: materials.size,
      textures: this.textures.size,
      triangles,
      approxTextureBytes,
    };
  }

  /** Zwalnia geometrie, materiały i tekstury (GPU) i czyści cache; kolejne `load` zaczyna od zera (bezpieczne w React StrictMode). */
  async dispose(): Promise<void> {
    const settled = await Promise.allSettled([...this.models.values()]);
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      for (const lod of r.value.levels) for (const part of lod.parts) part.geometry.dispose();
    }
    for (const asset of this.fallbacks.values()) {
      for (const lod of asset.levels) {
        for (const part of lod.parts) {
          part.geometry.dispose();
          part.material.dispose();
        }
      }
    }
    for (const p of await Promise.allSettled([...this.materials.values()])) if (p.status === "fulfilled") p.value.dispose();
    for (const p of await Promise.allSettled([...this.textures.values()])) if (p.status === "fulfilled") p.value.dispose();
    this.models.clear();
    this.safeModels.clear();
    this.loadedModels.clear();
    this.materials.clear();
    this.textures.clear();
    this.fallbacks.clear();
  }
}

/** Poziom LOD dla odległości kamery wg profilu (progi z manifestu skalowane `lodDistanceScale`). */
export function pickLodIndex(asset: ModelAsset, distance: number, profile: QualityProfile): number {
  let chosen = 0;
  for (let i = 1; i < asset.levels.length; i++) {
    if (distance >= asset.levels[i].minDistance * profile.lodDistanceScale) chosen = i;
  }
  return chosen;
}
