import { describe, expect, it } from "vitest";
import { FOREST_START_REGION, defineRegion } from "./bounds";
import { makeObject, pushOutOfCollider, type WorldObject } from "./objects";
import { computeReachability, reachesNear, WalkWorld, type Barrier, type Passage } from "./walk";
import { createTerrain, makeField } from "./terrain";

const flat = createTerrain(1, 1);
const tree = (id: string, x: number, z: number, r = 0.35): WorldObject =>
  makeObject({ id, kind: "tree", x, z, y: 0, collider: { shape: "circle", r } });

const river: Barrier = {
  id: "barrier.river",
  kind: "river",
  shape: { type: "band", points: [{ x: 100, z: -150 }, { x: 100, z: 150 }], halfWidth: 6 },
};
const bridge: Passage = {
  id: "passage.bridge",
  requiresFlag: "bridge.built",
  opens: ["barrier.river"],
  shape: { type: "rect", minX: 90, maxX: 110, minZ: -3, maxZ: 3 },
};

describe("walkable: granice regionu", () => {
  const world = new WalkWorld({ regions: [FOREST_START_REGION], terrain: flat });

  it("punkty w środku są przechodnie, poza regionem lub przy krawędzi nie", () => {
    expect(world.isWalkable(0, 0)).toBe(true);
    expect(world.isWalkable(149, 0)).toBe(true);
    expect(world.checkPoint(149.8, 0)).toEqual({ reason: "out_of_bounds" });
    expect(world.checkPoint(-151, 0)).toEqual({ reason: "out_of_bounds" });
    expect(world.checkPoint(0, 200)).toEqual({ reason: "out_of_bounds" });
  });

  it("ruch nie wyprowadza poza region, a ślizg po krawędzi działa", () => {
    const out = world.move({ x: 149, z: 0 }, { x: 155, z: 5 });
    expect(out.x).toBeGreaterThanOrEqual(149);
    expect(out.x).toBeLessThanOrEqual(149.5);
    expect(out.z).toBeCloseTo(5, 9);
    expect(out.blocked[0]).toEqual({ reason: "out_of_bounds" });
  });

  it("sektory nie ograniczają ruchu: przejście przez granicę sektora jest swobodne", () => {
    const out = world.move({ x: -120.2, z: 0 }, { x: -119.8, z: 0 });
    expect(out).toMatchObject({ x: -119.8, z: 0, blocked: [] });
  });

  it("region odblokowany flagą staje się przechodni", () => {
    const beyond = defineRegion({
      id: "region.beyond_bridge",
      bounds: { minX: 150, minZ: -40, maxX: 250, maxZ: 40 },
      sectorSize: 50,
      unlockedBy: "bridge.built",
    });
    const w = new WalkWorld({ regions: [FOREST_START_REGION, beyond], terrain: flat });
    expect(w.isWalkable(200, 0, new Set())).toBe(false);
    expect(w.isWalkable(200, 0, new Set(["bridge.built"]))).toBe(true);
  });
});

describe("walkable: nachylenie", () => {
  const wall = makeField((x) => (x > 20 ? (x - 20) * 2 : 0));
  const world = new WalkWorld({ regions: [FOREST_START_REGION], terrain: wall });

  it("zbyt strome zbocze blokuje, łagodne nie", () => {
    expect(world.checkPoint(25, 0)).toEqual({ reason: "too_steep" });
    expect(world.isWalkable(10, 0)).toBe(true);
    const gentle = new WalkWorld({ regions: [FOREST_START_REGION], terrain: makeField((x) => 0.3 * x) });
    expect(gentle.isWalkable(10, 0)).toBe(true);
    const limit = new WalkWorld({ regions: [FOREST_START_REGION], terrain: makeField((x) => 0.8 * x), config: { maxSlopeDeg: 35 } });
    expect(limit.isWalkable(10, 0)).toBe(false);
    const limit2 = new WalkWorld({ regions: [FOREST_START_REGION], terrain: makeField((x) => 0.8 * x), config: { maxSlopeDeg: 45 } });
    expect(limit2.isWalkable(10, 0)).toBe(true);
  });

  it("ruch w stronę stromego zbocza zatrzymuje się, ruch wzdłuż zbocza ślizga", () => {
    const stop = world.move({ x: 19.5, z: 0 }, { x: 22, z: 0 });
    expect(stop.x).toBeLessThan(20.3);
    expect(stop.blocked[0].reason).toBe("too_steep");
    const slide = world.move({ x: 19.5, z: 0 }, { x: 22, z: 3 });
    expect(slide.x).toBeLessThan(20.3);
    expect(slide.z).toBeCloseTo(3, 9);
  });
});

