import { describe, expect, it } from "vitest";
import { colliderRadius, makeObject, type WorldObject } from "@/lib/game/world/objects";
import { ROCK_SHAPES_V1, rockSupports, rockSurfaceY, rockSurfaceYClamped } from "@/lib/game/world/rockPhysics";
import { TPP_DEFAULTS, type TppConfig } from "./config";
import type { PlayerController, PlayerWorld } from "./playerController";
import { idleIntent, makeControllerAt, rockWorld, testRock } from "./testkit";

/**
 * Fizyka skał na prawdziwym `WalkWorld` i `PlayerController`: skoki nad skałami, lądowanie, stanie, chodzenie po wierzchu,
 * zejście i przeskakiwanie ze skały na skałę. Skała testowa ma szczyt na zadanej wysokości (`testRock`), a postać biegnie
 * w stronę -Z. Wszystko wynika z kolizji, położenia stóp i skoku z grawitacją: żadnego teleportu.
 */

const ROCK_Z = -6;
const PLAYER_R = 0.4;
const PENETRATION = 0.35;

const supportId = (ctl: PlayerController): string | null => ctl.state.support?.id ?? null;
const rockR = (o: WorldObject) => colliderRadius(o.collider!);

type Frame = { x: number; y: number; z: number; grounded: boolean; support: string | null; justLanded: boolean };

type RunOptions = {
  jumpAtZ?: number;
  run?: boolean;
  fps?: number;
  seconds?: number;
  /** Czas (s) biegu naprzód; potem postać stoi. */
  moveSeconds?: number;
  config?: Partial<TppConfig>;
  startZ?: number;
  crouch?: boolean;
  moveX?: number;
};

type Run = { ctl: PlayerController; frames: Frame[]; maxY: number; landedOn: string | null; blocks: Set<string> };

/** Bieg w stronę skały z jednym skokiem w punkcie `jumpAtZ`; zwraca ślad klatek. */
function runAtRock(world: PlayerWorld, o: RunOptions = {}): Run {
  const fps = o.fps ?? 60;
  const ctl = makeControllerAt(world, 0, o.startZ ?? 0, o.config);
  const frames: Frame[] = [];
  let jumped = false;
  let maxY = -Infinity;
  let landedOn: string | null = null;
  const blocks = new Set<string>();
  const total = Math.round((o.seconds ?? 5) * fps);
  const moveFrames = Math.round((o.moveSeconds ?? 2.5) * fps);
  for (let i = 0; i < total; i++) {
    const wantJump = o.jumpAtZ !== undefined && !jumped && ctl.state.z <= o.jumpAtZ;
    if (wantJump) jumped = true;
    ctl.update(1 / fps, idleIntent({ moveY: i < moveFrames ? 1 : 0, moveX: i < moveFrames ? (o.moveX ?? 0) : 0, run: o.run ?? true, jump: wantJump, crouchToggle: o.crouch === true && i === 0 }), 0);
    const s = ctl.state;
    if (s.justLanded && s.support?.kind === "rock" && !landedOn) landedOn = s.support.id;
    if (s.lastBlock) blocks.add(s.lastBlock);
    maxY = Math.max(maxY, s.y);
    frames.push({ x: s.x, y: s.y, z: s.z, grounded: s.grounded, support: s.support?.kind === "rock" ? s.support.id : null, justLanded: s.justLanded });
  }
  return { ctl, frames, maxY, landedOn, blocks };
}

/** Skok kończący się lądowaniem i staniem na skale (bieg przerwany w locie). */
const LAND: RunOptions = { moveSeconds: 1.2, seconds: 3 };

const scanPoints = (from = -0.3, to = -4.6, step = 0.1) => {
  const out: number[] = [];
  for (let z = from; z >= to; z -= step) out.push(Math.round(z * 100) / 100);
  return out;
};

/**
 * Czy postać weszła w bryłę skały z zewnątrz: w pierwszej klatce, w której środek jest wyraźnie (ponad 0,25 m) w kolizji
 * skały po wcześniejszym pobycie na zewnątrz, stopy są o ponad `PENETRATION` poniżej powierzchni wierzchu. Postać, która
 * zeszła z wierzchu i stopniowo zsuwa się z boku (reguła krawędzi), już jest "w środku" i tu nie liczy się jako wejście.
 */
