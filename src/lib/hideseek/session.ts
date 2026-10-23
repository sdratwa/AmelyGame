import { generateSearchArea, type AreaBounds, type Rng } from "./areas";
import { LampSchedule } from "./lamps";
import { FREE_GATE, type HideSeekConfig, type HsArea, type HsCancelReason, type HsEndReason, type HsFinishReason, type HsInvite, type HsOutcome, type HsPhase, type HsResult, type HsRole, type HsSpot, type HsStateView, type MovementGate } from "./types";
import { isActivePhase, relationBetween, type Relation } from "./visibility";

export type SessionOptions = {
  id: string;
  /** Zegar w ms (wstrzykiwany: serwer podaje `Date.now`, testy zegar sztuczny). */
  now: () => number;
  rng: Rng;
  config: HideSeekConfig;
  host: { key: string; name: string };
  /** Snapshot uprawnionych w chwili zaproszenia (online, w lesie, nie w innej zabawie). Późniejsi nie zmieniają sesji. */
  eligible: { key: string; name: string }[];
  bounds: AreaBounds;
  /** Ostatnia przyjęta pozycja gracza po stronie serwera (kotwica szukającego). */
  positionOf: (key: string) => { x: number; y: number; z: number } | null;
  /** Kryjówka dla gracza, który nie zdążył jej zatwierdzić (ostatnia stabilna pozycja). */
  autoSpot: (key: string) => HsSpot | null;
};

type Member = {
  key: string;
  name: string;
  invite: HsInvite;
  role: HsRole | null;
  order: number;
  wasHider: boolean;
  /** Został odnaleziony (zostaje policzony jako znaleziony nawet po późniejszej rezygnacji). */
  wasFound: boolean;
  spot: HsSpot | null;
  autoLocked: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  lamp: LampSchedule | null;
  areaId: string | null;
};

export type HideResult = { ok: true } | { ok: false; reason: "phase" | "role" };
export type FoundResult =
  | { kind: "ignored"; reason: "role" | "phase" | "duplicate" | "cooldown" }
  | { kind: "hit"; hiderKey: string }
  | { kind: "miss"; failed: number; max: number };

const NOT_IN_SESSION = new Set<HsRole | null>([null, "WITHDRAWN"]);

/**
 * Serwerowa maszyna stanów jednej zabawy w chowanego. Czysta logika: bez sieci, bez Colyseus, bez DOM. Czas i losowość są
 * wstrzykiwane. Klient nigdy nie zmienia fazy, ról ani wyniku - może tylko zgłosić zamiar (odpowiedź na zaproszenie,
 * „to moja kryjówka”, „znalazłem”, rezygnacja), a każde zgłoszenie jest sprawdzane przez tę klasę.
 * Metody są idempotentne: powtórzone lub spóźnione zgłoszenie niczego nie psuje (`rev` rośnie tylko przy zmianie).
 */
