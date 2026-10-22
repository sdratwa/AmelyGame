/**
 * Ustawienia kontrolera zapisywane lokalnie (poza zapisem gry `SaveV4`). Wartości są walidowane i ograniczane do
 * dozwolonych zakresów; uszkodzone dane wracają do wartości domyślnych.
 */

export type ControllerSettings = {
  /** Mnożnik czułości obrotu kamery (poziomo / pionowo). */
  cameraSensitivityX: number;
  cameraSensitivityY: number;
  leftDeadzone: number;
  rightDeadzone: number;
  invertY: boolean;
  vibration: boolean;
};

export const SETTINGS_KEY = "miasto.input.gamepad";

export const DEFAULT_CONTROLLER_SETTINGS: ControllerSettings = {
  cameraSensitivityX: 1,
  cameraSensitivityY: 1,
  leftDeadzone: 0.15,
  rightDeadzone: 0.15,
  invertY: false,
  vibration: true,
};

export const SETTING_LIMITS = {
  sensitivity: { min: 0.25, max: 3, step: 0.25 },
  deadzone: { min: 0.05, max: 0.4, step: 0.05 },
} as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

/** Zaokrągla do kroku bez błędów zmiennoprzecinkowych (np. 0.15000000000000002). */
export function roundTo(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 1000) / 1000;
}

export function normalizeSettings(input: unknown): ControllerSettings {
  const d = DEFAULT_CONTROLLER_SETTINGS;
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const s = SETTING_LIMITS.sensitivity;
  const z = SETTING_LIMITS.deadzone;
  return {
    cameraSensitivityX: num(o.cameraSensitivityX, d.cameraSensitivityX, s.min, s.max),
    cameraSensitivityY: num(o.cameraSensitivityY, d.cameraSensitivityY, s.min, s.max),
    leftDeadzone: num(o.leftDeadzone, d.leftDeadzone, z.min, z.max),
    rightDeadzone: num(o.rightDeadzone, d.rightDeadzone, z.min, z.max),
    invertY: typeof o.invertY === "boolean" ? o.invertY : d.invertY,
    vibration: typeof o.vibration === "boolean" ? o.vibration : d.vibration,
  };
}

export function parseSettings(raw: string | null | undefined): ControllerSettings {
  if (!raw) return { ...DEFAULT_CONTROLLER_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONTROLLER_SETTINGS };
  }
}

export type SettingsStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function browserStorage(): SettingsStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Magazyn ustawień z niezmiennym snapshotem (bezpieczny dla `useSyncExternalStore`). */
export class ControllerSettingsStore {
  private current: ControllerSettings = DEFAULT_CONTROLLER_SETTINGS;
  private loaded = false;
  private readonly subs = new Set<() => void>();

  constructor(private readonly storage: () => SettingsStorage | null = browserStorage) {}

  get(): ControllerSettings {
    if (!this.loaded) {
      this.loaded = true;
      let raw: string | null = null;
      try {
        raw = this.storage()?.getItem(SETTINGS_KEY) ?? null;
      } catch {
        raw = null;
      }
      this.current = parseSettings(raw);
    }
    return this.current;
  }

  set(patch: Partial<ControllerSettings>): void {
    this.current = normalizeSettings({ ...this.get(), ...patch });
    try {
      this.storage()?.setItem(SETTINGS_KEY, JSON.stringify(this.current));
    } catch {
      // zapis ustawień nie jest krytyczny
    }
    for (const cb of this.subs) cb();
  }

  reset(): void {
    this.set({ ...DEFAULT_CONTROLLER_SETTINGS });
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }
}

export const controllerSettings = new ControllerSettingsStore();
