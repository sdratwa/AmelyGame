import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney, type QuestView } from "@/lib/game/engine";
import { ObjectiveList } from "./ObjectiveList";

export type SaveStatus =
  | { kind: "idle"; lastAt: number | null }
  | { kind: "saving" }
  | { kind: "error"; error: string };

const BADGE_NAMES: Record<string, string> = { "badge.explorer": "Odkrywca" };

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ActiveQuest({ quest }: { quest: QuestView }) {
  return (
    <article data-testid={`journal-quest-${quest.def.id}`} className="rounded-xl border border-amber-200/30 bg-amber-100/5 p-3">
      <h3 className="text-sm font-bold text-amber-100">{quest.def.title}</h3>
      <p className="mt-1 text-xs text-slate-300">{quest.def.summary}</p>
      <ol className="mt-3 space-y-3">
        {quest.progress.stages.map((stage, i) => {
          const current = i === quest.progress.currentStage;
          const visible = stage.objectives.filter((o) => o.visible);
          const parallel = visible.filter((o) => quest.parallel.some((p) => p.id === o.id));
          return (
            <li
              key={stage.id}
              data-testid={`journal-stage-${stage.id}`}
              data-state={stage.done ? "done" : current ? "current" : "todo"}
              className={current ? "" : "opacity-60"}
            >
              <p className={`text-xs font-semibold ${current ? "text-amber-200" : stage.done ? "text-emerald-300" : "text-slate-400"}`}>
                {i + 1}. {stage.title}
                {current && " – bieżący cel"}
              </p>
              {(current || stage.done) && (
                <div className="mt-1">
                  <ObjectiveList objectives={visible} testId={current ? "journal-current-objectives" : undefined} />
                </div>
              )}
              {!current && !stage.done && parallel.length > 0 && (
                <div className="mt-1">
                  <ObjectiveList objectives={parallel} testId={`journal-parallel-${stage.id}`} />
                </div>
              )}
              {current && quest.hint && <p className="mt-1.5 text-xs italic text-slate-400">{quest.hint}</p>}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function CompletedQuest({ quest }: { quest: QuestView }) {
  return (
    <article data-testid={`journal-done-${quest.def.id}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
      <h3 className="text-sm font-bold text-slate-200">{quest.def.title}</h3>
      <p className="mt-1 text-xs text-emerald-300">
        Ukończone · nagroda {formatMoney(quest.def.reward.money)}
        {quest.def.reward.badge ? ` · odznaka ${BADGE_NAMES[quest.def.reward.badge] ?? quest.def.reward.badge}` : ""}
      </p>
    </article>
  );
}

export function JournalPanel({
  open,
  active,
  completed,
  badges,
  saveStatus,
  onSave,
  onClose,
}: {
  open: boolean;
  active: QuestView[];
  completed: QuestView[];
  badges: string[];
  saveStatus: SaveStatus;
  onSave: () => void;
  onClose: () => void;
}) {
  const saveLabel =
    saveStatus.kind === "saving"
      ? "Zapisywanie…"
      : saveStatus.kind === "error"
        ? `Błąd zapisu: ${saveStatus.error}`
        : saveStatus.lastAt
          ? `Ostatni zapis: ${formatTime(saveStatus.lastAt)}`
          : "Gra zapisuje się automatycznie.";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-white/10 bg-slate-900 text-white" data-testid="journal">
        <DialogHeader>
          <DialogTitle>Dziennik</DialogTitle>
          <DialogDescription className="text-slate-400">
            Aktywne zadania i cele. Czas gry stoi, dopóki dziennik jest otwarty. Zamknięcie: J lub Esc.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1">
          {active.length === 0 && (
            <p data-testid="journal-empty" className="rounded-xl bg-white/5 p-3 text-sm text-slate-300">
              Nie masz aktywnych zadań. Zajrzyj na tablicę ogłoszeń na placu (znak wykrzyknika oznacza nowe ogłoszenie).
            </p>
          )}
          {active.map((q) => (
            <ActiveQuest key={q.def.id} quest={q} />
          ))}
          {completed.length > 0 && (
            <section aria-label="Ukończone zadania" className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Ukończone</h4>
              {completed.map((q) => (
                <CompletedQuest key={q.def.id} quest={q} />
              ))}
            </section>
          )}
          {badges.length > 0 && (
            <p data-testid="journal-badges" className="text-xs text-amber-200">
              Odznaki: {badges.map((b) => BADGE_NAMES[b] ?? b).join(", ")}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <p
            data-testid="save-status"
            className={`min-w-0 flex-1 text-xs ${saveStatus.kind === "error" ? "text-red-300" : "text-slate-400"}`}
          >
            {saveLabel}
          </p>
          <Button data-testid="save-now" variant="secondary" size="sm" onClick={onSave} disabled={saveStatus.kind === "saving"}>
            Zapisz teraz
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
