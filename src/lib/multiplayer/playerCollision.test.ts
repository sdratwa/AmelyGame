import { describe, expect, it } from "vitest";
import { playersOverlap } from "./playerCollision";

const player = (x: number, y = 0, z = 0, crouching = false) => ({ x, y, z, crouching });

describe("kolizja graczy", () => {
  it("nie pozwala dwóm stojącym graczom zajmować tego samego miejsca", () => {
    expect(playersOverlap(player(0), player(0.79))).toBe(true);
    expect(playersOverlap(player(0), player(0.8))).toBe(false);
  });

  it("pozwala przeskoczyć nad graczem przy wystarczającej wysokości", () => {
    expect(playersOverlap(player(0, 1), player(0))).toBe(true);
    expect(playersOverlap(player(0, 1.7), player(0))).toBe(false);
    expect(playersOverlap(player(0, 1.1), player(0, 0, 0, true))).toBe(false);
  });
});
