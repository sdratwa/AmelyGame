import { describe, expect, it } from "vitest";
import { makeKit, toHiding, toSeeking } from "./testkit";

describe("zaproszenia i dołączanie", () => {
  it("sesja startuje w INVITING, host jest szukającym, zaproszeni trafiają do właściwych graczy", () => {
    const { session } = makeKit(4);
    expect(session.phase).toBe("INVITING");
    expect(session.roleOf("A")).toBe("SEEKER");
    for (const k of ["B", "C", "D"]) expect(session.viewFor(k)?.you.invite).toBe("pending");
    expect(session.viewFor("Z")).toBeNull();
    expect(session.viewFor("A")?.lobby?.roster?.length).toBe(3);
    expect(session.viewFor("B")?.lobby?.roster).toBeNull();
  });

  it("odliczanie 30 s nie startuje bez zaakceptowanego uczestnika i startuje po pierwszym", () => {
    const { session, clock } = makeKit(4);
    expect(session.viewFor("A")?.timer).toBe("invite");
    session.respond("B", false);
    expect(session.viewFor("A")?.timer).toBe("invite");
    session.respond("C", true);
    expect(session.phase).toBe("INVITING");
    const v = session.viewFor("A")!;
    expect(v.timer).toBe("join");
    expect(v.endsInMs).toBe(30_000);
    clock.advance(10_000);
    expect(session.viewFor("A")!.endsInMs).toBe(20_000);
  });

  it("wszyscy przyjmują wcześniej: natychmiast chowanie", () => {
    const { session } = makeKit(3);
    session.respond("B", true);
    expect(session.phase).toBe("INVITING");
    session.respond("C", true);
    expect(session.phase).toBe("HIDING");
    expect(session.roleOf("B")).toBe("HIDER_MOVING");
  });

  it("część odrzuca, reszta odpowiedziała: wcześniejszy start z minimum jednym ukrywającym", () => {
    const { session } = makeKit(4);
    session.respond("B", true);
    session.respond("C", false);
    expect(session.phase).toBe("INVITING");
    session.respond("D", false);
    expect(session.phase).toBe("HIDING");
    expect(session.roleOf("C")).toBeNull();
  });

  it("wszyscy odrzucają: anulowanie, bez sesji dla samego szukającego", () => {
    const { session } = makeKit(3);
    session.respond("B", false);
    session.respond("C", false);
    expect(session.phase).toBe("CANCELLED");
    expect(session.result?.reason).toBe("NOBODY_JOINED");
  });

  it("po 30 s start z tymi, którzy dołączyli; brak odpowiedzi nie powoduje udziału", () => {
    const { session, clock } = makeKit(3);
    session.respond("B", true);
    clock.advance(29_000);
    session.advance();
    expect(session.phase).toBe("INVITING");
    clock.advance(1_000);
    session.advance();
    expect(session.phase).toBe("HIDING");
    expect(session.roleOf("C")).toBeNull();
    expect(session.respond("C", true)).toBe(false);
  });

  it("pierwszy uczestnik wycofuje się przed startem: odliczanie staje, nie ma sesji dla samego szukającego", () => {
    const { session, clock } = makeKit(3);
    session.respond("B", true);
    session.respond("B", false);
    expect(session.viewFor("A")!.timer).toBe("invite");
    clock.advance(31_000);
    session.advance();
    expect(session.phase).toBe("INVITING");
    clock.advance(40_000);
    session.advance();
    expect(session.phase).toBe("CANCELLED");
    expect(session.result?.reason).toBe("NOBODY_JOINED");
  });

  it("organizator może anulować; nieorganizator nie", () => {
    const { session } = makeKit(3);
    expect(session.cancelByHost("B")).toBe(false);
    expect(session.cancelByHost("A")).toBe(true);
    expect(session.phase).toBe("CANCELLED");
  });

  it("zaproszony, który się rozłączył przed odpowiedzią, liczy się jako odrzucenie", () => {
    const { session } = makeKit(3);
    session.respond("B", true);
    session.disconnect("C");
    expect(session.phase).toBe("HIDING");
  });
});

