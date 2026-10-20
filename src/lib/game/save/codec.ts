import { canonicalize, hashHex } from "../world/fingerprint";
import { DEFAULT_SCHEMA, type SchemaConfig } from "./migrate";
import type { SaveV3 } from "./schema";

export const SAVE_FORMAT = "miasto-save";
export const ENVELOPE_VERSION = 1;

/** Zapis w pamięci trwałej: koperta z sumą kontrolną nad kanonicznym payloadem. */
type Envelope = { format: typeof SAVE_FORMAT; envelope: number; checksum: string; payload: unknown };

export function encodeSave(save: SaveV3): string {
  const envelope: Envelope = {
    format: SAVE_FORMAT,
    envelope: ENVELOPE_VERSION,
    checksum: hashHex(canonicalize(save)),
    payload: save,
  };
  return JSON.stringify(envelope);
}

export type DecodeResult =
  | { kind: "ok"; save: SaveV3 }
  | { kind: "needs_migration"; from: number; payload: unknown }
  | { kind: "unsupported"; version: number; reason: string }
  | { kind: "invalid"; problems: string[] };

/** Odczyt z walidacją: parsowanie, koperta, suma kontrolna, wersja, struktura. Nie zapisuje niczego. */
export function decodeSave(raw: string, config: SchemaConfig = DEFAULT_SCHEMA): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", problems: ["niepoprawny JSON (zapis ucięty lub uszkodzony)"] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "invalid", problems: ["koperta: oczekiwano obiektu"] };
  }
  const env = parsed as Record<string, unknown>;
  if (env.format !== SAVE_FORMAT) return { kind: "invalid", problems: ["koperta: nieznany format"] };
  if (typeof env.envelope !== "number" || !Number.isInteger(env.envelope)) {
    return { kind: "invalid", problems: ["koperta: brak wersji koperty"] };
  }
  if (env.envelope > ENVELOPE_VERSION) {
    return { kind: "unsupported", version: env.envelope, reason: "zapis w nowszej kopercie niż obsługuje ta wersja gry" };
  }
  if (typeof env.checksum !== "string") return { kind: "invalid", problems: ["koperta: brak sumy kontrolnej"] };
  let expected: string;
  try {
    expected = hashHex(canonicalize(env.payload));
  } catch {
    return { kind: "invalid", problems: ["koperta: payload nieserializowalny"] };
  }
  if (expected !== env.checksum) return { kind: "invalid", problems: ["suma kontrolna nie zgadza się"] };

  const payload = env.payload;
  const version =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).version : undefined;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { kind: "invalid", problems: ["payload: brak poprawnej wersji zapisu"] };
  }
  if (version > config.current) {
    return { kind: "unsupported", version, reason: "zapis pochodzi z nowszej wersji gry" };
  }
  if (version < config.current) return { kind: "needs_migration", from: version, payload };
  const validated = config.validate(payload);
  if (!validated.ok) return { kind: "invalid", problems: validated.problems };
  return { kind: "ok", save: validated.value };
}
