import { describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import { createServer } from "../../../server/src/server";
import { createInstance } from "./world";
import { PROTOCOL, idleMotion, type Snapshot, type Welcome } from "./protocol";
import { rockSurfaceY } from "../game/world/rockPhysics";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("fizyka skał: serwer Colyseus (klienci Node)", () => {
  it("serwer ignoruje 'stanie' na wysokiej skale i przyjmuje uczciwy skok; drugi klient widzi tylko przyjęty stan", async () => {
    const server = createServer();
    await server.listen(0, "127.0.0.1");
    const address = server.transport.server!.address();
    if (!address || typeof address === "string") throw Error("port");
    const endpoint = `ws://127.0.0.1:${address.port}`;
    const instance = createInstance();
    const options = { worldInstanceId: "rock_room", protocol: PROTOCOL, fingerprint: instance.config.fingerprint };
    await matchMaker.createRoom("forest", { worldInstanceId: "rock_room" });
    const a = await new Client(endpoint).joinById("rock_room", options);
    const b = await new Client(endpoint).joinById("rock_room", options);
    try {
      let seenByB: Snapshot = { players: [], serverTime: 0, worldElapsed: 0 };
      a.onMessage("notice", () => {});
      b.onMessage("notice", () => {});
      a.onMessage("snapshot", () => {});
      b.onMessage("snapshot", (s: Snapshot) => {
        seenByB = s;
      });
      const welcome = new Promise<Welcome>((resolve) => {
        a.onMessage("welcome", resolve);
        a.send("hello");
      });
      const wa = await welcome;
      const me = () => seenByB.players.find((p) => p.playerId === wa.player.playerId);
      await delay(150);
      expect(me()).toMatchObject({ x: wa.player.x, y: wa.player.y, z: wa.player.z });

      // Wysoka (ponad skok) skała z powierzchnią stania z tego samego świata co u klienta.
      const tall = instance.walk.index.all().find((o) => o.rock?.standable && o.rock.height > 2.5)!;
      expect(tall).toBeDefined();
      const tx = tall.x + tall.rock!.topOffset[0];
      const tz = tall.z + tall.rock!.topOffset[1];
      a.send("motion", { ...idleMotion(tx, rockSurfaceY(tall, tx, tz), tz), sequence: 1 });
      await delay(200);
      expect(me()).toMatchObject({ x: wa.player.x, y: wa.player.y, z: wa.player.z });

      // Uczciwy skok w miejscu startu jest przyjęty.
      a.send("motion", { ...idleMotion(wa.player.x + 0.1, wa.player.y + 0.6, wa.player.z), sequence: 2, grounded: false, jumpSequence: 1, animation: "jump" });
      await delay(200);
      expect(me()).toMatchObject({ x: wa.player.x + 0.1, jumpSequence: 1 });
      expect(me()!.y).toBeCloseTo(wa.player.y + 0.6, 6);

      // Wzniesienie ponad limit skoku (cheat) jest zignorowane, stan zostaje jak przyjęty ostatnio.
      a.send("motion", { ...idleMotion(wa.player.x + 0.1, wa.player.y + 4, wa.player.z), sequence: 3, grounded: false, jumpSequence: 1, animation: "jump" });
      await delay(200);
      expect(me()!.y).toBeCloseTo(wa.player.y + 0.6, 6);
    } finally {
      await a.leave();
      await b.leave();
      await server.gracefullyShutdown(false);
    }
  }, 30_000);
});
