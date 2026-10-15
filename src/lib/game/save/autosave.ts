import type { GameState } from "../core/state";
import { canonicalize } from "../world/fingerprint";
import { serializeState } from "./serialize";
import type { SaveV1 } from "./schema";
import type { SaveOutcome, SaveStore } from "./store";

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type AutosaverOptions = {
  store: SaveStore;
  /** Zegar ścienny dla pola savedAt. */
  now: () => number;
  debounceMs?: number;
  intervalMs?: number;
  timers?: Timers;
  onResult?: (outcome: SaveOutcome) => void;
  /** Zapis, z którego wystartowała sesja – nie zapisujemy go ponownie bez zmian. */
  initial?: SaveV1;
};

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Klucz „istotnych” zmian – wszystko poza ciągle zmieniającymi się wartościami
 * (czas, życie, pozycja w lesie). Zmiana istotna zapisuje się szybko (debounce),
 * zmiana ciągła – najwyżej raz na interwał.
 */
function importantKey(state: GameState): string {
  return canonicalize([
    state.world?.saveId,
    state.name,
    state.wallet,
    state.slots,
    state.selected,
    state.houses,
    state.deaths,
    state.dead,
    state.tutorialDone,
  ]);
}

function contentKey(state: GameState): string | null {
  const save = serializeState(state, 0);
  return save ? canonicalize(save) : null;
}

export class Autosaver {
  private readonly store: SaveStore;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly intervalMs: number;
  private readonly timers: Timers;
  private readonly onResult?: (outcome: SaveOutcome) => void;

  private latest: GameState | null = null;
  private lastImportant: string | null = null;
  private lastSavedContent: string | null = null;
  private debounceHandle: unknown = null;
  private intervalHandle: unknown = null;
  private writing = false;
  private rerun = false;
  private disposed = false;

  constructor(options: AutosaverOptions) {
    this.store = options.store;
    this.now = options.now;
    this.debounceMs = options.debounceMs ?? 300;
    this.intervalMs = options.intervalMs ?? 5000;
    this.timers = options.timers ?? defaultTimers;
    this.onResult = options.onResult;
    if (options.initial) {
      this.lastSavedContent = canonicalize({ ...options.initial, savedAt: 0 });
    }
  }

  /** Wywoływane po każdej zmianie stanu gry (także po ticku zegara). */
  update(state: GameState): void {
    if (this.disposed) return;
    this.latest = state;
    if (state.phase !== "playing" || !state.world) return;
    const key = importantKey(state);
    const important = this.lastImportant !== null && key !== this.lastImportant;
    const first = this.lastImportant === null;
    this.lastImportant = key;
    if (first || important) {
      if (this.debounceHandle !== null) this.timers.clearTimeout(this.debounceHandle);
      this.debounceHandle = this.timers.setTimeout(() => {
        this.debounceHandle = null;
        this.flush();
      }, this.debounceMs);
    } else if (this.intervalHandle === null) {
      this.intervalHandle = this.timers.setTimeout(() => {
        this.intervalHandle = null;
        this.flush();
      }, this.intervalMs);
    }
  }

  /** Zapis natychmiastowy (np. przy zamykaniu karty). Pomija zapis, gdy nic się nie zmieniło. */
  flush(): void {
    if (!this.latest || this.disposed) return;
    this.clearTimers();
    if (this.writing) {
      this.rerun = true;
      return;
    }
    const content = contentKey(this.latest);
    if (content === null || content === this.lastSavedContent) return;
    const save = serializeState(this.latest, this.now());
    if (!save) return;
    this.writing = true;
    void this.store
      .save(save)
      .then((outcome) => {
        if (outcome.ok) this.lastSavedContent = content;
        this.onResult?.(outcome);
      })
      .catch((e: unknown) => {
        this.onResult?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        this.writing = false;
        if (this.rerun) {
          this.rerun = false;
          this.flush();
        }
      });
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.debounceHandle !== null) this.timers.clearTimeout(this.debounceHandle);
    if (this.intervalHandle !== null) this.timers.clearTimeout(this.intervalHandle);
    this.debounceHandle = null;
    this.intervalHandle = null;
  }
}
