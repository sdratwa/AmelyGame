import type { WorldObject } from "./objects";

export type HarvestSize = "s" | "m" | "l";
export type HarvestKind = "tree" | "rock";

/** Zasoby z drzew i skał: małe / średnie / duże = 1 / 2 / 5 (spec questa). */
export const HARVEST_AMOUNT: Readonly<Record<HarvestSize, number>> = { s: 1, m: 2, l: 5 };

export type Harvestable = { kind: HarvestKind; size: HarvestSize; amount: number };

const TREE_MEDIUM_FROM = 0.95;
const TREE_LARGE_FROM = 1.2;

/**
 * Czy obiekt świata można pozyskać i ile da. Drzewa: stare (skręcone) zawsze duże, pozostałe wg skali;
 * skały: klasa rozmiaru z generatora (`size_s|m|l`). Reszta roślinności jest wyłącznie dekoracją.
 */
export function harvestOf(o: Pick<WorldObject, "kind" | "variant" | "scale" | "tags">): Harvestable | null {
  if (o.kind === "tree") {
    const size: HarvestSize =
      o.variant?.startsWith("twisted") || (o.scale ?? 1) >= TREE_LARGE_FROM
        ? "l"
        : (o.scale ?? 1) >= TREE_MEDIUM_FROM
          ? "m"
          : "s";
    return { kind: "tree", size, amount: HARVEST_AMOUNT[size] };
  }
  if (o.kind === "rock") {
    const tag = o.tags?.find((t) => t.startsWith("size_"));
    const size = tag?.slice(5);
    if (size !== "s" && size !== "m" && size !== "l") return null;
    return { kind: "rock", size, amount: HARVEST_AMOUNT[size] };
  }
  return null;
}
