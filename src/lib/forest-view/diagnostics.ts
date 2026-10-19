import type { PanelStats } from "./renderer";

export type NearestCreature = { name: "troll" | "jeleń"; distance: number } | null;

/** Najbliższy troll lub jeleń względem gracza (do panelu diagnostycznego); null, gdy żaden model nie jest wczytany. */
export function nearestCreature(stats: Pick<PanelStats, "npc" | "deer">): NearestCreature {
  const candidates: NonNullable<NearestCreature>[] = [];
  if (stats.npc && Number.isFinite(stats.npc.distance)) candidates.push({ name: "troll", distance: stats.npc.distance });
  if (stats.deer && Number.isFinite(stats.deer.distance)) candidates.push({ name: "jeleń", distance: stats.deer.distance });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.distance < best.distance ? c : best));
}
