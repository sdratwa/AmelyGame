"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ForestRenderer, type PanelStats } from "@/lib/forest-view";
import type { QualityId } from "@/lib/assets";
import type { ForestPose, ItemId } from "@/lib/game/engine";
import { safeForestPose } from "@/lib/game/world/generators/v2";
import { cn } from "@/lib/utils";
import { ForestHand } from "./ForestHand";

const POSE_REPORT_MS = 2000;
/** Esc zwalnia mysz (przeglądarka), a dopiero kolejne Esc opuszcza las; ta zwłoka chroni przed przypadkowym wyjściem. */
const ESC_GUARD_MS = 700;

export const QUALITY_LABEL: Record<QualityId, string> = { LOW: "Niska", MEDIUM: "Średnia", HIGH: "Wysoka" };
const QUALITIES: readonly QualityId[] = ["LOW", "MEDIUM", "HIGH"];

export type ForestWorldViewProps = {
  seed: number;
  /** Zapisana pozycja; niepoprawna (np. wewnątrz drzewa) zostanie zastąpiona punktem wejścia. */
  startPose: ForestPose | null;
  bridgeBuilt: boolean;
  /** Godzina z zegara gry (ułamkowa, 0-24). */
  hour: number;
  quality: QualityId;
  onQualityChange: (quality: QualityId) => void;
  held: ItemId | null;
  /** Panel (dziennik, dialog) zawiesza sterowanie. */
  suspended: boolean;
  onPose: (pose: ForestPose) => void;
  onLeave: () => void;
  onLoadingChange: (loading: boolean) => void;
};

function DiagnosticsPanel({ stats }: { stats: PanelStats }) {
  const s = stats.stream;
  return (
    <div data-testid="forest-diagnostics" className="pointer-events-none max-w-xs rounded-lg bg-black/60 p-2 font-mono text-[11px] leading-snug text-slate-100">
      <div>
        FPS {stats.fps.toFixed(0)} ({stats.frameMs.toFixed(1)} ms) · jakość {stats.quality}
      </div>
      <div>
        poz. x {stats.position.x.toFixed(1)} z {stats.position.z.toFixed(1)}
      </div>
      {s && (
        <>
          <div>
            sektor {s.center} · załadowane {s.resident}/{s.wanted} · w kolejce {s.queued}
          </div>
          <div>
            instancje {stats.visibleInstances}/{s.instances} · cache płytek {s.cachedTiles}
          </div>
        </>
      )}
      <div>
        draw calls {stats.drawCalls} · trójkąty {(stats.triangles / 1000).toFixed(0)} tys.
      </div>
    </div>
  );
}

