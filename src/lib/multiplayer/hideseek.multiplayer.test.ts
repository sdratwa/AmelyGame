import { afterEach, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { createServer } from "../../../server/src/server";
import { ForestRoom } from "../../../server/src/ForestRoom";
import { createInstance } from "./world";
import { PROTOCOL, idleMotion, type Player, type Snapshot, type Welcome } from "./protocol";
import { FakeClock, seeded } from "../hideseek/testkit";
import type { HsEvent, HsNoticeCode, HsStateView } from "../hideseek/types";

/**
 * Test integracyjny Node (bez przeglądarki): prawdziwy serwer Colyseus, klienci Node, zegar zabawy wstrzyknięty (sztuczny),
 * 2-8 graczy, odrzucone żądania, rozłączenia i powrót z tokenem. Wszystko, co dotyczy czasu rundy, liczy sztuczny zegar,
 * więc test nie czeka 60 s ani 5 minut.
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, timeout = 4000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw Error(`Przekroczono czas oczekiwania: ${what}`);
    await delay(15);
  }
}

const instance = createInstance();
const terrainY = (x: number, z: number) => instance.walk.terrain.height(x, z);

class Bot {
  state: HsStateView | null = null;
  events: HsEvent[] = [];
  notices: HsNoticeCode[] = [];
  corrections: { x: number; y: number; z: number }[] = [];
  snapshot: Snapshot = { players: [], serverTime: 0, worldElapsed: 0 };
  replies: { accepted: boolean }[] = [];
  welcome!: Welcome;
  private seq = 0;
  private jumps = 0;
  constructor(readonly room: Room, readonly endpoint: string, readonly roomId: string) {}

  static async join(endpoint: string, roomId: string, resumeToken?: string): Promise<Bot> {
    const room = await new Client(endpoint).joinById(roomId, { worldInstanceId: roomId, protocol: PROTOCOL, fingerprint: instance.config.fingerprint, ...(resumeToken ? { resumeToken } : {}) });
    const bot = new Bot(room, endpoint, roomId);
    room.onMessage("*", (type, msg) => bot.handle(String(type), msg));
    bot.welcome = await new Promise<Welcome>((resolve) => {
      room.onMessage("welcome", resolve);
      room.send("hello");
    });
    if (bot.welcome.hs) bot.state = bot.welcome.hs;
    return bot;
  }

  private handle(type: string, msg: unknown) {
    if (type === "snapshot") this.snapshot = msg as Snapshot;
    else if (type === "hs.state") {
      const v = msg as HsStateView;
      if (!this.state || this.state.sessionId !== v.sessionId || v.rev > this.state.rev) this.state = v;
    } else if (type === "hs.event") this.events.push(msg as HsEvent);
    else if (type === "hs.notice") this.notices.push((msg as { code: HsNoticeCode }).code);
    else if (type === "hs.correct") this.corrections.push(msg as { x: number; y: number; z: number });
    else if (type === "worldReply") this.replies.push(msg as { accepted: boolean });
  }

  get id() {
    return this.welcome.player.playerId;
  }
  get token() {
    return this.welcome.resumeToken!;
  }
  send(type: string, data?: unknown) {
    this.room.send(type, data);
  }
  me(): Player | undefined {
    return this.snapshot.players.find((p) => p.playerId === this.id);
  }
  sees(other: Bot) {
    return this.snapshot.players.some((p) => p.playerId === other.id);
  }
  seen(other: Bot): Player | undefined {
    return this.snapshot.players.find((p) => p.playerId === other.id);
  }
  /** Ruch na ziemi w punkcie (x, z); zawsze większy `sequence`. */
  stand(x: number, z: number, extra: Partial<ReturnType<typeof idleMotion>> = {}) {
    this.send("motion", { ...idleMotion(x, terrainY(x, z), z), sequence: ++this.seq, jumpSequence: this.jumps, ...extra });
  }
  here() {
    return { x: this.welcome.player.x, z: this.welcome.player.z };
  }
  pos = { x: 0, z: 0, set: false };
  /** Marsz krokami po ok. 1 m (tryb ścisły serwera wymaga ciągłości). */
  async walk(x: number, z: number) {
    if (!this.pos.set) this.pos = { ...this.here(), set: true };
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz)));
    for (let i = 1; i <= steps; i++) {
      this.pos.x += dx / steps;
      this.pos.z += dz / steps;
      this.stand(this.pos.x, this.pos.z, { animation: "walk", speed: 3 });
      await delay(12);
    }
  }
  jump() {
    this.jumps++;
    this.send("motion", { ...idleMotion(this.pos.set ? this.pos.x : this.here().x, terrainY(this.pos.x, this.pos.z) + 0.5, this.pos.set ? this.pos.z : this.here().z), sequence: ++this.seq, grounded: false, jumpSequence: this.jumps, animation: "jump" });
  }
  drop() {
    // zerwanie połączenia (nie świadome wyjście)
    this.room.connection.close(4001);
  }
}

