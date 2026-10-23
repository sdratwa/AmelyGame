import { describe, expect, it } from "vitest";
import { AREA_EDGE_MARGIN, generateSearchArea, shuffled } from "./areas";
import { DEFAULT_HIDESEEK_CONFIG, LAMP_OFF_SECONDS, LAMP_ON_SECONDS, resolveConfig } from "./config";
import { GATE_TOLERANCE, gateAcceptsMotion } from "./gate";
import { LampSchedule } from "./lamps";
import { BOUNDS, seeded } from "./testkit";
import { FREE_GATE, miniOfRole, type MovementGate } from "./types";
import { bodiesCollide, minimapMarkerVisible, playerLabelVisible, relationBetween } from "./visibility";

describe("obszar poszukiwań", () => {
  it("zawsze zawiera kryjówkę, ma promień 50 m i nie leży na środku", () => {
    const rng = seeded(1);
    let nearCenter = 0;
    let beyondHalf = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const hide = { x: (rng() - 0.5) * 300, z: (rng() - 0.5) * 300 };
      const a = generateSearchArea(rng, hide, 50, BOUNDS);
      const d = Math.hypot(a.x - hide.x, a.z - hide.z);
      expect(a.r).toBe(50);
      expect(d).toBeLessThanOrEqual(50 * AREA_EDGE_MARGIN + 1e-9);
      if (d < 1) nearCenter++;
      if (d > 25) beyondHalf++;
    }
    expect(nearCenter / N).toBeLessThan(0.01);
    // Rozkład powierzchniowy: ok. 75% przesunięć jest dalszych niż pół promienia.
    expect(beyondHalf / N).toBeGreaterThan(0.6);
  });

  it("kryjówka bywa przy każdej krawędzi okręgu (lewa, prawa, góra, dół)", () => {
    const rng = seeded(2);
    const sides = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const a = generateSearchArea(rng, { x: 0, z: 0 }, 50, BOUNDS);
      if (Math.hypot(a.x, a.z) < 30) continue;
      sides.add(Math.abs(a.x) > Math.abs(a.z) ? (a.x > 0 ? "hide-left" : "hide-right") : a.z > 0 ? "hide-up" : "hide-down");
    }
    expect(sides.size).toBe(4);
  });

  it("w rogu mapy okrąg nadal zawiera kryjówkę i nie zdradza jej środkiem", () => {
    const rng = seeded(3);
    let centered = 0;
    for (let i = 0; i < 2000; i++) {
      const hide = { x: 149.5, z: -149.5 };
      const a = generateSearchArea(rng, hide, 50, BOUNDS);
      expect(Math.hypot(a.x - hide.x, a.z - hide.z)).toBeLessThanOrEqual(50);
      if (Math.hypot(a.x - hide.x, a.z - hide.z) < 1) centered++;
      expect(a.x).toBeLessThanOrEqual(BOUNDS.maxX + 25);
      expect(a.z).toBeGreaterThanOrEqual(BOUNDS.minZ - 25);
    }
    expect(centered / 2000).toBeLessThan(0.02);
  });

  it("jest deterministyczny dla tego samego ziarna", () => {
    const a = generateSearchArea(seeded(9), { x: 10, z: 10 }, 50, BOUNDS);
    const b = generateSearchArea(seeded(9), { x: 10, z: 10 }, 50, BOUNDS);
    expect(a).toEqual(b);
  });

  it("tasowanie zachowuje elementy", () => {
    const s = shuffled([1, 2, 3, 4, 5], seeded(4));
    expect([...s].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("harmonogram lampy", () => {
  it("rozbłysk 2-3 s, przerwa 5-10 s (z dowolnym ziarnem)", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const lamp = new LampSchedule(seeded(seed), 0);
      let prev = lamp.on;
      let since = 0;
      const on: number[] = [];
      const off: number[] = [];
      for (let t = 0; t <= 200_000; t += 50) {
        const now = lamp.advance(t);
        if (now !== prev) {
          (prev ? on : off).push(t - since);
          since = t;
          prev = now;
        }
      }
      expect(on.length).toBeGreaterThan(5);
      for (const d of on) {
        expect(d).toBeGreaterThanOrEqual(LAMP_ON_SECONDS[0] * 1000 - 50);
        expect(d).toBeLessThanOrEqual(LAMP_ON_SECONDS[1] * 1000 + 50);
      }
      for (const d of off.slice(1)) {
        expect(d).toBeGreaterThanOrEqual(LAMP_OFF_SECONDS[0] * 1000 - 50);
        expect(d).toBeLessThanOrEqual(LAMP_OFF_SECONDS[1] * 1000 + 50);
      }
    }
  });

  it("harmonogramy graczy mają niezależne fazy", () => {
    const rng = seeded(5);
    const lamps = Array.from({ length: 6 }, () => new LampSchedule(rng, 0));
    const firstOn = lamps.map((l) => {
      for (let t = 0; t < 30_000; t += 50) if (l.advance(t)) return t;
      return -1;
    });
    expect(new Set(firstOn).size).toBeGreaterThan(3);
  });
});

describe("konfiguracja zatwierdzana przez serwer", () => {
  it("klient ustawia tylko czas poszukiwań (1-15 min); reszta pochodzi z domyślnych", () => {
    const c = resolveConfig({ seekMinutes: 9, findDistance: 100, maxFailed: 99, areaRadius: 1 }, false);
    expect(c.seekMinutes).toBe(9);
    expect(c.findDistance).toBe(DEFAULT_HIDESEEK_CONFIG.findDistance);
    expect(c.maxFailed).toBe(3);
    expect(c.areaRadius).toBe(50);
    expect(resolveConfig({ seekMinutes: 99 }, false).seekMinutes).toBe(15);
    expect(resolveConfig({ seekMinutes: -3 }, false).seekMinutes).toBe(1);
    expect(resolveConfig({ seekMinutes: "5" }, false).seekMinutes).toBe(5);
    expect(resolveConfig(null, false)).toEqual(DEFAULT_HIDESEEK_CONFIG);
  });

  it("tryb deweloperski przycina parametry do bezpiecznych granic", () => {
    const c = resolveConfig({ findDistance: 100, maxFailed: 99, areaRadius: 1, joinSeconds: 5, hideSeconds: "x" }, true);
    expect(c.findDistance).toBe(10);
    expect(c.maxFailed).toBe(10);
    expect(c.areaRadius).toBe(10);
    expect(c.joinSeconds).toBe(5);
    expect(c.hideSeconds).toBe(60);
  });

  it("wartości domyślne zgodne ze specyfikacją", () => {
    expect(DEFAULT_HIDESEEK_CONFIG).toMatchObject({ seekMinutes: 5, joinSeconds: 30, hideSeconds: 60, maxFailed: 3, areaRadius: 50, findDistance: 3, lampHintSeconds: 30 });
  });
});

describe("bramka ruchu", () => {
  const anchored: MovementGate = { anchor: { x: 10, z: 20 }, allowJump: true, allowCrouch: true, allowLook: true, cameraDown: false };
  const prev = { crouching: false, jumpSequence: 3 };
  const at = { x: 10, z: 20, vx: 0, vz: 0, crouching: false, jumpSequence: 3 };

  it("zatwierdzony ukrywający nie zmienia x/z, ale może skakać pionowo i kucać", () => {
    expect(gateAcceptsMotion(anchored, at, prev)).toEqual({ ok: true });
    expect(gateAcceptsMotion(anchored, { ...at, jumpSequence: 4, crouching: true }, prev)).toEqual({ ok: true });
    expect(gateAcceptsMotion(anchored, { ...at, x: 10 + GATE_TOLERANCE * 2 }, prev)).toEqual({ ok: false, reason: "moved" });
    expect(gateAcceptsMotion(anchored, { ...at, z: 25 }, prev)).toEqual({ ok: false, reason: "moved" });
    expect(gateAcceptsMotion(anchored, { ...at, vx: 3 }, prev)).toEqual({ ok: false, reason: "velocity" });
  });

  it("szukający w HIDING nie skacze i nie kuca", () => {
    const seeker: MovementGate = { anchor: { x: 10, z: 20 }, allowJump: false, allowCrouch: false, allowLook: false, cameraDown: true };
    expect(gateAcceptsMotion(seeker, { ...at, jumpSequence: 4 }, prev)).toEqual({ ok: false, reason: "jumped" });
    expect(gateAcceptsMotion(seeker, { ...at, crouching: true }, prev)).toEqual({ ok: false, reason: "crouched" });
    expect(gateAcceptsMotion(seeker, at, prev).ok).toBe(true);
  });

  it("wolna bramka niczego nie ogranicza", () => {
    expect(gateAcceptsMotion(FREE_GATE, { ...at, x: 500, vx: 9, jumpSequence: 9 }, prev).ok).toBe(true);
  });
});

describe("widoczność, kolizje i etykiety", () => {
  it("bez aktywnej zabawy wszyscy widzą wszystkich (OFF = normalna gra)", () => {
    for (const phase of ["INACTIVE", "INVITING", "FINISHED", "CANCELLED"] as const) {
      expect(relationBetween(phase, "SEEKER", null)).toEqual({ visible: true, collides: true });
      expect(relationBetween(phase, null, "HIDER_LOCKED")).toEqual({ visible: true, collides: true });
    }
  });

  it("uczestnicy i osoby spoza zabawy są dla siebie niewidoczni i bez kolizji", () => {
    for (const phase of ["HIDING", "SEEKING"] as const) {
      for (const role of ["SEEKER", "HIDER_MOVING", "HIDER_LOCKED", "HIDER_FOUND"] as const) {
        expect(relationBetween(phase, role, null)).toEqual({ visible: false, collides: false });
        expect(relationBetween(phase, null, role)).toEqual({ visible: false, collides: false });
      }
      expect(relationBetween(phase, null, "WITHDRAWN")).toEqual({ visible: true, collides: true });
      expect(relationBetween(phase, "WITHDRAWN", null)).toEqual({ visible: true, collides: true });
    }
  });

  it("szukający nie widzi ukrytych w HIDING, ale widzi w SEEKING; ukryci widzą szukającego", () => {
    expect(relationBetween("HIDING", "SEEKER", "HIDER_MOVING").visible).toBe(false);
    expect(relationBetween("HIDING", "SEEKER", "HIDER_LOCKED").visible).toBe(false);
    expect(relationBetween("SEEKING", "SEEKER", "HIDER_LOCKED").visible).toBe(true);
    expect(relationBetween("HIDING", "HIDER_MOVING", "SEEKER").visible).toBe(true);
  });

  it("znalezieni nie kolidują z nikim z grupy, więc nie przeszkadzają szukającemu", () => {
    expect(bodiesCollide("SEEKING", "SEEKER", "HIDER_FOUND")).toBe(false);
    expect(bodiesCollide("SEEKING", "HIDER_LOCKED", "HIDER_FOUND")).toBe(false);
    expect(bodiesCollide("SEEKING", "SEEKER", "HIDER_LOCKED")).toBe(true);
    expect(bodiesCollide("HIDING", "SEEKER", "HIDER_LOCKED")).toBe(false);
  });

  it("nazwy ukrywających są niewidoczne niezależnie od ustawień; znaleziony odzyskuje nazwę", () => {
    expect(playerLabelVisible(true, "hider")).toBe(false);
    expect(playerLabelVisible(false, "hider")).toBe(false);
    expect(playerLabelVisible(true, "found")).toBe(true);
    expect(playerLabelVisible(false, "found")).toBe(false);
    expect(playerLabelVisible(true, null)).toBe(true);
    expect(playerLabelVisible(true, undefined)).toBe(true);
    expect(playerLabelVisible(true, "seeker")).toBe(true);
  });

  it("minimapa: ukryci nigdy, znalezieni i zwykli gracze tak", () => {
    expect(minimapMarkerVisible("hider")).toBe(false);
    expect(minimapMarkerVisible("seeker")).toBe(false);
    expect(minimapMarkerVisible("found")).toBe(true);
    expect(minimapMarkerVisible(null)).toBe(true);
    expect(minimapMarkerVisible(undefined)).toBe(true);
  });

  it("rola -> oznaczenie zewnętrzne", () => {
    expect(miniOfRole("HIDER_LOCKED")).toBe("hider");
    expect(miniOfRole("HIDER_MOVING")).toBe("hider");
    expect(miniOfRole("HIDER_FOUND")).toBe("found");
    expect(miniOfRole("SEEKER")).toBe("seeker");
    expect(miniOfRole("WITHDRAWN")).toBeNull();
    expect(miniOfRole(null)).toBeNull();
  });
});

describe("ograniczenia uczestnika i teksty", () => {
  it("komendy questowe i zmieniające świat są zablokowane, wejście do lasu (wznowienie) i lampa nie", async () => {
    const { blockedDuringGame } = await import("./restrictions");
    for (const type of ["harvest", "bridge.build", "chest.open", "chest.take", "troll.talk", "troll.choose", "riddle.answer", "quest.accept", "leave"]) {
      expect(blockedDuringGame({ type })).toBe(true);
    }
    expect(blockedDuringGame({ type: "enter", view: "forest" })).toBe(false);
    expect(blockedDuringGame({ type: "enter", view: "world" })).toBe(true);
    for (const type of ["lantern.toggle", "select", "eat", "tick", "forest.pose"]) expect(blockedDuringGame({ type })).toBe(false);
  });

  it("teksty końcowe zgodne ze specyfikacją i jednoznaczne oznaczenie wyniku", async () => {
    const { resultText } = await import("./texts");
    const base = {
      rev: 1, sessionId: "s", hostName: "A", phase: "FINISHED" as const, endsInMs: null, timer: null, lobby: null, seek: null, areas: null,
      gate: FREE_GATE, config: { seekMinutes: 5, hideSeconds: 60, joinSeconds: 30, maxFailed: 3, areaRadius: 50, findDistance: 3 },
    };
    const you = (isHost: boolean) => ({ role: null, invite: isHost ? ("host" as const) : ("accepted" as const), isHost, autoLocked: false, restricted: false });
    const make = (isHost: boolean, outcome: "WIN" | "LOSE" | "WITHDRAWN" | "CANCELLED", reason: "ALL_FOUND" | "TIME_UP" | "HOST_CANCELLED") => ({
      ...base, you: you(isHost), result: { reason, outcomes: [], you: outcome },
    });
    expect(resultText(make(true, "WIN", "ALL_FOUND"))).toMatchObject({ title: "WSPANIALE! WSZYSCY ODNALEZIENI!", badge: "ZWYCIĘSTWO" });
    expect(resultText(make(true, "LOSE", "TIME_UP"))).toMatchObject({ title: "TYM RAZEM KRYJÓWKI WYGRAŁY!", badge: "PORAŻKA" });
    expect(resultText(make(false, "WIN", "TIME_UP"))).toMatchObject({ title: "NIE DO ZNALEZIENIA!", badge: "ZWYCIĘSTWO" });
    expect(resultText(make(false, "LOSE", "ALL_FOUND"))).toMatchObject({ title: "ZNALEZIONO CIĘ — DOBRA ZABAWA!", badge: "PORAŻKA" });
    expect(resultText(make(false, "CANCELLED", "HOST_CANCELLED"))?.badge).toBe("ANULOWANO");
    expect(resultText(make(false, "WITHDRAWN", "TIME_UP"))).toBeNull();
  });

  it("menu: uczestnik może zrezygnować, organizator anulować, zaproszony bez odpowiedzi nic", async () => {
    const { resignKindOf } = await import("./clientState");
    const v = (phase: "INVITING" | "HIDING" | "SEEKING" | "FINISHED", role: "SEEKER" | "HIDER_MOVING" | "WITHDRAWN" | null, invite: "host" | "pending" | "accepted" | "declined") =>
      ({ phase, you: { role, invite, isHost: invite === "host", autoLocked: false, restricted: false } }) as never;
    expect(resignKindOf(null)).toBeNull();
    expect(resignKindOf(v("SEEKING", "SEEKER", "host"))).toBe("cancel");
    expect(resignKindOf(v("HIDING", "HIDER_MOVING", "accepted"))).toBe("withdraw");
    expect(resignKindOf(v("INVITING", null, "pending"))).toBeNull();
    expect(resignKindOf(v("INVITING", null, "accepted"))).toBe("withdraw");
    expect(resignKindOf(v("SEEKING", "WITHDRAWN", "accepted"))).toBeNull();
    expect(resignKindOf(v("FINISHED", "SEEKER", "host"))).toBeNull();
  });
});
