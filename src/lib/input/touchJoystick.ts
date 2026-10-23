/**
 * Logika pływającego joysticka dotykowego (bez DOM i Reacta). Baza pojawia się pod kciukiem, wychylenie jest liczone
 * względem punktu dotknięcia i ograniczone do promienia. Wynik: `x` w prawo, `y` do przodu (ekran w górę), długość <= 1.
 */

export const JOYSTICK_RADIUS = 56;
export const JOYSTICK_DEADZONE = 0.12;
export const JOYSTICK_CURVE = 1.2;
/** Bieg: wychylenie (przed deadzone) od `RUN_ON`, wyłączenie poniżej `RUN_OFF` (histereza). */
export const JOYSTICK_RUN_ON = 0.85;
export const JOYSTICK_RUN_OFF = 0.7;

export class VirtualJoystick {
  active = false;
  originX = 0;
  originY = 0;
  /** Przesunięcie gałki od środka bazy (px), zaciśnięte do promienia; do rysowania. */
  knobX = 0;
  knobY = 0;
  /** Ruch po deadzone i krzywej. */
  x = 0;
  y = 0;
  /** Surowe wychylenie 0..1 (do rysowania i progu biegu). */
  deflection = 0;
  run = false;

  constructor(readonly radius: number = JOYSTICK_RADIUS) {}

  begin(px: number, py: number): void {
    this.active = true;
    this.originX = px;
    this.originY = py;
    this.apply(px, py);
  }

  /** Aktualizacja pozycji palca; zwraca false, gdy joystick nie jest aktywny albo dane są niepoprawne. */
  move(px: number, py: number): boolean {
    if (!this.active || !Number.isFinite(px) || !Number.isFinite(py)) return false;
    this.apply(px, py);
    return true;
  }

  end(): void {
    this.active = false;
    this.knobX = this.knobY = 0;
    this.x = this.y = 0;
    this.deflection = 0;
    this.run = false;
  }

  private apply(px: number, py: number): void {
    const dx = px - this.originX;
    const dy = py - this.originY;
    const dist = Math.hypot(dx, dy);
    const raw = Math.min(1, dist / this.radius);
    this.deflection = raw;
    if (dist > 1e-6) {
      const k = Math.min(1, this.radius / dist);
      this.knobX = dx * k;
      this.knobY = dy * k;
    } else {
      this.knobX = this.knobY = 0;
    }
    if (raw <= JOYSTICK_DEADZONE || dist <= 1e-6) {
      this.x = this.y = 0;
    } else {
      const scaled = (raw - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
      const shaped = Math.pow(scaled, JOYSTICK_CURVE);
      this.x = (dx / dist) * shaped;
      this.y = (-dy / dist) * shaped;
    }
    const moving = this.x !== 0 || this.y !== 0;
    this.run = moving && (this.run ? raw >= JOYSTICK_RUN_OFF : raw >= JOYSTICK_RUN_ON);
  }
}
