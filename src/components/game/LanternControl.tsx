"use client";

import { EQUIPMENT, OIL_LANTERN_ID } from "@/lib/game/engine";
import { InputHint } from "@/components/input/InputHint";
import { cn } from "@/lib/utils";

const LANTERN = EQUIPMENT[OIL_LANTERN_ID];

type Common = {
  enabled: boolean;
  /** Martwy gracz nie obsługuje lampy (silnik też to blokuje). */
  disabled?: boolean;
  onToggle: () => void;
};

/**
 * Stałe wyposażenie w oknie ekwipunku (I): osobna sekcja, poza miejscami na przedmioty. Lampy nie da się wyrzucić ani
 * zgubić, więc nie ma tu żadnych takich przycisków; jest tylko przełącznik zapalenia.
 */
export function LanternEquipmentSection({ enabled, disabled, onToggle }: Common) {
  return (
    <section aria-label="Wyposażenie stałe" data-testid="inventory-group-equipment">
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Wyposażenie stałe</h4>
      <ul className="space-y-1.5">
        <li data-testid={`equipment-${OIL_LANTERN_ID}`} data-on={enabled} className="flex items-center gap-3 rounded-xl border border-amber-200/20 bg-amber-100/5 px-3 py-2">
          <span aria-hidden className="text-2xl">
            {LANTERN.emoji}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {LANTERN.name}
              <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-200">stała</span>
            </span>
            <span className="block truncate text-xs text-slate-400">{LANTERN.description}</span>
          </span>
          <button
            type="button"
            data-testid="lantern-toggle-panel"
            aria-pressed={enabled}
            disabled={disabled}
            onClick={onToggle}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50",
              enabled ? "bg-amber-300 text-amber-950 hover:bg-amber-200" : "bg-white/15 text-white hover:bg-white/25",
            )}
          >
            {enabled ? "Zgaś" : "Zapal"} <InputHint action="lantern" className="ml-1" />
          </button>
        </li>
      </ul>
    </section>
  );
}

/** Osobny, dziewiąty "slot" przy pasku ekwipunku na komputerze: nie zmniejsza liczby miejsc na przedmioty. */
export function LanternBarSlot({ enabled, disabled, onToggle, showHint }: Common & { showHint: boolean }) {
  return (
    <button
      type="button"
      data-testid="lantern-toggle"
      data-on={enabled}
      aria-pressed={enabled}
      aria-label={`${LANTERN.name}: ${enabled ? "zapalona, kliknij aby zgasić" : "zgaszona, kliknij aby zapalić"}`}
      title={LANTERN.name}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center rounded-lg border-2 bg-slate-800 text-xl transition disabled:opacity-50 sm:size-14 sm:text-3xl",
        enabled ? "border-amber-300 bg-amber-300/20 shadow-[0_0_14px_rgba(255,189,85,0.55)]" : "border-slate-600 hover:border-slate-400",
      )}
    >
      <span aria-hidden className={enabled ? "" : "opacity-60 grayscale"}>
        {LANTERN.emoji}
      </span>
      {showHint && <InputHint action="lantern" className="absolute left-1 top-0.5 bg-transparent px-0 text-slate-400" />}
    </button>
  );
}

/** Wiersz narzędzi w wysuwanym plecaku telefonu (dotyk): duży cel dotykowy, bez podpowiedzi klawiszy. */
export function LanternDrawerRow({ enabled, disabled, onToggle }: Common) {
  return (
    <button
      type="button"
      data-testid="lantern-toggle"
      data-on={enabled}
      aria-pressed={enabled}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "mb-2 flex h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold transition active:scale-[0.99] disabled:opacity-50",
        enabled ? "border-amber-300 bg-amber-300/25 text-amber-100" : "border-white/15 bg-white/10 text-white",
      )}
    >
      <span aria-hidden className={cn("text-xl", !enabled && "opacity-60 grayscale")}>
        {LANTERN.emoji}
      </span>
      <span className="min-w-0 flex-1 truncate">{LANTERN.name}</span>
      <span className={cn("rounded-full px-2 py-0.5 text-[11px]", enabled ? "bg-amber-300 text-amber-950" : "bg-white/15")}>{enabled ? "Zgaś" : "Zapal"}</span>
    </button>
  );
}
