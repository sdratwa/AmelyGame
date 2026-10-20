import { describe, expect, it } from "vitest";
import { forestBridgeOf } from "@/lib/game/world/lookup";
import { BRIDGE_LAMP_CONFIG, kelvinToRgb, lampLevel, lampWorldPosition, lightFade, nearestLamps } from "./bridgeLamps";

describe("lampLevel (godziny gry)", () => {
  it("dzień wyłączony, noc w pełni, zmierzch i świt płynne", () => {
    for (const h of [8, 9, 12, 15, 17.99]) expect(lampLevel(h), `h=${h}`).toBe(0);
    for (const h of [21, 22, 23.5, 0, 1, 3, 4.99]) expect(lampLevel(h), `h=${h}`).toBe(1);
    expect(lampLevel(18)).toBe(0);
    expect(lampLevel(19.5)).toBeCloseTo(0.5, 6);
    expect(lampLevel(5)).toBe(1);
    expect(lampLevel(6.5)).toBeCloseTo(0.5, 6);
  });

  it("zmierzch rośnie, a świt maleje monotonicznie, bez skoków", () => {
    let prev = lampLevel(18);
    for (let h = 18.05; h <= 21; h += 0.05) {
      const v = lampLevel(h);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v - prev).toBeLessThan(0.06);
      prev = v;
    }
    prev = lampLevel(5);
    for (let h = 5.05; h <= 8; h += 0.05) {
      const v = lampLevel(h);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - v).toBeLessThan(0.06);
      prev = v;
    }
  });

  it("jest cykliczne i odporne na wartości spoza zakresu", () => {
    expect(lampLevel(25)).toBe(lampLevel(1));
    expect(lampLevel(-2)).toBe(lampLevel(22));
    expect(lampLevel(Number.NaN)).toBe(0);
  });
});

describe("barwa i dystans", () => {
  it("2400 K to ciepły, żarowy kolor (czerwień > zieleń > niebieski)", () => {
    const c = kelvinToRgb(BRIDGE_LAMP_CONFIG.kelvin);
    expect(c.r).toBe(1);
    expect(c.g).toBeGreaterThan(c.b);
    expect(c.g).toBeLessThan(0.75);
    expect(c.b).toBeLessThan(0.4);
    expect(BRIDGE_LAMP_CONFIG.kelvin).toBeGreaterThanOrEqual(2200);
    expect(BRIDGE_LAMP_CONFIG.kelvin).toBeLessThanOrEqual(2700);
  });

  it("wybór najbliższych latarni respektuje limit i zasięg, a wygaszanie dystansowe jest monotoniczne", () => {
    const pts = [0, 10, 20, 30, 40].map((x) => ({ x, z: 0 }));
    const near = nearestLamps(pts, 12, 0, 3, 25);
    expect(near.map((n) => n.index)).toEqual([1, 2, 0]);
    expect(nearestLamps(pts, 500, 0, 3, 25)).toEqual([]);
    expect(nearestLamps(pts, 0, 0, 0, 25)).toEqual([]);
    const { fadeStart, lightRange } = BRIDGE_LAMP_CONFIG;
    expect(lightFade(fadeStart - 1)).toBe(1);
    expect(lightFade(lightRange)).toBe(0);
    expect(lightFade((fadeStart + lightRange) / 2)).toBeCloseTo(0.5, 6);
  });

  it("pozycje latarni wynikają z układu mostu (model) i da się je poprawić konfiguracją", () => {
    const layout = forestBridgeOf(1);
    const lamp = layout.lamps[0];
    const base = lampWorldPosition(lamp, layout);
    expect(base).toEqual({ x: lamp.x, y: lamp.y, z: lamp.z });
    const moved = lampWorldPosition(lamp, layout, { ...BRIDGE_LAMP_CONFIG, offset: { inward: 0.1, up: 0.2 } });
    expect(moved.y).toBeCloseTo(lamp.y + 0.2, 9);
    const before = Math.abs(layout.project(lamp.x, lamp.z).across);
    const after = Math.abs(layout.project(moved.x, moved.z).across);
    expect(after).toBeCloseTo(before - 0.1, 6);
  });
});
