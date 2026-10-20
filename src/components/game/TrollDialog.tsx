"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RIDDLE_BY_ID } from "@/lib/game/content/riddles";
import type { DialogState } from "@/lib/game/core/state";
import { preferredInitialFocus } from "@/lib/input/domNavigator";
import { HintText } from "@/components/input/InputHint";
import { PadKeyboard } from "@/components/input/PadKeyboard";

export const TROLL_INTRO_LINE = "Hola, hola! Dokąd to? Ta skrzynia jest pod moją opieką.";

export type TrollDialogProps = {
  /** Rozmowa ze stanu gry (`state.dialog`); null = brak rozmowy z silnikiem. */
  dialog: DialogState | null;
  /** Krótka kwestia bez wyboru (np. skrzynia już otwarta): okno z jednym przyciskiem. */
  message: string | null;
  onChoose: (choice: "fight" | "talk") => void;
  onAnswer: (value: number) => void;
  /** Zamknięcie bez wyboru (Esc, "Odejdź"). */
  onClose: () => void;
};

/**
 * Prawdziwa rozmowa z trollem (T1). Komponent niczego nie rozstrzyga: wybory i odpowiedzi trafiają do silnika
 * (`troll.choose`, `riddle.answer`, `dialog.close`), który sprawdza poprawność i nakłada blokady.
 */
export function TrollDialog({ dialog, message, onChoose, onAnswer, onClose }: TrollDialogProps) {
  const open = dialog !== null || message !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === "outside-press") {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md border-emerald-200/30 bg-slate-900 text-white" data-testid="troll-dialog" initialFocus={preferredInitialFocus}>
        {dialog?.stage === "intro" && <IntroView onChoose={onChoose} onClose={onClose} />}
        {dialog?.stage === "riddle" && dialog.riddle && <RiddleView key={dialog.riddle} riddleId={dialog.riddle} onAnswer={onAnswer} onClose={onClose} />}
        {!dialog && message && (
          <>
            <DialogHeader>
              <DialogTitle>Troll leśny</DialogTitle>
              <DialogDescription data-testid="troll-message" className="text-base leading-relaxed text-slate-100">
                {message}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button data-testid="troll-ok" onClick={onClose}>
                Dobrze
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function IntroView({ onChoose, onClose }: { onChoose: (c: "fight" | "talk") => void; onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Troll leśny</DialogTitle>
        <DialogDescription data-testid="troll-line" className="text-base leading-relaxed text-slate-100">
          {TROLL_INTRO_LINE}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Button data-testid="troll-choose-fight" variant="destructive" onClick={() => onChoose("fight")}>
          Spróbuję cię pokonać!
        </Button>
        <Button data-testid="troll-choose-talk" data-gamepad-initial="" onClick={() => onChoose("talk")}>
          Może się dogadamy?
        </Button>
      </div>
      <button type="button" data-testid="troll-leave" onClick={onClose} className="text-left text-xs text-slate-400 underline-offset-2 hover:underline">
        Odejdź bez rozmowy (<HintText action="cancel" fallback="Esc" />)
      </button>
    </>
  );
}

function RiddleView({ riddleId, onAnswer, onClose }: { riddleId: string; onAnswer: (value: number) => void; onClose: () => void }) {
  const riddle = RIDDLE_BY_ID.get(riddleId);
  const [text, setText] = useState("");
  const [hint, setHint] = useState(false);
  const trimmed = text.trim();
  const value = /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
  const submit = () => {
    if (value !== null) onAnswer(value);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Zagadka trolla</DialogTitle>
        <DialogDescription data-testid="troll-riddle" className="text-base leading-relaxed text-slate-100">
          {riddle?.text ?? "Troll zapomniał zagadki."}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="text-xs text-slate-300" htmlFor="troll-answer">
          Twoja odpowiedź (liczba):
        </label>
        <input
          id="troll-answer"
          data-testid="troll-answer"
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="rounded-md border border-white/20 bg-slate-950 px-3 py-2 text-lg text-white outline-none focus:border-emerald-300"
        />
        <Button data-testid="troll-submit" type="submit" disabled={value === null}>
          Odpowiadam
        </Button>
      </form>
      <PadKeyboard mode="digits" value={text} maxLength={9} onChange={setText} />
      {hint && riddle && (
        <p data-testid="troll-hint" className="rounded-md bg-white/5 p-2 text-xs text-slate-200">
          Podpowiedź: {riddle.hint}
        </p>
      )}
      <div className="flex items-center justify-between">
        <button type="button" data-testid="troll-hint-toggle" onClick={() => setHint(true)} className="text-xs text-amber-200 underline-offset-2 hover:underline">
          Podpowiedź
        </button>
        <button type="button" data-testid="troll-leave" onClick={onClose} className="text-xs text-slate-400 underline-offset-2 hover:underline">
          Odejdź (<HintText action="cancel" fallback="Esc" />)
        </button>
      </div>
      <p className="text-xs text-slate-400">Błędna odpowiedź: troll prosi, abyś wrócił za godzinę czasu gry.</p>
    </>
  );
}
