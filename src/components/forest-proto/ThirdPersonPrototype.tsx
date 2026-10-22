"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ForestRenderer, type PanelStats } from "@/lib/forest-view";
import type { QualityId } from "@/lib/assets";
import { forestEntryPose, safeForestPose } from "@/lib/game/world/generators/v2";
import { getInputHub, setFreeForest, startBrowserInput } from "@/lib/input/browser";
import type { TppConfig } from "@/lib/tpp/config";
import { resolveTppConfig } from "@/lib/tpp/storedDefaults";
import { TppDebugPanel } from "./TppDebugPanel";

const QUALITIES: QualityId[] = ["LOW", "MEDIUM", "HIGH"];

function parseQuality(q: string | null): QualityId {
  return (QUALITIES as string[]).includes(q ?? "") ? (q as QualityId) : "MEDIUM";
}

function parseNumber(v: string | null, fallback: number): number {
  const n = Number(v);
  return v !== null && Number.isFinite(n) ? n : fallback;
}

/**
 * Dev: prawdziwy las gry z postacią w trzeciej osobie. Parametry w adresie: `?seed=` (domyślnie 1), `?gen=` (2 albo 3,
 * domyślnie 3: las Pro), `?q=` (LOW, MEDIUM, HIGH). Nie dotyka zapisu gry ani zadań.
 */
export function ThirdPersonPrototype() {
  const params = useSearchParams();
  const seed = parseNumber(params.get("seed"), 1);
  const genVersion = parseNumber(params.get("gen"), 3) >= 3 ? 3 : 2;
  const quality = parseQuality(params.get("q"));
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ForestRenderer | null>(null);
  const [stats, setStats] = useState<PanelStats | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [panel, setPanel] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: ForestRenderer;
    try {
      renderer = new ForestRenderer({
        container,
        quality,
        stream: { seed, genVersion, pose: safeForestPose(seed, null), thirdPerson: { config: resolveTppConfig() } },
        onStats: setStats,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setFatal(message));
      return;
    }
    rendererRef.current = renderer;
    // Pad jak w grze i w /dev/forest: wspólny hub wejścia (lewy drążek ruch, prawy kamera, L3 bieg, ✕ skok, ○ kucanie).
    // "Wolny las" wyłącza nawigację po interfejsie, żeby drążki nie sterowały panelem.
    const stopInput = startBrowserInput();
    setFreeForest(true);
    renderer.setInputHub(getInputHub());
    return () => {
      renderer.dispose();
      rendererRef.current = null;
      setFreeForest(false);
      stopInput();
    };
  }, [seed, genVersion, quality]);

  const onConfig = useCallback((patch: Partial<TppConfig>) => rendererRef.current?.setTppConfig(patch), []);
  const onTeleportStart = useCallback(() => {
    const pose = forestEntryPose();
    rendererRef.current?.teleportTpp(pose.x, pose.z, pose.yaw);
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-3 top-3 max-w-sm space-y-1 rounded-lg bg-slate-950/70 p-3 text-xs text-slate-200 ring-1 ring-slate-700">
        <p className="font-semibold text-amber-300">TPP1: sterowanie trzecioosobowe (dev)</p>
        <p>
          W/A/S/D chód, Shift bieg, C kucanie (przełącznik), Spacja skok, mysz kamera, Esc zwalnia mysz. Kliknij w scenę, aby przechwycić mysz.
        </p>
        <p>Pad: lewy drążek ruch, prawy kamera, L3 bieg, ✕ (A) skok, ○ (B) kucanie. Działa bez klikania w scenę.</p>
        <p className="text-slate-400">
          seed {seed}, generator v{genVersion}, jakość {quality}
        </p>
        {stats?.loading ? <p className="text-amber-200">{stats.loading}</p> : null}
        {stats?.error ? <p className="text-red-300">{stats.error}</p> : null}
        {fatal ? <p className="text-red-300">{fatal}</p> : null}
      </div>
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <button type="button" onClick={() => setPanel((p) => !p)} className="rounded bg-slate-800/90 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-600 hover:bg-slate-700">
          {panel ? "Ukryj panel" : "Pokaż panel"}
        </button>
        {/* Panel dopiero po starcie renderera (po stronie klienta): czyta zapisane domyślne z localStorage, bez rozjazdu z renderem serwera. */}
        {panel && stats ? <TppDebugPanel data={stats?.tpp ?? null} fps={stats?.fps ?? 0} onConfig={onConfig} onTeleportStart={onTeleportStart} /> : null}
      </div>
    </div>
  );
}
