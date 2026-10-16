import { QUESTS, type QuestDef, type StageDef } from "../content/quests";
import type { GameState } from "../core/state";
import { questProgress, type ObjectiveProgress, type QuestProgress, type QuestStatus } from "./quests";

/** Widok zadania dla interfejsu: dane wyliczone w silniku, komponenty niczego nie liczą same. */
export type QuestView = {
  def: QuestDef;
  status: QuestStatus;
  progress: QuestProgress;
  /** Bieżący etap (tylko dla aktywnego zadania). */
  stage: StageDef | null;
  /** Widoczne cele bieżącego etapu. */
  objectives: ObjectiveProgress[];
  /**
   * Cele z późniejszych etapów, które da się realizować już teraz niezależnie od kolejności (zbieranie surowców):
   * dzięki nim gracz widzi postęp drewna i kamienia, nawet gdy bieżący etap dotyczy czegoś innego.
   */
  parallel: ObjectiveProgress[];
  hint: string | null;
  read: boolean;
};

function toView(state: GameState, def: QuestDef): QuestView | null {
  const progress = questProgress(state, def.id);
  if (!progress) return null;
  const active = progress.status === "active";
  const stage = active ? (def.stages[progress.currentStage] ?? null) : null;
  const stageProgress = active ? progress.stages[progress.currentStage] : undefined;
  const parallel: ObjectiveProgress[] = [];
  if (active) {
    def.stages.forEach((st, i) => {
      if (i <= progress.currentStage) return;
      st.objectives.forEach((o, k) => {
        const p = progress.stages[i]?.objectives[k];
        if (o.kind === "holding" && p?.visible) parallel.push(p);
      });
    });
  }
  return {
    def,
    status: progress.status,
    progress,
    stage,
    objectives: stageProgress ? stageProgress.objectives.filter((o) => o.visible) : [],
    parallel,
    hint: stage?.hint ?? null,
    read: state.quests.read.includes(def.id),
  };
}

export function questViews(state: GameState): QuestView[] {
  return QUESTS.flatMap((def) => {
    const view = toView(state, def);
    return view ? [view] : [];
  });
}

/** Zadania do pokazania na tablicy: dostępne, w toku i ukończone oraz zapowiedzi (niedostępne). */
export function boardEntries(state: GameState): QuestView[] {
  return questViews(state).filter((v) => v.def.preview || v.status !== "unavailable");
}

export function journalEntries(state: GameState): { active: QuestView[]; completed: QuestView[] } {
  const views = questViews(state);
  return {
    active: views.filter((v) => v.status === "active"),
    completed: views.filter((v) => v.status === "completed"),
  };
}

/** Zadanie śledzone w trackerze: pierwsze aktywne. */
export function trackedQuest(state: GameState): QuestView | null {
  return questViews(state).find((v) => v.status === "active") ?? null;
}
