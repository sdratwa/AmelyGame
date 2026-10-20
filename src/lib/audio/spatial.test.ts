import { describe, expect, it } from "vitest";
import { relativeBearingDeg } from "./spatial";

describe("relativeBearingDeg", () => {
  const origin = { x: 0, z: 0, yaw: 0 };

  it("przed graczem 0 stopni, na prawo +90, za plecami +-180, na lewo -90 (yaw 0 patrzy w -Z)", () => {
    expect(relativeBearingDeg(origin, 0, -10)).toBe(0);
    expect(relativeBearingDeg(origin, 10, 0)).toBe(90);
    expect(Math.abs(relativeBearingDeg(origin, 0, 10))).toBe(180);
    expect(relativeBearingDeg(origin, -10, 0)).toBe(-90);
  });

  it("obrót kamery zmienia kierunek, a źródło zostaje w świecie", () => {
    const turned = { x: 0, z: 0, yaw: Math.PI / 2 };
    // po obrocie w lewo o 90 stopni dawne "na prawo" (+X) jest wprost z tyłu, a dawne "przed" (-Z) jest na prawo
    expect(Math.abs(relativeBearingDeg(turned, 10, 0))).toBe(180);
    expect(relativeBearingDeg(turned, 0, -10)).toBe(90);
    expect(relativeBearingDeg(turned, -10, 0)).toBe(0);
  });

  it("liczy od pozycji gracza", () => {
    expect(relativeBearingDeg({ x: 5, z: 5, yaw: 0 }, 15, 5)).toBe(90);
  });
});
