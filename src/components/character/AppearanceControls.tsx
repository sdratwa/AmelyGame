"use client";

import { isAvailableForBase, itemsOfSlot, withAppearance, type CharacterAppearanceV1, type SlotId } from "@/lib/character";

type VisualSlot = Extract<SlotId, "hair" | "top" | "bottom">;

const ROWS: { slot: VisualSlot; label: string; idKey: "hairStyleId" | "topId" | "bottomId"; colorKey: "hairColor" | "topColor" | "bottomColor" }[] = [
  { slot: "hair", label: "Fryzura", idKey: "hairStyleId", colorKey: "hairColor" },
  { slot: "top", label: "Góra", idKey: "topId", colorKey: "topColor" },
  { slot: "bottom", label: "Dół", idKey: "bottomId", colorKey: "bottomColor" },
];

/**
 * Wybór fryzury, góry i dołu oraz ich kolorów. Czysty komponent kontrolowany: ten sam w kreatorze `/dev/character-creator`
 * i w panelu deweloperskim gry, więc oba zmieniają wygląd tą samą ścieżką (`CharacterAppearanceV1`).
 */
export function AppearanceControls({ appearance, onChange, compact = false }: { appearance: CharacterAppearanceV1; onChange: (next: CharacterAppearanceV1) => void; compact?: boolean }) {
  const text = compact ? "text-[11px]" : "text-sm";
  return (
    <div data-testid="appearance-controls" className={`pointer-events-auto grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 ${text}`}>
      {ROWS.map((row) => {
        const items = itemsOfSlot(row.slot).filter(isAvailableForBase);
        const value = appearance[row.idKey] ?? "";
        const current = items.find((i) => i.id === value);
        return (
          <div key={row.slot} className="contents">
            <label htmlFor={`appearance-${row.slot}`}>{row.label}</label>
            <select
              id={`appearance-${row.slot}`}
              data-testid={`appearance-${row.slot}`}
              value={value}
              onChange={(e) => onChange(withAppearance(appearance, { [row.idKey]: e.target.value === "" ? null : e.target.value } as Partial<CharacterAppearanceV1>))}
              className="min-w-0 rounded border border-white/30 bg-slate-800 px-1 py-0.5 text-slate-100"
              title={current?.note}
            >
              <option value="">(brak)</option>
              {items.map((i) => (
                <option key={i.id} value={i.id} disabled={i.status === "missing_asset"}>
                  {i.name}
                  {i.origin ? ` · ${i.origin}` : ""}
                  {i.status === "missing_asset" ? " (brak zasobu)" : i.prototype ? " (prototyp)" : ""}
                </option>
              ))}
            </select>
            <input
              type="color"
              aria-label={`Kolor: ${row.label}`}
              data-testid={`appearance-${row.slot}-color`}
              value={appearance[row.colorKey]}
              onChange={(e) => onChange(withAppearance(appearance, { [row.colorKey]: e.target.value } as Partial<CharacterAppearanceV1>))}
              className="h-6 w-8 cursor-pointer rounded border border-white/30 bg-transparent p-0"
            />
            {current?.defaultColor ? (
              <div className="col-span-3 flex items-center justify-end gap-2 text-slate-400" data-testid={`appearance-${row.slot}-original`}>
                <span>{appearance[row.colorKey] === current.defaultColor ? "Kolor: oryginalny z tekstury" : "Kolor: przebarwiony"}</span>
                <button
                  type="button"
                  disabled={appearance[row.colorKey] === current.defaultColor}
                  onClick={() => onChange(withAppearance(appearance, { [row.colorKey]: current.defaultColor } as Partial<CharacterAppearanceV1>))}
                  className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-100 hover:bg-slate-600 disabled:opacity-40"
                >
                  Oryginalny kolor
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
