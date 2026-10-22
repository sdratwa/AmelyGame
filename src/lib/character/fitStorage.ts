import { cloneFit, sanitizeFit, type PartFit } from "./fit";
import { findItem } from "./registry";

/**
 * Własne dopasowania elementów zapisane przez autora w narzędziu deweloperskim (`/dev/character-creator`), osobno dla
 * każdego elementu rejestru. To nie jest zapis gry (save nie zmienia schematu): trzymamy je w `localStorage` przeglądarki
 * autora, a na stałe trafiają do pola `fit` w rejestrze (przycisk "Kopiuj JSON").
 */
export const FIT_STORAGE_KEY = "miasto.character.fits";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type FitOverrides = Record<string, PartFit>;

const storage = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Tylko znane elementy rejestru; wartości przycinane do rozsądnych zakresów. Śmieci są odrzucane. */
export function sanitizeFitOverrides(raw: unknown): FitOverrides {
  const out: FitOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!findItem(id)) continue;
    out[id] = sanitizeFit(value);
  }
  return out;
}

export function loadFitOverrides(store: Store | null = storage()): FitOverrides {
  if (!store) return {};
  try {
    const text = store.getItem(FIT_STORAGE_KEY);
    return text ? sanitizeFitOverrides(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

/** Zapisuje dopasowanie jednego elementu (pozostałe zostają). Zwraca true, gdy się udało. */
export function saveFitOverride(id: string, fit: PartFit, store: Store | null = storage()): boolean {
  if (!store || !findItem(id)) return false;
  try {
    const all = loadFitOverrides(store);
    all[id] = cloneFit(sanitizeFit(fit));
    store.setItem(FIT_STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function clearFitOverride(id: string, store: Store | null = storage()): boolean {
  if (!store) return false;
  try {
    const all = loadFitOverrides(store);
    delete all[id];
    if (Object.keys(all).length === 0) store.removeItem(FIT_STORAGE_KEY);
    else store.setItem(FIT_STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** Zapisane dopasowania tylko poza produkcją (w buildzie produkcyjnym gra używa wyłącznie wartości z rejestru). */
export const devFitOverrides = (): FitOverrides => (process.env.NODE_ENV === "production" ? {} : loadFitOverrides());
