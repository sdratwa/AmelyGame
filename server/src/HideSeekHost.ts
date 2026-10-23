import { randomUUID } from "node:crypto";
import type { WalkWorld } from "../../src/lib/game/world/walk";
import { resolveConfig } from "../../src/lib/hideseek/config";
import { gateAcceptsMotion } from "../../src/lib/hideseek/gate";
import { HideSeekSession } from "../../src/lib/hideseek/session";
import { miniOfRole, type HsEvent, type HsNoticeCode, type HsSpot, type HsStateView } from "../../src/lib/hideseek/types";
import { bodiesCollide } from "../../src/lib/hideseek/visibility";
import type { Rng } from "../../src/lib/hideseek/areas";
import type { MotionTrack } from "../../src/lib/multiplayer/motionPhysics";
import type { Motion, Player } from "../../src/lib/multiplayer/protocol";

/** Co host wie o pokoju; ForestRoom implementuje ten interfejs, testy mogą podstawić atrapę. */
export type HostContext = {
  players: Map<string, Player>;
  tracks: Map<string, MotionTrack>;
  walk: WalkWorld;
  /** Wysokość podłoża (teren lub pokład mostu) w (x, z). */
  floorAt(x: number, z: number): number;
  send(sessionId: string, type: string, payload: unknown): void;
  /** Usuwa rekord gracza bez rozłączania klienta (duch po upływie okresu na reconnect). */
  removePlayer(sessionId: string): void;
  /** Przenosi stan gracza na nową sesję połączenia (reconnect z `resumeToken`). */
  rekey(from: string, to: string): void;
};

export type HostOptions = {
  /** Zegar w ms (domyślnie `Date.now`); testy podają zegar sztuczny. */
  now?: () => number;
  /** Zegar ruchu w sekundach - ten sam, którego pokój używa dla `MotionTrack.at`. */
  perf?: () => number;
  rng?: Rng;
  /** Tryb deweloperski: serwer przyjmie parametry rundy z Diagnostyki (inaczej tylko `seekMinutes`). */
  allowDev?: boolean;
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Jak długo po końcu zabawy serwer trzyma wynik dla spóźnionych (reconnect). */
  lingerMs?: number;
};

export type MotionGuard = { reject: false; strict: boolean; data: Motion } | { reject: true; correct?: { x: number; y: number; z: number } };

const TOKEN_RE = /^[A-Za-z0-9-]{16,64}$/;
/** Najstarsza akceptowana próbka ruchu (s) przy zatwierdzaniu kryjówki i „ZNALAZŁEM”: odrzuca pozycje sprzed lagu. */
const MAX_SAMPLE_AGE = 1.5;
const CORRECT_INTERVAL_MS = 250;
const FOREST_BOUNDS = { minX: -150, minZ: -150, maxX: 150, maxZ: 150 };

/**
 * Most między `ForestRoom` a czystą maszyną stanów `HideSeekSession`: tożsamość uczestnika (`resumeToken` zamiast
 * `sessionId`, bo reconnect zmienia sesję połączenia), obsługa wiadomości `hs.*`, filtr migawek dla każdego odbiorcy,
 * kolizje, bramka ruchu i duchy rozłączonych graczy. Sama nie podejmuje decyzji o zasadach gry - te są w `session.ts`.
 */
export class HideSeekHost {
  session: HideSeekSession | null = null;
  private readonly now: () => number;
  private readonly perf: () => number;
  private readonly rng: Rng;
  private readonly allowDev: boolean;
  private readonly bounds: NonNullable<HostOptions["bounds"]>;
  private readonly lingerMs: number;
  private readonly tokenBySession = new Map<string, string>();
  private readonly sessionByToken = new Map<string, string>();
  private readonly inForest = new Set<string>();
  private readonly ghosts = new Map<string, { sessionId: string }>();
  private readonly stable = new Map<string, HsSpot>();
  private readonly sent = new Map<string, string>();
  private readonly lastCorrect = new Map<string, number>();
  private forced = new Set<string>();

  constructor(private readonly ctx: HostContext, options: HostOptions = {}) {
    this.now = options.now ?? Date.now;
    this.perf = options.perf ?? (() => performance.now() / 1000);
    this.rng = options.rng ?? Math.random;
    this.allowDev = options.allowDev === true;
    this.bounds = options.bounds ?? FOREST_BOUNDS;
    this.lingerMs = options.lingerMs ?? 120_000;
  }

