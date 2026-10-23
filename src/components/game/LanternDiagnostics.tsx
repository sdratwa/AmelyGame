"use client";

import { useState, useSyncExternalStore } from "react";
import {
  LANTERN_GROUP_LABELS,
  LANTERN_PARAMS,
  changedKeys,
  type LanternGroupId,
  type LanternParam,
} from "@/lib/forest-view/lantern/config";
import { lanternConfigStore } from "@/lib/forest-view/lantern/configStore";
import type { LanternStats } from "@/lib/forest-view/lantern/system";
import { DiagSection } from "./DiagnosticsSection";

const GROUP_ORDER: readonly LanternGroupId[] = ["light", "flicker", "glow", "far", "perf", "attach"];
const IS_DEV = process.env.NODE_ENV !== "production";

const BUTTON = "pointer-events-auto rounded px-2 py-0.5 text-[11px] font-semibold";

function ParamRow({ param, value, onChange }: { param: LanternParam; value: string | number | boolean; onChange: (value: string | number | boolean) => void }) {
  const id = `lantern-${param.key}`;
  switch (param.kind) {
    case "boolean":
      return (
        <label className="pointer-events-auto flex items-center gap-2" htmlFor={id}>
          <input id={id} data-testid={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span>{param.label}</span>
        </label>
      );
    case "color":
      return (
        <label className="pointer-events-auto flex items-center gap-2" htmlFor={id}>
          <input id={id} data-testid={id} type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0" />
          <span>
            {param.label} <span className="text-slate-400">{String(value)}</span>
          </span>
        </label>
      );
    case "select":
      return (
        <label className="pointer-events-auto flex items-center gap-2" htmlFor={id}>
          <span className="shrink-0">{param.label}</span>
          <select id={id} data-testid={id} value={String(value)} onChange={(e) => onChange(e.target.value)} className="rounded bg-slate-700 px-1 py-0.5 text-[11px]">
            {param.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "number": {
      const n = Number(value);
      const digits = param.step < 0.01 ? 3 : param.step < 0.1 ? 2 : param.step < 1 ? 1 : 0;
      return (
        <label className="pointer-events-auto block" htmlFor={id}>
          <span className="flex justify-between gap-2">
            <span>{param.label}</span>
            <span className="tabular-nums text-slate-300">
              {n.toFixed(digits)}
              {param.unit ? ` ${param.unit}` : ""}
            </span>
          </span>
          <input id={id} data-testid={id} type="range" min={param.min} max={param.max} step={param.step} value={n} onChange={(e) => onChange(Number(e.target.value))} className="block h-3 w-full" />
        </label>
      );
    }
  }
}

/**
 * Sekcja "Lampa naftowa" panelu Diagnostyka (dev): żywe strojenie wyglądu lampy. To wyłącznie lokalne parametry
 * renderowania: nie zmieniają stanu gry, zapisu ani tego, co widzą inni gracze (serwer zna tylko włączona/wyłączona).
 */
export function LanternDiagnostics({ stats }: { stats: LanternStats | null }) {
  const store = lanternConfigStore();
  useSyncExternalStore(store.subscribe, () => store.revision, () => 0);
  const cfg = store.current;
  const [note, setNote] = useState<string | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const changed = changedKeys(cfg).length;

  const say = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((n) => (n === text ? null : n)), 3000);
  };

  const copy = async () => {
    const text = store.toJson();
    try {
      await navigator.clipboard.writeText(text);
      setJson(null);
      say("Skopiowano JSON do schowka");
    } catch {
      setJson(text);
      say("Schowek niedostępny: skopiuj JSON z pola poniżej");
    }
  };

  return (
    <DiagSection id="lantern" summary={`zmienione parametry: ${changed}`}>
    <div data-testid="lantern-diagnostics">
      <div data-testid="lantern-stats">
        {stats
          ? `zapalone ${stats.lit} · światła ${stats.lights}/${stats.poolSize} · NEAR ${stats.near} MID ${stats.mid} FAR ${stats.far} · blaski ${stats.glows} · zasłonięte ${stats.occluded} · cienie ${stats.shadows ? "tak" : "nie"}`
          : "system lamp niedostępny"}
      </div>
      <div className="text-slate-400">Parametry lokalne (tylko wygląd); stan włączona/wyłączona i tak pochodzi z gry. Bloom: brak w rendererze.</div>
      <div className="mt-1 flex flex-wrap gap-1">
        <button type="button" data-testid="lantern-reset" onClick={() => store.reset()} className={`${BUTTON} bg-slate-500 text-white hover:bg-slate-400`}>
          Reset to defaults
        </button>
        <button
          type="button"
          data-testid="lantern-set-default"
          disabled={!IS_DEV}
          title={IS_DEV ? "Zapisuje bieżące ustawienia w tej przeglądarce" : "Tylko w trybie deweloperskim"}
          onClick={() => say(store.setAsDefault() ? "Zapisano jako domyślne (lokalnie)" : "Nie udało się zapisać lokalnie")}
          className={`${BUTTON} bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:opacity-40`}
        >
          Set as default
        </button>
        <button type="button" data-testid="lantern-restore" onClick={() => store.restoreSaved()} className={`${BUTTON} bg-sky-500 text-sky-950 hover:bg-sky-400`}>
          Restore saved
        </button>
        <button type="button" data-testid="lantern-copy" onClick={copy} className={`${BUTTON} bg-amber-400 text-amber-950 hover:bg-amber-300`}>
          Copy JSON config
        </button>
      </div>
      {note && (
        <div data-testid="lantern-note" role="status" className="text-emerald-300">
          {note}
        </div>
      )}
      {json && <textarea data-testid="lantern-json" readOnly value={json} rows={6} className="pointer-events-auto mt-1 w-full rounded bg-slate-800 p-1 text-[10px]" onFocus={(e) => e.currentTarget.select()} />}
      <div className="mt-1">
      {GROUP_ORDER.map((group) => (
        <details key={group} open={group === "light"} className="pointer-events-auto mt-1">
          <summary className="cursor-pointer select-none font-semibold text-amber-200">{LANTERN_GROUP_LABELS[group]}</summary>
          <div className="space-y-0.5 pl-1">
            {LANTERN_PARAMS.filter((p) => p.group === group).map((p) => (
              <ParamRow key={p.key} param={p} value={cfg[p.key]} onChange={(v) => store.set({ [p.key]: v })} />
            ))}
          </div>
        </details>
      ))}
      </div>
    </div>
    </DiagSection>
  );
}