describe("faza chowania", () => {
  it("trwa maksymalnie 60 s i auto-zatwierdza kryjówki w ostatniej stabilnej pozycji", () => {
    const kit = toHiding(makeKit(3));
    const { session, clock, positions } = kit;
    expect(session.phase).toBe("HIDING");
    expect(session.viewFor("B")!.endsInMs).toBe(60_000);
    positions.set("B", { x: 5, y: 1, z: 7 });
    clock.advance(59_999);
    session.advance();
    expect(session.phase).toBe("HIDING");
    clock.advance(1);
    session.advance();
    expect(session.phase).toBe("SEEKING");
    expect(session.roleOf("B")).toBe("HIDER_LOCKED");
    expect(session.spotOf("B")).toMatchObject({ x: 5, y: 1, z: 7 });
    expect(session.viewFor("B")!.you.autoLocked).toBe(true);
  });

  it("wszyscy mają kryjówki: poszukiwania zaczynają się natychmiast", () => {
    const kit = toHiding(makeKit(3));
    kit.session.hide("B", kit.spotFor(1, 1));
    expect(kit.session.phase).toBe("HIDING");
    kit.session.hide("C", kit.spotFor(2, 2));
    expect(kit.session.phase).toBe("SEEKING");
    expect(kit.session.viewFor("B")!.you.autoLocked).toBe(false);
  });

  it("szukający ma zamrożoną pozycję i kamerę w dół; ukrywający może chodzić dopiero do zatwierdzenia", () => {
    const kit = toHiding(makeKit(3));
    const { session } = kit;
    kit.positions.set("A", { x: 0, y: 0, z: 0 });
    const seeker = session.gateFor("A");
    expect(seeker).toMatchObject({ allowJump: false, allowCrouch: false, allowLook: false, cameraDown: true });
    expect(session.gateFor("B").anchor).toBeNull();
    session.hide("B", kit.spotFor(3, 4));
    const locked = session.gateFor("B");
    expect(locked.anchor).toEqual({ x: 3, z: 4 });
    expect(locked).toMatchObject({ allowJump: true, allowCrouch: true, allowLook: true });
  });

  it("nie można zatwierdzić kryjówki poza fazą HIDING, ani dwa razy, ani jako szukający", () => {
    const kit = makeKit(3);
    expect(kit.session.hide("B", kit.spotFor(1, 1))).toEqual({ ok: false, reason: "phase" });
    toHiding(kit);
    expect(kit.session.hide("A", kit.spotFor(1, 1))).toEqual({ ok: false, reason: "role" });
    expect(kit.session.hide("B", kit.spotFor(1, 1)).ok).toBe(true);
    const rev = kit.session.rev;
    expect(kit.session.hide("B", kit.spotFor(9, 9)).ok).toBe(false);
    expect(kit.session.spotOf("B")).toMatchObject({ x: 1, z: 1 });
    expect(kit.session.rev).toBe(rev);
  });
});

