import { describe, expect, it } from "vitest";
import { MOVE_ZONE_FRACTION, touchZoneOf } from "./touchZones";

describe("touchZoneOf", () => {
  it("lewa część to ruch, prawa to kamera", () => {
    expect(touchZoneOf(10, 800)).toBe("move");
    expect(touchZoneOf(800 * MOVE_ZONE_FRACTION - 1, 800)).toBe("move");
    expect(touchZoneOf(800 * MOVE_ZONE_FRACTION + 1, 800)).toBe("look");
    expect(touchZoneOf(790, 800)).toBe("look");
  });

  it("niepoprawne dane nie uruchamiają joysticka", () => {
    expect(touchZoneOf(10, 0)).toBe("look");
    expect(touchZoneOf(Number.NaN, 800)).toBe("look");
  });
});
