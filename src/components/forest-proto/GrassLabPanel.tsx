"use client";

import { useState } from "react";
import { LAB_MODELS, LAB_RANGES, LAB_SHADINGS, type LabMotion, type LabOptions, type ViewOverrides } from "@/lib/forest-view";

type Props = {
  lab: LabOptions;
  overrides: ViewOverrides;
  onLab: (patch: Partial<LabOptions>) => void;
  onOverrides: (patch: Partial<ViewOverrides>) => void;
  onClose: () => void;
};

const MOTIONS: { id: LabMotion; label: string; hint: string }[] = [
  { id: "manual", label: "Ręcznie", hint: "kamerą steruje tylko mysz i suwaki" },
  { id: "orbit", label: "Obrót", hint: "powolny obrót wokół kępy (14°/s)" },
  { id: "jitter", label: "Drżenie ±2,5°", hint: "kamera drga o ułamki stopnia wokół ustawionego kąta (test migotania)" },
];

function Switch({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      title={hint}
      className={`rounded px-2 py-1 text-[11px] font-medium ring-1 transition ${on ? "bg-emerald-500/25 text-emerald-100 ring-emerald-400/50" : "bg-slate-800/80 text-slate-400 ring-slate-600"}`}
    >
      {label}: {on ? "wł." : "wył."}
    </button>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={`rounded px-1.5 py-1 text-[11px] ring-1 transition ${value === o.id ? "bg-emerald-500/30 text-emerald-50 ring-emerald-400" : "bg-slate-800/80 text-slate-300 ring-slate-600 hover:bg-slate-700"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** TYMCZASOWY panel diagnostyczny trawy (patrz `grassLab.ts`): przełączniki do rozdzielenia przyczyn migotania. */
export function GrassLabPanel({ lab, overrides, onLab, onOverrides, onClose }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const copy = async () => {
    const payload = JSON.stringify({ lab, overrides: { shadows: overrides.shadows, wind: overrides.wind, fog: overrides.fog } }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setNote("Skopiowano ustawienia laboratorium");
    } catch {
      window.prompt("Skopiuj ustawienia", payload);
    }
    setTimeout(() => setNote(null), 1800);
  };

  return (
    <section className="space-y-2 rounded-md bg-slate-900/60 p-2 ring-1 ring-amber-500/60">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Laboratorium trawy (tymczasowe)</span>
        <button type="button" onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-100">
          wyjdź
        </button>
      </div>
      <div className="text-[10px] leading-snug text-slate-400">
        Przeciągnij myszą po scenie: obrót kamery · kółko: odległość. Wskazówka: najpierw ustaw „Drżenie” albo przeciągnij tuż przy granicy czerwono-zielonej w trybie „Strona trójkąta”.
      </div>

      <label className="block">
        <span className="text-slate-300">Model trawy</span>
        <select
          value={lab.model}
          onChange={(e) => onLab({ model: e.target.value as LabOptions["model"] })}
          className="mt-0.5 w-full rounded bg-slate-900 px-2 py-1 ring-1 ring-slate-600"
        >
          {LAB_MODELS.map((m) => (
            <option key={m} value={m}>
              {m === "all" ? "wszystkie 4 (rząd)" : m}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1.5">
        <Switch label="Grupa kęp" on={lab.group} onChange={(v) => onLab({ group: v })} hint="wył. = jedna kępa" />
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Cieniowanie</div>
        <Choice value={lab.shading} options={LAB_SHADINGS} onChange={(v) => onLab({ shading: v })} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Switch label="Poprawka normalnych" on={lab.fix} onChange={(v) => onLab({ fix: v })} hint="wył. = zachowanie sprzed poprawki (odwracanie normalnej na tylnej ściance + zero po pochyleniu)" />
        <Switch label="Cienie" on={overrides.shadows} onChange={(v) => onOverrides({ shadows: v })} hint="globalnie (jak klawisz H); LOW zawsze bez cieni" />
        <Switch label="Odbiór cienia przez trawę" on={lab.receiveShadow} onChange={(v) => onLab({ receiveShadow: v })} hint="receiveShadow tylko dla źdźbeł" />
        <Switch label="Wiatr" on={overrides.wind} onChange={(v) => onOverrides({ wind: v })} hint="działa tylko w „Materiał lasu” (inne tryby nie mają wiatru)" />
        <Switch label="Słupek z cieniem" on={lab.occluder} onChange={(v) => onLab({ occluder: v })} hint="płytka rzucająca cień na kępę (wymaga włączonych cieni)" />
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Ruch kamery</div>
        <div className="grid grid-cols-3 gap-1">
          {MOTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.hint}
              onClick={() => onLab({ motion: m.id })}
              className={`rounded px-1 py-1 text-[11px] ring-1 transition ${lab.motion === m.id ? "bg-emerald-500/30 text-emerald-50 ring-emerald-400" : "bg-slate-800/80 text-slate-300 ring-slate-600 hover:bg-slate-700"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {(["azimuth", "elevation", "distance"] as const).map((key) => {
        const r = LAB_RANGES[key];
        const label = key === "azimuth" ? "Obrót wokół kępy (°)" : key === "elevation" ? "Wysokość kamery (°)" : "Odległość (m)";
        return (
          <label key={key} className="block">
            <span className="flex items-center justify-between text-slate-300">
              <span>{label}</span>
              <span className="flex items-center gap-1">
                {key !== "distance" && (
                  <>
                    <button type="button" onClick={() => onLab({ [key]: lab[key] - 1 })} className="rounded bg-slate-800 px-1.5 ring-1 ring-slate-600 hover:bg-slate-700" aria-label={`${label} minus 1`}>
                      −1°
                    </button>
                    <button type="button" onClick={() => onLab({ [key]: lab[key] + 1 })} className="rounded bg-slate-800 px-1.5 ring-1 ring-slate-600 hover:bg-slate-700" aria-label={`${label} plus 1`}>
                      +1°
                    </button>
                  </>
                )}
                <span className="w-12 text-right font-mono tabular-nums text-slate-100">{lab[key].toFixed(key === "distance" ? 2 : 1)}</span>
              </span>
            </span>
            <input
              type="range"
              min={r.min}
              max={r.max}
              step={r.step}
              value={lab[key]}
              onChange={(e) => onLab({ [key]: Number(e.target.value) })}
              className="w-full accent-amber-400"
            />
          </label>
        );
      })}

      <div className="flex items-center gap-2">
        <button type="button" onClick={copy} className="rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-600 hover:bg-slate-700">
          Kopiuj ustawienia
        </button>
        {note && <span className="text-[11px] text-emerald-300">{note}</span>}
      </div>
    </section>
  );
}
