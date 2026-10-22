import type { TppConfig } from "./config";

/** Klipy animacji ruchu (nazwy dokładnie jak w pliku GLB). Skok jest osobnym stanem jednorazowym. */
export const LOCOMOTION_CLIPS = ["idle", "walk", "run", "crouch_idle", "crouch_walk_forward", "crouch_walk_back", "crouch_sneak_left", "crouch_sneak_right"] as const;
export type LocomotionClip = (typeof LOCOMOTION_CLIPS)[number];
export type LocomotionWeights = Record<LocomotionClip, number>;

/** Dane o postaci potrzebne do wyboru animacji; wypełnia je `PlayerController`. */
export type AnimIntent = {
  crouching: boolean;
  /** W powietrzu (skok albo spadanie): klipy ruchu wygaszone, gra skok. */
  airborne: boolean;
  /** Prędkość pozioma (m/s). */
  speed: number;
  /** Prędkość w układzie ciała: do przodu i w prawo (m/s). */
  forward: number;
  right: number;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export const emptyWeights = (): LocomotionWeights => ({
  idle: 0,
  walk: 0,
  run: 0,
  crouch_idle: 0,
  crouch_walk_forward: 0,
  crouch_walk_back: 0,
  crouch_sneak_left: 0,
  crouch_sneak_right: 0,
});

/** Docelowe wagi klipów ruchu (suma = 1 na ziemi, 0 w powietrzu). Wygładzanie w czasie robi animator (crossfade). */
export function targetWeights(a: AnimIntent, c: Pick<TppConfig, "walkSpeed" | "runSpeed">, out: LocomotionWeights = emptyWeights()): LocomotionWeights {
  for (const k of LOCOMOTION_CLIPS) out[k] = 0;
  if (a.airborne) return out;
  const s = a.speed;
  if (!a.crouching) {
    // idle -> walk dla małych prędkości, walk -> run między prędkością chodu i biegu.
    const present = clamp01((s - 0.1) / Math.max(0.1, 0.5 * c.walkSpeed - 0.1));
    const run = clamp01((s - c.walkSpeed) / Math.max(0.1, c.runSpeed - c.walkSpeed));
    out.idle = 1 - present;
    out.walk = present * (1 - run);
    out.run = present * run;
    return out;
  }
  const present = clamp01((s - 0.1) / 0.3);
  out.crouch_idle = 1 - present;
  if (present <= 0) return out;
  // Kierunek w układzie ciała rozkłada się na dwa sąsiednie klipy (ukos = mieszanie dwóch, nie wybór najbliższego).
  const fw = Math.max(a.forward, 0);
  const bk = Math.max(-a.forward, 0);
  const rt = Math.max(a.right, 0);
  const lf = Math.max(-a.right, 0);
  const sum = fw + bk + rt + lf;
  if (sum < 1e-6) {
    out.crouch_idle = 1;
    return out;
  }
  out.crouch_walk_forward = (fw / sum) * present;
  out.crouch_walk_back = (bk / sum) * present;
  out.crouch_sneak_right = (rt / sum) * present;
  out.crouch_sneak_left = (lf / sum) * present;
  return out;
}

/**
 * Udział lustrzanej kopii klipu `crouch_walk_forward` / `crouch_walk_back` przy ruchu w lewo (0-1). Klipy chodu w kuckach
 * mają skręcony korpus (miednica ok. -46° i -57°), więc nie są symetryczne: ukosy w prawo mieszają je ze skradaniem w prawo
 * (tak jak w pliku), a ukosy w lewo muszą używać ich odbicia, inaczej miednica i płaszczyzna ruchu nóg są przeciwne do
 * klipu skradania w lewo i ruchy stóp się znoszą. `left` i `base` to wagi klipów `crouch_sneak_left` i klipu bazowego.
 * Zero bez składowej w lewo (czysty przód lub tył gra oryginał), pełne odbicie od ukosu 45°.
 */
export function mirrorShare(left: number, base: number): number {
  const total = left + base;
  return total < 1e-6 ? 0 : Math.min(1, (2 * left) / total);
}

/** Tempo klipu (mnożnik czasu) dopasowane do prędkości w świecie, w granicach z konfiguracji. */
export function clipTimeScale(speed: number, nominal: number, c: Pick<TppConfig, "animMinTimeScale" | "animMaxTimeScale">): number {
  if (nominal <= 0) return 1;
  return Math.max(c.animMinTimeScale, Math.min(c.animMaxTimeScale, speed / nominal));
}
