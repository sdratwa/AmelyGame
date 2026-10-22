import { DEFAULT_APPEARANCE } from "@/lib/character/appearance";

/**
 * Migracja SaveV3 -> SaveV4: dodaje `player.appearance` z domyślnym wyglądem postaci. Nic poza tym się nie zmienia
 * (pieniądze, ekwipunek, questy, skrzynie, most, pozycja w lesie, świat). Czysta funkcja na kopii danych; po niej
 * payload przechodzi walidację SaveV4.
 */
export function migrateV3ToV4(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.version !== 3) throw new Error(`oczekiwano SaveV3, jest ${String(payload.version)}`);
  const { player } = payload;
  if (typeof player !== "object" || player === null || Array.isArray(player)) throw new Error("SaveV3: brak sekcji player");
  return {
    ...payload,
    version: 4,
    player: { ...player, appearance: { ...DEFAULT_APPEARANCE } },
  };
}
