import * as THREE from "three";
import { createDefaultGlbLoader, type GlbResult } from "./library";

/** Postacie (NPC) ładowane jako GLB ze szkieletem: osobny katalog i manifest, bo `assets:build` odtwarza `public/models`. */
export type CharacterClipInfo = { name: string; channels: number; duration: number };

export type CharacterEntry = {
  id: string;
  file: string;
  bytes: number;
  triangles: number;
  vertices: number;
  bones: number;
  meshNode: string;
  hipsBone: string;
  clips: CharacterClipInfo[];
  /** Wysokość postaci w pozie wiązania (jednostki modelu); skala do świata = targetHeight / sourceHeight. */
  sourceHeight: number;
  sourceBounds: { min: number[]; max: number[] };
  targetHeight: number;
  /** Przód modelu w układzie sceny: `+z` zgodne z azymutem `atan2(dx, dz)`, `-x` wymaga obrotu o 90° (patrz `DeerNpc`). */
  forward: "+z" | "-x";
  source: { file: string; sha256: string; bytes: number; author: string; note: string };
};

export type TrollEntry = CharacterEntry & {
  forward: "+z";
  /** Węzeł szkieletu z obrotem i skalą (Blender: 90° wokół X, skala 0,01); skala do świata dotyczy całej postaci. */
  rigNode: string;
  atlas: { size: number; padding: number; rowsUsed: number; textures: { name: string; bytes: number }[] };
  optimisation: { before: { meshes: number; materials: number; textures: number }; after: { meshes: number; materials: number; textures: number } };
};

export type DeerEntry = CharacterEntry & {
  forward: "-x";
  /** Kość głowy obrócona w modelu o ok. 90° względem ciała i korekta (stopnie, układ modelu: yaw wokół góry, pitch wokół osi bocznej Z). */
  head: { bone: string; yawDeg: number; pitchDeg: number };
  /** Kości stóp (kopyta) czterech nóg, do pomiaru kroku. */
  feet: string[];
  textures: { name: string; size: number[]; bytes: number }[];
};

export type CharactersManifest = { schemaVersion: 1; characters: CharacterEntry[] };

