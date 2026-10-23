import type { SharedWorld, WorldCommand, WorldReply } from "./sharedWorld";
import type { SaveV5 } from "../game/save/schema";
import { SoundEventGate } from "./soundEvents";
import type { PlayerSoundEvent } from "./protocol";
import type { CharacterAppearanceV1 } from "../character/appearance";
import { Client, type Room } from "@colyseus/sdk";
import {
  NET,
  PROTOCOL,
  type Appearances,
  type Motion,
  type Player,
  type Snapshot,
  type WorldConfig,
  type Welcome,
} from "./protocol";
import { HideSeekClientState } from "../hideseek/clientState";
import type { HideSeekConfig, HsEvent, HsNoticeCode, HsStateView } from "../hideseek/types";
import { fingerprintWorld, generateWorld } from "../game/world/registry";
import { CURRENT_GEN_VERSION } from "../game/world/registry";
const RESUME_KEY = "miasto.mp.resume";
const readResume = (): string | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(RESUME_KEY);
  } catch {
    return null;
  }
};
const writeResume = (token: string | null) => {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (token) sessionStorage.setItem(RESUME_KEY, token);
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    /* brak pamięci sesji: reconnect po przeładowaniu strony będzie zwykłym dołączeniem */
  }
};
export class MultiplayerClient {
  world: SharedWorld | null = null;
  /** Stan zabawy w chowanego (źródłem prawdy jest serwer; tu tylko ostatni widok i zdarzenia). */
  readonly hs = new HideSeekClientState(() => performance.now(), () => this.ping);
  /** Liczba graczy online w pokoju (serwer liczy wszystkich, także niewidocznych dla tego klienta). */
  online = 0;
  /** Token wznowienia tożsamości po zerwaniu połączenia (serwer wydaje go przy dołączeniu). */
  private resumeToken: string | null = readResume();
  private hsRequest = 0;
  private sentPresence: boolean | null = null;
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
  requestWorld(command: WorldCommand | { type: "world.restore" }, save: SaveV5): Promise<WorldReply | null> {
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
  /** Wygląd graczy po `playerId` (z serwera); brak wpisu = domyślny. */
  appearances: Appearances = {};
  private sentAppearance = "";
  private sentAppearanceAt = 0;
  /** Ostatnio wysłany (lub zgłoszony przez serwer po dołączeniu) stan lampy; po połączeniu serwer zaczyna od wyłączonej. */
  private sentLantern = false;
  private sentLanternAt = 0;
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
        fingerprint: fingerprintWorld(generateWorld(2030, CURRENT_GEN_VERSION)),
        ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}),
      });
      this.room = room;
      this.sentPresence = null;
      room.onMessage("hs.state", (view: HsStateView) => {
        if (this.room === room) this.hs.accept(view);
      });
      room.onMessage("hs.event", (event: HsEvent) => {
        if (this.room === room && event && typeof event === "object") this.hs.pushEvent(event);
      });
      room.onMessage("hs.notice", (n: { code?: HsNoticeCode }) => {
        if (this.room === room && n && typeof n.code === "string") this.hs.setNotice(n.code);
      });
      room.onMessage("hs.correct", (c: { x: number; y: number; z: number }) => {
        if (this.room === room && c && [c.x, c.y, c.z].every(Number.isFinite)) this.hs.setCorrection(c.x, c.y, c.z);
      });
      room.onMessage("world", (world: SharedWorld) => this.receiveWorld(world));
      room.onMessage("worldReply", (reply: WorldReply) => {
        this.pending.get(reply.requestId)?.(reply);
        this.receiveWorld(reply.world);
      });
      room.onMessage("appearances", (a: Appearances) => {
        if (a && typeof a === "object") this.appearances = a;
      });
      room.onMessage("snapshot", (s: Snapshot) => {
        this.worldElapsed = s.worldElapsed;
        this.serverOffset = s.serverTime - Date.now();
        this.players = s.players;
        this.online = typeof s.online === "number" ? s.online : s.players.length;
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
        this.appearances = {};
        this.sentAppearance = "";
        this.sentLantern = false;
        this.history = [];
        this.online = 0;
        this.hs.reset();
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
              w.config.generatorVersion !== CURRENT_GEN_VERSION ||
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
            if (typeof w.resumeToken === "string") {
              this.resumeToken = w.resumeToken;
              writeResume(w.resumeToken);
            }
            this.hs.reset();
            if (w.hs) this.hs.accept(w.hs);
            this.appearances = w.appearances ?? {};
            this.sentAppearance = "";
            this.sentLantern = w.player.lanternOn === true;
            this.sentLanternAt = 0;
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
  /** Czy własna lampa jest chwilowo wymuszona przez zabawę (serwer ustawia to na własnym rekordzie gracza). */
  localLanternForced(): boolean {
    const id = this.local?.playerId;
    return !!id && this.players.some((p) => p.playerId === id && p.lanternForced === true);
  }
  /** Zgłasza serwerowi, czy gracz jest w widoku lasu (tylko tacy dostają zaproszenia). Wołaj co klatkę: wysyła przy zmianie. */
  syncPresence(inForest: boolean) {
    if (this.status !== "połączony" || !this.room || this.sentPresence === inForest) return;
    this.sentPresence = inForest;
    this.room.send("hs.presence", { inForest });
  }
  private hsSend(type: string, payload?: unknown) {
    if (this.status === "połączony") this.room?.send(type, payload);
  }
  hsStart(seekMinutes: number, dev?: Partial<HideSeekConfig>) {
    this.hsSend("hs.start", { ...dev, seekMinutes });
  }
  hsCancel() {
    this.hsSend("hs.cancel");
  }
  hsRespond(accept: boolean) {
    this.hsSend("hs.respond", { accept, sessionId: this.hs.view?.sessionId });
  }
  hsHide() {
    this.hsSend("hs.hide");
  }
  hsFound() {
    // Pierwszy identyfikator z zegara (rośnie także po odświeżeniu strony); liczone dopiero przy użyciu, nie przy renderze.
    this.hsRequest = Math.max(this.hsRequest + 1, Date.now());
    this.hsSend("hs.found", { requestId: this.hsRequest });
  }
  hsWithdraw() {
    this.hsSend("hs.withdraw");
  }
  setSoundHandler(handler: ((event: PlayerSoundEvent) => void) | null) {
    this.onSound = handler;
  }
  setInterpolation(ms: number) {
    this.interpolationMs = Math.max(50, Math.min(250, ms));
  }
  /**
   * Wysyła własny wygląd serwerowi, gdy różni się od ostatnio wysłanego (po połączeniu i po każdej zmianie).
   * Można wołać co klatkę: zmiany są ograniczane czasowo, a ostatnia zawsze dojdzie.
   */
  syncAppearance(appearance: CharacterAppearanceV1, now = performance.now()) {
    if (this.status !== "połączony" || !this.room) return;
    const key = JSON.stringify(appearance);
    if (key === this.sentAppearance || now - this.sentAppearanceAt < 150) return;
    this.sentAppearance = key;
    this.sentAppearanceAt = now;
    this.room.send("appearance", appearance);
  }
  /**
   * Zgłasza serwerowi stan własnej lampy naftowej, gdy różni się od ostatnio wysłanego. Można wołać co klatkę: bez
   * zmiany nic nie wysyła, a po (ponownym) połączeniu stan lokalny sam trafia do serwera. Serwer przypisuje go do sesji nadawcy.
   */
  syncLantern(enabled: boolean, now = performance.now()) {
    if (this.status !== "połączony" || !this.room) return;
    if (enabled === this.sentLantern || now - this.sentLanternAt < 100) return;
    this.sentLantern = enabled;
    this.sentLanternAt = now;
    this.room.send("lantern", { enabled });
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
    this.appearances = {};
    this.sentAppearance = "";
    this.sentLantern = false;
    this.history = [];
    this.online = 0;
    this.hs.reset();
    this.sounds.clear();
    this.sequence = 0;
    this.jumpSequence = 0;
    this.status = "rozłączony";
  }
}
