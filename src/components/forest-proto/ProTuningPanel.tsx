"use client";

import { useCallback, useState } from "react";
import { PRO_GROUND, PRO_TUNING } from "@/lib/game/world/generators/v2";
import { PATH_SINK_DEFAULT, PRO_KIND_SCALE_DEFAULTS, type ForestRenderer } from "@/lib/forest-view";

type Values = {
  crackCell: number;
  crackWidth: number;
  crackStrength: number;
  crackFadeNear: number;
  crackFadeFar: number;
  grassScale: number;
  flowerScale: number;
  /** Mnożniki widoku (1 = bez zmiany) dla pozostałych rodzajów drobnych obiektów. */
  fernMul: number;
  plantMul: number;
  decorMul: number;
  mushroomMul: number;
  bushMul: number;
  /** Zagłębienie bruku drogi: maks. głębokość (m) i losowość 0-1 (0 = wszystkie równo, 1 = od 0 do maks.). */
  pathSinkMax: number;
  pathSinkRandom: number;
};

const DEFAULTS: Values = {
  crackCell: PRO_GROUND.crackCell,
  crackWidth: PRO_GROUND.crackWidth,
  crackStrength: PRO_GROUND.crackStrength,
  crackFadeNear: PRO_GROUND.crackFadeNear,
  crackFadeFar: PRO_GROUND.crackFadeFar,
  grassScale: PRO_TUNING.grass.scale,
  flowerScale: PRO_TUNING.flowerScale,
  fernMul: PRO_KIND_SCALE_DEFAULTS.fern ?? 1,
  plantMul: PRO_KIND_SCALE_DEFAULTS.plant ?? 1,
  decorMul: PRO_KIND_SCALE_DEFAULTS.decor ?? 1,
  mushroomMul: PRO_KIND_SCALE_DEFAULTS.mushroom ?? 1,
  bushMul: PRO_KIND_SCALE_DEFAULTS.bush ?? 1,
  pathSinkMax: PATH_SINK_DEFAULT.max,
  pathSinkRandom: PATH_SINK_DEFAULT.random,
};

const SLIDERS: { key: keyof Values; label: string; min: number; max: number; step: number; digits: number; hint: string }[] = [
  { key: "crackCell", label: "Pęknięcia: rozmiar komórki (m)", min: 0.05, max: 2, step: 0.01, digits: 2, hint: "PRO_GROUND.crackCell" },
  { key: "crackWidth", label: "Pęknięcia: szerokość linii (m)", min: 0.005, max: 0.15, step: 0.001, digits: 3, hint: "PRO_GROUND.crackWidth" },
  { key: "crackStrength", label: "Pęknięcia: siła (ciemność)", min: 0, max: 1, step: 0.01, digits: 2, hint: "PRO_GROUND.crackStrength" },
  { key: "crackFadeNear", label: "Pęknięcia: pełne do (m od kamery)", min: 0, max: 60, step: 0.5, digits: 1, hint: "PRO_GROUND.crackFadeNear" },
  { key: "crackFadeFar", label: "Pęknięcia: znikają do (m)", min: 1, max: 120, step: 0.5, digits: 1, hint: "PRO_GROUND.crackFadeFar" },
  { key: "grassScale", label: "Trawa: skala kępki", min: 0.1, max: 2, step: 0.01, digits: 2, hint: "PRO_TUNING.grass.scale (tylko widok na żywo)" },
  { key: "flowerScale", label: "Kwiaty: skala", min: 0.1, max: 2, step: 0.01, digits: 2, hint: "PRO_TUNING.flowerScale (tylko widok na żywo)" },
  { key: "fernMul", label: "Paprocie: mnożnik skali", min: 0.1, max: 2.5, step: 0.01, digits: 2, hint: "tylko widok, 1 = bez zmiany" },
  { key: "plantMul", label: "Rośliny runa (plant): mnożnik", min: 0.1, max: 2.5, step: 0.01, digits: 2, hint: "tylko widok, 1 = bez zmiany" },
  { key: "bushMul", label: "Krzewy: mnożnik", min: 0.1, max: 2.5, step: 0.01, digits: 2, hint: "tylko widok, 1 = bez zmiany" },
  { key: "mushroomMul", label: "Grzyby: mnożnik", min: 0.1, max: 2.5, step: 0.01, digits: 2, hint: "tylko widok, 1 = bez zmiany" },
  { key: "decorMul", label: "Kamyki i płatki (decor): mnożnik", min: 0.1, max: 2.5, step: 0.01, digits: 2, hint: "tylko widok, 1 = bez zmiany" },
  { key: "pathSinkMax", label: "Bruk drogi: maks. zagłębienie (m)", min: 0, max: 0.3, step: 0.005, digits: 3, hint: "płyty rockpath i kamyki pebble obniżane w ziemi (tylko widok)" },
  { key: "pathSinkRandom", label: "Bruk drogi: losowość zagłębienia", min: 0, max: 1, step: 0.01, digits: 2, hint: "0 = wszystkie równo, 1 = od 0 do maksimum" },
];

