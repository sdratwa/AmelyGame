import { describe, expect, it } from "vitest";
import { PlayerInput } from "@/lib/tpp/playerInput";
import { applyTouchToTpp, externalMove, type ExternalMove } from "./touchAdapter";
import { TOUCH_LOOK_GAIN, TouchInput } from "./touchInput";

const scratch = (): ExternalMove => ({ x: 0, y: 0, sprint: false });

function rig() {
  const input = new PlayerInput();
  const looks: [number, number][] = [];
  return { input, looks, target: { input, camera: { look: (dx: number, dy: number) => looks.push([dx, dy]) } } };
}

describe("touchAdapter", () => {
  it("joystick -> PlayerIntent (ruch, bieg, skok, kucanie)", () => {
    const touch = new TouchInput();
    const { input, target } = rig();
    touch.setMove(0.5, 1, true);
    touch.pressJump();
    touch.pressCrouch();
    applyTouchToTpp(touch, null, target, scratch(), { x: 0, y: 0 });
    const intent = input.consume();
    expect(intent).toMatchObject({ moveX: 0.5, moveY: 1, run: true, jump: true, crouchToggle: true });
    applyTouchToTpp(touch, null, target, scratch(), { x: 0, y: 0 });
    expect(input.consume()).toMatchObject({ jump: false, crouchToggle: false });
  });

  it("przeciągnięcie kamery trafia do camera.look jednorazowo", () => {
    const touch = new TouchInput();
    const { target, looks } = rig();
    touch.addLook(10, 5);
    applyTouchToTpp(touch, null, target, scratch(), { x: 0, y: 0 });
    applyTouchToTpp(touch, null, target, scratch(), { x: 0, y: 0 });
    expect(looks).toEqual([[10 * TOUCH_LOOK_GAIN, 5 * TOUCH_LOOK_GAIN]]);
  });

  it("aktywny joystick wygrywa z padem, bez dotyku ruch idzie z pada", () => {
    const touch = new TouchInput();
    const pad = { move: { x: -1, y: -1 }, sprint: true };
    expect(externalMove(touch, pad, scratch())).toEqual({ x: -1, y: -1, sprint: true });
    touch.setMove(0, 1, false);
    expect(externalMove(touch, pad, scratch())).toEqual({ x: 0, y: 1, sprint: false });
    touch.setEnabled(false);
    expect(externalMove(touch, pad, scratch())).toEqual({ x: -1, y: -1, sprint: true });
  });

  it("bez dotyku i bez pada ruch jest zerowy", () => {
    expect(externalMove(null, null, scratch())).toEqual({ x: 0, y: 0, sprint: false });
  });
});
