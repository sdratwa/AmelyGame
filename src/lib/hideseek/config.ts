import type { HideSeekConfig } from "./types";

export const DEFAULT_HIDESEEK_CONFIG: Readonly<HideSeekConfig> = Object.freeze({
  seekMinutes: 5,
  joinSeconds: 30,
  hideSeconds: 60,
  maxFailed: 3,
  areaRadius: 50,
  findDistance: 3,
  lampHintSeconds: 30,
  inviteTimeoutSeconds: 60,
  graceSeconds: 20,
  findCooldownMs: 1000,
});

export const SEEK_MINUTES = { min: 1, max: 15, step: 1 } as const;

/** Rozbłysk lampy (s) i przerwa (s): losowane równomiernie z tych przedziałów dla każdego ukrywającego osobno. */
export const LAMP_ON_SECONDS: readonly [number, number] = [2, 3];
export const LAMP_OFF_SECONDS: readonly [number, number] = [5, 10];

/** Granice parametrów deweloperskich (Diagnostyka); poza `seekMinutes` serwer przyjmuje je tylko przy `allowDev`. */
const DEV_LIMITS: Record<Exclude<keyof HideSeekConfig, "seekMinutes">, readonly [number, number]> = {
  joinSeconds: [2, 120],
  hideSeconds: [5, 180],
  maxFailed: [1, 10],
  areaRadius: [10, 100],
  findDistance: [0.5, 10],
  lampHintSeconds: [2, 120],
  inviteTimeoutSeconds: [5, 300],
  graceSeconds: [1, 120],
  findCooldownMs: [0, 5000],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampSeekMinutes(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_HIDESEEK_CONFIG.seekMinutes;
  return clamp(n, SEEK_MINUTES.min, SEEK_MINUTES.max);
}

/**
 * Parametry obowiązujące w rundzie zatwierdza serwer przy jej rozpoczęciu. Zwykły klient wpływa tylko na `seekMinutes`;
 * resztę (dystans, limit błędów, promień...) serwer przyjmie jedynie w trybie deweloperskim (`allowDev`), po przycięciu do granic.
 */
export function resolveConfig(requested: unknown, allowDev: boolean): HideSeekConfig {
  const base: HideSeekConfig = { ...DEFAULT_HIDESEEK_CONFIG };
  const o = requested && typeof requested === "object" ? (requested as Record<string, unknown>) : {};
  base.seekMinutes = clampSeekMinutes(o.seekMinutes);
  if (!allowDev) return base;
  for (const key of Object.keys(DEV_LIMITS) as (keyof typeof DEV_LIMITS)[]) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      const [lo, hi] = DEV_LIMITS[key];
      base[key] = clamp(v, lo, hi);
    }
  }
  base.maxFailed = Math.round(base.maxFailed);
  return base;
}
