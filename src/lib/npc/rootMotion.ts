import * as THREE from "three";

/** Oś lokalna ścieżki pozycji kości, która jest "w górę" (0 = X, 1 = Y, 2 = Z); pozostałe dwie są poziome. */
export type Axis = 0 | 1 | 2;

export type RootMotion = {
  /** Przesunięcie kości w jednostkach lokalnych między pierwszą a ostatnią klatką klipu (osie x/y/z ścieżki; oś pionowa to różnica wysokości, zwykle 0). */
  drift: { x: number; y: number; z: number };
  duration: number;
  /** Długość poziomego przesunięcia na cykl (jednostki modelu). */
  stride: number;
  /** Kierunek przesunięcia na dwóch osiach poziomych (kolejno mniejsza i większa oś; dla osi pionowej Y to x i z), wektor jednostkowy; (0, 0) bez przesunięcia. */
  direction: { x: number; z: number };
};

export type RootMotionResult = {
  /** Klip z usuniętym liniowym trendem poziomym kości; oryginał nie jest zmieniany. */
  clip: THREE.AnimationClip;
  removed: RootMotion;
};

const positionTrackOf = (clip: THREE.AnimationClip, bone: string): THREE.VectorKeyframeTrack | null =>
  (clip.tracks.find((t) => t.name === `${bone}.position`) as THREE.VectorKeyframeTrack | undefined) ?? null;

const horizontalAxes = (vertical: Axis): [Axis, Axis] => (vertical === 0 ? [1, 2] : vertical === 1 ? [0, 2] : [0, 1]);

/**
 * Oś lokalna rodzica kości (w ścieżkach pozycji), która w świecie jest "w górę": dla szkieletu w węźle z obrotem 90° (Blender,
 * Z w górę) to Z, dla zwykłego (Y w górę) to Y.
 */
export function verticalAxisOf(bone: THREE.Object3D): Axis {
  const parent = bone.parent;
  if (!parent) return 1;
  parent.updateWorldMatrix(true, false);
  const q = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const a = [Math.abs(up.x), Math.abs(up.y), Math.abs(up.z)];
  return (a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2) as Axis;
}

/** Mierzy poziomy dryf kości w klipie bez zmieniania go. */
export function measureRootMotion(clip: THREE.AnimationClip, bone: string, vertical: Axis = 1): RootMotion {
  const track = positionTrackOf(clip, bone);
  if (!track || track.times.length < 2) return { drift: { x: 0, y: 0, z: 0 }, duration: clip.duration, stride: 0, direction: { x: 0, z: 0 } };
  const v = track.values;
  const last = track.times.length - 1;
  const drift = { x: v[last * 3] - v[0], y: v[last * 3 + 1] - v[1], z: v[last * 3 + 2] - v[2] };
  const d = [drift.x, drift.y, drift.z];
  const [a, b] = horizontalAxes(vertical);
  const stride = Math.hypot(d[a], d[b]);
  return { drift, duration: track.times[last] - track.times[0], stride, direction: stride > 1e-9 ? { x: d[a] / stride, z: d[b] / stride } : { x: 0, z: 0 } };
}

/**
 * Usuwa poziomy root motion: od ścieżki pozycji kości biodrowej odejmuje liniowy trend na osiach poziomych (od pierwszej do
 * ostatniej klatki), więc pierwsza i ostatnia klatka mają to samo położenie poziome i klip zapętla się bez skoku. Ruch
 * pionowy bioder, oscylacje poziome wokół trendu (kołysanie) i wszystkie ścieżki obrotów zostają bez zmian, a suma ruchu
 * świata (prędkość patrolu x czas + reszta ścieżki) odtwarza oryginalny ruch bioder, więc stopy nie ślizgają się, jeśli NPC
 * porusza się z prędkością `stride / duration`. Oś pionową podaje `vertical` (patrz `verticalAxisOf`).
 */
