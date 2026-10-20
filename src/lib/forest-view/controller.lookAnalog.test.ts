import { describe, expect, it } from "vitest";
import type { HeightField } from "@/lib/game/world/terrain";
import type { WalkWorld } from "@/lib/game/world/walk";
import { FirstPersonController } from "./controller";

const terrain = { height: () => 0 } as unknown as HeightField;
const walk = {} as unknown as WalkWorld;
const make = () => new FirstPersonController(walk, terrain, { x: 0, z: 0, yaw: 0 });

describe("FirstPersonController.lookAnalog", () => {
  it("wychylenie w prawo zmniejsza yaw (tak jak ruch myszy w prawo)", () => {
    const c = make();
    c.lookAnalog(1, 0, 0.05, 2.8, 2);
    expect(c.state.yaw).toBeCloseTo(-0.14, 6);
    const m = make();
    m.look(10, 0);
    expect(Math.sign(m.state.yaw)).toBe(Math.sign(c.state.yaw));
  });

  it("obrót jest niezależny od FPS: ta sama prędkość dla 60 i 120 klatek na sekundę", () => {
    const a = make();
    const b = make();
    for (let i = 0; i < 60; i++) a.lookAnalog(0.5, 0, 1 / 60, 2.8, 2);
    for (let i = 0; i < 120; i++) b.lookAnalog(0.5, 0, 1 / 120, 2.8, 2);
    expect(a.state.yaw).toBeCloseTo(b.state.yaw, 6);
    expect(a.state.yaw).toBeCloseTo(-1.4, 6);
  });

  it("wychylenie w dół obniża pitch, a pitch ma ten sam limit co mysz", () => {
    const c = make();
    const start = c.state.pitch;
    c.lookAnalog(0, 1, 0.05, 2.8, 2);
    expect(c.state.pitch).toBeLessThan(start);
    for (let i = 0; i < 200; i++) c.lookAnalog(0, 1, 0.05, 2.8, 2);
    expect(c.state.pitch).toBeCloseTo(-1.45, 6);
    for (let i = 0; i < 400; i++) c.lookAnalog(0, -1, 0.05, 2.8, 2);
    expect(c.state.pitch).toBeCloseTo(1.45, 6);
  });

  it("długa klatka jest obcinana (brak skoku kamery po zacięciu)", () => {
    const c = make();
    c.lookAnalog(1, 0, 5, 2.8, 2);
    expect(c.state.yaw).toBeCloseTo(-0.28, 6);
  });

  it("zerowe wychylenie nie zmienia kamery", () => {
    const c = make();
    const { yaw, pitch } = c.state;
    c.lookAnalog(0, 0, 0.016, 2.8, 2);
    expect(c.state.yaw).toBe(yaw);
    expect(c.state.pitch).toBe(pitch);
  });
});
