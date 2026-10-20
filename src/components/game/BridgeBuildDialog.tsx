"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ITEMS, RECIPE_BRIDGE_01, type GameState } from "@/lib/game/engine";

const countHeld = (state: GameState, id: string) => state.slots.reduce((n, slot) => (slot?.id === id ? n + slot.count : n), 0);

/**
 * Okno budowy mostu (E przy miejscu budowy). Pokazuje wymagania z `RECIPE_BRIDGE_01` i to, czego brakuje; przycisk jest
 * nieaktywny, dopóki wszystko nie jest zebrane, ale o budowie i tak decyduje silnik (ponowna weryfikacja schematu i materiałów).
 */
export function BridgeBuildDialog({ open, state, onBuild, onClose }: { open: boolean; state: GameState; onBuild: () => void; onClose: () => void }) {
  const hasBlueprint = countHeld(state, RECIPE_BRIDGE_01.blueprint) >= 1;
  const rows = RECIPE_BRIDGE_01.requires.map((r) => ({ ...r, have: countHeld(state, r.id) }));
  const ready = hasBlueprint && rows.every((r) => r.have >= r.count);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm border-amber-200/30 bg-slate-900 text-white" data-testid="bridge-build-window">
        <DialogHeader>
          <DialogTitle>Budowa mostu</DialogTitle>
          <DialogDescription className="text-slate-300">
            {ready ? "Masz wszystko, czego potrzeba. Możesz odbudować most." : "Zbierz brakujące rzeczy i wróć w to miejsce."}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5" data-testid="bridge-build-requirements">
          {rows.map((r) => (
            <li key={r.id} data-testid={`bridge-req-${r.id}`} data-done={r.have >= r.count} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span aria-hidden className="text-2xl">
                {ITEMS[r.id].emoji}
              </span>
              <span className="flex-1 text-sm font-semibold">{ITEMS[r.id].name}</span>
              <span className={r.have >= r.count ? "font-bold text-emerald-300" : "font-bold text-amber-200"}>
                {Math.min(r.have, r.count)}/{r.count}
              </span>
            </li>
          ))}
          <li data-testid="bridge-req-blueprint" data-done={hasBlueprint} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <span aria-hidden className="text-2xl">
              {ITEMS[RECIPE_BRIDGE_01.blueprint].emoji}
            </span>
            <span className="flex-1 text-sm font-semibold">Schemat</span>
            <span className={hasBlueprint ? "font-bold text-emerald-300" : "font-bold text-amber-200"}>{hasBlueprint ? "posiadany" : "brak"}</span>
          </li>
        </ul>
        <div className="flex justify-end gap-2">
          <Button data-testid="bridge-build-cancel" variant="secondary" onClick={onClose}>
            Anuluj
          </Button>
          <Button data-testid="bridge-build-confirm" disabled={!ready} onClick={onBuild}>
            ZBUDUJ MOST
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
