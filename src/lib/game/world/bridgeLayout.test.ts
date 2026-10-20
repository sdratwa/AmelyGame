import { describe, expect, it } from "vitest";
import { BRIDGE_FLAG } from "./generators/v2";
import {
  BRIDGE_HALF_WIDTH,
  BRIDGE_MODEL,
  BRIDGE_RAIL_OFFSET,
  MAX_AXIS_STRETCH,
  END_REACH,
  bayCountFor,
  bridgeRailBoxes,
  lampIndices,
  planBridge,
} from "./bridgeLayout";
import { forestBridgeOf, forestOf, forestWalkOf, syncBridgeColliders } from "./lookup";

const SEEDS = [1, 2, 7, 2030, 99991, 4000000000];
const OPEN = new Set([BRIDGE_FLAG]);

describe("Most: układ (bridgeLayout)", () => {
  it("długość pokładu 19-23 m, 14-17 segmentów i rozciągnięcie osi do 4% dla wielu ziaren", () => {
    for (const seed of SEEDS) {
      const l = forestBridgeOf(seed);
      expect(l.length, `seed=${seed}`).toBeGreaterThanOrEqual(19 - 1e-6);
      expect(l.length, `seed=${seed}`).toBeLessThanOrEqual(23 + 1e-6);
      expect(l.bays).toBeGreaterThanOrEqual(14);
      expect(l.bays).toBeLessThanOrEqual(17);
      expect(Math.abs(l.axisScale - 1)).toBeLessThanOrEqual(MAX_AXIS_STRETCH);
      expect(l.scale).toBe(BRIDGE_MODEL.scale);
    }
  });

  it("liczba segmentów dla skrajnych długości mieści się w granicy rozciągnięcia", () => {
    for (const length of [19, 20, 21, 22, 23]) {
      const bays = bayCountFor(length);
      const nominal = BRIDGE_MODEL.scale * (bays * BRIDGE_MODEL.period + 2 * END_REACH);
      expect(Math.abs(length / nominal - 1), `L=${length}`).toBeLessThanOrEqual(MAX_AXIS_STRETCH);
    }
  });

  it("pokład stoi na terenie przy obu lądowiskach i jest ciągły (bez skoków) na całej długości", () => {
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      const l = forestBridgeOf(seed);
      expect(l.deckAt(0)).toBeCloseTo(forest.terrain.height(l.west.x, l.west.z), 6);
      expect(l.deckAt(l.length)).toBeCloseTo(forest.terrain.height(l.east.x, l.east.z), 6);
      let prev = l.deckAt(0);
      for (let a = 0.1; a <= l.length + 1e-9; a += 0.1) {
        const h = l.deckAt(a);
        expect(Math.abs(h - prev), `seed=${seed} a=${a.toFixed(1)}`).toBeLessThan(0.06);
        prev = h;
      }
    }
  });

  it("deckHeightAt: pod pokładem zwraca wysokość, poza szerokością i długością null", () => {
    const l = forestBridgeOf(1);
    const mid = l.length / 2;
    const at = (a: number, across: number) => ({
      x: l.west.x + l.axis.x * a + l.normal.x * across,
      z: l.west.z + l.axis.z * a + l.normal.z * across,
    });
    const centre = at(mid, 0);
    expect(l.deckHeightAt(centre.x, centre.z)).toBeCloseTo(l.deckAt(mid), 9);
    const edge = at(mid, BRIDGE_HALF_WIDTH - 0.05);
    expect(l.deckHeightAt(edge.x, edge.z)).not.toBeNull();
    const outside = at(mid, BRIDGE_HALF_WIDTH + 0.5);
    expect(l.deckHeightAt(outside.x, outside.z)).toBeNull();
    const before = at(-3, 0);
    expect(l.deckHeightAt(before.x, before.z)).toBeNull();
    const after = at(l.length + 3, 0);
    expect(l.deckHeightAt(after.x, after.z)).toBeNull();
  });

  it("latarnie: symetryczne, parami po obu stronach, nie przy samych końcach i nad pokładem", () => {
    for (const seed of SEEDS) {
      const l = forestBridgeOf(seed);
      expect(l.lamps.length).toBeGreaterThanOrEqual(4);
      expect(l.lamps.length % 2).toBe(0);
      const left = l.lamps.filter((p) => p.side < 0).map((p) => p.along);
      const right = l.lamps.filter((p) => p.side > 0).map((p) => p.along);
      expect(left).toEqual(right);
      for (const a of left) {
        const mirror = l.length - a;
        expect(left.some((b) => Math.abs(b - mirror) < 0.05), `seed=${seed} a=${a}`).toBe(true);
        // Próg 2,5 m: dla krótkich mostów (ok. 17 m, 12 segmentów) najbliższa latarnia leży ok. 2,97 m od lądowiska.
        expect(a).toBeGreaterThan(2.5);
        expect(a).toBeLessThan(l.length - 2.5);
      }
      for (const p of l.lamps) {
        expect(p.y).toBeGreaterThan(l.deckAt(p.along));
        const proj = l.project(p.x, p.z);
        // Latarnie stoją na poręczach: tuż poza chodzonym pokładem, ale wewnątrz linii colliderów poręczy.
        expect(Math.abs(proj.across)).toBeGreaterThan(BRIDGE_HALF_WIDTH);
        expect(Math.abs(proj.across)).toBeLessThan(BRIDGE_RAIL_OFFSET);
        expect(Math.abs(proj.along - p.along)).toBeLessThan(1e-6);
      }
    }
    for (const bays of [14, 15, 16, 17]) {
      const idx = lampIndices(bays);
      expect(idx.every((i) => i > 0 && i < bays - 1)).toBe(true);
      expect(idx.map((i) => bays - 1 - i).sort((a, b) => a - b)).toEqual(idx);
    }
  });

  it("sloty: kolejność od zachodu, początki rosnące, końce z przyczółkami, równa liczba segmentów", () => {
    const l = planBridge({ west: { x: 0, z: 0 }, east: { x: 21, z: 0 } }, () => 1);
    expect(l.slots[0].source).toBe("end_west");
    expect(l.slots[l.slots.length - 1].source).toBe("end_east");
    expect(l.slots.length).toBe(l.bays + 2);
    for (let i = 1; i < l.slots.length; i++) expect(l.slots[i].dstStart).toBeGreaterThan(l.slots[i - 1].dstStart);
    expect(l.deckAt(0)).toBeCloseTo(1, 9);
    expect(l.deckAt(21)).toBeCloseTo(1, 9);
  });

  it("odrzuca lądowiska zbyt blisko siebie", () => {
    expect(() => planBridge({ west: { x: 0, z: 0 }, east: { x: 0.5, z: 0 } }, () => 0)).toThrow();
  });

  it("poręcze: dwa prostokąty po obu stronach pokładu, równoległe do osi mostu", () => {
    const l = forestBridgeOf(1);
    const boxes = bridgeRailBoxes(l);
    expect(boxes).toHaveLength(2);
    for (const b of boxes) {
      const p = l.project(b.x, b.z);
      expect(Math.abs(Math.abs(p.across) - 2.4)).toBeLessThan(1e-6);
      expect(p.along).toBeGreaterThan(0);
      expect(p.along).toBeLessThan(l.length);
      expect(Math.sin(b.yaw)).toBeCloseTo(l.axis.x, 9);
      expect(Math.cos(b.yaw)).toBeCloseTo(l.axis.z, 9);
    }
  });
});

