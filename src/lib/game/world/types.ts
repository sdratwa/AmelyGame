import type { House } from "../content/houses";

/**
 * Trwałe, deterministycznie generowane elementy świata dla pary (seed, wersja generatora).
 * Wyłącznie dane – bez obiektów Three.js i bez stanu, który zmienia się w trakcie gry.
 */
export type WorldBase = {
  genVersion: number;
  seed: number;
  houses: House[];
};
