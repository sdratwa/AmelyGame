"use client";

import type { ReactNode } from "react";
import { Map as MapIcon, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Rozmiar minimapy na telefonie (px) i miejsce zarezerwowane w prawym dolnym rogu (musi pasować do `TouchControls`). */
export const TOUCH_MINIMAP_SIZE = 104;

/**
 * Minimapa telefonu w prawym dolnym rogu z własnym przełącznikiem. Zwinięta zostaje sama ikona (róg jest stale
 * zarezerwowany, więc przyciski akcji nie "skaczą"). Sama mapa nie przechwytuje dotyku; przycisk tak.
 */
export function TouchMinimap({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div
      data-testid="touch-minimap"
      className="pointer-events-none absolute z-20"
      style={{ right: "max(0.5rem, var(--sar))", bottom: "max(0.5rem, var(--sab))" }}
    >
      <div className="relative" style={on ? { width: TOUCH_MINIMAP_SIZE, height: TOUCH_MINIMAP_SIZE } : undefined}>
        {on && children}
        <button
          type="button"
          data-testid="touch-minimap-toggle"
          aria-label={on ? "Ukryj minimapę" : "Pokaż minimapę"}
          aria-pressed={on}
          onClick={onToggle}
          className={cn(
            "pointer-events-auto flex size-9 items-center justify-center rounded-full text-white backdrop-blur-sm active:bg-white/40",
            on ? "absolute left-1 top-1 bg-slate-900/60" : "bg-slate-900/60",
          )}
        >
          {on ? <MapPinOff className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
