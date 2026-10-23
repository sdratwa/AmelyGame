"use client";

import { Fragment, useState } from "react";
import { movementDiagRows } from "@/lib/tpp/movementDiagnostics";
import type { TppDiagnostics } from "@/lib/forest-view";
import { mergeTppConfig, TPP_DEFAULTS, TPP_RANGES, type TppConfig } from "@/lib/tpp/config";
import { clearTppOverrides, loadTppOverrides, saveTppOverrides } from "@/lib/tpp/storedDefaults";

const SLIDERS: (keyof TppConfig)[] = [
  "walkSpeed",
  "runSpeed",
  "crouchSpeed",
  "acceleration",
  "deceleration",
  "turnSpeed",
  "cameraDistance",
  "cameraTargetHeight",
  "cameraSensitivity",
  "cameraSmoothness",
  "animCrossfade",
  "jumpHeight",
  "gravity",
];

const f = (v: number, d = 2) => v.toFixed(d);

/**
 * Panel diagnostyczny TPP (tylko deweloperski): stan animacji, prędkość, kontakt z ziemią, pozycja, wysokość terenu,
 * kierunek ciała, dystans kamery, FPS oraz suwaki parametrów działające na żywo.
 */
export function TppDebugPanel({
  data,
  fps,
  onConfig,
  onTeleportStart,
}: {
  data: TppDiagnostics | null;
  fps: number;
  onConfig: (patch: Partial<TppConfig>) => void;
  onTeleportStart: () => void;
}) {
  // Wartości startowe: domyślne z kodu z nałożonymi własnymi domyślnymi zapisanymi przyciskiem "Ustaw jako domyślne".
  const [saved, setSaved] = useState<TppConfig>(() => mergeTppConfig({ ...TPP_DEFAULTS }, loadTppOverrides()));
  const [values, setValues] = useState<TppConfig>(saved);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(null), 2000);
  };

  const change = (key: keyof TppConfig, value: number) => {
    setValues((v) => ({ ...v, [key]: value }));
    onConfig({ [key]: value });
  };
  /** Przywraca wartości domyślne: własne zapisane (jeśli są), w przeciwnym razie z kodu. */
  const reset = () => {
    setValues({ ...saved });
    onConfig({ ...saved });
  };
  const setAsDefault = () => {
    if (saveTppOverrides(values)) {
      setSaved({ ...values });
      flash("Zapisano jako domyślne (ta przeglądarka)");
    } else flash("Nie udało się zapisać (pamięć przeglądarki niedostępna)");
  };
  const restoreCodeDefaults = () => {
    clearTppOverrides();
    setSaved({ ...TPP_DEFAULTS });
    setValues({ ...TPP_DEFAULTS });
    onConfig({ ...TPP_DEFAULTS });
    flash("Przywrócono domyślne z kodu");
  };
  const copy = () => {
    const changed = Object.fromEntries((Object.keys(values) as (keyof TppConfig)[]).filter((k) => values[k] !== TPP_DEFAULTS[k]).map((k) => [k, values[k]]));
    void navigator.clipboard?.writeText(JSON.stringify(changed, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="pointer-events-auto max-h-[calc(100dvh-1.5rem)] w-72 space-y-2 overflow-y-auto rounded-lg bg-slate-950/85 p-3 text-xs text-slate-200 ring-1 ring-slate-700">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">TPP: diagnostyka</span>
      {data ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono tabular-nums">
          <dt className="text-slate-400">Animacja</dt>
          <dd>{data.animation}{data.jumpWeight > 0.01 ? ` (skok ${f(data.jumpWeight)})` : ""}</dd>
          <dt className="text-slate-400">Prędkość</dt>
          <dd>{f(data.speed)} m/s</dd>
          <dt className="text-slate-400">Grounded</dt>
          <dd>{data.grounded ? "tak" : "nie"}{data.crouching ? ", kuca" : ""}</dd>
          <dt className="text-slate-400">XYZ</dt>
          <dd>{f(data.x, 1)} / {f(data.y, 2)} / {f(data.z, 1)}</dd>
          <dt className="text-slate-400">Teren Y</dt>
          <dd>{f(data.terrainY)}</dd>
          <dt className="text-slate-400">Yaw ciała</dt>
          <dd>{f(data.bodyYawDeg, 0)}°</dd>
          <dt className="text-slate-400">Kamera</dt>
          <dd>{f(data.cameraDistance)} m, yaw {f(data.cameraYawDeg, 0)}°, pitch {f(data.cameraPitchDeg, 0)}°</dd>
          {movementDiagRows(data).map((r) => (
            <Fragment key={r.label}>
              <dt className="text-slate-400">{r.label}</dt>
              <dd>{r.value}</dd>
            </Fragment>
          ))}
          <dt className="text-slate-400">FPS</dt>
          <dd>{f(fps, 0)}</dd>
        </dl>
      ) : (
        <p className="text-slate-400">Ładowanie lasu i postaci...</p>
      )}
      {data?.modelError ? <p className="rounded bg-red-950/70 p-2 text-red-200">Model: {data.modelError}</p> : null}
      <div className="space-y-1.5 border-t border-slate-700 pt-2">
        {SLIDERS.map((key) => {
          const r = TPP_RANGES[key];
          if (!r) return null;
          const digits = r.step < 0.001 ? 4 : r.step < 0.1 ? 3 : 1;
          return (
            <label key={key} className="block">
              <span className="flex justify-between text-slate-300">
                <span>{r.label}</span>
                <span className="font-mono tabular-nums text-slate-100">{values[key].toFixed(digits)}</span>
              </span>
              <input type="range" min={r.min} max={r.max} step={r.step} value={values[key]} onChange={(e) => change(key, Number(e.target.value))} className="w-full accent-amber-400" />
            </label>
          );
        })}
      </div>
      <div className="flex gap-1">
        <button type="button" onClick={setAsDefault} className="flex-1 rounded bg-emerald-700/80 px-2 py-1 font-medium text-white" title="Zapisuje bieżące wartości suwaków jako domyślne dla tej przeglądarki (localStorage); wczytają się przy każdym otwarciu /dev/third-person">
          Ustaw jako domyślne
        </button>
        <button type="button" onClick={restoreCodeDefaults} className="flex-1 rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-600 hover:bg-slate-700" title="Usuwa zapisane domyślne i wraca do wartości z kodu (TPP_DEFAULTS)">
          Domyślne z kodu
        </button>
      </div>
      {note ? <p className="text-emerald-300">{note}</p> : null}
      <div className="flex gap-1">
        <button type="button" onClick={reset} className="flex-1 rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-600 hover:bg-slate-700">
          Cofnij do domyślnych
        </button>
        <button type="button" onClick={copy} className="flex-1 rounded bg-amber-600/80 px-2 py-1 font-medium text-white">
          {copied ? "Skopiowano" : "Kopiuj zmiany"}
        </button>
      </div>
      <button type="button" onClick={onTeleportStart} className="w-full rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-600 hover:bg-slate-700">
        Wróć na start
      </button>
    </div>
  );
}
