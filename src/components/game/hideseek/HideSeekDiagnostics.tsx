"use client";

import { useSyncExternalStore } from "react";
import type { MultiplayerClient } from "@/lib/multiplayer/client";
import { DEV_FIELDS, hideSeekDevConfig } from "@/lib/hideseek/devConfig";
import { DiagSection } from "../DiagnosticsSection";

/**
 * Diagnostyka zabawy w chowanego (dev): bieżący stan z serwera i parametry rundy do testów. Parametry trafiają do serwera
 * przy starcie rundy, ale serwer przyjmie je tylko w trybie deweloperskim (zmienna `MIASTO_HIDESEEK_DEV=1`); zwykły
 * serwer użyje wartości domyślnych, więc lokalna manipulacja nie zmienia reguł gry.
 */
export function HideSeekDiagnostics({ multiplayer }: { multiplayer?: MultiplayerClient }) {
  useSyncExternalStore(hideSeekDevConfig.subscribe, () => hideSeekDevConfig.version, () => 0);
  const hs = multiplayer?.hs;
  const v = hs?.view ?? null;
  return (
    <DiagSection id="hideseek" summary={v ? `${v.phase} · ${v.you.role ?? "brak roli"}` : "nieaktywna"}>
      <div data-testid="diag-hideseek">
        {multiplayer ? (
          <>
            <div>faza: {v?.phase ?? "INACTIVE"} · rola: {v?.you.role ?? "-"} · rev {v?.rev ?? "-"}</div>
            <div>bramka: {v ? `${v.gate.anchor ? "kotwica" : "wolny ruch"}${v.gate.cameraDown ? " · kamera w dół" : ""}` : "-"}</div>
            <div>online (serwer): {multiplayer.online} · lampa wymuszona: {multiplayer.localLanternForced() ? "tak" : "nie"}</div>
            <div className="mt-1 text-slate-400">Parametry rundy (tylko serwer w trybie dev):</div>
            {DEV_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-2">
                <span>{f.label}</span>
                <input
                  type="number"
                  step={f.step}
                  value={hideSeekDevConfig.value(f.key)}
                  onChange={(e) => hideSeekDevConfig.set(f.key, Number(e.target.value))}
                  className="pointer-events-auto w-16 rounded bg-black/50 px-1 text-right"
                />
              </label>
            ))}
            <button type="button" onClick={() => hideSeekDevConfig.reset()} className="pointer-events-auto mt-1 rounded bg-white/15 px-2 py-0.5 hover:bg-white/25">
              Domyślne
            </button>
          </>
        ) : (
          <div>dostępne tylko online</div>
        )}
      </div>
    </DiagSection>
  );
}
