import { CURRENT_SAVE_VERSION, type SaveV1 } from "./schema";
import { validateSaveV1, type ValidationResult } from "./validate";

/** Krok migracji vN -> vN+1: czysta funkcja na kopii danych; ma zwrócić obiekt z version = N+1. */
export type MigrationStep = (payload: Record<string, unknown>) => Record<string, unknown>;

/** Konfiguracja schematu – podmieniana w testach, aby sprawdzić migracje przyszłych wersji. */
export type SchemaConfig = {
  current: number;
  steps: Readonly<Record<number, MigrationStep>>;
  validate: (payload: unknown) => ValidationResult<SaveV1>;
};

/** Migracje dla realnych zapisów. Pusta: SaveV1 jest pierwszą wersją formatu. */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

export const DEFAULT_SCHEMA: SchemaConfig = {
  current: CURRENT_SAVE_VERSION,
  steps: MIGRATIONS,
  validate: validateSaveV1,
};

export type MigrationResult =
  | { ok: true; save: SaveV1 }
  | { ok: false; error: string };

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Migruje payload do wersji bieżącej. Nigdy nie modyfikuje wejścia:
 * pracuje na kopii, a każdy błąd (wyjątek, zła wersja, nieudana walidacja) kończy się wynikiem ok:false.
 */
export function migratePayload(
  payload: unknown,
  from: number,
  config: SchemaConfig = DEFAULT_SCHEMA,
): MigrationResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, error: "payload nie jest obiektem" };
  }
  if (!Number.isInteger(from) || from < 1 || from > config.current) {
    return { ok: false, error: `nieobsługiwana wersja źródłowa: ${from}` };
  }
  let data: Record<string, unknown>;
  try {
    data = deepClone(payload as Record<string, unknown>);
  } catch (e) {
    return { ok: false, error: `nie można skopiować danych: ${String(e)}` };
  }
  for (let v = from; v < config.current; v++) {
    const step = config.steps[v];
    if (!step) return { ok: false, error: `brak migracji v${v} -> v${v + 1}` };
    try {
      const next = step(data);
      if (typeof next !== "object" || next === null || next.version !== v + 1) {
        return { ok: false, error: `migracja v${v} -> v${v + 1} zwróciła niepoprawną wersję` };
      }
      data = next;
    } catch (e) {
      return { ok: false, error: `migracja v${v} -> v${v + 1} nie powiodła się: ${String(e)}` };
    }
  }
  const validated = config.validate(data);
  if (!validated.ok) {
    return { ok: false, error: `po migracji dane są niepoprawne: ${validated.problems.join("; ")}` };
  }
  return { ok: true, save: validated.value };
}
