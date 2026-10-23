/** Ustawienia sterowania dotykowego (lokalnie, poza zapisem gry). Wartości są walidowane i ograniczane do zakresu. */

export type TouchSettings = {
  /** Mnożnik czułości kamery (przeciągnięcie palcem). */
  lookSensitivity: number;
};

export const TOUCH_SETTINGS_KEY = "miasto.input.touch";
export const TOUCH_SETTING_LIMITS = { lookSensitivity: { min: 0.5, max: 2.5, step: 0.1 } } as const;
export const DEFAULT_TOUCH_SETTINGS: TouchSettings = { lookSensitivity: 1 };

export function normalizeTouchSettings(input: unknown): TouchSettings {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const l = TOUCH_SETTING_LIMITS.lookSensitivity;
  const v = o.lookSensitivity;
  const value = typeof v === "number" && Number.isFinite(v) ? Math.min(l.max, Math.max(l.min, v)) : DEFAULT_TOUCH_SETTINGS.lookSensitivity;
  return { lookSensitivity: Math.round(value * 100) / 100 };
}

export function parseTouchSettings(raw: string | null | undefined): TouchSettings {
  if (!raw) return { ...DEFAULT_TOUCH_SETTINGS };
  try {
    return normalizeTouchSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TOUCH_SETTINGS };
  }
}

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function browserStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Magazyn z niezmiennym snapshotem (bezpieczny dla `useSyncExternalStore`). */
export class TouchSettingsStore {
  private current: TouchSettings = DEFAULT_TOUCH_SETTINGS;
  private loaded = false;
  private readonly subs = new Set<() => void>();

  constructor(private readonly storage: () => Storage | null = browserStorage) {}

  get(): TouchSettings {
    if (!this.loaded) {
      this.loaded = true;
      let raw: string | null = null;
      try {
        raw = this.storage()?.getItem(TOUCH_SETTINGS_KEY) ?? null;
      } catch {
        raw = null;
      }
      this.current = parseTouchSettings(raw);
    }
    return this.current;
  }

  set(patch: Partial<TouchSettings>): void {
    this.current = normalizeTouchSettings({ ...this.get(), ...patch });
    try {
      this.storage()?.setItem(TOUCH_SETTINGS_KEY, JSON.stringify(this.current));
    } catch {
      // zapis ustawienia nie jest krytyczny
    }
    for (const cb of this.subs) cb();
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }
}

export const touchSettings = new TouchSettingsStore();
