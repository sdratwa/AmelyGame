"use client";

import { memo } from "react";
import { BookOpen, Menu } from "lucide-react";
import { formatMoney, SEASON_LABEL, type Season } from "@/lib/game/engine";
import type { MultiplayerClient } from "@/lib/multiplayer/client";
import { cn } from "@/lib/utils";
import { OnlineChip } from "./OnlineChip";

const SEASON_EMOJI: Record<Season, string> = { winter: "❄️", spring: "🌱", summer: "☀️", autumn: "🍂" };

const CHIP = "flex h-8 items-center gap-1 whitespace-nowrap rounded-full bg-slate-900/60 px-2 text-[11px] font-semibold tabular-nums text-slate-100 backdrop-blur-sm";
const BUTTON = "pointer-events-auto flex size-8 items-center justify-center rounded-full bg-slate-900/60 text-slate-100 backdrop-blur-sm active:bg-white/30";

export type MobileHudProps = {
  /** Zdrowie w procentach (0-100). */
  healthPct: number;
  wallet: number;
  isDay: boolean;
  /** Godzina do wyświetlenia, np. "21:21". */
  clockText: string;
  season: Season;
  dayInSeason: number;
  cold: boolean;
  sheltered: boolean;
  onOpenJournal: () => void;
  onOpenMenu: () => void;
  multiplayer?: MultiplayerClient;
  onExitOnline?: () => Promise<void>;
  onReconnect?: () => Promise<void>;
};

/**
 * Kompaktowy HUD telefonu: jedna linia małych kapsułek nakładana na grę (2 rzędy tylko na bardzo wąskim ekranie).
 * Przyjmuje wyłącznie wartości proste i jest opakowany w `memo`, więc nie renderuje się przy każdym ticku gry, a tylko
 * przy zmianie wyświetlanej wartości. Marginesy uwzględniają safe area (notch, wyspa, krawędzie).
 */
export const MobileHud = memo(function MobileHud({
  healthPct,
  wallet,
  isDay,
  clockText,
  season,
  dayInSeason,
  cold,
  sheltered,
  onOpenJournal,
  onOpenMenu,
  multiplayer,
  onExitOnline,
  onReconnect,
}: MobileHudProps) {
  const low = healthPct <= 25;
  return (
    <div
      data-testid="mobile-hud"
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-start gap-1 pb-1 pl-[max(0.5rem,var(--sal))] pr-[max(0.5rem,var(--sar))] pt-[max(0.25rem,var(--sat))]"
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-1">
        <div className="flex flex-wrap items-center gap-1">
          {multiplayer && <OnlineChip client={multiplayer} onExit={onExitOnline} onReconnect={onReconnect} />}
          <span data-testid="health" role="status" aria-label={`Życie ${healthPct}%`} className={cn(CHIP, low && "animate-pulse text-red-300")}>
            <span aria-hidden>❤️</span>
            {healthPct}%
          </span>
          <span data-testid="wallet" className={cn(CHIP, "text-amber-200")}>
            <span aria-hidden>👛</span>
            {formatMoney(wallet)}
          </span>
          <span data-testid="daytime" className={CHIP}>
            <span aria-hidden>{isDay ? "☀️" : "🌙"}</span>
            {clockText}
          </span>
          <span data-testid="season" className={CHIP}>
            <span aria-hidden>{SEASON_EMOJI[season]}</span>
            {SEASON_LABEL[season]} {dayInSeason}/30
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" data-testid="open-journal" aria-label="Dziennik" onClick={onOpenJournal} className={cn(BUTTON, "text-amber-200")}>
            <BookOpen className="size-4" aria-hidden />
          </button>
          <button type="button" data-testid="open-menu" aria-label="Menu gry" onClick={onOpenMenu} className={BUTTON}>
            <Menu className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {(sheltered || cold) && (
        <span
          data-testid="status-line"
          role="status"
          className={cn(CHIP, "h-6 text-[10px]", sheltered ? "text-emerald-300" : "text-sky-300")}
        >
          {sheltered ? "🏠 Schronienie" : "🥶 Jest zimno"}
        </span>
      )}
    </div>
  );
});
