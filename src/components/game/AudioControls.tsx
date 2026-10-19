"use client";

import { useState, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { getForestAudio } from "@/lib/audio/controller";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "@/lib/audio/settings";
import { cn } from "@/lib/utils";

const SLIDERS: { key: "master" | "ambience" | "effects"; label: string }[] = [
  { key: "master", label: "Głośność główna" },
  { key: "ambience", label: "Ambient" },
  { key: "effects", label: "Efekty" },
];

function useAudioSettings(): AudioSettings {
  const audio = getForestAudio();
  return useSyncExternalStore(
    (listener) => audio.subscribe(listener),
    () => audio.getSettings(),
    () => DEFAULT_AUDIO_SETTINGS,
  );
}

/** Mały panel dźwięku w lesie: wyciszenie oraz głośność główna, ambientu i efektów (zapamiętywane). */
export function AudioControls() {
  const settings = useAudioSettings();
  const [open, setOpen] = useState(false);
  const audio = getForestAudio();
  const Icon = settings.muted ? VolumeX : Volume2;

  return (
    <div data-testid="audio-controls" className="flex flex-col items-start gap-1">
      <button
        type="button"
        data-testid="audio-toggle"
        aria-expanded={open}
        aria-label="Ustawienia dźwięku"
        onClick={(e) => {
          setOpen((o) => !o);
          e.currentTarget.blur();
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium backdrop-blur transition",
          open ? "bg-emerald-500 text-emerald-950" : "bg-black/45 text-slate-200 hover:bg-white/15",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        Dźwięk{settings.muted ? " (wyciszony)" : ""}
      </button>
      {open && (
        <div data-testid="audio-panel" className="w-56 space-y-2 rounded-lg bg-black/60 p-3 text-xs text-white backdrop-blur">
          <button
            type="button"
            data-testid="audio-mute"
            aria-pressed={settings.muted}
            onClick={(e) => {
              audio.updateSettings({ muted: !settings.muted });
              e.currentTarget.blur();
            }}
            className={cn("w-full rounded px-2 py-1 font-semibold transition", settings.muted ? "bg-amber-400 text-amber-950" : "bg-white/15 hover:bg-white/25")}
          >
            {settings.muted ? "Włącz dźwięk" : "Wycisz wszystko"}
          </button>
          {SLIDERS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="mb-0.5 flex justify-between text-slate-200">
                {label}
                <span className="tabular-nums">{Math.round(settings[key] * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(settings[key] * 100)}
                data-testid={`audio-${key}`}
                disabled={settings.muted}
                onChange={(e) => audio.updateSettings({ [key]: Number(e.target.value) / 100 })}
                onPointerUp={(e) => e.currentTarget.blur()}
                className="w-full accent-emerald-400"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
