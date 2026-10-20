import { LEGACY_ITEM_IDS, LEGACY_REMOVED_ITEMS, type ItemStack } from "../../content/items";
import { safeForestPose } from "../../world/generators/v2/pose";
import { fingerprintWorld, generateWorld } from "../../world";
import type { SaveV1, SaveV2 } from "../schema";
import { validateSaveV1 } from "../validateV1";

/**
 * Migracja SaveV1 -> SaveV2 (kontrolowana, bez zastępowania danych gracza):
 * - miasto, domy (łącznie z własnością i poziomem), pieniądze, zdrowie, czas, imię i tutorial zostają bez zmian;
 * - świat: generator 1 -> 2 (miasto identyczne, dochodzi las z kotwicami); odcisk liczony dla nowego generatora,
 *   wpis w `genHistory` zapisuje moment migracji;
 * - ekwipunek: identyfikatory z przestrzenią nazw, stosy i księga przedmiotów zgodna z zawartością; dawny telefon (usunięty z gry) jest pomijany;
 * - pozycja w lesie: zostaje, jeśli jest poprawna w nowym lesie, w przeciwnym razie bezpieczny punkt wejścia;
 * - nowe dane (zadania, skrzynie, troll, most) startują od zera.
 */
export function migrateV1ToV2(payload: Record<string, unknown>): Record<string, unknown> {
  const checked = validateSaveV1(payload);
  if (!checked.ok) throw new Error(`niepoprawny SaveV1: ${checked.problems.join("; ")}`);
  const v1: SaveV1 = checked.value;
  if (v1.world.genVersion !== 1) throw new Error(`SaveV1 z nieoczekiwanym generatorem ${v1.world.genVersion}`);

  const slots: (ItemStack | null)[] = v1.player.slots.map((id) => {
    if (id === null) return null;
    // Telefon (przedmiot usunięty z gry) nie trafia do nowego formatu; reszta ekwipunku zostaje na swoich miejscach.
    if (LEGACY_REMOVED_ITEMS.includes(id)) return null;
    const mapped = LEGACY_ITEM_IDS[id];
    if (!mapped) throw new Error(`nieznany przedmiot ${id}`);
    return { id: mapped, count: 1 };
  });
  const gained: Record<string, number> = {};
  for (const s of slots) if (s) gained[s.id] = (gained[s.id] ?? 0) + s.count;

  const world2 = generateWorld(v1.world.seed, 2);
  const next: SaveV2 = {
    version: 2,
    saveId: v1.saveId,
    savedAt: v1.savedAt,
    world: {
      seed: v1.world.seed,
      genVersion: 2,
      fingerprint: fingerprintWorld(world2),
      genHistory: [...v1.world.genHistory, { version: 2, atElapsed: v1.time.elapsed }],
    },
    time: { elapsed: v1.time.elapsed },
    player: {
      name: v1.player.name,
      health: v1.player.health,
      drainAcc: v1.player.drainAcc,
      dead: v1.player.dead,
      deaths: v1.player.deaths,
      wallet: v1.player.wallet,
      slots,
      ledger: { gained, spent: {} },
      selected: v1.player.selected,
      forestPose: v1.player.forestPose ? safeForestPose(v1.world.seed, v1.player.forestPose) : null,
    },
    tutorial: { done: v1.tutorial.done },
    houses: v1.houses.map((h) => ({ ...h })),
    quests: { accepted: {}, completed: {}, read: [] },
    chests: {},
    troll: { phase: "unmet", lockUntil: 0, attempts: 0, deposit: [] },
    harvested: [],
    bridge: { built: false, builtAt: null },
    discovered: [],
    badges: [],
  };
  return next as unknown as Record<string, unknown>;
}
