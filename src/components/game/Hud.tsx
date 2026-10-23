"use client";

import { LanternBarSlot } from "./LanternControl";
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
import { HintText, InputHint } from "@/components/input/InputHint";

const SEASON_EMOJI: Record<Season, string> = {
  winter: "❄️",
  spring: "🌱",
  summer: "☀️",
  autumn: "🍂",
};

export function TopBar({
  state,
  sheltered,
  onOpenJournal,
  onOpenMenu,
  floating = false,
}: {
  state: GameState;
  sheltered: boolean;
  onOpenJournal: () => void;
  onOpenMenu: () => void;
  /** Las na komputerze: bez granatowego paska, tylko półprzezroczyste kapsułki nałożone na grę (jak na telefonie). */
  floating?: boolean;
}) {
  const clock = getClock(state.worldElapsed ?? state.elapsed);
  const pct = Math.round((state.health / MAX_HEALTH) * 100);
  const cold = clock.season === "winter" && !sheltered;
  const low = pct <= 25;
  const chip = floating ? "bg-slate-900/60 backdrop-blur-sm" : "bg-white/10";

  return (
    <header
      data-testid="top-bar"
      data-floating={floating}
      className={cn(
        "flex items-start justify-between gap-3 px-3 py-2 sm:px-5",
        floating
          ? "pointer-events-none absolute inset-x-0 top-0 z-30 py-2 sm:py-2"
          : "z-20 shrink-0 border-b border-white/10 bg-slate-900/90 backdrop-blur sm:py-3",
      )}
    >
      <div className={cn("min-w-0 flex-1 sm:max-w-xs", floating && "sm:max-w-[16rem]")}>
        <div className={cn("flex items-center gap-2", floating && "rounded-full bg-slate-900/60 px-2.5 py-1 backdrop-blur-sm")}>
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
        <div className={cn("text-xs font-medium", floating ? "mt-1" : "mt-1 h-5")} data-testid="status-line">
          {sheltered ? (
            <span className={cn("text-emerald-300", floating && "rounded-full bg-slate-900/60 px-2 py-0.5 backdrop-blur-sm")}>🏠 Schronienie – życie nie spada</span>
          ) : cold ? (
            <span className={cn("text-sky-300", floating && "rounded-full bg-slate-900/60 px-2 py-0.5 backdrop-blur-sm")}>🥶 Jest zimno</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 text-sm sm:flex-row sm:items-center sm:gap-4">
        <div
          data-testid="wallet"
          className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold tabular-nums text-amber-200", floating ? "bg-slate-900/60 backdrop-blur-sm" : "bg-amber-400/15")}
        >
          <span aria-hidden>👛</span>
          {formatMoney(state.wallet)}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-200 sm:text-sm">
          <span data-testid="daytime" className={cn("flex items-center gap-1 rounded-full px-2.5 py-1", chip)}>
            <span aria-hidden>{clock.isDay ? "☀️" : "🌙"}</span>
            {clock.isDay ? "Dzień" : "Noc"} {formatClock(clock)}
          </span>
          <span data-testid="season" className={cn("flex items-center gap-1 rounded-full px-2.5 py-1", chip)}>
            <span aria-hidden>{SEASON_EMOJI[clock.season]}</span>
            {SEASON_LABEL[clock.season]}
            <span className="hidden text-slate-400 sm:inline">· dzień {clock.dayInSeason}/30</span>
          </span>
          <span data-testid="year" className={cn("rounded-full px-2.5 py-1 font-semibold tabular-nums", chip)}>
            {clock.year}
          </span>
          <button
            type="button"
            data-testid="open-journal"
            onClick={onOpenJournal}
            aria-label="Dziennik (J)"
            className={cn("pointer-events-auto flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-amber-100 transition", floating ? "bg-slate-900/60 backdrop-blur-sm hover:bg-slate-800/80" : "bg-amber-400/20 hover:bg-amber-400/30")}
          >
            <span aria-hidden>📖</span>
            Dziennik <InputHint action="journal" className="hidden bg-black/30 sm:inline" />
          </button>
          <button
            type="button"
            data-testid="open-menu"
            onClick={onOpenMenu}
            aria-label="Menu gry"
            className={cn("pointer-events-auto flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold text-slate-100 transition", floating ? "bg-slate-900/60 backdrop-blur-sm hover:bg-slate-800/80" : "bg-white/10 hover:bg-white/20")}
          >
            <span aria-hidden>☰</span>
            Menu <InputHint action="pause" className="hidden bg-black/30 sm:inline" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function InventoryBar({
  state,
  onSelect,
  onEat,
  onToggleLantern,
  inForest,
  floating = false,
}: {
  state: GameState;
  onSelect: (slot: number) => void;
  onEat: () => void;
  onToggleLantern: () => void;
  /** Klawisz L działa tylko w lesie, więc tylko tam pokazujemy jego podpowiedź. */
  inForest: boolean;
  /** Las na komputerze: mały półprzezroczysty panel na dole ekranu zamiast paska na całą szerokość. */
  floating?: boolean;
}) {
  const selectedId = state.slots[state.selected]?.id ?? null;
  const selectedItem = selectedId ? ITEMS[selectedId] : null;
  const canEat = !!selectedItem && selectedItem.heal > 0 && !state.dead;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.target instanceof HTMLInputElement) return;
      if (e.key >= "1" && e.key <= "8") onSelect(Number(e.key) - 1);
      if ((e.key === "e" || e.key === "E") && canEat) onEat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect, onEat, canEat]);

  return (
    <footer
      data-testid="inventory"
      data-floating={floating}
      className={cn(
        floating
          ? "absolute bottom-3 left-1/2 z-30 w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-white/15 bg-slate-900/60 px-2.5 pb-2.5 pt-1.5 shadow-xl backdrop-blur-sm"
          : "relative z-20 shrink-0 border-t border-white/10 bg-slate-900/90 px-3 pb-3 pt-2 backdrop-blur sm:px-5",
      )}
    >
      <div className={cn("mx-auto mb-2 flex max-w-xl items-center justify-between gap-3 text-xs sm:text-sm", floating ? "min-h-6" : "h-9")}>
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
            Zjedz (<HintText action="interact" fallback="E" />) +{selectedItem.heal}%
          </button>
        )}
      </div>
      <div className={cn("mx-auto flex items-center gap-3", floating ? "max-w-[28rem]" : "max-w-[41rem]")}>
      <div className="grid min-w-0 flex-1 grid-cols-8 gap-1.5 sm:gap-2" role="list" aria-label="Ekwipunek">
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
              {item ? <span aria-hidden>{item.emoji}</span> : null}
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
      <div className="h-9 w-px shrink-0 bg-white/15" aria-hidden />
      <LanternBarSlot enabled={state.lantern.enabled} disabled={state.dead} onToggle={onToggleLantern} showHint={inForest} />
      </div>
    </footer>
  );
}
