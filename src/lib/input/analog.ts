/**
 * Przeliczanie wychyleń analogów na ruch i obrót kamery. Czyste funkcje bez alokacji (wynik zapisują do obiektu `out`).
 */

export type Vec2 = { x: number; y: number };

/** Krzywa reakcji ruchu (lekko nieliniowa: małe wychylenie = powolne chodzenie) i kamery (precyzja przy małych wychyleniach). */
export const MOVE_CURVE = 1.35;
export const LOOK_CURVE = 1.7;

/** Prędkość obrotu przy pełnym wychyleniu i czułości 1 (rad/s). */
export const LOOK_YAW_RATE = 2.8;
export const LOOK_PITCH_RATE = 2.0;

/**
 * Radialny deadzone + krzywa. Kierunek wektora jest zachowany, długość skalowana do 0..1 (poza deadzone liczy się od
 * zera, więc ruch startuje płynnie). Zwraca długość wyniku. Wektor nigdy nie przekracza długości 1 (przekątna nie jest
 * szybsza).
 */
export function shapeStick(x: number, y: number, deadzone: number, exponent: number, out: Vec2): number {
  const raw = Math.hypot(x, y);
  const dz = Math.min(Math.max(deadzone, 0), 0.95);
  if (!(raw > dz)) {
    out.x = 0;
    out.y = 0;
    return 0;
  }
  const scaled = Math.min(1, (Math.min(raw, 1) - dz) / (1 - dz));
  const shaped = Math.pow(scaled, exponent);
  const k = shaped / raw;
  out.x = x * k;
  out.y = y * k;
  return shaped;
}

/**
 * Wejście ruchu postaci: `x` = w prawo, `y` = do przodu (oś Y pada: -1 = w górę, więc znak jest odwrócony).
 * Zwraca długość wektora ruchu (0..1).
 */
export function shapeMove(rawX: number, rawY: number, deadzone: number, out: Vec2): number {
  const m = shapeStick(rawX, rawY, deadzone, MOVE_CURVE, out);
  out.y = -out.y;
  if (out.y === 0) out.y = 0; // unika -0
  return m;
}

/** Wejście kamery: `x` w prawo, `y` w dół (jak oś pada); odwrócenie osi Y zmienia znak `y`. */
export function shapeLook(rawX: number, rawY: number, deadzone: number, invertY: boolean, out: Vec2): number {
  const m = shapeStick(rawX, rawY, deadzone, LOOK_CURVE, out);
  if (invertY) out.y = -out.y;
  return m;
}

export function yawRate(sensitivityX: number): number {
  return LOOK_YAW_RATE * sensitivityX;
}

export function pitchRate(sensitivityY: number): number {
  return LOOK_PITCH_RATE * sensitivityY;
}

export type MoveInputLike = { forward: number; right: number; sprint: boolean };

/**
 * Łączy ruch z klawiatury i pada w jedno wejście (bez sumowania): jeśli wciśnięty jest jakikolwiek klawisz ruchu,
 * obowiązuje klawiatura; w przeciwnym razie pad. Bieg z pada dotyczy tylko ruchu (L3 bez wychylenia nic nie robi).
 * Zawieszenie (okno, dialog) zeruje oba źródła.
 */
export function mergeMove(
  keyForward: number,
  keyRight: number,
  keySprint: boolean,
  padX: number,
  padY: number,
  padSprint: boolean,
  suspended: boolean,
  out: MoveInputLike,
): MoveInputLike {
  if (suspended) {
    out.forward = 0;
    out.right = 0;
    out.sprint = false;
    return out;
  }
  if (keyForward !== 0 || keyRight !== 0) {
    out.forward = keyForward;
    out.right = keyRight;
    out.sprint = keySprint;
    return out;
  }
  const moving = padX !== 0 || padY !== 0;
  out.forward = padY;
  out.right = padX;
  out.sprint = keySprint && moving ? true : padSprint && moving;
  return out;
}
