import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney, type QuestId, type QuestView } from "@/lib/game/engine";
import { ObjectiveList } from "./ObjectiveList";

function Reward({ quest }: { quest: QuestView }) {
  const { money, badge } = quest.def.reward;
  return (
    <p className="text-xs text-amber-200">
      Nagroda: <span className="font-semibold">{formatMoney(money)}</span>
      {badge ? " oraz odznaka Odkrywcy" : ""}
    </p>
  );
}

function BoardCard({ quest, onAccept }: { quest: QuestView; onAccept: (id: QuestId) => void }) {
  const preview = quest.def.preview;
  return (
    <article
      data-testid={`board-quest-${quest.def.id}`}
      data-status={quest.status}
      className={`rounded-xl border p-3 ${preview ? "border-white/5 bg-white/[0.03] opacity-60" : "border-amber-200/30 bg-amber-100/5"}`}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-amber-100">{quest.def.title}</h3>
        {quest.status === "active" && (
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">W toku</span>
        )}
        {quest.status === "completed" && (
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-200">Ukończone</span>
        )}
        {preview && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-300">Wkrótce</span>}
      </header>
      {!preview && <p className="mt-1.5 text-sm leading-snug text-slate-200">{quest.def.description}</p>}
      {preview && <p className="mt-1 text-xs text-slate-400">{quest.def.summary}</p>}
      {!preview && quest.status === "available" && (
        <>
          <div className="mt-2">
            <Reward quest={quest} />
          </div>
          <Button
            data-testid="accept-quest"
            onClick={() => onAccept(quest.def.id)}
            className="mt-3 h-10 w-full bg-amber-400 font-semibold text-amber-950 hover:bg-amber-300"
          >
            Przyjmij zadanie
          </Button>
        </>
      )}
      {quest.status === "active" && quest.stage && (
        <div className="mt-2 space-y-2">
          <p className="text-xs font-semibold text-slate-300">
            Etap {quest.progress.currentStage + 1}/{quest.def.stages.length}: {quest.stage.title}
          </p>
          <ObjectiveList objectives={quest.objectives} />
          <p className="text-xs text-slate-400">Postęp znajdziesz w dzienniku (J).</p>
        </div>
      )}
      {quest.status === "completed" && <div className="mt-2"><Reward quest={quest} /></div>}
    </article>
  );
}

export function QuestBoardDialog({
  open,
  quests,
  onClose,
  onRead,
  onAccept,
}: {
  open: boolean;
  quests: QuestView[];
  onClose: () => void;
  onRead: (id: QuestId) => void;
  onAccept: (id: QuestId) => void;
}) {
  const unread = quests.filter((q) => q.status === "available" && !q.read).map((q) => q.def.id);
  const unreadKey = unread.join(",");
  useEffect(() => {
    if (!open) return;
    for (const id of unreadKey ? (unreadKey.split(",") as QuestId[]) : []) onRead(id);
  }, [open, unreadKey, onRead]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg border-amber-900/40 bg-slate-900 text-white" data-testid="board-dialog">
        <DialogHeader>
          <DialogTitle>Tablica ogłoszeń</DialogTitle>
          <DialogDescription className="text-slate-400">
            Mieszkańcy szukają pomocy. Czas gry stoi, dopóki czytasz.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {quests.map((q) => (
            <BoardCard key={q.def.id} quest={q} onAccept={onAccept} />
          ))}
        </div>
        <Button variant="secondary" onClick={onClose}>
          Zamknij
        </Button>
      </DialogContent>
    </Dialog>
  );
}
