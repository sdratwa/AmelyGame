import * as THREE from "three";
import { createDefaultGlbLoader, type GlbResult } from "@/lib/assets/library";

/**
 * Fryzury z osobnych plików GLB (np. Tripo3D): wczytywanie z licznikiem odwołań, wspólny (współdzielony) zasób oraz
 * przebarwianie z zachowaniem szczegółów tekstury. Plik jest pobierany i parsowany raz; geometria, materiał oryginalny i
 * tekstury są współdzielone przez wszystkie założone instancje, a zwalniane dopiero, gdy nikt ich nie używa.
 */

/** Wczytana fryzura GLB: zasoby współdzielone (nie wolno ich zmieniać ani zwalniać poza `GlbHairCache`). */
export type LoadedGlbHair = {
  url: string;
  geometry: THREE.BufferGeometry;
  /** Oryginalny materiał z pliku: wzorzec do klonowania, nigdy nie trafia do sceny i nie jest zmieniany. */
  material: THREE.MeshStandardMaterial;
  /** Transformacja węzła siatki względem korzenia sceny GLB (dla `head_bone_local` zwykle tożsamość). */
  baseMatrix: THREE.Matrix4;
  triangles: number;
  /** Średnia jasność (liniowa) tekstury koloru: punkt odniesienia przebarwiania. */
  referenceLuma: number;
};

const TEXTURE_KEYS = ["map", "normalMap", "metalnessMap", "roughnessMap", "aoMap", "emissiveMap", "alphaMap", "bumpMap", "displacementMap"] as const;

const texturesOf = (material: THREE.MeshStandardMaterial): THREE.Texture[] => {
  const found = new Set<THREE.Texture>();
  for (const key of TEXTURE_KEYS) {
    const t = material[key] as THREE.Texture | null;
    if (t) found.add(t);
  }
  return [...found];
};

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Jasność odniesienia, gdy nie da się zmierzyć tekstury (Node, brak DOM). Typowy ciemny brąz w przestrzeni liniowej. */
export const FALLBACK_REFERENCE_LUMA = 0.1;

/** Średnia liniowa jasność tekstury (zmniejszona do 64 px); poza przeglądarką zwraca `fallback`. */
export function estimateMeanLuma(texture: THREE.Texture | null | undefined, fallback = FALLBACK_REFERENCE_LUMA): number {
  try {
    const image = texture?.image as CanvasImageSource | undefined;
    if (!image || typeof document === "undefined") return fallback;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      sum += 0.2126 * srgbToLinear(data[i] / 255) + 0.7152 * srgbToLinear(data[i + 1] / 255) + 0.0722 * srgbToLinear(data[i + 2] / 255);
      count++;
    }
    return count > 0 ? Math.max(sum / count, 0.02) : fallback;
  } catch {
    return fallback;
  }
}

/** Sprawdza strukturę pliku (jedna siatka bez szkieletu, jeden materiał standardowy) i wyciąga zasoby. */
export function parseHairGlb(url: string, gltf: GlbResult): LoadedGlbHair {
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (meshes.length !== 1) throw new Error(`fryzura GLB ${url}: oczekiwano jednej siatki, jest ${meshes.length}`);
  const mesh = meshes[0];
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) throw new Error(`fryzura GLB ${url}: siatka ze skórą nie jest obsługiwana (fryzura jest sztywna na kości głowy)`);
  if (Array.isArray(mesh.material) || !(mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    throw new Error(`fryzura GLB ${url}: oczekiwano jednego materiału MeshStandardMaterial`);
  }
  const position = mesh.geometry.getAttribute("position");
  if (!position) throw new Error(`fryzura GLB ${url}: brak pozycji wierzchołków`);
  const index = mesh.geometry.getIndex();
  const material = mesh.material as THREE.MeshStandardMaterial;
  const baseMatrix = new THREE.Matrix4().copy(gltf.scene.matrixWorld).invert().multiply(mesh.matrixWorld);
  return {
    url,
    geometry: mesh.geometry,
    material,
    baseMatrix,
    triangles: (index ? index.count : position.count) / 3,
    referenceLuma: estimateMeanLuma(material.map),
  };
}

function disposeLoaded(asset: LoadedGlbHair): void {
  asset.geometry.dispose();
  for (const t of texturesOf(asset.material)) t.dispose();
  asset.material.dispose();
}

type Entry = { promise: Promise<LoadedGlbHair>; refs: number; timer: ReturnType<typeof setTimeout> | null };

