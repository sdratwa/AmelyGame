/**
 * Adapter: tłumaczy wejście dotykowe na istniejące wejście gracza (`PlayerInput` i kamera TPP / FPP). Renderer woła go raz
 * na klatkę; pad zostaje źródłem zapasowym (aktywny joystick ma pierwszeństwo, jak klawiatura w `mergeMove`).
 */
import type { Vec2 } from "./analog";
import type { TouchInput } from "./touchInput";

export type ExternalMove = { x: number; y: number; sprint: boolean };

type PadMove = { move: Vec2; sprint: boolean };

/** Ruch zewnętrzny: dotyk (gdy joystick jest wychylony) albo pad. Wynik zapisuje do `out`. */
export function externalMove(touch: TouchInput | null, pad: PadMove | null, out: ExternalMove): ExternalMove {
  if (touch && touch.isEnabled && touch.moving) {
    out.x = touch.move.x;
    out.y = touch.move.y;
    out.sprint = touch.sprint;
  } else {
    out.x = pad?.move.x ?? 0;
    out.y = pad?.move.y ?? 0;
    out.sprint = pad?.sprint ?? false;
  }
  return out;
}

export type TouchPlayerTarget = {
  input: { setExternal(x: number, y: number, run: boolean): void; requestJump(): void; requestCrouchToggle(): void };
  camera: { look(dx: number, dy: number): void };
};

/** Trzecia osoba: ruch, skok, kucanie i kamera z dotyku; bez dotyku ruch zewnętrzny idzie z pada. */
export function applyTouchToTpp(touch: TouchInput | null, pad: PadMove | null, target: TouchPlayerTarget, scratch: ExternalMove, look: Vec2): void {
  const m = externalMove(touch, pad, scratch);
  target.input.setExternal(m.x, m.y, m.sprint);
  if (!touch || !touch.isEnabled) return;
  if (touch.consumeJump()) target.input.requestJump();
  if (touch.consumeCrouch()) target.input.requestCrouchToggle();
  touch.consumeLook(look);
  if (look.x !== 0 || look.y !== 0) target.camera.look(look.x, look.y);
}
