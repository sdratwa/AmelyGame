export type DayPhase = "noc" | "świt" | "dzień" | "zmierzch";

/** Granice pór dnia (godziny zegara gry). */
export const PHASES = { dawnStart: 5, dayStart: 8, duskStart: 18, nightStart: 21 } as const;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export function phaseOf(hour: number): DayPhase {
  const h = ((hour % 24) + 24) % 24;
  if (h >= PHASES.nightStart || h < PHASES.dawnStart) return "noc";
  if (h < PHASES.dayStart) return "świt";
  if (h < PHASES.duskStart) return "dzień";
  return "zmierzch";
}

export type AmbientMix = { day: number; night: number; phase: DayPhase };

/**
 * Wagi teł (0-1). Przejścia mają stałą moc (sin/cos), więc crossfade nie robi dziury w głośności,
 * a poza przejściami gra tylko jedno tło: w dzień dzienne, w nocy nocne.
 */
export function ambientMix(hour: number): AmbientMix {
  const h = ((hour % 24) + 24) % 24;
  const phase = phaseOf(h);
  if (phase === "dzień") return { day: 1, night: 0, phase };
  if (phase === "noc") return { day: 0, night: 1, phase };
  if (phase === "świt") {
    const t = smooth((h - PHASES.dawnStart) / (PHASES.dayStart - PHASES.dawnStart));
    return { day: Math.sin((t * Math.PI) / 2), night: Math.cos((t * Math.PI) / 2), phase };
  }
  const t = smooth((h - PHASES.duskStart) / (PHASES.nightStart - PHASES.duskStart));
  return { day: Math.cos((t * Math.PI) / 2), night: Math.sin((t * Math.PI) / 2), phase };
}

/** Punkty (godzina, aktywność) pojedynczych nawoływań; między punktami interpolacja liniowa. */
const ACTIVITY: readonly (readonly [number, number])[] = [
  [0, 0],
  [5, 0],
  [5.5, 0.5],
  [7, 1.7],
  [8.5, 1.5],
  [11, 1],
  [16.5, 1],
  [18, 0.7],
  [19.5, 0.35],
  [21, 0],
  [24, 0],
];

/**
 * Mnożnik częstości dziennych nawoływań: 0 w nocy (żadnych dziennych ptaków), rośnie o świcie (szczyt rano),
 * 1 w ciągu dnia, a wieczorem spada do zera przy 21:00.
 */
export function birdActivity(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < ACTIVITY.length; i++) {
    const [h1, a1] = ACTIVITY[i];
    if (h <= h1) {
      const [h0, a0] = ACTIVITY[i - 1];
      const v = a0 + ((a1 - a0) * (h - h0)) / (h1 - h0);
      return v < 1e-9 ? 0 : v;
    }
  }
  return 0;
}

/** Skala głośności pojedynczych ptaków: rano głośniej, wieczorem ciszej. */
export function birdLoudness(hour: number): number {
  return 0.7 + 0.3 * Math.min(1, birdActivity(hour));
}
