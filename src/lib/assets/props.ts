import * as THREE from "three";
import { createDefaultGlbLoader } from "./library";

/** Rekwizyty spoza paczki roślin (skrzynia ze skarbem): osobny katalog i manifest, bo `assets:build` odtwarza `public/models`. */
export type PropEntry = {
  id: string;
  file: string;
  bytes: number;
  triangles: number;
  bodyNode: string;
  hingeNode: string;
  lidNode: string;
  lockNode: string;
  hinge: { x: number; y: number; z: number };
  front: "+z";
  openAxis: "x";
  /** Kąt obrotu pokrywy wokół osi X przy pełnym otwarciu (ujemny: przód pokrywy idzie w górę). */
  openAngleDeg: number;
  sourceBounds: { min: number[]; max: number[] };
  worldScale: number;
  textures: { node: string; sourceSize: number[]; size: number[]; bytes: number }[];
  source: { file: string; sha256: string; sourceMeshes: number; sourceTriangles: number; author: string; note: string };
};

export type PropsManifest = { schemaVersion: 1; props: PropEntry[] };

export class PropLoadError extends Error {
  constructor(
    readonly propId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Rekwizyt ${propId}: ${message}`, options);
    this.name = "PropLoadError";
  }
}

export const CHEST_PROP_ID = "chest.treasure";
const DEFAULT_PROPS_URL = "/props";

export type PropsLoaderOptions = {
  baseUrl?: string;
  loadJson?: (url: string) => Promise<unknown>;
  loadGlb?: (url: string) => Promise<{ scene: THREE.Object3D }>;
};

/** Geometria skrzyni: korpus, zamek i pokrywa osobno; pokrywa we współrzędnych zawiasu (obrót wokół początku układu = obrót wokół zawiasu). */
export type ChestAsset = {
  entry: PropEntry;
  body: THREE.BufferGeometry;
  /** Zamek jest nieruchomy względem korpusu (rysowany z jego macierzą). */
  lock: THREE.BufferGeometry;
  lid: THREE.BufferGeometry;
  bodyMaterial: THREE.Material;
  lockMaterial: THREE.Material;
  lidMaterial: THREE.Material;
  /** Zawias w układzie modelu (przed skalą świata). */
  hinge: THREE.Vector3;
  /** Pełny kąt otwarcia (rad, ujemny). */
  openAngle: number;
  /** Rozmiary po skali świata (m). */
  size: { width: number; depth: number; height: number };
  triangles: number;
  dispose(): void;
};

const defaultJson = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

function isEntry(raw: unknown): raw is PropEntry {
  const e = raw as Partial<PropEntry> | null;
  return !!e && typeof e.id === "string" && typeof e.file === "string" && typeof e.hingeNode === "string" && typeof e.lockNode === "string" && typeof e.worldScale === "number" && !!e.hinge;
}

function findMesh(root: THREE.Object3D, name: string, propId: string): THREE.Mesh {
  const node = root.getObjectByName(name);
  if (!node) throw new PropLoadError(propId, `brak węzła ${name} w modelu (nie zgadujemy pivotu)`);
  let mesh: THREE.Mesh | null = null;
  node.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new PropLoadError(propId, `węzeł ${name} nie zawiera siatki`);
  return mesh;
}

function singleMaterial(mesh: THREE.Mesh, propId: string): THREE.Material {
  if (Array.isArray(mesh.material)) throw new PropLoadError(propId, `siatka ${mesh.name} ma wiele materiałów (oczekiwano jednego)`);
  return mesh.material;
}

const triangleCount = (g: THREE.BufferGeometry) => (g.getIndex() ? g.getIndex()!.count : g.getAttribute("position").count) / 3;

/**
 * Wczytuje skrzynię i weryfikuje strukturę: korpus i zamek są poza zawiasem, pokrywa jest dzieckiem `Lid_Hinge`,
 * a pivot zawiasu zgadza się z manifestem (to samo miejsce, z którego potok przesunął wierzchołki pokrywy).
 */
export async function loadChestAsset(options: PropsLoaderOptions = {}): Promise<ChestAsset> {
  const base = options.baseUrl ?? DEFAULT_PROPS_URL;
  const loadJson = options.loadJson ?? defaultJson;
  const loadGlb =
    options.loadGlb ??
    (() => {
      const load = createDefaultGlbLoader();
      return (url: string) => load(url);
    })();
  let manifest: PropsManifest;
  try {
    manifest = (await loadJson(`${base}/props.json`)) as PropsManifest;
  } catch (e) {
    throw new PropLoadError(CHEST_PROP_ID, "nie udało się wczytać props.json", { cause: e });
  }
  const entry = manifest?.props?.find((p) => p.id === CHEST_PROP_ID);
  if (!isEntry(entry)) throw new PropLoadError(CHEST_PROP_ID, "brak wpisu w props.json");
  let gltf: { scene: THREE.Object3D };
  try {
    gltf = await loadGlb(`${base}/${entry.file}`);
  } catch (e) {
    throw new PropLoadError(CHEST_PROP_ID, `nie udało się wczytać ${entry.file}`, { cause: e });
  }
  gltf.scene.updateMatrixWorld(true);
  const bodyMesh = findMesh(gltf.scene, entry.bodyNode, entry.id);
  const lockMesh = findMesh(gltf.scene, entry.lockNode, entry.id);
  const hingeNode = gltf.scene.getObjectByName(entry.hingeNode);
  if (!hingeNode) throw new PropLoadError(entry.id, `brak węzła ${entry.hingeNode}`);
  const lidMesh = findMesh(hingeNode, entry.lidNode, entry.id);
  for (const mesh of [bodyMesh, lockMesh]) {
    let p: THREE.Object3D | null = mesh;
    while (p) {
      if (p === hingeNode) throw new PropLoadError(entry.id, `${mesh.name} nie może być częścią zawiasu`);
      p = p.parent;
    }
  }
  const hinge = hingeNode.position.clone();
  const expected = new THREE.Vector3(entry.hinge.x, entry.hinge.y, entry.hinge.z);
  if (hinge.distanceTo(expected) > 1e-3) throw new PropLoadError(entry.id, "pivot zawiasu różni się od manifestu");
  const body = bodyMesh.geometry.clone();
  const lock = lockMesh.geometry.clone();
  const lid = lidMesh.geometry.clone();
  const box = new THREE.Box3();
  body.computeBoundingBox();
  lock.computeBoundingBox();
  lid.computeBoundingBox();
  box.copy(body.boundingBox!).union(lock.boundingBox!).union(lid.boundingBox!.clone().translate(hinge));
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(entry.worldScale);
  const materials = [singleMaterial(bodyMesh, entry.id), singleMaterial(lockMesh, entry.id), singleMaterial(lidMesh, entry.id)];
  return {
    entry,
    body,
    lock,
    lid,
    bodyMaterial: materials[0],
    lockMaterial: materials[1],
    lidMaterial: materials[2],
    hinge,
    openAngle: (entry.openAngleDeg * Math.PI) / 180,
    size: { width: size.x, depth: size.z, height: size.y },
    triangles: triangleCount(body) + triangleCount(lock) + triangleCount(lid),
    dispose() {
      for (const g of [body, lock, lid]) g.dispose();
      for (const m of materials) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    },
  };
}
