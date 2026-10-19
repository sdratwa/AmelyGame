import * as THREE from "three";
import { snapshotBones } from "./rootMotion";

/**
 * Najniższy punkt siatki postaci po skinningu (wysokość w układzie świata `root`, czyli z obrotem i skalą węzłów
 * nadrzędnych jak `Troll_Rig`; jednostki sceny, bez skali postaci), zmierzony na próbkach klipów. Bierzemy tylko
 * wierzchołki przy stopach (dolne `footFraction` wysokości postaci w pozie wiązania), więc koszt jest mały. Wynik służy do
 * ustawienia postaci na terenie tak, by stopy nie wchodziły w ziemię w żadnej fazie animacji. Kości wracają do stanu
 * sprzed pomiaru; poza wiązania (T-pose) wyznacza, które wierzchołki są stopami. `root` musi mieć transformację tożsamościową (jest nadrzędny wobec siatki).
 */
export function lowestPointOver(
  mesh: THREE.SkinnedMesh,
  root: THREE.Object3D,
  samples: readonly { clip: THREE.AnimationClip; times: readonly number[] }[],
  footFraction = 0.16,
): number {
  const restore = snapshotBones(root);
  const position = mesh.geometry.getAttribute("position");
  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  const rest = new THREE.Vector3();
  const restY: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < position.count; i++) {
    mesh.getVertexPosition(i, rest);
    rest.applyMatrix4(mesh.matrixWorld);
    restY.push(rest.y);
    minY = Math.min(minY, rest.y);
    maxY = Math.max(maxY, rest.y);
  }
  const foot: number[] = [];
  for (let i = 0; i < restY.length; i++) if (restY[i] < minY + (maxY - minY) * footFraction) foot.push(i);
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
        lowest = Math.min(lowest, v.applyMatrix4(mesh.matrixWorld).y);
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

/**
 * Prędkość chodu w świecie (m/s), przy której stopa w kontakcie z ziemią stoi w miejscu: nachylenie ruchu palców wzdłuż
 * osi przodu (+Z) w fazie podparcia, gdy klip chodzi w miejscu (bez root motion). Faza podparcia to próbki, w których
 * palec leży przy podłodze (`contactHeight` m nad najniższym punktem cyklu); bierzemy nachylenie prostej dopasowanej
 * do każdego ciągu podparcia (min. 15% cyklu) i uśredniamy po obu stopach. `worldScale` mnoży jednostki sceny do metrów.
 */
export function measureStanceSpeed(root: THREE.Object3D, clip: THREE.AnimationClip, toes: readonly THREE.Object3D[], worldScale: number, samples = 96, contactHeight = 0.004): number {
  const restore = snapshotBones(root);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const p = new THREE.Vector3();
  const series = toes.map(() => [] as { t: number; y: number; z: number }[]);
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * clip.duration;
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    toes.forEach((toe, k) => {
      toe.getWorldPosition(p);
      series[k].push({ t, y: p.y * worldScale, z: p.z * worldScale });
    });
  }
  action.stop();
  mixer.uncacheRoot(root);
  restore();
  root.updateMatrixWorld(true);
  const speeds: number[] = [];
  for (const s of series) {
    const minY = Math.min(...s.map((q) => q.y));
    let start = -1;
    for (let i = 0; i <= s.length; i++) {
      const contact = i < s.length && s[i].y - minY < contactHeight;
      if (contact && start < 0) start = i;
      if (!contact && start >= 0) {
        const run = s.slice(start, i);
        if (run.length >= samples * 0.15) {
          const n = run.length;
          const mt = run.reduce((a, q) => a + q.t, 0) / n;
          const mz = run.reduce((a, q) => a + q.z, 0) / n;
          let num = 0;
          let den = 0;
          for (const q of run) {
            num += (q.t - mt) * (q.z - mz);
            den += (q.t - mt) ** 2;
          }
          if (den > 0) speeds.push(-num / den);
        }
        start = -1;
      }
    }
  }
  return speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
}
