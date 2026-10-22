/**
 * Wymiary głowy bazowej siatki w przestrzeni modelu (wysokość postaci = 1, +Y góra, +Z przód): środek i półosie.
 * Fryzury są budowane względem tych wartości, więc dopasowują się do głowy mierzonej w pliku.
 */
export type HeadMetrics = {
  center: readonly [number, number, number];
  /** Półosie (x: szerokość, y: wysokość, z: głębokość). */
  radii: readonly [number, number, number];
};

/** Pomiar z pliku `Miasto_Dziewczynka_9_animacji_beta.glb` (wierzchołki o wadze `Head` >= 0,5): łysa głowa, Y 0,792..1,000. */
export const DEFAULT_HEAD_METRICS: HeadMetrics = {
  center: [0, 0.896, 0],
  radii: [0.1035, 0.104, 0.101],
};

/** Mierzy głowę z pozycji wierzchołków i ich wag kości głowy (tablice płaskie xyz). `headWeight[i]` w 0..1. */
export function measureHead(positions: ArrayLike<number>, headWeight: ArrayLike<number>, minWeight = 0.5): HeadMetrics | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (let i = 0; i < headWeight.length; i++) {
    if (headWeight[i] < minWeight) continue;
    n++;
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (n < 16) return null;
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2) as [number, number, number];
  const radii = [0, 1, 2].map((k) => (max[k] - min[k]) / 2) as [number, number, number];
  if (!center.every(Number.isFinite) || radii.some((r) => !(r > 0.01))) return null;
  return { center, radii };
}
