"use client";

import { useState } from "react";
import { Settings, X } from "lucide-react";
import type { QualityId } from "@/lib/assets";
import { TOUCH_SETTING_LIMITS, touchSettings } from "@/lib/input/touchSettings";
import { useGameSettings, useTouchSettings } from "@/components/input/hooks";
import { gameSettings } from "@/lib/settings/gameSettings";
import { cn } from "@/lib/utils";
import { AudioControls } from "../AudioControls";

const QUALITIES: readonly { id: QualityId; label: string }[] = [
  { id: "LOW", label: "Niska" },
  { id: "MEDIUM", label: "Średnia" },
  { id: "HIGH", label: "Wysoka" },
];

/**
 * Jeden mały chip "ustawienia widoku" zamiast stosu przycisków w rogu lasu: powrót do miasta, jakość grafiki, dźwięk,
 * minimapa i czułość kamery dotykowej. Zamknięty zajmuje na ekranie tylko ikonę.
 */
export function TouchForestMenu({
  quality,
  onQualityChange,
  minimap,
  onToggleMinimap,
  onLeave,
  top,
}: {
  quality: QualityId;
  onQualityChange: (q: QualityId) => void;
  minimap: boolean;
  onToggleMinimap: () => void;
  onLeave: () => void;
  /** Odstęp od góry (pod HUD i kapsułką statusu). */
  top: string;
}) {
  const [open, setOpen] = useState(false);
  const prefs = useTouchSettings();
  const game = useGameSettings();
  const l = TOUCH_SETTING_LIMITS.lookSensitivity;

  return (
    <div className="pointer-events-none absolute z-20 flex flex-col items-start gap-1" style={{ top, left: "max(0.5rem, var(--sal))" }}>
      <button
        type="button"
        data-testid="touch-menu-toggle"
        aria-label={open ? "Zamknij ustawienia widoku" : "Ustawienia widoku"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "pointer-events-auto flex size-8 items-center justify-center rounded-full text-slate-100 backdrop-blur-sm active:bg-white/30",
          open ? "bg-emerald-500 text-emerald-950" : "bg-slate-900/60",
        )}
      >
        {open ? <X className="size-4" aria-hidden /> : <Settings className="size-4" aria-hidden />}
      </button>
      {open && (
        <div
          data-testid="touch-menu-panel"
          className="pointer-events-auto max-h-[60dvh] w-60 space-y-2 overflow-y-auto rounded-xl bg-slate-900/80 p-2 text-xs text-white backdrop-blur-md"
        >
          <button
            type="button"
            data-testid="leave-forest"
            onClick={onLeave}
            className="h-9 w-full rounded-lg bg-white/15 font-semibold active:bg-white/30"
          >
            ← Wróć do miasta
          </button>
          <div role="group" aria-label="Jakość grafiki lasu" className="flex items-center gap-1 rounded-lg bg-black/30 p-1">
            {QUALITIES.map((q) => (
              <button
                key={q.id}
                type="button"
                data-testid={`quality-${q.id}`}
                aria-pressed={quality === q.id}
                onClick={() => onQualityChange(q.id)}
                className={cn("h-8 flex-1 rounded font-medium", quality === q.id ? "bg-emerald-500 text-emerald-950" : "text-slate-200 active:bg-white/20")}
              >
                {q.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="touch-menu-minimap"
            aria-pressed={minimap}
            onClick={onToggleMinimap}
            className={cn("h-9 w-full rounded-lg font-semibold", minimap ? "bg-emerald-500 text-emerald-950" : "bg-white/15 active:bg-white/30")}
          >
            Minimapa: {minimap ? "włączona" : "wyłączona"}
          </button>
          <button
            type="button"
            data-testid="touch-menu-player-names"
            aria-pressed={game.showPlayerNames}
            onClick={() => gameSettings.set({ showPlayerNames: !game.showPlayerNames })}
            className={cn("h-9 w-full rounded-lg font-semibold", game.showPlayerNames ? "bg-emerald-500 text-emerald-950" : "bg-white/15 active:bg-white/30")}
          >
            Nazwy graczy: {game.showPlayerNames ? "włączone" : "wyłączone"}
          </button>
          <label className="block">
            <span className="mb-0.5 flex justify-between text-slate-200">
              Czułość kamery
              <span className="tabular-nums">{prefs.lookSensitivity.toFixed(1)}×</span>
            </span>
            <input
              type="range"
              data-testid="touch-look-sensitivity"
              min={l.min}
              max={l.max}
              step={l.step}
              value={prefs.lookSensitivity}
              onChange={(e) => touchSettings.set({ lookSensitivity: Number(e.target.value) })}
              className="h-8 w-full accent-emerald-400"
            />
          </label>
          <AudioControls />
        </div>
      )}
    </div>
  );
}
