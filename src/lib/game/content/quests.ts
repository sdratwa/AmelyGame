import type { BadgeId, QuestId } from "../core/ids";
import type { ItemId } from "./items";

/**
 * Cele zadań są danymi wyliczanymi ze stanu gry:
 * - `obtained`: monotoniczne ("znaleziono"), liczone z księgi zdobytych przedmiotów;
 * - `holding`: ilościowe, liczone z bieżącego ekwipunku;
 * - `flag`: zdarzenie świata (most zbudowany, depozyt odzyskany).
 */
export type ObjectiveDef =
  | { id: string; title: string; kind: "obtained"; item: ItemId; count: number }
  | { id: string; title: string; kind: "holding"; item: ItemId; count: number }
  | { id: string; title: string; kind: "flag"; flag: QuestFlag; visibleWhen?: "troll_deposit_nonempty" };

export type QuestFlag = "bridge.built" | "troll.deposit_empty";

export type StageDef = { id: string; title: string; objectives: readonly ObjectiveDef[] };

export type QuestDef = {
  id: QuestId;
  title: string;
  summary: string;
  description: string;
  /** Zapowiedź: zawsze niedostępna, bez celów (treść robocza). */
  preview: boolean;
  requires: readonly QuestId[];
  stages: readonly StageDef[];
  completeWhen: QuestFlag | null;
  reward: { money: number; badge: BadgeId | null };
};

export const QUEST_BRIDGE_01: QuestId = "quest.bridge_01";
export const BADGE_EXPLORER: BadgeId = "badge.explorer";

export const QUESTS: readonly QuestDef[] = [
  {
    id: QUEST_BRIDGE_01,
    title: "Most do nieznanego",
    summary: "Odbuduj dawny most nad rzeką.",
    description:
      "Dawny most nad rzeką został zniszczony. Bez niego nie możemy dotrzeć do dalszej części lasu. Potrzebujemy kogoś odważnego, kto odnajdzie stary plan mostu, zgromadzi materiały i pomoże go odbudować.",
    preview: false,
    requires: [],
    stages: [
      {
        id: "tools",
        title: "Narzędzia",
        objectives: [
          { id: "pickaxe", title: "Znajdź kilof", kind: "obtained", item: "item.pickaxe", count: 1 },
          { id: "saw", title: "Znajdź piłę", kind: "obtained", item: "item.saw", count: 1 },
        ],
      },
      {
        id: "blueprint",
        title: "Schemat",
        objectives: [
          { id: "blueprint", title: "Zdobądź schemat mostu", kind: "obtained", item: "item.bridge_blueprint", count: 1 },
          {
            id: "recover",
            title: "Odzyskaj przedmioty od trolla",
            kind: "flag",
            flag: "troll.deposit_empty",
            visibleWhen: "troll_deposit_nonempty",
          },
        ],
      },
      {
        id: "materials",
        title: "Materiały",
        objectives: [
          { id: "wood", title: "Drewno", kind: "holding", item: "resource.wood", count: 5 },
          { id: "stone", title: "Kamienie", kind: "holding", item: "resource.stone", count: 10 },
        ],
      },
      {
        id: "build",
        title: "Budowa",
        objectives: [{ id: "bridge", title: "Zbuduj most przy rzece", kind: "flag", flag: "bridge.built" }],
      },
    ],
    completeWhen: "bridge.built",
    reward: { money: 5000, badge: BADGE_EXPLORER },
  },
  {
    id: "quest.preview_orchard",
    title: "Zapowiedź: Sad za wzgórzem",
    summary: "Wkrótce.",
    description: "Treść robocza. To zadanie pojawi się w jednej z następnych aktualizacji.",
    preview: true,
    requires: [QUEST_BRIDGE_01],
    stages: [],
    completeWhen: null,
    reward: { money: 0, badge: null },
  },
  {
    id: "quest.preview_lantern",
    title: "Zapowiedź: Latarnia nad jeziorem",
    summary: "Wkrótce.",
    description: "Treść robocza. To zadanie pojawi się w jednej z następnych aktualizacji.",
    preview: true,
    requires: [QUEST_BRIDGE_01],
    stages: [],
    completeWhen: null,
    reward: { money: 0, badge: null },
  },
];

export const QUEST_BY_ID: ReadonlyMap<string, QuestDef> = new Map(QUESTS.map((q) => [q.id, q]));

/** Przepis na most: wymagania budowy jako dane (schemat = ogólna receptura). */
export const RECIPE_BRIDGE_01 = {
  id: "recipe.bridge_01" as const,
  name: "Drewniany most",
  requires: [
    { id: "resource.wood" as const, count: 5 },
    { id: "resource.stone" as const, count: 10 },
  ],
  blueprint: "item.bridge_blueprint" as const,
};
