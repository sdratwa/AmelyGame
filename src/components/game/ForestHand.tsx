"use client";

import { ITEMS, type ItemId } from "@/lib/game/engine";
import { PhoneIcon } from "./art";

export function ForestHand({ item }: { item: ItemId | null }) {
  return (
    <div
      data-testid="hand"
      data-item={item ?? ""}
      className="pointer-events-none absolute -bottom-6 right-[8%] z-10 w-24 origin-bottom animate-[hand-sway_4s_ease-in-out_infinite] sm:right-[14%] sm:w-32"
      aria-label={item ? `W ręku: ${ITEMS[item].name}` : "Pusta ręka"}
    >
      <svg viewBox="0 0 120 150" className="h-auto w-full drop-shadow-xl">
        <path d="M30 150 L40 78 L92 78 L104 150 Z" fill="#1e3a5f" />
        <path d="M34 120 L98 120 L104 150 L30 150 Z" fill="#16304f" />
        <rect x="38" y="62" width="56" height="30" rx="10" fill="#f1c9a5" />
        <g fill="#f1c9a5" stroke="#d7a67f" strokeWidth="1.5">
          <rect x="34" y="30" width="13" height="42" rx="6.5" />
          <rect x="49" y="24" width="13" height="48" rx="6.5" />
          <rect x="64" y="26" width="13" height="46" rx="6.5" />
          <rect x="79" y="34" width="13" height="38" rx="6.5" />
        </g>
        <rect x="28" y="56" width="18" height="12" rx="6" fill="#f1c9a5" stroke="#d7a67f" strokeWidth="1.5" transform="rotate(-25 37 62)" />
      </svg>
      <div className="absolute left-1/2 top-[-18%] flex -translate-x-1/2 items-center justify-center">
        {item === "item.phone" ? (
          <PhoneIcon className="h-16 -rotate-6 drop-shadow-lg sm:h-24" />
        ) : item ? (
          <span className="text-5xl drop-shadow-lg sm:text-6xl" aria-hidden>
            {ITEMS[item].emoji}
          </span>
        ) : null}
      </div>
    </div>
  );
}
