import { createForest } from "../game/world/generators/v2/forest";
import { PRO_OPTIONS } from "../game/world/generators/v2/pro";
import { describe, it, expect } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import { createServer } from "../../../server/src/server";
import { createInstance } from "./world";
import {
  SOUND_REGISTRY,
  idleMotion,
  PROTOCOL,
  validMotion,
  type Appearances,
  type Snapshot,
  type Welcome,
} from "./protocol";
import { PlayerStepEmitter, stepGain } from "../audio/playerSpatial";
import { DEFAULT_APPEARANCE, withAppearance } from "../character/appearance";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
describe("M1a", () => {
  it("fresh server and client generation produce identical gameplay geometry", () => {
    const server = createForest(2030, { pro: PRO_OPTIONS, layers: "gameplay" });
    const client = createForest(2030, { pro: PRO_OPTIONS, layers: "all" });
    expect(client.plan).toEqual(server.plan);
    expect(client.allSectors().flatMap((s) => s.colliders)).toEqual(
      server.allSectors().flatMap((s) => s.colliders),
    );
    for (let x = -140; x <= 140; x += 20)
      for (let z = -140; z <= 140; z += 20)
        expect(client.terrain.height(x, z)).toBe(server.terrain.height(x, z));
  });
  it("isolates collision worlds and deterministically reproduces geometry and spawns", () => {
    const a = createInstance("a"),
      b = createInstance("b");
    expect(a.resultDigest).toBe(b.resultDigest);
    expect(a.walk).not.toBe(b.walk);
    const first = a.walk.index.all()[0];
    expect(first).not.toBe(b.walk.index.get(first.id));
    expect(first.collider).not.toBe(b.walk.index.get(first.id)?.collider);
    expect(a.spawns).toEqual(b.spawns);
    const start = a.spawns[0];
    a.walk.addObject({
      id: "instance-only",
      kind: "rock",
      x: start.x,
      y: start.y,
      z: start.z,
      radius: 2,
      collider: { shape: "circle", r: 2 },
    });
    expect(a.walk.checkPoint(start.x, start.z)?.by).toBe("instance-only");
    expect(b.walk.checkPoint(start.x, start.z)).toBeNull();
    a.walk.removeObject("instance-only");
    for (const p of a.spawns) expect(a.walk.checkPoint(p.x, p.z)).toBeNull();
    const distance = Math.hypot(
      a.spawns[0].x - a.spawns[1].x,
      a.spawns[0].z - a.spawns[1].z,
    );
    expect(distance).toBeGreaterThanOrEqual(50);
    expect(distance).toBeLessThanOrEqual(100);
  }, 30000);
  it("validates motion and rejects impersonation and NaN", () => {
    expect(validMotion(idleMotion(0, 0, 0))).toBe(true);
    expect(validMotion({ ...idleMotion(0, 0, 0), x: NaN })).toBe(false);
    expect(validMotion({ ...idleMotion(0, 0, 0), name: "spoof" })).toBe(false);
    expect(validMotion({ ...idleMotion(0, 0, 0), playerId: "other" })).toBe(
      false,
    );
  });
  it("footsteps stop at idle/in air and attenuation fades smoothly", () => {
    const e = new PlayerStepEmitter();
    let steps = 0;
    for (let i = 0; i < 100; i++) {
      if (
        e.update(
          {
            ...idleMotion(i * 0.2, 0, 0),
            speed: 4,
            playerId: "a",
            sessionId: "a",
            name: "A",
          },
          0.05,
        )
      )
        steps++;
    }
    expect(steps).toBeGreaterThan(5);
    for (let i = 0; i < 20; i++)
      expect(
        e.update(
          { ...idleMotion(20, 0, 0), playerId: "a", sessionId: "a", name: "A" },
          0.05,
        ),
      ).toBe(false);
    expect(stepGain(5, 22)).toBeGreaterThan(stepGain(15, 22));
    expect(stepGain(22, 22)).toBe(0);
  });
  it("two independent clients share a room, movement, jumps and disconnect cleanup", async () => {
    const server = createServer();
    await server.listen(0, "127.0.0.1");
    const address = server.transport.server!.address();
    if (!address || typeof address === "string") throw Error("port");
    const endpoint = `ws://127.0.0.1:${address.port}`;
    const config = createInstance().config;
    const options = {
      worldInstanceId: "world_001",
      protocol: PROTOCOL,
      fingerprint: config.fingerprint,
    };
    await matchMaker.createRoom("forest", { worldInstanceId: "world_001" });
    const a = await new Client(endpoint).joinById("world_001", options);
    const b = await new Client(endpoint).joinById("world_001", options);
    try {
      let snapshot: Snapshot = { players: [], serverTime: 0, worldElapsed: 0 };
      a.onMessage("notice", () => {});
      b.onMessage("notice", () => {});
      a.onMessage("snapshot", () => {});
      b.onMessage("snapshot", (s: Snapshot) => {
        snapshot = s;
      });
      const welcome = (room: typeof a) =>
        new Promise<Welcome>((resolve) => {
          room.onMessage("welcome", resolve);
          room.send("hello");
        });
      const [wa, wb] = await Promise.all([welcome(a), welcome(b)]);
      expect(a.roomId).toBe(b.roomId);
      expect(wa.config).toEqual(wb.config);
      expect(wa.worldElapsed).toBeGreaterThanOrEqual(0);
      expect(Math.abs(wa.worldElapsed - wb.worldElapsed)).toBeLessThan(0.2);
      await delay(120);
      const later = await welcome(a);
      expect(later.worldElapsed).toBeGreaterThan(wa.worldElapsed);
      expect(snapshot.worldElapsed).toBeGreaterThan(wb.worldElapsed);
      expect(wa.player.playerId).not.toBe(wb.player.playerId);
      expect(wa.player.x).not.toBe(wb.player.x);
      let shared: Appearances = {};
      b.onMessage("appearances", (m: Appearances) => {
        shared = m;
      });
      a.onMessage("appearances", () => {});
      const red = withAppearance(DEFAULT_APPEARANCE, { topColor: "#ff0000" });
      a.send("appearance", { ...red, bottomColor: "nie-kolor", topId: "top.nieznany" });
      await delay(120);
      // Serwer przypisuje wygląd nadawcy i normalizuje dane; drugi gracz nie dostaje własnego wpisu jako cudzego.
      expect(Object.keys(shared)).toEqual([wa.player.playerId]);
      expect(shared[wa.player.playerId]).toEqual({ ...red, bottomColor: DEFAULT_APPEARANCE.bottomColor, topId: null });
      expect(shared[wb.player.playerId]).toBeUndefined();
      a.send("appearance", "śmieci");
      await delay(60);
      expect(Object.keys(shared)).toEqual([wa.player.playerId]);
      a.send("motion", {
        ...idleMotion(0, 1, 0),
        sequence: 1,
        bodyYaw: 1,
        speed: 3,
        vx: 3,
        animation: "jump",
        jumpSequence: 1,
        grounded: false,
      });
      await delay(150);
      expect(
        snapshot.players.find((p) => p.playerId === wa.player.playerId),
      ).toMatchObject({ x: 0, bodyYaw: 1, jumpSequence: 1, animation: "jump" });
      a.send("motion", {
        ...idleMotion(99, 0, 0),
        sequence: 2,
        playerId: wb.player.playerId,
      });
      await delay(100);
      expect(
        snapshot.players.find((p) => p.playerId === wb.player.playerId)?.x,
      ).toBe(wb.player.x);
      let unavailable = "";
      a.onMessage("soundUnavailable", (s: string) => {
        unavailable = s;
      });
      a.send("sound", { soundId: "HELP_SHOUT", playerId: wb.player.playerId });
      await delay(80);
      expect(unavailable).toBe("");
      a.send("sound", { soundId: "HELP_SHOUT" });
      await delay(80);
      expect(unavailable).toBe("Brak pliku audio");
      // Registry binding only, no audio generated/downloaded: exercise future event transport.
      await matchMaker.createRoom("forest", { worldInstanceId: "isolated" });
      const other = await new Client(endpoint).joinById("isolated", options);
      other.onMessage("snapshot", () => {});
      other.onMessage("notice", () => {});
      let leaked = 0,
        received = 0;
      other.onMessage("sound", () => {
        leaked++;
      });
      b.onMessage("sound", (event: { playerId: string }) => {
        expect(event.playerId).toBe(wb.player.playerId);
        received++;
      });
      a.onMessage("sound", () => {});
      SOUND_REGISTRY.HELP_SHOUT.asset = "test-only-unloaded-recording";
      try {
        b.send("sound", {
          soundId: "HELP_SHOUT",
          playerId: wa.player.playerId,
        });
        await delay(80);
        expect(received).toBe(0);
        b.send("sound", { soundId: "HELP_SHOUT" });
        b.send("sound", { soundId: "HELP_SHOUT" });
        await delay(150);
        expect(received).toBe(1);
        expect(leaked).toBe(0);
      } finally {
        SOUND_REGISTRY.HELP_SHOUT.asset = null;
        await other.leave();
      }
      const extras = [];
      for (let i = 0; i < 6; i++) {
        const room = await new Client(endpoint).joinById("world_001", options);
        room.onMessage("snapshot", () => {});
        room.onMessage("notice", () => {});
        extras.push(room);
      }
      await expect(
        new Client(endpoint).joinById("world_001", options),
      ).rejects.toThrow();
      for (const room of extras) await room.leave();
      await a.leave();
      await delay(150);
      expect(snapshot.players).toHaveLength(1);
      const rejoined = await new Client(endpoint).joinById(
        "world_001",
        options,
      );
      rejoined.onMessage("snapshot", () => {});
      rejoined.onMessage("notice", () => {});
      const wr = await welcome(rejoined);
      expect(wr.player.playerId).not.toBe(wa.player.playerId);
      expect(wr.worldElapsed).toBeGreaterThan(later.worldElapsed);
      expect(Math.abs(wr.worldElapsed - snapshot.worldElapsed)).toBeLessThan(0.3);
      await delay(100);
      expect(snapshot.players).toHaveLength(2);
      await rejoined.leave();
    } finally {
      if (a.connection.isOpen) await a.leave();
      if (b.connection.isOpen) await b.leave();
      await server.gracefullyShutdown(false);
    }
  }, 30000);
});
