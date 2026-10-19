import * as THREE from "three";
import { snapshotBones } from "./rootMotion";

/**
 * Najniższy punkt siatki postaci po skinningu (wysokość w układzie świata `root`, czyli z obrotem i skalą węzłów
 * nadrzędnych jak `Troll_Rig`; jednostki sceny, bez skali postaci), zmierzony na próbkach klipów. Bierzemy tylko
 * wierzchołki przy stopach (dolne `footFraction` wysokości postaci w pozie wiązania), więc koszt jest mały. Wynik służy do
 * ustawienia postaci na terenie tak, by stopy nie wchodziły w ziemię w żadnej fazie animacji. Kości wracają do stanu
 * sprzed pomiaru; poza wiązania (T-pose) wyznacza, które wierzchołki są stopami. `root` musi mieć transformację tożsamościową (jest nadrzędny wobec siatki).
 * `tilt` (rad) przechyla postać wokół osi bocznej Z przez początek układu przed pomiarem (dodatni = przód w -X w dół).
 */
export function lowestPointOver(
  mesh: THREE.SkinnedMesh,
  root: THREE.Object3D,
  samples: readonly { clip: THREE.AnimationClip; times: readonly number[] }[],
  footFraction = 0.16,
  tilt = 0,
): number {
  const sinT = Math.sin(tilt);
  const cosT = Math.cos(tilt);
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
        v.applyMatrix4(mesh.matrixWorld);
        lowest = Math.min(lowest, tilt === 0 ? v.y : v.y * cosT + v.x * sinT);
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
 * osi przodu (`forward`, domyślnie +Z) w fazie podparcia, gdy klip chodzi w miejscu (bez root motion). Faza podparcia to próbki, w których
 * palec leży przy podłodze (`contactHeight` m nad najniższym punktem cyklu); bierzemy nachylenie prostej dopasowanej
 * do każdego ciągu podparcia (min. 15% cyklu) i uśredniamy po obu stopach. `worldScale` mnoży jednostki sceny do metrów.
 */
export function measureStanceSpeed(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  toes: readonly THREE.Object3D[],
  worldScale: number,
  samples = 96,
  contactHeight = 0.004,
  forward: THREE.Vector3Like = { x: 0, y: 0, z: 1 },
): number {
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
      series[k].push({ t, y: p.y * worldScale, z: (p.x * forward.x + p.y * forward.y + p.z * forward.z) * worldScale });
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

export type FootSamples = { x: Float32Array; y: Float32Array; times: number };

/**
 * Wierzchołki stóp (dolne `footFraction` wysokości w pozie wiązania) podzielone na przednie i tylne (według położenia
 * wzdłuż X względem środka stóp) i ich położenie (układ `root`, jednostki sceny) w kolejnych próbkach klipu. Służy do
 * wyznaczenia przechyłu, przy którym przednie i tylne nogi sięgają tej samej wysokości.
 */
export function footSamplesOver(
  mesh: THREE.SkinnedMesh,
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  times: readonly number[],
  footFraction = 0.16,
): { front: FootSamples; hind: FootSamples } {
  const restore = snapshotBones(root);
  const position = mesh.geometry.getAttribute("position");
  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  const rest = new THREE.Vector3();
  const restPoints: { x: number; y: number }[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < position.count; i++) {
    mesh.getVertexPosition(i, rest);
    rest.applyMatrix4(mesh.matrixWorld);
    restPoints.push({ x: rest.x, y: rest.y });
    minY = Math.min(minY, rest.y);
    maxY = Math.max(maxY, rest.y);
  }
  const foot: number[] = [];
  for (let i = 0; i < restPoints.length; i++) if (restPoints[i].y < minY + (maxY - minY) * footFraction) foot.push(i);
  const mid = foot.reduce((a, i) => a + restPoints[i].x, 0) / Math.max(1, foot.length);
  const front = foot.filter((i) => restPoints[i].x < mid);
  const hind = foot.filter((i) => restPoints[i].x >= mid);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const v = new THREE.Vector3();
  const alloc = (n: number): FootSamples => ({ x: new Float32Array(n * times.length), y: new Float32Array(n * times.length), times: times.length });
  const out = { front: alloc(front.length), hind: alloc(hind.length) };
  times.forEach((t, k) => {
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    mesh.skeleton.update();
    for (const [ids, samples] of [[front, out.front], [hind, out.hind]] as const) {
      ids.forEach((id, j) => {
        mesh.getVertexPosition(id, v);
        v.applyMatrix4(mesh.matrixWorld);
        samples.x[k * ids.length + j] = v.x;
        samples.y[k * ids.length + j] = v.y;
      });
    }
  });
  action.stop();
  mixer.uncacheRoot(root);
  restore();
  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  return out;
}

const lowestTilted = (s: FootSamples, tilt: number): number => {
  const sin = Math.sin(tilt);
  const cos = Math.cos(tilt);
  let low = Infinity;
  for (let i = 0; i < s.x.length; i++) low = Math.min(low, s.y[i] * cos + s.x[i] * sin);
  return low;
};

/**
 * Przechył wokół osi bocznej Z (rad, dodatni = przód w -X w dół), przy którym najniższe punkty przednich i tylnych stóp w
 * cyklu klipu leżą na tej samej wysokości. Klip chodu jelenia opuszcza zad ok. 10 cm niżej niż przód, więc bez tej korekty
 * tylne kopyta wchodziłyby w ziemię albo przednie wisiałyby nad nią. Wynik w granicach `limit`.
 */
export function balancedTilt(feet: { front: FootSamples; hind: FootSamples }, limit = 0.25): number {
  let lo = -limit;
  let hi = limit;
  const f = (a: number) => lowestTilted(feet.front, a) - lowestTilted(feet.hind, a);
  if (f(lo) < 0) return lo;
  if (f(hi) > 0) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
