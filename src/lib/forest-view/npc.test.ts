import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import type { TrollAsset } from "@/lib/assets/characters";
import { forestOf, forestWalkOf } from "@/lib/game/world/lookup";
import { loadTestTroll } from "@/lib/npc/testkit";
import { NPC_DRAW_DISTANCE, NpcLayer, trollPlacement } from "./npc";

const SEED = 2030;
let asset: TrollAsset;
beforeEach(async () => {
  asset = await loadTestTroll();
});

const make = () => new NpcLayer(asset, { forest: forestOf(SEED), walk: forestWalkOf(SEED), seed: SEED, castShadow: false, receiveShadow: false });

describe("NpcLayer: troll w scenie F1", () => {
  it("startuje w miejscu kotwicy W1b i raportuje statystyki modelu (jedna siatka, 66 kości, 22 materiały źródłowe zredukowane do 1)", () => {
    const layer = make();
    const place = trollPlacement(forestOf(SEED));
    const stats = layer.stats();
    expect(stats.x).toBeCloseTo(place.home.x, 6);
    expect(stats.z).toBeCloseTo(place.home.z, 6);
    expect(stats.bones).toBe(66);
    expect(stats.triangles).toBe(13299);
    expect(stats.materials).toBe(1);
    expect(stats.routePoints).toBeGreaterThanOrEqual(3);
    expect(layer.group.children).toContain(layer.troll.group);
    layer.dispose();
  });

  it("daleko od gracza: ukryty, zamrożony, bez kolizji i bez reakcji; blisko: aktywny", () => {
    const layer = make();
    const place = trollPlacement(forestOf(SEED));
    const far = { x: place.home.x + NPC_DRAW_DISTANCE + 10, z: place.home.z };
    const t0 = { x: layer.troll.x, z: layer.troll.z };
    for (let i = 0; i < 600; i++) layer.update(1 / 60, far);
    expect(layer.troll.group.visible).toBe(false);
    expect({ x: layer.troll.x, z: layer.troll.z }).toEqual(t0);
    expect(layer.blockers()).toEqual([]);
    expect(layer.react("troll", "angry")).toBe(false);
    expect(layer.stats().visible).toBe(false);

    const near = { x: place.home.x + 12, z: place.home.z };
    layer.update(1 / 60, near);
    expect(layer.troll.group.visible).toBe(true);
    expect(layer.blockers()).toHaveLength(1);
    expect(layer.react("troll", "angry")).toBe(true);
    layer.update(1 / 60, near);
    expect(layer.stats().state).toBe("angry");
    layer.dispose();
  });

  it("kolizja NPC ma środek w pozycji trolla i dodatni promień", () => {
    const layer = make();
    layer.update(1 / 60, { x: layer.troll.x + 10, z: layer.troll.z });
    const [b] = layer.blockers();
    expect(b.x).toBeCloseTo(layer.troll.x, 6);
    expect(b.z).toBeCloseTo(layer.troll.z, 6);
    expect(b.r).toBeGreaterThan(0.3);
    layer.dispose();
  });

  it("dispose usuwa grupę ze sceny", () => {
    const layer = make();
    const scene = new THREE.Group();
    scene.add(layer.group);
    layer.dispose();
    expect(layer.group.parent).toBeNull();
  });
});
