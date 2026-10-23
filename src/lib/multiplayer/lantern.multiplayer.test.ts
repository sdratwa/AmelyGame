import { describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import { createServer } from "../../../server/src/server";
import { createInstance } from "./world";
import { MultiplayerClient } from "./client";
import { PROTOCOL, idleMotion, validLantern, validMotion, type Snapshot } from "./protocol";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Kolejne wywołania `syncLantern` w teście dostają rosnący zegar, żeby ograniczenie czasowe klienta nie zależało od czasu testu. */
let clock = 1_000_000;
const tick = () => (clock += 1000);

describe("lampa naftowa: protokół", () => {
  it("wiadomość `lantern` to wyłącznie flaga (bez identyfikatorów i parametrów)", () => {
    expect(validLantern({ enabled: true })).toBe(true);
    expect(validLantern({ enabled: false })).toBe(true);
    expect(validLantern({ enabled: "tak" })).toBe(false);
    expect(validLantern({ enabled: 1 })).toBe(false);
    expect(validLantern({})).toBe(false);
    expect(validLantern({ enabled: true, playerId: "x" })).toBe(false);
    expect(validLantern({ enabled: true, intensity: 100 })).toBe(false);
    expect(validLantern(null)).toBe(false);
    expect(validLantern("włącz")).toBe(false);
    expect(validLantern([true])).toBe(false);
    // Protokół 5: zabawa w chowanego (wiadomości `hs.*`, migawki per odbiorca, `resumeToken`). Zmiana 4 -> 5 jest zamierzona.
    expect(PROTOCOL).toBe(5);
  });

  it("ruch nie może przenosić stanu lampy (klucz spoza listy jest odrzucany)", () => {
    expect(validMotion({ ...idleMotion(0, 0, 0), lanternOn: true })).toBe(false);
    expect(validMotion(idleMotion(0, 0, 0))).toBe(true);
  });
});

describe("lampa naftowa: synchronizacja przez serwer (klienci Node)", () => {
  it("A zapala -> B widzi, C dołącza później i widzi, spoofing nie działa, gaszenie, rozłączenie i ponowne połączenie", async () => {
    const server = createServer();
    await server.listen(0, "127.0.0.1");
    const address = server.transport.server!.address();
    if (!address || typeof address === "string") throw Error("port");
    const endpoint = `ws://127.0.0.1:${address.port}`;
    await matchMaker.createRoom("forest", { worldInstanceId: "world_001" });

    const a = new MultiplayerClient();
    const b = new MultiplayerClient();
    const c = new MultiplayerClient();
    const intruder = await new Client(endpoint).joinById("world_001", { worldInstanceId: "world_001", protocol: PROTOCOL, fingerprint: createInstance().config.fingerprint });
    let intruderSnapshot: Snapshot = { players: [], serverTime: 0, worldElapsed: 0 };
    intruder.onMessage("snapshot", (s: Snapshot) => {
      intruderSnapshot = s;
    });
    intruder.onMessage("notice", () => {});
    const lanternOf = (viewer: MultiplayerClient, playerId: string | undefined) => viewer.remote().find((p) => p.playerId === playerId)?.lanternOn;
    const raw = (playerId: string | undefined) => intruderSnapshot.players.find((p) => p.playerId === playerId)?.lanternOn;

    try {
      await a.connect(endpoint);
      await b.connect(endpoint);
      await delay(350);
      const aId = a.local!.playerId;
      const bId = b.local!.playerId;
      expect(a.local!.lanternOn).toBe(false);

      // Początkowo wszystkie lampy zgaszone, dla każdego widza.
      expect(lanternOf(b, aId)).toBe(false);
      expect(lanternOf(a, bId)).toBe(false);

      // A zapala: B widzi `lanternOn = true`, a lampa B pozostaje zgaszona.
      a.syncLantern(true, tick());
      await delay(350);
      expect(lanternOf(b, aId)).toBe(true);
      expect(lanternOf(a, bId)).toBe(false);
      expect(raw(aId)).toBe(true);
      expect(raw(bId)).toBe(false);

      // C dołącza później i od razu widzi zapaloną lampę A (stan jest w zwykłych migawkach).
      await c.connect(endpoint);
      await delay(350);
      expect(lanternOf(c, aId)).toBe(true);
      expect(lanternOf(c, bId)).toBe(false);

      // Obcy klient nie ruszy cudzej lampy: ani wiadomością z cudzym identyfikatorem, ani flagą w ruchu, ani śmieciami.
      intruder.send("lantern", { enabled: true, playerId: bId });
      intruder.send("lantern", { enabled: true, sessionId: b.local!.sessionId });
      intruder.send("lantern", { playerId: bId });
      intruder.send("lantern", { enabled: "tak" });
      intruder.send("lantern", "włącz");
      intruder.send("motion", { ...idleMotion(0, 1, 0), sequence: 1, lanternOn: true });
      await delay(350);
      expect(raw(bId)).toBe(false);
      expect(raw(aId)).toBe(true);
      const intruderId = intruderSnapshot.players.find((p) => p.playerId !== aId && p.playerId !== bId && p.playerId !== c.local!.playerId)?.playerId;
      expect(intruderId).toBeDefined();
      expect(raw(intruderId)).toBe(false);

      // Własna, poprawna wiadomość zmienia tylko nadawcę.
      intruder.send("lantern", { enabled: true });
      await delay(350);
      expect(raw(intruderId)).toBe(true);
      expect(raw(bId)).toBe(false);
      expect(raw(aId)).toBe(true);
      intruder.send("lantern", { enabled: false });

      // Ten sam stan wysłany ponownie nic nie zmienia (idempotentne), a gaszenie dociera do wszystkich.
      a.syncLantern(true, tick());
      a.syncLantern(false, tick());
      await delay(350);
      expect(lanternOf(b, aId)).toBe(false);
      expect(lanternOf(c, aId)).toBe(false);

      // Wielokrotne przełączanie.
      for (const on of [true, false, true]) {
        a.syncLantern(on, tick());
        await delay(120);
      }
      await delay(300);
      expect(lanternOf(b, aId)).toBe(true);
      expect(lanternOf(c, aId)).toBe(true);

      // B zapala własną: stany są niezależne.
      b.syncLantern(true, tick());
      await delay(350);
      expect(lanternOf(a, bId)).toBe(true);
      expect(lanternOf(c, bId)).toBe(true);
      expect(lanternOf(b, aId)).toBe(true);
      b.syncLantern(false, tick());

      // Rozłączenie A: pozostali nie mają już jej źródła światła (gracz znika z listy zdalnych).
      a.disconnect();
      await delay(350);
      expect(b.remote().some((p) => p.playerId === aId)).toBe(false);
      expect(c.remote().some((p) => p.playerId === aId)).toBe(false);

      // Ponowne połączenie: nowy identyfikator, serwer zaczyna od zgaszonej, a klient po ponownym zgłoszeniu stanu lokalnego (włączona) przywraca ją.
      await a.connect(endpoint);
      await delay(350);
      const a2 = a.local!.playerId;
      expect(a2).not.toBe(aId);
      expect(lanternOf(b, a2)).toBe(false);
      a.syncLantern(true, tick());
      await delay(350);
      expect(lanternOf(b, a2)).toBe(true);
      expect(b.remote().filter((p) => p.name === a.local!.name).length).toBe(1);
      expect(b.remote().some((p) => p.playerId === aId)).toBe(false);
    } finally {
      for (const m of [a, b, c]) m.disconnect();
      if (intruder.connection.isOpen) await intruder.leave();
      await delay(100);
      await server.gracefullyShutdown(false);
    }
  }, 30000);
});
