import * as THREE from "three";
import type { Rgb } from "./math";

/**
 * Materiały lampy. Metal jest wspólny dla wszystkich lamp (nic w nim nie zmienia się w czasie), a szkło i płomień są
 * własne dla każdej lampy, bo migoczą niezależnie. Materiały powstają przy zapaleniu lampy i są zwalniane przy zgaszeniu,
 * nigdy w pętli klatki.
 */
export function createMetalMaterial(): THREE.MeshStandardMaterial {
  // Ciemny, postarzany mosiądz. Bez mapy środowiska metaliczność zostaje umiarkowana, żeby metal nie był czarny.
  return new THREE.MeshStandardMaterial({ color: 0x5a4528, metalness: 0.45, roughness: 0.5 });
}

export type LanternPerLampMaterials = {
  glass: THREE.MeshStandardMaterial;
  flame: THREE.MeshBasicMaterial;
  dispose(): void;
};

export function createPerLampMaterials(): LanternPerLampMaterials {
  const glass = new THREE.MeshStandardMaterial({
    color: 0xfff0c8,
    transparent: true,
    opacity: 0.32,
    roughness: 0.15,
    metalness: 0,
    emissive: new THREE.Color(0xff9a2e),
    emissiveIntensity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Płomień świeci własnym kolorem, niezależnie od oświetlenia i mapowania tonów (to źródło światła, nie powierzchnia).
  const flame = new THREE.MeshBasicMaterial({ color: 0xffc860, toneMapped: false });
  return {
    glass,
    flame,
    dispose() {
      glass.dispose();
      flame.dispose();
    },
  };
}

/** Ustawia barwę materiału z sRGB 0-1 (three konwertuje do przestrzeni roboczej liniowej). */
export const setSrgb = (color: THREE.Color, rgb: Rgb): THREE.Color => color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