  // ---------- tożsamość i obecność ----------

  /** Przydziela token połączeniu; wznawia tożsamość tylko dla tokenu, który serwer sam wydał i który wciąż jest znany. */
  claim(sessionId: string, requested: unknown): { token: string; previous: string | null } {
    if (typeof requested === "string" && TOKEN_RE.test(requested)) {
      const previous = this.sessionByToken.get(requested);
      if (previous && previous !== sessionId) {
        this.tokenBySession.delete(previous);
        this.inForest.delete(previous);
        this.sent.delete(previous);
        this.tokenBySession.set(sessionId, requested);
        this.sessionByToken.set(requested, sessionId);
        this.ghosts.delete(requested);
        this.sent.delete(sessionId);
        this.session?.reconnect(requested);
        return { token: requested, previous };
      }
    }
    const token = randomUUID();
    this.tokenBySession.set(sessionId, token);
    this.sessionByToken.set(token, sessionId);
    return { token, previous: null };
  }

  tokenOf(sessionId: string): string | null {
    return this.tokenBySession.get(sessionId) ?? null;
  }

  /** Liczba graczy z żywym połączeniem (duchy w okresie na reconnect nie są „online”). */
  online(): number {
    return this.ctx.players.size - this.ghosts.size;
  }

  /** Obecność klienta w widoku lasu: tylko tacy gracze dostają zaproszenia i mogą je zainicjować. */
  presence(sessionId: string, data: unknown): void {
    if (!data || typeof data !== "object" || typeof (data as { inForest?: unknown }).inForest !== "boolean") return;
    const inForest = (data as { inForest: boolean }).inForest;
    if (inForest) this.inForest.add(sessionId);
    else {
      this.inForest.delete(sessionId);
      const token = this.tokenOf(sessionId);
      // Wyjście z lasu w trakcie zabawy = rezygnacja (klient blokuje to wcześniej, serwer nie polega na tej blokadzie).
      if (token && this.session && !this.session.ended && this.session.has(token)) {
        this.session.withdraw(token);
        this.flush();
      }
    }
  }

  /**
   * Zamknięcie połączenia. Zwraca true, gdy rekord gracza ma zostać w pokoju jako duch (uczestnik aktywnej zabawy
   * w okresie na reconnect); false = pokój usuwa gracza od razu.
   */
  onLeave(sessionId: string, consented: boolean): boolean {
    const token = this.tokenBySession.get(sessionId);
    if (!token) return false;
    const s = this.session;
    this.inForest.delete(sessionId);
    this.sent.delete(sessionId);
    if (s && !s.ended && s.has(token)) {
      if (!consented && s.isParticipant(token)) {
        s.disconnect(token);
        this.ghosts.set(token, { sessionId });
        this.flush();
        return true;
      }
      s.withdraw(token);
      this.flush();
    }
    this.forget(sessionId);
    return false;
  }

  private forget(sessionId: string) {
    const token = this.tokenBySession.get(sessionId);
    this.tokenBySession.delete(sessionId);
    if (token && this.sessionByToken.get(token) === sessionId) this.sessionByToken.delete(token);
    if (token) this.ghosts.delete(token);
    this.inForest.delete(sessionId);
    this.stable.delete(sessionId);
    this.sent.delete(sessionId);
    this.lastCorrect.delete(sessionId);
  }

  /** Po przeniesieniu stanu z poprzedniego połączenia: kotwica stabilnej pozycji idzie za graczem. */
  rekeyed(from: string, to: string) {
    const spot = this.stable.get(from);
    this.stable.delete(from);
    if (spot) this.stable.set(to, spot);
  }

  // ---------- wiadomości klienta ----------

  private notice(sessionId: string, code: HsNoticeCode) {
    this.ctx.send(sessionId, "hs.notice", { code });
  }

