import { describe, expect, it } from "vitest";
import { HideSeekClientState } from "./clientState";
import { FREE_GATE, type HsStateView } from "./types";

const view = (over: Partial<HsStateView> = {}): HsStateView => ({
  rev: 1,
  sessionId: "s1",
  hostName: "Gracz A",
  phase: "HIDING",
  you: { role: "HIDER_MOVING", invite: "accepted", isHost: false, autoLocked: false, restricted: true },
  endsInMs: 60_000,
  timer: "hide",
  lobby: null,
  seek: null,
  areas: null,
  gate: { anchor: { x: 1, z: 2 }, allowJump: false, allowCrouch: false, allowLook: false, cameraDown: true },
  config: { seekMinutes: 5, hideSeconds: 60, joinSeconds: 30, maxFailed: 3, areaRadius: 50, findDistance: 3 },
  result: null,
  ...over,
});

describe("klient: stan zabawy", () => {
  it("spóźniony pakiet z mniejszym rev nie cofa stanu, nowa sesja zawsze wygrywa", () => {
    const hs = new HideSeekClientState(() => 0);
    expect(hs.accept(view({ rev: 5, phase: "SEEKING" }))).toBe(true);
    expect(hs.accept(view({ rev: 4, phase: "HIDING" }))).toBe(false);
    expect(hs.accept(view({ rev: 5, phase: "HIDING" }))).toBe(false);
    expect(hs.phase).toBe("SEEKING");
    expect(hs.accept(view({ rev: 1, sessionId: "s2", phase: "INVITING" }))).toBe(true);
    expect(hs.phase).toBe("INVITING");
  });

  it("czas do końca fazy liczy się z zegara klienta z poprawką na opóźnienie (RTT/2)", () => {
    let now = 1000;
    const hs = new HideSeekClientState(() => now, () => 200);
    hs.accept(view({ endsInMs: 10_000 }));
    expect(hs.remainingMs()).toBe(9900);
    now += 4000;
    expect(hs.remainingMs()).toBe(5900);
    now += 100_000;
    expect(hs.remainingMs()).toBe(0);
  });

  it("bramka obowiązuje tylko w aktywnych fazach", () => {
    const hs = new HideSeekClientState(() => 0);
    expect(hs.gate).toBe(FREE_GATE);
    hs.accept(view());
    expect(hs.gate.cameraDown).toBe(true);
    expect(hs.restricted).toBe(true);
    hs.accept(view({ rev: 2, phase: "FINISHED", gate: FREE_GATE, you: { role: "HIDER_LOCKED", invite: "accepted", isHost: false, autoLocked: false, restricted: false } }));
    expect(hs.gate).toBe(FREE_GATE);
    expect(hs.running).toBe(false);
  });

  it("zamknięty ekran wyniku nie wraca po powtórnym pakiecie, a korekta jest jednorazowa", () => {
    const hs = new HideSeekClientState(() => 0);
    hs.accept(view({ phase: "FINISHED" }));
    hs.dismiss();
    expect(hs.view).toBeNull();
    expect(hs.accept(view({ rev: 9, phase: "FINISHED" }))).toBe(false);
    hs.setCorrection(1, 2, 3);
    expect(hs.takeCorrection()).toMatchObject({ x: 1, y: 2, z: 3 });
    expect(hs.takeCorrection()).toBeNull();
  });
});

describe("klient: banery z przejść stanu", () => {
  it("zdarzenia i przejścia faz dają komunikaty z treścią ze specyfikacji i wygasają po czasie", () => {
    let now = 0;
    const hs = new HideSeekClientState(() => now);
    hs.accept(view());
    expect(hs.activeBanner()?.title).toBe("CZAS SIĘ SCHOWAĆ!");
    hs.accept(view({ rev: 2, you: { role: "HIDER_LOCKED", invite: "accepted", isHost: false, autoLocked: false, restricted: true } }));
    expect(hs.activeBanner()?.title).toBe("KRYJÓWKA GOTOWA!");
    hs.pushEvent({ kind: "found", by: "Gracz A" });
    expect(hs.activeBanner()?.title).toBe("UDAŁO SIĘ CIĘ ODNALEŹĆ!");
    hs.pushEvent({ kind: "miss", failed: 1, max: 3 });
    expect(hs.activeBanner()?.title).toBe("JESZCZE NIE TUTAJ!");
    hs.pushEvent({ kind: "miss", failed: 2, max: 3 });
    expect(hs.activeBanner()?.title).toBe("UWAŻAJ, OSTATNIA PRÓBA!");
    now += 10_000;
    expect(hs.activeBanner()).toBeNull();
  });

  it("szukający dostaje baner ostatnich 30 sekund dokładnie raz", () => {
    const hs = new HideSeekClientState(() => 0);
    const seeker = { role: "SEEKER" as const, invite: "host" as const, isHost: true, autoLocked: false, restricted: true };
    hs.accept(view({ rev: 1, phase: "SEEKING", you: seeker, seek: { total: 2, found: 0, failed: 0, maxFailed: 3, lastThirty: false } }));
    expect(hs.activeBanner()?.title).toBe("SZUKAMY!");
    hs.accept(view({ rev: 2, phase: "SEEKING", you: seeker, seek: { total: 2, found: 0, failed: 0, maxFailed: 3, lastThirty: true } }));
    expect(hs.activeBanner()?.title).toBe("OSTATNIE 30 SEKUND!");
    const id = hs.activeBanner()!.id;
    hs.accept(view({ rev: 3, phase: "SEEKING", you: seeker, seek: { total: 2, found: 1, failed: 0, maxFailed: 3, lastThirty: true } }));
    expect(hs.activeBanner()!.id).toBe(id);
  });
});