describe("walkable: kolizje z obiektami", () => {
  it("drzewo wypycha gracza i zostawia go przy powierzchni (ślizg)", () => {
    const world = new WalkWorld({ regions: [FOREST_START_REGION], terrain: flat, objects: [tree("tree.a", 10, 0)] });
    const out = world.move({ x: 8, z: 0 }, { x: 10, z: 0.05 });
    const gap = Math.hypot(out.x - 10, out.z);
    expect(gap).toBeGreaterThanOrEqual(0.35 + 0.4 - 1e-9);
    expect(gap).toBeLessThan(0.8);
    expect(out.blocked[0]).toEqual({ reason: "object", by: "tree.a" });
    expect(world.checkPoint(10, 0.2)).toEqual({ reason: "object", by: "tree.a" });
    expect(world.isWalkable(10, 1.2)).toBe(true);
  });

  it("wiele drzew jednocześnie oraz usuwanie obiektu", () => {
    const world = new WalkWorld({
      regions: [FOREST_START_REGION],
      terrain: flat,
      objects: [tree("t.1", 0, 0), tree("t.2", 1.2, 0)],
    });
    const out = world.move({ x: 0.6, z: 2 }, { x: 0.6, z: 0.1 });
    expect(world.objectBlocking(out.x, out.z)).toBeNull();
    expect(world.removeObject("t.1")).toBe(true);
    expect(world.isWalkable(0, 0)).toBe(true);
    world.addObject(tree("t.3", 0, 0));
    expect(world.isWalkable(0, 0)).toBe(false);
  });

  it("collider pudełkowy (obrócony) blokuje i wypycha z właściwej strony", () => {
    const box = makeObject({ id: "chest.a", kind: "chest", x: 0, z: 0, y: 0, collider: { shape: "box", halfX: 1, halfZ: 0.5, yaw: 0 } });
    const right = pushOutOfCollider(box, 1.2, 0, 0.4);
    expect(right.hit).toBe(true);
    expect(right.x).toBeCloseTo(1.4, 9);
    expect(pushOutOfCollider(box, 3, 0, 0.4).hit).toBe(false);
    const inside = pushOutOfCollider(box, 0.1, 0.4, 0.4);
    expect(inside.hit).toBe(true);
    expect(inside.z).toBeCloseTo(0.9, 9);
    const rotated = makeObject({ id: "chest.b", kind: "chest", x: 0, z: 0, y: 0, collider: { shape: "box", halfX: 2, halfZ: 0.5, yaw: Math.PI / 2 } });
    expect(pushOutOfCollider(rotated, 1.5, 0, 0.4).hit).toBe(false);
    expect(Math.abs(pushOutOfCollider(rotated, 0, 1.9, 0.4).z)).toBeCloseTo(2.4, 9);
    expect(pushOutOfCollider(tree("x", 0, 0), 0, 0, 0.4)).toMatchObject({ hit: true, x: 0.75 });
    expect(pushOutOfCollider(makeObject({ id: "n", kind: "deco", x: 0, z: 0, y: 0 }), 0, 0, 1).hit).toBe(false);
  });

  it("obiekt na granicy sektorów blokuje po obu stronach", () => {
    const world = new WalkWorld({ regions: [FOREST_START_REGION], terrain: flat, objects: [tree("t.edge", -120, 0, 1)] });
    expect(world.isWalkable(-119.1, 0)).toBe(false);
    expect(world.isWalkable(-120.9, 0)).toBe(false);
    expect(world.isWalkable(-118.5, 0)).toBe(true);
  });

  it("promień obwiedni obejmuje collider", () => {
    expect(makeObject({ id: "a", kind: "t", x: 0, z: 0, y: 0, radius: 0.1, collider: { shape: "circle", r: 2 } }).radius).toBe(2);
    expect(makeObject({ id: "b", kind: "t", x: 0, z: 0, y: 0, collider: { shape: "box", halfX: 3, halfZ: 4, yaw: 0 } }).radius).toBe(5);
  });
});

