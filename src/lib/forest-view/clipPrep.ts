import * as THREE from "three";
import { measureRootMotion, type RootMotion } from "@/lib/npc/rootMotion";

/** Czas w klipie `jump` (s), w którym biodra wracają na wysokość startową: koniec lotu, dalej amortyzacja lądowania. */
export const JUMP_AIR_CLIP_TIME = 0.667;
/** Chwila klipu `jump` ze szczytem skoku (poza lotu, gdy postać spada bez skoku). */
export const JUMP_APEX_CLIP_TIME = 0.35;

export type ClipPrepReport = {
  clip: string;
  /** Poziome przesunięcie bioder usunięte z klipu (jednostki modelu): średnia X i Z. */
  removedMean: { x: number; z: number };
  /** Największy pionowy wzrost bioder ponad pozycję startową usunięty z klipu (jednostki modelu). */
  removedRise: number;
  /** Pomiar oryginału: dryf pierwsza-ostatnia klatka i długość kroku. */
  measured: RootMotion;
  /** Obrót klipu wokół osi pionowej zastosowany do bioder (stopnie), 0 gdy bez korekty. */
  yawCorrectionDeg: number;
};

/**
 * Korekta kierunku ciała w klipach, które w pliku mają postać obróconą względem kierunku ruchu. Zmierzone z pliku
 * (kierunek ruchu z fazy podparcia stóp, przód modelu = +Z): `crouch_sneak_left` ma miednicę obróconą o -161° i ruch
 * w stronę -X, `crouch_sneak_right` o +160° i ruch w stronę +X, czyli postać skradała się tyłem do kierunku patrzenia
 * (stąd "twarzą do kamery" i odwrócone kroki). Obrót o 180° ustawia przód na +Z, a ruch na +X (lewo) i -X (prawo) jak
 * w pozostałych klipach (chód i bieg: ruch 0°). Klipy `crouch_walk_*` mają ruch zgodny z nazwą (-4° i -179°), więc
 * zostają bez zmian.
 */
export const CLIP_YAW_CORRECTION_DEG: Readonly<Record<string, number>> = {
  crouch_sneak_left: 180,
  crouch_sneak_right: 180,
};

/** Klipy, dla których powstaje lustrzana kopia `<nazwa>_m` (ukosy w lewo, patrz `mirrorShare`). */
export const MIRRORED_CLIPS = ["crouch_walk_forward", "crouch_walk_back"] as const;
export const mirrorName = (name: string) => `${name}_m`;

const swapSide = (bone: string) => bone.replace(/^(mixamorig)(Left|Right)/, (_, a: string, side: string) => a + (side === "Left" ? "Right" : "Left"));

/**
 * Lustrzane odbicie klipu względem płaszczyzny YZ (lewo <-> prawo): zamienia kości `Left`/`Right`, w obrotach neguje Y i Z
 * kwaternionu, a w pozycjach X. Zgodne z szkieletem Mixamo tego GLB (sprawdzone na pliku: odbicie `crouch_sneak_right` pokrywa
 * się z `crouch_sneak_left`). Oryginał bez zmian.
 */