export function stripRootMotion(clip: THREE.AnimationClip, bone: string, vertical: Axis = 1): RootMotionResult {
  const removed = measureRootMotion(clip, bone, vertical);
  const out = clip.clone();
  const track = positionTrackOf(out, bone);
  if (track && track.times.length >= 2) {
    const t0 = track.times[0];
    const span = track.times[track.times.length - 1] - t0;
    const values = track.values;
    const d = [removed.drift.x, removed.drift.y, removed.drift.z];
    const axes = horizontalAxes(vertical);
    if (span > 0) {
      for (let i = 0; i < track.times.length; i++) {
        const k = (track.times[i] - t0) / span;
        for (const axis of axes) values[i * 3 + axis] -= d[axis] * k;
      }
    }
  }
  return { clip: out, removed };
}

/** Nominalna prędkość chodu w świecie (m/s): długość kroku z przesunięcia bioder, skala modelu i czas cyklu. */
export function nominalSpeed(removed: RootMotion, worldScale: number): number {
  return removed.duration > 0 ? (removed.stride * worldScale) / removed.duration : 0;
}

/** Maksymalne poziome odchylenie ścieżki kości od jej pierwszego położenia (jednostki modelu); do testów i diagnostyki. */
export function horizontalExcursion(clip: THREE.AnimationClip, bone: string, vertical: Axis = 1): number {
  const track = positionTrackOf(clip, bone);
  if (!track) return 0;
  const v = track.values;
  const [a, b] = horizontalAxes(vertical);
  let max = 0;
  for (let i = 0; i < track.times.length; i++) max = Math.max(max, Math.hypot(v[i * 3 + a] - v[a], v[i * 3 + b] - v[b]));
  return max;
}

/** Zapamiętuje pozycję, obrót i skalę wszystkich kości; zwrócona funkcja przywraca ten stan. */
export function snapshotBones(root: THREE.Object3D): () => void {
  const saved: { bone: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) saved.push({ bone: o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
  });
  return () => {
    for (const { bone, p, q, s } of saved) {
      bone.position.copy(p);
      bone.quaternion.copy(q);
      bone.scale.copy(s);
    }
  };
}

/**
 * Klip jednej pozy: próbkuje `source` w chwili `time` i zapisuje stałe ścieżki (pozycja, obrót, skala wszystkich kości
 * sceny `root`). Służy za "Idle" bez ruchu, gdy model nie ma własnej animacji spoczynkowej (poza wiązania to T-pose).
 */
export function poseClipFrom(root: THREE.Object3D, source: THREE.AnimationClip, time: number, name: string, duration = 1): THREE.AnimationClip {
  const restore = snapshotBones(root);
  const scratch = new THREE.AnimationMixer(root);
  const action = scratch.clipAction(source);
  action.play();
  scratch.setTime(time);
  const tracks: THREE.KeyframeTrack[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const key = o.name;
    tracks.push(new THREE.VectorKeyframeTrack(`${key}.position`, [0, duration], [...o.position.toArray(), ...o.position.toArray()]));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${key}.quaternion`, [0, duration], [...o.quaternion.toArray(), ...o.quaternion.toArray()]));
    tracks.push(new THREE.VectorKeyframeTrack(`${key}.scale`, [0, duration], [...o.scale.toArray(), ...o.scale.toArray()]));
  });
  action.stop();
  scratch.uncacheRoot(root);
  restore();
  return new THREE.AnimationClip(name, duration, tracks);
}

/**
 * Poziome przesunięcie kości w świecie (m) między pierwszą a ostatnią klatką klipu, liczone z pozy szkieletu (uwzględnia
 * obrót i skalę węzłów nadrzędnych, np. `Troll_Rig`). Klip chodzący w miejscu daje ok. 0.
 */
export function worldDrift(root: THREE.Object3D, clip: THREE.AnimationClip, bone: THREE.Object3D, worldScale: number): number {
  const restore = snapshotBones(root);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const at = (t: number) => {
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    return bone.getWorldPosition(new THREE.Vector3());
  };
  const a = at(0);
  const b = at(clip.duration);
  action.stop();
  mixer.uncacheRoot(root);
  restore();
  root.updateMatrixWorld(true);
  return Math.hypot(b.x - a.x, b.z - a.z) * worldScale;
}
