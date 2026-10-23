/**
 * Stan zwinięcia/rozwinięcia sekcji panelu Diagnostyka (dev) i okienka "Sterowanie". To wyłącznie ustawienie
 * interfejsu zapamiętywane lokalnie w przeglądarce: nie należy do stanu gry ani do zapisu i nie idzie przez sieć.
 */

export const DIAG_SECTIONS_KEY = "miasto.diag.sections.v1";

/** Wszystkie sekcje panelu (kolejność = kolejność na ekranie) wraz z ustawieniem domyślnym. */
export const DIAG_SECTIONS = [
  { id: "perf", title: "Wydajność i świat", defaultOpen: true },
  { id: "movement", title: "Ruch i podparcie (dev)", defaultOpen: false },
  { id: "lantern", title: "Lampa naftowa (dev)", defaultOpen: true },
  { id: "npc", title: "NPC troll", defaultOpen: false },
  { id: "bridge", title: "Most", defaultOpen: false },
  { id: "deer", title: "Jeleń", defaultOpen: false },
  { id: "appearance", title: "Wygląd (dev)", defaultOpen: false },
  { id: "audio", title: "Audio", defaultOpen: false },
] as const;

export type DiagSectionId = (typeof DIAG_SECTIONS)[number]["id"];

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export class DiagSectionsStore {
  private overrides: Record<string, boolean> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Zwiększa się przy każdej zmianie (migawka dla `useSyncExternalStore`). */
  revision = 0;

  constructor(
    private readonly storage: StorageLike | null = defaultStorage(),
    private readonly key = DIAG_SECTIONS_KEY,
  ) {}

  private load(): Record<string, boolean> {
    if (this.overrides) return this.overrides;
    const out: Record<string, boolean> = {};
    try {
      const raw = this.storage?.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [id, v] of Object.entries(parsed)) if (typeof v === "boolean") out[id] = v;
      }
    } catch {
      // uszkodzony wpis: wracamy do ustawień domyślnych
    }
    this.overrides = out;
    return out;
  }

  private commit(): void {
    this.revision += 1;
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.overrides ?? {}));
    } catch {
      // brak miejsca/zablokowany zapis: ustawienie działa do końca sesji
    }
    for (const l of this.listeners) l();
  }

  isOpen(id: string, defaultOpen: boolean): boolean {
    return this.load()[id] ?? defaultOpen;
  }

  set(id: string, open: boolean): void {
    this.load()[id] = open;
    this.commit();
  }

  toggle(id: string, defaultOpen: boolean): void {
    this.set(id, !this.isOpen(id, defaultOpen));
  }

  /** Zwija lub rozwija wszystkie znane sekcje naraz. */
  setAll(open: boolean): void {
    const o = this.load();
    for (const s of DIAG_SECTIONS) o[s.id] = open;
    this.commit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

let singleton: DiagSectionsStore | null = null;
export function diagSectionsStore(): DiagSectionsStore {
  singleton ??= new DiagSectionsStore();
  return singleton;
}
