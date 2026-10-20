export type AudioFile = { url: string; type: string; bytes: number };

export type AudioAssetEntry = {
  id: string;
  role: "ambience" | "bird" | "event" | "footsteps";
  channels: number;
  loop: boolean;
  seconds: number;
  frames: number;
  files: AudioFile[];
  /** Kroki: numer wariantu (1-4) i pomiary wyrównania poziomów z potoku `assets:audio`. */
  variant?: number;
  level?: { rmsDb: number; peakDb: number; appliedGainDb: number; targetRmsDb: number };
};

export type AudioManifest = {
  version: 1;
  sampleRate: number;
  assets: Record<string, AudioAssetEntry>;
};

export const MANIFEST_URL = "/audio/audio.json";

export const AMBIENCE_DAY = "ambience.day";
export const AMBIENCE_NIGHT = "ambience.night";
export const WOLVES = "event.wolves";

export function isAudioManifest(value: unknown): value is AudioManifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<AudioManifest>;
  return m.version === 1 && typeof m.assets === "object" && m.assets !== null;
}