describe("Most: kolizje i przejście przez rzekę", () => {
  it("pas przejścia pokrywa cały pokład: bez flagi blokuje, z flagą wolno przejść w obie strony środkiem", () => {
    for (const seed of SEEDS) {
      const l = forestBridgeOf(seed);
      const walk = forestWalkOf(seed);
      syncBridgeColliders(seed, false);
      const blocked = walk.move(l.west, l.east);
      expect(blocked.x, `seed=${seed}`).toBeLessThan(forestOf(seed).geometry.riverAt(l.west.z).x);
      syncBridgeColliders(seed, true);
      const there = walk.move(l.west, l.east, OPEN);
      expect(Math.hypot(there.x - l.east.x, there.z - l.east.z), `seed=${seed}`).toBeLessThan(1);
      const back = walk.move(l.east, l.west, OPEN);
      expect(Math.hypot(back.x - l.west.x, back.z - l.west.z), `seed=${seed}`).toBeLessThan(1);
      syncBridgeColliders(seed, false);
    }
  }, 60_000);

  it("rzeka nadal blokuje poza pasem mostu także po zbudowaniu (obok mostu nie ma przejścia)", () => {
    for (const seed of SEEDS) {
      const l = forestBridgeOf(seed);
      const walk = forestWalkOf(seed);
      syncBridgeColliders(seed, true);
      for (const off of [-12, 12]) {
        const a = { x: l.west.x + l.normal.x * off, z: l.west.z + l.normal.z * off };
        const b = { x: l.east.x + l.normal.x * off, z: l.east.z + l.normal.z * off };
        const moved = walk.move(a, b, OPEN);
        expect(Math.hypot(moved.x - b.x, moved.z - b.z), `seed=${seed} off=${off}`).toBeGreaterThan(1);
      }
      syncBridgeColliders(seed, false);
    }
  }, 60_000);

  it("syncBridgeColliders jest idempotentne i dodaje/usuwa poręcze zgodnie z flagą", () => {
    const seed = 2030;
    const walk = forestWalkOf(seed);
    const l = forestBridgeOf(seed);
    const rail = bridgeRailBoxes(l)[0];
    syncBridgeColliders(seed, false);
    expect(walk.objectBlocking(rail.x, rail.z)).toBeNull();
    syncBridgeColliders(seed, true);
    syncBridgeColliders(seed, true);
    expect(walk.objectBlocking(rail.x, rail.z)?.kind).toBe("bridge_rail");
    syncBridgeColliders(seed, false);
    syncBridgeColliders(seed, false);
    expect(walk.objectBlocking(rail.x, rail.z)).toBeNull();
  });
});
