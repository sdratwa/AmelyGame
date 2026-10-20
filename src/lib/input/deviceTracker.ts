import type { ActiveDevice } from "./actions";
import { DEVICE_STICK_FRAMES, DEVICE_STICK_THRESHOLD, deviceOfFamily, type PadFamily } from "./gamepadConfig";

export type DeviceTrackerOptions = {
  /** Minimalny odstęp między przełączeniami (histereza), ms. */
  minSwitchMs?: number;
  /** Skumulowany ruch myszy (px) w oknie czasu, od którego mysz liczy się jako aktywność. */
  mouseDistance?: number;
  mouseWindowMs?: number;
};

/**
 * Śledzi, z którego urządzenia gracz korzysta, aby podpowiedzi w interfejsie pasowały do niego. Histereza: krótki
 * minimalny odstęp między przełączeniami, dryf analoga (wychylenie poniżej progu) i drobny ruch myszy są ignorowane.
 * Czas jest wstrzykiwany (ms), więc moduł jest w pełni testowalny.
 */
export class DeviceTracker {
  device: ActiveDevice = "keyboard";
  private padDevice: ActiveDevice = "xbox";
  private lastSwitch = -Infinity;
  private stickRun = 0;
  private mouseAcc = 0;
  private mouseStart = 0;
  private readonly subs = new Set<() => void>();
  private readonly minSwitchMs: number;
  private readonly mouseDistance: number;
  private readonly mouseWindowMs: number;

  constructor(options: DeviceTrackerOptions = {}) {
    this.minSwitchMs = options.minSwitchMs ?? 400;
    this.mouseDistance = options.mouseDistance ?? 24;
    this.mouseWindowMs = options.mouseWindowMs ?? 300;
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  /** Rodzina aktywnego pada (dobór glifów PlayStation/Xbox); jeśli pad jest już aktywny, glify zmieniają się od razu. */
  setPadFamily(family: PadFamily): void {
    const next = deviceOfFamily(family);
    if (next === this.padDevice) return;
    this.padDevice = next;
    if (this.device !== "keyboard") this.set(next);
  }

  noteKeyboard(t: number): void {
    this.stickRun = 0;
    this.switchTo("keyboard", t);
  }

  noteMouseDown(t: number): void {
    this.switchTo("keyboard", t);
  }

  noteMouseMove(t: number, distance: number): void {
    if (t - this.mouseStart > this.mouseWindowMs) {
      this.mouseStart = t;
      this.mouseAcc = 0;
    }
    this.mouseAcc += Math.abs(distance);
    if (this.mouseAcc >= this.mouseDistance) {
      this.mouseAcc = 0;
      this.switchTo("keyboard", t);
    }
  }

  notePadButton(t: number): void {
    this.switchTo(this.padDevice, t);
  }

  /** Wywoływane co klatkę z wychyleniem analoga; krótkie lub słabe wychylenia (dryf) nie przełączają. */
  notePadStick(t: number, magnitude: number): void {
    if (magnitude < DEVICE_STICK_THRESHOLD) {
      this.stickRun = 0;
      return;
    }
    this.stickRun++;
    if (this.stickRun >= DEVICE_STICK_FRAMES) this.switchTo(this.padDevice, t);
  }

  /** Pad zniknął: wracamy do klawiatury bez zwłoki. */
  padLost(): void {
    this.stickRun = 0;
    this.set("keyboard");
  }

  private switchTo(target: ActiveDevice, t: number): void {
    if (this.device === target) return;
    if (t - this.lastSwitch < this.minSwitchMs) return;
    this.lastSwitch = t;
    this.set(target);
  }

  private set(target: ActiveDevice): void {
    if (this.device === target) return;
    this.device = target;
    for (const cb of this.subs) cb();
  }
}