type Env = { bots: Bot[]; clock: FakeClock; room: ForestRoom; endpoint: string; roomId: string; stop: () => Promise<void> };
let envs: Env[] = [];
let counter = 0;

async function setup(n: number, seed = 5): Promise<Env> {
  const clock = new FakeClock();
  ForestRoom.hideSeekOptions = { now: clock.now, rng: seeded(seed), allowDev: true };
  const server = createServer();
  await server.listen(0, "127.0.0.1");
  const address = server.transport.server!.address();
  if (!address || typeof address === "string") throw Error("port");
  const endpoint = `ws://127.0.0.1:${address.port}`;
  const roomId = `hs_room_${++counter}`;
  await matchMaker.createRoom("forest", { worldInstanceId: roomId });
  const room = matchMaker.getLocalRoomById(roomId) as ForestRoom;
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    const bot = await Bot.join(endpoint, roomId);
    bot.send("hs.presence", { inForest: true });
    bots.push(bot);
  }
  await delay(150);
  const env: Env = {
    bots,
    clock,
    room,
    endpoint,
    roomId,
    stop: async () => {
      for (const b of bots) if (b.room.connection.isOpen) await b.room.leave().catch(() => {});
      await delay(60);
      await server.gracefullyShutdown(false);
    },
  };
  envs.push(env);
  return env;
}

afterEach(async () => {
  for (const e of envs) await e.stop().catch(() => {});
  envs = [];
  ForestRoom.hideSeekOptions = {};
});

const phaseOf = (b: Bot) => b.state?.phase;
const roleOf = (b: Bot) => b.state?.you.role;

