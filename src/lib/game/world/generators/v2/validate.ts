import { parseObjectId, sectorOf } from "../../bounds";
import type { ValidateContext, Violation } from "../../pipeline";
import { computeReachability, reachesNear } from "../../walk";
import { ForestGeometry } from "./geometry";
import { BRIDGE_FLAG } from "./plan";
import type { ProfileTable } from "./profiles";

/** Najstromsze dozwolone zbocze terenu w lesie (tangens 33 stopni). */
export const MAX_TERRAIN_TAN = 0.6494;

const PER_CODE_LIMIT = 6;

/**
 * Reguły specyficzne dla lasu W1a, uruchamiane przez `buildWorld` po standardowej walidacji: brak obejścia rzeki,
 * działające przejście po fladze mostu, przechodnie ścieżki, brak obiektów w wodzie, brak nakładania kolizji,
 * wysokości obiektów zgodne z terenem, spójność ID z sektorami i łagodne zbocza.
 */
export function validateForest(ctx: ValidateContext, profiles: ProfileTable): Violation[] {
  const out: Violation[] = [];
  const counts = new Map<string, number>();
  const add = (code: string, id: string, message: string) => {
    const n = (counts.get(code) ?? 0) + 1;
    counts.set(code, n);
    if (n <= PER_CODE_LIMIT) out.push({ code, id, message });
  };

  const region = ctx.regions[0];
  const geo = new ForestGeometry(ctx.plan, region, profiles);
  const flags = new Set([BRIDGE_FLAG]);
  const b = region.bounds;

  // Zbocza terenu (poza korytem rzeki, które jest barierą).
  for (let z = b.minZ; z <= b.maxZ; z += 3) {
    for (let x = b.minX; x <= b.maxX; x += 3) {
      const g = ctx.terrain.gradient(x, z);
      if (Math.sqrt(g.dx * g.dx + g.dz * g.dz) > MAX_TERRAIN_TAN && geo.waterGap(x, z) > 0) {
        add("terrain_too_steep", `terrain.${x}_${z}`, "zbocze stromsze niż 33 stopnie poza korytem rzeki");
      }
    }
  }

  const reach = computeReachability(ctx.walk, ctx.start, { cell: 2 });

  // Rzeka jest barierą: żadna komórka po wschodniej stronie ani w korycie nie może być osiągalna bez mostu.
  for (let z = b.minZ; z <= b.maxZ; z += 3) {
    const r = geo.riverAt(z);
    if (reach.has(r.x, z)) add("river_crossed", "river", `koryto rzeki osiągalne pieszo przy z=${z}`);
    const ex = r.x + r.w + 3;
    if (ex < b.maxX - 0.5 && reach.has(ex, z)) add("river_bypass", "river", `wschodni brzeg osiągalny bez mostu przy z=${z}`);
  }
  for (const z of [b.minZ + 0.6, b.maxZ - 0.6]) {
    const r = geo.riverAt(z);
    const ex = r.x + r.w + 3;
    if (reach.has(ex, z)) add("river_bypass", "river", `obejście rzeki przy krawędzi mapy z=${z}`);
  }
  const westArea = (geo.riverAt(0).x - geo.riverAt(0).w - b.minX) * (b.maxZ - b.minZ);
  if (reach.count * 4 < 0.5 * westArea) add("reach_small", "start", "osiągalna jest tylko niewielka część zachodniego brzegu");

  // Most: bez flagi nie da się przejść, z flagą tak.
  const site = ctx.features.poi("poi.bridge_landing_west");
  const east = ctx.features.poi("poi.bridge_landing_east");
  if (site && east) {
    const closed = ctx.walk.move(site, east);
    if (Math.abs(closed.x - east.x) < 1.5 && Math.abs(closed.z - east.z) < 1.5) {
      add("bridge_ineffective", "passage.bridge", "przejście działa bez flagi mostu");
    }
    const open = ctx.walk.move(site, east, flags);
    if (Math.abs(open.x - east.x) > 1 || Math.abs(open.z - east.z) > 1) {
      add("bridge_unusable", "passage.bridge", "po fladze mostu nie da się przejść między lądowiskami");
    }
  } else {
    add("bridge_missing", "poi.bridge_site", "brak punktów lądowisk mostu");
  }

  // Ścieżki: przechodnie co 1,5 m, osiągalne od startu (odcinek za rzeką tylko z flagą).
  for (const t of geo.trails) {
    for (let i = 0; i + 1 < t.points.length; i++) {
      const p = t.points[i];
      const a = t.points[i + 1];
      const len = Math.sqrt((a.x - p.x) ** 2 + (a.z - p.z) ** 2);
      const n = Math.max(1, Math.ceil(len / 1.5));
      for (let k = 0; k < n; k++) {
        const x = p.x + ((a.x - p.x) * k) / n;
        const z = p.z + ((a.z - p.z) * k) / n;
        const block = ctx.walk.checkPoint(x, z, t.stub ? flags : undefined);
        if (block) add("path_blocked", t.id, `ścieżka zablokowana (${block.reason}) w (${x.toFixed(1)}, ${z.toFixed(1)})`);
        else if (!t.stub && !reachesNear(reach, x, z, 2.2)) add("path_unreachable", t.id, `odcinek ścieżki nieosiągalny od startu (${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
    }
  }

  // Obiekty.
  const ids = new Set<string>();
  for (const o of ctx.objects) {
    if (ids.has(o.id)) add("duplicate_id", o.id, "powtórzony identyfikator obiektu");
    ids.add(o.id);
    const parsed = parseObjectId(o.id);
    const s = sectorOf(region, o.x, o.z);
    if (!parsed || !s || parsed.ix !== s.ix || parsed.iz !== s.iz) add("object_wrong_sector", o.id, "ID obiektu nie zgadza się z sektorem jego pozycji");
    if (Math.abs(o.y - ctx.terrain.height(o.x, o.z)) > 1.1e-4) add("object_off_terrain", o.id, "wysokość obiektu różni się od terenu");
    const r = o.collider?.shape === "circle" ? o.collider.r : 0;
    if (geo.waterGap(o.x, o.z) < r - 1e-9) add("object_in_water", o.id, "obiekt w korycie rzeki");
    if (o.collider) {
      for (const other of ctx.walk.index.queryRadius(o.x, o.z, r + 4)) {
        if (other.id <= o.id || !other.collider || other.collider.shape !== "circle") continue;
        const rr = r + other.collider.r;
        if ((other.x - o.x) ** 2 + (other.z - o.z) ** 2 < rr * rr - 1e-6) add("collider_overlap", o.id, `nakłada się na ${other.id}`);
      }
    }
  }

  for (const [code, n] of counts) {
    if (n > PER_CODE_LIMIT) out.push({ code, id: "summary", message: `łącznie ${n} naruszeń tego rodzaju` });
  }
  return out;
}
