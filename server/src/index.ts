import { matchMaker } from "@colyseus/core";
import { createServer } from "./server";
const port = Number(process.env.MULTIPLAYER_PORT ?? 2567);
const server = createServer();
server.listen(port, "0.0.0.0").then(async () => {
  await matchMaker.createRoom("forest", { worldInstanceId: "world_001" });
  console.log(`Miasto multiplayer: ${port}`);
});
