import { describe, expect, it } from "vitest";
import { TPP_DEFAULTS } from "./config";
import { flatWorld, idleIntent, makeController, simulate } from "./testkit";

describe("PlayerController: prędkości", () => {
  it("chód 2,2 m/s, bieg 4,8 m/s, kucanie 1,0 m/s (po rozpędzeniu)", () => {
    const walk = makeController();
    simulate(walk, 2, 60, () => idleIntent({ moveY: 1 }));
    expect(walk.state.speed).toBeCloseTo(TPP_DEFAULTS.walkSpeed, 2);

    const run = makeController();
    simulate(run, 2, 60, () => idleIntent({ moveY: 1, run: true }));
    expect(run.state.speed).toBeCloseTo(TPP_DEFAULTS.runSpeed, 2);

    const crouch = makeController();
    simulate(crouch, 0.1, 60, (i) => idleIntent({ crouchToggle: i === 0 }));
    simulate(crouch, 2, 60, () => idleIntent({ moveY: 1, run: true }));
    expect(crouch.state.crouching).toBe(true);
    expect(crouch.state.speed).toBeCloseTo(TPP_DEFAULTS.crouchSpeed, 2);
  });

  it("ruch po ukosie nie jest szybszy niż po prostej", () => {
    const ctl = makeController();
    simulate(ctl, 2, 60, () => idleIntent({ moveX: 1, moveY: 1 }));
    expect(ctl.state.speed).toBeCloseTo(TPP_DEFAULTS.walkSpeed, 2);
  });

  it("przebyta droga nie zależy od liczby klatek na sekundę (30, 60, 144 FPS)", () => {
    const dist = (fps: number) => {
      const ctl = makeController();
      simulate(ctl, 3, fps, () => idleIntent({ moveY: 1, run: true }));
      return Math.hypot(ctl.state.x, ctl.state.z);
    };
    const d60 = dist(60);
    expect(Math.abs(dist(30) - d60) / d60).toBeLessThan(0.02);
    expect(Math.abs(dist(144) - d60) / d60).toBeLessThan(0.02);
  });

  it("zatrzymanie jest płynne (hamowanie), a nie natychmiastowe", () => {
    const ctl = makeController();
    simulate(ctl, 2, 60, () => idleIntent({ moveY: 1, run: true }));
    ctl.update(1 / 60, idleIntent(), 0);
    expect(ctl.state.speed).toBeGreaterThan(3);
    simulate(ctl, 1, 60, () => idleIntent());
    expect(ctl.state.speed).toBe(0);
  });

  it("zbyt długa klatka jest obcinana (brak teleportu po zacięciu)", () => {
    const ctl = makeController();
    simulate(ctl, 1, 60, () => idleIntent({ moveY: 1, run: true }));
    const z0 = ctl.state.z;
    ctl.update(5, idleIntent({ moveY: 1, run: true }), 0);
    expect(Math.abs(ctl.state.z - z0)).toBeLessThan(0.6);
  });
});

describe("PlayerController: kierunek ruchu i obrót ciała", () => {
  it("W idzie tam, gdzie patrzy kamera (yaw 0 = -Z); D w prawo od kamery", () => {
    const f = makeController();
    simulate(f, 1, 60, () => idleIntent({ moveY: 1 }));
    expect(f.state.z).toBeLessThan(-1);
    expect(Math.abs(f.state.x)).toBeLessThan(1e-6);
    const r = makeController();
    simulate(r, 1, 60, () => idleIntent({ moveX: 1 }));
    expect(r.state.x).toBeGreaterThan(1);
  });

  it("w marszu ciało obraca się płynnie w stronę ruchu (z ograniczoną prędkością obrotu)", () => {
    const ctl = makeController();
    ctl.update(1 / 60, idleIntent({ moveX: 1 }), 0);
    ctl.update(1 / 60, idleIntent({ moveX: 1 }), 0);
    expect(Math.abs(ctl.state.bodyYaw)).toBeLessThanOrEqual(TPP_DEFAULTS.turnSpeed * (2 / 60) + 1e-9);
    simulate(ctl, 1, 60, () => idleIntent({ moveX: 1 }));
    expect(ctl.state.bodyYaw).toBeCloseTo(-Math.PI / 2, 2);
  });

  it("w miejscu ciało się nie obraca, w kuckach w ruchu patrzy zgodnie z kamerą", () => {
    const idle = makeController();
    simulate(idle, 1, 60, () => idleIntent(), 1.2);
    expect(idle.state.bodyYaw).toBe(0);
    const c = makeController();
    simulate(c, 0.1, 60, (i) => idleIntent({ crouchToggle: i === 0 }));
    simulate(c, 1, 60, () => idleIntent({ moveX: 1 }), 0.8);
    expect(c.state.bodyYaw).toBeCloseTo(0.8, 2);
    const v = c.localVelocity();
    expect(v.right).toBeGreaterThan(0.8);
    expect(Math.abs(v.forward)).toBeLessThan(0.05);
  });
});

