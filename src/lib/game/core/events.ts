import type { ItemId, ItemStack } from "../content/items";
import type { BadgeId, ChestId, QuestId, RegionId, RiddleId } from "./ids";
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
  | { type: "item.discarded"; item: ItemId; count: number }
  | { type: "quest.read"; id: QuestId }
  | { type: "quest.accepted"; id: QuestId }
  | { type: "quest.completed"; id: QuestId; money: number; badge: BadgeId | null }
  | { type: "chest.opened"; id: ChestId }
  | { type: "chest.open_failed"; id: ChestId; reason: "guarded" | "order" }
  | { type: "chest.taken"; id: ChestId; item: ItemId }
  | { type: "chest.take_failed"; id: ChestId; reason: "inventory_full" }
  | { type: "resource.harvested"; objectId: string; item: ItemId; amount: number }
  | { type: "harvest.failed"; objectId: string; reason: "no_tool" | "inventory_full" | "carry_limit" }
  | { type: "troll.dialog_opened"; stage: "intro" | "riddle" }
  | { type: "troll.dialog_closed" }
  | { type: "troll.locked"; until: number }
  | { type: "troll.confiscated"; items: ItemStack[] }
  | { type: "troll.riddle_answered"; correct: boolean; riddle: RiddleId }
  | { type: "troll.deposit_recovered"; items: ItemStack[]; remaining: ItemStack[] }
  | { type: "troll.claim_failed"; reason: "inventory_full" }
  | { type: "bridge.built" }
  | { type: "bridge.build_failed"; reason: "not_at_site" | "no_blueprint" | "missing_materials" }
  | { type: "region.discovered"; id: RegionId }
  | { type: "time.pause_changed"; paused: boolean; reasons: string[] };
