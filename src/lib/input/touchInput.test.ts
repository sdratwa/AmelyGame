import { describe, expect, it } from "vitest";
import { TOUCH_LOOK_GAIN, TOUCH_LOOK_MAX_STEP, TouchInput } from "./touchInput";
import { DEFAULT_TOUCH_SETTINGS, normalizeTouchSettings, parseTouchSettings, TouchSettingsStore } from "./touchSettings";

describe("TouchInput", () => {
  it("sumuje obrót kamery do odczytu i zeruje go po odczycie", () => {
    const t = new TouchInput();
    t.addLook(10, -4);
    t.addLook(5, 2);
    const out = { x: 0, y: 0 };
    t.consumeLook(out);
    expect(out.x).toBeCloseTo(15 * TOUCH_LOOK_GAIN, 6);
    expect(out.y).toBeCloseTo(-2 * TOUCH_LOOK_GAIN, 6);
    t.consumeLook(out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it("czułość użytkownika skaluje obrót, a skoki są ograniczane", () => {
    const t = new TouchInput();
    t.setLookSensitivity(2);
    t.addLook(1000, 0);
    const out = { x: 0, y: 0 };
    t.consumeLook(out);
    expect(out.x).toBeCloseTo(TOUCH_LOOK_MAX_STEP * TOUCH_LOOK_GAIN * 2, 6);
  });

  it("zdarzenia skoku i kucania są jednorazowe", () => {
    const t = new TouchInput();
    t.pressJump();
    t.pressCrouch();
    expect(t.consumeJump()).toBe(true);
    expect(t.consumeJump()).toBe(false);
    expect(t.consumeCrouch()).toBe(true);
    expect(t.consumeCrouch()).toBe(false);
  });

  it("bieg liczy się tylko podczas ruchu", () => {
    const t = new TouchInput();
    t.setMove(0, 0, true);
    expect(t.sprint).toBe(false);
    t.setMove(0, 1, true);
    expect(t.moving).toBe(true);
    expect(t.sprint).toBe(true);
    t.clearMove();
    expect(t.moving).toBe(false);
  });

  it("wyłączenie zeruje stan i ignoruje kolejne zdarzenia; reset czyści wszystko", () => {
    const t = new TouchInput();
    t.setMove(1, 0, false);
    t.addLook(5, 5);
    t.pressJump();
    t.setEnabled(false);
    t.addLook(5, 5);
    t.pressJump();
    t.setMove(1, 1, false);
    const out = { x: 1, y: 1 };
    t.consumeLook(out);
    expect(out).toEqual({ x: 0, y: 0 });
    expect(t.consumeJump()).toBe(false);
    expect(t.moving).toBe(false);
    t.setEnabled(true);
    t.setMove(0.5, 0.5, false);
    t.reset();
    expect(t.moving).toBe(false);
  });

  it("odrzuca wartości nieskończone i NaN", () => {
    const t = new TouchInput();
    t.addLook(Number.NaN, 1);
    t.setMove(Number.POSITIVE_INFINITY, 0, false);
    const out = { x: 0, y: 0 };
    t.consumeLook(out);
    expect(out).toEqual({ x: 0, y: 0 });
    expect(t.moving).toBe(false);
  });
});

describe("ustawienia dotyku", () => {
  it("normalizacja ogranicza zakres i naprawia śmieci", () => {
    expect(normalizeTouchSettings({ lookSensitivity: 99 }).lookSensitivity).toBe(2.5);
    expect(normalizeTouchSettings({ lookSensitivity: 0 }).lookSensitivity).toBe(0.5);
    expect(normalizeTouchSettings({ lookSensitivity: "x" })).toEqual(DEFAULT_TOUCH_SETTINGS);
    expect(parseTouchSettings("{złe")).toEqual(DEFAULT_TOUCH_SETTINGS);
  });

  it("magazyn zapisuje i powiadamia subskrybentów", () => {
    const data = new Map<string, string>();
    const store = new TouchSettingsStore(() => ({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }));
    let calls = 0;
    store.subscribe(() => calls++);
    store.set({ lookSensitivity: 1.5 });
    expect(store.get().lookSensitivity).toBe(1.5);
    expect(calls).toBe(1);
    const again = new TouchSettingsStore(() => ({ getItem: (k) => data.get(k) ?? null, setItem: () => {} }));
    expect(again.get().lookSensitivity).toBe(1.5);
  });
});
