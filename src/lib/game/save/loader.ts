import type { House } from "../content/houses";
import { fingerprintWorld, generateWorld, hasGenerator } from "../world";
import type { LoadResult, SaveStore } from "./store";
import type { SaveV5 } from "./schema";

export type WorldCheck = { ok: true } | { ok: false; reason: string };

const IMMUTABLE_HOUSE_FIELDS = [
  "id",
  "name",
  "price",
  "phone",
  "wallColor",
  "roofColor",
  "doorColor",
  "flip",
] as const satisfies readonly (keyof House)[];

/**
 * Sprawdza, czy zapisany świat zgadza się z tym, który generator odtwarza z (seed, wersja):
 * odcisk bazy oraz niezmienne pola domów. Dane gracza (owned, level) mogą się różnić.
 */
export function verifyWorld(save: SaveV5): WorldCheck {
  const { seed, genVersion, fingerprint } = save.world;
  if (!hasGenerator(genVersion)) {
    return { ok: false, reason: `nieznana wersja generatora świata (${genVersion})` };
  }
  const base = generateWorld(seed, genVersion);
  if (fingerprintWorld(base) !== fingerprint) {
    return { ok: false, reason: "odcisk świata (worldFingerprint) nie zgadza się z generatorem" };
  }
  if (save.houses.length !== base.houses.length) {
    return { ok: false, reason: "liczba domów w zapisie nie zgadza się ze światem" };
  }
  for (const expected of base.houses) {
    const actual = save.houses.find((h) => h.id === expected.id);
    if (!actual) return { ok: false, reason: `brak domu ${expected.id} w zapisie` };
    for (const field of IMMUTABLE_HOUSE_FIELDS) {
      if (actual[field] !== expected[field]) {
        return { ok: false, reason: `dom ${expected.id}: pole ${field} różni się od świata` };
      }
    }
  }
  return { ok: true };
}

export type BootResult =
  | Exclude<LoadResult, { kind: "ok" }>
  | Extract<LoadResult, { kind: "ok" }>
  /** Zapis jest poprawny, ale nie pasuje do generatora – pozostaje nietknięty w magazynie. */
  | { kind: "world_mismatch"; save: SaveV5; reason: string };

/** Wczytanie gry przy starcie: magazyn (walidacja, kopie, migracje) + zgodność świata. */
export async function loadGame(store: SaveStore): Promise<BootResult> {
  const loaded = await store.load();
  if (loaded.kind !== "ok") return loaded;
  const check = verifyWorld(loaded.save);
  if (!check.ok) return { kind: "world_mismatch", save: loaded.save, reason: check.reason };
  return loaded;
}
