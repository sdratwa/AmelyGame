"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { View } from "@/lib/game/engine";
import { preferredInitialFocus } from "@/lib/input/domNavigator";
import { HintText } from "@/components/input/InputHint";

/**
 * Menu gry (OPTIONS / MENU na padzie albo przycisk "Menu"): wznowienie, ustawienia gry i kontrolera, zapis i powrót do miasta.
 * Zegar stoi, dopóki menu jest otwarte (powód pauzy dodaje `GameApp`). To jedyna droga wyjścia z lasu padem.
 */
export function PauseMenu({
  open,
  view,
  onResume,
  onSettings,
  onGameSettings,
  onSave,
  onLeave,
  canLeave = true,
  resign,
}: {
  open: boolean;
  view: View;
  onResume: () => void;
  onSettings: () => void;
  onGameSettings: () => void;
  onSave: () => void;
  onLeave: () => void;
  /** Uczestnik zabawy w chowanego nie wychodzi z lasu (najpierw rezygnuje). */
  canLeave?: boolean;
  /** Przycisk rezygnacji z zabawy w chowanego (null = brak zabawy). */
  resign?: { label: string; onPress: () => void } | null;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onResume()}>
      <DialogContent showCloseButton={false} className="max-w-xs border-white/10 bg-slate-900 text-white" data-testid="pause-menu" initialFocus={preferredInitialFocus}>
        <DialogHeader>
          <DialogTitle>Menu gry</DialogTitle>
          <DialogDescription className="text-slate-400">
            Czas gry stoi. Zamknięcie: <HintText action="pause" fallback="Esc" /> lub <HintText action="cancel" fallback="Esc" />.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button data-testid="pause-resume" data-gamepad-initial="" onClick={onResume}>
            Wznów grę
          </Button>
          <Button data-testid="pause-game-settings" variant="secondary" onClick={onGameSettings}>
            Ustawienia gry
          </Button>
          <Button data-testid="pause-settings" variant="secondary" onClick={onSettings}>
            Ustawienia kontrolera
          </Button>
          <Button data-testid="pause-save" variant="secondary" onClick={onSave}>
            Zapisz teraz
          </Button>
          {resign && (
            <Button data-testid="pause-hideseek-resign" variant="secondary" onClick={resign.onPress}>
              {resign.label}
            </Button>
          )}
          {view !== "world" && canLeave && (
            <Button data-testid="pause-leave" variant="secondary" onClick={onLeave}>
              Wróć do miasta
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
