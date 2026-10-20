import * as THREE from "three";
import type { MeshData } from "@/lib/forest-view/bridgeModules";
import { createDefaultGlbLoader } from "./library";

/** Most z GLB (poza paczką roślin): wpis `bridge.wooden` w `public/props/props.json`, plik `bridge.glb`. */
export const BRIDGE_PROP_ID = "bridge.wooden";
const DEFAULT_PROPS_URL = "/props";

export type BridgeEntry = {
  id: string;
  file: string;
  bytes: number;
  triangles: number;
  mesh: string;
  sourceBounds: { min: number[]; max: number[] };
  worldScale: number;
  source: { file: string; sha256: string; sourceMeshes: number; sourceTriangles: number; author: string; note: string };
};

export class BridgeLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(`Most: ${message}`, options);
    this.name = "BridgeLoadError";
  }
}

export type BridgeAsset = {
  entry: BridgeEntry;
  /** Siatka źródłowa w układzie modelu (po zastosowaniu transformacji węzłów); tnie ją `bridgeModules`. */
  source: MeshData;
  material: THREE.Material;
  triangles: number;
  dispose(): void;
};

export type BridgeLoaderOptions = {
  baseUrl?: string;
  loadJson?: (url: string) => Promise<unknown>;
  loadGlb?: (url: string) => Promise<{ scene: THREE.Object3D }>;
};

const defaultJson = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

function isEntry(raw: unknown): raw is BridgeEntry {
  const e = raw as Partial<BridgeEntry> | null;
  return !!e && e.id === BRIDGE_PROP_ID && typeof e.file === "string" && typeof e.mesh === "string" && !!e.sourceBounds;
}

function toFloat32(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): Float32Array {
  const out = new Float32Array(attr.count * size);
  const get = [attr.getX.bind(attr), attr.getY.bind(attr), attr.getZ.bind(attr)];
  for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = k < 3 ? get[k](i) : attr.getW(i);
  return out;
}

/** Wczytuje most: manifest, GLB, jedna siatka z jednym materiałem; weryfikuje obecność normalnych i UV (potrzebne do cięcia). */
export async function loadBridgeAsset(options: BridgeLoaderOptions = {}): Promise<BridgeAsset> {
  const base = options.baseUrl ?? DEFAULT_PROPS_URL;
  const loadJson = options.loadJson ?? defaultJson;
  const loadGlb =
    options.loadGlb ??
    (() => {
      const load = createDefaultGlbLoader();
      return (url: string) => load(url);
    })();
  let manifest: { props?: unknown[] };
  try {
    manifest = (await loadJson(`${base}/props.json`)) as { props?: unknown[] };
  } catch (e) {
    throw new BridgeLoadError("nie udało się wczytać props.json", { cause: e });
  }
  const entry = manifest?.props?.find((p) => (p as { id?: string })?.id === BRIDGE_PROP_ID);
  if (!isEntry(entry)) throw new BridgeLoadError("brak wpisu bridge.wooden w props.json");
  let gltf: { scene: THREE.Object3D };
  try {
    gltf = await loadGlb(`${base}/${entry.file}`);
  } catch (e) {
    throw new BridgeLoadError(`nie udało się wczytać ${entry.file}`, { cause: e });
  }
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length !== 1) throw new BridgeLoadError(`oczekiwano jednej siatki, jest ${meshes.length}`);
  const mesh = meshes[0];
  if (Array.isArray(mesh.material)) throw new BridgeLoadError("siatka ma wiele materiałów (oczekiwano jednego)");
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  if (!position || !normal || !uv || !index) {
    geometry.dispose();
    throw new BridgeLoadError("siatka musi mieć pozycje, normalne, UV i indeksy");
  }
  const source: MeshData = {
    positions: toFloat32(position, 3),
    normals: toFloat32(normal, 3),
    uvs: toFloat32(uv, 2),
    indices: index.count > 65535 ? Uint32Array.from(index.array as ArrayLike<number>) : Uint16Array.from(index.array as ArrayLike<number>),
  };
  geometry.dispose();
  const material = mesh.material;
  return {
    entry,
    source,
    material,
    triangles: source.indices.length / 3,
    dispose() {
      const m = material as THREE.MeshStandardMaterial;
      m.map?.dispose();
      m.metalnessMap?.dispose();
      m.roughnessMap?.dispose();
      m.dispose();
    },
  };
}
