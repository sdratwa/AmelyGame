"use client";

import type { AudioDiagnostics as Diagnostics } from "@/lib/audio/controller";

export type AudioSnapshot = { diag: Diagnostics; at: number };

const PRESETS: { id: string; label: string; hour: number }[] = [
  { id: "dawn", label: "ŚWIT 06:00", hour: 6 },
  { id: "day", label: "DZIEŃ 12:00", hour: 12 },
  { id: "dusk", label: "ZMIERZCH 19:30", hour: 19.5 },
  { id: "night", label: "NOC 01:00", hour: 1 },
];

function formatHour(hour: number): string {
  const total = Math.floor(hour * 60 + 1e-6);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Sekcja AUDIO panelu diagnostycznego (O / F3). Przyciski zmiany godziny i testu wilków tylko w trybie deweloperskim. */
export function AudioDiagnostics({
  snapshot,
  onSetHour,
  onTestWolves,
}: {
  snapshot: AudioSnapshot | null;
  onSetHour: (hour: number) => void;
  onTestWolves: () => void;
}) {
  const dev = process.env.NODE_ENV !== "production";
  const d = snapshot?.diag ?? null;
  const last = d?.lastEffect ?? null;
  const ago = last && snapshot ? Math.max(0, (snapshot.at - last.at) / 1000) : null;
  const side = last ? (Math.abs(last.bearingDeg) < 30 ? "z przodu" : Math.abs(last.bearingDeg) > 150 ? "z tyłu" : last.bearingDeg > 0 ? "z prawej" : "z lewej") : "";

  return (
    <div data-testid="audio-diagnostics" className="mt-1 border-t border-white/20 pt-1">
      <div className="font-semibold">AUDIO</div>
      {!d || !d.active ? (
        <div>{d?.error ? `błąd: ${d.error}` : "nieaktywne (poza lasem)"}</div>
      ) : (
        <>
          <div>
            godzina gry {formatHour(d.hour)} ({d.phase}) · kontekst {d.contextState}
          </div>
          <div>tło: {d.background}</div>
          <div>
            głośność pętli: dzień {d.dayGain.toFixed(2)} · noc {d.nightGain.toFixed(2)}
            {d.muted ? " · WYCISZONE" : ""}
          </div>
          <div>
            efekty aktywne {d.activeEffects} · kroki {d.activeSteps} ({d.running ? "bieg" : d.walking ? "chód" : "stoi"}, {d.footsteps})
          </div>
          <div data-testid="audio-last-effect">
            ostatni efekt:{" "}
            {last && ago !== null
              ? `${last.label} · ${last.distance.toFixed(0)} m ${side} · ton ${last.rate.toFixed(2)} · ${ago.toFixed(0)} s temu`
              : "brak"}
          </div>
          <div data-testid="audio-wolves">
            wilki: ostatnio północ doby {d.wolvesLastMidnight === null ? "brak" : d.wolvesLastMidnight}
            {d.lastMidnight ? ` · północ ${d.lastMidnight.midnight}: ${d.lastMidnight.result}` : ""}
          </div>
          <div>
            tryb: {d.mode.dialog ? "dialog (cichy ambient)" : d.mode.frozen ? "ruch zablokowany" : "normalny"} · wczytane {d.loaded.length}
          </div>
        </>
      )}
      {dev && (
        <div className="mt-1 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid={`audio-time-${p.id}`}
              onClick={() => onSetHour(p.hour)}
              className="pointer-events-auto rounded bg-sky-500 px-1.5 py-0.5 text-[10px] font-semibold text-sky-950 hover:bg-sky-400"
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            data-testid="audio-test-wolves"
            onClick={onTestWolves}
            className="pointer-events-auto rounded bg-violet-400 px-1.5 py-0.5 text-[10px] font-semibold text-violet-950 hover:bg-violet-300"
          >
            TEST WILKÓW
          </button>
        </div>
      )}
    </div>
  );
}
