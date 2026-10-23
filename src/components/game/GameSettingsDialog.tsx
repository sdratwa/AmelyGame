"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HintText } from "@/components/input/InputHint";
import { useGameSettings } from "@/components/input/hooks";
import { gameSettings } from "@/lib/settings/gameSettings";
import { preferredInitialFocus } from "@/lib/input/domNavigator";

function Toggle({ id, label, hint, on, onChange }: { id: string; label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm text-slate-200">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <Button type="button" variant={on ? "default" : "secondary"} aria-pressed={on} data-testid={`game-setting-${id}`} onClick={() => onChange(!on)} className="w-24 shrink-0">
        {on ? "Włączone" : "Wyłączone"}
      </Button>
    </div>
  );
}

/**
 * Ustawienia gry (podstawowe przełączniki). Zapis lokalny w przeglądarce, poza zapisem gry; zmiana działa od razu.
 * Kolejne funkcje dodajemy w `lib/settings/gameSettings.ts` i tutaj jako kolejne `Toggle`.
 */
export function GameSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useGameSettings();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-md border-white/10 bg-slate-900 text-white" data-testid="game-settings" initialFocus={preferredInitialFocus}>
        <DialogHeader>
          <DialogTitle>Ustawienia gry</DialogTitle>
          <DialogDescription className="text-slate-400">Zmiany działają od razu i są zapamiętane w tej przeglądarce.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Toggle
            id="player-names"
            label="Nazwy graczy"
            hint="Pokazuje nazwy innych graczy nad postaciami w multiplayerze."
            on={s.showPlayerNames}
            onChange={(v) => gameSettings.set({ showPlayerNames: v })}
          />
        </div>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="secondary" data-testid="game-settings-reset" onClick={() => gameSettings.reset()}>
            Domyślne
          </Button>
          <Button type="button" data-testid="game-settings-back" data-gamepad-initial="" onClick={onClose}>
            Wróć (<HintText action="cancel" fallback="Esc" />)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
