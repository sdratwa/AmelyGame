import * as THREE from "three";
import { snapshotBones } from "./rootMotion";

/** Moment w cyklu klipu (s), w którym stopa dotyka ziemi, i która to stopa (0 = lewa, 1 = prawa). */
export type Footfall = { time: number; foot: 0 | 1 };

export type FootfallAnalysis = {
  footfalls: Footfall[];
  /** Długość cyklu klipu (s). */
  duration: number;
  /** Wysokość kostki każdej stopy nad jej najniższym punktem w cyklu (m), co próbkę; do testów i diagnostyki. */
  heights: [number[], number[]];
};

/**
 * Kontakty stóp z ziemią w klipie chodu (animacja w miejscu): dla każdej stopy kontakt zaczyna się, gdy kostka schodzi poniżej
 * `contactFraction` zakresu własnej wysokości w cyklu po fazie wymachu (uderzenie piętą). Histereza `rearm` (krotność progu)
 * zapobiega wielokrotnym wykryciom przy drżeniu wysokości na plateau kontaktu. Kości wracają do stanu sprzed pomiaru.
 * Wywołuj przed dodaniem sceny do grupy ze skalą: pomiary używają `worldScale` (jednostki sceny -> metry).
 */
export function detectFootfalls(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  ankles: readonly [THREE.Object3D, THREE.Object3D],
  worldScale: number,
  samples = 120,
  contactFraction = 0.3,
  rearm = 1.6,
): FootfallAnalysis {
  const restore = snapshotBones(root);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const p = new THREE.Vector3();
  const raw: [number[], number[]] = [[], []];
  for (let i = 0; i < samples; i++) {
    mixer.setTime((i / samples) * clip.duration);
    root.updateMatrixWorld(true);
    ankles.forEach((a, k) => {
      a.getWorldPosition(p);
      raw[k].push(p.y * worldScale);
    });
  }
  action.stop();
  mixer.uncacheRoot(root);
  restore();
  root.updateMatrixWorld(true);

  const footfalls: Footfall[] = [];
  const heights: [number[], number[]] = [[], []];
  for (const foot of [0, 1] as const) {
    const h = raw[foot];
    const min = Math.min(...h);
    const rel = h.map((v) => v - min);
    heights[foot] = rel;
    const max = Math.max(...rel);
    if (max < 1e-4) continue;
    const threshold = contactFraction * max;
    // Start tuż po najwyższym punkcie wymachu, żeby cykl nie zaczynał się w środku kontaktu.
    const top = rel.indexOf(max);
    let armed = true;
    for (let n = 1; n <= samples; n++) {
      const i = (top + n) % samples;
      const prev = rel[(i - 1 + samples) % samples];
      const here = rel[i];
      if (!armed && here > threshold * rearm) armed = true;
      if (armed && prev > threshold && here <= threshold) {
        const f = (prev - threshold) / Math.max(1e-9, prev - here);
        const index = (i - 1 + f + samples) % samples;
        footfalls.push({ time: (index / samples) * clip.duration, foot });
        armed = false;
      }
    }
  }
  footfalls.sort((a, b) => a.time - b.time);
  return { footfalls, duration: clip.duration, heights };
}

export type FootfallState = {
  /** Czy kroki wolno teraz generować (stan Walk z pełną wagą i ruch w świecie). */
  active: boolean;
  /** Czas bieżącego klipu (s). */
  time: number;
};

/**
 * Wyzwala zdarzenie przy każdym przejściu animacji Walk przez moment kontaktu stopy. Czas klipu pochodzi z animatora, więc
 * tempo kroków zgadza się z tempem animacji (też przy skalowaniu prędkości). Nie wyzwala przy wejściu w stan, po przerwie ani
 * po skoku czasu (np. crossfade, zawinięcie dłuższe niż pół cyklu).
 */
export class FootfallTracker {
  private prev = -1;
  emitted = 0;

  constructor(
    private readonly analysis: Pick<FootfallAnalysis, "footfalls" | "duration">,
    private readonly onFootfall: (footfall: Footfall) => void,
  ) {}

  get footfalls(): readonly Footfall[] {
    return this.analysis.footfalls;
  }

  reset(): void {
    this.prev = -1;
  }

  update(state: FootfallState): void {
    if (!state.active || this.analysis.duration <= 0) {
      this.prev = -1;
      return;
    }
    const { duration, footfalls } = this.analysis;
    const time = state.time % duration;
    if (this.prev < 0) {
      this.prev = time;
      return;
    }
    let delta = time - this.prev;
    if (delta < 0) delta += duration;
    const from = this.prev;
    this.prev = time;
    if (delta <= 0 || delta > duration * 0.5) return;
    for (let i = 0; i < footfalls.length; i++) {
      let ahead = footfalls[i].time - from;
      if (ahead < 0) ahead += duration;
      if (ahead > 0 && ahead <= delta) {
        this.emitted++;
        this.onFootfall(footfalls[i]);
      }
    }
  }
}
