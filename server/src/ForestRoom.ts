import { WorldStore } from "./worldStore";
import { emptySharedWorld, resolveWorldCommand } from "../../src/lib/multiplayer/sharedWorld";
import { createSoundEvent } from "../../src/lib/multiplayer/soundEvents";
import { Room, type Client } from "@colyseus/core";
import { randomUUID } from "node:crypto";
import { createInstance } from "../../src/lib/multiplayer/world";
import { playersOverlap } from "../../src/lib/multiplayer/playerCollision";
import { checkMotion, initialTrack, type MotionTrack } from "../../src/lib/multiplayer/motionPhysics";
import { forestBridgeOf } from "../../src/lib/game/world/lookup";
import { HideSeekHost, type HostOptions } from "./HideSeekHost";
import { normalizeAppearance, type CharacterAppearanceV1 } from "../../src/lib/character/appearance";
import {
  NET,
  PROTOCOL,
  SOUND_REGISTRY,
  validLantern,
  validMotion,
  type Player,
} from "../../src/lib/multiplayer/protocol";
/** Kod zamknięcia „świadome wyjście” (Colyseus `CloseCode.CONSENTED`): rezygnacja, nie zerwane połączenie. */
const CONSENTED = 4000;
export class ForestRoom extends Room {
  /** Hak testowy: zegar i losowość zabawy w chowanego (domyślnie prawdziwe). Czytany przy tworzeniu pokoju. */
  static hideSeekOptions: HostOptions = {};
  maxClients = NET.maxPlayers;
  autoDispose = false;
  private world = createInstance();
  private store?: WorldStore;
  private sharedWorld = emptySharedWorld();
  private players = new Map<string, Player>();
  /** Ostatnia PRZYJĘTA próbka ruchu sesji (walidacja pionowa i skał, `motionPhysics`). */
  private tracks = new Map<string, MotionTrack>();
  /** Zabawa w chowanego: wszystkie reguły są w `HideSeekHost` / `lib/hideseek`, pokój tylko go woła. */
  hs!: HideSeekHost;
  private appearances = new Map<string, CharacterAppearanceV1>();
  private appearanceMap() {
    const map: Record<string, CharacterAppearanceV1> = {};
    for (const [sessionId, appearance] of this.appearances) {
      const p = this.players.get(sessionId);
      if (p) map[p.playerId] = appearance;
    }
    return map;
  }
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
  onCreate(options: { worldInstanceId?: string; worldSavePath?: string; migrateWorldV3?: boolean; migrateWorldV4?: boolean }) {
    this.roomId = options.worldInstanceId ?? "world_001";
    if (options.worldInstanceId && options.worldInstanceId !== "world_001")
      this.world = createInstance(options.worldInstanceId);
    if (options.worldSavePath) {
      this.store = new WorldStore(options.worldSavePath, this.world.config, options.migrateWorldV3 === true, options.migrateWorldV4 === true);
      this.sharedWorld = this.store.load();
      for (const id of this.sharedWorld.harvested) this.world.walk.removeObject(id);
    }
    this.hs = new HideSeekHost(
      {
        players: this.players,
        tracks: this.tracks,
        walk: this.world.walk,
        floorAt: (x, z) => this.floorAt(x, z),
        send: (sessionId, type, payload) => this.clients.find((c) => c.sessionId === sessionId)?.send(type, payload),
        removePlayer: (sessionId) => this.removePlayer(sessionId),
        rekey: (from, to) => this.rekey(from, to),
      },
      { allowDev: process.env.MIASTO_HIDESEEK_DEV === "1", ...ForestRoom.hideSeekOptions },
    );
    for (const type of ["hs.start", "hs.cancel", "hs.respond", "hs.presence", "hs.hide", "hs.found", "hs.withdraw"] as const) {
      this.onMessage(type, (client, data) => {
        if (!this.players.has(client.sessionId) || !this.allow(client)) return;
        if (type === "hs.start") this.hs.start(client.sessionId, data);
        else if (type === "hs.cancel") this.hs.cancel(client.sessionId);
        else if (type === "hs.respond") this.hs.respond(client.sessionId, data);
        else if (type === "hs.presence") this.hs.presence(client.sessionId, data);
        else if (type === "hs.hide") this.hs.hide(client.sessionId);
        else if (type === "hs.found") this.hs.found(client.sessionId, data);
        else this.hs.withdraw(client.sessionId);
      });
    }
    this.onMessage("worldCommand", (client, data) => {
      if (!this.players.has(client.sessionId) || !data || !Number.isSafeInteger(data.requestId)) return;
      const outcome = this.allow(client) && this.hs.mayRunWorldCommand(client.sessionId, data.command)
        ? resolveWorldCommand(this.sharedWorld, this.world.config, data.command, data.save)
        : { accepted: false, world: this.sharedWorld };
      if (outcome.accepted) {
        try { this.store?.save(outcome.world); }
        catch {
          client.send("worldReply", { requestId: data.requestId, accepted: false, world: this.sharedWorld });
          client.send("notice", "Nie udało się zapisać wspólnego świata. Spróbuj ponownie.");
          return;
        }
      }
      this.sharedWorld = outcome.world;
      if (outcome.accepted) {
        for (const id of this.sharedWorld.harvested) this.world.walk.removeObject(id);
        this.hs.worldChanged(this.sharedWorld.harvested);
      }
      client.send("worldReply", { requestId: data.requestId, ...outcome });
      if (outcome.accepted) this.broadcast("world", this.sharedWorld);
    });
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
      // Zabawa w chowanego: bramka ruchu uczestnika (zamrożony szukający / zablokowany ukrywający się) i izolacja kolizji.
      const guard = this.hs.motionGuard(client.sessionId, p, data);
      if (guard.reject) {
        if (guard.correct) this.hs.correct(client.sessionId, guard.correct);
        return;
      }
      const sample = guard.data;
      if ([...this.players.values()].some((other) => other !== p && this.hs.collides(client.sessionId, other.sessionId) && playersOverlap(sample, other))) return;
      // Fizyka skał: stan niemożliwy do osiągnięcia skokiem (np. "stanie" na wysokiej skale) jest ignorowany. Kroki ciągłe
      // oceniane są względem ostatniej przyjętej próbki; serwer nie koryguje klienta (M1a: klient autorytatywny dla ruchu).
      const now = performance.now() / 1000;
      const previous = this.tracks.get(client.sessionId) ?? null;
      const verdict = checkMotion({ walk: this.world.walk, deckHeightAt: this.sharedWorld.bridgeBuilt ? this.deckHeightAt() : null }, previous, sample, now, { strict: guard.strict });
      if (!verdict.ok) {
        if (verdict.reason === "teleport" && previous) this.hs.correct(client.sessionId, { x: previous.x, y: previous.y, z: previous.z });
        return;
      }
      this.tracks.set(client.sessionId, verdict.track);
      this.hs.noteStable(client.sessionId, verdict.track);
      Object.assign(p, sample);
    });
    // Lampa naftowa: stan zmienia wyłącznie właściciel sesji. Treść wiadomości to tylko flaga (żadnego playerId, żadnych
    // parametrów światła); do pozostałych dociera w najbliższej migawce, razem z pozycją.
    this.onMessage("lantern", (client, data) => {
      const p = this.players.get(client.sessionId);
      if (!p || !this.allow(client) || !validLantern(data)) return;
      p.lanternOn = data.enabled;
    });
    this.onMessage(
      "hello",
      (client) =>
        this.allow(client) &&
        client.send("welcome", {
          worldElapsed: this.worldElapsed(),
          config: this.world.config,
          world: this.sharedWorld,
          player: this.players.get(client.sessionId),
          appearances: this.appearanceMap(),
          resumeToken: this.hs.tokenOf(client.sessionId) ?? undefined,
          hs: this.hs.viewFor(client.sessionId),
        }),
    );
    this.onMessage("appearance", (client, data) => {
      if (!this.players.has(client.sessionId) || !this.allow(client) || !data || typeof data !== "object") return;
      // Serwer nie ufa klientowi: wygląd jest normalizowany (znane elementy rejestru, poprawne kolory), a przypisany do sesji nadawcy.
      this.appearances.set(client.sessionId, normalizeAppearance(data));
      this.broadcast("appearances", this.appearanceMap());
    });
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
      const event = createSoundEvent(
        p,
        this.world.config.worldInstanceId,
        data.soundId,
        ++this.soundSequence,
        Date.now(),
      );
      // Dźwięk słyszą tylko ci, którzy widzą nadawcę (izolacja uczestników zabawy; poza zabawą: wszyscy jak dotąd).
      for (const listener of this.clients) if (this.hs.canHear(listener.sessionId, client.sessionId)) listener.send("sound", event);
    });
    this.setSimulationInterval(() => {
      this.hs.tick();
      this.broadcastSnapshot();
    }, 1000 / NET.hz);
  }
  /** Migawka per odbiorca: w zabawie każdy dostaje tylko graczy, których wolno mu widzieć. */
  private broadcastSnapshot() {
    const base = { serverTime: Date.now(), worldElapsed: this.worldElapsed(), online: this.hs.online() };
    for (const c of this.clients) c.send("snapshot", { ...base, players: this.hs.snapshotFor(c.sessionId) });
  }
  private floorAt(x: number, z: number) {
    const terrain = this.world.walk.terrain.height(x, z);
    const deck = this.sharedWorld.bridgeBuilt ? this.deckHeightAt()(x, z) : null;
    return deck != null ? Math.max(terrain, deck) : terrain;
  }
  private removePlayer(sessionId: string) {
    const p = this.players.get(sessionId);
    this.players.delete(sessionId);
    this.tracks.delete(sessionId);
    this.appearances.delete(sessionId);
    this.slots.delete(sessionId);
    this.limits.delete(sessionId);
    this.broadcastSnapshot();
    if (p) this.broadcast("notice", `${p.name} opuszcza las.`);
  }
  /** Reconnect: stan gracza (rekord, ruch, wygląd, miejsce startowe) przechodzi na nowe połączenie. */
  private rekey(from: string, to: string) {
    const p = this.players.get(from);
    if (!p) return;
    this.players.delete(from);
    p.sessionId = to;
    this.players.set(to, p);
    for (const map of [this.tracks, this.appearances, this.slots] as Map<string, unknown>[]) {
      if (map.has(from)) {
        map.set(to, map.get(from));
        map.delete(from);
      }
    }
    this.limits.delete(from);
    this.hs.rekeyed(from, to);
  }
  private deckHeightAt() {
    const bridge = forestBridgeOf({ seed: this.world.config.worldSeed, genVersion: this.world.config.generatorVersion });
    return (x: number, z: number) => bridge.deckHeightAt(x, z);
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
  onJoin(client: Client, options: { protocol?: number; fingerprint?: string; resumeToken?: string }) {
    if (
      options.protocol !== PROTOCOL ||
      options.fingerprint !== this.world.config.fingerprint
    )
      throw Error("Niezgodna wersja świata lub protokołu");
    const { previous } = this.hs.claim(client.sessionId, options.resumeToken);
    if (previous && this.players.has(previous)) {
      // Wznowienie po zerwaniu: ten sam gracz, to samo miejsce w świecie, bez ponownego „dołącza do lasu”.
      this.rekey(previous, client.sessionId);
      this.limits.set(client.sessionId, { time: Date.now(), count: 0, sound: 0 });
      this.tracks.set(client.sessionId, { ...(this.tracks.get(client.sessionId) as MotionTrack), at: performance.now() / 1000 });
      return;
    }
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
      lanternOn: false,
    };
    this.players.set(client.sessionId, p);
    this.tracks.set(client.sessionId, initialTrack(p.x, p.y, p.z, performance.now() / 1000));
    this.broadcast("notice", `${p.name} dołącza do lasu.`);
  }
  onLeave(client: Client, code?: number) {
    // Połączenie zastąpione nowym (reconnect z tokenem): rekord gracza należy już do nowej sesji.
    if (!this.players.has(client.sessionId)) {
      this.limits.delete(client.sessionId);
      return;
    }
    // Uczestnik aktywnej zabawy po zerwaniu połączenia zostaje jako duch na krótki okres na powrót.
    if (this.hs.onLeave(client.sessionId, code === CONSENTED)) {
      this.limits.delete(client.sessionId);
      return;
    }
    this.removePlayer(client.sessionId);
  }
}
