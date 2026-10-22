import { decodeSave, encodeSave } from "./codec";
import { DEFAULT_SCHEMA, migratePayload, type SchemaConfig } from "./migrate";
import type { SaveV4 } from "./schema";

/** Minimalny podzbiór `Storage` (localStorage) – pozwala podmienić magazyn w testach. */
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadResult =
  | { kind: "none" }
  | {
      kind: "ok";
      save: SaveV4;
      source: "primary" | "backup";
      /** Powody, dla których główny zapis nie został użyty (gdy source = backup). */
      recoveredBecause?: string[];
      migratedFrom?: number;
    }
  /** Główny zapis i kopia są nieczytelne; oryginały zostały zachowane w kluczach *.corrupt. */
  | { kind: "corrupt"; problems: string[] }
  /** Zapis pochodzi z nowszej wersji gry – nie jest ruszany ani nadpisywany. */
  | { kind: "unsupported"; version: number; reason: string }
  | { kind: "migration_failed"; from: number; error: string };

export type SaveOutcome = { ok: true } | { ok: false; error: string };

/**
 * Interfejs magazynu zapisu. Metody są asynchroniczne, aby w przyszłości dało się
 * podstawić IndexedDB lub serwer. Implementacja localStorage wykonuje zapis
 * synchronicznie w momencie wywołania (ważne dla zapisu przy zamykaniu karty).
 */
export interface SaveStore {
  load(): Promise<LoadResult>;
  save(save: SaveV4): Promise<SaveOutcome>;
  /** Usuwa wszystko, co należy do gry (zapis, kopie, archiwa) – narzędzie dev/testowe. */
  reset(): Promise<void>;
}

export type LocalStorageSaveStoreOptions = {
  storage?: KeyValueStorage;
  prefix?: string;
  schema?: SchemaConfig;
  archiveSlots?: number;
};

export const DEFAULT_SAVE_PREFIX = "miasto.save";

export class LocalStorageSaveStore implements SaveStore {
  private readonly explicitStorage?: KeyValueStorage;
  private readonly prefix: string;
  private readonly schema: SchemaConfig;
  private readonly archiveSlots: number;

  constructor(options: LocalStorageSaveStoreOptions = {}) {
    this.explicitStorage = options.storage;
    this.prefix = options.prefix ?? DEFAULT_SAVE_PREFIX;
    this.schema = options.schema ?? DEFAULT_SCHEMA;
    this.archiveSlots = options.archiveSlots ?? 5;
  }

  private get keys() {
    const p = this.prefix;
    return {
      primary: p,
      backup: `${p}.bak`,
      corrupt: `${p}.corrupt`,
      corruptBackup: `${p}.corrupt.bak`,
      archive: (slot: number) => `${p}.archive.${slot}`,
      archiveNext: `${p}.archive.next`,
      premigration: (from: number, n: number) => `${p}.premigration.v${from}.${n}`,
    };
  }

