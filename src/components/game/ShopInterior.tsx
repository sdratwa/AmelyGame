"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  INVENTORY_SLOTS,
  ITEMS,
  SHOP_ITEMS,
  formatMoney,
  type GameState,
} from "@/lib/game/engine";
import { cn } from "@/lib/utils";
import { FrogLogo } from "./art";

export function ShopInterior({
  state,
  onBuy,
  onLeave,
}: {
  state: GameState;
  onBuy: (id: (typeof SHOP_ITEMS)[number]) => void;
  onLeave: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onLeave();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLeave]);

  const used = state.slots.filter(Boolean).length;
  const full = used >= INVENTORY_SLOTS;

  return (
    <section
      data-testid="shop-interior"
      className="relative flex h-full flex-col overflow-y-auto bg-[#e9efe9] [background-image:linear-gradient(45deg,#dfe8df_25%,transparent_25%,transparent_75%,#dfe8df_75%),linear-gradient(45deg,#dfe8df_25%,transparent_25%,transparent_75%,#dfe8df_75%)] [background-position:0_0,28px_28px] [background-size:56px_56px]"
    >
      <div className="flex shrink-0 items-center gap-3 bg-[#2e9e44] px-4 py-3 text-white shadow-md sm:px-6">
        <FrogLogo size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">Żappka</h2>
          <p className="truncate text-xs text-emerald-50 sm:text-sm">
            Tu jest ciepło – życie nie spada, dopóki jesteś w środku.
          </p>
        </div>
        <Button
          data-testid="leave-shop"
          variant="secondary"
          onClick={onLeave}
          className="shrink-0"
        >
          Wyjdź (Esc)
        </Button>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 p-3 sm:p-6">
        <div className="mb-3 flex items-center justify-between text-sm text-slate-700">
          <span className="font-semibold">Lada z jedzeniem</span>
          <span data-testid="slots-used" className={cn(full && "font-semibold text-red-600")}>
            Ekwipunek: {used}/{INVENTORY_SLOTS}
          </span>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SHOP_ITEMS.map((id) => {
            const item = ITEMS[id];
            const broke = state.wallet < item.price;
            return (
              <li
                key={id}
                data-testid={`shop-item-${id}`}
                className="flex items-center gap-3 rounded-2xl border border-emerald-900/10 bg-white p-3 text-slate-900 shadow-sm"
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-3xl" aria-hidden>
                  {item.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-xs text-slate-500">{item.description}</div>
                  <div className="mt-0.5 text-xs font-semibold text-emerald-700">+{item.heal}% życia</div>
                </div>
                <Button
                  data-testid={`buy-${id}`}
                  disabled={full || broke}
                  onClick={() => onBuy(id)}
                  className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
                >
                  Kup · {formatMoney(item.price)}
                </Button>
              </li>
            );
          })}
        </ul>
        {full && (
          <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Ekwipunek jest pełny. Zjedz coś, żeby zwolnić miejsce.
          </p>
        )}
      </div>
    </section>
  );
}
