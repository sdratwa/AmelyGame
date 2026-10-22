import { describe, expect, it } from "vitest";
import { makeObject, type WorldObject } from "../world/objects";
import { blockerTop, isReachClear, REACH_TARGET_MARGIN, type ReachWorld } from "./reach";

const world = (...objects: WorldObject[]): ReachWorld => ({
  collidersNear: (x, z, r) => objects.filter((o) => Math.hypot(o.x - x, o.z - z) <= o.radius + r),
});

const tree = (id: string, x: number, z: number, r = 0.3) =>
  makeObject({ id, kind: "tree", x, z, y: 0, collider: { shape: "circle", r } });
const rock = (id: string, x: number, z: number, scale: number) =>
  makeObject({ id, kind: "rock", x, z, y: 0, scale, collider: { shape: "circle", r: 0.5 * scale } });

describe("TPP2: zasięg interakcji liczony od postaci (isReachClear)", () => {
  const from = { x: 0, z: 0 };
  const to = { x: 3, z: 0 };

  it("pusta przestrzeń: linia jest czysta, a zerowa odległość też", () => {
    expect(isReachClear(world(), from, to)).toBe(true);
    expect(isReachClear(world(tree("t", 1, 0)), from, from)).toBe(true);
  });

  it("drzewo na linii blokuje, drzewo z boku nie", () => {
    expect(isReachClear(world(tree("t", 1.5, 0)), from, to)).toBe(false);
    expect(isReachClear(world(tree("t", 1.5, 1.5)), from, to)).toBe(true);
  });

  it("sam cel (po id) i obiekty przy celu nie blokują", () => {
    expect(isReachClear(world(tree("cel", 3, 0, 0.5)), from, to, "cel")).toBe(true);
    expect(isReachClear(world(tree("obok", 3 - REACH_TARGET_MARGIN / 2, 0.2)), from, to)).toBe(true);
  });

  it("niska skała nie zasłania tułowia, wysoka tak", () => {
    expect(blockerTop({ kind: "rock", scale: 0.2 })).toBeLessThan(0.9);
    expect(isReachClear(world(rock("n", 1.5, 0, 0.3)), from, to)).toBe(true);
    expect(isReachClear(world(rock("w", 1.5, 0, 2)), from, to)).toBe(false);
  });

  it("prostokątna przeszkoda (ściana) obrócona o yaw blokuje tylko wtedy, gdy przecina linię", () => {
    const wall = (yaw: number) =>
      makeObject({ id: "w", kind: "ruin", x: 1.5, z: 0, y: 0, collider: { shape: "box", halfX: 0.1, halfZ: 1, yaw } });
    expect(isReachClear(world(wall(0)), from, to)).toBe(false);
    // ściana równoległa do linii, przesunięta o 2 m w bok
    const side = makeObject({ id: "s", kind: "ruin", x: 1.5, z: 2, y: 0, collider: { shape: "box", halfX: 1, halfZ: 0.1, yaw: 0 } });
    expect(isReachClear(world(side), from, to)).toBe(true);
  });

  it("obiekt za graczem (poza odcinkiem) nie wpływa na wynik", () => {
    expect(isReachClear(world(tree("z", -1.5, 0)), from, to)).toBe(true);
  });
});