describe("faza szukania i ZNALAZŁEM", () => {
  it("czas szukania zaczyna się po chowaniu i wynosi domyślnie 300 s (suwak 1-15 min)", () => {
    const { session } = toSeeking(makeKit(3));
    expect(session.viewFor("A")!.endsInMs).toBe(300_000);
    const kit = toSeeking(makeKit(3, { seekMinutes: 12 }));
    expect(kit.session.viewFor("A")!.endsInMs).toBe(720_000);
  });

  it("odległość < 3 m jest trafieniem, dokładnie 3 m nie, wybierany jest najbliższy", () => {
    const kit = toSeeking(makeKit(4));
    const { session, clock } = kit;
    // B w (20,20), C w (40,20), D w (60,20); y = 0.
    expect(session.found("A", 1, { x: 20, y: 0, z: 23 }).kind).toBe("miss");
    clock.advance(1100);
    expect(session.found("A", 2, { x: 20, y: 0, z: 22.99 }).kind).toBe("hit");
    expect(session.roleOf("B")).toBe("HIDER_FOUND");
    clock.advance(1100);
    expect(session.found("A", 3, { x: 59, y: 0, z: 20 })).toMatchObject({ kind: "hit", hiderKey: "D" });
  });

  it("odległość jest 3D (wysokość się liczy)", () => {
    const { session } = toSeeking(makeKit(2));
    expect(session.found("A", 1, { x: 20, y: 5, z: 20 }).kind).toBe("miss");
  });

  it("kilku w zasięgu: najbliższy; remis rozstrzyga kolejność dołączenia", () => {
    const kit = makeKit(3);
    toHiding(kit);
    kit.session.hide("B", kit.spotFor(10, 0));
    kit.session.hide("C", kit.spotFor(12, 0));
    expect(kit.session.found("A", 1, { x: 11.2, y: 0, z: 0 })).toMatchObject({ kind: "hit", hiderKey: "C" });
  });

  it("duplikat żądania i cooldown nie liczą kolejnej próby", () => {
    const { session, clock } = toSeeking(makeKit(3));
    expect(session.found("A", 5, { x: 0, y: 0, z: 0 }).kind).toBe("miss");
    expect(session.found("A", 5, { x: 0, y: 0, z: 0 })).toEqual({ kind: "ignored", reason: "duplicate" });
    expect(session.found("A", 4, { x: 0, y: 0, z: 0 })).toEqual({ kind: "ignored", reason: "duplicate" });
    expect(session.found("A", 6, { x: 0, y: 0, z: 0 })).toEqual({ kind: "ignored", reason: "cooldown" });
    expect(session.viewFor("A")!.seek!.failed).toBe(1);
    clock.advance(1000);
    expect(session.found("A", 7, { x: 0, y: 0, z: 0 }).kind).toBe("miss");
    expect(session.viewFor("A")!.seek!.failed).toBe(2);
  });

  it("tylko szukający w fazie SEEKING może sprawdzać", () => {
    const kit = toHiding(makeKit(3));
    expect(kit.session.found("A", 1, { x: 0, y: 0, z: 0 })).toEqual({ kind: "ignored", reason: "phase" });
    toSeeking(makeKit(3));
    const s = toSeeking(makeKit(3));
    expect(s.session.found("B", 1, { x: 20, y: 0, z: 20 })).toEqual({ kind: "ignored", reason: "role" });
  });

  it("trzecia błędna próba kończy rundę porażką szukającego; licznik nie resetuje się po znalezieniu", () => {
    const kit = toSeeking(makeKit(4));
    const { session, clock } = kit;
    expect(session.found("A", 1, { x: 0, y: 0, z: 0 })).toMatchObject({ kind: "miss", failed: 1 });
    clock.advance(1100);
    expect(session.found("A", 2, { x: 20, y: 0, z: 20 }).kind).toBe("hit");
    expect(session.viewFor("A")!.seek).toMatchObject({ found: 1, failed: 1 });
    clock.advance(1100);
    expect(session.found("A", 3, { x: 0, y: 0, z: 0 })).toMatchObject({ kind: "miss", failed: 2 });
    clock.advance(1100);
    expect(session.found("A", 4, { x: 0, y: 0, z: 0 })).toMatchObject({ kind: "miss", failed: 3 });
    expect(session.phase).toBe("FINISHED");
    expect(session.result?.reason).toBe("TOO_MANY_MISSES");
    const by = Object.fromEntries(session.result!.outcomes.map((o) => [o.name, o.outcome]));
    expect(by["Gracz A"]).toBe("LOSE");
    expect(by["Gracz B"]).toBe("LOSE"); // znaleziony przegrywa niezależnie od wyniku
    expect(by["Gracz C"]).toBe("WIN");
    expect(by["Gracz D"]).toBe("WIN");
  });

  it("znalezienie wszystkich: szukający wygrywa, ukrywający przegrywają", () => {
    const kit = toSeeking(makeKit(3));
    const { session, clock } = kit;
    session.found("A", 1, { x: 20, y: 0, z: 20 });
    expect(session.phase).toBe("SEEKING");
    clock.advance(1100);
    session.found("A", 2, { x: 40, y: 0, z: 20 });
    expect(session.phase).toBe("FINISHED");
    expect(session.result?.reason).toBe("ALL_FOUND");
    expect(session.viewFor("A")!.result?.you).toBe("WIN");
    expect(session.viewFor("B")!.result?.you).toBe("LOSE");
    expect(session.viewFor("C")!.result?.you).toBe("LOSE");
  });

  it("koniec czasu: szukający przegrywa, nieodnalezieni wygrywają, odnalezieni przegrywają", () => {
    const kit = toSeeking(makeKit(3));
    const { session, clock } = kit;
    session.found("A", 1, { x: 20, y: 0, z: 20 });
    clock.advance(300_000);
    session.advance();
    expect(session.phase).toBe("FINISHED");
    expect(session.result?.reason).toBe("TIME_UP");
    expect(session.viewFor("A")!.result?.you).toBe("LOSE");
    expect(session.viewFor("B")!.result?.you).toBe("LOSE");
    expect(session.viewFor("C")!.result?.you).toBe("WIN");
  });

  it("znaleziony odzyskuje swobodę (bramka), nie jest już celem i nie może ponownie się schować", () => {
    const kit = toSeeking(makeKit(3));
    const { session } = kit;
    session.found("A", 1, { x: 20, y: 0, z: 20 });
    expect(session.gateFor("B").anchor).toBeNull();
    expect(session.hide("B", kit.spotFor(1, 1)).ok).toBe(false);
    expect(session.found("A", 2, { x: 20, y: 0, z: 20 }).kind).not.toBe("hit");
  });

  it("wynik nie zależy od klienta: ukrywający nie może niczego rozstrzygać", () => {
    const kit = toSeeking(makeKit(3));
    expect(kit.session.found("B", 1, { x: 40, y: 0, z: 20 })).toEqual({ kind: "ignored", reason: "role" });
    expect(kit.session.cancelByHost("B")).toBe(false);
    expect(kit.session.phase).toBe("SEEKING");
  });
});