function penetrates(rock: WorldObject, frames: Frame[]): Frame | null {
  const r = rockR(rock);
  let wasOutside = true;
  for (const f of frames) {
    const depth = r + PLAYER_R - Math.hypot(f.x - rock.x, f.z - rock.z);
    if (depth <= 0.05) wasOutside = true;
    else if (depth >= 0.25 && wasOutside) {
      wasOutside = false;
      if (f.y < rockSurfaceYClamped(rock, f.x, f.z) - PENETRATION) return f;
    }
  }
  return null;
}

/** Czy środek postaci nad obszarem podparcia wierzchu skały znalazł się kiedykolwiek wyraźnie pod jego powierzchnią (przejście przez wierzch)? */
function tunnelled(rock: WorldObject, frames: Frame[]): Frame | null {
  return frames.find((f) => rockSupports(rock, f.x, f.z) && f.y < rockSurfaceY(rock, f.x, f.z) - 0.06) ?? null;
}

/** Największe przesunięcie poziome i pionowe między klatkami. */
function maxStep(frames: Frame[]): { h: number; vDown: number } {
  let h = 0;
  let vDown = 0;
  for (let i = 1; i < frames.length; i++) {
    h = Math.max(h, Math.hypot(frames[i].x - frames[i - 1].x, frames[i].z - frames[i - 1].z));
    vDown = Math.max(vDown, frames[i - 1].y - frames[i].y);
  }
  return { h, vDown };
}

/** Punkty skoku z biegu, które kończą się lądowaniem na skale. */
function landingPoints(world: PlayerWorld, options: RunOptions = LAND, step = 0.1): number[] {
  return scanPoints(-0.3, -4.6, step).filter((z) => {
    const run = runAtRock(world, { ...options, jumpAtZ: z });
    return run.landedOn !== null && run.ctl.state.grounded && run.ctl.state.support?.kind === "rock";
  });
}

