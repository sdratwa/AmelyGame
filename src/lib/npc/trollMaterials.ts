import * as THREE from "three";
import type { TrollAsset } from "@/lib/assets/characters";
import { bakeRoughness, TROLL_ROUGHNESS, type BakedRoughness, type Pixels, type TexelClass } from "./trollSurface";

/** `matte`: poprawione materiały (domyślnie), `original`: materiał z pliku GLB bez zmian (do porównania w panelu dev). */
export type TrollMaterialMode = "matte" | "original";

/** Chropowatość, gdy nie da się odczytać pikseli atlasu (np. test bez tekstur): średnia ważona powierzchnią skóry i włosów. */
export const TROLL_FALLBACK_ROUGHNESS = 0.9;
/** Siła mapy normalnych po korekcie; 1 = jak w pliku. Mapa jest poprawna (przestrzeń styczna, +Y), więc nie ruszamy jej bez potrzeby. */
export const TROLL_NORMAL_SCALE = 1;
/** Odbicia z mapy środowiska (sceny dziś ich nie mają); ograniczone na wypadek dodania IBL. */
export const TROLL_ENV_INTENSITY = 0.25;
/** Rozdzielczość wypieczonej mapy chropowatości (atlas ma 2048; 1024 starcza dla matowej powierzchni, a zajmuje 2 MB). */
export const TROLL_ROUGHNESS_MAP_SIZE = 1024;

export type TrollMaterialReport = {
  mode: TrollMaterialMode;
  type: string;
  metalness: number;
  roughness: number;
  roughnessMap: "brak" | "z pliku (MR)" | "wypieczona";
  metalnessMap: boolean;
  normalMap: boolean;
  normalScale: number;
  envMapIntensity: number;
  /** Pola MeshPhysicalMaterial (clearcoat, sheen, transmission, specular, iridescence); puste dla MeshStandardMaterial. */
  physical: Record<string, number>;
  /** Chropowatość klas powierzchni po korekcie (`null` w trybie original i w zapasowym trybie jednolitym). */
  classes: Record<TexelClass, number> | null;
  /** Udział klas w atlasie (bez pustych pól). */
  share: BakedRoughness["share"] | null;
};

export type TrollMaterials = {
  readonly original: THREE.MeshStandardMaterial;
  readonly matte: THREE.MeshStandardMaterial;
  readonly mode: TrollMaterialMode;
  /** Czas przygotowania (ms) i powód, gdy zostało tryb zapasowy (jednolita chropowatość). */
  readonly bakeMs: number;
  readonly fallbackReason: string | null;
  setMode(mode: TrollMaterialMode): void;
  report(mode?: TrollMaterialMode): TrollMaterialReport;
  /** Zwalnia tylko to, co dodaliśmy (klon materiału i mapę chropowatości); materiał z pliku zostaje zwrócony siatce, więc `asset.dispose()` sprzątnie go z teksturami. */
  dispose(): void;
};

export type PrepareOptions = {
  mode?: TrollMaterialMode;
  /** Odczyt pikseli obrazu tekstury; `null` = niedostępny. Domyślnie przez canvas (przeglądarka). */
  readPixels?: (image: unknown) => Pixels | null;
  size?: number;
  roughness?: Readonly<Record<TexelClass, number>>;
};

/** Piksele obrazu tekstury przez canvas 2D; `null` poza przeglądarką albo dla nieznanego obrazu. */
export function readImagePixels(image: unknown): Pixels | null {
  const img = image as (CanvasImageSource & { width?: number; height?: number }) | null | undefined;
  if (!img || !img.width || !img.height) return null;
  const { width, height } = img as { width: number; height: number };
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== "undefined") canvas = Object.assign(document.createElement("canvas"), { width, height });
  else return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

const imageOf = (texture: THREE.Texture | null | undefined): unknown => texture?.image ?? texture?.source?.data ?? null;

/** Wyłącza wszystko, co daje wtórny połysk (clearcoat, sheen, transmission, specular, iridescence) w materiale fizycznym. */
function limitPhysicalLayers(material: THREE.MeshStandardMaterial): void {
  const m = material as THREE.MeshPhysicalMaterial;
  if (!m.isMeshPhysicalMaterial) return;
  m.clearcoat = 0;
  m.clearcoatMap = null;
  m.clearcoatRoughnessMap = null;
  m.clearcoatNormalMap = null;
  m.sheen = 0;
  m.sheenColorMap = null;
  m.sheenRoughnessMap = null;
  m.transmission = 0;
  m.transmissionMap = null;
  m.iridescence = 0;
  m.iridescenceMap = null;
  m.specularIntensity = Math.min(m.specularIntensity, 0.5);
  m.specularIntensityMap = null;
}

function physicalFields(material: THREE.MeshStandardMaterial): Record<string, number> {
  const m = material as THREE.MeshPhysicalMaterial;
  if (!m.isMeshPhysicalMaterial) return {};
  return { clearcoat: m.clearcoat, sheen: m.sheen, transmission: m.transmission, specularIntensity: m.specularIntensity, iridescence: m.iridescence };
}

