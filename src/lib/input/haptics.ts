/**
 * Bardzo delikatne sprzężenie zwrotne (opcjonalne). Żadna mechanika nie zależy od wibracji: brak wsparcia przeglądarki
 * lub kontrolera kończy się cichym brakiem efektu.
 */

export type HapticKind = "chest" | "item" | "bridge";

type Preset = { duration: number; weak: number; strong: number };

export const HAPTIC_PRESETS: Record<HapticKind, Preset> = {
  chest: { duration: 90, weak: 0.25, strong: 0.1 },
  item: { duration: 130, weak: 0.3, strong: 0.15 },
  bridge: { duration: 280, weak: 0.35, strong: 0.3 },
};

type Actuator = {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> | unknown;
  pulse?: (value: number, duration: number) => Promise<unknown> | unknown;
};

/** Zwraca true, jeśli efekt został zlecony. */
export function playHaptic(actuator: unknown, kind: HapticKind, enabled: boolean): boolean {
  if (!enabled || !actuator || typeof actuator !== "object") return false;
  const a = actuator as Actuator;
  const p = HAPTIC_PRESETS[kind];
  try {
    if (typeof a.playEffect === "function") {
      const r = a.playEffect("dual-rumble", { startDelay: 0, duration: p.duration, weakMagnitude: p.weak, strongMagnitude: p.strong });
      if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
      return true;
    }
    if (typeof a.pulse === "function") {
      const r = a.pulse(Math.max(p.weak, p.strong), p.duration);
      if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
      return true;
    }
  } catch {
    // wibracje są opcjonalne
  }
  return false;
}
