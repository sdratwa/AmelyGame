/**
 * Wykrywanie trybu dotykowego (telefon). Łączy możliwości urządzenia (wskaźnik dotykowy bez hover, punkty dotyku)
 * z rozmiarem ekranu, a nie tylko szerokością okna: laptop z wąskim oknem nie dostaje sterowania dotykowego.
 * Funkcje są czyste (bez DOM), więc testuje się je w Vitest.
 */

/** Telefon: krótszy bok okna nie większy niż ta wartość (px). Tablety i iPad są poza pierwszą wersją. */
export const TOUCH_UI_MAX_MIN_DIM = 600;

export type TouchOverride = "on" | "off" | null;

export type TouchEnv = {
  /** `matchMedia("(pointer: coarse)")`. */
  coarsePointer: boolean;
  /** `matchMedia("(hover: none)")`. */
  hoverNone: boolean;
  /** `navigator.maxTouchPoints`. */
  maxTouchPoints: number;
  /** Krótszy bok okna (`min(innerWidth, innerHeight)`). */
  minDim: number;
  override: TouchOverride;
};

export function isTouchUi(env: TouchEnv): boolean {
  if (env.override === "on") return true;
  if (env.override === "off") return false;
  return env.coarsePointer && env.hoverNone && env.maxTouchPoints > 0 && env.minDim <= TOUCH_UI_MAX_MIN_DIM;
}

function parseFlag(value: string | null | undefined): TouchOverride {
  if (value === "1" || value === "on" || value === "true") return "on";
  if (value === "0" || value === "off" || value === "false") return "off";
  return null;
}

/** Ręczne wymuszenie trybu: parametr `?touch=1|0` ma pierwszeństwo przed zapisem w `localStorage` (`miasto.touchUi`). */
export function parseTouchOverride(search: string | null | undefined, stored: string | null | undefined): TouchOverride {
  let fromQuery: string | null = null;
  try {
    fromQuery = new URLSearchParams(search ?? "").get("touch");
  } catch {
    fromQuery = null;
  }
  return parseFlag(fromQuery) ?? parseFlag(stored);
}

export const TOUCH_UI_STORAGE_KEY = "miasto.touchUi";