export function ForestWorldView({
  seed,
  startPose,
  bridgeBuilt,
  hour,
  quality,
  onQualityChange,
  held,
  suspended,
  onPose,
  onLeave,
  onLoadingChange,
}: ForestWorldViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ForestRenderer | null>(null);
  const [stats, setStats] = useState<PanelStats | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [pose] = useState(() => safeForestPose(seed, startPose, bridgeBuilt));
  const initial = useRef({ pose, quality, hour, bridgeBuilt });
  const ready = useRef(false);
  const callbacks = useRef({ onPose, onLeave });
  const guard = useRef({ suspended, suspendedEnd: 0, unlockedAt: 0, locked: false });

  useEffect(() => {
    callbacks.current = { onPose, onLeave };
  }, [onPose, onLeave]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const init = initial.current;
    let renderer: ForestRenderer;
    try {
      renderer = new ForestRenderer({
        container,
        quality: init.quality,
        hour: init.hour,
        stream: { seed, pose: init.pose, bridgeBuilt: init.bridgeBuilt },
        onStats: setStats,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setFatal(message));
      return;
    }
    rendererRef.current = renderer;
    ready.current = false;
    const report = () => {
      const p = renderer.getPose();
      if (p && ready.current) callbacks.current.onPose(p);
    };
    const id = setInterval(report, POSE_REPORT_MS);
    return () => {
      clearInterval(id);
      report();
      rendererRef.current = null;
      renderer.dispose();
    };
  }, [seed]);

  const loading = !fatal && (stats === null || stats.loading !== null) && !stats?.error;
  useEffect(() => {
    ready.current = !loading && !fatal && !stats?.error;
  }, [loading, fatal, stats?.error]);
  useEffect(() => {
    onLoadingChange(loading);
    return () => onLoadingChange(false);
  }, [loading, onLoadingChange]);

  useEffect(() => rendererRef.current?.setHour(hour), [hour]);
  useEffect(() => rendererRef.current?.setQuality(quality), [quality]);
  useEffect(() => rendererRef.current?.setBridgeBuilt(bridgeBuilt), [bridgeBuilt]);
  useEffect(() => {
    rendererRef.current?.setSuspended(suspended);
    const g = guard.current;
    if (g.suspended && !suspended) g.suspendedEnd = performance.now();
    g.suspended = suspended;
  }, [suspended]);

  const locked = stats?.locked ?? false;
  useEffect(() => {
    const g = guard.current;
    if (g.locked && !locked) g.unlockedAt = performance.now();
    g.locked = locked;
  }, [locked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F3") {
        e.preventDefault();
        setDebug((d) => !d);
        return;
      }
      if (e.key !== "Escape") return;
      const g = guard.current;
      const now = performance.now();
      if (g.locked || g.suspended || now - g.unlockedAt < ESC_GUARD_MS || now - g.suspendedEnd < ESC_GUARD_MS) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      callbacks.current.onLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const error = fatal ?? stats?.error ?? null;
  const percent = Math.round((stats?.loadProgress ?? 0) * 100);

  return (
    <section data-testid="forest-view" className="relative h-full w-full overflow-hidden bg-slate-900">
      <div ref={containerRef} data-testid="forest-canvas" className="absolute inset-0" />

      {!loading && !error && <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" aria-hidden />}

      <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2 sm:left-5 sm:top-5">
        <Button data-testid="leave-forest" variant="secondary" onClick={onLeave}>
          ← Wróć do miasta
        </Button>
        <div className="flex items-center gap-1 rounded-lg bg-black/45 p-1 backdrop-blur" role="group" aria-label="Jakość grafiki lasu">
          {QUALITIES.map((q) => (
            <button
              key={q}
              type="button"
              data-testid={`quality-${q}`}
              aria-pressed={quality === q}
              onClick={() => onQualityChange(q)}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition",
                quality === q ? "bg-emerald-500 text-emerald-950" : "text-slate-200 hover:bg-white/10",
              )}
            >
              {QUALITY_LABEL[q]}
            </button>
          ))}
        </div>
        {!loading && !error && (
          <p className="hidden max-w-[17rem] rounded-lg bg-black/45 px-3 py-2 text-xs text-white backdrop-blur sm:block">
            WASD – chodzenie, Shift – bieg, mysz – rozglądanie. Esc zwalnia mysz, J – dziennik, F3 – diagnostyka.
          </p>
        )}
        {debug && stats && <DiagnosticsPanel stats={stats} />}
      </div>

      {!loading && !error && !locked && !suspended && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center">
          <p data-testid="forest-click-hint" className="rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur">
            Kliknij w scenę, aby sterować myszą
          </p>
        </div>
      )}

      {loading && (
        <div data-testid="forest-loading" role="status" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center">
          <p className="text-lg font-semibold text-white">Wchodzisz do lasu…</p>
          <div className="h-2.5 w-64 overflow-hidden rounded-full bg-slate-700" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-emerald-400 transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-slate-400">{stats?.loading ?? "Przygotowanie sceny"}</p>
        </div>
      )}

      {error && (
        <div data-testid="forest-error" role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-6 text-center">
          <p className="text-lg font-semibold text-red-300">Nie udało się wczytać lasu</p>
          <p className="max-w-md text-sm text-slate-300">{error}</p>
          <p className="max-w-md text-xs text-slate-500">Las wymaga przeglądarki z włączoną akceleracją WebGL. Postęp gry jest bezpieczny, możesz wrócić do miasta.</p>
          <Button onClick={onLeave}>Wróć do miasta</Button>
        </div>
      )}

      {!loading && !error && <ForestHand item={held} />}
    </section>
  );
}
