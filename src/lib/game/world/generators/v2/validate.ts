import { parseObjectId, sectorOf } from "../../bounds";
import type { ValidateContext, Violation } from "../../pipeline";
import { anchorsFromFeatures, distance2 } from "../../anchors";
import { harvestOf } from "../../harvest";
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

  validateAnchors(ctx, geo, reach, add);

  for (const [code, n] of counts) {
    if (n > PER_CODE_LIMIT) out.push({ code, id: "summary", message: `łącznie ${n} naruszeń tego rodzaju` });
  }
  return out;
}

/** Zapas surowców na zachodnim brzegu względem potrzeb mostu (spec: co najmniej 3x). */
export const SUPPLY_FACTOR = 3;
export const BRIDGE_NEED = { wood: 5, stone: 10 } as const;
export const MIN_CHEST_SPACING = 30;
export const MIN_ANCHOR_FROM_START = 25;

type Adder = (code: string, id: string, message: string) => void;

/** Reguły W1b: kotwice questa (skrzynie, troll, odkrycie) i zapas surowców. */
function validateAnchors(ctx: ValidateContext, geo: ForestGeometry, reach: ReturnType<typeof computeReachability>, add: Adder) {
  let anchors;
  try {
    anchors = anchorsFromFeatures(ctx.features, ctx.start);
  } catch (e) {
    add("anchors_missing", "anchors", String(e instanceof Error ? e.message : e));
    return;
  }
  const chestIds = Object.keys(anchors.chests);
  if (chestIds.length !== 3 || new Set(chestIds).size !== 3) add("chest_count", "anchors", "oczekiwano trzech różnych skrzyń");
  const points = [
    ...Object.entries(anchors.chests).map(([id, p]) => ({ id, ...p })),
    { id: anchors.troll.npc, x: anchors.troll.x, z: anchors.troll.z },
  ];
  for (const p of points) {
    if (geo.waterGap(p.x, p.z) < 3) add("anchor_in_water", p.id, "kotwica w wodzie lub przy brzegu rzeki");
    if (distance2(p, anchors.start) < MIN_ANCHOR_FROM_START) add("anchor_near_start", p.id, "kotwica zbyt blisko startu");
    if (ctx.walk.checkPoint(p.x, p.z)) add("anchor_blocked", p.id, "kotwica zablokowana przez teren lub obiekt");
    if (!reachesNear(reach, p.x, p.z, 2.5)) add("anchor_unreachable", p.id, "kotwica nieosiągalna pieszo od startu (bez przedmiotów)");
    if (distance2(p, anchors.bridge) < 20) add("anchor_near_bridge", p.id, "kotwica zbyt blisko miejsca mostu");
  }
  const chests = Object.entries(anchors.chests);
  for (let i = 0; i < chests.length; i++) {
    for (let j = i + 1; j < chests.length; j++) {
      if (distance2(chests[i][1], chests[j][1]) < MIN_CHEST_SPACING) {
        add("chest_spacing", chests[i][0], `skrzynie ${chests[i][0]} i ${chests[j][0]} zbyt blisko siebie`);
      }
    }
  }
  const guarded = anchors.chests[anchors.troll.guards];
  if (!guarded) add("troll_guard", anchors.troll.npc, "troll nie pilnuje żadnej istniejącej skrzyni");
  else if (distance2(guarded, anchors.troll) > 6) add("troll_guard", anchors.troll.npc, "troll za daleko od pilnowanej skrzyni");

  if (anchors.beyond.x <= anchors.bridge.east.x - 0.5) add("beyond_side", "poi.beyond_bridge", "punkt odkrycia nie leży za rzeką");
  if (reachesNear(reach, anchors.beyond.x, anchors.beyond.z, anchors.beyond.radius)) {
    add("beyond_reachable", "poi.beyond_bridge", "obszar za rzeką osiągalny bez mostu");
  }

  let wood = 0;
  let stone = 0;
  for (const o of ctx.objects) {
    const h = harvestOf(o);
    if (!h || !reachesNear(reach, o.x, o.z, 2.5)) continue;
    if (h.kind === "tree") wood += h.amount;
    else stone += h.amount;
  }
  if (wood < SUPPLY_FACTOR * BRIDGE_NEED.wood) add("wood_supply", "resources", `za mało drewna na zachodnim brzegu: ${wood}`);
  if (stone < SUPPLY_FACTOR * BRIDGE_NEED.stone) add("stone_supply", "resources", `za mało kamienia na zachodnim brzegu: ${stone}`);
}
