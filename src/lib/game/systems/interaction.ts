import type { ItemId } from "../content/items";
import { BUILD_PROMPT_RANGE, CHEST_PROMPT_RANGE, HARVEST_PROMPT_RANGE } from "../core/constants";
import { RECIPE_BRIDGE_01 } from "../content/quests";
import type { ChestId } from "../core/ids";
import type { GameState } from "../core/state";
import { harvestOf, type HarvestKind, type HarvestSize } from "../world/harvest";
import { authoritativeForestOf, forestChestsOf } from "../world/lookup";
import { countOf } from "./containers";
import { isReachClear } from "./reach";
import { chestWaitsForItem } from "./forestQuest";

/** Pozycja i kierunek patrzenia gracza w lesie. yaw = 0 patrzy w stronę -Z (jak kamera renderera). */
export type ViewPose = { x: number; z: number; yaw: number };

export type PickOptions = {
  /**
   * Tryb trzecioosobowy: pozycja to postać (nie kamera), a kierunek to kierunek kamery. Wtedy skrzynie i obiekty do
   * zbierania wymagają czystej linii od postaci do celu (drzewo, skała lub ściana między nimi blokuje interakcję).
   */
  requireClearReach?: boolean;
};

export type InteractTarget =
  | { kind: "chest"; id: ChestId; distance: number; action: "open" | "peek"; locked: boolean; lockReason: "troll" | "order" | null }
  | { kind: "tree" | "rock"; id: string; distance: number; size: HarvestSize; amount: number }
  /** Miejsce budowy mostu (obszar przy zachodnim lądowisku, bez wymogu patrzenia w jeden punkt). */
  | { kind: "bridge_site"; id: "bridge.site"; distance: number; hasBlueprint: boolean };

export type PromptTone = "action" | "blocked";
export type Prompt = { key: "E" | null; text: string; tone: PromptTone };

/** Połowa szerokości stożka patrzenia (rad) i górny limit po uwzględnieniu rozmiaru obiektu. */
const BASE_CONE = (26 * Math.PI) / 180;
const MAX_CONE = (65 * Math.PI) / 180;
const CHEST_EXTENT = 0.55;
const CHEST_PRIORITY = 0.85;

const angleBetween = (pose: ViewPose, x: number, z: number) => {
  const dx = x - pose.x;
  const dz = z - pose.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  const dot = (dx * -Math.sin(pose.yaw) + dz * -Math.cos(pose.yaw)) / len;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
};

const cone = (distance: number, extent: number) => Math.min(MAX_CONE, BASE_CONE + Math.atan(extent / Math.max(distance, 0.5)));

/**
 * Obiekt, z którym gracz może wejść w interakcję: leży w zasięgu i w stożku patrzenia; wygrywa ten, który jest
 * najbliżej środka celownika (z lekką preferencją bliższych i skrzyń). Funkcja czysta: nic nie zmienia, a silnik
 * i tak sprawdza istnienie, stan i dystans przy wykonaniu komendy.
 */
