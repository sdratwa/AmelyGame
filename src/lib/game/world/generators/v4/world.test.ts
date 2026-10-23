import { describe, expect, it } from "vitest";
import { authoritativeForestOf, forestWalkOf } from "../../lookup";
import { fingerprintWorld, generateWorld } from "../../registry";

describe("generator v4: ciągłość wydm przy ścieżkach", () => {
  it("zachowuje zamrożony świat v3 i zmienia odcisk nowego świata", () => {
    expect(fingerprintWorld(generateWorld(2030, 4))).not.toBe(fingerprintWorld(generateWorld(2030, 3)));
    const old = authoritativeForestOf({ seed: 2030, genVersion: 3 });
    expect(old.geometry.trailGap(17.8, 30)).toBe(Infinity);
    expect(old.terrain.slope(18, 30)).toBeGreaterThan(35);
  });

  it("usuwa blokadę ruchu w trzech zgłoszonych miejscach", () => {
    const walk = forestWalkOf({ seed: 2030, genVersion: 4 });
    for (const [x, z] of [[17.4, 29.6], [14.6, 25.9], [13.5, 24.3]]) {
      const move = walk.move({ x, z }, { x: x + 0.1, z });
      expect(move.blocked, `${x},${z}`).toEqual([]);
      expect(move.x).toBeCloseTo(x + 0.1, 8);
    }
  });

  it("nie ma stromych próbek w dawnym pasie uskoku dla kilku seedów", () => {
    for (const seed of [2030, 1, 777, 4000000000]) {
      const forest = authoritativeForestOf({ seed, genVersion: 4 });
      for (let x = 0; x <= 70; x += 0.5) for (let z = 10; z <= 45; z += 0.5)
        expect(forest.terrain.slope(x, z), `${seed}: ${x},${z}`).toBeLessThanOrEqual(35);
    }
  }, 120_000);
});
