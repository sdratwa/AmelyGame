import { describe, expect, it } from "vitest";
import { BTN, PAD_GRACE_MS } from "./gamepadConfig";
import { GamepadInput } from "./gamepadInput";
import { makePad, makeReader } from "./padTestkit";

describe("GamepadInput: krawędzie przycisków", () => {
  it("naciśnięcie daje jedną krawędź, trzymanie jej nie powtarza, zwolnienie daje krawędź zwolnienia", () => {
    const pad = makePad();
    const r = makeReader([pad]);
    const input = new GamepadInput(r.read);
    input.poll(0);
    expect(input.status).toBe("ready");
    expect(input.pressedCount).toBe(0);

    pad.press(BTN.cross);
    input.poll(16);
    expect(input.pressed[BTN.cross]).toBe(1);
    expect(input.pressedCount).toBe(1);

    input.poll(32);
    expect(input.pressed[BTN.cross]).toBe(0);
    expect(input.isDown(BTN.cross)).toBe(true);

    pad.release(BTN.cross);
    input.poll(48);
    expect(input.released[BTN.cross]).toBe(1);
    expect(input.isDown(BTN.cross)).toBe(false);
  });

  it("spust analogowy ma histerezę (włączenie 0.5, wyłączenie 0.35)", () => {
    const pad = makePad();
    const input = new GamepadInput(makeReader([pad]).read);
    input.poll(0);
    pad.buttons[BTN.r2] = { pressed: false, value: 0.45 };
    input.poll(16);
    expect(input.isDown(BTN.r2)).toBe(false);
    pad.buttons[BTN.r2] = { pressed: false, value: 0.6 };
    input.poll(32);
    expect(input.isDown(BTN.r2)).toBe(true);
    pad.buttons[BTN.r2] = { pressed: false, value: 0.4 };
    input.poll(48);
    expect(input.isDown(BTN.r2)).toBe(true);
    pad.buttons[BTN.r2] = { pressed: false, value: 0.2 };
    input.poll(64);
    expect(input.isDown(BTN.r2)).toBe(false);
  });

  it("NaN w osiach jest traktowane jak zero", () => {
    const pad = makePad();
    pad.setAxes(Number.NaN, 0.5);
    const input = new GamepadInput(makeReader([pad]).read);
    input.poll(0);
    expect(input.leftX).toBe(0);
    expect(input.leftY).toBe(0.5);
  });
});

describe("GamepadInput: wykrywanie i rozłączanie", () => {
  it("brak padów = status none", () => {
    const input = new GamepadInput(makeReader([null, null]).read);
    input.poll(0);
    expect(input.status).toBe("none");
  });

  it("niestandardowe mapowanie jest ignorowane (status unsupported, zero wejścia)", () => {
    const odd = makePad(0, "Custom Pad", "");
    odd.press(BTN.cross);
    const input = new GamepadInput(makeReader([odd]).read);
    input.poll(0);
    expect(input.status).toBe("unsupported");
    expect(input.pressedCount).toBe(0);
    expect(input.isDown(BTN.cross)).toBe(false);
  });

  it("zdarzenie rozłączenia natychmiast zeruje stan i zmienia status", () => {
    const pad = makePad();
    const input = new GamepadInput(makeReader([pad]).read);
    pad.press(BTN.l3);
    input.poll(0);
    expect(input.isDown(BTN.l3)).toBe(true);
    input.disconnect(0);
    expect(input.status).toBe("none");
    expect(input.isDown(BTN.l3)).toBe(false);
  });

  it("chwilowy brak danych (null) nie rozłącza w oknie karencji i zeruje wejście", () => {
    const pad = makePad();
    const r = makeReader([pad]);
    const input = new GamepadInput(r.read);
    pad.setAxes(1, 0);
    input.poll(0);
    expect(input.leftX).toBe(1);
    r.pads = [null];
    input.poll(PAD_GRACE_MS - 100);
    expect(input.status).toBe("ready");
    expect(input.leftX).toBe(0);
    r.pads = [pad];
    input.poll(PAD_GRACE_MS - 50);
    expect(input.status).toBe("ready");
    expect(input.leftX).toBe(1);
  });

  it("dłuższy brak danych kończy się rozłączeniem, a powrót pada wznawia sterowanie", () => {
    const pad = makePad();
    const r = makeReader([pad]);
    const input = new GamepadInput(r.read);
    input.poll(0);
    r.pads = [null];
    input.poll(100);
    input.poll(PAD_GRACE_MS + 200);
    expect(input.status).toBe("none");
    r.pads = [pad];
    pad.press(BTN.cross);
    input.poll(PAD_GRACE_MS + 300);
    expect(input.status).toBe("ready");
    expect(input.pressed[BTN.cross]).toBe(1);
  });

  it("powiadamia subskrybentów o zmianie statusu", () => {
    const pad = makePad();
    const input = new GamepadInput(makeReader([pad]).read);
    let calls = 0;
    input.subscribe(() => calls++);
    input.poll(0);
    expect(calls).toBeGreaterThan(0);
    const before = calls;
    input.disconnect(0);
    expect(calls).toBe(before + 1);
  });
});

describe("GamepadInput: kilka kontrolerów", () => {
  it("wybiera jeden aktywny i nie sumuje wejścia z drugiego", () => {
    const a = makePad(0);
    const b = makePad(1, "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)");
    const input = new GamepadInput(makeReader([a, b]).read);
    a.setAxes(0.5, 0);
    b.setAxes(0, 0); // b bezczynny
    input.poll(0);
    expect(input.index).toBe(0);
    expect(input.leftX).toBe(0.5);
  });

  it("przełącza się na inny pad dopiero, gdy aktywny jest bezczynny, a użytkownik używa drugiego", () => {
    const a = makePad(0);
    const b = makePad(1, "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)");
    const input = new GamepadInput(makeReader([a, b]).read);
    input.poll(0);
    expect(input.index).toBe(0);
    b.press(BTN.cross);
    input.poll(16);
    expect(input.index).toBe(1);
    expect(input.family).toBe("xbox");
    expect(input.pressed[BTN.cross]).toBe(1);
  });

  it("nie przełącza się na drugi pad, gdy aktywny jest w użyciu", () => {
    const a = makePad(0);
    const b = makePad(1);
    const input = new GamepadInput(makeReader([a, b]).read);
    input.poll(0);
    a.press(BTN.l3);
    b.press(BTN.cross);
    input.poll(16);
    expect(input.index).toBe(0);
  });
});
