import { matchMaker } from "@colyseus/core";
import { createServer } from "./server";
const port = Number(process.env.MULTIPLAYER_PORT ?? 2567);
const server = createServer();
server.listen(port, "0.0.0.0").then(async () => {
  await matchMaker.createRoom("forest", { worldInstanceId: "world_001", worldSavePath: process.env.MULTIPLAYER_WORLD_SAVE ?? ".data/multiplayer/world_001.json", migrateWorldV3: process.env.MIGRATE_WORLD_V3 === "1", migrateWorldV4: process.env.MIGRATE_WORLD_V4 === "1" });
  console.log(`Miasto multiplayer: ${port}`);
});