export function pickInteraction(state: GameState, pose: ViewPose, options: PickOptions = {}): InteractTarget | null {
  if (!state.world || state.view !== "forest" || state.dead || ![pose.x, pose.z, pose.yaw].every(Number.isFinite)) return null;
  const world = { seed: state.world.seed, genVersion: state.world.genVersion };
  let best: { score: number; target: InteractTarget } | null = null;
  const consider = (score: number, target: InteractTarget) => {
    if (!best || score < best.score) best = { score, target };
  };

  const forest = authoritativeForestOf(world);
  const clear = (tx: number, tz: number, id: string) => !options.requireClearReach || isReachClear(forest, pose, { x: tx, z: tz }, id);

  const guarded = state.world.anchors?.troll.guards;
  for (const chest of forestChestsOf(world)) {
    const distance = Math.hypot(chest.x - pose.x, chest.z - pose.z);
    if (distance > CHEST_PROMPT_RANGE) continue;
    const st = state.chests[chest.id];
    if (st?.opened && st.taken) continue;
    const angle = angleBetween(pose, chest.x, chest.z);
    const allowed = cone(distance, CHEST_EXTENT);
    if (angle > allowed) continue;
    if (!clear(chest.x, chest.z, chest.id)) continue;
    const guardedByTroll = !st?.opened && guarded === chest.id && state.troll.phase !== "solved";
    const waiting = chestWaitsForItem(state, chest.id) !== null;
    const locked = guardedByTroll || waiting;
    consider((angle / allowed + (distance / CHEST_PROMPT_RANGE) * 0.35) * CHEST_PRIORITY, {
      kind: "chest",
      id: chest.id,
      distance,
      action: st?.opened ? "peek" : "open",
      locked,
      lockReason: guardedByTroll ? "troll" : waiting ? "order" : null,
    });
  }

  const anchors = state.world.anchors;
  if (anchors && !state.bridge.built) {
    const distance = Math.hypot(anchors.bridge.west.x - pose.x, anchors.bridge.west.z - pose.z);
    if (distance <= BUILD_PROMPT_RANGE) {
      // Obszar, nie punkt: wygrywa z drzewami i skałami w pobliżu (wynik niższy niż typowy wynik zbierania).
      consider(0.2, { kind: "bridge_site", id: "bridge.site", distance, hasBlueprint: countOf(state.slots, RECIPE_BRIDGE_01.blueprint) >= 1 });
    }
  }

  const gone = new Set(state.harvested);
  for (const o of forest.collidersNear(pose.x, pose.z, HARVEST_PROMPT_RANGE)) {
    const info = harvestOf(o);
    if (!info || gone.has(o.id)) continue;
    const distance = Math.hypot(o.x - pose.x, o.z - pose.z);
    if (distance > HARVEST_PROMPT_RANGE) continue;
    const extent = o.collider?.shape === "circle" ? o.collider.r : o.radius;
    const angle = angleBetween(pose, o.x, o.z);
    const allowed = cone(distance, extent);
    if (angle > allowed) continue;
    if (!clear(o.x, o.z, o.id)) continue;
    consider(angle / allowed + (distance / HARVEST_PROMPT_RANGE) * 0.35, { kind: info.kind, id: o.id, distance, size: info.size, amount: info.amount });
  }
  return (best as { target: InteractTarget } | null)?.target ?? null;
}

const SIZE_TREE: Record<HarvestSize, string> = { s: "małe", m: "średnie", l: "duże" };
const SIZE_ROCK: Record<HarvestSize, string> = { s: "małą", m: "średnią", l: "dużą" };

export function toolFor(kind: HarvestKind): ItemId {
  return kind === "tree" ? "item.saw" : "item.pickaxe";
}

/** Tekst podpowiedzi dla celu. Gdy brakuje narzędzia lub skrzynię pilnuje troll, podpowiedź jest komunikatem bez akcji. */
export function describePrompt(state: GameState, target: InteractTarget): Prompt {
  if (target.kind === "bridge_site") {
    return target.hasBlueprint
      ? { key: "E", text: "Zbuduj most", tone: "action" }
      : { key: null, text: "Tutaj kiedyś stał most.", tone: "blocked" };
  }
  if (target.kind === "chest") {
    if (target.locked) {
      return {
        key: null,
        text: target.lockReason === "order" ? "Skrzynia jest zamknięta. Najpierw zdobądź schemat mostu." : "Skrzynia jest zamknięta. Pilnuje jej troll.",
        tone: "blocked",
      };
    }
    return {
      key: "E",
      text: target.action === "open" ? "Otwórz skrzynię" : "Zobacz zawartość skrzyni",
      tone: "action",
    };
  }
  const tool = toolFor(target.kind);
  if (countOf(state.slots, tool) < 1) {
    return {
      key: null,
      text: target.kind === "tree" ? "Potrzebujesz piły, aby ściąć to drzewo." : "Potrzebujesz kilofa, aby rozbić tę skałę.",
      tone: "blocked",
    };
  }
  return target.kind === "tree"
    ? { key: "E", text: `Zetnij ${SIZE_TREE[target.size]} drzewo (drewno +${target.amount})`, tone: "action" }
    : { key: "E", text: `Rozbij ${SIZE_ROCK[target.size]} skałę (kamień +${target.amount})`, tone: "action" };
}

/** Komenda silnika dla klawisza E; null, gdy E ma tylko pokazać zawartość otwartej skrzyni (okno, bez zmiany stanu). */
export function interactionCommand(target: InteractTarget, pose: ViewPose):
  | { type: "chest.open"; id: ChestId; at: { x: number; z: number } }
  | { type: "harvest"; objectId: string; at: { x: number; z: number } }
  | null {
  const at = { x: pose.x, z: pose.z };
  // Budowa mostu nie wysyła komendy od razu: E otwiera okno z materiałami, a komendę wysyła przycisk w oknie.
  if (target.kind === "bridge_site") return null;
  if (target.kind === "chest") return target.action === "open" ? { type: "chest.open", id: target.id, at } : null;
  return { type: "harvest", objectId: target.id, at };
}