  start(sessionId: string, data: unknown): void {
    const token = this.tokenOf(sessionId);
    const me = this.ctx.players.get(sessionId);
    if (!token || !me) return;
    if (!this.inForest.has(sessionId)) return this.notice(sessionId, "NOT_IN_FOREST");
    if (this.session && !this.session.ended) return this.notice(sessionId, "SESSION_RUNNING");
    const eligible: { key: string; name: string }[] = [];
    for (const [sid, key] of this.tokenBySession) {
      const p = this.ctx.players.get(sid);
      if (sid === sessionId || !p || !this.inForest.has(sid) || this.ghosts.has(key)) continue;
      eligible.push({ key, name: p.name });
    }
    if (!eligible.length) return this.notice(sessionId, "NO_PLAYERS");
    this.session = new HideSeekSession({
      id: randomUUID(),
      now: this.now,
      rng: this.rng,
      config: resolveConfig(data, this.allowDev),
      host: { key: token, name: me.name },
      eligible,
      bounds: this.bounds,
      positionOf: (key) => this.positionOf(key),
      autoSpot: (key) => this.autoSpot(key),
    });
    this.sent.clear();
    this.forced = new Set();
    this.flush();
  }

  cancel(sessionId: string): void {
    const token = this.tokenOf(sessionId);
    if (token && this.session?.cancelByHost(token)) this.flush();
  }

  respond(sessionId: string, data: unknown): void {
    const token = this.tokenOf(sessionId);
    const s = this.session;
    if (!token || !s || !data || typeof data !== "object") return;
    const { accept, sessionId: target } = data as { accept?: unknown; sessionId?: unknown };
    if (typeof accept !== "boolean" || (target !== undefined && target !== s.id)) return;
    if (s.respond(token, accept)) this.flush();
  }

  withdraw(sessionId: string): void {
    const token = this.tokenOf(sessionId);
    if (token && this.session?.withdraw(token)) this.flush();
  }

  /** „TO MOJA KRYJÓWKA!”: serwer sprawdza fazę, rolę, stabilne podłoże i legalność pozycji; pozycję bierze ze swojego stanu. */
  hide(sessionId: string): void {
    const token = this.tokenOf(sessionId);
    const s = this.session;
    const p = this.ctx.players.get(sessionId);
    const track = this.ctx.tracks.get(sessionId);
    if (!token || !s || !p || !track || s.phase !== "HIDING" || s.roleOf(token) !== "HIDER_MOVING") return;
    if (this.perf() - track.at > MAX_SAMPLE_AGE) return this.notice(sessionId, "HIDE_STALE");
    if (!track.grounded || !p.grounded) return this.notice(sessionId, "HIDE_AIRBORNE");
    if (this.ctx.walk.checkPoint(track.x, track.z) !== null || !this.inBounds(track.x, track.z)) return this.notice(sessionId, "HIDE_ILLEGAL");
    if (s.hide(token, { x: track.x, y: track.y, z: track.z, supportId: track.rockId }).ok) {
      this.snapToSpot(sessionId, token);
      this.flush();
    }
  }

  /** „ZNALAZŁEM!”: żadnego celu od klienta; liczy się tylko pozycja szukającego znana serwerowi. */
  found(sessionId: string, data: unknown): void {
    const token = this.tokenOf(sessionId);
    const s = this.session;
    const track = this.ctx.tracks.get(sessionId);
    if (!token || !s || !track || !data || typeof data !== "object") return;
    const requestId = (data as { requestId?: unknown }).requestId;
    if (typeof requestId !== "number" || !Number.isSafeInteger(requestId)) return;
    if (s.phase !== "SEEKING" || s.roleOf(token) !== "SEEKER") return;
    if (this.perf() - track.at > MAX_SAMPLE_AGE) return this.notice(sessionId, "FIND_STALE");
    const out = s.found(token, requestId, { x: track.x, y: track.y, z: track.z });
    if (out.kind === "hit") {
      const hiderSession = this.sessionByToken.get(out.hiderKey);
      const hiderName = (hiderSession && this.ctx.players.get(hiderSession)?.name) || "Gracz";
      const left = s.lockedKeys().length;
      const seekerName = this.ctx.players.get(sessionId)?.name ?? "Szukający";
      this.event(sessionId, { kind: "hit", name: hiderName, left });
      if (hiderSession) this.event(hiderSession, { kind: "found", by: seekerName });
    } else if (out.kind === "miss") {
      this.event(sessionId, { kind: "miss", failed: out.failed, max: out.max });
    } else return;
    this.flush();
  }

  private event(sessionId: string, event: HsEvent) {
    this.ctx.send(sessionId, "hs.event", event);
  }

