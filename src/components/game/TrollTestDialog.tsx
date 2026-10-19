"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DialogOutcome } from "@/lib/npc/encounter";

/** Kwestia trolla w teście animacji. Prawdziwa zagadka (T1) zastąpi tylko ten komponent i źródło wyniku. */
export const TROLL_TEST_LINE = "Ho, ho! Kto ośmiela się zakłócać mój spokój? Myślisz, że potrafisz rozwiązać moją zagadkę?";

type Props = {
  open: boolean;
  /** Wynik dialogu: `correct` (PRAWIDŁOWY), `wrong` (ZŁY) albo `dismissed` (Esc, zamknięcie bez wyboru). */
  onOutcome: (outcome: DialogOutcome) => void;
};

/**
 * Testowe okno rozmowy z trollem po animacji Surprised. Jest celowo odseparowane od stanu gry: nie wysyła komend do
 * silnika, nie zna questa, skrzyni ani zapisu. Jedyny skutek wyboru to animacja i zachowanie trolla.
 */
export function TrollTestDialog({ open, onOutcome }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === "outside-press") {
          details.cancel();
          return;
        }
        onOutcome("dismissed");
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md border-emerald-200/30 bg-slate-900 text-white" data-testid="troll-test-dialog">
        <DialogHeader>
          <DialogTitle>Troll leśny</DialogTitle>
          <DialogDescription data-testid="troll-test-line" className="text-base leading-relaxed text-slate-100">
            {TROLL_TEST_LINE}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Button data-testid="troll-test-correct" onClick={() => onOutcome("correct")}>
            PRAWIDŁOWY
          </Button>
          <Button data-testid="troll-test-wrong" variant="destructive" onClick={() => onOutcome("wrong")}>
            ZŁY
          </Button>
        </div>
        <p className="text-xs text-slate-400">Test animacji trolla: wybór nie zmienia zadań, skrzyni, ekwipunku ani zapisu gry. Esc zamyka okno bez odpowiedzi.</p>
      </DialogContent>
    </Dialog>
  );
}
