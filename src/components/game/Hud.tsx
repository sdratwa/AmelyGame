"use client";

import { useEffect } from "react";
import {
  ITEMS,
  INVENTORY_SLOTS,
  MAX_HEALTH,
  SEASON_LABEL,
  formatClock,
  formatMoney,
  getClock,
  type GameState,
  type Season,
} from "@/lib/game/engine";
import { cn } from "@/lib/utils";
import { PhoneIcon } from "./art";

const SEASON_EMOJI: Record<Season, string> = {
  winter: "❄️",
  spring: "🌱",
  summer: "☀️",
  autumn: "🍂",
};

export function TopBar({
  state,
  sheltered,
}: {
  state: GameState;
  sheltered: boolean;
}) {
  const clock = getClock(state.elapsed);
  const pct = Math.round((state.health / MAX_HEALTH) * 100);
  const cold = clock.season === "winter" && !sheltered;
  const low = pct <= 25;

  return (
    <header
      data-testid="top-bar"
      className="z-20 flex shrink-0 items-start justify-between gap-3 border-b border-white/10 bg-slate-900/90 px-3 py-2 backdrop-blur sm:px-5 sm:py-3"
    >
      <div className="min-w-0 flex-1 sm:max-w-xs">
        <div className="flex items-center gap-2">
          <span className={cn("text-lg", low && "animate-pulse")} aria-hidden>
            ❤️
          </span>
          <div
            className="h-3.5 flex-1 overflow-hidden rounded-full bg-slate-700"
            role="progressbar"
            aria-label="Poziom życia"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                low ? "bg-red-500" : pct <= 50 ? "bg-amber-400" : "bg-emerald-400",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span data-testid="health" className="w-12 text-right text-sm font-semibold tabular-nums">
            {pct}%
          </span>
        </div>
        <div className="mt-1 h-5 text-xs font-medium" data-testid="status-line">
          {sheltered ? (
            <span className="text-emerald-300">🏠 Schronienie – życie nie spada</span>
          ) : cold ? (
            <span className="text-sky-300">🥶 Jest zimno</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 text-sm sm:flex-row sm:items-center sm:gap-4">
        <div
          data-testid="wallet"
          className="flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 font-semibold tabular-nums text-amber-200"
        >
          <span aria-hidden>👛</span>
          {formatMoney(state.wallet)}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-200 sm:text-sm">
          <span data-testid="daytime" className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
            <span aria-hidden>{clock.isDay ? "☀️" : "🌙"}</span>
            {clock.isDay ? "Dzień" : "Noc"} {formatClock(clock)}
          </span>
          <span data-testid="season" className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
            <span aria-hidden>{SEASON_EMOJI[clock.season]}</span>
            {SEASON_LABEL[clock.season]}
            <span className="hidden text-slate-400 sm:inline">· dzień {clock.dayInSeason}/30</span>
          </span>
          <span data-testid="year" className="rounded-full bg-white/10 px-2.5 py-1 font-semibold tabular-nums">
            {clock.year}
          </span>
        </div>
      </div>
    </header>
  );
}

export function InventoryBar({
  state,
  onSelect,
  onEat,
}: {
  state: GameState;
  onSelect: (slot: number) => void;
  onEat: () => void;
}) {
  const selectedId = state.slots[state.selected]?.id ?? null;
  const selectedItem = selectedId ? ITEMS[selectedId] : null;
  const canEat = !!selectedItem && selectedItem.heal > 0 && !state.dead;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key >= "1" && e.key <= "8") onSelect(Number(e.key) - 1);
      if ((e.key === "e" || e.key === "E") && canEat) onEat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect, onEat, canEat]);

  return (
    <footer
      data-testid="inventory"
      className="relative z-20 shrink-0 border-t border-white/10 bg-slate-900/90 px-3 pb-3 pt-2 backdrop-blur sm:px-5"
    >
      <div className="mx-auto mb-2 flex h-9 max-w-xl items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="min-w-0 truncate text-slate-300">
          {selectedItem ? (
            <>
              <span className="font-semibold text-white">{selectedItem.name}</span>
              <span className="text-slate-400"> – {selectedItem.description}</span>
            </>
          ) : (
            <span className="text-slate-400">Pusty slot</span>
          )}
        </div>
        {canEat && (
          <button
            data-testid="eat-button"
            onClick={onEat}
            className="shrink-0 rounded-full bg-emerald-500 px-3.5 py-1.5 font-semibold text-emerald-950 transition hover:bg-emerald-400 active:scale-95"
          >
            Zjedz (E) +{selectedItem.heal}%
          </button>
        )}
      </div>
      <div className="mx-auto grid max-w-xl grid-cols-8 gap-1.5 sm:gap-2" role="list" aria-label="Ekwipunek">
        {Array.from({ length: INVENTORY_SLOTS }, (_, i) => {
          const stack = state.slots[i];
          const id = stack?.id ?? null;
          const item = id ? ITEMS[id] : null;
          const active = i === state.selected;
          return (
            <button
              key={i}
              role="listitem"
              data-testid={`slot-${i}`}
              data-item={id ?? ""}
              onClick={() => onSelect(i)}
              aria-label={item ? `Slot ${i + 1}: ${item.name}` : `Slot ${i + 1}: pusty`}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-lg border-2 bg-slate-800 text-xl transition sm:text-3xl",
                active
                  ? "border-amber-300 shadow-[0_0_0_2px_rgba(252,211,77,0.25)]"
                  : "border-slate-600 hover:border-slate-400",
              )}
            >
              <span className="absolute left-1 top-0.5 text-[9px] font-medium text-slate-500 sm:text-[10px]">
                {i + 1}
              </span>
              {id === "item.phone" ? (
                <PhoneIcon className="h-3/5" />
              ) : item ? (
                <span aria-hidden>{item.emoji}</span>
              ) : null}
              {stack && stack.count > 1 && (
                <span
                  data-testid={`slot-${i}-count`}
                  className="absolute bottom-0.5 right-1 text-[10px] font-bold text-white sm:text-xs"
                >
                  {stack.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </footer>
  );
}
