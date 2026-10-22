import { describe, expect, it } from "vitest";
import { PlayerInput } from "./playerInput";

describe("PlayerInput: mapa akcji", () => {
  it("W/A/S/D dają osie ruchu, przeciwne klawisze się znoszą", () => {
    const i = new PlayerInput();
    i.handleKey("KeyW", true);
    i.handleKey("KeyD", true);
    expect(i.consume()).toMatchObject({ moveX: 1, moveY: 1 });
    i.handleKey("KeyS", true);
    expect(i.consume().moveY).toBe(0);
    i.handleKey("KeyW", false);
    i.handleKey("KeyD", false);
    i.handleKey("KeyA", true);
    expect(i.consume()).toMatchObject({ moveX: -1, moveY: -1 });
  });

  it("Shift = bieg; klawisze spoza mapy nie są obsługiwane", () => {
    const i = new PlayerInput();
    expect(i.handleKey("ShiftLeft", true)).toBe(true);
    expect(i.consume().run).toBe(true);
    i.handleKey("ShiftLeft", false);
    expect(i.consume().run).toBe(false);
    expect(i.handleKey("KeyQ", true)).toBe(false);
    expect(PlayerInput.handles("Space")).toBe(true);
    expect(PlayerInput.handles("Escape")).toBe(false);
  });

  it("C i Spacja to zdarzenia jednorazowe; przytrzymanie i auto-repeat nie powtarzają", () => {
    const i = new PlayerInput();
    i.handleKey("KeyC", true);
    i.handleKey("Space", true);
    i.handleKey("KeyC", true, true);
    i.handleKey("Space", true, true);
    expect(i.consume()).toMatchObject({ crouchToggle: true, jump: true });
    expect(i.consume()).toMatchObject({ crouchToggle: false, jump: false });
    i.handleKey("KeyC", false);
    i.handleKey("KeyC", true);
    expect(i.consume().crouchToggle).toBe(true);
  });

  it("ruch myszy sumuje się do odczytu i jest zerowany; wartości nieskończone są odrzucane", () => {
    const i = new PlayerInput();
    i.look(3, 4);
    i.look(2, -1);
    i.look(Number.NaN, 5);
    expect(i.consume()).toMatchObject({ lookDx: 5, lookDy: 3 });
    expect(i.consume()).toMatchObject({ lookDx: 0, lookDy: 0 });
  });

  it("źródło zewnętrzne (pad) łączy się z klawiaturą; releaseAll zwalnia klawisze", () => {
    const i = new PlayerInput();
    i.setExternal(0.5, -0.7, true);
    expect(i.consume()).toMatchObject({ moveX: 0.5, moveY: -0.7, run: true });
    i.handleKey("KeyW", true);
    expect(i.consume().moveY).toBe(1);
    i.releaseAll();
    expect(i.consume().moveY).toBe(-0.7);
  });

  it("skok i kucanie z pada (requestJump, requestCrouchToggle) to zdarzenia jednorazowe jak klawisze", () => {
    const i = new PlayerInput();
    i.requestJump();
    i.requestCrouchToggle();
    expect(i.consume()).toMatchObject({ jump: true, crouchToggle: true });
    expect(i.consume()).toMatchObject({ jump: false, crouchToggle: false });
  });
});