/**
 * Lokalna korekta materiału trolla (tylko właściwości powierzchni; geometria, szkielet, wagi i animacje bez zmian).
 *
 * Plik ma jeden materiał (atlas), więc zamiast osobnych materiałów dla skóry, brody, nosa i oczu klasyfikujemy teksele atlasu po
 * kolorze i wypiekamy z tego mapę chropowatości. Tekstury koloru i normalnych zostają te same, a w trybie matte siatka dostaje klon
 * materiału: oryginał pozostaje nietknięty (przełącznik w panelu dev) i nie ma wpływu na żaden inny model. Liczba materiałów na
 * rysowaniu się nie zmienia (nadal jeden, jedno wywołanie rysowania).
 */
export function prepareTrollMaterials(asset: TrollAsset, options: PrepareOptions = {}): TrollMaterials {
  const mesh = asset.skinned;
  const original = mesh.material as THREE.MeshStandardMaterial;
  if (Array.isArray(original) || !(original as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    throw new Error("Troll: oczekiwano jednego materiału MeshStandardMaterial.");
  }
  const table = options.roughness ?? TROLL_ROUGHNESS;
  const readPixels = options.readPixels ?? readImagePixels;
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();

  const matte = original.clone();
  matte.name = `${original.name || "Troll"}.matte`;
  matte.metalness = 0;
  matte.metalnessMap = null;
  matte.envMapIntensity = TROLL_ENV_INTENSITY;
  matte.normalScale.set(TROLL_NORMAL_SCALE, TROLL_NORMAL_SCALE);
  limitPhysicalLayers(matte);

  let baked: BakedRoughness | null = null;
  let bakedTexture: THREE.DataTexture | null = null;
  let fallbackReason: string | null = null;
  const source = original.roughnessMap ?? original.metalnessMap;
  try {
    const base = original.map ? readPixels(imageOf(original.map)) : null;
    const mr = source ? readPixels(imageOf(source)) : null;
    if (!base || !mr) {
      fallbackReason = !original.map || !source ? "materiał bez tekstur koloru lub MR" : "brak odczytu pikseli (poza przeglądarką)";
    } else {
      baked = bakeRoughness(base, mr, options.size ?? TROLL_ROUGHNESS_MAP_SIZE, table);
      const rg = new Uint8Array(baked.size * baked.size * 2);
      for (let i = 0; i < baked.data.length; i++) rg[i * 2 + 1] = baked.data[i];
      bakedTexture = new THREE.DataTexture(rg, baked.size, baked.size, THREE.RGFormat, THREE.UnsignedByteType);
      bakedTexture.name = "Troll_roughness_matte";
      bakedTexture.colorSpace = THREE.NoColorSpace;
      bakedTexture.wrapS = THREE.ClampToEdgeWrapping;
      bakedTexture.wrapT = THREE.ClampToEdgeWrapping;
      bakedTexture.magFilter = THREE.LinearFilter;
      bakedTexture.minFilter = THREE.LinearMipmapLinearFilter;
      bakedTexture.generateMipmaps = true;
      bakedTexture.anisotropy = source?.anisotropy ?? 1;
      bakedTexture.needsUpdate = true;
    }
  } catch (e) {
    baked = null;
    bakedTexture?.dispose();
    bakedTexture = null;
    fallbackReason = e instanceof Error ? e.message : String(e);
  }
  if (bakedTexture) {
    matte.roughnessMap = bakedTexture;
    matte.roughness = 1;
  } else {
    matte.roughnessMap = null;
    matte.roughness = TROLL_FALLBACK_ROUGHNESS;
  }
  matte.needsUpdate = true;
  const bakeMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;

  let mode: TrollMaterialMode = options.mode ?? "matte";
  let disposed = false;
  const apply = () => {
    mesh.material = mode === "matte" ? matte : original;
  };
  apply();

  const describe = (which: TrollMaterialMode): TrollMaterialReport => {
    const m = which === "matte" ? matte : original;
    const own = which === "matte";
    return {
      mode: which,
      type: (m as THREE.Material).type,
      metalness: m.metalness,
      roughness: m.roughness,
      roughnessMap: m.roughnessMap ? (own && bakedTexture ? "wypieczona" : "z pliku (MR)") : "brak",
      metalnessMap: !!m.metalnessMap,
      normalMap: !!m.normalMap,
      normalScale: m.normalScale.x,
      envMapIntensity: m.envMapIntensity,
      physical: physicalFields(m),
      classes: own && baked ? { ...table } : null,
      share: own && baked ? baked.share : null,
    };
  };

  return {
    original,
    matte,
    get mode() {
      return mode;
    },
    bakeMs,
    fallbackReason,
    setMode(next) {
      if (disposed || next === mode) return;
      mode = next;
      apply();
    },
    report: (which) => describe(which ?? mode),
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.material = original;
      matte.dispose();
      bakedTexture?.dispose();
    },
  };
}
