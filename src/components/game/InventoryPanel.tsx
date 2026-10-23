import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { INVENTORY_SLOTS, ITEMS, RECIPE_BRIDGE_01, type GameState, type Item, type ItemCategory } from "@/lib/game/engine";
import { cn } from "@/lib/utils";
import { HintText } from "@/components/input/InputHint";
import { LanternEquipmentSection } from "./LanternControl";

const GROUPS: { id: string; title: string; categories: ItemCategory[] }[] = [
  { id: "tools", title: "Narzędzia", categories: ["tool"] },
  { id: "quest", title: "Przedmioty zadań", categories: ["blueprint"] },
  { id: "resources", title: "Surowce", categories: ["resource"] },
  { id: "other", title: "Pozostałe", categories: ["food"] },
];

const TAGS: Partial<Record<ItemCategory, string>> = { tool: "narzędzie", blueprint: "przedmiot zadania" };

function need(item: Item, questActive: boolean): number | null {
  if (!questActive) return null;
  return RECIPE_BRIDGE_01.requires.find((r) => r.id === item.id)?.count ?? null;
}

/**
 * Lista rzeczy gracza (klawisz I): to ten sam ekwipunek co pasek u dołu, tylko w czytelnej formie z nazwami, opisami
 * i liczbami. Niczego nie zmienia i nie ma własnego stanu: wszystko pochodzi ze stanu gry.
 */
export function InventoryPanel({ open, state, onClose, onReadBlueprint, onToggleLantern }: { open: boolean; state: GameState; onClose: () => void; onReadBlueprint?: () => void; onToggleLantern?: () => void }) {
  const totals = new Map<string, number>();
  for (const s of state.slots) if (s) totals.set(s.id, (totals.get(s.id) ?? 0) + s.count);
  const used = state.slots.filter(Boolean).length;
  const questActive = !!state.quests.accepted["quest.bridge_01"] && !state.quests.completed["quest.bridge_01"];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border-white/10 bg-slate-900 text-white" data-testid="inventory-panel">
        <DialogHeader>
          <DialogTitle>Ekwipunek</DialogTitle>
          <DialogDescription className="text-slate-400">
            Zajęte miejsca: {used}/{INVENTORY_SLOTS}. Czas gry stoi, dopóki ekwipunek jest otwarty. Zamknięcie: <HintText action="inventory" fallback="I" /> lub <HintText action="cancel" fallback="Esc" />.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[56vh] space-y-4 overflow-y-auto pr-1">
          {onToggleLantern && <LanternEquipmentSection enabled={state.lantern.enabled} disabled={state.dead} onToggle={onToggleLantern} />}
          {totals.size === 0 && <p className="rounded-xl bg-white/5 p-3 text-sm text-slate-300">Ekwipunek jest pusty.</p>}
          {GROUPS.map((group) => {
            const items = [...totals]
              .map(([id, count]) => ({ item: ITEMS[id as keyof typeof ITEMS], count }))
              .filter(({ item }) => item && group.categories.includes(item.category));
            if (items.length === 0) return null;
            return (
              <section key={group.id} aria-label={group.title} data-testid={`inventory-group-${group.id}`}>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{group.title}</h4>
                <ul className="space-y-1.5">
                  {items.map(({ item, count }) => {
                    const needed = need(item, questActive);
                    return (
                      <li
                        key={item.id}
                        data-testid={`inventory-item-${item.id}`}
                        data-count={count}
                        tabIndex={0}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                      >
                        <span aria-hidden className="text-2xl">
                          {item.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">
                            {item.name}
                            {TAGS[item.category] && <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-200">{TAGS[item.category]}</span>}
                          </span>
                          <span className="block truncate text-xs text-slate-400">{item.description}</span>
                        </span>
                        {item.category === "blueprint" && onReadBlueprint && (
                          <button
                            type="button"
                            data-testid="inventory-read-blueprint"
                            onClick={onReadBlueprint}
                            className="shrink-0 rounded-md bg-amber-300 px-2 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-200"
                          >
                            Czytaj
                          </button>
                        )}
                        <span
                          data-testid={`inventory-count-${item.id}`}
                          className={cn("shrink-0 text-sm font-bold tabular-nums", needed !== null && count >= needed ? "text-emerald-300" : "text-white")}
                        >
                          {needed !== null ? `${count}/${needed}` : `×${count}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="border-t border-white/10 pt-3 text-xs text-slate-400">Narzędzi, surowców i przedmiotów zadań nie można wyrzucić. Lampa naftowa jest stałym wyposażeniem: zawsze ją masz.</p>
      </DialogContent>
    </Dialog>
  );
}
