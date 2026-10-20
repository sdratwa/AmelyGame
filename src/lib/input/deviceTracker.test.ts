import { describe, expect, it } from "vitest";
import { DeviceTracker } from "./deviceTracker";

describe("DeviceTracker", () => {
  it("startuje na klawiaturze", () => {
    expect(new DeviceTracker().device).toBe("keyboard");
  });

  it("przycisk pada przełącza podpowiedzi na pada (PlayStation albo Xbox wg rodziny)", () => {
    const t = new DeviceTracker();
    t.setPadFamily("playstation");
    t.notePadButton(1000);
    expect(t.device).toBe("playstation");
    const x = new DeviceTracker();
    x.setPadFamily("xbox");
    x.notePadButton(1000);
    expect(x.device).toBe("xbox");
  });

  it("dryf analoga (poniżej progu) nie przełącza urządzenia", () => {
    const t = new DeviceTracker();
    for (let i = 0; i < 100; i++) t.notePadStick(1000 + i * 16, 0.2);
    expect(t.device).toBe("keyboard");
  });

  it("wychylenie analoga przełącza dopiero po utrzymaniu przez kilka klatek", () => {
    const t = new DeviceTracker();
    t.notePadStick(1000, 0.9);
    t.notePadStick(1016, 0.9);
    expect(t.device).toBe("keyboard");
    t.notePadStick(1032, 0.9);
    t.notePadStick(1048, 0.9);
    expect(t.device).not.toBe("keyboard");
  });

  it("krótkie wychylenie przerwane dryfem zeruje licznik", () => {
    const t = new DeviceTracker();
    t.notePadStick(1000, 0.9);
    t.notePadStick(1016, 0.9);
    t.notePadStick(1032, 0.1);
    t.notePadStick(1048, 0.9);
    t.notePadStick(1064, 0.9);
    expect(t.device).toBe("keyboard");
  });

  it("histereza: nie przełącza z powrotem szybciej niż po minimalnym odstępie", () => {
    const t = new DeviceTracker({ minSwitchMs: 400 });
    t.notePadButton(1000);
    expect(t.device).not.toBe("keyboard");
    t.noteKeyboard(1100);
    expect(t.device).not.toBe("keyboard");
    t.noteKeyboard(1500);
    expect(t.device).toBe("keyboard");
  });

  it("drobny ruch myszy jest ignorowany, wyraźny przełącza na klawiaturę/mysz", () => {
    const t = new DeviceTracker({ minSwitchMs: 0 });
    t.notePadButton(1000);
    t.noteMouseMove(2000, 3);
    t.noteMouseMove(2010, 3);
    expect(t.device).not.toBe("keyboard");
    t.noteMouseMove(2020, 40);
    expect(t.device).toBe("keyboard");
  });

  it("kliknięcie myszą przełącza na klawiaturę/mysz", () => {
    const t = new DeviceTracker({ minSwitchMs: 0 });
    t.notePadButton(1000);
    t.noteMouseDown(2000);
    expect(t.device).toBe("keyboard");
  });

  it("utrata pada wraca do klawiatury bez zwłoki", () => {
    const t = new DeviceTracker();
    t.notePadButton(1000);
    t.padLost();
    expect(t.device).toBe("keyboard");
  });

  it("powiadamia tylko przy faktycznej zmianie", () => {
    const t = new DeviceTracker();
    let n = 0;
    t.subscribe(() => n++);
    t.noteKeyboard(1000);
    expect(n).toBe(0);
    t.notePadButton(2000);
    t.notePadButton(2500);
    expect(n).toBe(1);
  });
});
