import { describe, expect, it } from "vitest";
import { rngStream } from "@/lib/game/core/rng";
import { DEER_BEHAVIOR, DeerBrain, type DeerConfig } from "./deerBrain";
import type { Point } from "./patrol";

const config: DeerConfig = { ...DEER_BEHAVIOR, walkSpeed: 0.92 };
const BODY = 0.7;

type Obstacle = { x: number; z: number; r: number };
/** Świat testowy: dysk o promieniu `radius` z okrągłymi przeszkodami; jeleń potrzebuje zapasu `BODY` od krawędzi i przeszkód. */
const world = (radius: number, obstacles: readonly Obstacle[] = []) => (x: number, z: number) =>
  Math.hypot(x, z) <= radius - BODY && obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + BODY);

const make = (seed: number, free = world(60), home: Point = { x: 0, z: 0 }, yaw = 0) => new DeerBrain(config, home, yaw, { free }, rngStream(seed, "brain"));

type Trace = { x: number; z: number; speed: number; mode: string; yaw: number };
function run(brain: DeerBrain, seconds: number, player: (t: number) => Point | null, fps = 60, onStep?: (b: DeerBrain, t: number) => void): Trace[] {
  const out: Trace[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const px = brain.x;
    const pz = brain.z;
    brain.update(1 / fps, player(t));
    expect(Math.hypot(brain.x - px, brain.z - pz), `krok ${i}`).toBeLessThanOrEqual(config.walkSpeed * config.retreatFactor / fps + 1e-6);
    onStep?.(brain, t);
    out.push({ x: brain.x, z: brain.z, speed: brain.speed, mode: brain.mode, yaw: brain.yaw });
  }
  return out;
}

