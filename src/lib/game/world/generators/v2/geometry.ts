import type { Bounds, RegionDef } from "../../bounds";
import type { EnvironmentZone } from "../../features";
import type { WorldPlan, TrailRequest, RiverRequest } from "../../pipeline";
import { SegmentIndex } from "../../polyline";
import type { Point, RibbonPoint } from "../../shape";
import { BASE_PROFILE, PROFILE_IDS, type EnvironmentProfile, type ProfileId, type ProfileTable } from "./profiles";

const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

export type TrailInfo = { id: string; points: readonly Point[]; halfWidth: number; stub: boolean };
export type ClearArea = { id: string; x: number; z: number; r: number };

type ZoneGeom = {
  profile: EnvironmentProfile;
  priority: number;
  feather: number;
  circle?: { x: number; z: number; r: number };
  ribbon?: SegmentIndex;
};

/** Czysto geometryczny widok planu (rzeka, ścieżki, strefy) z szybkimi zapytaniami dla rozsiewu. */
export class ForestGeometry {
  readonly river: { id: string; points: readonly RibbonPoint[] };
  readonly trails: readonly TrailInfo[];
  readonly keepClear: readonly ClearArea[];
  /** Profile w kolejności wag zwracanych przez `profileWeights`; ostatni to profil bazowy. */
  readonly weightProfiles: readonly EnvironmentProfile[];
  private readonly waterIndex = new SegmentIndex(10, 16);
  private readonly trailIndex = new SegmentIndex(8, 16);
  private readonly zones: ZoneGeom[] = [];

  constructor(
    plan: WorldPlan,
    readonly region: RegionDef,
    profiles: ProfileTable,
  ) {
    const river = plan.terrain.find((r): r is RiverRequest => r.kind === "river");
    if (!river) throw new Error("Plan lasu nie zawiera rzeki");
    this.river = { id: river.id, points: river.points };
    this.waterIndex.addPolyline(river.points);

    const trails = plan.terrain.filter((r): r is TrailRequest => r.kind === "trail");
    this.trails = trails.map((t) => ({ id: t.id, points: t.points, halfWidth: t.halfWidth, stub: t.id.includes("stub") }));
    for (const t of trails) this.trailIndex.addPolyline(t.points.map((p) => ({ x: p.x, z: p.z, w: t.halfWidth })));

    this.keepClear = (plan.pois ?? [])
      .filter((p) => p.tags?.includes("keep_clear") && (p.radius ?? 0) > 0)
      .map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.radius ?? 0 }));

    const zones = [...(plan.zones ?? [])].sort(
      (a: EnvironmentZone, b: EnvironmentZone) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : 1),
    );
    for (const z of zones) {
      if (!(PROFILE_IDS as readonly string[]).includes(z.kind)) continue;
      const feather = Number(z.props?.feather ?? 10);
      const base = { profile: profiles[z.kind as ProfileId], priority: z.priority ?? 0, feather };
      if (z.shape.type === "circle") {
        this.zones.push({ ...base, circle: { x: z.shape.x, z: z.shape.z, r: z.shape.r } });
      } else if (z.shape.type === "ribbon") {
        const idx = new SegmentIndex(0, 16);
        idx.addPolyline(z.shape.points);
        this.zones.push({ ...base, ribbon: idx });
      }
    }
    this.weightProfiles = [...this.zones.map((z) => z.profile), profiles[BASE_PROFILE]];
  }

  get weightCount(): number {
    return this.zones.length + 1;
  }

  /** Odległość od brzegu wody (ujemna wewnątrz); `Infinity`, gdy dalej niż ~10 m. */
  waterGap(x: number, z: number): number {
    const hit = this.waterIndex.nearest(x, z);
    return hit ? hit.gap : Infinity;
  }

  /** Odległość od krawędzi najbliższej ścieżki (ujemna na ścieżce); `Infinity`, gdy dalej niż ~8 m. */
  trailGap(x: number, z: number): number {
    const hit = this.trailIndex.nearest(x, z);
    return hit ? hit.gap : Infinity;
  }

  /** Oś rzeki jest funkcją z (punkty rosną po z): środek i półszerokość w danym z (interpolacja liniowa). */
  riverAt(z: number): { x: number; w: number } {
    const pts = this.river.points;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (z <= first.z) return { x: first.x, w: first.w };
    if (z >= last.z) return { x: last.x, w: last.w };
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].z <= z) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const t = (z - a.z) / (b.z - a.z);
    return { x: a.x + (b.x - a.x) * t, w: a.w + (b.w - a.w) * t };
  }

  /** Tania, przybliżona odległość od brzegu wody (dla wilgotności), bez indeksu segmentów. */
  riverGapProxy(x: number, z: number): number {
    const r = this.riverAt(z);
    return Math.abs(x - r.x) - r.w;
  }

  /** Czy punkt (z promieniem `r`) leży w strefie wolnej od dużych obiektów (start, lądowiska mostu). */
  inKeepClear(x: number, z: number, r: number): boolean {
    for (const c of this.keepClear) {
      const rr = c.r + r;
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr) return true;
    }
    return false;
  }

  /**
   * Wagi profili w punkcie: strefy składane wg priorytetu jak warstwy z przezroczystością (strefa o wyższym
   * priorytecie zabiera swoją wagę, reszta przypada niższym i profilowi bazowemu). Waga strefy rośnie gładko od 0 na
   * jej brzegu do 1 po przejściu `feather` metrów w głąb. Zapisuje do `out` (długość >= `weightCount`).
   */
  profileWeights(x: number, z: number, out: Float64Array): void {
    let remaining = 1;
    const n = this.zones.length;
    for (let i = 0; i < n; i++) {
      const zone = this.zones[i];
      let depth: number;
      if (zone.circle) {
        const dx = x - zone.circle.x;
        const dz = z - zone.circle.z;
        depth = zone.circle.r - Math.sqrt(dx * dx + dz * dz);
      } else {
        const hit = zone.ribbon!.nearest(x, z);
        depth = hit ? -hit.gap : -1;
      }
      const w = depth <= 0 ? 0 : smooth(depth / zone.feather);
      const a = w * remaining;
      out[i] = a;
      remaining -= a;
    }
    out[n] = remaining;
  }

  /** Dominujący profil w punkcie (do diagnostyki, minimapy i raportów). */
  dominantProfile(x: number, z: number): ProfileId {
    const w = new Float64Array(this.weightCount);
    this.profileWeights(x, z, w);
    let best = 0;
    for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
    return this.weightProfiles[best].id;
  }

  /** Długość (m) osi ścieżek (poza odcinkiem za rzeką, jeśli `includeStub` = false) leżąca w prostokącie; próbkowanie co 0,5 m. */
  trailLengthIn(bounds: Bounds, includeStub = false): number {
    let total = 0;
    for (const t of this.trails) {
      if (t.stub && !includeStub) continue;
      for (let i = 0; i + 1 < t.points.length; i++) {
        const a = t.points[i];
        const b = t.points[i + 1];
        const len = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
        const n = Math.max(1, Math.ceil(len / 0.5));
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n;
          const px = a.x + (b.x - a.x) * f;
          const pz = a.z + (b.z - a.z) * f;
          if (px >= bounds.minX && px < bounds.maxX && pz >= bounds.minZ && pz < bounds.maxZ) total += len / n;
        }
      }
    }
    return total;
  }
}
