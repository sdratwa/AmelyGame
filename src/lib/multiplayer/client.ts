import type { SharedWorld, WorldCommand, WorldReply } from "./sharedWorld";
import type { SaveV4 } from "../game/save/schema";
import { SoundEventGate } from "./soundEvents";
import type { PlayerSoundEvent } from "./protocol";
import { Client, type Room } from "@colyseus/sdk";
import {
  NET,
  PROTOCOL,
  type Motion,
  type Player,
  type Snapshot,
  type WorldConfig,
  type Welcome,
} from "./protocol";
import { fingerprintWorld, generateWorld } from "../game/world/registry";
export class MultiplayerClient {
  world: SharedWorld | null = null;
  private worldListeners = new Set<(world: SharedWorld) => void>();
  private requestId = 0;
  private pending = new Map<number, (reply: WorldReply | null) => void>();
  subscribeWorld(listener: (world: SharedWorld) => void) {
    this.worldListeners.add(listener);
    if (this.world) listener(this.world);
    return () => { this.worldListeners.delete(listener); };
  }
  private receiveWorld(world: SharedWorld) {
    if (this.world && world.revision < this.world.revision) return;
    this.world = world;
    for (const listener of this.worldListeners) listener(world);
  }
  requestWorld(command: WorldCommand | { type: "world.restore" }, save: SaveV4): Promise<WorldReply | null> {
    if (this.status !== "połączony" || !this.room) return Promise.resolve(null);
    const requestId = ++this.requestId;
    return new Promise<WorldReply | null>((resolve) => {
      const timeout = setTimeout(() => {
        // An ambiguous result must not allow further local mutations on this connection.
        this.disconnect();
      }, 8000);
      this.pending.set(requestId, (reply) => {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        resolve(reply);
      });
      this.room!.send("worldCommand", { requestId, command, save });
    }).catch(() => { this.disconnect(); return null; });
  }
  onSound: ((event: PlayerSoundEvent) => void) | null = null;
  private sounds = new SoundEventGate();
  room: Room | null = null;
  config: WorldConfig | null = null;
  local: Player | null = null;
  players: Player[] = [];
  status = "rozłączony";
  notice = "";
  ping = 0;
  worldElapsed: number | null = null;
  updates = 0;
  interpolationMs = NET.interpolationMs;
  private serverOffset = 0;
  private sequence = 0;
  private jumpSequence = 0;
  private history: { time: number; players: Player[] }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  async connect(endpoint: string) {
    this.disconnect();
    this.status = "łączenie";
    try {
      const room = await new Client(endpoint).joinById("world_001", {
        worldInstanceId: "world_001",
        protocol: PROTOCOL,
        fingerprint: fingerprintWorld(generateWorld(2030, 3)),
      });
      this.room = room;
      room.onMessage("world", (world: SharedWorld) => this.receiveWorld(world));
      room.onMessage("worldReply", (reply: WorldReply) => {
        this.pending.get(reply.requestId)?.(reply);
        this.receiveWorld(reply.world);
      });
      room.onMessage("snapshot", (s: Snapshot) => {
        this.worldElapsed = s.worldElapsed;
        this.serverOffset = s.serverTime - Date.now();
        this.players = s.players;
        this.updates++;
        this.history.push({ time: performance.now(), players: s.players });
        if (this.history.length > 30) this.history.shift();
      });
      room.onMessage("sound", (event: PlayerSoundEvent) => {
        if (
          this.config &&
          this.sounds.accept(
            event,
            this.config.worldInstanceId,
            this.players,
            Date.now() + this.serverOffset,
          )
        )
          this.onSound?.(event);
      });
      room.onMessage("notice", (s: string) => {
        this.notice = s;
      });
      room.onMessage("pong", (n: number) => {
        this.ping = Math.round(performance.now() - n);
      });
      room.onMessage("soundUnavailable", (s: string) => {
        this.notice = s;
      });
      room.onLeave(() => {
        if (this.room !== room) return;
        this.room = null;
        for (const done of this.pending.values()) done(null);
        this.sounds.clear();
        this.status = "rozłączony";
        this.players = [];
        this.history = [];
        if (this.timer) clearInterval(this.timer);
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error("Brak konfiguracji świata")),
          8000,
        );
        room.onMessage(
          "welcome",
          (w: Welcome) => {
            clearTimeout(timeout);
            if (
              !Number.isFinite(w.worldElapsed) || w.worldElapsed < 0 ||
              w.config.generatorVersion !== 3 ||
              fingerprintWorld(
                generateWorld(w.config.worldSeed, w.config.generatorVersion),
              ) !== w.config.fingerprint
            ) {
              reject(Error("Niezgodny generator świata"));
              return;
            }
            this.world = null;
            this.receiveWorld(w.world);
            this.worldElapsed = w.worldElapsed;
            this.config = w.config;
            this.local = w.player;
            this.status = "połączony";
            resolve();
          },
        );
        room.send("hello");
      });
      this.timer = setInterval(
        () => room.send("ping", performance.now()),
        2000,
      );
    } catch (e) {
      this.disconnect();
      this.status = "błąd połączenia";
      throw e;
    }
  }
  setSoundHandler(handler: ((event: PlayerSoundEvent) => void) | null) {
    this.onSound = handler;
  }
  setInterpolation(ms: number) {
    this.interpolationMs = Math.max(50, Math.min(250, ms));
  }
  recordJump() {
    this.jumpSequence++;
  }
  send(m: Omit<Motion, "sequence" | "jumpSequence">) {
    if (this.status === "połączony")
      this.room?.send("motion", {
        ...m,
        sequence: ++this.sequence,
        jumpSequence: this.jumpSequence,
      });
  }
  remote(now = performance.now()): Player[] {
    const target = now - this.interpolationMs;
    const h = this.history;
    if (!h.length) return [];
    let a = h[0],
      b = h[h.length - 1];
    for (let i = 1; i < h.length; i++) {
      if (h[i].time >= target) {
        a = h[i - 1];
        b = h[i];
        break;
      }
    }
    const t = Math.max(
      0,
      Math.min(1, (target - a.time) / Math.max(1, b.time - a.time)),
    );
    return b.players
      .filter(
        (p) =>
          p.playerId !== this.local?.playerId &&
          this.players.some((q) => q.playerId === p.playerId),
      )
      .map((p) => {
        const old = a.players.find((q) => q.playerId === p.playerId) ?? p;
        const yaw = Math.atan2(
          Math.sin(p.bodyYaw - old.bodyYaw),
          Math.cos(p.bodyYaw - old.bodyYaw),
        );
        return {
          ...p,
          x: old.x + (p.x - old.x) * t,
          y: old.y + (p.y - old.y) * t,
          z: old.z + (p.z - old.z) * t,
          bodyYaw: old.bodyYaw + yaw * t,
        };
      });
  }
  disconnect() {
    for (const done of this.pending.values()) done(null);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.room?.leave();
    this.room = null;
    this.players = [];
    this.history = [];
    this.sounds.clear();
    this.sequence = 0;
    this.jumpSequence = 0;
    this.status = "rozłączony";
  }
}
