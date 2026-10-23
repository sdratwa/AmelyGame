/**
 * Podstawowe ustawienia gry (lokalnie w przeglądarce, poza zapisem gry). Wartości są walidowane; uszkodzone lub brakujące
 * dane wracają do domyślnych. Nowe przełączniki dodajemy tutaj (typ, domyślna wartość, normalizacja) i w `GameSettingsDialog`.
 */

import { clampSeekMinutes } from "@/lib/hideseek/config";

export type GameSettings = {
  /** Nazwy graczy nad postaciami w multiplayerze. */
  showPlayerNames: boolean;
  /** Zabawa w chowanego: czas poszukiwań w minutach (1-15). Włączenie zabawy NIE jest ustawieniem trwałym - to akcja na serwerze. */
  hideSeekMinutes: number;
};

export const GAME_SETTINGS_KEY = "miasto.game.settings";

export const DEFAULT_GAME_SETTINGS: GameSettings = { showPlayerNames: true, hideSeekMinutes: 5 };

export function normalizeGameSettings(input: unknown): GameSettings {
  const d = DEFAULT_GAME_SETTINGS;
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    showPlayerNames: typeof o.showPlayerNames === "boolean" ? o.showPlayerNames : d.showPlayerNames,
    hideSeekMinutes: typeof o.hideSeekMinutes === "number" && Number.isFinite(o.hideSeekMinutes) ? clampSeekMinutes(o.hideSeekMinutes) : d.hideSeekMinutes,
  };
}

export function parseGameSettings(raw: string | null | undefined): GameSettings {
  if (!raw) return { ...DEFAULT_GAME_SETTINGS };
  try {
    return normalizeGameSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

export type GameSettingsStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function browserStorage(): GameSettingsStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Magazyn z niezmiennym snapshotem (bezpieczny dla `useSyncExternalStore`). */
export class GameSettingsStore {
  private current: GameSettings = DEFAULT_GAME_SETTINGS;
  private loaded = false;
  private readonly subs = new Set<() => void>();

  constructor(private readonly storage: () => GameSettingsStorage | null = browserStorage) {}

  get(): GameSettings {
    if (!this.loaded) {
      this.loaded = true;
      let raw: string | null = null;
      try {
        raw = this.storage()?.getItem(GAME_SETTINGS_KEY) ?? null;
      } catch {
        raw = null;
      }
      this.current = parseGameSettings(raw);
    }
    return this.current;
  }

  set(patch: Partial<GameSettings>): void {
    this.current = normalizeGameSettings({ ...this.get(), ...patch });
    try {
      this.storage()?.setItem(GAME_SETTINGS_KEY, JSON.stringify(this.current));
    } catch {
      // zapis ustawienia nie jest krytyczny
    }
    for (const cb of this.subs) cb();
  }

  reset(): void {
    this.set({ ...DEFAULT_GAME_SETTINGS });
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }
}

export const gameSettings = new GameSettingsStore();
