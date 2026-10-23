"use client";

import { useState } from "react";
import type { QuestView } from "@/lib/game/engine";
import { useTouchUi } from "@/components/input/hooks";
import { ObjectiveList } from "./ObjectiveList";

/** `touchTop`: odstęp od góry kompaktowej wersji na telefonie (pod HUD i innymi chipami). */
export function QuestTracker({ quest, touchTop = "3.25rem" }: { quest: QuestView | null; touchTop?: string }) {
  const touch = useTouchUi();
  const [open, setOpen] = useState(false);
  if (!quest || !quest.stage) return null;
  const stageNo = quest.progress.currentStage + 1;
  if (touch) {
    return (
      <aside
        data-testid="quest-tracker"
        aria-label="Aktywne zadanie"
        className="pointer-events-none absolute z-20 w-44 max-w-[45%] rounded-xl border border-white/10 bg-slate-950/55 text-white backdrop-blur-sm"
        style={{ top: touchTop, left: "max(0.5rem, var(--sal))" }}
      >
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="pointer-events-auto block w-full p-2 text-left">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-amber-300">Zadanie {open ? "▾" : "▸"}</p>
          <p data-testid="tracker-title" className="text-[11px] font-bold leading-tight">
            {quest.def.title}
          </p>
          <p data-testid="tracker-stage" className="mt-0.5 text-[10px] leading-snug text-slate-300">
            Etap {stageNo}/{quest.def.stages.length}: {quest.stage.title}
          </p>
        </button>
        {open && (
          <div className="max-h-[40dvh] overflow-y-auto px-2 pb-2">
            <ObjectiveList objectives={quest.objectives} testId="tracker-objectives" compact />
            {quest.parallel.length > 0 && (
              <div className="mt-1.5 border-t border-white/10 pt-1.5">
                <ObjectiveList objectives={quest.parallel} testId="tracker-parallel" compact />
              </div>
            )}
            {quest.hint && (
              <p data-testid="tracker-hint" className="mt-1.5 border-t border-white/10 pt-1.5 text-[10px] leading-snug text-slate-300">
                {quest.hint}
              </p>
            )}
          </div>
        )}
      </aside>
    );
  }
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
