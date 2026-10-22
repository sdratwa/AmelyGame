import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ForestRoom } from "./ForestRoom";
export function createServer() {
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
  });
  server.define("forest", ForestRoom).filterBy(["worldInstanceId"]);
  return server;
}
