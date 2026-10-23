"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HintText } from "@/components/input/InputHint";
import { useGameSettings } from "@/components/input/hooks";
import { gameSettings } from "@/lib/settings/gameSettings";
import type { MultiplayerClient } from "@/lib/multiplayer/client";
import { SEEK_MINUTES } from "@/lib/hideseek/config";
import { hideSeekDevConfig } from "@/lib/hideseek/devConfig";
import { useHideSeekView } from "./hideseek/useHideSeek";
import { preferredInitialFocus } from "@/lib/input/domNavigator";

function Toggle({ id, label, hint, on, onChange, disabled }: { id: string; label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm text-slate-200">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <Button type="button" variant={on ? "default" : "secondary"} aria-pressed={on} disabled={disabled} data-testid={`game-setting-${id}`} onClick={() => onChange(!on)} className="w-24 shrink-0">
        {on ? "Włączone" : "Wyłączone"}
      </Button>
    </div>
  );
}

/**
 * Ustawienia gry (podstawowe przełączniki). Zapis lokalny w przeglądarce, poza zapisem gry; zmiana działa od razu.
 * Kolejne funkcje dodajemy w `lib/settings/gameSettings.ts` i tutaj jako kolejne `Toggle`.
 */
export function GameSettingsDialog({ open, onClose, multiplayer, inForest = false, onHideSeekAction }: { open: boolean; onClose: () => void; multiplayer?: MultiplayerClient; inForest?: boolean; /** Zabawa w chowanego wystartowała albo czeka na potwierdzenie anulowania: zamknij ustawienia, żeby było ją widać. */ onHideSeekAction?: () => void }) {
  const s = useGameSettings();
  const hsView = useHideSeekView(multiplayer);
  const hsOn = hsView !== null && hsView.you.isHost && (hsView.phase === "INVITING" || hsView.phase === "HIDING" || hsView.phase === "SEEKING");
  const online = !!multiplayer && multiplayer.status === "połączony";
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
          <Toggle
            id="hide-seek"
            label="Zabawa w chowanego"
            hint={online ? (inForest ? "Zaprasza innych graczy w lesie. Ty będziesz szukać. Wyłączenie w trakcie zabawy wymaga potwierdzenia." : "Wejdź do lasu, aby zacząć zabawę.") : "Dostępne w grze online."}
            on={hsOn}
            disabled={!online || (!hsOn && !inForest)}
            onChange={(v) => {
              if (!multiplayer) return;
              if (v) multiplayer.hsStart(s.hideSeekMinutes, hideSeekDevConfig.get());
              else multiplayer.hs.askConfirm("cancel");
              onHideSeekAction?.();
            }}
          />
          <div className="space-y-1">
            <label htmlFor="hide-seek-minutes" className="flex items-center justify-between text-sm text-slate-200">
              <span>Czas poszukiwań</span>
              <span data-testid="hide-seek-minutes-value" className="tabular-nums">{s.hideSeekMinutes} min</span>
            </label>
            <input
              id="hide-seek-minutes"
              data-testid="game-setting-hide-seek-minutes"
              type="range"
              min={SEEK_MINUTES.min}
              max={SEEK_MINUTES.max}
              step={SEEK_MINUTES.step}
              value={s.hideSeekMinutes}
              disabled={hsOn}
              onChange={(e) => gameSettings.set({ hideSeekMinutes: Number(e.target.value) })}
              className="w-full accent-emerald-400"
            />
            <span className="block text-xs text-slate-400">Od 1 do 15 minut (domyślnie 5). Obowiązuje od następnej zabawy.</span>
          </div>
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
