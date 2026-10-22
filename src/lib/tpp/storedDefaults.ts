import { mergeTppConfig, TPP_DEFAULTS, type TppConfig } from "./config";

/** Klucz w `localStorage` z własnymi wartościami domyślnymi TPP (tylko narzędzie deweloperskie `/dev/third-person`). */
export const TPP_STORAGE_KEY = "miasto.tpp.defaults";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const storage = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Tylko znane pola liczbowe; reszta jest odrzucana. Zwraca różnice względem `TPP_DEFAULTS`. */
export function sanitizeTppOverrides(raw: unknown): Partial<TppConfig> {
  if (!raw || typeof raw !== "object") return {};
  const merged = mergeTppConfig({ ...TPP_DEFAULTS }, raw as Partial<TppConfig>);
  const out: Partial<TppConfig> = {};
  for (const key of Object.keys(TPP_DEFAULTS) as (keyof TppConfig)[]) {
    if (merged[key] !== TPP_DEFAULTS[key]) out[key] = merged[key];
  }
  return out;
}

/** Zapisane przez autora wartości domyślne (puste, gdy brak, uszkodzone albo brak dostępu do pamięci przeglądarki). */
export function loadTppOverrides(store: Store | null = storage()): Partial<TppConfig> {
  if (!store) return {};
  try {
    const text = store.getItem(TPP_STORAGE_KEY);
    return text ? sanitizeTppOverrides(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

/**
 * Jedno źródło konfiguracji TPP dla gry i dla `/dev/third-person`: `TPP_DEFAULTS` plus własne wartości zapisane przez
 * autora w panelu ("Ustaw jako domyślne"). Zwraca tylko różnice od `TPP_DEFAULTS`, bo reszta pochodzi z kodu.
 */
export function resolveTppConfig(store: Store | null = storage()): Partial<TppConfig> {
  return loadTppOverrides(store);
}

/** Zapisuje aktualne wartości jako własne domyślne (tylko różnice od `TPP_DEFAULTS`). Zwraca true, gdy się udało. */
export function saveTppOverrides(values: TppConfig, store: Store | null = storage()): boolean {
  if (!store) return false;
  try {
    const diff = sanitizeTppOverrides(values);
    if (Object.keys(diff).length === 0) store.removeItem(TPP_STORAGE_KEY);
    else store.setItem(TPP_STORAGE_KEY, JSON.stringify(diff));
    return true;
  } catch {
    return false;
  }
}

export function clearTppOverrides(store: Store | null = storage()): void {
  try {
    store?.removeItem(TPP_STORAGE_KEY);
  } catch {
    // brak dostępu do pamięci: nic do wyczyszczenia
  }
}