  // ---------- ruch ----------

  /**
   * Bramka ruchu uczestnika. Poza zabawą nic nie zmienia. W aktywnej zabawie uczestnik podlega bramce z sesji
   * (zamrożony szukający, zablokowany ukrywający się) oraz trybowi ścisłemu ciągłości (bez teleportów).
   */
  motionGuard(sessionId: string, prev: Player, data: Motion): MotionGuard {
    const token = this.tokenOf(sessionId);
    const s = this.session;
    if (!token || !s || !s.isParticipant(token)) return { reject: false, strict: false, data };
    const gate = s.gateFor(token);
    const verdict = gateAcceptsMotion(gate, data, prev);
    if (!verdict.ok) {
      const correct = gate.anchor && (verdict.reason === "moved" || verdict.reason === "velocity") ? { x: gate.anchor.x, y: prev.y, z: gate.anchor.z } : undefined;
      return { reject: true, correct };
    }
    const snapped = gate.anchor ? { ...data, x: gate.anchor.x, z: gate.anchor.z } : data;
    return { reject: false, strict: true, data: snapped };
  }

  /** Wysyła korektę pozycji (z ograniczeniem częstości). */
  correct(sessionId: string, at: { x: number; y: number; z: number }) {
    const t = this.perf() * 1000;
    if (t - (this.lastCorrect.get(sessionId) ?? -Infinity) < CORRECT_INTERVAL_MS) return;
    this.lastCorrect.set(sessionId, t);
    this.ctx.send(sessionId, "hs.correct", at);
  }

  /** Zapamiętuje ostatnią stabilną (na ziemi) pozycję: podstawa automatycznej kryjówki. */
  noteStable(sessionId: string, track: MotionTrack) {
    if (track.grounded) this.stable.set(sessionId, { x: track.x, y: track.y, z: track.z, supportId: track.rockId });
  }

  /** Czy ciała dwóch graczy mogą się blokować (izolacja uczestników / znalezieni nie przeszkadzają). */
  collides(a: string, b: string): boolean {
    const s = this.session;
    if (!s) return true;
    const ta = this.tokenOf(a);
    const tb = this.tokenOf(b);
    return bodiesCollide(s.phase, ta ? s.roleOf(ta) : null, tb ? s.roleOf(tb) : null);
  }

  /** Czy `listener` ma słyszeć dźwięk gracza `source` (to samo kryterium co widoczność). */
  canHear(listener: string, source: string): boolean {
    const s = this.session;
    if (!s) return true;
    const a = this.tokenOf(listener);
    const b = this.tokenOf(source);
    return s.relation(a ?? "", b ?? "").visible;
  }

  /** Komendy zmieniające wspólny świat: zakazane uczestnikom aktywnej zabawy, a zbiór skały pod ukrytym graczem jest nietykalny. */
  mayRunWorldCommand(sessionId: string, command: unknown): boolean {
    const token = this.tokenOf(sessionId);
    const s = this.session;
    if (!s || !command || typeof command !== "object") return true;
    const { type, objectId } = command as { type?: unknown; objectId?: unknown };
    if (type !== "harvest" && type !== "bridge.build") return true;
    if (token && s.isRestricted(token)) {
      this.notice(sessionId, "WORLD_BLOCKED");
      return false;
    }
    if (type === "harvest" && typeof objectId === "string" && s.active && s.lockedKeys().some((k) => s.spotOf(k)?.supportId === objectId)) {
      this.notice(sessionId, "WORLD_BLOCKED");
      return false;
    }
    return true;
  }

  /** Po zebraniu obiektów ze świata: kryjówki stojące na zniknęłych skałach opadają do podłoża. */
  worldChanged(removed: readonly string[]) {
    const s = this.session;
    if (!s || !removed.length) return;
    for (const key of s.lockedKeys()) {
      const spot = s.spotOf(key);
      if (spot?.supportId && removed.includes(spot.supportId)) s.adjustSpot(key, this.ctx.floorAt(spot.x, spot.z), null);
    }
  }

  // ---------- migawki i czas ----------