describe("fizyka skał: przeskakiwanie (ROCK1)", () => {
  it("1. niska skała bez skoku blokuje ruch poziomy (nie jest wejściem na skałę)", () => {
    const rock = testRock("r1", 0, ROCK_Z, 0.4);
    const run = runAtRock(rockWorld([rock]));
    expect(run.ctl.state.z).toBeGreaterThan(ROCK_Z + rockR(rock) + PLAYER_R - 0.05);
    expect(run.ctl.state.y).toBeCloseTo(0, 6);
    expect(run.blocks.has("object:r1")).toBe(true);
  });

  it("2. skok z biegu przenosi nad skałą 0,8 m na drugą stronę, bez teleportu", () => {
    const rock = testRock("r1", 0, ROCK_Z, 0.8);
    const world = rockWorld([rock]);
    const beyond = scanPoints().map((z) => runAtRock(world, { jumpAtZ: z })).filter((r) => r.landedOn === null && r.ctl.state.z < ROCK_Z - rockR(rock));
    expect(beyond.length).toBeGreaterThan(3);
    const run = beyond[0];
    expect(run.ctl.state.grounded).toBe(true);
    expect(run.ctl.state.y).toBeCloseTo(0, 3);
    expect(run.landedOn).toBeNull();
    // bieg 4,8 m/s przy 60 FPS to 0,08 m na klatkę; przy krawędzi dochodzi zsuwanie do 3,5 m/s (0,058 m na klatkę)
    expect(maxStep(run.frames).h).toBeLessThan(0.15);
    expect(penetrates(rock, run.frames)).toBeNull();
  });

  it("3. parametry skoku nie zostały zmienione, a wysokość skoku to ok. 1,5 m", () => {
    expect(TPP_DEFAULTS).toMatchObject({ jumpHeight: 1.5, gravity: 12, airControl: 0.35, standHeight: 1.55, crouchHeight: 1.0, walkSpeed: 2.2, runSpeed: 4.8, crouchSpeed: 1.0 });
    const run = runAtRock(rockWorld([]), { jumpAtZ: -1 });
    expect(run.maxY).toBeGreaterThan(1.4);
    expect(run.maxY).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it("4. skała wyższa niż skok (2,5 m) nie daje się ani przeskoczyć, ani wejść na nią", () => {
    const rock = testRock("r1", 0, ROCK_Z, 2.5);
    const world = rockWorld([rock]);
    for (const z of scanPoints()) {
      const run = runAtRock(world, { jumpAtZ: z });
      expect(run.ctl.state.z, `skok w ${z}`).toBeGreaterThan(ROCK_Z + rockR(rock) + PLAYER_R - 0.05);
      expect(run.landedOn).toBeNull();
      expect(penetrates(rock, run.frames)).toBeNull();
    }
  });

  it("5. skała 1,3 m daje się przeskoczyć, skała 1,6 m (powyżej łuku skoku z zapasem) już nie", () => {
    const passes = (h: number) => {
      const rock = testRock("r1", 0, ROCK_Z, h);
      const world = rockWorld([rock]);
      return scanPoints(-0.3, -4.6, 0.05).some((z) => {
        const run = runAtRock(world, { jumpAtZ: z });
        return run.ctl.state.z < ROCK_Z - rockR(rock);
      });
    };
    expect(passes(1.3)).toBe(true);
    expect(passes(1.6)).toBe(false);
  });

  it("6. skok z chodu: postać nigdy nie wchodzi w bryłę skały niezależnie od punktu odbicia i wysokości skały", () => {
    for (const h of [0.4, 0.8, 1.2, 1.6, 2.5]) {
      const rock = testRock("r1", 0, ROCK_Z, h);
      const world = rockWorld([rock]);
      for (const z of scanPoints(-0.2, -4.6, 0.1)) {
        const run = runAtRock(world, { jumpAtZ: z, run: false, moveSeconds: 4, seconds: 6 });
        expect(penetrates(rock, run.frames), `h=${h} z=${z}`).toBeNull();
      }
    }
  });

  it("7. skok z kucania: kucanie wstaje, skok ma tę samą wysokość, a kucająca postać wchodząca w skałę jest blokowana", () => {
    const rock = testRock("r1", 0, ROCK_Z, 0.8);
    const walk = runAtRock(rockWorld([rock]), { crouch: true, run: true, seconds: 8, moveSeconds: 8 });
    expect(walk.ctl.state.crouching).toBe(true);
    expect(walk.ctl.state.z).toBeGreaterThan(ROCK_Z + rockR(rock) + PLAYER_R - 0.05);
    const jump = runAtRock(rockWorld([]), { crouch: true, jumpAtZ: -0.5 });
    expect(jump.ctl.state.crouching).toBe(false);
    expect(jump.maxY).toBeGreaterThan(1.4);
  });

  it("8. wynik skoku nad skałą nie zależy od liczby klatek (30, 60, 144 FPS)", () => {
    const rock = testRock("r1", 0, ROCK_Z, 0.8);
    const world = rockWorld([rock]);
    for (const fps of [30, 60, 144]) {
      const run = runAtRock(world, { jumpAtZ: -1.6, fps });
      expect(run.ctl.state.z, `${fps} FPS`).toBeLessThan(ROCK_Z - rockR(rock));
      expect(run.ctl.state.y).toBeCloseTo(0, 3);
      expect(penetrates(rock, run.frames)).toBeNull();
    }
  });

  it("9. szybki spadek przy małym FPS i dużej grawitacji nie przenika przez wierzch skały (kroki cząstkowe)", () => {
    const rock = testRock("r1", 0, ROCK_Z, 0.8);
    const world = rockWorld([rock]);
    for (const z of scanPoints(-0.2, -4.6, 0.1)) {
      const run = runAtRock(world, { jumpAtZ: z, fps: 20, config: { gravity: 40, jumpHeight: 3 }, seconds: 5 });
      expect(tunnelled(rock, run.frames), `z=${z}`).toBeNull();
    }
  });
});

describe("fizyka skał: lądowanie i stanie (ROCK2)", () => {
  const rock = testRock("r1", 0, ROCK_Z, 0.8);
  const world = rockWorld([rock]);
  const top = rockSurfaceY(rock, rock.x + rock.rock!.topOffset[0], rock.z + rock.rock!.topOffset[1]);

  it("10. skok na skałę 0,8 m kończy się lądowaniem na jej szczycie (id, rodzaj, wysokość, uderzenie)", () => {
    const points = landingPoints(world);
    expect(points.length).toBeGreaterThan(0);
    const run = runAtRock(world, { jumpAtZ: points[0], moveSeconds: 1.2, seconds: 3 });
    const s = run.ctl.state;
    expect(run.landedOn).toBe("r1");
    expect(s.lastLanding).toMatchObject({ kind: "rock", id: "r1" });
    // Wysokość lądowania leży na płaszczyźnie wierzchu (tu pochylonej o kilka cm na szerokości stania), nie poniżej niej.
    expect(Math.abs(s.lastLanding!.y - top)).toBeLessThan(rock.rock!.topRadius * Math.hypot(...rock.rock!.slope) + 0.01);
    expect(s.lastLanding!.impact).toBeGreaterThan(1);
  });

  it("11. po lądowaniu postać stoi stabilnie: ta sama wysokość, grounded, bez drgań", () => {
    const [z] = landingPoints(world);
    const run = runAtRock(world, { jumpAtZ: z, moveSeconds: 1.2, seconds: 5 });
    const tail = run.frames.slice(-120);
    expect(tail.every((f) => f.grounded && f.support === "r1")).toBe(true);
    const ys = tail.map((f) => f.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-6);
    // Stopy stoją dokładnie na płaszczyźnie wierzchu w miejscu, w którym stoi postać.
    expect(ys[0]).toBeCloseTo(rockSurfaceY(rock, run.ctl.state.x, run.ctl.state.z), 3);
    expect(run.ctl.state.vy).toBe(0);
  });

  it("10b. każdy wariant skały ze stojącym wierzchem: lądowanie kończy się stabilnie na jej płaszczyźnie (bez zapadania i zsuwania)", () => {
    for (const variant of ["medium.1", "medium.2", "medium.3", "medium.4"]) {
      // Obracamy skałę tak, by środek jej wierzchu leżał na linii biegu (inaczej bieg wzdłuż osi Z mija wierzch).
      const plane = ROCK_SHAPES_V1[`rock.${variant}`].plane;
      const r = testRock("r1", 0, ROCK_Z, 0.8, { variant, yaw: Math.atan2(-plane.cx, plane.cz) });
      expect(r.rock!.standable, variant).toBe(true);
      const w = rockWorld([r]);
      const points = landingPoints(w);
      expect(points.length, variant).toBeGreaterThan(0);
      const run = runAtRock(w, { jumpAtZ: points[0], moveSeconds: 1.2, seconds: 5 });
      const tail = run.frames.slice(-120);
      expect(tail.every((f) => f.grounded && f.support === "r1"), variant).toBe(true);
      const f = tail[tail.length - 1];
      expect(f.y, variant).toBeCloseTo(rockSurfaceY(r, f.x, f.z), 3);
      expect(f.y, variant).toBeGreaterThan(0.5);
    }
  });

  it("12. po wierzchu skały da się chodzić (stopy na wysokości szczytu, support = skała)", () => {
    const [z] = landingPoints(world);
    const run = runAtRock(world, { jumpAtZ: z, moveSeconds: 1.2, seconds: 1.45 });
    // krótki ruch w bok po lądowaniu: nadal na skale
    const ctl = run.ctl;
    expect(ctl.state.support?.id).toBe("r1");
    const x0 = ctl.state.x;
    for (let i = 0; i < 5; i++) ctl.update(1 / 60, idleIntent({ moveX: 1, run: false }), 0);
    expect(ctl.state.x).toBeGreaterThan(x0 + 0.03);
    expect(ctl.state.grounded).toBe(true);
    expect(ctl.state.support?.id).toBe("r1");
    expect(ctl.state.y).toBeCloseTo(rockSurfaceY(rock, ctl.state.x, ctl.state.z), 2);
  });

  it("13. zejście z krawędzi: płynny spadek wzdłuż boku skały, bez teleportu i bez zawieszenia", () => {
    const [z] = landingPoints(world);
    // bieg dalej w stronę -Z przez cały wierzch i dalej
    const run = runAtRock(world, { jumpAtZ: z, moveSeconds: 4, seconds: 4, run: false });
    const after = run.frames.slice(run.frames.findIndex((f) => f.support === "r1"));
    const last = after[after.length - 1];
    expect(last.grounded).toBe(true);
    expect(last.y).toBeCloseTo(0, 3);
    expect(last.support).toBeNull();
    const { h, vDown } = maxStep(after);
    expect(h).toBeLessThan(0.15);
    expect(vDown).toBeLessThan(0.3);
    expect(penetrates(rock, run.frames)).toBeNull();
    for (let i = 1; i < after.length; i++) {
      expect(after[i].y).toBeLessThanOrEqual(after[i - 1].y + 1e-6);
      // postać idzie cały czas naprzód (-Z): zsunięcie z krawędzi nie cofa jej przez skałę
      expect(after[i].z).toBeLessThanOrEqual(after[i - 1].z + 0.01);
    }
  });

  it("14. skok ze skały na ziemię i ponowne wejście na tę samą skałę", () => {
    const [z] = landingPoints(world);
    const run = runAtRock(world, { jumpAtZ: z, moveSeconds: 1.2, seconds: 1.5 });
    const ctl = run.ctl;
    expect(ctl.state.support?.id).toBe("r1");
    ctl.update(1 / 60, idleIntent({ moveY: 1, jump: true, run: true }), 0);
    let apex = ctl.state.y;
    for (let i = 0; i < 240; i++) {
      ctl.update(1 / 60, idleIntent({ moveY: i < 60 ? 1 : 0, run: true }), 0);
      apex = Math.max(apex, ctl.state.y);
    }
    expect(apex).toBeGreaterThan(top + 1);
    expect(ctl.state.grounded).toBe(true);
    expect(ctl.state.y).toBeCloseTo(0, 3);
  });

  it("15. skakanie ze skały na skałę (0,8 m -> 1,0 m)", () => {
    const a = testRock("a", 0, ROCK_Z, 0.8);
    const b = testRock("b", 0, -9, 1.0);
    const w = rockWorld([a, b]);
    let found = false;
    for (const z of landingPoints(rockWorld([a]))) {
      for (const delay of [0, 6, 12, 20, 30]) {
        const first = runAtRock(w, { jumpAtZ: z, moveSeconds: 1.2, seconds: 1.45 });
        if (supportId(first.ctl) !== "a") continue;
        for (let i = 0; i < delay; i++) first.ctl.update(1 / 60, idleIntent({ moveY: 1, run: true }), 0);
        if (supportId(first.ctl) !== "a") continue;
        first.ctl.update(1 / 60, idleIntent({ moveY: 1, run: true, jump: true }), 0);
        for (let i = 0; i < 200; i++) {
          first.ctl.update(1 / 60, idleIntent({ moveY: i < 70 ? 1 : 0, run: true }), 0);
          if (first.ctl.state.justLanded && supportId(first.ctl) === "b") {
            found = true;
            expect(first.ctl.state.y).toBeCloseTo(rockSurfaceY(b, first.ctl.state.x, first.ctl.state.z), 2);
            break;
          }
        }
        if (found) return;
      }
    }
    expect(found).toBe(true);
  });

  it("16. przechylony wierzch: wysokość stóp podąża za płaszczyzną skały", () => {
    const tilted = testRock("t", 0, ROCK_Z, 0.8, { tilt: [0.1, 0.05] });
    expect(tilted.rock!.standable).toBe(true);
    expect(Math.hypot(...tilted.rock!.slope)).toBeGreaterThan(0.05);
    const w = rockWorld([tilted]);
    const [z] = landingPoints(w, LAND, 0.05);
    expect(z).toBeDefined();
    const run = runAtRock(w, { jumpAtZ: z, moveSeconds: 1.2, seconds: 4 });
    const s = run.ctl.state;
    expect(s.support?.id).toBe("t");
    expect(s.y).toBeCloseTo(rockSurfaceY(tilted, s.x, s.z), 3);
  });

  it("17. wierzch zbyt wąski albo zbyt stromy nie jest podłożem: skała zostaje przeszkodą o skończonej wysokości", () => {
    const narrow = testRock("n", 0, ROCK_Z, 0.8, { sx: 0.1, r: 0.3 });
    const steep = testRock("s", 0, ROCK_Z, 0.8, { tilt: [0.7, 0] });
    expect(narrow.rock!.standable).toBe(false);
    expect(steep.rock!.standable).toBe(false);
    for (const rockObj of [narrow, steep]) {
      const w = rockWorld([rockObj]);
      expect(landingPoints(w)).toEqual([]);
      for (const z of scanPoints(-0.2, -4.6, 0.2)) expect(penetrates(rockObj, runAtRock(w, { jumpAtZ: z }).frames)).toBeNull();
    }
  });

  it("18. środek postaci poza obszarem podparcia nie jest podparty, w środku jest (krawędź wierzchu)", () => {
    const cx = rock.x + rock.rock!.topOffset[0];
    const cz = rock.z + rock.rock!.topOffset[1];
    const rad = rock.rock!.topRadius;
    expect(world.walk.findLandingSurface(cx, cz + rad - 0.02, top + 0.2, top)?.id).toBe("r1");
    expect(world.walk.findLandingSurface(cx, cz + rad + 0.03, top + 0.2, top)).toBeNull();
    expect(world.walk.supportSurfaceAt(cx, cz + rad + 0.03, top)).toBeNull();
  });

  it("19. stojąc u podstawy skały postać nie jest wciągana na szczyt ani teleportowana", () => {
    const startZ = ROCK_Z + rockR(rock) + PLAYER_R + 0.2;
    const run = runAtRock(world, { startZ, seconds: 3, moveSeconds: 3 });
    expect(run.ctl.state.y).toBeCloseTo(0, 6);
    expect(run.ctl.state.support?.kind).toBe("terrain");
    expect(run.frames.every((f) => f.y < 0.01 && f.support === null)).toBe(true);
    const idle = runAtRock(world, { startZ, seconds: 1, moveSeconds: 0 });
    expect(idle.ctl.state.z).toBeCloseTo(startZ, 9);
  });

  it("20. skała na pochyłym terenie: lądowanie na wysokości szczytu liczonej od podstawy skały", () => {
    const ground = (_x: number, z: number) => 0.1 * z;
    const y = ground(0, ROCK_Z);
    const sloped = testRock("r1", 0, ROCK_Z, 0.8, { y });
    const w = rockWorld([sloped], { ground });
    const [z] = landingPoints(w);
    expect(z).toBeDefined();
    const run = runAtRock(w, { jumpAtZ: z, moveSeconds: 1.2, seconds: 3 });
    expect(run.ctl.state.support?.id).toBe("r1");
    expect(run.ctl.state.y).toBeCloseTo(y + sloped.rock!.height + sloped.rock!.slope[1] * (run.ctl.state.z - sloped.z - sloped.rock!.topOffset[1]) + sloped.rock!.slope[0] * (run.ctl.state.x - sloped.x - sloped.rock!.topOffset[0]), 3);
  });

  it("21. usunięcie skały spod stóp (pozyskanie) zrzuca postać na teren, a skała przestaje blokować", () => {
    const w = rockWorld([testRock("r1", 0, ROCK_Z, 0.8)]);
    const [z] = landingPoints(w);
    const run = runAtRock(w, { jumpAtZ: z, moveSeconds: 1.2, seconds: 3 });
    expect(run.ctl.state.support?.id).toBe("r1");
    expect(w.walk.removeObject("r1")).toBe(true);
    for (let i = 0; i < 120; i++) run.ctl.update(1 / 60, idleIntent(), 0);
    expect(run.ctl.state.grounded).toBe(true);
    expect(run.ctl.state.y).toBeCloseTo(0, 3);
    expect(run.ctl.state.support?.kind).toBe("terrain");
    const walkOn = makeControllerAt(w, 0, -2);
    for (let i = 0; i < 240; i++) walkOn.update(1 / 60, idleIntent({ moveY: 1 }), 0);
    expect(walkOn.state.z).toBeLessThan(ROCK_Z);
  });
});

describe("fizyka skał: regresje innych przeszkód", () => {
  it("22. drzewo (collider bez profilu) blokuje także w szczycie skoku", () => {
    const tree = makeObject({ id: "tree", kind: "tree", x: 0, z: ROCK_Z, y: 0, collider: { shape: "circle", r: 0.5 } });
    const w = rockWorld([tree]);
    for (const z of scanPoints(-0.2, -4.6, 0.2)) {
      const run = runAtRock(w, { jumpAtZ: z });
      expect(run.ctl.state.z).toBeGreaterThan(ROCK_Z + 0.5 + PLAYER_R - 0.05);
      expect(run.landedOn).toBeNull();
    }
  });

  it("23. skała z wersji świata bez profilu (v2-v4) pozostaje nieskończoną ścianą", () => {
    const legacy: WorldObject = { ...testRock("old", 0, ROCK_Z, 0.4), rock: undefined };
    delete legacy.rock;
    const w = rockWorld([legacy]);
    for (const z of scanPoints(-0.2, -4.6, 0.2)) {
      const run = runAtRock(w, { jumpAtZ: z });
      expect(run.ctl.state.z).toBeGreaterThan(ROCK_Z + rockR(legacy) + PLAYER_R - 0.05);
      expect(run.landedOn).toBeNull();
    }
  });

  it("24. bariera rzeki nie staje się przeskakiwalna (blokuje niezależnie od wysokości stóp)", () => {
    const river = { id: "barrier.river", kind: "river" as const, shape: { type: "band" as const, points: [{ x: -50, z: -8 }, { x: 50, z: -8 }], halfWidth: 1.5 } };
    const w = rockWorld([], { barriers: [river] });
    for (const z of scanPoints(-0.2, -5.5, 0.1)) {
      const run = runAtRock(w, { jumpAtZ: z });
      expect(run.ctl.state.z, `skok w ${z}`).toBeGreaterThan(-6.5 + PLAYER_R - 0.2);
    }
  });

  it("25. granice regionu pozostają nieprzekraczalne także w skoku", () => {
    const w = rockWorld([]);
    const ctl = makeControllerAt(w, 140, 0, undefined, Math.PI / 2);
    let maxX = 0;
    for (let i = 0; i < 400; i++) {
      ctl.update(1 / 60, idleIntent({ moveY: 1, run: true, jump: i % 70 === 0 }), Math.PI / 2);
      maxX = Math.max(maxX, ctl.state.x);
    }
    expect(maxX).toBeLessThan(149.6);
  });

  it("26. strome zbocze zatrzymuje także skaczącą postać", () => {
    const w = rockWorld([], { ground: (_x, z) => (z < -8 ? (-8 - z) * 3 : 0) });
    const ctl = makeControllerAt(w, 0, 0);
    for (let i = 0; i < 400; i++) ctl.update(1 / 60, idleIntent({ moveY: 1, run: true, jump: i % 70 === 0 }), 0);
    expect(ctl.state.z).toBeGreaterThan(-8.6);
  });

  it("27. blokady NPC nadal działają obok skał", () => {
    const base = rockWorld([testRock("r1", 20, -20, 0.8)]);
    const world: PlayerWorld = { ...base, blockers: () => [{ x: 0, z: -3, r: 0.6 }] };
    const ctl = makeControllerAt(world, 0, 0);
    for (let i = 0; i < 300; i++) ctl.update(1 / 60, idleIntent({ moveY: 1 }), 0);
    expect(ctl.state.z).toBeGreaterThan(-3 + 0.6 + PLAYER_R - 0.1);
  });

  it("28. stary świat bez parametru ciała: ruch kolidera jak dawniej (skała = ściana o nieskończonej wysokości)", () => {
    const w = rockWorld([testRock("r1", 0, ROCK_Z, 0.4)]);
    const hit = w.walk.move({ x: 0, z: -4 }, { x: 0, z: -9 });
    expect(hit.z).toBeGreaterThan(ROCK_Z + 1.2 + PLAYER_R - 0.05);
    const over = w.walk.move({ x: 0, z: -4 }, { x: 0, z: -9 }, undefined, { footY: 5 });
    expect(over.z).toBeCloseTo(-9, 6);
  });
});