describe("obszary poszukiwań w sesji", () => {
  it("każdy ukryty ma obszar 50 m zawierający kryjówkę; widzi je tylko szukający; znalezienie usuwa właściwy", () => {
    const kit = toSeeking(makeKit(3));
    const { session } = kit;
    const areas = session.viewFor("A")!.areas!;
    expect(areas).toHaveLength(2);
    for (const a of areas) expect(a.r).toBe(50);
    expect(session.viewFor("B")!.areas).toBeNull();
    const contains = (s: { x: number; z: number }) => areas.some((a) => Math.hypot(a.x - s.x, a.z - s.z) <= a.r);
    expect(contains(session.spotOf("B")!)).toBe(true);
    expect(contains(session.spotOf("C")!)).toBe(true);
    expect(JSON.stringify(areas)).not.toMatch(/"key"|"B"|"C"/);
    const stable = JSON.stringify(areas);
    kit.clock.advance(5000);
    session.advance();
    expect(JSON.stringify(session.viewFor("A")!.areas)).toBe(stable);
    session.found("A", 1, { x: 20, y: 0, z: 20 });
    expect(session.viewFor("A")!.areas).toHaveLength(1);
  });

  it("w fazie HIDING szukający nie dostaje żadnych obszarów", () => {
    const kit = toHiding(makeKit(3));
    expect(kit.session.viewFor("A")!.areas).toBeNull();
  });
});