/**
 * Cache wczytanych fryzur: jedno pobranie i jedno parsowanie na plik, licznik odwołań (`acquire`/`release`). Gdy licznik
 * spada do zera, zasób jest zwalniany po `retainMs` (domyślnie 30 s, żeby szybkie przełączanie fryzur nie parsowało pliku
 * od nowa); `retainMs: 0` zwalnia od razu. Błąd wczytania nie zostaje w cache (kolejna próba pobierze plik ponownie).
 */
export class GlbHairCache {
  private readonly entries = new Map<string, Entry>();
  private readonly retainMs: number;

  constructor(
    private readonly load: (url: string) => Promise<GlbResult>,
    options: { retainMs?: number } = {},
  ) {
    this.retainMs = options.retainMs ?? 30_000;
  }

  acquire(url: string): Promise<LoadedGlbHair> {
    let entry = this.entries.get(url);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.refs++;
      return entry.promise;
    }
    const created: Entry = {
      refs: 1,
      timer: null,
      promise: this.load(url).then((gltf) => parseHairGlb(url, gltf)),
    };
    created.promise.catch(() => {
      if (this.entries.get(url) === created) this.entries.delete(url);
    });
    this.entries.set(url, created);
    entry = created;
    return entry.promise;
  }

  release(url: string): void {
    const entry = this.entries.get(url);
    if (!entry || entry.refs <= 0) return;
    entry.refs--;
    if (entry.refs > 0) return;
    if (this.retainMs <= 0) this.destroy(url, entry);
    else entry.timer = setTimeout(() => this.destroy(url, entry), this.retainMs);
  }

  private destroy(url: string, entry: Entry): void {
    if (this.entries.get(url) !== entry || entry.refs > 0) return;
    this.entries.delete(url);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    entry.promise.then(disposeLoaded, () => {});
  }

  /** Zwalnia wszystko, co nie jest już używane (np. przy zamknięciu widoku); używane zasoby zostają. */
  trimUnused(): void {
    for (const [url, entry] of [...this.entries]) if (entry.refs <= 0) this.destroy(url, entry);
  }

  /** Stan do diagnostyki i testów. */
  stats(): { entries: number; refs: Record<string, number> } {
    return { entries: this.entries.size, refs: Object.fromEntries([...this.entries].map(([url, e]) => [url, e.refs])) };
  }
}

let shared: GlbHairCache | null = null;

/** Wspólny cache gry i kreatora (jeden plik = jedno pobranie i jedno parsowanie bez względu na liczbę widoków). */
export function sharedGlbHairCache(): GlbHairCache {
  shared ??= new GlbHairCache(createDefaultGlbLoader());
  return shared;
}

export type HairMaterialHandle = {
  material: THREE.MeshStandardMaterial;
  /**
   * `original`: kolor z rejestru oznaczający oryginał pliku. Dla niego tekstura jest użyta bez zmian; dla każdego innego
   * koloru jasność tekstury (jej szczegóły: pasma, połysk, cienie) jest zachowana, a barwa zastąpiona wybraną.
   */
  setColor(hex: string, original: string): void;
  dispose(): void;
};

/**
 * Osobny materiał tej instancji (klon oryginału, te same tekstury, żadnych zmian we wspólnym materiale). Domyślnie wygląda
 * dokładnie jak oryginał; przebarwienie to mieszanie w shaderze: wynik = wybrany kolor × (jasność tekstury / jasność średnia).
 * Nie jest to jednolity kolor, więc tekstura (mapa koloru) nadal wpływa na każdy piksel.
 */
export function createHairMaterial(base: THREE.MeshStandardMaterial, referenceLuma: number): HairMaterialHandle {
  const material = base.clone();
  const baseColor = base.color.clone();
  const uniforms = {
    uHairTint: { value: new THREE.Color(1, 1, 1) },
    uHairAmount: { value: 0 },
    uHairRef: { value: Math.max(referenceLuma, 0.02) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uHairTint;\nuniform float uHairAmount;\nuniform float uHairRef;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
#ifdef USE_MAP
  float hairLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 hairRecolor = uHairTint * clamp(hairLuma / uHairRef, 0.0, 2.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, hairRecolor, uHairAmount);
#endif`,
      );
  };
  material.customProgramCacheKey = () => "miasto-hair-recolor-v1";
  return {
    material,
    setColor(hex, original) {
      const isOriginal = hex.toLowerCase() === original.toLowerCase();
      uniforms.uHairAmount.value = isOriginal ? 0 : 1;
      if (!isOriginal) uniforms.uHairTint.value.set(hex);
      // Bez tekstury (np. test) shader nie działa: wtedy zwykłe mnożenie kolorem materiału.
      if (!material.map) material.color.copy(isOriginal ? baseColor : new THREE.Color(hex));
    },
    dispose() {
      // Tylko klon: tekstury i geometria należą do `GlbHairCache`.
      material.dispose();
    },
  };
}
