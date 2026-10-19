import * as THREE from "three";
import { snapshotBones } from "./rootMotion";

/**
 * Najniższy punkt siatki postaci (w jednostkach modelu, w układzie obiektu `root`) po skinningu, zmierzony na próbkach
 * klipów. Bierzemy tylko wierzchołki przy stopach (poniżej `footHeight` w pozie wiązania), więc koszt jest mały (ok.
 * tysiąc wierzchołków x liczba próbek). Wynik służy do ustawienia postaci na terenie tak, by stopy nie wchodziły w ziemię
 * w żadnej fazie animacji. Kości wracają do stanu sprzed pomiaru.
 */
export function lowestPointOver(
  mesh: THREE.SkinnedMesh,
  root: THREE.Object3D,
  samples: readonly { clip: THREE.AnimationClip; times: readonly number[] }[],
  footHeight = 0.15,
): number {
  const restore = snapshotBones(root);
  const position = mesh.geometry.getAttribute("position");
  const foot: number[] = [];
  for (let i = 0; i < position.count; i++) if (position.getY(i) < footHeight) foot.push(i);
  const mixer = new THREE.AnimationMixer(root);
  const v = new THREE.Vector3();
  let lowest = Infinity;
  for (const { clip, times } of samples) {
    const action = mixer.clipAction(clip);
    action.play();
    for (const t of times) {
      mixer.setTime(t);
      root.updateMatrixWorld(true);
      mesh.skeleton.update();
      for (const i of foot) {
        mesh.getVertexPosition(i, v);
        lowest = Math.min(lowest, v.y);
      }
    }
    action.stop();
  }
  mixer.uncacheRoot(root);
  restore();
  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  return Number.isFinite(lowest) ? lowest : 0;
}

/** Równomierne próbki czasu w klipie (bez powtarzania ostatniej klatki pętli). */
export const cycleTimes = (clip: THREE.AnimationClip, n: number): number[] => Array.from({ length: n }, (_, i) => (i / n) * clip.duration);