describe("walkable: bariery, rzeka i most", () => {
  const world = new WalkWorld({ regions: [FOREST_START_REGION], terrain: flat, barriers: [river], passages: [bridge] });

  it("rzeka blokuje przejście, dopóki most nie zostanie zbudowany", () => {
    expect(world.checkPoint(100, 50)).toEqual({ reason: "barrier", by: "barrier.river" });
    expect(world.checkPoint(100, 0)).toEqual({ reason: "barrier", by: "barrier.river" });
    expect(world.isWalkable(80, 0)).toBe(true);
    const stop = world.move({ x: 90, z: 20 }, { x: 99, z: 20 });
    expect(stop.x).toBeGreaterThan(90);
    expect(stop.x).toBeLessThan(94);
    expect(stop.blocked[0]).toEqual({ reason: "barrier", by: "barrier.river" });
  });

  it("po zbudowaniu mostu przejście działa tylko w obrębie mostu", () => {
    const flags = new Set(["bridge.built"]);
    expect(world.isWalkable(100, 0, flags)).toBe(true);
    expect(world.isWalkable(100, 2, flags)).toBe(true);
    expect(world.isWalkable(100, 10, flags)).toBe(false);
    expect(world.move({ x: 88, z: 0 }, { x: 112, z: 0 }, flags).x).toBe(112);
    expect(world.move({ x: 88, z: 10 }, { x: 112, z: 10 }, flags).x).toBeLessThan(94);
  });

  it("przejście bez listy `opens` otwiera wszystkie bariery w swoim kształcie", () => {
    const w = new WalkWorld({
      regions: [FOREST_START_REGION],
      terrain: flat,
      barriers: [river],
      passages: [{ ...bridge, opens: undefined }],
    });
    expect(w.isWalkable(100, 0, new Set(["bridge.built"]))).toBe(true);
  });
});

describe("przechodniość (BFS)", () => {
  it("bez mostu druga strona rzeki jest nieosiągalna, z mostem osiągalna", () => {
    const world = new WalkWorld({ regions: [FOREST_START_REGION], terrain: flat, barriers: [river], passages: [bridge] });
    const west = computeReachability(world, { x: -100, z: 0 }, { cell: 1 });
    expect(west.has(0, 0)).toBe(true);
    expect(west.has(120, 0)).toBe(false);
    expect(reachesNear(west, 120, 0, 2)).toBe(false);
    const withBridge = computeReachability(world, { x: -100, z: 0 }, { cell: 1, flags: new Set(["bridge.built"]) });
    expect(withBridge.has(120, 0)).toBe(true);
    expect(withBridge.count).toBeGreaterThan(west.count);
  });

  it("drzewa blokują komórki, a cel w kolizji jest osiągalny w zasięgu interakcji", () => {
    const world = new WalkWorld({ regions: [FOREST_START_REGION], terrain: flat, objects: [tree("t", 0, 0, 2)] });
    const reach = computeReachability(world, { x: 20, z: 20 });
    expect(reach.has(0.5, 0.5)).toBe(false);
    expect(reachesNear(reach, 0, 0, 3.5)).toBe(true);
    expect(reachesNear(reach, 0, 0, 1)).toBe(false);
  });

  it("start w zablokowanym miejscu daje pusty wynik", () => {
    const world = new WalkWorld({ regions: [FOREST_START_REGION], terrain: flat, objects: [tree("t", 0, 0, 2)] });
    expect(computeReachability(world, { x: 0.5, z: 0.5 }).count).toBe(0);
  });
});
