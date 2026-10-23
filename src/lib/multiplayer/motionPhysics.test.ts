import { describe, expect, it } from "vitest";
import { TPP_DEFAULTS } from "../tpp/config";
import { idleIntent, makeControllerAt, rockWorld, testRock } from "../tpp/testkit";
import type { PlayerController } from "../tpp/playerController";
import { checkMotion, initialTrack, MOTION_RULES, type MotionTrack, type MotionWorld } from "./motionPhysics";

const ROCK_Z = -6;
const sample = (x: number, y: number, z: number, grounded = true) => ({ x, y, z, grounded });

/** Prawdziwy kontroler bez ograniczeń, próbkowany jak klient (20 Hz) i oceniany przez serwerową walidację. */
function replay(world: MotionWorld & { groundAt: (x: number, z: number) => number }, jumpAtZ: number | null, options: { seconds?: number; moveSeconds?: number; run?: boolean } = {}) {
  const ctl: PlayerController = makeControllerAt(world as never, 0, 0);
  let track: MotionTrack = initialTrack(0, 0, 0, 0);
  const verdicts: string[] = [];
  let jumped = false;
  let t = 0;
  let rockLandings = 0;
  const frames = Math.round((options.seconds ?? 6) * 60);
  for (let i = 0; i < frames; i++) {
    const wantJump = jumpAtZ !== null && !jumped && ctl.state.z <= jumpAtZ;
    if (wantJump) jumped = true;
    ctl.update(1 / 60, idleIntent({ moveY: i < Math.round((options.moveSeconds ?? 3.5) * 60) ? 1 : 0, run: options.run ?? true, jump: wantJump }), 0);
    t += 1 / 60;
    if (ctl.state.justLanded && ctl.state.support?.kind === "rock") rockLandings++;
    if (i % 3 === 2) {
      const s = ctl.state;
      const v = checkMotion(world, track, { x: s.x, y: s.y, z: s.z, grounded: s.grounded }, t);
      if (v.ok) track = v.track;
      else verdicts.push(`${i}:${v.reason}`);
    }
  }
  return { verdicts, track, ctl, rockLandings };
}