describe("ostatnie 30 sekund: lampy", () => {
  it("lampy nie świecą przed ostatnimi 30 s, potem każdy ukryty ma własny harmonogram 2-3 s / 5-10 s", () => {
    const kit = toSeeking(makeKit(4, {}, 11));
    const { session, clock } = kit;
    clock.advance(269_000);
    session.advance();
    expect(session.lampHintActive).toBe(false);
    expect(session.lampForced("B")).toBe(false);
    expect(session.viewFor("A")!.seek!.lastThirty).toBe(false);
    clock.advance(1_000);
    session.advance();
    expect(session.lampHintActive).toBe(true);
    expect(session.viewFor("A")!.seek!.lastThirty).toBe(true);

    const trace: Record<string, boolean[]> = { B: [], C: [], D: [] };
    for (let t = 0; t < 29_000; t += 100) {
      clock.advance(100);
      session.advance();
      for (const k of Object.keys(trace)) trace[k].push(session.lampForced(k));
    }
    const runs = (xs: boolean[], v: boolean) => {
      const out: number[] = [];
      let n = 0;
      for (let i = 0; i < xs.length; i++) {
        if (xs[i] === v) n++;
        else {
          if (n && i - n > 0) out.push(n * 100);
          n = 0;
        }
      }
      return out;
    };
    for (const k of Object.keys(trace)) {
      expect(trace[k].some(Boolean)).toBe(true);
      for (const ms of runs(trace[k], true)) {
        expect(ms).toBeGreaterThanOrEqual(1900);
        expect(ms).toBeLessThanOrEqual(3100);
      }
      for (const ms of runs(trace[k], false).slice(1)) {
        expect(ms).toBeGreaterThanOrEqual(4900);
        expect(ms).toBeLessThanOrEqual(10_100);
      }
    }
    expect(trace.B.map(Number).join("")).not.toBe(trace.C.map(Number).join(""));
  });

  it("znalezienie, rezygnacja i koniec rundy wyłączają lampę", () => {
    const kit = toSeeking(makeKit(4, {}, 3));
    const { session, clock } = kit;
    clock.advance(271_000);
    session.advance();
    // Szukamy chwili, gdy lampa B świeci.
    let lit = false;
    for (let i = 0; i < 200 && !lit; i++) {
      clock.advance(100);
      lit = session.lampForced("B");
    }
    expect(lit).toBe(true);
    session.found("A", 1, { x: 20, y: 0, z: 20 });
    expect(session.lampForced("B")).toBe(false);
    session.withdraw("C");
    expect(session.lampForced("C")).toBe(false);
    clock.advance(30_000);
    session.advance();
    expect(session.phase).toBe("FINISHED");
    expect(session.lampForced("D")).toBe(false);
    expect(session.lampHintActive).toBe(false);
  });

  it("krótka runda (<= 30 s) uruchamia lampy od razu", () => {
    const kit = toSeeking(makeKit(3, { seekMinutes: 1, lampHintSeconds: 120 }));
    expect(kit.session.lampHintActive).toBe(true);
  });
});

