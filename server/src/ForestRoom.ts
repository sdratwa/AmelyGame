import { createSoundEvent } from "../../src/lib/multiplayer/soundEvents";
import { Room, type Client } from "@colyseus/core";
import { randomUUID } from "node:crypto";
import { createInstance } from "../../src/lib/multiplayer/world";
import {
  NET,
  PROTOCOL,
  SOUND_REGISTRY,
  validMotion,
  type Player,
} from "../../src/lib/multiplayer/protocol";
export class ForestRoom extends Room {
  maxClients = NET.maxPlayers;
  autoDispose = false;
  private world = createInstance();
  private players = new Map<string, Player>();
  private soundSequence = 0;
  private readonly worldStartedAt = performance.now();
  private worldElapsed() {
    return (performance.now() - this.worldStartedAt) / 1000;
  }
  private slots = new Map<string, number>();
  private limits = new Map<
    string,
    { time: number; count: number; sound: number }
  >();
  onCreate(options: { worldInstanceId?: string }) {
    this.roomId = options.worldInstanceId ?? "world_001";
    if (options.worldInstanceId && options.worldInstanceId !== "world_001")
      this.world = createInstance(options.worldInstanceId);
    this.onMessage("motion", (client, data) => {
      const p = this.players.get(client.sessionId);
      if (
        !p ||
        !this.allow(client) ||
        !validMotion(data) ||
        data.sequence <= p.sequence ||
        data.jumpSequence < p.jumpSequence
      )
        return;
      Object.assign(p, data);
    });
    this.onMessage(
      "hello",
      (client) =>
        this.allow(client) &&
        client.send("welcome", {
          worldElapsed: this.worldElapsed(),
          config: this.world.config,
          player: this.players.get(client.sessionId),
        }),
    );
    this.onMessage("ping", (client, value) => {
      if (this.allow(client) && typeof value === "number")
        client.send("pong", value);
    });
    this.onMessage("sound", (client, data) => {
      const p = this.players.get(client.sessionId),
        limit = this.limits.get(client.sessionId);
      if (
        !p ||
        !limit ||
        !this.allow(client) ||
        !data ||
        typeof data !== "object" ||
        "sessionId" in data ||
        "playerId" in data ||
        data.soundId !== "HELP_SHOUT" ||
        Date.now() - limit.sound < 2000
      )
        return;
      limit.sound = Date.now();
      if (!SOUND_REGISTRY.HELP_SHOUT.asset) {
        client.send("soundUnavailable", "Brak pliku audio");
        return;
      }
      this.broadcast(
        "sound",
        createSoundEvent(
          p,
          this.world.config.worldInstanceId,
          data.soundId,
          ++this.soundSequence,
          Date.now(),
        ),
      );
    });
    this.setSimulationInterval(
      () =>
        this.broadcast("snapshot", {
          serverTime: Date.now(),
          worldElapsed: this.worldElapsed(),
          players: [...this.players.values()],
        }),
      1000 / NET.hz,
    );
  }
  private allow(c: Client) {
    const l = this.limits.get(c.sessionId);
    if (!l) return false;
    const now = Date.now();
    if (now - l.time >= 1000) {
      l.time = now;
      l.count = 0;
    }
    return ++l.count <= 35;
  }
  onJoin(client: Client, options: { protocol?: number; fingerprint?: string }) {
    if (
      options.protocol !== PROTOCOL ||
      options.fingerprint !== this.world.config.fingerprint
    )
      throw Error("Niezgodna wersja świata lub protokołu");
    const slot = Array.from({ length: 8 }, (_, i) => i).find(
      (i) => ![...this.slots.values()].includes(i),
    );
    if (slot === undefined) throw Error("Pokój pełny");
    this.slots.set(client.sessionId, slot);
    this.limits.set(client.sessionId, { time: Date.now(), count: 0, sound: 0 });
    const p: Player = {
      ...this.world.spawns[slot],
      playerId: randomUUID(),
      sessionId: client.sessionId,
      name: `Odkrywca ${slot + 1}`,
    };
    this.players.set(client.sessionId, p);
    this.broadcast("notice", `${p.name} dołącza do lasu.`);
  }
  onLeave(client: Client) {
    const p = this.players.get(client.sessionId);
    this.players.delete(client.sessionId);
    this.slots.delete(client.sessionId);
    this.limits.delete(client.sessionId);
    this.broadcast("snapshot", {
      serverTime: Date.now(),
      worldElapsed: this.worldElapsed(),
      players: [...this.players.values()],
    });
    if (p) this.broadcast("notice", `${p.name} opuszcza las.`);
  }
}