describe("zabawa w chowanego: serwer", () => {
  it("3 graczy: zaproszenie, odmowa, chowanie, izolacja, ruch zablokowany na serwerze, szukanie i wygrana szukającego", async () => {
    const { bots, clock } = await setup(3);
    const [p0, p1, p2] = bots; // sloty: p0 (-100, 0), p1 (-40, 0), p2 (-100, 12); organizatorem jest p2
    p2.send("hs.start", { seekMinutes: 5, findDistance: 3.5 }); // parametr deweloperski: przyjęty tylko przy allowDev
    await until(() => phaseOf(p0) === "INVITING" && phaseOf(p1) === "INVITING" && phaseOf(p2) === "INVITING", "zaproszenia");
    expect(p0.state!.you.invite).toBe("pending");
    expect(p2.state!.you.isHost).toBe(true);
    expect(p2.state!.config.findDistance).toBe(3.5); // allowDev: serwer zatwierdził parametr rundy
    expect(p2.state!.lobby!.invited).toBe(2);

    // Odmowa p1: zostaje poza zabawą. Pierwsza akceptacja p0 odpala odliczanie dołączania, ale wszyscy odpowiedzieli, więc chowanie startuje od razu.
    p1.send("hs.respond", { accept: false });
    await until(() => p2.state!.lobby!.declined === 1, "odmowa");
    expect(phaseOf(p2)).toBe("INVITING");
    p0.send("hs.respond", { accept: true });
    await until(() => phaseOf(p0) === "HIDING" && phaseOf(p2) === "HIDING", "faza chowania");
    expect(roleOf(p2)).toBe("SEEKER");
    expect(roleOf(p0)).toBe("HIDER_MOVING");
    expect(p2.state!.gate.cameraDown).toBe(true);
    expect(p2.state!.gate.anchor).not.toBeNull();
    expect(p2.state!.seek!.total).toBe(1);
    expect(p0.state!.areas).toBeNull();
    expect(p2.state!.areas).toBeNull();

    // Izolacja i widoczność: szukający nie widzi ukrywającego się, ukrywający widzi szukającego (z oznaczeniem), obcy nikogo z zabawy.
    await delay(150);
    expect(p2.sees(p0)).toBe(false);
    expect(p0.sees(p2)).toBe(true);
    expect(p0.seen(p2)?.mini).toBe("seeker");
    expect(p1.sees(p0)).toBe(false);
    expect(p1.sees(p2)).toBe(false);
    expect(p0.sees(p1)).toBe(false);
    expect(p2.sees(p1)).toBe(false);
    expect(phaseOf(p1)).toBe("HIDING"); // obcy dostaje stan fazy, ale bez roli
    expect(roleOf(p1)).toBeNull();

    // Blokada ruchu szukającego działa po stronie SERWERA: wiadomości ruchu są odrzucane, a klient dostaje korektę.
    const seekerStart = p2.me()!;
    p2.stand(seekerStart.x + 5, seekerStart.z, { animation: "walk", speed: 3 });
    p2.stand(seekerStart.x, seekerStart.z, { crouching: true, animation: "crouch_idle" });
    await until(() => p2.corrections.length > 0, "korekta pozycji szukającego");
    expect(p0.seen(p2)).toMatchObject({ x: seekerStart.x, z: seekerStart.z });

    // Ukrywający: ruch ciągły przyjęty, teleport odrzucony (tryb ścisły), skok w locie nie jest kryjówką.
    await p0.walk(-100, 5);
    await until(() => Math.abs(p0.me()!.z - 5) < 0.01, "ruch ukrywającego");
    const before = p0.corrections.length;
    p0.stand(-100, 60);
    await until(() => p0.corrections.length > before, "korekta po teleporcie");
    expect(p0.me()!.z).toBeCloseTo(5, 1);
    p0.stand(-100, 5, { grounded: false, animation: "jump" });
    await delay(100);
    p0.send("hs.hide");
    await until(() => p0.notices.includes("HIDE_AIRBORNE"), "odmowa kryjówki w locie");
    expect(roleOf(p0)).toBe("HIDER_MOVING");

    // Prawidłowa kryjówka: stoi na ziemi.
    p0.pos = { x: -100, z: 5, set: true };
    p0.stand(-100, 5);
    await delay(60);
    p0.send("hs.hide");
    await until(() => phaseOf(p2) === "SEEKING" && roleOf(p0) === "HIDER_LOCKED", "poszukiwania");
    expect(p0.state!.gate.anchor).toMatchObject({ x: -100, z: 5 });

    // Zablokowany ukrywający: ruch poziomy odrzucony, skok w miejscu dozwolony.
    const jumpsFrom = p0.me()!.jumpSequence;
    p0.stand(-95, 5, { animation: "walk", speed: 3 });
    p0.jump();
    await until(() => p0.me()!.jumpSequence > jumpsFrom, "skok w kryjówce");
    expect(p0.me()!.x).toBeCloseTo(-100, 2);

    // Szukający dostaje obszar (50 m) zamiast pozycji, widzi ukrytą postać bez nazwy (mini "hider").
    expect(p2.state!.areas).toHaveLength(1);
    const area = p2.state!.areas![0];
    expect(Math.hypot(area.x - -100, area.z - 5)).toBeLessThanOrEqual(area.r);
    expect(Math.hypot(area.x - -100, area.z - 5)).toBeGreaterThan(0);
    expect(JSON.stringify(p2.state)).not.toContain('"supportId"');
    await until(() => p2.sees(p0), "szukający widzi ukrytego w SEEKING");
    expect(p2.seen(p0)?.mini).toBe("hider");

    // Szukający podchodzi na odległość mniejszą niż dystans z konfiguracji i zgłasza trafienie (pudła sprawdza osobny test).
    await p2.walk(-100, 8);
    await delay(60);
    clock.advance(2000);
    p2.send("hs.found", { requestId: 1 });
    await until(() => phaseOf(p2) === "FINISHED", "koniec rundy");
    expect(p2.events.some((e) => e.kind === "hit")).toBe(true);
    expect(p0.events.some((e) => e.kind === "found")).toBe(true);
    expect(p2.state!.result).toMatchObject({ reason: "ALL_FOUND", you: "WIN" });
    expect(p0.state!.result).toMatchObject({ reason: "ALL_FOUND", you: "LOSE" });
    // Po rundzie widzimy się normalnie.
    await until(() => p1.sees(p0) && p1.sees(p2) && p0.sees(p1), "koniec izolacji");
  }, 30000);

  it("pudła i dystans: trafienie wymaga < 3 m, trzecie pudło kończy rundę porażką szukającego, duplikaty i cooldown nie liczą się podwójnie", async () => {
    const { bots, clock } = await setup(3);
    const [p0, p1, p2] = bots;
    p2.send("hs.start", { seekMinutes: 5 });
    await until(() => phaseOf(p0) === "INVITING", "zaproszenia");
    p0.send("hs.respond", { accept: true });
    p1.send("hs.respond", { accept: true });
    await until(() => phaseOf(p2) === "HIDING", "chowanie");
    p0.stand(-100, 0);
    p1.stand(-40, 0);
    await delay(60);
    p0.send("hs.hide");
    p1.send("hs.hide");
    await until(() => phaseOf(p2) === "SEEKING", "szukanie");
    expect(p2.state!.seek).toMatchObject({ total: 2, found: 0, failed: 0, maxFailed: 3 });
    expect(p2.state!.areas).toHaveLength(2);

    // Szukający stoi 12 m od p0: pudło. Ten sam requestId (duplikat) i szybkie ponowienie (cooldown) nie liczą się.
    p2.stand(-100, 12);
    await delay(60);
    clock.advance(2000);
    p2.send("hs.found", { requestId: 1 });
    p2.send("hs.found", { requestId: 1 });
    p2.send("hs.found", { requestId: 2 });
    await until(() => p2.state!.seek!.failed === 1, "pierwsze pudło");
    await delay(100);
    expect(p2.state!.seek!.failed).toBe(1);
    expect(p2.events.filter((e) => e.kind === "miss")).toHaveLength(1);
    // Spoof: klient nie wskazuje celu; dodatkowe pola są ignorowane.
    clock.advance(2000);
    p2.send("hs.found", { requestId: 3, target: p0.id, hiderKey: "x" });
    await until(() => p2.state!.seek!.failed === 2, "drugie pudło (cel od klienta ignorowany)");
    expect(phaseOf(p2)).toBe("SEEKING");
    clock.advance(2000);
    p2.stand(-100, 12);
    await delay(60);
    p2.send("hs.found", { requestId: 4 });
    await until(() => phaseOf(p2) === "FINISHED", "trzecie pudło");
    expect(p2.state!.result).toMatchObject({ reason: "TOO_MANY_MISSES", you: "LOSE" });
    expect(p0.state!.result).toMatchObject({ you: "WIN" });
    expect(p1.state!.result).toMatchObject({ you: "WIN" });
  }, 30000);

  it("czas: auto-kryjówka po 60 s, lampy w ostatnich 30 s niezależne od ręcznego stanu, koniec czasu daje wygraną ukrytym", async () => {
    const { bots, clock } = await setup(3);
    const [p0, p1, p2] = bots;
    p2.send("hs.start", { seekMinutes: 1 });
    await until(() => phaseOf(p1) === "INVITING", "zaproszenia");
    p0.send("hs.respond", { accept: true });
    p1.send("hs.respond", { accept: true });
    await until(() => phaseOf(p2) === "HIDING", "chowanie");
    // p0 chowa się sam, p1 nie zdąży.
    p0.stand(-100, 0);
    p1.stand(-40, 0);
    await delay(60);
    p0.send("hs.hide");
    await until(() => roleOf(p0) === "HIDER_LOCKED", "kryjówka p0");
    expect(roleOf(p1)).toBe("HIDER_MOVING");
    clock.advance(59_000);
    await delay(120);
    expect(phaseOf(p2)).toBe("HIDING");
    p1.stand(-40, 0); // świeża próbka tuż przed końcem
    clock.advance(1100);
    await until(() => phaseOf(p2) === "SEEKING", "koniec chowania");
    expect(roleOf(p1)).toBe("HIDER_LOCKED");
    expect(p1.state!.you.autoLocked).toBe(true);
    expect(p0.state!.you.autoLocked).toBe(false);

    // Ręczna lampa p0 włączona: wymuszony stan jej nie nadpisuje. Seek = 60 s, lampy ruszają w ostatnich 30 s.
    p0.send("lantern", { enabled: true });
    await delay(150);
    let forcedSeen = 0;
    let forcedOffSeen = 0;
    let p1Forced = 0;
    for (let i = 0; i < 12; i++) {
      clock.advance(1000); // do 12 s poszukiwań: lamp jeszcze nie ma
      await delay(60);
      expect(p2.seen(p1)?.lanternForced).not.toBe(true);
    }
    expect(p2.state!.seek!.lastThirty).toBe(false);
    for (let i = 0; i < 60; i++) {
      clock.advance(1000);
      await delay(60);
      const sp0 = p2.seen(p0);
      const sp1 = p2.seen(p1);
      if (sp0?.lanternForced) forcedSeen++;
      if (sp1?.lanternForced) p1Forced++;
      if (sp1 && sp1.lanternOn === false && sp1.lanternForced) forcedOffSeen++;
      if (phaseOf(p2) !== "SEEKING") break;
    }
    expect(forcedSeen + p1Forced).toBeGreaterThan(0);
    expect(forcedOffSeen).toBeGreaterThan(0); // wymuszony rozbłysk, mimo że ręcznie lampa p1 jest zgaszona
    expect(p2.seen(p0)?.lanternOn ?? true).toBe(true); // ręczny stan p0 nietknięty
    expect(phaseOf(p2)).toBe("FINISHED");
    expect(p2.state!.result).toMatchObject({ reason: "TIME_UP", you: "LOSE" });
    expect(p0.state!.result).toMatchObject({ you: "WIN" });
    expect(p1.state!.result).toMatchObject({ you: "WIN" });
    // Po rundzie lampy wracają do stanów ręcznych.
    await until(() => p2.seen(p1)?.lanternForced !== true, "koniec wymuszonych lamp");
    expect(p2.seen(p0)?.lanternOn).toBe(true);
  }, 40000);

  it("8 graczy: zaproszenia, odliczanie 30 s z niedecydentem, izolacja obcego, zakazy i odrzucone żądania spoza ról", async () => {
    const { bots, clock, room } = await setup(8);
    const [host, b1, b2, b3, b4, b5, b6, b7] = bots;
    host.send("hs.start", { seekMinutes: 3 });
    await until(() => bots.slice(1).every((b) => phaseOf(b) === "INVITING"), "zaproszenia dla wszystkich");
    expect(host.state!.lobby!.invited).toBe(7);

    // Spoofing przed startem: obcy nie anuluje i nie odpowiada za nikogo.
    b1.send("hs.cancel");
    b1.send("hs.respond", { accept: true, sessionId: "obca-sesja" });
    b2.send("hs.start", { seekMinutes: 1 });
    await until(() => b2.notices.includes("SESSION_RUNNING"), "druga zabawa odrzucona");
    expect(phaseOf(host)).toBe("INVITING");
    expect(b1.state!.you.invite).toBe("pending");

    // Pierwsza akceptacja uruchamia odliczanie; b1 odmawia; b7 nie odpowiada.
    b1.send("hs.respond", { accept: false });
    b2.send("hs.respond", { accept: true });
    await until(() => host.state!.timer === "join", "odliczanie dołączania");
    for (const b of [b3, b4, b5, b6]) b.send("hs.respond", { accept: true });
    await until(() => host.state!.lobby!.accepted === 5, "pięciu uczestników");
    expect(host.state!.endsInMs).toBeLessThanOrEqual(30_000);
    clock.advance(29_000);
    await delay(120);
    expect(phaseOf(host)).toBe("INVITING"); // b7 nadal się zastanawia
    clock.advance(1_500);
    await until(() => phaseOf(host) === "HIDING", "koniec odliczania");
    const hiders = [b2, b3, b4, b5, b6];
    expect(host.state!.seek!.total).toBe(5);
    expect(roleOf(b7)).toBeNull();
    expect(roleOf(b1)).toBeNull();

    // Izolacja grupy: obcy (b1, b7) nie widzą nikogo z zabawy i vice versa; uczestnicy widzą się nawzajem (szukający nie widzi ukrywających się).
    await delay(150);
    for (const outsider of [b1, b7]) {
      expect(outsider.sees(host)).toBe(false);
      for (const h of hiders) expect(outsider.sees(h)).toBe(false);
      expect(outsider.sees(b1 === outsider ? b7 : b1)).toBe(true);
    }
    for (const h of hiders) {
      expect(host.sees(h)).toBe(false);
      expect(h.sees(host)).toBe(true);
      expect(h.sees(b1)).toBe(false);
      expect(h.sees(b7)).toBe(false);
      expect(h.sees(hiders.find((x) => x !== h)!)).toBe(true);
      expect(h.seen(hiders.find((x) => x !== h)!)?.mini).toBe("hider");
    }
    // Serwer liczy wszystkich online niezależnie od filtra.
    expect(host.snapshot.online).toBe(8);

    // Spoof w trakcie: obcy i ukrywający nie anulują, nie kończą ani nie „znajdują”.
    b7.send("hs.cancel");
    b7.send("hs.found", { requestId: 1 });
    b7.send("hs.hide");
    b2.send("hs.cancel");
    b2.send("hs.found", { requestId: 1 });
    b2.send("hs.respond", { accept: false });
    host.send("hs.hide");
    host.send("hs.respond", { accept: true });
    host.send("hs.presence", "nie-obiekt");
    host.send("hs.found", { requestId: 1 }); // faza HIDING: ignorowane
    await delay(200);
    expect(phaseOf(host)).toBe("HIDING");
    expect(roleOf(host)).toBe("SEEKER");
    expect(roleOf(b2)).toBe("HIDER_MOVING");
    expect(host.state!.seek!.failed).toBe(0);

    // Zakaz zmian świata: uczestnik nie zbiera i nie buduje; obcy z poprawnym formatem trafia do zwykłej walidacji (bez zapisu = odrzut).
    const tree = instance.walk.index.all().find((o) => o.kind === "tree")!;
    const cmd = { type: "harvest", objectId: tree.id, at: { x: b2.me()!.x, z: b2.me()!.z } };
    b2.send("worldCommand", { requestId: 1, command: cmd, save: {} });
    await until(() => b2.replies.length > 0, "odpowiedź na komendę świata");
    expect(b2.replies[0].accepted).toBe(false);
    expect(b2.notices).toContain("WORLD_BLOCKED");
    b2.send("worldCommand", { requestId: 2, command: { type: "bridge.build", at: { x: 0, z: 0 } }, save: {} });
    await until(() => b2.replies.length > 1, "odpowiedź: most");
    expect(b2.replies[1].accepted).toBe(false);

    // Wszyscy chowają się w miejscu startu.
    for (const h of hiders) {
      h.stand(h.here().x, h.here().z);
    }
    await delay(80);
    for (const h of hiders) h.send("hs.hide");
    await until(() => phaseOf(host) === "SEEKING", "poszukiwania");
    expect(host.state!.areas).toHaveLength(5);
    // Każda kryjówka leży w dokładnie jednym obszarze, ale żaden obszar nie jest jej dokładną pozycją.
    for (const h of hiders) {
      const spot = h.here();
      const covering = host.state!.areas!.filter((a) => Math.hypot(a.x - spot.x, a.z - spot.z) <= a.r);
      expect(covering.length).toBeGreaterThanOrEqual(1);
      for (const a of host.state!.areas!) expect(Math.hypot(a.x - spot.x, a.z - spot.z)).toBeGreaterThan(0.01);
    }
    // Brak wycieku: widok szukającego nie zawiera pozycji kryjówek (tylko obszary z nieprzejrzystymi identyfikatorami).
    const payload = JSON.stringify(host.state);
    for (const h of hiders) expect(payload).not.toContain(h.id);
    expect(room.hs.session!.phase).toBe("SEEKING");

    // Rezygnacja ukrywającego (świadoma): obszar znika, rola WITHDRAWN, runda trwa.
    b6.send("hs.withdraw");
    await until(() => host.state!.areas!.length === 4, "obszar po rezygnacji");
    expect(roleOf(b6)).toBe("WITHDRAWN");
    expect(host.state!.seek!.total).toBe(4);
    await until(() => b6.sees(b1), "wycofany wraca do świata");
  }, 40000);

  it("rozłączenia: reconnect z tokenem w okresie łaski, wycofanie po jego upływie, rozłączony szukający anuluje (nie daje wygranej)", async () => {
    const { bots, clock, room } = await setup(3);
    const [p0, p1, p2] = bots;
    p2.send("hs.start", { seekMinutes: 5 });
    await until(() => phaseOf(p0) === "INVITING" && phaseOf(p1) === "INVITING", "zaproszenia");
    p0.send("hs.respond", { accept: true });
    p1.send("hs.respond", { accept: true });
    await until(() => phaseOf(p2) === "HIDING", "chowanie");

    // p0 traci połączenie: zostaje duchem i wraca z tokenem (ten sam gracz, ta sama rola, ta sama pozycja).
    const token = p0.token;
    const id = p0.id;
    const posBefore = p0.me()!;
    p0.drop();
    await delay(250);
    expect(room.hs.online()).toBe(2);
    expect(p1.sees(p0)).toBe(true); // duch w okresie łaski
    clock.advance(5000);
    const back = await Bot.join(p0.endpoint, p0.roomId, token);
    bots[0] = back;
    expect(back.id).toBe(id);
    expect(back.welcome.hs?.you.role).toBe("HIDER_MOVING");
    expect(back.welcome.hs?.phase).toBe("HIDING");
    back.send("hs.presence", { inForest: true });
    await delay(150);
    expect(back.me()).toMatchObject({ x: posBefore.x, z: posBefore.z });
    expect(room.hs.online()).toBe(3);
    // Podszywanie się: obcy token nie przejmuje tożsamości.
    const stranger = await Bot.join(p0.endpoint, p0.roomId, "to-nie-jest-token-wydany-przez-serwer");
    bots.push(stranger);
    expect(stranger.id).not.toBe(id);
    expect(stranger.welcome.hs).toBeNull();

    // p1 znika na dobre: po 20 s zostaje wycofany, a chowanie kończy się, gdy zostali sami zablokowani.
    back.stand(-100, 0);
    await delay(60);
    back.send("hs.hide");
    await until(() => roleOf(back) === "HIDER_LOCKED", "kryjówka po powrocie");
    p1.drop();
    await delay(250);
    clock.advance(10_000);
    await delay(150);
    expect(phaseOf(p2)).toBe("HIDING"); // nadal okres łaski
    clock.advance(11_000);
    await until(() => phaseOf(p2) === "SEEKING", "wycofanie rozłączonego i start poszukiwań");
    expect(p2.state!.seek!.total).toBe(1);
    await until(() => room.hs.online() === 3 && ![...room["players"].values()].some((p: Player) => p.playerId === p1.id), "usunięcie ducha");

    // Szukający traci połączenie: po okresie łaski runda jest ANULOWANA - ukrywający nie dostają wygranej.
    p2.drop();
    await delay(250);
    clock.advance(10_000);
    await delay(120);
    expect(phaseOf(back)).toBe("SEEKING");
    clock.advance(11_000);
    await until(() => phaseOf(back) === "CANCELLED", "anulowanie po utracie szukającego");
    expect(back.state!.result).toMatchObject({ reason: "SEEKER_LEFT", you: "CANCELLED" });
    expect(back.state!.you.restricted).toBe(false);
    await until(() => back.sees(stranger), "koniec izolacji po anulowaniu");
  }, 40000);

  it("świadome wyjście ukrywającego to rezygnacja od razu; gdy zabraknie uczestników, sesja jest anulowana", async () => {
    const { bots, room } = await setup(2);
    const [p0, p1] = bots;
    p1.send("hs.start", { seekMinutes: 1 });
    await until(() => phaseOf(p0) === "INVITING", "zaproszenie");
    p0.send("hs.respond", { accept: true });
    await until(() => phaseOf(p1) === "HIDING", "chowanie");
    await p0.room.leave(); // świadome opuszczenie pokoju
    await until(() => phaseOf(p1) === "CANCELLED", "anulowanie: zabrakło uczestników");
    expect(p1.state!.result).toMatchObject({ reason: "NO_PLAYERS", you: "CANCELLED" });
    expect(room.hs.online()).toBe(1);
  }, 20000);

  it("brak innych graczy: serwer nie tworzy zabawy; wyjście z lasu w trakcie zaproszenia anuluje organizatora; wyłączenie przez organizatora", async () => {
    const { bots, room } = await setup(2);
    const [p0, p1] = bots;
    p0.send("hs.presence", { inForest: false });
    await delay(80);
    p1.send("hs.start", { seekMinutes: 5 });
    await until(() => p1.notices.includes("NO_PLAYERS"), "brak graczy do zaproszenia");
    expect(room.hs.session).toBeNull();
    p0.send("hs.start", { seekMinutes: 5 }); // p0 nie jest w lesie
    await until(() => p0.notices.includes("NOT_IN_FOREST"), "poza lasem");
    p0.send("hs.presence", { inForest: true });
    await delay(80);
    p1.send("hs.start", { seekMinutes: 99 }); // poza zakresem: serwer przytnie do 15
    await until(() => phaseOf(p0) === "INVITING", "zaproszenie");
    expect(p1.state!.config.seekMinutes).toBe(15);
    p0.send("hs.respond", { accept: true });
    await until(() => phaseOf(p1) === "HIDING", "chowanie");
    p1.send("hs.cancel");
    await until(() => phaseOf(p0) === "CANCELLED", "anulowanie przez organizatora");
    expect(p0.state!.result).toMatchObject({ reason: "HOST_CANCELLED", you: "CANCELLED" });
    expect(p1.state!.result).toMatchObject({ reason: "HOST_CANCELLED", you: "CANCELLED" });
  }, 20000);

  it("bez zabawy gra działa jak dotąd: migawki bez filtra i bez oznaczeń, zwykłe kolizje", async () => {
    const { bots } = await setup(3);
    await delay(200);
    for (const b of bots) {
      expect(b.snapshot.players).toHaveLength(3);
      expect(b.snapshot.players.every((p) => p.mini === undefined && p.lanternForced === undefined)).toBe(true);
      expect(b.snapshot.online).toBe(3);
      expect(b.state).toBeNull();
    }
  }, 15000);
});