export function mirrorClip(clip: THREE.AnimationClip, name = mirrorName(clip.name)): THREE.AnimationClip {
  const tracks = clip.tracks.map((t) => {
    const dot = t.name.lastIndexOf(".");
    const out = t.clone();
    out.name = swapSide(t.name.slice(0, dot)) + t.name.slice(dot);
    const v = out.values;
    if (t.name.endsWith(".quaternion")) {
      for (let i = 0; i < v.length; i += 4) {
        v[i + 1] = -v[i + 1];
        v[i + 2] = -v[i + 2];
      }
    } else if (t.name.endsWith(".position")) {
      for (let i = 0; i < v.length; i += 3) v[i] = -v[i];
    }
    return out;
  });
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

/**
 * Faza kroku w klipie (0-1), w której lewa stopa wyprzedza prawą w kierunku ruchu (rosnące przejście przez zero),
 * zmierzona z pliku po obróbce kierunku (`CLIP_YAW_CORRECTION_DEG`). Animator odtwarza klipy grupy ze wspólną fazą
 * przesuniętą o te wartości, więc w mieszaniu (ukosy) stopy zmieniają się w tym samym momencie. Bez tego
 * `crouch_sneak_left` (0,49) był o pół cyklu przesunięty względem `crouch_walk_forward` i `crouch_walk_back`: ukosy w lewo
 * mieszały przeciwne fazy nóg (ślizganie stóp), a ukosy w prawo (0,97) były zgodne.
 */
export const CLIP_PHASE_ANCHOR: Readonly<Record<string, number>> = {
  walk: 0.023,
  run: 0.987,
  crouch_walk_forward: 0.998,
  crouch_walk_back: 0.067,
  crouch_sneak_left: 0.492,
  crouch_sneak_right: 0.971,
  // Odbicie zamienia nogi, więc ta sama chwila kroku wypada o pół cyklu dalej niż w oryginale.
  crouch_walk_forward_m: 0.498,
  crouch_walk_back_m: 0.472,
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Obraca ruch bioder (obrót i przesunięcie) o `yawRad` wokół osi pionowej, czyli cały korpus razem z nogami (kości
 * potomne mają obroty lokalne). Zakładamy, że rodzic bioder ma transformację jednostkową (tak jest w tym GLB).
 * Oryginał nie jest zmieniany.
 */
export function rotateClipYaw(clip: THREE.AnimationClip, bone: string, yawRad: number): THREE.AnimationClip {
  const out = clip.clone();
  if (yawRad === 0) return out;
  const turn = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yawRad);
  const q = out.tracks.find((t) => t.name === `${bone}.quaternion`);
  if (q) {
    const tmp = new THREE.Quaternion();
    for (let i = 0; i < q.times.length; i++) {
      tmp.fromArray(q.values, i * 4).premultiply(turn).toArray(q.values, i * 4);
    }
  }
  const p = positionTrack(out, bone);
  if (p) {
    const c = Math.cos(yawRad);
    const s = Math.sin(yawRad);
    for (let i = 0; i < p.times.length; i++) {
      const x = p.values[i * 3];
      const z = p.values[i * 3 + 2];
      p.values[i * 3] = x * c + z * s;
      p.values[i * 3 + 2] = -x * s + z * c;
    }
  }
  return out;
}

const positionTrack = (clip: THREE.AnimationClip, bone: string) =>
  clip.tracks.find((t) => t.name === `${bone}.position`) as THREE.VectorKeyframeTrack | undefined;

/**
 * Klip pętlowy: od ścieżki pozycji bioder odejmuje poziomą średnią (X i Z), żeby biodra krążyły wokół osi kapsuły gracza
 * (stałe przesunięcie boczne w klipach kucania ślizgałoby ciało przy crossfade). Ruch pionowy bioder i poziome kołysanie
 * wokół średniej zostają, ścieżki obrotów nie są dotykane. Oryginał się nie zmienia (praca na kopii).
 */
export function recenterLoopClip(clip: THREE.AnimationClip, bone: string): { clip: THREE.AnimationClip; report: ClipPrepReport } {
  const measured = measureRootMotion(clip, bone, 1);
  const out = clip.clone();
  const track = positionTrack(out, bone);
  const mean = { x: 0, z: 0 };
  if (track && track.times.length > 0) {
    const n = track.times.length;
    const v = track.values;
    for (let i = 0; i < n; i++) {
      mean.x += v[i * 3];
      mean.z += v[i * 3 + 2];
    }
    mean.x /= n;
    mean.z /= n;
    for (let i = 0; i < n; i++) {
      v[i * 3] -= mean.x;
      v[i * 3 + 2] -= mean.z;
    }
  }
  return { clip: out, report: { clip: clip.name, removedMean: mean, removedRise: 0, measured, yawCorrectionDeg: 0 } };
}

/**
 * Klip skoku: usuwa tylko pionowy wzrost bioder ponad pozycję startową (`y' = y0 + min(0, y - y0)`), bo łuk skoku daje
 * fizyka kontrolera; zostaje dół amortyzacji lądowania, cofnięcie bioder i wszystkie obroty (poza lotu). Oryginał bez zmian.
 */
export function stripJumpRise(clip: THREE.AnimationClip, bone: string): { clip: THREE.AnimationClip; report: ClipPrepReport } {
  const measured = measureRootMotion(clip, bone, 1);
  const out = clip.clone();
  const track = positionTrack(out, bone);
  let rise = 0;
  if (track && track.times.length > 0) {
    const v = track.values;
    const y0 = v[1];
    for (let i = 0; i < track.times.length; i++) {
      const y = v[i * 3 + 1];
      if (y - y0 > rise) rise = y - y0;
      v[i * 3 + 1] = y0 + Math.min(0, y - y0);
    }
  }
  return { clip: out, report: { clip: clip.name, removedMean: { x: 0, z: 0 }, removedRise: rise, measured, yawCorrectionDeg: 0 } };
}

/**
 * Przygotowuje komplet klipów gracza (kopie): najpierw korekta kierunku ciała (`CLIP_YAW_CORRECTION_DEG`), potem `jump`
 * bez wzrostu pionowego, a reszta wyśrodkowana w poziomie.
 */
export function preparePlayerClips(clips: readonly THREE.AnimationClip[], bone: string): { clips: Map<string, THREE.AnimationClip>; reports: ClipPrepReport[] } {
  const out = new Map<string, THREE.AnimationClip>();
  const reports: ClipPrepReport[] = [];
  for (const original of clips) {
    const yawDeg = CLIP_YAW_CORRECTION_DEG[original.name] ?? 0;
    const clip = yawDeg === 0 ? original : rotateClipYaw(original, bone, (yawDeg * Math.PI) / 180);
    const r = clip.name === "jump" ? stripJumpRise(clip, bone) : recenterLoopClip(clip, bone);
    out.set(clip.name, r.clip);
    reports.push({ ...r.report, yawCorrectionDeg: yawDeg });
    if ((MIRRORED_CLIPS as readonly string[]).includes(clip.name)) {
      const m = recenterLoopClip(mirrorClip(clip), bone);
      out.set(m.clip.name, m.clip);
      reports.push({ ...m.report, yawCorrectionDeg: 0 });
    }
  }
  return { clips: out, reports };
}
