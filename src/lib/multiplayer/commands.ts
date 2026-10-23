import { applyCommand, reducer, type Command } from "../game/core/apply";
import type { GameState } from "../game/core/state";
import { serializeState } from "../game/save/serialize";
import type { MultiplayerClient } from "./client";
import { isWorldCommand, type SharedWorld } from "./sharedWorld";
import { blockedDuringGame } from "../hideseek/restrictions";

/** Serialize local changes while a shared transaction is awaiting the room's decision. */
export class GameCommands {
  private pending = false;
  private idleListeners: (() => void)[] = [];
  get current() { return this.state; }
  whenIdle(): Promise<void> {
    return this.pending ? new Promise((resolve) => this.idleListeners.push(resolve)) : Promise.resolve();
  }
  private queue: Command[] = [];
  private world: SharedWorld | null = null;
  constructor(private state: GameState, private publish: (state: GameState) => void, private client?: MultiplayerClient) {}
  sync = (world: SharedWorld) => {
    this.world = world;
    if (!this.pending) this.apply({ type: "world.sync", world });
  };
  private apply(command: Command) {
    this.state = reducer(this.state, command);
    if (command.type === "game.load" && this.world) this.state = reducer(this.state, { type: "world.sync", world: this.world });
    this.publish(this.state);
  }
  dispatch = (command: Command): void => {
    // Zabawa w chowanego: uczestnik nie wykonuje komend questowych ani zmieniających świat (serwer pilnuje wspólnego świata).
    if (this.client?.hs.restricted && blockedDuringGame(command)) {
      this.client.hs.setNotice("WORLD_BLOCKED");
      return;
    }
    if (this.pending) {
      this.queue.push(command);
      return;
    }
    if (!this.client || !isWorldCommand(command)) { this.apply(command); return; }
    if (this.client.status !== "połączony") {
      this.client.notice = "Połącz się z serwerem, aby zmieniać świat.";
      return;
    }
    const preview = applyCommand(this.state, command);
    if (!preview.events.some((e) => e.type === "resource.harvested" || e.type === "bridge.built")) {
      this.apply(command);
      return;
    }
    const save = serializeState(this.state, 0);
    if (!save) return;
    this.pending = true;
    void this.client.requestWorld(command, save).then((reply) => {
      if (reply?.accepted) this.apply(command);
      else this.client!.notice = reply ? "Świat zmienił się przed wykonaniem tej czynności." : "Utracono połączenie. Połącz się ponownie, aby odświeżyć świat.";
      if (reply && (!this.world || reply.world.revision >= this.world.revision)) this.world = reply.world;
      if (this.world) this.apply({ type: "world.sync", world: this.world });
      this.pending = false;
      const queued = this.queue;
      this.queue = [];
      for (const next of queued) this.dispatch(next);
      if (!this.pending) for (const done of this.idleListeners.splice(0)) done();
    });
  };
}