export class CharacterLoadError extends Error {
  constructor(
    readonly characterId: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Postać ${characterId}: ${message}`, options);
    this.name = "CharacterLoadError";
  }
}

export const TROLL_ID = "troll.forest";
export const DEER_ID = "deer.forest";
/** Animacje wymagane od modelu trolla (nazwy klipów w pliku); brak którejkolwiek to błąd, a nie ciche udawanie ruchu. */
export const TROLL_REQUIRED_CLIPS = ["Walk", "Idle", "Nervous", "Surprised", "Happy", "Dance", "Angry"] as const;
/** Jedyny klip jelenia w pliku (preset czworonoga); nie ma Idle ani biegu. */
export const DEER_WALK_CLIP = "preset:quadruped:walk";
const DEFAULT_CHARACTERS_URL = "/characters";

export type CharacterLoaderOptions = {
  baseUrl?: string;
  loadJson?: (url: string) => Promise<unknown>;
  loadGlb?: (url: string) => Promise<GlbResult>;
};

export type CharacterAsset<E extends CharacterEntry = CharacterEntry> = {
  entry: E;
  scene: THREE.Object3D;
  skinned: THREE.SkinnedMesh;
  /** Klipy dokładnie z pliku (przed usunięciem root motion). */
  clips: THREE.AnimationClip[];
  /** Skala modelu do świata (wysokość docelowa / wysokość w pozie wiązania). */
  scale: number;
  bones: number;
  triangles: number;
  dispose(): void;
};

export type TrollAsset = CharacterAsset<TrollEntry>;
export type DeerAsset = CharacterAsset<DeerEntry>;

const defaultJson = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

function isEntry(raw: unknown): raw is CharacterEntry {
  const e = raw as Partial<CharacterEntry> | null;
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.file === "string" &&
    typeof e.meshNode === "string" &&
    typeof e.hipsBone === "string" &&
    typeof e.sourceHeight === "number" &&
    typeof e.targetHeight === "number" &&
    (e.forward === "+z" || e.forward === "-x") &&
    Array.isArray(e.clips)
  );
}

/** Nazwa kości po sanityzacji przez GLTFLoader (np. `mixamorig:Hips` -> `mixamorigHips`). */
export const sceneNodeName = (name: string) => THREE.PropertyBinding.sanitizeNodeName(name);

/**
 * Wczytuje postać przez wspólny GLTFLoader i sprawdza strukturę: jedna siatka ze skórą z jednym materiałem, liczba kości
 * z manifestu, kość bioder oraz wymagane klipy (długości zgodne z manifestem).
 */
async function loadCharacter<E extends CharacterEntry>(
  id: string,
  requiredClips: readonly string[],
  options: CharacterLoaderOptions,
  extra: (entry: E, scene: THREE.Object3D) => void,
): Promise<CharacterAsset<E>> {
  const base = options.baseUrl ?? DEFAULT_CHARACTERS_URL;
  const loadJson = options.loadJson ?? defaultJson;
  const loadGlb =
    options.loadGlb ??
    (() => {
      const load = createDefaultGlbLoader();
      return (url: string) => load(url);
    })();
  let manifest: CharactersManifest;
  try {
    manifest = (await loadJson(`${base}/characters.json`)) as CharactersManifest;
  } catch (e) {
    throw new CharacterLoadError(id, "nie udało się wczytać characters.json", { cause: e });
  }
  const entry = manifest?.characters?.find((c) => c.id === id);
  if (!isEntry(entry)) throw new CharacterLoadError(id, "brak wpisu w characters.json");
  let gltf: GlbResult;
  try {
    gltf = await loadGlb(`${base}/${entry.file}`);
  } catch (e) {
    throw new CharacterLoadError(id, `nie udało się wczytać ${entry.file}`, { cause: e });
  }
  const dispose = () => disposeScene(gltf.scene);
  try {
    const mesh = gltf.scene.getObjectByName(sceneNodeName(entry.meshNode)) as THREE.SkinnedMesh | undefined;
    if (!mesh || !(mesh as THREE.SkinnedMesh).isSkinnedMesh) throw new CharacterLoadError(id, `brak siatki ze skórą ${entry.meshNode}`);
    if (Array.isArray(mesh.material)) throw new CharacterLoadError(id, "siatka ma wiele materiałów (oczekiwano jednego)");
    if (mesh.skeleton.bones.length !== entry.bones) {
      throw new CharacterLoadError(id, `szkielet ma ${mesh.skeleton.bones.length} kości, manifest ${entry.bones}`);
    }
    if (!gltf.scene.getObjectByName(sceneNodeName(entry.hipsBone))) throw new CharacterLoadError(id, `brak kości ${entry.hipsBone}`);
    for (const required of requiredClips) {
      if (!(gltf.animations ?? []).some((c) => c.name === required)) throw new CharacterLoadError(id, `brak animacji ${required}`);
    }
    for (const info of entry.clips) {
      const clip = (gltf.animations ?? []).find((c) => c.name === info.name);
      if (!clip || Math.abs(clip.duration - info.duration) > 0.01) throw new CharacterLoadError(id, `animacja ${info.name} nie zgadza się z manifestem`);
    }
    extra(entry as E, gltf.scene);
    const index = mesh.geometry.getIndex();
    const triangles = (index ? index.count : mesh.geometry.getAttribute("position").count) / 3;
    return {
      entry: entry as E,
      scene: gltf.scene,
      skinned: mesh,
      clips: gltf.animations ?? [],
      scale: entry.targetHeight / entry.sourceHeight,
      bones: mesh.skeleton.bones.length,
      triangles,
      dispose,
    };
  } catch (e) {
    dispose();
    throw e;
  }
}

export const loadTrollAsset = (options: CharacterLoaderOptions = {}): Promise<TrollAsset> =>
  loadCharacter<TrollEntry>(TROLL_ID, TROLL_REQUIRED_CLIPS, options, (entry) => {
    if (entry.forward !== "+z") throw new CharacterLoadError(TROLL_ID, "oczekiwano przodu +z");
  });

/** Jeleń: jedna animacja Walk (bez Idle i biegu), przód -X, kość głowy i kopyta z manifestu muszą istnieć w szkielecie. */
export const loadDeerAsset = (options: CharacterLoaderOptions = {}): Promise<DeerAsset> =>
  loadCharacter<DeerEntry>(DEER_ID, [DEER_WALK_CLIP], options, (entry, scene) => {
    if (entry.forward !== "-x") throw new CharacterLoadError(DEER_ID, "oczekiwano przodu -x");
    for (const bone of [entry.head?.bone, ...(entry.feet ?? [])]) {
      if (!bone || !scene.getObjectByName(sceneNodeName(bone))) throw new CharacterLoadError(DEER_ID, `brak kości ${bone}`);
    }
    if (entry.feet.length !== 4) throw new CharacterLoadError(DEER_ID, "oczekiwano czterech kości kopyt");
  });

/** Zwalnia geometrie, materiały, tekstury i szkielet sceny GLB. */
export function disposeScene(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh as THREE.SkinnedMesh).skeleton?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      const std = m as THREE.MeshStandardMaterial;
      for (const tex of [std.map, std.normalMap, std.metalnessMap, std.roughnessMap, std.aoMap, std.emissiveMap]) tex?.dispose();
      m.dispose();
    }
  });
}
