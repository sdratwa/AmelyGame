"use client";

import type { AudioDiagnostics as Diagnostics } from "@/lib/audio/controller";

export type AudioSnapshot = { diag: Diagnostics; at: number };

/** Stan trolla z warstwy NPC (animacja i kroki), pokazywany obok pomiarów dźwięku. */
export type TrollAudioInfo = { state: string; stepping: boolean; distance: number; visible: boolean };

const sampleLabel = (n: number | null) => (n === null ? "-" : `#${n}`);

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
  troll = null,
  onPreviewSteps,
  onSetStepVolume,
}: {
  snapshot: AudioSnapshot | null;
  onSetHour: (hour: number) => void;
  onTestWolves: () => void;
  troll?: TrollAudioInfo | null;
  onPreviewSteps?: (owner: "player" | "npc") => void;
  onSetStepVolume?: (owner: "player" | "npc", value: number) => void;
}) {
  const dev = process.env.NODE_ENV !== "production";
  const d = snapshot?.diag ?? null;
  const last = d?.lastEffect ?? null;
  const ago = last && snapshot ? Math.max(0, (snapshot.at - last.at) / 1000) : null;
  const side = last ? (Math.abs(last.bearingDeg) < 30 ? "z przodu" : Math.abs(last.bearingDeg) > 150 ? "z tyłu" : last.bearingDeg > 0 ? "z prawej" : "z lewej") : "";

  return (
    <div data-testid="audio-diagnostics">
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
            efekty aktywne {d.activeEffects} · głosy kroków {d.activeSteps} · próbki kroków {d.steps.loaded}/{d.steps.total}
            {d.steps.ready ? "" : " (ładowanie)"}
          </div>
          <div data-testid="audio-steps-player">
            GRACZ: {d.running ? "bieg" : d.walking ? "chód" : "stoi"} · ostatnia próbka {sampleLabel(d.steps.player.last)} · kroki {d.steps.player.count} ·{" "}
            {d.steps.player.perSecond.toFixed(2)}/s · nawierzchnia {d.steps.player.surfaceLabel}
          </div>
          <div data-testid="audio-steps-troll">
            TROLL: {troll && troll.visible ? `${troll.distance.toFixed(1)} m od gracza` : "poza zasięgiem"} · animacja {troll?.state ?? "-"}
            {troll?.stepping ? " (kroki)" : ""} · ostatnia próbka {sampleLabel(d.steps.npc.last)}
            {d.steps.npc.lastFoot ? ` (${d.steps.npc.lastFoot})` : ""} · kroki {d.steps.npc.count} · tłumienie{" "}
            {d.steps.npc.lastAttenuationDb === null ? "-" : `${d.steps.npc.lastAttenuationDb.toFixed(1)} dB`}
            {d.steps.npc.lastBearingDeg === null ? "" : ` · kierunek ${d.steps.npc.lastBearingDeg}°`} · emiter {d.steps.npc.emitterActive ? "aktywny" : "cichy"}
            {d.steps.npc.culled > 0 ? ` · pominięte (za daleko) ${d.steps.npc.culled}` : ""}
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
      {dev && d?.active && (
        <div className="mt-1 space-y-1" data-testid="audio-step-tools">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              data-testid="audio-preview-steps"
              disabled={!d.steps.ready || d.steps.previewing}
              onClick={() => onPreviewSteps?.("player")}
              className="pointer-events-auto rounded bg-emerald-400 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50"
            >
              ODSŁUCH KROKÓW 1-4
            </button>
            <button
              type="button"
              data-testid="audio-preview-troll-steps"
              disabled={!d.steps.ready || d.steps.previewing}
              onClick={() => onPreviewSteps?.("npc")}
              className="pointer-events-auto rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-50"
            >
              ODSŁUCH KROKÓW TROLLA
            </button>
          </div>
          {(["player", "npc"] as const).map((owner) => (
            <label key={owner} className="pointer-events-auto flex items-center gap-2">
              <span className="w-32">{owner === "player" ? "PLAYER FOOTSTEPS" : "NPC FOOTSTEPS"}</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={d.steps.volumes[owner]}
                data-testid={`audio-volume-${owner}`}
                onChange={(e) => onSetStepVolume?.(owner, Number(e.target.value))}
                className="h-1 w-24 accent-emerald-400"
              />
              <span className="w-8 tabular-nums">{d.steps.volumes[owner].toFixed(2)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
