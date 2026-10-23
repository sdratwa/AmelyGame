import { initialLantern } from "../../content/equipment";

/**
 * Migracja SaveV4 -> SaveV5: dodaje `player.lantern` z wyłączoną lampą naftową. Lampa jest stałym wyposażeniem każdego
 * gracza (poza slotami), więc migracja niczego nie dodaje do ekwipunku, księgi ani depozytu i nie może jej zduplikować.
 * Nic poza tym się nie zmienia. Czysta funkcja na kopii danych; po niej payload przechodzi walidację SaveV5.
 */
export function migrateV4ToV5(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.version !== 4) throw new Error(`oczekiwano SaveV4, jest ${String(payload.version)}`);
  const { player } = payload;
  if (typeof player !== "object" || player === null || Array.isArray(player)) throw new Error("SaveV4: brak sekcji player");
  return {
    ...payload,
    version: 5,
    player: { ...player, lantern: initialLantern() },
  };
}
