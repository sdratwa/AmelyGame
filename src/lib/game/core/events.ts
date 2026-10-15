import type { ItemId } from "../content/items";
import type { View } from "./state";

/**
 * Zdarzenia opisują skutki komend. Są jedynym kanałem informowania warstw
 * zewnętrznych (UI, dźwięk, w przyszłości synchronizacja z serwerem).
 */
export type GameEvent =
  | { type: "game.started"; name: string }
  | { type: "world.ready" }
  | { type: "game.loaded"; saveId: string }
  | { type: "view.entered"; view: View }
  | { type: "view.left"; from: View }
  | { type: "tutorial.completed" }
  | { type: "item.purchased"; item: ItemId; price: number }
  | { type: "item.purchase_failed"; item: ItemId; reason: "inventory_full" | "no_money" }
  | { type: "item.eaten"; item: ItemId; healed: number }
  | { type: "house.bought"; id: string; price: number }
  | { type: "house.upgraded"; id: string; level: number; cost: number }
  | { type: "player.died"; deaths: number }
  | { type: "player.respawned" }
  | { type: "time.pause_changed"; paused: boolean; reasons: string[] };
