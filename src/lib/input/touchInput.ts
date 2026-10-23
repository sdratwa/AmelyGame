/**
 * Stan wejścia dotykowego czytany przez renderer w pętli klatek. Komponenty Reacta tylko go zapisują (zdarzenia
 * pointer), nie ma tu żadnego stanu Reacta ani alokacji w klatce. Odpowiednik osi i zdarzeń pada z `InputHub`.
 */
import type { Vec2 } from "./analog";

/** Mnożnik przeliczenia pikseli palca na obrót kamery (względem myszy: palec potrzebuje większej czułości). */
export const TOUCH_LOOK_GAIN = 1.6;
/** Maksymalne przesunięcie z jednego zdarzenia (px): odcina skoki (np. utrata śledzenia palca). */
export const TOUCH_LOOK_MAX_STEP = 120;

function clampStep(v: number): number {
  return Math.max(-TOUCH_LOOK_MAX_STEP, Math.min(TOUCH_LOOK_MAX_STEP, v));
}

export class TouchInput {
  /** Ruch z joysticka: `x` w prawo, `y` do przodu; długość <= 1. */
  readonly move: Vec2 = { x: 0, y: 0 };
  sprint = false;
  moving = false;
  private sensitivity = 1;

  private enabled = true;
  private lookDx = 0;
  private lookDy = 0;
  private jumpEdge = false;
  private crouchEdge = false;

  /** Mnożnik użytkownika (ustawienie czułości kamery); wartości niepoprawne są ignorowane. */
  get lookSensitivity(): number {
    return this.sensitivity;
  }

  setLookSensitivity(value: number): void {
    if (Number.isFinite(value) && value > 0) this.sensitivity = value;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Wyłączenie zeruje cały stan (np. okno otwarte nad sceną); dalsze zdarzenia są ignorowane. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  setMove(x: number, y: number, sprint: boolean): void {
    if (!this.enabled || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.move.x = x;
    this.move.y = y;
    this.moving = x !== 0 || y !== 0;
    this.sprint = this.moving && sprint;
  }

  clearMove(): void {
    this.move.x = this.move.y = 0;
    this.moving = false;
    this.sprint = false;
  }

  /** Przesunięcie palca w pikselach (strefa kamery); sumowane do odczytu w następnej klatce. */
  addLook(dx: number, dy: number): void {
    if (!this.enabled || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const k = TOUCH_LOOK_GAIN * this.sensitivity;
    this.lookDx += clampStep(dx) * k;
    this.lookDy += clampStep(dy) * k;
  }

  /** Zwraca (do `out`) obrót zebrany od ostatniego odczytu, w "pikselach myszy", i zeruje go. */
  consumeLook(out: Vec2): Vec2 {
    out.x = this.lookDx;
    out.y = this.lookDy;
    this.lookDx = 0;
    this.lookDy = 0;
    return out;
  }

  pressJump(): void {
    if (this.enabled) this.jumpEdge = true;
  }

  pressCrouch(): void {
    if (this.enabled) this.crouchEdge = true;
  }

  consumeJump(): boolean {
    const v = this.jumpEdge;
    this.jumpEdge = false;
    return v;
  }

  consumeCrouch(): boolean {
    const v = this.crouchEdge;
    this.crouchEdge = false;
    return v;
  }

  reset(): void {
    this.clearMove();
    this.lookDx = this.lookDy = 0;
    this.jumpEdge = this.crouchEdge = false;
  }
}
