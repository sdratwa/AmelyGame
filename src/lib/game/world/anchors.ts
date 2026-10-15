import type { ChestId, NpcId, RegionId } from "../core/ids";
import type { FeatureMap } from "./features";

export type Point2 = { x: number; z: number };

/**
 * Kotwice questa w świecie (pozycje wynikają z seeda i wersji generatora, są częścią odcisku świata).
 * Pozycje skrzyń i trolla są stałe dla danego zapisu; losowane są raz, przy tworzeniu świata.
 */
export type WorldAnchors = {
  start: Point2;
  chests: Record<ChestId, Point2>;
  troll: Point2 & { npc: NpcId; guards: ChestId };
  bridge: {
    x: number;
    z: number;
    radius: number;
    west: Point2;
    east: Point2;
    riverHalfWidth: number;
    flag: string;
  };
  beyond: Point2 & { region: RegionId; radius: number };
};

const need = (features: FeatureMap, id: string) => {
  const poi = features.poi(id);
  if (!poi) throw new Error(`Brak punktu charakterystycznego ${id}`);
  return poi;
};

/** Kotwice z punktów charakterystycznych planu; rzuca wyjątek, gdy plan nie zawiera kompletu. */
export function anchorsFromFeatures(features: FeatureMap, start: Point2): WorldAnchors {
  const chests: Record<string, Point2> = {};
  for (const id of ["poi.chest_pickaxe", "poi.chest_saw", "poi.chest_blueprint"]) {
    const poi = need(features, id);
    chests[String(poi.props?.chestId)] = { x: poi.x, z: poi.z };
  }
  const troll = need(features, "poi.troll_bridge");
  const site = need(features, "poi.bridge_site");
  const beyond = need(features, "poi.beyond_bridge");
  const props = site.props ?? {};
  return {
    start: { x: start.x, z: start.z },
    chests: chests as Record<ChestId, Point2>,
    troll: {
      x: troll.x,
      z: troll.z,
      npc: String(troll.props?.npcId) as NpcId,
      guards: String(troll.props?.guards) as ChestId,
    },
    bridge: {
      x: site.x,
      z: site.z,
      radius: site.radius ?? 0,
      west: { x: Number(props.westX), z: Number(props.westZ) },
      east: { x: Number(props.eastX), z: Number(props.eastZ) },
      riverHalfWidth: Number(props.riverHalfWidth),
      flag: String(props.requiresFlag),
    },
    beyond: {
      x: beyond.x,
      z: beyond.z,
      radius: beyond.radius ?? 0,
      region: String(beyond.props?.regionId) as RegionId,
    },
  };
}

export const distance2 = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.z - b.z);
