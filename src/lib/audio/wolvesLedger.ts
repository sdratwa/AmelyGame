import type { StorageLike } from "./settings";

export const WOLVES_KEY = "miasto.audio.wolves";
const MAX_SAVES = 8;

type Record_ = { [saveId: string]: number };

/**
 * Trwała pamięć ostatniej północy, o której odtworzono wilki, osobno dla każdego zapisu gry (`saveId`).
 * Leży poza zapisem gry (dane zapisu zostają nietknięte) celowo: wpis powstaje w chwili odtworzenia, więc ponowne wczytanie starszego autozapisu tej samej nocy
 * nie powtórzy wilków, a dane zapisu gry zostają nietknięte.
 */
export class WolvesLedger {
  constructor(private readonly storage: StorageLike | null) {}

  private read(): Record_ {
    try {
      const text = this.storage?.getItem(WOLVES_KEY);
      const parsed = text ? JSON.parse(text) : {};
      if (typeof parsed !== "object" || parsed === null) return {};
      const out: Record_ = {};
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      return out;
    } catch {
      return {};
    }
  }

  last(saveId: string): number | null {
    const v = this.read()[saveId];
    return v === undefined ? null : v;
  }

  /** Czy wilki dla tej północy już były (albo była późniejsza). */
  played(saveId: string, midnight: number): boolean {
    const last = this.last(saveId);
    return last !== null && last >= midnight;
  }

  record(saveId: string, midnight: number): void {
    const all = this.read();
    const previous = all[saveId];
    delete all[saveId];
    all[saveId] = Math.max(midnight, previous ?? midnight);
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SAVES))) delete all[k];
    try {
      this.storage?.setItem(WOLVES_KEY, JSON.stringify(all));
    } catch {
      // brak zapisu oznacza tylko możliwość powtórki po przeładowaniu, nie błąd gry
    }
  }
}
