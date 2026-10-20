import { LEGACY_REMOVED_ITEMS } from "../../content/items";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const removed = (id: unknown): boolean => typeof id === "string" && LEGACY_REMOVED_ITEMS.includes(id);

function withoutRemoved(record: Obj): Obj {
  return Object.fromEntries(Object.entries(record).filter(([id]) => !removed(id)));
}

/**
 * Migracja SaveV2 -> SaveV3: z gry usunięto telefon (przedmiot ze slotu 1). Migracja wycina WYŁĄCZNIE ten przedmiot
 * (miejsce w ekwipunku, wpisy księgi i ewentualny depozyt trolla) i podnosi wersję. Pieniądze, domy, postęp questa,
 * skrzynie, zebrane obiekty, most (także zbudowany), odkryte regiony, odznaki, pozycja w lesie, `world.seed`,
 * wersja generatora i odcisk świata zostają bez zmian. Pozostałe przedmioty zostają na swoich miejscach, a zwolniony
 * slot jest pusty. Czysta funkcja na kopii danych; po niej payload przechodzi walidację SaveV3.
 */
export function migrateV2ToV3(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.version !== 2) throw new Error(`oczekiwano SaveV2, jest ${String(payload.version)}`);
  const { player, troll } = payload;
  if (!isObj(player) || !Array.isArray(player.slots) || !isObj(player.ledger) || !isObj(player.ledger.gained) || !isObj(player.ledger.spent)) {
    throw new Error("SaveV2: brak ekwipunku lub księgi");
  }
  if (!isObj(troll) || !Array.isArray(troll.deposit)) throw new Error("SaveV2: brak depozytu trolla");

  const slots = player.slots.map((s) => (isObj(s) && removed(s.id) ? null : s));
  const ledger = { gained: withoutRemoved(player.ledger.gained), spent: withoutRemoved(player.ledger.spent) };
  const deposit = troll.deposit.filter((s) => !(isObj(s) && removed(s.id)));

  return {
    ...payload,
    version: 3,
    player: { ...player, slots, ledger },
    troll: { ...troll, deposit },
  };
}
