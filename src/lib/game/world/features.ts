import type { PoiId, ZoneId } from "../core/ids";
import { shapeContains, type Shape } from "./shape";

export type FeatureProps = Readonly<Record<string, string | number | boolean>>;

/**
 * Punkt charakterystyczny (np. stary dąb, opuszczona chatka) jako dane. Pozycje nadaje generator
 * (etap planowania na terenie bazowym); ten typ nie narzuca żadnych konkretnych lokacji.
 */
export type PointOfInterest = {
  id: PoiId;
  kind: string;
  x: number;
  z: number;
  /** Promień strefy zainteresowania (m), np. polana wokół punktu. */
  radius?: number;
  tags?: readonly string[];
  props?: FeatureProps;
  /** Walidator wymaga, by punkt był osiągalny pieszo od startu. */
  mustReach?: boolean;
};

/** Strefa środowiskowa (np. rzadki bór, zagajnik) jako dane: kształt, tagi i parametry dla rozsiewu/audio/wizualizacji. */
export type EnvironmentZone = {
  id: ZoneId;
  kind: string;
  shape: Shape;
  tags?: readonly string[];
  props?: FeatureProps;
  /** Wyższy priorytet jest pierwszy na liście `zonesAt`. */
  priority?: number;
};

export class FeatureMap {
  private readonly poiById = new Map<string, PointOfInterest>();
  private readonly zoneList: EnvironmentZone[];

  constructor(
    readonly pois: readonly PointOfInterest[] = [],
    zones: readonly EnvironmentZone[] = [],
  ) {
    for (const p of pois) {
      if (this.poiById.has(p.id)) throw new Error(`Powtórzony punkt charakterystyczny: ${p.id}`);
      this.poiById.set(p.id, p);
    }
    const ids = new Set<string>();
    for (const z of zones) {
      if (ids.has(z.id)) throw new Error(`Powtórzona strefa: ${z.id}`);
      ids.add(z.id);
    }
    this.zoneList = [...zones].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  get zones(): readonly EnvironmentZone[] {
    return this.zoneList;
  }

  poi(id: string): PointOfInterest | undefined {
    return this.poiById.get(id);
  }

  zonesAt(x: number, z: number): EnvironmentZone[] {
    return this.zoneList.filter((zone) => shapeContains(zone.shape, x, z));
  }

  zonesWithTag(tag: string): EnvironmentZone[] {
    return this.zoneList.filter((zone) => zone.tags?.includes(tag));
  }

  poisNear(x: number, z: number, r: number): PointOfInterest[] {
    return this.pois
      .filter((p) => (p.x - x) ** 2 + (p.z - z) ** 2 <= (r + (p.radius ?? 0)) ** 2)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
