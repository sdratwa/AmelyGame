import type { House } from "../content/houses";
import type { WorldAnchors } from "./anchors";

/**
 * Trwałe, deterministycznie generowane elementy świata dla pary (seed, wersja generatora).
 * Wyłącznie dane – bez obiektów Three.js i bez stanu, który zmienia się w trakcie gry.
 */
export type WorldBase = {
  genVersion: number;
  seed: number;
  houses: House[];
  /** Kotwice questa i odcisk planu lasu (generator v2 i nowsze). */
  forest?: { anchors: WorldAnchors; planDigest: string };
};
