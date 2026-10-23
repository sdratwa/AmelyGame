import { DEFAULT_LANTERN_CONFIG, sanitizeLanternConfig, type LanternConfig } from "./config";

/** Klucz lokalnego zapisu domyślnych ustawień lampy (tylko strojenie wyglądu na tej maszynie; nigdy część zapisu gry). */
export const LANTERN_CONFIG_STORAGE_KEY = "miasto.lantern.config.v1";

export type ConfigStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type Listener = () => void;

/**
 * Bieżąca konfiguracja wizualna lampy (lokalna dla przeglądarki). Renderer czyta `current` co klatkę (bez alokacji),
 * panel Diagnostyka zmienia ją na żywo. Nie ma żadnego wpływu na stan gry ani na to, co widzą inni gracze:
 * serwer i protokół znają tylko flagę włączona/wyłączona.
 */
export class LanternConfigStore {
  private cur: LanternConfig;
  private savedCfg: LanternConfig | null;
  private listeners = new Set<Listener>();
  private rev = 0;

  constructor(private readonly storage: ConfigStorage | null = null) {
    this.savedCfg = this.readSaved();
    this.cur = this.savedCfg ?? sanitizeLanternConfig(DEFAULT_LANTERN_CONFIG);
  }

  get current(): LanternConfig {
    return this.cur;
  }
  get saved(): LanternConfig | null {
    return this.savedCfg;
  }
  /** Rośnie przy każdej zmianie (do `useSyncExternalStore`). */
  get revision(): number {
    return this.rev;
  }

  set(patch: Partial<LanternConfig>): void {
    this.cur = sanitizeLanternConfig({ ...this.cur, ...patch }, this.cur);
    this.emit();
  }

  /** Przywraca ustawienia fabryczne (nie rusza zapisanych jako domyślne). */
  reset(): void {
    this.cur = sanitizeLanternConfig(DEFAULT_LANTERN_CONFIG);
    this.emit();
  }

  /** Zapisuje bieżące ustawienia lokalnie jako domyślne dla tej przeglądarki. */
  setAsDefault(): boolean {
    this.savedCfg = this.cur;
    let ok = true;
    try {
      this.storage?.setItem(LANTERN_CONFIG_STORAGE_KEY, JSON.stringify({ version: 1, config: this.cur }));
    } catch {
      ok = false;
    }
    this.emit();
    return ok && this.storage !== null;
  }

  /** Wraca do ostatnio zapisanych jako domyślne (albo fabrycznych, gdy nic nie zapisano). */
  restoreSaved(): void {
    this.cur = this.savedCfg ?? sanitizeLanternConfig(DEFAULT_LANTERN_CONFIG);
    this.emit();
  }

  /** Tekst JSON do skopiowania do schowka i wklejenia do kodu jako nowe wartości domyślne. */
  toJson(): string {
    return JSON.stringify({ version: 1, config: this.cur }, null, 2);
  }

  /** Wczytuje JSON w formacie `toJson` (także sam obiekt konfiguracji); zwraca `false` dla uszkodzonego tekstu. */
  fromJson(text: string): boolean {
    const parsed = parseConfigJson(text);
    if (!parsed) return false;
    this.cur = parsed;
    this.emit();
    return true;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    this.rev++;
    for (const fn of [...this.listeners]) fn();
  }

  private readSaved(): LanternConfig | null {
    try {
      const raw = this.storage?.getItem(LANTERN_CONFIG_STORAGE_KEY);
      return raw ? parseConfigJson(raw) : null;
    } catch {
      return null;
    }
  }
}

export function parseConfigJson(text: string): LanternConfig | null {
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const rec = data as Record<string, unknown>;
    const body = typeof rec.config === "object" && rec.config !== null ? rec.config : rec;
    return sanitizeLanternConfig(body);
  } catch {
    return null;
  }
}

let shared: LanternConfigStore | null = null;

/** Współdzielony magazyn przeglądarki (localStorage, jeśli dostępny). W testach twórz `new LanternConfigStore(...)` samodzielnie. */
export function lanternConfigStore(): LanternConfigStore {
  if (!shared) {
    let storage: ConfigStorage | null = null;
    try {
      storage = typeof window !== "undefined" ? window.localStorage : null;
    } catch {
      storage = null;
    }
    shared = new LanternConfigStore(storage);
  }
  return shared;
}
