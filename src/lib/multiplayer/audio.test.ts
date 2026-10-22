import { it, expect } from "vitest";
import { PlayerStepEmitter, stepGain } from "../audio/playerSpatial";
import { idleMotion, SOUND_REGISTRY, type Player } from "./protocol";
import { createSoundEvent, SoundEventGate } from "./soundEvents";
const player: Player = {
  ...idleMotion(5, 2, 9),
  playerId: "a",
  sessionId: "s",
  name: "A",
};
function count(speed: number, grounded = true) {
  const e = new PlayerStepEmitter();
  let n = 0;
  for (let i = 0; i < 200; i++)
    if (e.update({ ...player, x: i * speed * 0.05, speed, grounded }, 0.05))
      n++;
  return n;
}
it("independent emitters keep independent cadence", () => {
  const a = new PlayerStepEmitter(),
    b = new PlayerStepEmitter();
  expect(a.scheduler).not.toBe(b.scheduler);
});
it("running produces more steps than walking", () =>
  expect(count(4.8)).toBeGreaterThan(count(2.2)));
it("idle generates no footsteps", () => expect(count(0)).toBe(0));
it("airborne movement generates no footsteps", () =>
  expect(count(4.8, false)).toBe(0));
it("crouch range is quieter at distance", () =>
  expect(stepGain(7, 6)).toBeLessThan(stepGain(7, 22)));
it("attenuation is monotonic and smoothly reaches zero", () => {
  let last = 1;
  for (let d = 0; d < 40; d += 0.1) {
    const g = stepGain(d, 36);
    expect(g).toBeLessThanOrEqual(last + 1e-8);
    last = g;
  }
  expect(stepGain(36, 36)).toBe(0);
});
it("sound position is captured at sender head", () => {
  const e = createSoundEvent(player, "world_001", "HELP_SHOUT", 1, 100);
  expect(e).toMatchObject({ x: 5, y: 3.4, z: 9, playerId: "a" });
});
it("duplicate and reordered sound events are rejected", () => {
  const gate = new SoundEventGate(),
    e = createSoundEvent(player, "world_001", "HELP_SHOUT", 2, 100);
  expect(gate.accept(e, "world_001", [player], 100)).toBe(true);
  expect(gate.accept(e, "world_001", [player], 100)).toBe(false);
  expect(gate.accept({ ...e, sequence: 1 }, "world_001", [player], 100)).toBe(
    false,
  );
});
it("sound never crosses world boundaries", () => {
  expect(
    new SoundEventGate().accept(
      createSoundEvent(player, "other", "HELP_SHOUT", 1, 100),
      "world_001",
      [player],
      100,
    ),
  ).toBe(false);
});
it("departed and unknown senders are rejected", () => {
  expect(
    new SoundEventGate().accept(
      createSoundEvent(player, "world_001", "HELP_SHOUT", 1, 100),
      "world_001",
      [],
      100,
    ),
  ).toBe(false);
});
it("missing shout recording is explicitly absent", () =>
  expect(SOUND_REGISTRY.HELP_SHOUT.asset).toBeNull());

it("client excludes its own player from remote audio/render input", async () => {
  const { MultiplayerClient } = await import("./client");
  const c = new MultiplayerClient();
  c.local = player;
  c.players = [player, { ...player, playerId: "b" }];
  const history = c as unknown as {
    history: { time: number; players: Player[] }[];
  };
  history.history = [{ time: 0, players: c.players }];
  expect(c.remote(200).map((p) => p.playerId)).toEqual(["b"]);
  c.disconnect();
  expect(c.remote()).toEqual([]);
});
it("connection owns monotonic movement and jump counters across renderer lifetimes", async () => {
  const { MultiplayerClient } = await import("./client");
  const c = new MultiplayerClient();
  const sent: { sequence: number; jumpSequence: number }[] = [];
  c.room = {
    send: (_name: string, p: { sequence: number; jumpSequence: number }) =>
      sent.push(p),
  } as unknown as NonNullable<typeof c.room>;
  c.status = "połączony";
  c.send(idleMotion(0, 0, 0));
  c.recordJump();
  c.send(idleMotion(1, 0, 0));
  expect(sent.map((p) => [p.sequence, p.jumpSequence])).toEqual([
    [1, 0],
    [2, 1],
  ]);
});