export class HideSeekSession {
  readonly id: string;
  readonly config: HideSeekConfig;
  readonly hostKey: string;
  phase: HsPhase = "INVITING";
  rev = 1;
  result: HsResult | null = null;
  private readonly now: () => number;
  private readonly rng: Rng;
  private readonly bounds: AreaBounds;
  private readonly positionOf: SessionOptions["positionOf"];
  private readonly autoSpot: SessionOptions["autoSpot"];
  private readonly members = new Map<string, Member>();
  private inviteTimeoutAt: number;
  private joinDeadline: number | null = null;
  private deadline: number;
  private seekerAnchor: { x: number; z: number } | null = null;
  private failed = 0;
  private lastFindRequest = 0;
  private lastFindAt = -Infinity;
  private lampsOn = false;
  private areas: (HsArea & { key: string })[] = [];
  private outcomes = new Map<string, HsOutcome>();
  endedAt: number | null = null;

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.now = options.now;
    this.rng = options.rng;
    this.config = options.config;
    this.bounds = options.bounds;
    this.positionOf = options.positionOf;
    this.autoSpot = options.autoSpot;
    this.hostKey = options.host.key;
    let order = 0;
    this.members.set(options.host.key, this.newMember(options.host.key, options.host.name, "host", "SEEKER", order++));
    for (const e of options.eligible) {
      if (!this.members.has(e.key)) this.members.set(e.key, this.newMember(e.key, e.name, "pending", null, order++));
    }
    this.inviteTimeoutAt = this.now() + this.config.inviteTimeoutSeconds * 1000;
    this.deadline = this.inviteTimeoutAt;
  }

  private newMember(key: string, name: string, invite: HsInvite, role: HsRole | null, order: number): Member {
    return { key, name, invite, role, order, wasHider: false, wasFound: false, spot: null, autoLocked: false, connected: true, disconnectedAt: null, lamp: null, areaId: null };
  }

  // ---------- odczyty ----------

  get ended(): boolean {
    return this.phase === "FINISHED" || this.phase === "CANCELLED";
  }
  get active(): boolean {
    return isActivePhase(this.phase);
  }
  has(key: string): boolean {
    return this.members.has(key);
  }
  roleOf(key: string): HsRole | null {
    return this.members.get(key)?.role ?? null;
  }
  /** Czy gracz jest teraz w izolowanej grupie uczestników (aktywna faza, rola inna niż WITHDRAWN). */
  isParticipant(key: string): boolean {
    return this.active && !NOT_IN_SESSION.has(this.roleOf(key));
  }
  /** Uczestnik ma ograniczone interakcje (questy, skrzynie, wspólny świat). */
  isRestricted(key: string): boolean {
    return this.isParticipant(key);
  }
  spotOf(key: string): HsSpot | null {
    return this.members.get(key)?.spot ?? null;
  }
  /** Klucze zablokowanych ukrywających się (do sprawdzeń serwera). */
  lockedKeys(): string[] {
    return [...this.members.values()].filter((m) => m.role === "HIDER_LOCKED").map((m) => m.key);
  }
  relation(viewerKey: string, targetKey: string): Relation {
    return relationBetween(this.phase, this.roleOf(viewerKey), this.roleOf(targetKey));
  }
  /** Bieżący stan wymuszonego świecenia lampy ukrywającego się (tylko ostatnie 30 s poszukiwań). */
  lampForced(key: string): boolean {
    const m = this.members.get(key);
    if (!m || this.phase !== "SEEKING" || m.role !== "HIDER_LOCKED" || !m.lamp) return false;
    return m.lamp.advance(this.now());
  }
  get lampHintActive(): boolean {
    return this.lampsOn && this.phase === "SEEKING";
  }

  gateFor(key: string): MovementGate {
    const m = this.members.get(key);
    if (!m) return FREE_GATE;
    if (this.phase === "HIDING" && m.role === "SEEKER") return { anchor: this.seekerAnchor, allowJump: false, allowCrouch: false, allowLook: false, cameraDown: true };
    if (this.active && m.role === "HIDER_LOCKED" && m.spot) return { anchor: { x: m.spot.x, z: m.spot.z }, allowJump: true, allowCrouch: true, allowLook: true, cameraDown: false };
    return FREE_GATE;
  }

  // ---------- zgłoszenia uczestników ----------

  /** Odpowiedź na zaproszenie. Zwraca true, jeśli stan się zmienił. */
  respond(key: string, accept: boolean): boolean {
    const m = this.members.get(key);
    if (!m || this.phase !== "INVITING" || m.invite === "host") return false;
    const next: HsInvite = accept ? "accepted" : "declined";
    if (m.invite === next) return false;
    m.invite = next;
    this.touch();
    this.evaluateLobby();
    return true;
  }

  /** Organizator anuluje zabawę (po potwierdzeniu w UI). */
  cancelByHost(key: string): boolean {
    if (key !== this.hostKey || this.ended) return false;
    this.cancel("HOST_CANCELLED");
    return true;
  }

  /** Zatwierdzenie kryjówki. Legalność pozycji sprawdza serwer przed wywołaniem; tu pilnujemy fazy i roli. */
  hide(key: string, spot: HsSpot, auto = false): HideResult {
    const m = this.members.get(key);
    if (this.phase !== "HIDING") return { ok: false, reason: "phase" };
    if (!m || m.role !== "HIDER_MOVING") return { ok: false, reason: "role" };
    m.role = "HIDER_LOCKED";
    m.spot = { ...spot };
    m.autoLocked = auto;
    this.touch();
    if (![...this.members.values()].some((x) => x.role === "HIDER_MOVING")) this.startSeeking();
    return { ok: true };
  }

  /**
   * „ZNALAZŁEM!”. Nie przyjmuje żadnego celu od klienta: liczy się wyłącznie pozycja szukającego znana serwerowi i zapisane
   * kryjówki ukrytych graczy. Dystans 3D musi być ściśle mniejszy niż `findDistance`; wygrywa najbliższy.
   */
  found(key: string, requestId: number, at: { x: number; y: number; z: number }): FoundResult {
    const m = this.members.get(key);
    if (!m || m.role !== "SEEKER") return { kind: "ignored", reason: "role" };
    if (this.phase !== "SEEKING") return { kind: "ignored", reason: "phase" };
    if (!Number.isSafeInteger(requestId) || requestId <= this.lastFindRequest) return { kind: "ignored", reason: "duplicate" };
    this.lastFindRequest = requestId;
    const now = this.now();
    if (now - this.lastFindAt < this.config.findCooldownMs) return { kind: "ignored", reason: "cooldown" };
    this.lastFindAt = now;
    let best: Member | null = null;
    let bestDistance = Infinity;
    for (const h of this.members.values()) {
      if (h.role !== "HIDER_LOCKED" || !h.spot) continue;
      const d = Math.hypot(h.spot.x - at.x, h.spot.y - at.y, h.spot.z - at.z);
      if (d < this.config.findDistance && (d < bestDistance || (d === bestDistance && best && h.order < best.order))) {
        best = h;
        bestDistance = d;
      }
    }
    if (best) {
      best.role = "HIDER_FOUND";
      best.wasFound = true;
      best.lamp = null;
      this.removeArea(best);
      this.touch();
      if (!this.lockedKeys().length) this.finish("ALL_FOUND");
      return { kind: "hit", hiderKey: best.key };
    }
    this.failed++;
    this.touch();
    if (this.failed >= this.config.maxFailed) this.finish("TOO_MANY_MISSES");
    return { kind: "miss", failed: this.failed, max: this.config.maxFailed };
  }

  /** Świadoma rezygnacja (albo wycofanie po upływie okresu na reconnect). */
  withdraw(key: string): boolean {
    const m = this.members.get(key);
    if (!m || this.ended) return false;
    if (key === this.hostKey) {
      this.cancel(this.phase === "INVITING" ? "HOST_CANCELLED" : "SEEKER_WITHDREW");
      return true;
    }
    if (this.phase === "INVITING") return this.respond(key, false);
    if (!m.role || m.role === "WITHDRAWN") return false;
    const wasFound = m.wasFound;
    m.role = "WITHDRAWN";
    m.lamp = null;
    this.removeArea(m);
    this.touch();
    if (!wasFound) this.afterHiderGone();
    return true;
  }

  disconnect(key: string): void {
    const m = this.members.get(key);
    if (!m || this.ended || !m.connected) return;
    m.connected = false;
    m.disconnectedAt = this.now();
    if (this.phase === "INVITING" && m.invite === "pending") {
      m.invite = "declined";
      this.touch();
      this.evaluateLobby();
    }
  }

  /** Powrót w okresie na reconnect; true = gracz nadal należy do sesji. */
  reconnect(key: string): boolean {
    const m = this.members.get(key);
    if (!m || this.ended) return false;
    m.connected = true;
    m.disconnectedAt = null;
    return true;
  }

  /** Korekta wysokości kryjówki po zniknięciu podparcia (np. zebrana skała); poziomo gracz nadal stoi w tym samym miejscu. */
  adjustSpot(key: string, y: number, supportId: string | null): void {
    const m = this.members.get(key);
    if (m?.spot) m.spot = { ...m.spot, y, supportId };
  }

  // ---------- upływ czasu ----------

  advance(): void {
    if (this.ended) return;
    const now = this.now();
    for (const m of [...this.members.values()]) {
      if (m.connected || m.disconnectedAt === null || this.ended) continue;
      if (now - m.disconnectedAt < this.config.graceSeconds * 1000) continue;
      m.disconnectedAt = null;
      if (m.key === this.hostKey) this.cancel(this.active ? "SEEKER_LEFT" : "HOST_CANCELLED");
      else this.withdraw(m.key);
    }
    if (this.ended) return;
    if (this.phase === "INVITING") {
      if (now >= this.deadline) {
        if (this.joinDeadline !== null) this.startHiding();
        else this.cancel("NOBODY_JOINED");
      }
    } else if (this.phase === "HIDING") {
      if (now >= this.deadline) {
        for (const m of this.members.values()) {
          if (m.role !== "HIDER_MOVING") continue;
          const spot = this.autoSpot(m.key);
          if (spot) {
            m.role = "HIDER_LOCKED";
            m.spot = { ...spot };
            m.autoLocked = true;
          } else {
            m.role = "WITHDRAWN";
          }
        }
        this.touch();
        this.startSeeking();
      }
    } else if (this.phase === "SEEKING") {
      if (!this.lampsOn && now >= this.deadline - this.config.lampHintSeconds * 1000) this.startLamps(now);
      if (now >= this.deadline) this.finish("TIME_UP");
    }
  }

  // ---------- przejścia ----------

  private touch() {
    this.rev++;
  }

  private evaluateLobby() {
    if (this.phase !== "INVITING") return;
    const eligible = [...this.members.values()].filter((m) => m.invite !== "host");
    const accepted = eligible.filter((m) => m.invite === "accepted").length;
    const pending = eligible.filter((m) => m.invite === "pending").length;
    if (accepted >= 1 && this.joinDeadline === null) {
      // Pierwszy uczestnik uruchamia odliczanie dołączania; reszta zaproszonych może jeszcze dołączyć.
      this.joinDeadline = this.now() + this.config.joinSeconds * 1000;
      this.deadline = this.joinDeadline;
      this.touch();
    } else if (accepted === 0 && this.joinDeadline !== null) {
      // Pierwszy uczestnik się wycofał: nie uruchamiamy sesji dla samego szukającego, wracamy do oczekiwania.
      this.joinDeadline = null;
      this.deadline = this.inviteTimeoutAt;
      this.touch();
    }
    if (pending === 0) {
      if (accepted >= 1) this.startHiding();
      else this.cancel("NOBODY_JOINED");
    }
  }

  private startHiding() {
    if (this.phase !== "INVITING") return;
    const accepted = [...this.members.values()].filter((m) => m.invite === "accepted");
    if (!accepted.length) {
      this.cancel("NOBODY_JOINED");
      return;
    }
    for (const m of accepted) {
      m.role = "HIDER_MOVING";
      m.wasHider = true;
    }
    const pos = this.positionOf(this.hostKey);
    this.seekerAnchor = pos ? { x: pos.x, z: pos.z } : null;
    this.phase = "HIDING";
    this.deadline = this.now() + this.config.hideSeconds * 1000;
    this.touch();
  }

  private startSeeking() {
    const locked = [...this.members.values()].filter((m) => m.role === "HIDER_LOCKED");
    if (!locked.length) {
      this.cancel("NO_PLAYERS");
      return;
    }
    this.phase = "SEEKING";
    this.deadline = this.now() + this.config.seekMinutes * 60_000;
    const used = new Set<string>();
    this.areas = locked.map((m) => {
      let id = "";
      do id = `ar_${this.rng().toString(36).slice(2, 10)}`;
      while (used.has(id) || id === "ar_");
      used.add(id);
      m.areaId = id;
      const area = generateSearchArea(this.rng, m.spot!, this.config.areaRadius, this.bounds);
      return { id, key: m.key, ...area };
    });
    this.touch();
    if (this.config.seekMinutes * 60 <= this.config.lampHintSeconds) this.startLamps(this.now());
  }

  private startLamps(now: number) {
    this.lampsOn = true;
    for (const m of this.members.values()) if (m.role === "HIDER_LOCKED") m.lamp = new LampSchedule(this.rng, now);
    this.touch();
  }

  private removeArea(m: Member) {
    if (!m.areaId) return;
    this.areas = this.areas.filter((a) => a.id !== m.areaId);
    m.areaId = null;
  }

  private afterHiderGone() {
    const alive = [...this.members.values()].filter((m) => m.role === "HIDER_MOVING" || m.role === "HIDER_LOCKED");
    const foundCount = [...this.members.values()].filter((m) => m.role === "HIDER_FOUND").length;
    if (this.phase === "HIDING") {
      if (!alive.length) this.cancel("NO_PLAYERS");
      else if (!alive.some((m) => m.role === "HIDER_MOVING")) this.startSeeking();
    } else if (this.phase === "SEEKING" && !alive.length) {
      if (foundCount > 0) this.finish("ALL_FOUND");
      else this.cancel("NO_PLAYERS");
    }
  }

  private collectOutcomes(reason: HsEndReason): HsResult {
    const entries: HsResult["outcomes"] = [];
    this.outcomes.clear();
    const seekerWins = reason === "ALL_FOUND";
    const cancelled = reason !== "ALL_FOUND" && reason !== "TIME_UP" && reason !== "TOO_MANY_MISSES";
    const list = [...this.members.values()].sort((a, b) => a.order - b.order).filter((m) => m.key === this.hostKey || m.wasHider || (cancelled && m.invite === "accepted"));
    for (const m of list) {
      let outcome: HsOutcome;
      if (cancelled) outcome = "CANCELLED";
      else if (m.role === "WITHDRAWN" && !m.wasFound) outcome = "WITHDRAWN";
      else if (m.key === this.hostKey) outcome = seekerWins ? "WIN" : "LOSE";
      else if (m.wasFound) outcome = "LOSE";
      else outcome = seekerWins ? "LOSE" : "WIN";
      this.outcomes.set(m.key, outcome);
      entries.push({ name: m.name, role: m.key === this.hostKey ? "seeker" : "hider", outcome, found: m.wasFound });
    }
    return { reason, outcomes: entries };
  }

  private finish(reason: HsFinishReason) {
    if (this.ended) return;
    this.result = this.collectOutcomes(reason);
    this.phase = "FINISHED";
    this.endSession();
  }

  private cancel(reason: HsCancelReason) {
    if (this.ended) return;
    this.result = this.collectOutcomes(reason);
    this.phase = "CANCELLED";
    this.endSession();
  }

  private endSession() {
    this.endedAt = this.now();
    this.areas = [];
    this.lampsOn = false;
    for (const m of this.members.values()) m.lamp = null;
    this.touch();
  }

  // ---------- widok dla gracza ----------

  viewFor(key: string): HsStateView | null {
    const m = this.members.get(key);
    if (!m) return null;
    const now = this.now();
    const all = [...this.members.values()];
    const invited = all.filter((x) => x.invite !== "host");
    let timer: HsStateView["timer"] = null;
    if (this.phase === "INVITING") timer = this.joinDeadline !== null ? "join" : "invite";
    else if (this.phase === "HIDING") timer = "hide";
    else if (this.phase === "SEEKING") timer = "seek";
    const hiders = all.filter((x) => x.wasHider && (x.role !== "WITHDRAWN" || x.wasFound));
    const showSeek = this.phase === "HIDING" || this.phase === "SEEKING" || (this.ended && m.wasHider) || (this.ended && m.key === this.hostKey);
    const outcome = this.outcomes.get(key);
    return {
      rev: this.rev,
      sessionId: this.id,
      hostName: this.members.get(this.hostKey)?.name ?? "",
      phase: this.phase,
      you: {
        role: m.role,
        invite: m.invite,
        isHost: key === this.hostKey,
        autoLocked: m.autoLocked,
        restricted: this.isRestricted(key),
      },
      endsInMs: timer ? Math.max(0, this.deadline - now) : null,
      timer,
      lobby:
        this.phase === "INVITING"
          ? {
              invited: invited.length,
              accepted: invited.filter((x) => x.invite === "accepted").length,
              declined: invited.filter((x) => x.invite === "declined").length,
              pending: invited.filter((x) => x.invite === "pending").length,
              roster: key === this.hostKey ? invited.map((x) => ({ name: x.name, status: x.invite })) : null,
            }
          : null,
      seek: showSeek
        ? { total: hiders.length, found: hiders.filter((x) => x.wasFound).length, failed: this.failed, maxFailed: this.config.maxFailed, lastThirty: this.lampHintActive }
        : null,
      areas: this.phase === "SEEKING" && m.role === "SEEKER" ? this.areas.map(({ id, x, z, r }) => ({ id, x, z, r })) : null,
      gate: this.gateFor(key),
      config: {
        seekMinutes: this.config.seekMinutes,
        hideSeconds: this.config.hideSeconds,
        joinSeconds: this.config.joinSeconds,
        maxFailed: this.config.maxFailed,
        areaRadius: this.config.areaRadius,
        findDistance: this.config.findDistance,
      },
      result: this.result && outcome ? { ...this.result, you: outcome } : null,
    };
  }
}
