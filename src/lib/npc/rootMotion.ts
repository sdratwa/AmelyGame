import * as THREE from "three";

export type RootMotion = {
  /** Przesunięcie kości w jednostkach modelu między pierwszą a ostatnią klatką klipu (poziomo X/Z; Y to różnica wysokości, zwykle 0). */
  drift: { x: number; y: number; z: number };
  duration: number;
  /** Długość poziomego przesunięcia na cykl (jednostki modelu). */
  stride: number;
  /** Poziomy kierunek przesunięcia (wektor jednostkowy w układzie modelu); (0, 0), gdy klip nie ma przesunięcia. */
  direction: { x: number; z: number };
};

export type RootMotionResult = {
  /** Klip z usuniętym liniowym trendem poziomym kości; oryginał nie jest zmieniany. */
  clip: THREE.AnimationClip;
  removed: RootMotion;
};

const positionTrackOf = (clip: THREE.AnimationClip, bone: string): THREE.VectorKeyframeTrack | null =>
  (clip.tracks.find((t) => t.name === `${bone}.position`) as THREE.VectorKeyframeTrack | undefined) ?? null;

/** Mierzy poziomy dryf kości w klipie bez zmieniania go. */
export function measureRootMotion(clip: THREE.AnimationClip, bone: string): RootMotion {
  const track = positionTrackOf(clip, bone);
  if (!track || track.times.length < 2) return { drift: { x: 0, y: 0, z: 0 }, duration: clip.duration, stride: 0, direction: { x: 0, z: 0 } };
  const v = track.values;
  const last = track.times.length - 1;
  const drift = { x: v[last * 3] - v[0], y: v[last * 3 + 1] - v[1], z: v[last * 3 + 2] - v[2] };
  const stride = Math.hypot(drift.x, drift.z);
  return { drift, duration: track.times[last] - track.times[0], stride, direction: stride > 1e-9 ? { x: drift.x / stride, z: drift.z / stride } : { x: 0, z: 0 } };
}

/**
 * Usuwa poziomy root motion: od ścieżki pozycji kości biodrowej odejmuje liniowy trend X i Z (od pierwszej do ostatniej
 * klatki), więc pierwsza i ostatnia klatka mają to samo położenie poziome i klip zapętla się bez skoku. Pionowy ruch bioder
 * (Y), oscylacje poziome wokół trendu (kołysanie, "napór" na krok) i wszystkie ścieżki obrotów zostają bez zmian, a
 * suma ruchu świata (prędkość patrolu x czas + reszta ścieżki) odtwarza oryginalny ruch bioder, więc stopy nie ślizgają
 * się, jeśli NPC porusza się z prędkością `stride / duration`.
 */
export function stripRootMotion(clip: THREE.AnimationClip, bone: string): RootMotionResult {
  const removed = measureRootMotion(clip, bone);
  const out = clip.clone();
  const track = positionTrackOf(out, bone);
  if (track && track.times.length >= 2) {
    const t0 = track.times[0];
    const span = track.times[track.times.length - 1] - t0;
    const values = track.values;
    if (span > 0) {
      for (let i = 0; i < track.times.length; i++) {
        const k = (track.times[i] - t0) / span;
        values[i * 3] -= removed.drift.x * k;
        values[i * 3 + 2] -= removed.drift.z * k;
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
export function horizontalExcursion(clip: THREE.AnimationClip, bone: string): number {
  const track = positionTrackOf(clip, bone);
  if (!track) return 0;
  const v = track.values;
  let max = 0;
  for (let i = 0; i < track.times.length; i++) max = Math.max(max, Math.hypot(v[i * 3] - v[0], v[i * 3 + 2] - v[2]));
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
