"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QualityId } from "@/lib/assets";
import { GrassLabPanel } from "./GrassLabPanel";
import {
  BENCHMARK_SECONDS,
  DEFAULT_HOUR,
  DEFAULT_OVERRIDES,
  DEFAULT_LAB,
  DEFAULT_PRESET,
  DEFAULT_SEED,
  ForestRenderer,
  PRESET_IDS,
  TUNING_RANGES,
  parsePreset,
  parseSectorParam,
  presetConfig,
  stressRadius,
  visualFromJson,
  visualToJson,
  LAB_MODELS,
  type BenchmarkReport,
  type LabOptions,
  type PanelStats,
  type PresetId,
  type ViewOverrides,
  type VisualConfig,
  type VisualTuning,
} from "@/lib/forest-view";

const QUALITIES: QualityId[] = ["LOW", "MEDIUM", "HIGH"];
const LODS: { value: ViewOverrides["forceLod"]; label: string }[] = [
  { value: null, label: "Auto" },
  { value: 0, label: "LOD0" },
  { value: 1, label: "LOD1" },
];

const TUNING_KEYS = ["exposure", "ambient", "sun", "shadow", "greenSaturation", "fogDensity"] as const;
const COMPARE_HOURS = [7, 12, 19];
const PRESET_HINTS: Record<PresetId, string> = {
  ORIGINAL: "Wygląd z V2a (do porównań)",
  NATURAL: "Poprawiony, naturalny las",
  FAIRYTALE: "Delikatnie baśniowy las",
};

function parseQuality(text: string | null): QualityId {
  const q = (text ?? "").toUpperCase();
  return (QUALITIES as string[]).includes(q) ? (q as QualityId) : "MEDIUM";
}

function hourLabel(h: number): string {
  const m = Math.round(h * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : "-");
const thousands = (n: number) => Math.round(n).toLocaleString("pl-PL");

function Row({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="flex justify-between gap-4" title={title}>
      <span className="text-slate-400">{k}</span>
      <span className="font-mono tabular-nums text-slate-100">{v}</span>
    </div>
  );
}

function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      title={hint}
      className={`rounded px-2 py-1 text-xs font-medium ring-1 transition ${on ? "bg-emerald-500/25 text-emerald-100 ring-emerald-400/50" : "bg-slate-800/80 text-slate-400 ring-slate-600"}`}
    >
      {label}: {on ? "wł." : "wył."}
    </button>
  );
}