describe("walidacja ruchu na serwerze (fizyka skał)", () => {
  const rock = testRock("r1", 0, ROCK_Z, 0.8);
  const world = rockWorld([rock]);

  it("uczciwy ruch: bieg, skok nad skałą, lądowanie na niej, chodzenie po wierzchu i zejście są akceptowane", () => {
    let landed = 0;
    for (let z = -0.3; z > -4.6; z -= 0.1) {
      const run = replay(world, z);
      expect(run.verdicts, `skok w ${z.toFixed(1)}`).toEqual([]);
      if (run.rockLandings > 0) landed++;
    }
    expect(landed).toBeGreaterThan(3);
  });

  it("uczciwy skok i chód z kucaniem na skałę wyższą (1,2 m) także przechodzą", () => {
    const high = rockWorld([testRock("r1", 0, ROCK_Z, 1.2)]);
    for (let z = -0.3; z > -4.6; z -= 0.1) expect(replay(high, z, { run: false }).verdicts).toEqual([]);
  });

  it("niemożliwe: stanie na szczycie skały 2,5 m po biegu z ziemi jest odrzucone (ciągły i po nieciągłości)", () => {
    const tall = rockWorld([testRock("tall", 0, ROCK_Z, 2.5)]);
    const top = tall.walk.index.get("tall")!;
    const x = top.x + top.rock!.topOffset[0];
    const z = top.z + top.rock!.topOffset[1];
    const y = top.y + top.rock!.height;
    const near = checkMotion(tall, initialTrack(0, 0, z + 0.3, 0), sample(x, y, z), 0.05);
    expect(near).toEqual({ ok: false, reason: expect.stringMatching(/rise_too_fast|too_high/) });
    const far = checkMotion(tall, initialTrack(0, 0, 0, 0), sample(x, y, z), 0.05);
    expect(far).toEqual({ ok: false, reason: "too_high" });
    const air = checkMotion(tall, initialTrack(0, 0, z + 0.3, 0), sample(x, y + 0.2, z, false), 0.05);
    expect(air.ok).toBe(false);
  });

  it("niemożliwe: skok wyżej niż pozwala fizyka, wzniesienie szybsze niż skok, stopy pod terenem, 'powietrze' bez podłoża", () => {
    const flat = rockWorld([]);
    const from = initialTrack(0, 0, 0, 0);
    expect(checkMotion(flat, from, sample(0, 1.2, 0.1, false), 0.1).ok).toBe(true);
    expect(checkMotion(flat, from, sample(0, 3.2, 0.1, false), 0.1)).toEqual({ ok: false, reason: "rise_too_fast" });
    const up = { ...from, anchorY: 0 };
    expect(checkMotion(flat, up, sample(0, 1.9, 0.1, false), 1)).toEqual({ ok: false, reason: "too_high" });
    expect(checkMotion(flat, from, sample(0, -2, 0.1, false), 0.1)).toEqual({ ok: false, reason: "below_ground" });
    expect(checkMotion(flat, from, sample(0, 0.8, 0.1, true), 0.1)).toEqual({ ok: false, reason: "unsupported" });
  });

  it("niemożliwe: przejście przez bryłę skały na poziomie ziemi (jak ściana po stronie klienta)", () => {
    const prev = initialTrack(0, 0, ROCK_Z + 1.9, 0);
    expect(checkMotion(world, prev, sample(0, 0, ROCK_Z - 0.5, true), 0.2)).toEqual({ ok: false, reason: "inside_rock" });
    expect(checkMotion(world, prev, sample(0, 0, ROCK_Z + 1.7, true), 0.2).ok).toBe(true);
  });

  it("pokład mostu jest podłożem tylko, gdy serwer zna zbudowany most", () => {
    const flat = rockWorld([]);
    const deck = { ...flat, deckHeightAt: () => 2 };
    const prev = initialTrack(0, 2, 0, 0);
    expect(checkMotion(deck, prev, sample(0.1, 2, 0, true), 0.1).ok).toBe(true);
    expect(checkMotion(flat, prev, sample(0.1, 2, 0, true), 0.1).ok).toBe(false);
  });

  it("odrzucona wiadomość nie psuje śledzenia: kolejna uczciwa jest oceniana względem ostatniej przyjętej", () => {
    const flat = rockWorld([]);
    let track = initialTrack(0, 0, 0, 0);
    const bad = checkMotion(flat, track, sample(0, 5, 0.1, false), 0.1);
    expect(bad.ok).toBe(false);
    const good = checkMotion(flat, track, sample(0.2, 0.3, 0.1, false), 0.2);
    expect(good.ok).toBe(true);
    if (good.ok) track = good.track;
    expect(track.anchorY).toBe(0);
    expect(track.grounded).toBe(false);
  });

  it("reguły używają stałych domyślnych TPP: suwaki skoku i grawitacji w diagnostyce nie omijają zasad serwera", () => {
    expect(Object.isFrozen(MOTION_RULES)).toBe(true);
    expect(MOTION_RULES.jumpHeight).toBe(TPP_DEFAULTS.jumpHeight);
    expect(MOTION_RULES.gravity).toBe(TPP_DEFAULTS.gravity);
    // Klient z lokalnie podkręconym skokiem (6 m) nie dostaje przepustki: wzniesienie ponad limit jest odrzucane.
    const cheat = rockWorld([]);
    const ctl = makeControllerAt(cheat, 0, 0, { jumpHeight: 6 });
    let track = initialTrack(0, 0, 0, 0);
    let rejected = false;
    ctl.update(1 / 60, idleIntent({ jump: true }), 0);
    for (let i = 0; i < 90; i++) {
      ctl.update(1 / 60, idleIntent(), 0);
      if (i % 3 === 2) {
        const v = checkMotion(cheat, track, { x: ctl.state.x, y: ctl.state.y, z: ctl.state.z, grounded: ctl.state.grounded }, (i + 1) / 60);
        if (v.ok) track = v.track;
        else rejected = true;
      }
    }
    expect(rejected).toBe(true);
  });
});