describe("PlayerController: skok", () => {
  it("skok z ziemi osiąga zadaną wysokość, lądowanie zgłasza zdarzenie raz, drugi skok w powietrzu jest ignorowany", () => {
    const ctl = makeController();
    let peak = 0;
    let jumps = 0;
    let landings = 0;
    for (let i = 0; i < 160; i++) {
      // Spacja wciśnięta ponownie w powietrzu (klatka 10) nie daje drugiego skoku.
      const s = ctl.update(1 / 120, idleIntent({ jump: i === 0 || i === 10 }), 0);
      if (s.justJumped) jumps++;
      if (s.justLanded) landings++;
      peak = Math.max(peak, s.y);
    }
    expect(jumps).toBe(1);
    expect(landings).toBe(1);
    expect(ctl.state.grounded).toBe(true);
    expect(ctl.state.y).toBe(0);
    expect(peak).toBeGreaterThan(TPP_DEFAULTS.jumpHeight * 0.92);
    expect(peak).toBeLessThan(TPP_DEFAULTS.jumpHeight * 1.08);
  });

  it("czas lotu zgadza się z expectedAirTime", () => {
    const ctl = makeController();
    ctl.update(1 / 240, idleIntent({ jump: true }), 0);
    let air = 1 / 240;
    while (!ctl.state.grounded && air < 3) {
      ctl.update(1 / 240, idleIntent(), 0);
      air += 1 / 240;
    }
    expect(air).toBeCloseTo(ctl.expectedAirTime, 1);
  });

  it("w powietrzu nie zmienia się poza kucania, a przy skoku z kucania postać wstaje", () => {
    const ctl = makeController();
    simulate(ctl, 0.1, 60, (i) => idleIntent({ crouchToggle: i === 0 }));
    expect(ctl.state.crouching).toBe(true);
    const s = ctl.update(1 / 60, idleIntent({ jump: true }), 0);
    expect(s.justJumped).toBe(true);
    expect(s.crouching).toBe(false);
  });

  it("brak miejsca nad głową: nie wstanie ani nie skoczy z kucania", () => {
    let room = false;
    const ctl = makeController(flatWorld({ canStand: () => room }));
    simulate(ctl, 0.5, 60, (i) => idleIntent({ crouchToggle: i === 0 }));
    expect(ctl.state.crouching).toBe(true);
    ctl.update(1 / 60, idleIntent({ crouchToggle: true }), 0);
    expect(ctl.state.crouching).toBe(true);
    const s = ctl.update(1 / 60, idleIntent({ jump: true }), 0);
    expect(s.justJumped).toBe(false);
    room = true;
    ctl.update(1 / 60, idleIntent({ crouchToggle: true }), 0);
    expect(ctl.state.crouching).toBe(false);
  });
});

describe("PlayerController: kapsuła kucania", () => {
  it("wysokość kapsuły płynnie schodzi do wysokości kucania i wraca", () => {
    const ctl = makeController();
    simulate(ctl, 0.05, 60, (i) => idleIntent({ crouchToggle: i === 0 }));
    expect(ctl.state.capsuleHeight).toBeLessThan(TPP_DEFAULTS.standHeight);
    expect(ctl.state.capsuleHeight).toBeGreaterThan(TPP_DEFAULTS.crouchHeight);
    simulate(ctl, 0.5, 60, () => idleIntent());
    expect(ctl.state.capsuleHeight).toBeCloseTo(TPP_DEFAULTS.crouchHeight, 5);
    simulate(ctl, 0.5, 60, (i) => idleIntent({ crouchToggle: i === 0 }));
    expect(ctl.state.capsuleHeight).toBeCloseTo(TPP_DEFAULTS.standHeight, 5);
  });
});

describe("PlayerController: teren i przeszkody", () => {
  it("stopy podążają za terenem na zboczu (bez wpadania i unoszenia)", () => {
    const ctl = makeController(flatWorld({ ground: (x, z) => 0.2 * -z + Math.sin(x) * 0.02 }));
    simulate(ctl, 3, 60, () => idleIntent({ moveY: 1 }));
    const ground = 0.2 * -ctl.state.z + Math.sin(ctl.state.x) * 0.02;
    expect(Math.abs(ctl.state.y - ground)).toBeLessThan(0.12);
    expect(ctl.state.grounded).toBe(true);
  });

  it("zejście z krawędzi: spadanie bez skoku kończy się lądowaniem na nowej wysokości", () => {
    const ctl = makeController(flatWorld({ ground: (_x, z) => (z < -2 ? -3 : 0) }));
    let fell = false;
    let landed = false;
    for (let i = 0; i < 240; i++) {
      const s = ctl.update(1 / 60, idleIntent({ moveY: 1 }), 0);
      fell ||= s.falling;
      landed ||= s.justLanded;
    }
    expect(fell).toBe(true);
    expect(landed).toBe(true);
    expect(ctl.state.y).toBeCloseTo(-3, 3);
  });

  it("ściana zatrzymuje postać i zeruje prędkość (prędkość nie narasta pod ścianą)", () => {
    const ctl = makeController(flatWorld({ wallX: 1 }));
    simulate(ctl, 3, 60, () => idleIntent({ moveX: 1 }));
    expect(ctl.state.x).toBeCloseTo(1, 5);
    expect(ctl.state.speed).toBeLessThan(0.01);
    expect(ctl.state.lastBlock).toContain("object");
  });

  it("teleport ustawia stopy na terenie i zeruje prędkość", () => {
    const ctl = makeController(flatWorld({ ground: (x) => x * 0.1 }));
    simulate(ctl, 1, 60, () => idleIntent({ moveY: 1 }));
    ctl.teleport(10, 5, 1);
    expect(ctl.state.y).toBeCloseTo(1, 5);
    expect(ctl.state.speed).toBe(0);
    expect(ctl.state.bodyYaw).toBe(1);
  });
});
