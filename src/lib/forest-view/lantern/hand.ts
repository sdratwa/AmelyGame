import type * as THREE from "three";
import { sceneNodeName } from "../../assets/characters";

/** Kość dłoni szkieletu Mixamo, do której chwytamy lampę (nazwa przed sanityzacją przez GLTFLoader). */
export const LANTERN_HAND_BONE = "mixamorig:RightHand";

/** Znajduje kość dłoni w scenie modelu gracza (`null`, gdy szkielet jej nie ma; wtedy lampy nie da się pokazać w dłoni). */
export function findHandBone(scene: THREE.Object3D): THREE.Object3D | null {
  return scene.getObjectByName(sceneNodeName(LANTERN_HAND_BONE)) ?? null;
}
