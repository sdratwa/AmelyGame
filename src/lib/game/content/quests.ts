import type { BadgeId, ChestId, QuestId } from "../core/ids";
import type { ItemId } from "./items";

/**
 * Cele zadań są danymi wyliczanymi ze stanu gry:
 * - `obtained`: monotoniczne ("znaleziono"), liczone z księgi zdobytych przedmiotów;
 * - `holding`: ilościowe, liczone z bieżącego ekwipunku;
 * - `flag`: zdarzenie świata (most zbudowany, drugi brzeg odkryty, depozyt odzyskany).
 */
export type ObjectiveDef =
  | { id: string; title: string; kind: "obtained"; item: ItemId; count: number }
  | { id: string; title: string; kind: "holding"; item: ItemId; count: number }
  | { id: string; title: string; kind: "flag"; flag: QuestFlag; visibleWhen?: "troll_deposit_nonempty" };

export type QuestFlag = "bridge.built" | "beyond.discovered" | "troll.deposit_empty";

/**
 * Obszary poszukiwań pokazywane na minimapie, gdy etap jest bieżący (dane, nie logika komponentu):
 * - `chest`: orientacyjny obszar skrzyni, dopóki skrzynia nie jest otwarta, a jej przedmiot nie został zdobyty;
 * - `bridge_site`: orientacyjny obszar miejsca budowy przy rzece;
 * - `crossing`: miejsce przeprawy i cel na drugim brzegu (po zbudowaniu mostu).
 */
export type MapAreaDef =
  | { kind: "chest"; chest: ChestId; item: ItemId }
  | { kind: "bridge_site" }
  | { kind: "crossing" };

/** `hint`: krótka podpowiedź kontekstowa pokazywana w trackerze i dzienniku, dopóki etap trwa. */
export type StageDef = {
  id: string;
  title: string;
  hint: string;
  objectives: readonly ObjectiveDef[];
  areas: readonly MapAreaDef[];
};

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

/** Przepis na most: jedyne źródło wymagań budowy (cele questa, okno budowy i silnik czytają stąd). */
export const RECIPE_BRIDGE_01 = {
  id: "recipe.bridge_01" as const,
  name: "Drewniany most",
  requires: [
    { id: "resource.wood" as const, count: 5 },
    { id: "resource.stone" as const, count: 10 },
  ],
  blueprint: "item.bridge_blueprint" as const,
};

const need = (id: "resource.wood" | "resource.stone") => RECIPE_BRIDGE_01.requires.find((r) => r.id === id)?.count ?? 0;

/** Etapy w kolejności rozgrywki: schemat (troll) -> narzędzia -> materiały -> budowa -> przeprawa. */
export const QUESTS: readonly QuestDef[] = [
  {
    id: QUEST_BRIDGE_01,
    title: "Most do nieznanego",
    summary: "Odbuduj dawny most nad rzeką.",
    description:
      "Dawny most nad rzeką został zniszczony. Bez niego nie możemy dotrzeć do dalszej części lasu. Potrzebujemy kogoś odważnego, kto odbuduje most. Schematu jego budowy pilnuje troll w lesie: odszukaj go, rozwiąż jego zagadkę, zdobądź narzędzia i materiały, a potem odbuduj przeprawę.",
    preview: false,
    requires: [],
    stages: [
      {
        id: "blueprint",
        title: "Schemat mostu",
        hint: "Wejdź do lasu i odszukaj trolla. Porozmawiaj z nim, rozwiąż zagadkę, a potem otwórz skrzynię ze schematem. Pomoże ci minimapa (M).",
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
        areas: [{ kind: "chest", chest: "chest.bridge.blueprint", item: "item.bridge_blueprint" }],
      },
      {
        id: "tools",
        title: "Narzędzia",
        hint: "Do zdobycia drewna potrzebujesz piły, a do kamienia kilofa. Odszukaj obie skrzynie z narzędziami, w dowolnej kolejności.",
        objectives: [
          { id: "saw", title: "Znajdź piłę", kind: "obtained", item: "item.saw", count: 1 },
          { id: "pickaxe", title: "Znajdź kilof", kind: "obtained", item: "item.pickaxe", count: 1 },
        ],
        areas: [
          { kind: "chest", chest: "chest.bridge.saw", item: "item.saw" },
          { kind: "chest", chest: "chest.bridge.pickaxe", item: "item.pickaxe" },
        ],
      },
      {
        id: "materials",
        title: "Materiały",
        hint: "Piłą zetniesz drzewa, kilofem rozbijesz skały. Większe drzewa i skały dają więcej.",
        objectives: [
          { id: "wood", title: "Drewno", kind: "holding", item: "resource.wood", count: need("resource.wood") },
          { id: "stone", title: "Kamień", kind: "holding", item: "resource.stone", count: need("resource.stone") },
        ],
        areas: [],
      },
      {
        id: "build",
        title: "Budowa",
        hint: "Masz już wszystkie potrzebne materiały. Odszukaj miejsce budowy mostu.",
        objectives: [{ id: "bridge", title: "Zbuduj most w miejscu budowy", kind: "flag", flag: "bridge.built" }],
        areas: [{ kind: "bridge_site" }],
      },
      {
        id: "cross",
        title: "Przeprawa",
        hint: "Most stoi. Przejdź na drugą stronę rzeki.",
        objectives: [{ id: "cross", title: "Przejdź przez most na drugi brzeg", kind: "flag", flag: "beyond.discovered" }],
        areas: [{ kind: "crossing" }],
      },
    ],
    completeWhen: "beyond.discovered",
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