describe("rezygnacje, rozłączenia i reconnect", () => {
  it("ukrywający rezygnuje: nie jest celem, obszar znika, wynik to rezygnacja (nie zwycięstwo)", () => {
    const kit = toSeeking(makeKit(3));
    const { session } = kit;
    expect(session.withdraw("B")).toBe(true);
    expect(session.withdraw("B")).toBe(false);
    expect(session.viewFor("A")!.areas).toHaveLength(1);
    expect(session.gateFor("B").anchor).toBeNull();
    expect(session.isParticipant("B")).toBe(false);
    expect(session.found("A", 1, { x: 20, y: 0, z: 20 }).kind).toBe("miss");
    kit.clock.advance(300_000);
    session.advance();
    const by = Object.fromEntries(session.result!.outcomes.map((o) => [o.name, o.outcome]));
    expect(by["Gracz B"]).toBe("WITHDRAWN");
    expect(by["Gracz C"]).toBe("WIN");
  });

  it("szukający rezygnuje: runda anulowana, nikt nie wygrywa", () => {
    const kit = toSeeking(makeKit(3));
    kit.session.withdraw("A");
    expect(kit.session.phase).toBe("CANCELLED");
    expect(kit.session.result?.reason).toBe("SEEKER_WITHDREW");
    expect(kit.session.result?.outcomes.every((o) => o.outcome === "CANCELLED")).toBe(true);
  });

  it("brak uczestników: sesja anulowana zamiast fikcyjnego zwycięstwa", () => {
    const kit = toSeeking(makeKit(2));
    kit.session.withdraw("B");
    expect(kit.session.phase).toBe("CANCELLED");
    expect(kit.session.result?.reason).toBe("NO_PLAYERS");
  });

  it("ostatni nieodnaleziony rezygnuje po znalezieniu innych: szukający wygrywa (ALL_FOUND)", () => {
    const kit = toSeeking(makeKit(3));
    kit.session.found("A", 1, { x: 20, y: 0, z: 20 });
    kit.session.withdraw("C");
    expect(kit.session.phase).toBe("FINISHED");
    expect(kit.session.result?.reason).toBe("ALL_FOUND");
  });

  it("rozłączenie: w okresie reconnect rola i kryjówka zostają; po nim wycofanie", () => {
    const kit = toSeeking(makeKit(3));
    const { session, clock } = kit;
    session.disconnect("B");
    session.disconnect("B");
    clock.advance(19_000);
    session.advance();
    expect(session.roleOf("B")).toBe("HIDER_LOCKED");
    expect(session.reconnect("B")).toBe(true);
    expect(session.spotOf("B")).toMatchObject({ x: 20, z: 20 });
    expect(session.viewFor("B")!.you.role).toBe("HIDER_LOCKED");
    session.disconnect("B");
    clock.advance(21_000);
    session.advance();
    expect(session.roleOf("B")).toBe("WITHDRAWN");
    expect(session.reconnect("Z")).toBe(false);
  });

  it("szukający rozłączony na dłużej niż grace: anulowanie, a nie wygrana", () => {
    const kit = toSeeking(makeKit(3));
    kit.session.disconnect("A");
    kit.clock.advance(21_000);
    kit.session.advance();
    expect(kit.session.phase).toBe("CANCELLED");
    expect(kit.session.result?.reason).toBe("SEEKER_LEFT");
  });

  it("zdarzenia po końcu sesji są ignorowane i nie zmieniają rewizji", () => {
    const kit = toSeeking(makeKit(2));
    kit.session.cancelByHost("A");
    const rev = kit.session.rev;
    expect(kit.session.withdraw("B")).toBe(false);
    expect(kit.session.respond("B", true)).toBe(false);
    expect(kit.session.found("A", 99, { x: 20, y: 0, z: 20 }).kind).toBe("ignored");
    kit.session.advance();
    expect(kit.session.rev).toBe(rev);
  });
});

describe("izolacja uczestników", () => {
  it("ograniczenia (questy, skrzynie) dotyczą uczestników aktywnych faz, nie osób poza zabawą", () => {
    const kit = makeKit(4);
    kit.session.respond("B", true);
    kit.session.respond("C", false);
    kit.session.respond("D", false);
    expect(kit.session.phase).toBe("HIDING");
    expect(kit.session.isRestricted("A")).toBe(true);
    expect(kit.session.isRestricted("B")).toBe(true);
    expect(kit.session.isRestricted("C")).toBe(false);
    kit.session.cancelByHost("A");
    expect(kit.session.isRestricted("B")).toBe(false);
  });

  it("widoczność: szukający nie widzi ukrywających w HIDING, widzi w SEEKING; spoza zabawy nie widać uczestników", () => {
    const kit = toHiding(makeKit(3));
    const { session } = kit;
    expect(session.relation("A", "B").visible).toBe(false);
    expect(session.relation("B", "A").visible).toBe(true);
    expect(session.relation("B", "C").visible).toBe(true);
    kit.session.hide("B", kit.spotFor(1, 1));
    kit.session.hide("C", kit.spotFor(2, 2));
    expect(session.relation("A", "B").visible).toBe(true);
  });
});
