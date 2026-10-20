import { QUEST_BY_ID, QUESTS, type ObjectiveDef, type QuestDef, type QuestFlag } from "../content/quests";
import type { QuestId } from "../core/ids";
import { result, unchanged, withToast, type CommandResult } from "../core/result";
import type { GameState } from "../core/state";
import { countOf } from "./containers";

export type QuestStatus = "unavailable" | "available" | "active" | "completed";

export type ObjectiveProgress = {
  id: string;
  title: string;
  current: number;
  target: number;
  done: boolean;
  visible: boolean;
};

export type StageProgress = {
  id: string;
  title: string;
  objectives: ObjectiveProgress[];
  done: boolean;
};

export type QuestProgress = {
  id: QuestId;
  status: QuestStatus;
  stages: StageProgress[];
  /** Indeks pierwszego nieukończonego etapu (lub ostatniego, gdy wszystko zrobione). */
  currentStage: number;
};

const trollDepositEmpty = (state: GameState) => state.troll.deposit.every((s) => s.count <= 0);

export function flagValue(state: GameState, flag: QuestFlag): boolean {
  switch (flag) {
    case "bridge.built":
      return state.bridge.built;
    case "beyond.discovered": {
      const region = state.world?.anchors?.beyond.region;
      return region ? state.discovered.includes(region) : false;
    }
    case "troll.deposit_empty":
      return trollDepositEmpty(state);
  }
}

export function questStatus(state: GameState, def: QuestDef): QuestStatus {
  if (state.quests.completed[def.id]) return "completed";
  if (state.quests.accepted[def.id]) return "active";
  if (def.preview) return "unavailable";
  return def.requires.every((id) => state.quests.completed[id]) ? "available" : "unavailable";
}

function objectiveProgress(state: GameState, o: ObjectiveDef): ObjectiveProgress {
  if (o.kind === "obtained") {
    const have = state.ledger.gained[o.item] ?? 0;
    const current = Math.min(have, o.count);
    return { id: o.id, title: o.title, current, target: o.count, done: have >= o.count, visible: true };
  }
  if (o.kind === "holding") {
    const have = countOf(state.slots, o.item);
    return { id: o.id, title: o.title, current: Math.min(have, o.count), target: o.count, done: have >= o.count, visible: true };
  }
  const visible = o.visibleWhen === "troll_deposit_nonempty" ? !trollDepositEmpty(state) : true;
  const done = flagValue(state, o.flag);
  return { id: o.id, title: o.title, current: done ? 1 : 0, target: 1, done, visible };
}

/**
 * Postęp zadania wyliczany ze stanu gry (nie jest osobno zapisywany, więc nie może się rozjechać z grą).
 * Etap jest ukończony, gdy wszystkie jego widoczne cele są spełnione.
 */
export function questProgress(state: GameState, id: QuestId): QuestProgress | null {
  const def = QUEST_BY_ID.get(id);
  if (!def) return null;
  const stages: StageProgress[] = def.stages.map((st) => {
    const objectives = st.objectives.map((o) => objectiveProgress(state, o));
    return { id: st.id, title: st.title, objectives, done: objectives.every((o) => !o.visible || o.done) };
  });
  // Etap złożony wyłącznie ze zdarzeń świata (budowa, przeprawa) po ukończeniu domyka wcześniejsze etapy:
  // zużycie materiałów przy budowie nie może cofnąć postępu do etapu "Materiały".
  let lastEventStage = -1;
  def.stages.forEach((st, i) => {
    if (stages[i].done && st.objectives.every((o) => o.kind === "flag")) lastEventStage = i;
  });
  for (let i = 0; i < lastEventStage; i++) stages[i].done = true;
  const firstOpen = stages.findIndex((s) => !s.done);
  return {
    id,
    status: questStatus(state, def),
    stages,
    currentStage: firstOpen === -1 ? Math.max(0, stages.length - 1) : firstOpen,
  };
}

/** Czy na tablicy jest nieprzeczytane ogłoszenie (wykrzyknik nad tablicą). */
export function boardHasUnread(state: GameState): boolean {
  return QUESTS.some((q) => questStatus(state, q) === "available" && !state.quests.read.includes(q.id));
}

export function activeQuests(state: GameState): QuestId[] {
  return QUESTS.filter((q) => questStatus(state, q) === "active").map((q) => q.id);
}

export function readBoard(state: GameState, id: QuestId): CommandResult {
  const def = QUEST_BY_ID.get(id);
  if (!def || state.phase !== "playing") return unchanged(state);
  if (state.quests.read.includes(id) || questStatus(state, def) === "unavailable") return unchanged(state);
  return result({ ...state, quests: { ...state.quests, read: [...state.quests.read, id] } }, {
    type: "quest.read",
    id,
  });
}

export function acceptQuest(state: GameState, id: QuestId): CommandResult {
  const def = QUEST_BY_ID.get(id);
  if (!def || state.phase !== "playing" || state.dead) return unchanged(state);
  if (questStatus(state, def) !== "available") return unchanged(state);
  const read = state.quests.read.includes(id) ? state.quests.read : [...state.quests.read, id];
  // Przyjęcie pierwszego zadania kończy samouczek (zegar rusza, las i reszta miasta są dostępne).
  const completesTutorial = !state.tutorialDone;
  return result(
    withToast(
      {
        ...state,
        tutorialDone: true,
        quests: { ...state.quests, read, accepted: { ...state.quests.accepted, [id]: { at: state.elapsed } } },
      },
      `Przyjęto zadanie: ${def.title}`,
    ),
    { type: "quest.accepted", id },
    ...(completesTutorial ? [{ type: "tutorial.completed" as const }] : []),
  );
}

/**
 * Domyka aktywne zadania, których warunek ukończenia jest spełniony (nagroda jednorazowo).
 * Wywoływane po każdej komendzie, dlatego kolejność zdarzeń (np. most zbudowany przed przyjęciem zadania)
 * nigdy nie blokuje zadania.
 */
export function settleQuests(state: GameState): CommandResult {
  let cur = state;
  const events: CommandResult["events"] = [];
  for (const def of QUESTS) {
    if (!cur.quests.accepted[def.id] || cur.quests.completed[def.id] || !def.completeWhen) continue;
    if (!flagValue(cur, def.completeWhen)) continue;
    const badges = def.reward.badge && !cur.badges.includes(def.reward.badge) ? [...cur.badges, def.reward.badge] : cur.badges;
    cur = withToast(
      {
        ...cur,
        wallet: cur.wallet + def.reward.money,
        badges,
        quests: { ...cur.quests, completed: { ...cur.quests.completed, [def.id]: { at: cur.elapsed } } },
      },
      `Zadanie ukończone: ${def.title} (+${def.reward.money} zł)`,
    );
    events.push({ type: "quest.completed", id: def.id, money: def.reward.money, badge: def.reward.badge });
  }
  return events.length === 0 ? unchanged(state) : { state: cur, events };
}
