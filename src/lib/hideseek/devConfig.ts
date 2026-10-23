import { DEFAULT_HIDESEEK_CONFIG } from "./config";
import type { HideSeekConfig } from "./types";

/** Parametry zabawy dostępne wyłącznie w Diagnostyce (testy i rozwój); nie są zapisywane i nie należą do zwykłych ustawień. */
export type HideSeekDevConfig = Partial<Omit<HideSeekConfig, "seekMinutes">>;

export const DEV_FIELDS: readonly { key: keyof Omit<HideSeekConfig, "seekMinutes">; label: string; step: number }[] = [
  { key: "maxFailed", label: "Limit błędnych prób", step: 1 },
  { key: "joinSeconds", label: "Czas dołączania (s)", step: 1 },
  { key: "hideSeconds", label: "Czas chowania (s)", step: 1 },
  { key: "areaRadius", label: "Promień obszaru (m)", step: 1 },
  { key: "findDistance", label: "Dystans odnalezienia (m)", step: 0.5 },
  { key: "lampHintSeconds", label: "Lampy w ostatnich (s)", step: 1 },
];

let current: HideSeekDevConfig = {};
const listeners = new Set<() => void>();
let version = 0;

export const hideSeekDevConfig = {
  get(): HideSeekDevConfig {
    return current;
  },
  /** Wartość z Diagnostyki albo domyślna. */
  value(key: keyof Omit<HideSeekConfig, "seekMinutes">): number {
    return current[key] ?? DEFAULT_HIDESEEK_CONFIG[key];
  },
  set(key: keyof Omit<HideSeekConfig, "seekMinutes">, value: number): void {
    if (!Number.isFinite(value)) return;
    current = { ...current, [key]: value };
    version++;
    for (const l of listeners) l();
  },
  reset(): void {
    current = {};
    version++;
    for (const l of listeners) l();
  },
  get version(): number {
    return version;
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
