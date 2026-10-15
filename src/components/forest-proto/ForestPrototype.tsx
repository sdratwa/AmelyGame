"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QualityId } from "@/lib/assets";
import {
  BENCHMARK_SECONDS,
  DEFAULT_HOUR,
  DEFAULT_OVERRIDES,
  DEFAULT_SEED,
  ForestRenderer,
  parseSectorParam,
  stressRadius,
  type BenchmarkReport,
  type PanelStats,
  type ViewOverrides,
} from "@/lib/forest-view";

const QUALITIES: QualityId[] = ["LOW", "MEDIUM", "HIGH"];
const LODS: { value: ViewOverrides["forceLod"]; label: string }[] = [
  { value: null, label: "Auto" },
  { value: 0, label: "LOD0" },
  { value: 1, label: "LOD1" },
];

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
  const [seedText, setSeedText] = useState(() => params.get("seed") ?? String(DEFAULT_SEED));
  const [bench, setBench] = useState<BenchmarkReport | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const stress = useMemo(() => {
    const n = Number(params.get("stress"));
    return params.get("stress") ? stressRadius(n) : null;
  }, [params]);

  const initial = useRef({ quality, hour, overrides, params, stress });

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
      window: {
        seed: init.params.get("seed") !== null && Number.isFinite(seed) ? seed >>> 0 : DEFAULT_SEED,
        sector: parseSectorParam(init.params.get("sector")) ?? undefined,
        radius: init.stress ?? 1,
      },
      onStats: setStats,
    });
    rendererRef.current = renderer;
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
  }, [changeQuality, changeOverrides, changeHour]);

  const lodLabel = overrides.forceLod === null ? "Auto" : `LOD${overrides.forceLod}`;

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 ring-1 ring-black/30" />

      {stats?.loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-slate-100">
          <div className="rounded-lg bg-slate-900/90 px-5 py-4 text-center shadow-xl ring-1 ring-slate-700">
            <div className="text-sm font-medium">{stats.loading}</div>
            <div className="mt-1 text-xs text-slate-400">Prototyp V2a: las z generatora W1a</div>
          </div>
        </div>
      )}
      {!stats && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950 text-sm text-slate-300">Uruchamianie sceny 3D…</div>
      )}
      {stats?.error && (
        <div className="absolute inset-x-0 top-0 z-30 bg-red-900/90 px-4 py-2 text-sm text-red-50">Błąd: {stats.error}</div>
      )}

      {stats && !stats.loading && !stats.locked && !stats.benchmark.running && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <div className="rounded-full bg-slate-900/80 px-4 py-2 text-xs text-slate-100 ring-1 ring-slate-600 backdrop-blur">
            Kliknij w scenę, aby chodzić: WASD, mysz, Shift (bieg), Esc (zwolnij mysz)
          </div>
        </div>
      )}

      <div className="absolute left-3 top-3 z-20 w-72 rounded-lg bg-slate-950/75 p-3 text-xs shadow-lg ring-1 ring-slate-700 backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">V2a diagnostyka</span>
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
