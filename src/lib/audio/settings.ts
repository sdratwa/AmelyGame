export type AudioSettings = {
  master: number;
  ambience: number;
  effects: number;
  muted: boolean;
};

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { master: 0.8, ambience: 0.8, effects: 0.8, muted: false };
export const AUDIO_SETTINGS_KEY = "miasto.audio.settings";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const clamp01 = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

export function sanitizeSettings(raw: unknown): AudioSettings {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    master: clamp01(o.master, DEFAULT_AUDIO_SETTINGS.master),
    ambience: clamp01(o.ambience, DEFAULT_AUDIO_SETTINGS.ambience),
    effects: clamp01(o.effects, DEFAULT_AUDIO_SETTINGS.effects),
    muted: typeof o.muted === "boolean" ? o.muted : DEFAULT_AUDIO_SETTINGS.muted,
  };
}

export function loadSettings(storage: StorageLike | null): AudioSettings {
  try {
    const text = storage?.getItem(AUDIO_SETTINGS_KEY);
    return text ? sanitizeSettings(JSON.parse(text)) : { ...DEFAULT_AUDIO_SETTINGS };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveSettings(storage: StorageLike | null, settings: AudioSettings): void {
  try {
    storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // zapamiętanie głośności nie jest krytyczne
  }
}
