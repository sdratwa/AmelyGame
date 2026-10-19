import * as THREE from "three";
import { parseWithoutTextures, publicDir, readJsonFile } from "@/lib/assets/glbTestkit";
import { loadDeerAsset, loadTrollAsset, sceneNodeName, type DeerAsset, type TrollAsset } from "@/lib/assets/characters";

/** Troll wczytany z `public/characters` bez tekstur (patrz `glbTestkit`): szkielet, skóra i animacje są prawdziwe. */
export const loadTestTroll = (): Promise<TrollAsset> =>
  loadTrollAsset({
    loadJson: async (url) => readJsonFile(publicDir(url.replace(/^\//, ""))),
    loadGlb: (url) => parseWithoutTextures(publicDir(url.replace(/^\//, ""))),
  });

/** Jeleń wczytany z `public/characters` bez tekstur (szkielet, skóra i animacja są prawdziwe). */
export const loadTestDeer = (): Promise<DeerAsset> =>
  loadDeerAsset({
    loadJson: async (url) => readJsonFile(publicDir(url.replace(/^\//, ""))),
    loadGlb: (url) => parseWithoutTextures(publicDir(url.replace(/^\//, ""))),
  });

const dominantJoints = new WeakMap<THREE.BufferGeometry, Int16Array>();
const dominantOf = (geometry: THREE.BufferGeometry): Int16Array => {
  let hit = dominantJoints.get(geometry);
  if (hit) return hit;
  const index = geometry.getAttribute("skinIndex");
  const weight = geometry.getAttribute("skinWeight");
  hit = new Int16Array(index.count);
  for (let i = 0; i < index.count; i++) {
    let best = -1;
    let bestWeight = -1;
    for (let k = 0; k < 4; k++) {
      if (weight.getComponent(i, k) > bestWeight) {
        bestWeight = weight.getComponent(i, k);
        best = index.getComponent(i, k);
      }
    }
    hit[i] = best;
  }
  dominantJoints.set(geometry, hit);
  return hit;
};

/** Środek (układ sceny, po skinningu) wierzchołków przypisanych głównie do kości `boneName`. */
export function boneCentroid(asset: DeerAsset, boneName: string): THREE.Vector3 {
  const mesh = asset.skinned;
  const joint = mesh.skeleton.bones.findIndex((b) => b.name === sceneNodeName(boneName));
  const dominant = dominantOf(mesh.geometry);
  const sum = new THREE.Vector3();
  const v = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < dominant.length; i++) {
    if (dominant[i] !== joint) continue;
    mesh.getVertexPosition(i, v);
    sum.add(v.applyMatrix4(mesh.matrixWorld));
    n++;
  }
  return sum.divideScalar(Math.max(1, n));
}

/**
 * Kierunek pyska względem środka poroża w układzie jelenia (przód -X, lewa strona +Z): `yawDeg` = 0, gdy pysk patrzy wprost
 * do przodu (dodatni = w lewo), `lateralDeg` = odchylenie osi między porożami od osi Z. Mierzone na bieżącej pozie sceny.
 */
export function headHeading(asset: DeerAsset): { yawDeg: number; lateralDeg: number } {
  asset.scene.updateMatrixWorld(true);
  asset.skinned.skeleton.update();
  const muzzle = boneCentroid(asset, "bone_21");
  const left = boneCentroid(asset, "bone_24");
  const right = boneCentroid(asset, "bone_27");
  const mid = left.clone().add(right).multiplyScalar(0.5);
  const forward = muzzle.sub(mid);
  const lateral = left.sub(right);
  const deg = (r: number) => (r * 180) / Math.PI;
  return { yawDeg: deg(Math.atan2(forward.z, -forward.x)), lateralDeg: deg(Math.atan2(lateral.x, -lateral.z)) };
}