export function ForestPrototype() {
  const params = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ForestRenderer | null>(null);
  const [stats, setStats] = useState<PanelStats | null>(null);
  const [quality, setQuality] = useState<QualityId>(() => parseQuality(params.get("q")));
  const [hour, setHour] = useState<number>(() => {
    const h = Number(params.get("hour"));
    return params.get("hour") !== null && Number.isFinite(h) ? ((h % 24) + 24) % 24 : DEFAULT_HOUR;
  });
  const [overrides, setOverrides] = useState<ViewOverrides>(() => ({
    ...DEFAULT_OVERRIDES,
    fog: params.get("fog") !== "0",
    shadows: params.get("shadows") !== "0",
    forceLod: params.get("lod") === "0" ? 0 : params.get("lod") === "1" ? 1 : null,
    wind: params.get("wind") !== "0",
  }));
  const [visual, setVisual] = useState<VisualConfig>(() => presetConfig(parsePreset(params.get("preset")) ?? DEFAULT_PRESET));
  const [visualNote, setVisualNote] = useState<string | null>(null);
  const [seedText, setSeedText] = useState(() => params.get("seed") ?? String(DEFAULT_SEED));
  const [bench, setBench] = useState<BenchmarkReport | null>(null);
  const [lab, setLab] = useState<LabOptions | null>(() => {
    if (params.get("lab") !== "grass") return null;
    const model = params.get("labModel");
    return { ...DEFAULT_LAB, model: (LAB_MODELS as readonly string[]).includes(model ?? "") ? (model as LabOptions["model"]) : DEFAULT_LAB.model };
  });
  const [panelOpen, setPanelOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const stress = useMemo(() => {
    const n = Number(params.get("stress"));
    return params.get("stress") ? stressRadius(n) : null;
  }, [params]);

  const initial = useRef({ quality, hour, overrides, params, stress, visual, lab });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const init = initial.current;
    const seed = Number(init.params.get("seed"));
    const renderer = new ForestRenderer({
      container,
      quality: init.quality,
      hour: init.hour,
      overrides: init.overrides,
      visual: init.visual,
      window: {
        seed: init.params.get("seed") !== null && Number.isFinite(seed) ? seed >>> 0 : DEFAULT_SEED,
        sector: parseSectorParam(init.params.get("sector")) ?? undefined,
        radius: init.stress ?? 1,
      },
      onStats: setStats,
      onLab: (o) => setLab(o),
    });
    rendererRef.current = renderer;
    if (init.lab) renderer.setGrassLab(init.lab);
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  const updateUrl = useCallback((patch: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    window.history.replaceState(null, "", url);
  }, []);

  const changeQuality = useCallback(
    (q: QualityId) => {
      setQuality(q);
      rendererRef.current?.setQuality(q);
      updateUrl({ q: q.toLowerCase() });
    },
    [updateUrl],
  );
  const changeHour = useCallback(
    (h: number) => {
      setHour(h);
      rendererRef.current?.setHour(h);
    },
    [],
  );
  const changeOverrides = useCallback((patch: Partial<ViewOverrides>) => {
    setOverrides((o) => ({ ...o, ...patch }));
    rendererRef.current?.setOverrides(patch);
  }, []);

  const changeLab = useCallback((patch: Partial<LabOptions>) => {
    const current = rendererRef.current?.getGrassLab();
    if (!current) return;
    const next = { ...current, ...patch };
    rendererRef.current?.setGrassLab(next);
    setLab(rendererRef.current?.getGrassLab() ?? next);
  }, []);
  const toggleLab = useCallback(
    (on: boolean) => {
      const next = on ? (lab ?? DEFAULT_LAB) : null;
      rendererRef.current?.setGrassLab(next);
      setLab(next);
      updateUrl({ lab: next ? "grass" : null, labModel: null });
    },
    [lab, updateUrl],
  );

  const changePreset = useCallback(
    (id: PresetId) => {
      rendererRef.current?.setPreset(id);
      setVisual(presetConfig(id));
      setVisualNote(null);
      updateUrl({ preset: id.toLowerCase() });
    },
    [updateUrl],
  );
  const changeTuning = useCallback((patch: Partial<VisualTuning>) => {
    rendererRef.current?.setTuning(patch);
    const r = rendererRef.current?.getVisual();
    if (r) setVisual(structuredClone(r));
  }, []);
  const copyVisual = useCallback(async () => {
    const payload = JSON.stringify(visualToJson(visual, hour, quality), null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setVisualNote("Skopiowano konfigurację wizualną (JSON)");
    } catch {
      window.prompt("Skopiuj konfigurację wizualną", payload);
    }
    setTimeout(() => setVisualNote(null), 2000);
  }, [visual, hour, quality]);
  const loadVisual = useCallback(() => {
    const text = window.prompt("Wklej JSON konfiguracji wizualnej (forest-visual/1)");
    if (!text) return;
    const parsed = visualFromJson(text);
    if (!parsed) {
      setVisualNote("Nieprawidłowy JSON konfiguracji");
      setTimeout(() => setVisualNote(null), 2500);
      return;
    }
    rendererRef.current?.setVisual(parsed.config);
    if (parsed.hour !== null) changeHour(parsed.hour);
    setVisual(structuredClone(parsed.config));
    updateUrl({ preset: parsed.config.preset.toLowerCase() });
  }, [changeHour, updateUrl]);

  const applySeed = useCallback(() => {
    const n = Number(seedText);
    if (!Number.isFinite(n) || seedText.trim() === "") return;
    const seed = Math.floor(Math.abs(n)) >>> 0;
    rendererRef.current?.setWindow({ seed, sector: undefined });
    updateUrl({ seed: String(seed), sector: null });
  }, [seedText, updateUrl]);

  const pickSector = useCallback(
    (id: string) => {
      const m = /(\d+)_(\d+)$/.exec(id);
      if (!m) return;
      rendererRef.current?.setWindow({ sector: { ix: Number(m[1]), iz: Number(m[2]) } });
      updateUrl({ sector: `${m[1]}_${m[2]}` });
    },
    [updateUrl],
  );

  const runBench = useCallback(async () => {
    setBench(null);
    try {
      setBench(await rendererRef.current!.runBenchmark());
    } catch {
      /* test przerwany */
    }
  }, []);

  const copyReport = useCallback(async () => {
    const payload = JSON.stringify({ stats, quality, hour, overrides, benchmark: bench }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Skopiuj raport", payload);
    }
  }, [stats, quality, hour, overrides, bench]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Digit1") changeQuality("LOW");
      else if (e.code === "Digit2") changeQuality("MEDIUM");
      else if (e.code === "Digit3") changeQuality("HIGH");
      else if (e.code === "Digit4") changePreset("ORIGINAL");
      else if (e.code === "Digit5") changePreset("NATURAL");
      else if (e.code === "Digit6") changePreset("FAIRYTALE");
      else if (e.code === "Digit7") changeHour(7);
      else if (e.code === "Digit8") changeHour(12);
      else if (e.code === "Digit9") changeHour(19);
      else if (e.code === "KeyF") changeOverrides({ fog: !(rendererRef.current?.getOverrides().fog ?? true) });
      else if (e.code === "KeyH") changeOverrides({ shadows: !(rendererRef.current?.getOverrides().shadows ?? true) });
      else if (e.code === "KeyL") {
        const cur = rendererRef.current?.getOverrides().forceLod ?? null;
        changeOverrides({ forceLod: cur === null ? 0 : cur === 0 ? 1 : null });
      } else if (e.code === "BracketRight" || e.code === "BracketLeft") {
        const cur = rendererRef.current?.getHour() ?? DEFAULT_HOUR;
        changeHour((((cur + (e.code === "BracketRight" ? 1 : -1)) % 24) + 24) % 24);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeQuality, changeOverrides, changeHour, changePreset]);

  const lodLabel = overrides.forceLod === null ? "Auto" : `LOD${overrides.forceLod}`;

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {!lab && <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 ring-1 ring-black/30" />}

      {stats?.loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-slate-100">
          <div className="rounded-lg bg-slate-900/90 px-5 py-4 text-center shadow-xl ring-1 ring-slate-700">
            <div className="text-sm font-medium">{stats.loading}</div>
            <div className="mt-1 text-xs text-slate-400">Prototyp V2b: las z generatora W1a</div>
          </div>
        </div>
      )}
      {!stats && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-sm text-slate-300">Uruchamianie sceny 3D…</div>
      )}
      {stats?.error && (
        <div className="absolute inset-x-0 top-0 z-30 bg-red-900/90 px-4 py-2 text-sm text-red-50">Błąd: {stats.error}</div>
      )}

      {stats && !stats.loading && !stats.locked && !stats.benchmark.running && !lab && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <div className="rounded-full bg-slate-900/80 px-4 py-2 text-xs text-slate-100 ring-1 ring-slate-600 backdrop-blur">
            Kliknij w scenę, aby chodzić: WASD, mysz, Shift (bieg), Esc (zwolnij mysz)
          </div>
        </div>
      )}

      <div className="absolute left-3 top-3 z-20 w-72 rounded-lg bg-slate-950/75 p-3 text-xs shadow-lg ring-1 ring-slate-700 backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">V2b diagnostyka</span>
          <button type="button" onClick={() => setPanelOpen((v) => !v)} className="text-[11px] text-slate-400 hover:text-slate-100">
            {panelOpen ? "ukryj sterowanie" : "pokaż sterowanie"}
          </button>
        </div>
        {stats ? (
          <div className="space-y-0.5">
            <Row k="FPS (bieżący / średni)" v={`${fmt(stats.fps)} / ${fmt(stats.avgFps)}`} />
            <Row k="Czas klatki" v={`${fmt(stats.frameMs, 1)} ms`} />
            <Row k="Draw calls" v={thousands(stats.drawCalls)} />
            <Row k="Trójkąty (całość)" v={thousands(stats.triangles)} title="renderer.info: scena + cienie" />
            <Row k="Trójkąty gruntu i wody" v={thousands(stats.groundTriangles)} />
            <Row k="Widoczne instancje" v={`${thousands(stats.visibleInstances)} / ${thousands(stats.totalInstances)}`} />
            <Row k="LOD0 / LOD1" v={`${thousands(stats.lod0Instances)} / ${thousands(stats.lod1Instances)}`} />
            <Row k="Aktywne modele" v={String(stats.activeModels)} />
            <Row k="Geometrie / tekstury" v={`${stats.geometries} / ${stats.textures}`} />
            <Row k="Profil jakości" v={stats.quality} />
            <Row k="Preset wyglądu" v={`${stats.preset}${stats.presetModified ? " *" : ""}`} />
            <Row k="Seed" v={String(stats.seed)} />
            <Row k="Sektor" v={stats.sectorId.replace("sector.forest_start.", "")} title={stats.sectorId} />
            <Row k="Okno" v={`${stats.windowSectors} sektorów${stats.stress ? " (stress)" : ""}`} />
            <Row k="Pozycja (x, y, z)" v={`${fmt(stats.position.x, 1)}, ${fmt(stats.position.y, 1)}, ${fmt(stats.position.z, 1)}`} />
            {stats.fallbackModels > 0 && <div className="text-amber-300">Zastępniki zamiast modeli: {stats.fallbackModels}</div>}
          </div>
        ) : (
          <div className="text-slate-400">Brak danych…</div>
        )}
      </div>

      {panelOpen && stats && (
        <div className="absolute right-3 top-3 z-20 max-h-[calc(100dvh-1.5rem)] w-72 space-y-3 overflow-y-auto rounded-lg bg-slate-950/75 p-3 text-xs text-slate-100 shadow-lg ring-1 ring-slate-700 backdrop-blur">
          <section>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Jakość (klawisze 1 / 2 / 3)</div>
            <div className="flex gap-1">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => changeQuality(q)}
                  className={`flex-1 rounded px-2 py-1.5 font-medium ring-1 transition ${quality === q ? "bg-emerald-500/30 text-emerald-50 ring-emerald-400" : "bg-slate-800/80 text-slate-300 ring-slate-600 hover:bg-slate-700"}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-1 flex justify-between text-[11px] uppercase tracking-wide text-slate-400">
              <span>Pora dnia ([ i ])</span>
              <span className="font-mono normal-case text-slate-100">{hourLabel(hour)}</span>
            </div>
            <input type="range" min={0} max={24} step={0.25} value={hour} onChange={(e) => changeHour(Number(e.target.value) % 24)} className="w-full accent-emerald-400" />
          </section>

          <section className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">Pora dnia: szybkie porównanie (7 / 8 / 9)</div>
            <div className="flex gap-1">
              {COMPARE_HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => changeHour(h)}
                  className={`flex-1 rounded px-2 py-1 font-mono ring-1 transition ${Math.abs(hour - h) < 0.01 ? "bg-emerald-500/30 ring-emerald-400" : "bg-slate-800/80 ring-slate-600 hover:bg-slate-700"}`}
                >
                  {hourLabel(h)}
                </button>
              ))}
            </div>
          </section>

          {lab ? (
            <GrassLabPanel lab={lab} overrides={overrides} onLab={changeLab} onOverrides={changeOverrides} onClose={() => toggleLab(false)} />
          ) : (
            <button
              type="button"
              onClick={() => toggleLab(true)}
              className="w-full rounded bg-amber-500/20 px-2 py-1.5 text-[11px] font-medium text-amber-100 ring-1 ring-amber-400/50 hover:bg-amber-500/30"
              title="Tymczasowy tryb diagnostyczny: kępa trawy z bliska, kamera orbitalna, przełączniki cieni, wiatru, shaderów i normalnych"
            >
              Laboratorium trawy (diagnostyka)
            </button>
          )}

          <section className="space-y-2 rounded-md bg-slate-900/60 p-2 ring-1 ring-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Visual tuning</span>
              {stats.presetModified && <span className="text-[10px] text-amber-300">zmieniony względem {stats.preset}</span>}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {PRESET_IDS.map((id, i) => (
                <button
                  key={id}
                  type="button"
                  title={`${PRESET_HINTS[id]} (klawisz ${4 + i})`}
                  onClick={() => changePreset(id)}
                  className={`rounded px-1 py-1.5 text-[11px] font-medium ring-1 transition ${visual.preset === id ? "bg-emerald-500/30 text-emerald-50 ring-emerald-400" : "bg-slate-800/80 text-slate-300 ring-slate-600 hover:bg-slate-700"}`}
                >
                  {id}
                </button>
              ))}
            </div>
            <div className="text-[10px] leading-snug text-slate-400">{PRESET_HINTS[visual.preset]}. Presety przełączają się bez przeładowania modeli i świata.</div>
            {TUNING_KEYS.map((key) => {
              const r = TUNING_RANGES[key];
              return (
                <label key={key} className="block">
                  <span className="flex justify-between text-slate-300">
                    <span>{r.label}</span>
                    <span className="font-mono tabular-nums text-slate-100">{visual.tuning[key].toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={r.min}
                    max={r.max}
                    step={r.step}
                    value={visual.tuning[key]}
                    onChange={(e) => changeTuning({ [key]: Number(e.target.value) })}
                    className="w-full accent-emerald-400"
                  />
                </label>
              );
            })}
            <div className="flex items-center gap-2">
              <span className="text-slate-300">Kolor mgły</span>
              <input
                type="color"
                value={visual.tuning.fogTint}
                onChange={(e) => changeTuning({ fogTint: e.target.value })}
                className="h-6 w-10 cursor-pointer rounded bg-transparent"
                aria-label="Kolor mgły"
              />
              <span className="font-mono text-slate-400">{visual.tuning.fogTint}</span>
            </div>
            <label className="block">
              <span className="flex justify-between text-slate-300">
                <span>{TUNING_RANGES.fogTintAmount.label}</span>
                <span className="font-mono tabular-nums text-slate-100">{visual.tuning.fogTintAmount.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={TUNING_RANGES.fogTintAmount.min}
                max={TUNING_RANGES.fogTintAmount.max}
                step={TUNING_RANGES.fogTintAmount.step}
                value={visual.tuning.fogTintAmount}
                onChange={(e) => changeTuning({ fogTintAmount: Number(e.target.value) })}
                className="w-full accent-emerald-400"
              />
            </label>
            <div className="flex gap-1">
              <button type="button" onClick={() => changePreset(visual.preset)} className="flex-1 rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-600 hover:bg-slate-700">
                Reset do presetu
              </button>
              <button type="button" onClick={copyVisual} className="flex-1 rounded bg-emerald-600/80 px-2 py-1 font-medium text-white">
                Kopiuj JSON
              </button>
              <button type="button" onClick={loadVisual} className="rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-600 hover:bg-slate-700" title="Wczytaj zapisany JSON">
                Wczytaj
              </button>
            </div>
            {visualNote && <div className="text-[11px] text-emerald-300">{visualNote}</div>}
          </section>

          <section className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">Efekty</div>
            <div className="flex flex-wrap gap-1.5">
              <Toggle label="Mgła (F)" on={overrides.fog} onChange={(v) => changeOverrides({ fog: v })} />
              <Toggle label="Cienie (H)" on={overrides.shadows} onChange={(v) => changeOverrides({ shadows: v })} hint="LOW zawsze bez cieni" />
              <Toggle label="Wiatr" on={overrides.wind} onChange={(v) => changeOverrides({ wind: v })} />
            </div>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-slate-400">LOD (L): {lodLabel}</span>
              {LODS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  onClick={() => changeOverrides({ forceLod: l.value })}
                  className={`flex-1 rounded px-1.5 py-1 ring-1 ${overrides.forceLod === l.value ? "bg-emerald-500/30 ring-emerald-400" : "bg-slate-800/80 ring-slate-600 hover:bg-slate-700"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">Seed i sektor</div>
            <div className="flex gap-1">
              <input
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applySeed()}
                inputMode="numeric"
                className="min-w-0 flex-1 rounded bg-slate-900 px-2 py-1 font-mono ring-1 ring-slate-600 focus:ring-emerald-400"
                aria-label="Seed świata"
              />
              <button type="button" onClick={applySeed} className="rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-600 hover:bg-slate-700">
                Zastosuj
              </button>
            </div>
            <select
              value={stats.sectorId}
              onChange={(e) => pickSector(e.target.value)}
              className="w-full rounded bg-slate-900 px-2 py-1 ring-1 ring-slate-600"
              aria-label="Sektor wzorcowy"
            >
              {!stats.showcase.some((s) => s.id === stats.sectorId) && <option value={stats.sectorId}>{stats.sectorId.replace("sector.forest_start.", "")} (własny)</option>}
              {stats.showcase.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i === 0 ? "★ " : ""}
                  {s.id.replace("sector.forest_start.", "")} {s.qualifies ? "(wzorcowy)" : "(częściowo)"}
                </option>
              ))}
            </select>
            <div className="text-slate-400">
              Tryb obciążeniowy:{" "}
              <a className="text-emerald-300 underline" href={`?stress=49&q=${quality.toLowerCase()}&seed=${stats.seed}`}>
                ?stress=49
              </a>{" "}
              ·{" "}
              <a className="text-emerald-300 underline" href={`?q=${quality.toLowerCase()}&seed=${stats.seed}`}>
                zwykły
              </a>
            </div>
          </section>

          <section className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">Test FPS ({BENCHMARK_SECONDS} s)</div>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={!!stats.loading || stats.benchmark.running}
                onClick={runBench}
                className="flex-1 rounded bg-emerald-600/80 px-2 py-1.5 font-medium text-white disabled:opacity-40"
              >
                {stats.benchmark.running ? `Pomiar ${Math.round(stats.benchmark.progress * 100)}%` : "Uruchom test"}
              </button>
              <button type="button" onClick={copyReport} className="rounded bg-slate-800 px-2 py-1.5 ring-1 ring-slate-600 hover:bg-slate-700">
                {copied ? "Skopiowano" : "Kopiuj raport"}
              </button>
            </div>
            {bench && (
              <div className="space-y-0.5 rounded bg-slate-900/80 p-2">
                <Row k="Średnie FPS" v={fmt(bench.averageFps, 1)} />
                <Row k="1% low FPS" v={fmt(bench.onePercentLowFps, 1)} />
                <Row k="Mediana / p95 / max" v={`${fmt(bench.medianMs, 1)} / ${fmt(bench.p95Ms, 1)} / ${fmt(bench.maxMs, 1)} ms`} />
                <Row k="Draw calls (śr.)" v={fmt(bench.avgDrawCalls)} />
                <Row k="Trójkąty (śr.)" v={thousands(bench.avgTriangles)} />
                <div className="pt-1 text-[10px] leading-snug text-slate-400">
                  {bench.gpu} · {bench.canvas} @ {bench.pixelRatio.toFixed(2)}×
                </div>
              </div>
            )}
          </section>

          <section className="text-[11px] leading-relaxed text-slate-400">
            Klik: przechwyć mysz · WASD: ruch · Shift: bieg · Esc: zwolnij mysz (potem użyj panelu).
          </section>
        </div>
      )}
    </div>
  );
}
