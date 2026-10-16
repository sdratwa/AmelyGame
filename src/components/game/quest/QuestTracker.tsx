import type { QuestView } from "@/lib/game/engine";
import { ObjectiveList } from "./ObjectiveList";

export function QuestTracker({ quest }: { quest: QuestView | null }) {
  if (!quest || !quest.stage) return null;
  const stageNo = quest.progress.currentStage + 1;
  return (
    <aside
      data-testid="quest-tracker"
      aria-label="Aktywne zadanie"
      className="pointer-events-none absolute right-2 top-2 z-20 w-60 rounded-xl border border-white/10 bg-slate-950/80 p-3 text-white shadow-lg backdrop-blur sm:w-72"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">Zadanie</p>
      <p data-testid="tracker-title" className="text-sm font-bold leading-tight">
        {quest.def.title}
      </p>
      <p data-testid="tracker-stage" className="mt-1 text-xs text-slate-300">
        Etap {stageNo}/{quest.def.stages.length}: {quest.stage.title}
      </p>
      <div className="mt-2">
        <ObjectiveList objectives={quest.objectives} testId="tracker-objectives" compact />
      </div>
      {quest.parallel.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Surowce na most</p>
          <ObjectiveList objectives={quest.parallel} testId="tracker-parallel" compact />
        </div>
      )}
      {quest.hint && (
        <p data-testid="tracker-hint" className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-snug text-slate-300">
          {quest.hint}
        </p>
      )}
      <p className="mt-1.5 text-[10px] text-slate-500">J – dziennik</p>
    </aside>
  );
}