describe("jeleń: spacer po polanie", () => {
  it("spaceruje i odpoczywa na przemian, zostaje w promieniu spaceru i zawsze stoi na wolnym terenie", () => {
    const free = world(60);
    const brain = make(1, free);
    const trace = run(brain, 600, () => null, 60, (b) => expect(free(b.x, b.z)).toBe(true));
    const modes = new Set(trace.map((t) => t.mode));
    expect(modes).toEqual(new Set(["rest", "stroll"]));
    const starts = trace.filter((t, i) => i > 0 && t.mode === "stroll" && trace[i - 1].mode === "rest").length;
    expect(starts).toBeGreaterThanOrEqual(8);
    expect(Math.max(...trace.map((t) => Math.hypot(t.x, t.z)))).toBeLessThanOrEqual(config.leash + 0.5);
    // Na odpoczynku nie przesuwa się i nie ma prędkości (nogi stoją).
    for (const t of trace.filter((t) => t.mode === "rest" && t.speed < 1e-6)) expect(t.speed).toBe(0);
    const restTime = trace.filter((t) => t.mode === "rest").length / 60;
    expect(restTime).toBeGreaterThan(100);
    expect(Math.max(...trace.map((t) => t.speed))).toBeLessThanOrEqual(config.walkSpeed * config.strollFactor + 1e-6);
  });

  it("nie wchodzi w przeszkody i nie wychodzi za granicę, nawet gdy polana jest ciasna", () => {
    const obstacles: Obstacle[] = [
      { x: 2, z: 0, r: 0.8 },
      { x: -1.5, z: 2.5, r: 1.1 },
      { x: 0, z: -3, r: 0.6 },
      { x: 3.5, z: 3, r: 1.2 },
    ];
    const free = world(7, obstacles);
    for (let seed = 1; seed <= 12; seed++) {
      const brain = make(seed, free, { x: 0, z: 0.2 });
      run(brain, 240, () => null, 60, (b) => expect(free(b.x, b.z), `seed ${seed}`).toBe(true));
    }
  });

  it("jest deterministyczny: ten sam seed daje tę samą trasę, inny seed inną", () => {
    const a = run(make(7), 120, () => null);
    const b = run(make(7), 120, () => null);
    const c = run(make(8), 120, () => null);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("obrót jest płynny: prędkość kątowa nie przekracza limitu, a zmiana kierunku nie jest skokiem", () => {
    const brain = make(3);
    let maxRate = 0;
    let last = brain.yaw;
    run(brain, 300, () => null, 60, (b) => {
      let d = b.yaw - last;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      maxRate = Math.max(maxRate, Math.abs(d) * 60);
      last = b.yaw;
    });
    expect(maxRate).toBeLessThanOrEqual(config.turnRate + 1e-6);
  });
});

describe("jeleń: reakcja na gracza", () => {
  const approach = (brain: DeerBrain, from: Point, speed = 1.5) => {
    let p = { ...from };
    return (t: number) => {
      const dx = brain.x - p.x;
      const dz = brain.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 3 && t < 12) p = { x: p.x + (dx / d) * (speed / 60), z: p.z + (dz / d) * (speed / 60) };
      return p;
    };
  };

  it("poniżej 10 m staje, patrzy na gracza, a po chwili spokojnie odchodzi (marszem, bez galopu)", () => {
    const brain = make(2, world(60), { x: 0, z: 0 }, 1);
    run(brain, 6, () => null);
    // Gracz stoi 9 m od jelenia.
    const player = { x: brain.x + 9, z: brain.z };
    const modes: string[] = [];
    let maxSpeed = 0;
    let alertAt = -1;
    let retreatAt = -1;
    let stoppedBy = -1;
    run(brain, 40, () => player, 60, (b, t) => {
      if (modes[modes.length - 1] !== b.mode) modes.push(b.mode);
      maxSpeed = Math.max(maxSpeed, b.speed);
      if (b.mode === "alert" && alertAt < 0) alertAt = t;
      if (b.mode === "alert" && b.speed < 1e-3 && stoppedBy < 0) stoppedBy = t;
      if (b.mode === "retreat" && retreatAt < 0) retreatAt = t;
      if (b.mode === "alert") expect(b.lookAt).toEqual(player);
    });
    expect(modes.slice(0, 3)).toEqual(expect.arrayContaining(["alert", "retreat"]));
    expect(alertAt).toBeLessThan(0.1);
    expect(stoppedBy).toBeLessThan(alertAt + 1.5);
    // Czas patrzenia na gracza przed odejściem: co najmniej 1,6 s.
    expect(retreatAt - alertAt).toBeGreaterThanOrEqual(config.alert[0] - 0.05);
    expect(maxSpeed).toBeLessThanOrEqual(config.walkSpeed * config.retreatFactor + 1e-6);
    expect(brain.distance).toBeGreaterThan(config.alertDistance);
    expect(brain.retreats).toBeGreaterThanOrEqual(1);
  });

  it("odchodzi od gracza z każdej strony (dystans rośnie) i nie mija go po drodze", () => {
    for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8], [5.6, 5.6], [-5.6, 5.6]]) {
      const brain = make(5, world(80), { x: 0, z: 0 }, 2);
      run(brain, 8, () => null);
      const player = { x: brain.x + dx, z: brain.z + dz };
      const start = Math.hypot(dx, dz);
      let closest = Infinity;
      run(brain, 30, () => player, 60, (b) => (closest = Math.min(closest, b.distance)));
      expect(brain.distance, `${dx},${dz}`).toBeGreaterThan(start + 2);
      expect(closest, `${dx},${dz}`).toBeGreaterThan(start - 0.8);
    }
  });

  it("histereza: spokojny powyżej 10 m, czujny poniżej, a wraca do spokoju dopiero powyżej 13 m", () => {
    const brain = make(4, world(60), { x: 0, z: 0 }, 0);
    run(brain, 1, () => null);
    let player = { x: brain.x + 10.5, z: brain.z };
    run(brain, 0.5, () => player);
    expect(brain.mode).not.toBe("alert");
    player = { x: brain.x + 9.5, z: brain.z };
    run(brain, 0.2, () => player);
    expect(brain.mode).toBe("alert");
    player = { x: brain.x + 11.5, z: brain.z };
    run(brain, 0.2, () => player);
    expect(brain.mode).toBe("alert");
    player = { x: brain.x + 13.5, z: brain.z };
    run(brain, 0.2, () => player);
    expect(brain.mode).toBe("rest");
  });

  it("zapędzony w kąt stoi i patrzy (nie przechodzi obok gracza ani przez przeszkody)", () => {
    const free = world(9, []);
    const brain = make(6, free, { x: 7, z: 0 }, 0);
    const player = { x: 0, z: 0 };
    const trace = run(brain, 60, () => player, 60, (b) => expect(free(b.x, b.z)).toBe(true));
    expect(trace.every((t) => Math.hypot(t.x - player.x, t.z - player.z) > 4)).toBe(true);
    expect(["alert", "retreat", "rest"]).toContain(brain.mode);
  });

  it("po odejściu gracza wraca na polanę (spacer ku domowi), nie odchodząc w głąb lasu na stałe", () => {
    const brain = make(9, world(120), { x: 0, z: 0 }, 0);
    run(brain, 3, () => null);
    const player = approach(brain, { x: brain.x + 9, z: brain.z }, 3);
    run(brain, 20, player);
    expect(brain.retreats).toBeGreaterThanOrEqual(1);
    const away = brain.homeDistance;
    expect(away).toBeGreaterThan(6);
    run(brain, 240, () => ({ x: 500, z: 500 }));
    expect(brain.homeDistance).toBeLessThan(config.leash + 1);
  });

  it("fuzz: losowy gracz wokół jelenia nigdy nie wypycha go w przeszkodę, poza dysk ani poza smycz odejścia", () => {
    const obstacles: Obstacle[] = [{ x: 4, z: 3, r: 1 }, { x: -5, z: -2, r: 1.4 }, { x: 0, z: 8, r: 2 }];
    const free = world(30, obstacles);
    for (let seed = 1; seed <= 25; seed++) {
      const rng = rngStream(seed, "player");
      const brain = make(seed, free, { x: 0, z: 0 }, 0);
      let p = { x: 15, z: 5 };
      let heading = rng() * Math.PI * 2;
      run(brain, 180, () => {
        heading += (rng() - 0.5) * 0.4;
        p = { x: p.x + Math.cos(heading) * 0.05, z: p.z + Math.sin(heading) * 0.05 };
        if (Math.hypot(p.x - brain.x, p.z - brain.z) > 25) heading = Math.atan2(brain.z - p.z, brain.x - p.x);
        return p;
      }, 60, (b) => {
        expect(free(b.x, b.z), `seed ${seed}`).toBe(true);
        expect(b.homeDistance).toBeLessThanOrEqual(config.retreatLeash + 1);
      });
    }
  });
});
