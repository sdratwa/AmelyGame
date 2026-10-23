/**
 * Stałe wyposażenie gracza: narzędzia, które każdy gracz ma od początku gry i których nie da się zgubić, sprzedać,
 * zniszczyć, zużyć ani wyrzucić. To NIE są przedmioty z `ITEMS`: nie zajmują miejsc ekwipunku (`INVENTORY_SLOTS` zostaje
 * dla rzeczy zbieranych w grze), nie trafiają do księgi (`ledger`), depozytu trolla ani do skrzyń. Posiadanie wynika z
 * samej definicji (każdy gracz ma całe `EQUIPMENT`), więc zapis przechowuje tylko stan przełączników (np. lampa włączona).
 */

/** Identyfikator lampy naftowej (stały; używany w zapisie, sieci i interfejsie). */
export const OIL_LANTERN_ID = "oil_lantern";

export type EquipmentId = typeof OIL_LANTERN_ID;

export type EquipmentDef = {
  id: EquipmentId;
  /** Nazwa w interfejsie. */
  name: string;
  emoji: string;
  description: string;
  /** Stałe wyposażenie: nie można go zgubić, sprzedać, zniszczyć ani zużyć; nie wymaga paliwa. */
  permanent: true;
};

export const EQUIPMENT: Readonly<Record<EquipmentId, EquipmentDef>> = {
  [OIL_LANTERN_ID]: {
    id: OIL_LANTERN_ID,
    name: "Lampa naftowa",
    emoji: "🪔",
    description: "Stara lampa z ciepłym płomieniem. Nie wymaga paliwa. Zapal ją, żeby rozjaśnić las i dać się zauważyć z daleka.",
    permanent: true,
  },
};

export const EQUIPMENT_IDS = Object.keys(EQUIPMENT) as EquipmentId[];

export const isEquipmentId = (value: unknown): value is EquipmentId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(EQUIPMENT, value);

/** Stan lampy gracza (trwały, zapisywany w `player.lantern`). Parametry światła NIE są częścią stanu gry. */
export type LanternState = { enabled: boolean };

export function initialLantern(): LanternState {
  return { enabled: false };
}
