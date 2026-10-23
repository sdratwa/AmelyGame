import * as THREE from "three";
import { createLanternGeometries, FLAME_BASE_Y, FLAME_CENTER_Y, LANTERN_VISUAL_SCALE, type LanternGeometries } from "./geometry";
import { createMetalMaterial, createPerLampMaterials, setSrgb } from "./materials";
import type { Rgb } from "./math";

/** Dane zmieniające się co klatkę (migotanie): sam model nie liczy światła ani szumu. */
export type LanternVisualFrame = {
  /** Mnożnik jasności emisji (migotanie × `flameEmissive`). */
  emissive: number;
  /** Barwa płomienia (sRGB 0-1). */
  flameColor: Rgb;
  /** Mnożnik wysokości płomienia (około 1). */
  flameScale: number;
};

/**
 * Widok jednej lampy w dłoni. `root` wisi na kości; `flameAnchor` to punkt w przestrzeni `root`, w którym stoi płomień
 * (źródło światła i blasku). Własny model GLB musi tylko dostarczyć te trzy rzeczy, więc da się go podmienić bez zmian
 * w systemie.
 */
export type LanternVisual = {
  root: THREE.Object3D;
  flameAnchor: THREE.Object3D;
  update(frame: LanternVisualFrame): void;
  dispose(): void;
};

/** Zasoby wspólne dla wszystkich lamp systemu (geometria i metal). Zwalniane razem z systemem. */
export type LanternVisualAssets = {
  geometries: LanternGeometries;
  metal: THREE.MeshStandardMaterial;
  dispose(): void;
};

export type LanternVisualFactory = (assets: LanternVisualAssets) => LanternVisual;

export function createLanternVisualAssets(): LanternVisualAssets {
  const geometries = createLanternGeometries();
  const metal = createMetalMaterial();
  return {
    geometries,
    metal,
    dispose() {
      geometries.dispose();
      metal.dispose();
    },
  };
}

const tint = new THREE.Color();

/** Domyślna, proceduralna lampa: korpus (metal), szklany klosz z poświatą i płomień. Bez rzucania cieni (światło jest w środku). */
export const createProceduralLantern: LanternVisualFactory = (assets) => {
  const per = createPerLampMaterials();
  const root = new THREE.Group();
  root.name = "oil-lantern";
  const model = new THREE.Group();
  model.scale.setScalar(LANTERN_VISUAL_SCALE);
  root.add(model);

  const body = new THREE.Mesh(assets.geometries.body, assets.metal);
  const glass = new THREE.Mesh(assets.geometries.glass, per.glass);
  const flame = new THREE.Mesh(assets.geometries.flame, per.flame);
  flame.position.y = FLAME_BASE_Y;
  glass.renderOrder = 2;
  for (const m of [body, glass, flame]) {
    m.castShadow = false;
    m.receiveShadow = false;
  }
  body.name = "oil-lantern-body";
  glass.name = "oil-lantern-glass";
  flame.name = "oil-lantern-flame";
  model.add(body, glass, flame);

  const flameAnchor = new THREE.Object3D();
  flameAnchor.name = "oil-lantern-flame-anchor";
  flameAnchor.position.y = FLAME_CENTER_Y;
  model.add(flameAnchor);

  return {
    root,
    flameAnchor,
    update(frame) {
      per.glass.emissiveIntensity = 0.9 * frame.emissive;
      per.flame.color.copy(setSrgb(tint, frame.flameColor));
      flame.scale.set(1, frame.flameScale, 1);
    },
    dispose() {
      root.removeFromParent();
      per.dispose();
    },
  };
};
