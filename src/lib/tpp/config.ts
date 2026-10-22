/**
 * Konfiguracja sterowania trzecioosobowego (TPP). Jedyne miejsce z liczbami: kontroler, kamera i animacje czytają
 * wyłącznie `TppConfig`, a panel deweloperski zmienia je na żywo. Jednostki: metry, sekundy, radiany (kąty kamery w stopniach).
 */
export type TppConfig = {
  // Ruch (m/s, m/s^2, rad/s)
  walkSpeed: number;
  runSpeed: number;
  crouchSpeed: number;
  acceleration: number;
  deceleration: number;
  /** Maksymalna prędkość obrotu postaci (rad/s). */
  turnSpeed: number;
  /** Sterowanie w powietrzu względem ziemi (0-1). */
  airControl: number;
  // Skok
  jumpHeight: number;
  gravity: number;
  // Kapsuła i postać (m)
  characterHeight: number;
  standHeight: number;
  crouchHeight: number;
  /** Czas zmiany wysokości kapsuły przy kucaniu i wstawaniu (s). */
  crouchTransition: number;
  // Kamera
  cameraDistance: number;
  /** Początkowy kąt patrzenia w dół (stopnie). */
  cameraPitchDeg: number;
  cameraMinPitchDeg: number;
  cameraMaxPitchDeg: number;
  /** Wysokość punktu, na który patrzy kamera (nad stopami stojącej postaci, m). */
  cameraTargetHeight: number;
  /** Przesunięcie kamery w prawo (m), 0 = za plecami. */
  cameraShoulder: number;
  /** Radiany na piksel ruchu myszy. */
  cameraSensitivity: number;
  /** Stała czasowa podążania kamery za postacią (s); 0 = bez wygładzania. */
  cameraSmoothness: number;
  /** Stała czasowa wygładzania obrotu kamery (s); 0 = bez wygładzania. */
  cameraRotationSmoothness: number;
  cameraMinDistance: number;
  /** Zapas nad terenem i przeszkodami (m). */
  cameraMargin: number;
  // Animacje
  /** Czas płynnego przejścia między animacjami ruchu (s). */
  animCrossfade: number;
  /** Czas przejścia stanie <-> kucanie (s). */
  animCrouchFade: number;
  /** Prędkość (m/s), przy której klip odtwarza się w tempie nominalnym (synchronizacja kroków). */
  nominalWalk: number;
  nominalRun: number;
  nominalCrouch: number;
  /** Zakres skalowania tempa klipów. */
  animMinTimeScale: number;
  animMaxTimeScale: number;
  /** Korekta obrotu modelu wokół osi pionowej (stopnie): 0 albo 180, gdy przód modelu jest odwrócony. */
  modelYawDeg: number;
};

export const TPP_DEFAULTS: Readonly<TppConfig> = {
  walkSpeed: 2.2,
  runSpeed: 4.8,
  crouchSpeed: 1.0,
  acceleration: 14,
  deceleration: 18,
  turnSpeed: 12,
  airControl: 0.35,
  jumpHeight: 1.5,
  gravity: 12,
  characterHeight: 1.55,
  standHeight: 1.55,
  crouchHeight: 1.0,
  crouchTransition: 0.2,
  cameraDistance: 2.35,
  cameraPitchDeg: 15,
  cameraMinPitchDeg: -35,
  cameraMaxPitchDeg: 70,
  cameraTargetHeight: 1.25,
  cameraShoulder: 0.3,
  cameraSensitivity: 0.0022,
  cameraSmoothness: 0.08,
  cameraRotationSmoothness: 0.03,
  cameraMinDistance: 0.6,
  cameraMargin: 0.25,
  animCrossfade: 0.2,
  animCrouchFade: 0.25,
  nominalWalk: 1.5,
  nominalRun: 3.6,
  nominalCrouch: 0.9,
  animMinTimeScale: 0.6,
  animMaxTimeScale: 1.8,
  modelYawDeg: 0,
};

/** Granice suwaków panelu deweloperskiego (min, max, krok, etykieta). */
export const TPP_RANGES: Readonly<Partial<Record<keyof TppConfig, { min: number; max: number; step: number; label: string }>>> = {
  walkSpeed: { min: 0.5, max: 5, step: 0.05, label: "Walk Speed (m/s)" },
  runSpeed: { min: 1, max: 9, step: 0.05, label: "Run Speed (m/s)" },
  crouchSpeed: { min: 0.3, max: 3, step: 0.05, label: "Crouch Speed (m/s)" },
  acceleration: { min: 2, max: 60, step: 0.5, label: "Acceleration" },
  deceleration: { min: 2, max: 60, step: 0.5, label: "Deceleration" },
  turnSpeed: { min: 2, max: 30, step: 0.5, label: "Character Turn Speed (rad/s)" },
  cameraDistance: { min: 1.5, max: 9, step: 0.05, label: "Camera Distance (m)" },
  cameraTargetHeight: { min: 0.6, max: 2.2, step: 0.01, label: "Camera Height / Target Height (m)" },
  cameraSensitivity: { min: 0.0005, max: 0.008, step: 0.0001, label: "Camera Sensitivity" },
  cameraSmoothness: { min: 0, max: 0.4, step: 0.005, label: "Camera Smoothness (s)" },
  animCrossfade: { min: 0.02, max: 0.6, step: 0.01, label: "Animation Crossfade (s)" },
  jumpHeight: { min: 0.2, max: 3, step: 0.05, label: "Jump Height (m)" },
  gravity: { min: 6, max: 40, step: 0.5, label: "Gravity (m/s^2)" },
  nominalWalk: { min: 0.6, max: 3, step: 0.05, label: "Walk clip nominal speed" },
  nominalRun: { min: 1.5, max: 7, step: 0.05, label: "Run clip nominal speed" },
  nominalCrouch: { min: 0.4, max: 2, step: 0.05, label: "Crouch clip nominal speed" },
};

/** Łączy częściową zmianę z konfiguracją, odrzucając wartości nieskończone i spoza rozsądnych granic. */
export function mergeTppConfig(base: TppConfig, patch: Partial<TppConfig>): TppConfig {
  const out = { ...base };
  for (const key of Object.keys(patch) as (keyof TppConfig)[]) {
    const v = patch[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const range = TPP_RANGES[key];
    out[key] = range ? Math.min(range.max, Math.max(range.min, v)) : v;
  }
  return out;
}
