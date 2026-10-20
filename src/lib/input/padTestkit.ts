import { BUTTON_SLOTS } from "./gamepadConfig";
import type { GamepadLike } from "./gamepadInput";

/** Sztuczny pad do testów (modyfikowalny; bez DOM). */
export type FakePad = Omit<GamepadLike, "buttons" | "axes"> & {
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
  press(button: number, value?: number): void;
  release(button: number): void;
  setAxes(lx: number, ly: number, rx?: number, ry?: number): void;
};

export function makePad(index = 0, id = "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", mapping = "standard"): FakePad {
  const pad: FakePad = {
    id,
    index,
    connected: true,
    mapping,
    buttons: Array.from({ length: BUTTON_SLOTS }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
    press(button, value = 1) {
      pad.buttons[button] = { pressed: value >= 0.5, value };
    },
    release(button) {
      pad.buttons[button] = { pressed: false, value: 0 };
    },
    setAxes(lx, ly, rx = 0, ry = 0) {
      pad.axes = [lx, ly, rx, ry];
    },
  };
  return pad;
}

/** Czytnik zwracający zmienną listę padów (null = brak danych). */
export function makeReader(initial: (FakePad | null)[]): { pads: (FakePad | null)[]; read: () => (FakePad | null)[] } {
  const state: { pads: (FakePad | null)[]; read: () => (FakePad | null)[] } = { pads: initial, read: () => state.pads };
  return state;
}