  private get storage(): KeyValueStorage {
    const s = this.explicitStorage ?? (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (!s) throw new Error("localStorage jest niedostępny");
    return s;
  }

  private read(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  private tryWrite(key: string, value: string): boolean {
    try {
      this.write(key, value);
      return true;
    } catch {
      return false;
    }
  }

  private quarantine(key: string, raw: string | null): void {
    if (raw === null || this.read(key) === raw) return;
    this.tryWrite(key, raw);
  }

  private archive(raw: string): void {
    const k = this.keys;
    for (let i = 0; i < this.archiveSlots; i++) {
      if (this.read(k.archive(i)) === raw) return;
    }
    const nextRaw = Number(this.read(k.archiveNext));
    const next = Number.isInteger(nextRaw) && nextRaw >= 0 ? nextRaw : 0;
    if (this.tryWrite(k.archive(next % this.archiveSlots), raw)) {
      this.tryWrite(k.archiveNext, String(next + 1));
    }
  }

  private backupBeforeMigration(from: number, raw: string): boolean {
    for (let n = 0; n < 20; n++) {
      const key = this.keys.premigration(from, n);
      const existing = this.read(key);
      if (existing === raw) return true;
      if (existing === null) return this.tryWrite(key, raw);
    }
    return false;
  }

  private inspect(raw: string):
    | { kind: "ok"; save: SaveV4; migratedFrom?: number }
    | { kind: "invalid"; problems: string[] }
    | { kind: "unsupported"; version: number; reason: string }
    | { kind: "migration_failed"; from: number; error: string } {
    const decoded = decodeSave(raw, this.schema);
    switch (decoded.kind) {
      case "ok":
        return { kind: "ok", save: decoded.save };
      case "invalid":
      case "unsupported":
        return decoded;
      case "needs_migration": {
        if (!this.backupBeforeMigration(decoded.from, raw)) {
          return {
            kind: "migration_failed",
            from: decoded.from,
            error: "nie udało się utworzyć kopii zapasowej przed migracją",
          };
        }
        const migrated = migratePayload(decoded.payload, decoded.from, this.schema);
        if (!migrated.ok) return { kind: "migration_failed", from: decoded.from, error: migrated.error };
        return { kind: "ok", save: migrated.save, migratedFrom: decoded.from };
      }
    }
  }

  private loadSync(): LoadResult {
    const k = this.keys;
    const primaryRaw = this.read(k.primary);
    const backupRaw = this.read(k.backup);
    if (primaryRaw === null && backupRaw === null) return { kind: "none" };

    const problems: string[] = [];
    if (primaryRaw !== null) {
      const primary = this.inspect(primaryRaw);
      if (primary.kind === "ok") {
        if (primary.migratedFrom !== undefined) this.saveSync(primary.save);
        return { kind: "ok", save: primary.save, source: "primary", migratedFrom: primary.migratedFrom };
      }
      if (primary.kind === "unsupported" || primary.kind === "migration_failed") return primary;
      problems.push(...primary.problems.map((p) => `zapis główny: ${p}`));
    } else {
      problems.push("zapis główny: brak");
    }

    if (backupRaw !== null) {
      const backup = this.inspect(backupRaw);
      if (backup.kind === "ok") {
        this.quarantine(k.corrupt, primaryRaw);
        this.tryWrite(k.primary, backup.migratedFrom === undefined ? backupRaw : encodeSave(backup.save));
        return {
          kind: "ok",
          save: backup.save,
          source: "backup",
          recoveredBecause: problems,
          migratedFrom: backup.migratedFrom,
        };
      }
      if (backup.kind === "unsupported" || backup.kind === "migration_failed") return backup;
      problems.push(...backup.problems.map((p) => `kopia zapasowa: ${p}`));
    }

    this.quarantine(k.corrupt, primaryRaw);
    this.quarantine(k.corruptBackup, backupRaw);
    return { kind: "corrupt", problems };
  }

  private saveSync(save: SaveV4): SaveOutcome {
    const k = this.keys;
    try {
      const validated = this.schema.validate(save);
      if (!validated.ok) {
        return { ok: false, error: `odmowa zapisu niepoprawnych danych: ${validated.problems.join("; ")}` };
      }
      const raw = encodeSave(save);
      const existingRaw = this.read(k.primary);

      if (existingRaw !== null) {
        const existing = decodeSave(existingRaw, this.schema);
        if (existing.kind === "unsupported") {
          return { ok: false, error: `zapis w nowszej wersji (${existing.version}) nie zostanie nadpisany` };
        }
        if (existing.kind === "invalid") {
          this.quarantine(k.corrupt, existingRaw);
        } else {
          const existingId =
            existing.kind === "ok"
              ? existing.save.saveId
              : (existing.payload as { saveId?: unknown } | null)?.saveId;
          if (existingId !== save.saveId) this.archive(existingRaw);
          if (this.read(k.backup) !== existingRaw) this.tryWrite(k.backup, existingRaw);
        }
      }

      this.write(k.primary, raw);
      if (this.read(k.primary) !== raw) {
        if (existingRaw !== null) this.tryWrite(k.primary, existingRaw);
        return { ok: false, error: "weryfikacja po zapisie nie powiodła się" };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private resetSync(): void {
    const s = this.storage;
    const doomed: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key !== null && (key === this.prefix || key.startsWith(`${this.prefix}.`))) doomed.push(key);
    }
    for (const key of doomed) s.removeItem(key);
  }

  async load(): Promise<LoadResult> {
    return this.loadSync();
  }

  async save(save: SaveV4): Promise<SaveOutcome> {
    return this.saveSync(save);
  }

  async reset(): Promise<void> {
    this.resetSync();
  }
}
