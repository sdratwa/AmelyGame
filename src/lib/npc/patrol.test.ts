import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/game/core/rng";
import { Patroller, planPatrolRoute, segmentFree, type PatrolConfig, type Point } from "./patrol";

const home: Point = { x: 100, z: -40 };
const open = () => true;
const config: PatrolConfig = { speed: 1, waitMin: 2, waitMax: 4, turnRate: 1.5, accel: 4 };
const OPTIONS = { maxRadius: 2.6, points: 4 };

describe("trasa patrolu", () => {
  it("jest deterministyczna dla tego samego ziarna i mieści się w promieniu od kotwicy", () => {
    const a = planPatrolRoute(home, open, mulberry32(5), OPTIONS);
    const b = planPatrolRoute(home, open, mulberry32(5), OPTIONS);
    const c = planPatrolRoute(home, open, mulberry32(6), OPTIONS);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a[0]).toEqual(home);
    for (const p of a) expect(Math.hypot(p.x - home.x, p.z - home.z)).toBeLessThanOrEqual(2.6 + 1e-9);
  });

  it("omija przeszkody: żaden punkt ani odcinek nie wchodzi w zablokowany obszar", () => {
    const blocked = (x: number, z: number) => !(Math.hypot(x - (home.x + 1.5), z - home.z) < 1.0);
    const route = planPatrolRoute(home, blocked, mulberry32(9), OPTIONS);
    expect(route.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < route.length; i++) {
      expect(blocked(route[i].x, route[i].z)).toBe(true);
      expect(segmentFree(route[i], route[(i + 1) % route.length], blocked)).toBe(true);
    }
  });

  it("bez bezpiecznej pętli trasa jest pusta, a postać stoi w miejscu", () => {
    const wall = (x: number, z: number) => Math.hypot(x - home.x, z - home.z) < 0.3;
    const route = planPatrolRoute(home, wall, mulberry32(1), OPTIONS);
    expect(route).toEqual([]);
    const p = new Patroller(route, { ...home, yaw: 0 }, config, mulberry32(2));
    for (let i = 0; i < 600; i++) p.update(1 / 60);
    expect(p.x).toBe(home.x);
    expect(p.z).toBe(home.z);
    expect(p.mode).toBe("wait");
    expect(p.hasRoute).toBe(false);
  });

  it("zablokowany punkt domowy daje pustą trasę", () => {
    expect(planPatrolRoute(home, () => false, mulberry32(1), OPTIONS)).toEqual([]);
  });
});

describe("patrol: ruch", () => {
  const route = planPatrolRoute(home, open, mulberry32(3), OPTIONS);

  it("idzie ze stałą prędkością (nie szybciej), robi postoje i nigdy nie teleportuje się", () => {
    const p = new Patroller(route, { ...home, yaw: 0 }, config, mulberry32(4));
    let prev = { x: p.x, z: p.z };
    let maxStep = 0;
    let walkSeconds = 0;
    let waitSeconds = 0;
    let maxSpeed = 0;
    for (let i = 0; i < 60 * 90; i++) {
      p.update(1 / 60);
      const step = Math.hypot(p.x - prev.x, p.z - prev.z);
      maxStep = Math.max(maxStep, step);
      if (p.mode === "walk") {
        walkSeconds += 1 / 60;
        maxSpeed = Math.max(maxSpeed, p.speed);
      } else waitSeconds += 1 / 60;
      expect(step).toBeLessThanOrEqual(config.speed / 60 + 1e-9);
      prev = { x: p.x, z: p.z };
    }
    expect(maxStep).toBeGreaterThan(0.012);
    expect(maxSpeed).toBeCloseTo(config.speed, 6);
    expect(walkSeconds).toBeGreaterThan(15);
    expect(waitSeconds).toBeGreaterThan(15);
    for (const pt of [{ x: p.x, z: p.z }]) expect(Math.hypot(pt.x - home.x, pt.z - home.z)).toBeLessThanOrEqual(2.61);
  });

  it("rusza i zatrzymuje się łagodnie, a zatrzymuje dokładnie na punkcie trasy", () => {
    const p = new Patroller(route, { ...home, yaw: 0 }, config, mulberry32(4));
    const speeds: number[] = [];
    const stops: Point[] = [];
    let was = p.mode;
    for (let i = 0; i < 60 * 60; i++) {
      p.update(1 / 60);
      if (p.mode === "walk") speeds.push(p.speed);
      if (was === "walk" && p.mode === "wait") stops.push({ x: p.x, z: p.z });
      was = p.mode;
    }
    expect(speeds[0]).toBeLessThan(0.2);
    expect(speeds.every((s, i) => i === 0 || Math.abs(s - speeds[i - 1]) <= (config.accel / 60) * 1.5 + 1e-9 || speeds[i - 1] === 0 || s === 0)).toBe(true);
    expect(stops.length).toBeGreaterThan(2);
    for (const s of stops) expect(route.some((r) => Math.hypot(r.x - s.x, r.z - s.z) < 1e-6)).toBe(true);
  });

  it("zaczyna marsz dopiero po obrocie w stronę celu (bez chodzenia bokiem)", () => {
    const p = new Patroller(route, { ...home, yaw: Math.PI }, config, mulberry32(4));
    for (let i = 0; i < 60 * 30 && p.mode !== "walk"; i++) p.update(1 / 60);
    expect(p.mode).toBe("walk");
    const target = route[1];
    const bearing = Math.atan2(target.x - p.x, target.z - p.z);
    expect(Math.abs(Math.atan2(Math.sin(bearing - p.yaw), Math.cos(bearing - p.yaw)))).toBeLessThan(0.1);
  });

  it("wymuszony postój (reakcja) zatrzymuje ruch, odwraca postać ku graczowi i po nim patrol rusza dalej", () => {
    const p = new Patroller(route, { ...home, yaw: 0 }, config, mulberry32(4));
    for (let i = 0; i < 60 * 30 && p.mode !== "walk"; i++) p.update(1 / 60);
    const at = { x: p.x, z: p.z };
    const player = { x: p.x + 5, z: p.z };
    for (let i = 0; i < 60 * 3.5; i++) p.update(1 / 60, { hold: true, face: player });
    expect(p.mode).toBe("hold");
    expect(p.x).toBe(at.x);
    expect(p.z).toBe(at.z);
    expect(p.speed).toBe(0);
    expect(Math.abs(p.yaw - Math.PI / 2)).toBeLessThan(0.05);
    let farthest = 0;
    for (let i = 0; i < 60 * 30; i++) {
      p.update(1 / 60);
      farthest = Math.max(farthest, Math.hypot(p.x - at.x, p.z - at.z));
    }
    expect(farthest).toBeGreaterThan(0.5);
  });

  it("ustępuje graczowi na drodze: czeka, zamiast wejść w niego", () => {
    const p = new Patroller(route, { ...home, yaw: 0 }, config, mulberry32(4));
    for (let i = 0; i < 60 * 30 && p.mode !== "walk"; i++) p.update(1 / 60);
    const dir = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
    const player = { x: p.x + dir.x * 2.2, z: p.z + dir.z * 2.2, r: 0.4 };
    let minDist = Infinity;
    for (let i = 0; i < 60 * 10; i++) {
      p.update(1 / 60, { blockers: [player], radius: 0.9 });
      minDist = Math.min(minDist, Math.hypot(player.x - p.x, player.z - p.z));
    }
    expect(minDist).toBeGreaterThan(0.9 + 0.4);
    expect(p.isYielding).toBe(true);
    expect(p.moving).toBe(false);
  });
});
