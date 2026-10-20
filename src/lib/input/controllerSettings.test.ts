import { describe, expect, it } from "vitest";
import {
  ControllerSettingsStore,
  DEFAULT_CONTROLLER_SETTINGS,
  SETTINGS_KEY,
  SETTING_LIMITS,
  normalizeSettings,
  parseSettings,
  roundTo,
  type SettingsStorage,
} from "./controllerSettings";

function memory(initial?: string): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SETTINGS_KEY, initial);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("ustawienia kontrolera", () => {
  it("domyślne: deadzone 0.15, czułość 1, wibracje włączone, oś Y bez odwrócenia", () => {
    expect(DEFAULT_CONTROLLER_SETTINGS).toEqual({
      cameraSensitivityX: 1,
      cameraSensitivityY: 1,
      leftDeadzone: 0.15,
      rightDeadzone: 0.15,
      invertY: false,
      vibration: true,
    });
  });

  it("uszkodzony lub pusty zapis wraca do domyślnych", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_CONTROLLER_SETTINGS);
    expect(parseSettings("{nie json")).toEqual(DEFAULT_CONTROLLER_SETTINGS);
    expect(parseSettings("42")).toEqual(DEFAULT_CONTROLLER_SETTINGS);
  });

  it("wartości spoza zakresu i złego typu są ograniczane lub zastępowane domyślnymi", () => {
    const s = normalizeSettings({ cameraSensitivityX: 99, cameraSensitivityY: -4, leftDeadzone: 0.9, rightDeadzone: "x", invertY: "tak", vibration: 0 });
    expect(s.cameraSensitivityX).toBe(SETTING_LIMITS.sensitivity.max);
    expect(s.cameraSensitivityY).toBe(SETTING_LIMITS.sensitivity.min);
    expect(s.leftDeadzone).toBe(SETTING_LIMITS.deadzone.max);
    expect(s.rightDeadzone).toBe(DEFAULT_CONTROLLER_SETTINGS.rightDeadzone);
    expect(s.invertY).toBe(false);
    expect(s.vibration).toBe(true);
  });

  it("zapisuje i odczytuje lokalnie (round-trip)", () => {
    const storage = memory();
    const a = new ControllerSettingsStore(() => storage);
    a.set({ invertY: true, cameraSensitivityX: 1.5, vibration: false });
    const b = new ControllerSettingsStore(() => storage);
    expect(b.get()).toMatchObject({ invertY: true, cameraSensitivityX: 1.5, vibration: false });
  });

  it("brak dostępu do pamięci nie powoduje błędu", () => {
    const store = new ControllerSettingsStore(() => null);
    store.set({ invertY: true });
    expect(store.get().invertY).toBe(true);
  });

  it("zmiana ustawień powiadamia subskrybentów i tworzy nowy snapshot", () => {
    const store = new ControllerSettingsStore(() => memory());
    const before = store.get();
    let n = 0;
    store.subscribe(() => n++);
    store.set({ leftDeadzone: 0.2 });
    expect(n).toBe(1);
    expect(store.get()).not.toBe(before);
    store.reset();
    expect(store.get()).toEqual(DEFAULT_CONTROLLER_SETTINGS);
  });

  it("zaokrąglanie do kroku usuwa błędy zmiennoprzecinkowe", () => {
    expect(roundTo(0.15000000000000002, 0.05)).toBe(0.15);
    expect(roundTo(1.1 + 0.25, 0.25)).toBe(1.25);
  });
});