  /** Gracze widoczni dla odbiorcy; poza aktywną fazą zwraca zwykłą listę pokoju. */
  snapshotFor(sessionId: string): Player[] {
    const all = [...this.ctx.players.values()];
    const s = this.session;
    if (!s || !s.active) return all;
    const viewer = this.tokenOf(sessionId) ?? "";
    const out: Player[] = [];
    for (const p of all) {
      const key = this.tokenOf(p.sessionId) ?? "";
      if (!s.relation(viewer, key).visible) continue;
      const mini = miniOfRole(s.roleOf(key));
      const lamp = this.forced.has(key);
      out.push(mini || lamp ? { ...p, ...(mini ? { mini } : {}), ...(lamp ? { lanternForced: true } : {}) } : p);
    }
    return out;
  }

  viewFor(sessionId: string): HsStateView | null {
    const token = this.tokenOf(sessionId);
    return token && this.session ? this.session.viewFor(token) : null;
  }

  /** Wymusza ponowne wysłanie stanu (np. po `hello`). */
  resend(sessionId: string) {
    this.sent.delete(sessionId);
    this.flush();
  }

  /** Wywoływane w pętli symulacji pokoju. */
  tick(): void {
    const s = this.session;
    if (!s) return;
    s.advance();
    this.reapGhosts();
    this.forced = new Set(s.active ? [...this.tokenBySession.values()].filter((k) => s.lampForced(k)) : []);
    this.flush();
    if (s.ended && s.endedAt !== null && this.now() - s.endedAt > this.lingerMs) {
      this.session = null;
      this.forced = new Set();
      this.sent.clear();
    }
  }

  private reapGhosts() {
    const s = this.session;
    for (const [token, ghost] of [...this.ghosts]) {
      if (s && !s.ended && s.isParticipant(token)) continue;
      this.ctx.removePlayer(ghost.sessionId);
      this.forget(ghost.sessionId);
    }
  }

  private flush() {
    const s = this.session;
    if (!s) return;
    const stamp = `${s.id}:${s.rev}`;
    for (const [sessionId, token] of this.tokenBySession) {
      if (!s.has(token) || this.sent.get(sessionId) === stamp || this.ghosts.has(token)) continue;
      const view = s.viewFor(token);
      if (!view) continue;
      this.sent.set(sessionId, stamp);
      this.ctx.send(sessionId, "hs.state", view);
    }
  }

  // ---------- pozycje ----------

  private inBounds(x: number, z: number) {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  private positionOf(key: string): { x: number; y: number; z: number } | null {
    const sid = this.sessionByToken.get(key);
    const p = sid ? this.ctx.players.get(sid) : undefined;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  /**
   * Kryjówka dla gracza, który nie zdążył jej zatwierdzić: aktualna pozycja, jeśli stoi na ziemi, albo miejsce lądowania
   * pod nim (gdy blisko ostatniej stabilnej pozycji i legalne), w przeciwnym razie ostatnia stabilna pozycja.
   */
  private autoSpot(key: string): HsSpot | null {
    const sid = this.sessionByToken.get(key);
    const p = sid ? this.ctx.players.get(sid) : undefined;
    const track = sid ? this.ctx.tracks.get(sid) : undefined;
    if (!sid || !p || !track) return null;
    if (track.grounded && this.legal(track.x, track.z)) return { x: track.x, y: track.y, z: track.z, supportId: track.rockId };
    const stable = this.stable.get(sid);
    const floor = this.ctx.floorAt(track.x, track.z);
    const rock = this.ctx.walk.supportSurfaceAt(track.x, track.z, track.y, 0, Infinity);
    const landY = rock && rock.y >= floor ? rock.y : floor;
    const landing: HsSpot = { x: track.x, y: landY, z: track.z, supportId: rock && rock.y >= floor ? rock.id : null };
    if (this.legal(landing.x, landing.z) && (!stable || Math.hypot(landing.x - stable.x, landing.z - stable.z) <= 3)) return landing;
    return stable ?? null;
  }

  private legal(x: number, z: number) {
    return this.inBounds(x, z) && this.ctx.walk.checkPoint(x, z) === null;
  }

  /** Po zatwierdzeniu kryjówki serwerowa pozycja gracza staje się dokładnie punktem kryjówki. */
  private snapToSpot(sessionId: string, token: string) {
    const spot = this.session?.spotOf(token);
    const p = this.ctx.players.get(sessionId);
    if (spot && p) {
      p.x = spot.x;
      p.z = spot.z;
    }
  }
}