/**
 * Suwaki strojenia trybu Pro (pęknięcia gruntu, skala trawy i kwiatów) działające na żywo, bez przeładowania lasu.
 * Wartości odpowiadają polom `PRO_GROUND` i `PRO_TUNING`; po wybraniu "Kopiuj wartości" wklej je autorowi do wpisania w kod.
 */
export function ProTuningPanel({ getRenderer }: { getRenderer: () => ForestRenderer | null }) {
  const [v, setV] = useState<Values>(DEFAULTS);
  const [copied, setCopied] = useState(false);

  const apply = useCallback(
    (next: Values, key?: keyof Values) => {
      const r = getRenderer();
      if (!r) return;
      if (!key || key.startsWith("crack")) {
        r.setProGround({ cell: next.crackCell, width: next.crackWidth, strength: next.crackStrength, fadeNear: next.crackFadeNear, fadeFar: next.crackFadeFar });
      }
      if (!key || key === "grassScale") r.setKindScale("grass", next.grassScale / PRO_TUNING.grass.scale);
      if (!key || key === "flowerScale") r.setKindScale("flower", next.flowerScale / PRO_TUNING.flowerScale);
      if (!key || key === "pathSinkMax" || key === "pathSinkRandom") r.setPathSink({ max: next.pathSinkMax, random: next.pathSinkRandom });
      if (!key || key === "fernMul") r.setKindScale("fern", next.fernMul);
      if (!key || key === "plantMul") r.setKindScale("plant", next.plantMul);
      if (!key || key === "bushMul") r.setKindScale("bush", next.bushMul);
      if (!key || key === "mushroomMul") r.setKindScale("mushroom", next.mushroomMul);
      if (!key || key === "decorMul") r.setKindScale("decor", next.decorMul);
    },
    [getRenderer],
  );

  const change = (key: keyof Values, value: number) => {
    const next = { ...v, [key]: value };
    setV(next);
    apply(next, key);
  };

  const copy = async () => {
    const text = JSON.stringify(v, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Skopiuj wartości:", text);
    }
  };

  return (
    <section className="space-y-2 rounded-md bg-slate-900/60 p-2 ring-1 ring-slate-700">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Pro: pęknięcia i skala roślin</span>
      {SLIDERS.map((s) => (
        <label key={s.key} className="block" title={s.hint}>
          <span className="flex justify-between text-slate-300">
            <span>{s.label}</span>
            <span className="font-mono tabular-nums text-slate-100">{v[s.key].toFixed(s.digits)}</span>
          </span>
          <input type="range" min={s.min} max={s.max} step={s.step} value={v[s.key]} onChange={(e) => change(s.key, Number(e.target.value))} className="w-full accent-amber-400" />
        </label>
      ))}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => {
            setV(DEFAULTS);
            apply(DEFAULTS);
          }}
          className="flex-1 rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-600 hover:bg-slate-700"
        >
          Reset
        </button>
        <button type="button" onClick={copy} className="flex-1 rounded bg-amber-600/80 px-2 py-1 font-medium text-white">
          {copied ? "Skopiowano" : "Kopiuj wartości"}
        </button>
      </div>
    </section>
  );
}
