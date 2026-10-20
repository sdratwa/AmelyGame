"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ITEMS, RECIPE_BRIDGE_01, type GameState } from "@/lib/game/engine";

/**
 * Schemat mostu do czytania (po zdobyciu i z ekwipunku I): wymagane materiały pochodzą z `RECIPE_BRIDGE_01`
 * (jedyne źródło danych), a posiadane ilości ze stanu gry. Niczego nie zmienia.
 */
export function BlueprintDialog({ open, state, onClose }: { open: boolean; state: GameState; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm border-amber-200/30 bg-slate-900 text-white" data-testid="blueprint-dialog">
        <DialogHeader>
          <DialogTitle>
            <span aria-hidden>{ITEMS[RECIPE_BRIDGE_01.blueprint].emoji}</span> Schemat mostu
          </DialogTitle>
          <DialogDescription className="text-slate-300">
            Stary plan drewnianego mostu. Do jego budowy potrzebujesz piły i kilofa (do zdobycia materiałów) oraz:
          </DialogDescription>
        </DialogHeader>
        <ul data-testid="blueprint-requirements" className="space-y-1.5">
          {RECIPE_BRIDGE_01.requires.map((r) => {
            const have = state.slots.reduce((n, slot) => (slot?.id === r.id ? n + slot.count : n), 0);
            return (
              <li key={r.id} data-testid={`blueprint-req-${r.id}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <span aria-hidden className="text-2xl">
                  {ITEMS[r.id].emoji}
                </span>
                <span className="flex-1 text-sm font-semibold">{ITEMS[r.id].name}</span>
                <span className={have >= r.count ? "font-bold text-emerald-300" : "font-bold text-white"}>
                  {Math.min(have, r.count)}/{r.count}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-slate-400">Budowa odbywa się w miejscu dawnego mostu przy rzece. Schemat możesz przeczytać ponownie w ekwipunku (I).</p>
        <div className="flex justify-end">
          <Button data-testid="blueprint-close" onClick={onClose}>
            Zamknij
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
