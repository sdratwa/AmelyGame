import * as THREE from "three";
import type { TrollAsset } from "@/lib/assets/characters";
import { anchorsFromFeatures } from "@/lib/game/world/anchors";
import { FOREST_START } from "@/lib/game/world/generators/v2";
import type { ForestWorld } from "@/lib/game/world/generators/v2/forest";
import type { WalkWorld } from "@/lib/game/world/walk";
import type { Blocker } from "@/lib/npc/patrol";
import { TrollNpc, type TrollReaction } from "@/lib/npc/troll";

/** Troll dalej niż to od gracza nie jest aktualizowany ani rysowany (animacja szkieletowa kosztuje, a pod nim nie ma gruntu). */
export const NPC_DRAW_DISTANCE = 140;

export type NpcStats = {
  visible: boolean;
  /** Stan animacji trolla (idle, walk, angry). */
  state: string;
  patrol: string;
  x: number;
  z: number;
  /** Punkty trasy patrolu (0 = troll stoi, bo wokół kotwicy nie ma bezpiecznej pętli). */
  routePoints: number;
  triangles: number;
  bones: number;
  materials: number;
};

/** Miejsce trolla: kotwica W1b i punkt, ku któremu patrzy (pilnowana skrzynia). */
export function trollPlacement(forest: ForestWorld): { home: { x: number; z: number }; faceTo: { x: number; z: number } } {
  const anchors = anchorsFromFeatures(forest.features, FOREST_START);
  const chest = anchors.chests[anchors.troll.guards];
  return { home: { x: anchors.troll.x, z: anchors.troll.z }, faceTo: chest ? { x: chest.x, z: chest.z } : anchors.start };
}

/**
 * Warstwa postaci lasu (troll): dodaje prezentację NPC do sceny F1. Stanu gry nie zna; ruch wyznacza patrol, a gniew
 * uruchamia `react` z adaptera zdarzeń. Poza `NPC_DRAW_DISTANCE` postać jest ukryta i zamrożona.
 */
export class NpcLayer {
  readonly group = new THREE.Group();
  readonly troll: TrollNpc;
  private visible = true;
  private readonly asset: TrollAsset;

  constructor(
    asset: TrollAsset,
    options: { forest: ForestWorld; walk: WalkWorld; seed: number; castShadow: boolean; receiveShadow: boolean },
  ) {
    this.asset = asset;
    const place = trollPlacement(options.forest);
    this.troll = new TrollNpc({
      asset,
      walk: options.walk,
      terrain: options.forest.terrain,
      home: place.home,
      faceTo: place.faceTo,
      seed: options.seed,
      castShadow: options.castShadow,
      receiveShadow: options.receiveShadow,
    });
    this.group.name = "npcs";
    this.group.add(this.troll.group);
  }

  setShadows(cast: boolean, receive: boolean): void {
    this.troll.setShadows(cast, receive);
  }

  update(dt: number, viewer: { x: number; z: number }): void {
    const near = (this.troll.x - viewer.x) ** 2 + (this.troll.z - viewer.z) ** 2 <= NPC_DRAW_DISTANCE ** 2;
    this.visible = near;
    this.troll.group.visible = near;
    if (near) this.troll.update(dt, viewer);
  }

  /** Reakcja NPC z gry; false, gdy NPC jest daleko (nic nie widać), nie ma takiej animacji albo trwa inna reakcja. */
  react(npc: "troll", kind: TrollReaction): boolean {
    if (npc !== "troll" || !this.visible) return false;
    return this.troll.react(kind);
  }

  /** Okręgi kolizji NPC dla kontrolera gracza. */
  blockers(): readonly Blocker[] {
    return this.visible ? [this.troll.blocker()] : [];
  }

  stats(): NpcStats {
    return {
      visible: this.visible,
      state: this.troll.animator.state,
      patrol: this.troll.patrol.mode,
      x: this.troll.x,
      z: this.troll.z,
      routePoints: this.troll.route.length,
      triangles: this.asset.triangles,
      bones: this.asset.bones,
      materials: 1,
    };
  }

  dispose(): void {
    this.troll.dispose();
    this.group.removeFromParent();
  }
}
