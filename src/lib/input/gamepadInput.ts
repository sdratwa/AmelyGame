import {
  AXIS,
  BUTTON_OFF,
  BUTTON_ON,
  BUTTON_SLOTS,
  MIN_STANDARD_AXES,
  MIN_STANDARD_BUTTONS,
  PAD_GRACE_MS,
  padFamilyFromId,
  type PadFamily,
} from "./gamepadConfig";

/** Minimalny kształt obiektu `Gamepad` używany przez moduł (ułatwia testy bez DOM). */
export type GamepadLike = {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  buttons: ReadonlyArray<{ pressed: boolean; value: number }>;
  axes: ReadonlyArray<number>;
  vibrationActuator?: unknown;
};

export type PadStatus = "none" | "ready" | "unsupported";

export type PadReader = () => ArrayLike<GamepadLike | null>;

/** Przycisk uznawany za "aktywny" na innym padzie (próg przełączenia aktywnego kontrolera). */
const SWITCH_STICK = 0.3;

/**
 * Odczyt kontrolera z `navigator.getGamepads()`. Wybiera jeden aktywny pad (zgodny ze standardowym mapowaniem), nie sumuje
 * wejścia z kilku, wykrywa krawędzie przycisków i toleruje chwilowy brak danych. Stan jest w prealokowanych tablicach:
 * `poll()` nie tworzy własnych obiektów.
 */
export class GamepadInput {
  status: PadStatus = "none";
  /** Nazwa (`Gamepad.id`) aktywnego lub nieobsługiwanego pada. */
  name = "";
  family: PadFamily = "generic";
  index = -1;
  /** Zmienia się przy każdej zmianie statusu/nazwy (dla `useSyncExternalStore`). */
  version = 0;

  readonly down = new Uint8Array(BUTTON_SLOTS);
  /** Krawędź naciśnięcia w ostatnim `poll()`. */
  readonly pressed = new Uint8Array(BUTTON_SLOTS);
  readonly released = new Uint8Array(BUTTON_SLOTS);
  pressedCount = 0;
  /** Surowe osie (po wyzerowaniu NaN). */
  leftX = 0;
  leftY = 0;
  rightX = 0;
  rightY = 0;
  /** Większe z wychyleń obu analogów (długość wektora, surowa). */
  stickMax = 0;

  private lastSeen = 0;
  private vibration: unknown = null;
  private readonly subs = new Set<() => void>();

  constructor(private readonly read: PadReader) {}

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  /** Aktuator wibracji aktywnego pada (jeśli przeglądarka go udostępnia). */
  get actuator(): unknown {
    return this.vibration;
  }

  isDown(button: number): boolean {
    return this.down[button] === 1;
  }

  /** Przyspieszone sprawdzenie po zdarzeniu `gamepadconnected` (pad pojawia się dopiero po pierwszym przycisku). */
  refresh(now: number): void {
    this.poll(now);
  }

  /** Zdarzenie `gamepaddisconnected`: natychmiastowe rozłączenie aktywnego pada. */
  disconnect(index: number): void {
    if (index !== this.index) return;
    this.dropActive();
    this.emit();
  }

  poll(now: number): void {
    this.pressed.fill(0);
    this.released.fill(0);
    this.pressedCount = 0;

    let list: ArrayLike<GamepadLike | null>;
    try {
      list = this.read();
    } catch {
      list = [];
    }

    let current: GamepadLike | null = null;
    let first: GamepadLike | null = null;
    let nonStandard: GamepadLike | null = null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || !p.connected) continue;
      if (!isStandard(p)) {
        nonStandard ??= p;
        continue;
      }
      if (p.index === this.index) current = p;
      else first ??= p;
    }

    if (current) {
      this.lastSeen = now;
      if (first && isBusy(first) && !isBusy(current)) {
        // Pad pasywny, a użytkownik zaczął używać innego: przełączamy się na niego (nie sumujemy wejścia).
        this.adopt(first, now);
        current = first;
      }
    } else if (this.index >= 0) {
      if (now - this.lastSeen < PAD_GRACE_MS) {
        // Chwilowy brak danych: trzymamy wejście na zerze, ale nie ogłaszamy rozłączenia.
        this.releaseAll();
        this.clearAxes();
        return;
      }
      this.dropActive();
      this.emit();
    }

    if (!current) {
      if (first) {
        this.adopt(first, now);
        current = first;
      } else {
        const next: PadStatus = nonStandard ? "unsupported" : "none";
        const name = nonStandard?.id ?? "";
        if (this.status !== next || this.name !== name) {
          this.status = next;
          this.name = name;
          this.emit();
        }
        this.clearAxes();
        return;
      }
    }

    this.vibration = current.vibrationActuator ?? null;
    this.readState(current);
  }

  private adopt(p: GamepadLike, now: number): void {
    this.index = p.index;
    this.name = p.id;
    this.family = padFamilyFromId(p.id);
    this.status = "ready";
    this.lastSeen = now;
    this.down.fill(0);
    this.emit();
  }

  private dropActive(): void {
    this.index = -1;
    this.vibration = null;
    this.releaseAll();
    this.clearAxes();
    this.status = "none";
    this.name = "";
  }

  private releaseAll(): void {
    this.down.fill(0);
    this.pressed.fill(0);
    this.pressedCount = 0;
  }

  private clearAxes(): void {
    this.leftX = this.leftY = this.rightX = this.rightY = 0;
    this.stickMax = 0;
  }

  private readState(p: GamepadLike): void {
    const buttons = p.buttons;
    for (let b = 0; b < BUTTON_SLOTS; b++) {
      const v = b < buttons.length ? buttons[b] : null;
      const was = this.down[b] === 1;
      let now = false;
      if (v) now = was ? v.pressed || v.value > BUTTON_OFF : v.pressed || v.value >= BUTTON_ON;
      if (now && !was) {
        this.pressed[b] = 1;
        this.pressedCount++;
      } else if (!now && was) {
        this.released[b] = 1;
      }
      this.down[b] = now ? 1 : 0;
    }
    this.leftX = axis(p.axes, AXIS.leftX);
    this.leftY = axis(p.axes, AXIS.leftY);
    this.rightX = axis(p.axes, AXIS.rightX);
    this.rightY = axis(p.axes, AXIS.rightY);
    this.stickMax = Math.max(Math.hypot(this.leftX, this.leftY), Math.hypot(this.rightX, this.rightY));
  }

  private emit(): void {
    this.version++;
    for (const cb of this.subs) cb();
  }
}

function axis(axes: ReadonlyArray<number>, i: number): number {
  const v = i < axes.length ? axes[i] : 0;
  return Number.isFinite(v) ? v : 0;
}

/** Kontroler zgodny ze standardowym mapowaniem; niestandardowe mapowanie jest ignorowane (bezpieczniej niż zgadywanie). */
export function isStandard(p: GamepadLike): boolean {
  return p.mapping === "standard" && p.buttons.length >= MIN_STANDARD_BUTTONS && p.axes.length >= MIN_STANDARD_AXES;
}

function isBusy(p: GamepadLike): boolean {
  for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i].pressed) return true;
  return Math.hypot(axis(p.axes, AXIS.leftX), axis(p.axes, AXIS.leftY)) > SWITCH_STICK || Math.hypot(axis(p.axes, AXIS.rightX), axis(p.axes, AXIS.rightY)) > SWITCH_STICK;
}
