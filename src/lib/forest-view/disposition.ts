/**
 * Wygląd modeli w prototypie: decyzje czysto wizualne (nie zmieniają świata, kolizji ani ID).
 * Domyślnie las ma zielone, naturalne odmiany; kolory fantastyczne zostają na przyszłe strefy magiczne.
 */
export type ModelLook = {
  /** `hide`: nie rysujemy (odmiana magiczna). `show`: bez zmian. */
  mode: "show" | "hide";
  note?: string;
};

export const MODEL_LOOK: Readonly<Record<string, ModelLook>> = {
  "plant.7": { mode: "hide", note: "fioletowe liście: odmiana magiczna" },
  "plant.7_big": { mode: "hide", note: "fioletowe liście: odmiana magiczna" },
};

export function lookOf(modelId: string): ModelLook {
  return MODEL_LOOK[modelId] ?? { mode: "show" };
}

/** Materiały, których tekstura jest czerwona (liście starych drzew i krzewu): w prototypie zamieniamy kanały R i G na zielony. */
export const HUE_SWAP_TO_GREEN: ReadonlySet<string> = new Set(["leaves_twistedtree"]);

export type FoliageWind = {
  /** Wysokość (m, w skali modelu), od której wiatr działa w pełni. */
  height: number;
  /** Amplituda wychylenia (m) na tej wysokości. */
  amplitude: number;
  /** Do jakiej wysokości (m) korzenie są przyciemniane (wtopienie w grunt); 0 = bez. */
  rootShade: number;
};

/** Parametry wiatru i przyciemnienia nasady dla materiałów liści; kora, skały i grzyby nie są ruszane. */
export const FOLIAGE: Readonly<Record<string, FoliageWind>> = {
  grass: { height: 0.8, amplitude: 0.07, rootShade: 0.4 },
  leaves: { height: 0.9, amplitude: 0.05, rootShade: 0.3 },
  flowers: { height: 0.9, amplitude: 0.05, rootShade: 0.0 },
  leaves_normaltree: { height: 9, amplitude: 0.12, rootShade: 0 },
  leaves_pine: { height: 9, amplitude: 0.07, rootShade: 0 },
  leaves_twistedtree: { height: 12, amplitude: 0.1, rootShade: 0 },
};
