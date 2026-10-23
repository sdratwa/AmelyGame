"use client";

import { memo, useReducer } from "react";
import { Backpack, ChevronDown, ChevronUp, X } from "lucide-react";
import { INVENTORY_SLOTS, ITEMS, type GameState } from "@/lib/game/engine";
import { cn } from "@/lib/utils";
import { LanternDrawerRow } from "../LanternControl";
import { drawerReducer, isInventoryEmpty } from "./inventoryDrawer";

type Props = {
  slots: GameState["slots"];
  selected: number;
  dead: boolean;
  onSelect: (slot: number) => void;
  onEat: () => void;
  /** Otwiera pełną listę rzeczy (istniejące okno ekwipunku). */
  onOpenFull: () => void;
  /** Lampa naftowa: stałe wyposażenie, osobne od miejsc na przedmioty. */
  lanternOn: boolean;
  onToggleLantern: () => void;
  /** W pionie przycisk jest podniesiony nad sterowanie dotykowe (tylko las). */
  aboveControls: boolean;
};

const EDGE_B = "max(0.75rem, var(--sab))";

/**
 * Wysuwany plecak telefonu. Domyślnie widać tylko mały przycisk; po dotknięciu pojawia się półprzezroczysty panel
 * "mini" (jeden rząd slotów), który można rozwinąć. Pusty ekwipunek to jedna linia, bez rzędu pustych slotów. Stan
 * otwarcia jest lokalny (nie należy do zapisu gry); wyboru slotu i jedzenia dokonuje ten sam silnik co na desktopie.
 */
export const MobileInventoryDrawer = memo(function MobileInventoryDrawer({ slots, selected, dead, onSelect, onEat, onOpenFull, lanternOn, onToggleLantern, aboveControls }: Props) {
  const [mode, act] = useReducer(drawerReducer, "closed");
  const selectedId = slots[selected]?.id ?? null;
  const selectedItem = selectedId ? ITEMS[selectedId] : null;
  const canEat = !!selectedItem && selectedItem.heal > 0 && !dead;
  const empty = isInventoryEmpty(slots);

  if (mode === "closed") {
    // Schowany plecak: sama ikona, dolny środek ekranu (między joystickiem a przyciskami akcji).
    return (
      <button
        type="button"
        data-testid="inventory-toggle"
        aria-label="Plecak"
        aria-expanded={false}
        onClick={() => act("toggle")}
        className="absolute left-1/2 z-30 flex size-11 -translate-x-1/2 items-center justify-center rounded-full border border-white/25 bg-slate-900/60 text-white shadow-lg backdrop-blur-sm active:scale-95 active:bg-white/30"
        style={{ bottom: EDGE_B }}
      >
        <Backpack className="size-6" aria-hidden />
      </button>
    );
  }

  const expanded = mode === "expanded";
  return (
    <section
      data-testid="inventory"
      data-mode={mode}
      aria-label="Plecak"
      className={cn(
        "absolute left-1/2 z-30 w-[min(32rem,calc(100%-1rem))] -translate-x-1/2 overflow-y-auto rounded-2xl border border-white/15 bg-slate-900/80 p-2 text-white shadow-xl backdrop-blur-md duration-150 animate-in fade-in slide-in-from-bottom-4",
        expanded ? "max-h-[60dvh]" : "max-h-[40dvh]",
        aboveControls && "portrait:mb-36",
      )}
      style={{ bottom: EDGE_B }}
    >
      <LanternDrawerRow enabled={lanternOn} disabled={dead} onToggle={onToggleLantern} />
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-xs">
          {empty ? (
            <span className="text-slate-300">Plecak pusty</span>
          ) : selectedItem ? (
            <>
              <span className="font-semibold">{selectedItem.name}</span>
              {expanded && <span className="text-slate-300"> – {selectedItem.description}</span>}
            </>
          ) : (
            <span className="text-slate-300">Pusty slot</span>
          )}
        </p>
        {canEat && (
          <button
            type="button"
            data-testid="eat-button"
            onClick={onEat}
            className="h-9 shrink-0 rounded-full bg-emerald-500 px-3 text-xs font-semibold text-emerald-950 active:bg-emerald-300"
          >
            Zjedz +{selectedItem.heal}%
          </button>
        )}
        {!empty && (
          <button
            type="button"
            data-testid="inventory-expand"
            aria-label={expanded ? "Zwiń plecak" : "Rozwiń plecak"}
            aria-expanded={expanded}
            onClick={() => act("toggleExpand")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 active:bg-white/30"
          >
            {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronUp className="size-4" aria-hidden />}
          </button>
        )}
        <button
          type="button"
          data-testid="inventory-close"
          aria-label="Zamknij plecak"
          onClick={() => act("close")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 active:bg-white/30"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {!empty && (
        <div className="grid grid-cols-8 gap-1" role="list" aria-label="Ekwipunek">
          {Array.from({ length: INVENTORY_SLOTS }, (_, i) => {
            const stack = slots[i];
            const id = stack?.id ?? null;
            const item = id ? ITEMS[id] : null;
            return (
              <button
                key={i}
                type="button"
                role="listitem"
                data-testid={`slot-${i}`}
                data-item={id ?? ""}
                onClick={() => onSelect(i)}
                aria-label={item ? `Slot ${i + 1}: ${item.name}` : `Slot ${i + 1}: pusty`}
                className={cn(
                  "relative flex aspect-square items-center justify-center rounded-lg border-2 bg-slate-800/70",
                  expanded ? "text-2xl" : "text-lg",
                  i === selected ? "border-amber-300" : "border-slate-600/70",
                )}
              >
                {item ? <span aria-hidden>{item.emoji}</span> : null}
                {stack && stack.count > 1 && (
                  <span data-testid={`slot-${i}-count`} className="absolute bottom-0 right-0.5 text-[10px] font-bold">
                    {stack.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {expanded && (
        <button
          type="button"
          data-testid="inventory-open-full"
          onClick={onOpenFull}
          className="mt-2 h-9 w-full rounded-full bg-white/10 text-xs font-semibold active:bg-white/30"
        >
          Pełna lista rzeczy
        </button>
      )}
    </section>
  );
});
