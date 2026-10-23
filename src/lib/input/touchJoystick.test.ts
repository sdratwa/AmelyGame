import { describe, expect, it } from "vitest";
import { JOYSTICK_DEADZONE, JOYSTICK_RADIUS, VirtualJoystick } from "./touchJoystick";

const R = JOYSTICK_RADIUS;

describe("VirtualJoystick", () => {
  it("w deadzone nie ma ruchu", () => {
    const j = new VirtualJoystick();
    j.begin(100, 200);
    j.move(100 + R * JOYSTICK_DEADZONE * 0.5, 200);
    expect(j.x).toBe(0);
    expect(j.y).toBe(0);
    expect(j.run).toBe(false);
  });

  it("ekran w górę = do przodu, w prawo = prawo", () => {
    const j = new VirtualJoystick();
    j.begin(100, 200);
    j.move(100, 200 - R * 0.6);
    expect(j.y).toBeGreaterThan(0);
    expect(Math.abs(j.x)).toBeLessThan(1e-9);
    j.move(100 + R * 0.6, 200);
    expect(j.x).toBeGreaterThan(0);
    expect(Math.abs(j.y)).toBeLessThan(1e-9);
  });

  it("wychylenie poza promień jest ograniczone do długości 1, a gałka do promienia", () => {
    const j = new VirtualJoystick();
    j.begin(0, 0);
    j.move(R * 5, -R * 5);
    expect(Math.hypot(j.x, j.y)).toBeCloseTo(1, 6);
    expect(Math.hypot(j.knobX, j.knobY)).toBeCloseTo(R, 6);
    expect(j.x).toBeGreaterThan(0);
    expect(j.y).toBeGreaterThan(0);
  });

  it("chodzenie przy małym wychyleniu, bieg dopiero przy mocnym (z histerezą)", () => {
    const j = new VirtualJoystick();
    j.begin(0, 0);
    j.move(R * 0.5, 0);
    expect(j.x).toBeGreaterThan(0);
    expect(j.run).toBe(false);
    j.move(R * 0.9, 0);
    expect(j.run).toBe(true);
    j.move(R * 0.75, 0);
    expect(j.run).toBe(true); // histereza: wciąż biegnie
    j.move(R * 0.6, 0);
    expect(j.run).toBe(false);
  });

  it("puszczenie zeruje wszystko, a ruch bez dotknięcia jest ignorowany", () => {
    const j = new VirtualJoystick();
    expect(j.move(10, 10)).toBe(false);
    j.begin(0, 0);
    j.move(R, 0);
    j.end();
    expect(j).toMatchObject({ active: false, x: 0, y: 0, knobX: 0, knobY: 0, run: false, deflection: 0 });
  });

  it("odrzuca niepoprawne współrzędne", () => {
    const j = new VirtualJoystick();
    j.begin(0, 0);
    expect(j.move(Number.NaN, 5)).toBe(false);
    expect(Number.isFinite(j.x)).toBe(true);
  });
});
