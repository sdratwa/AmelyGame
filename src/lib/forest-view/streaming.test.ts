import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { forestOf } from "@/lib/game/world/lookup";
import { createGroundBuilder, type GroundStyle } from "./ground";
import { PaletteStore } from "./grading";
import type { ForestInstancer } from "./instancer";
import { VIEW_PROFILES } from "./profiles";
import { INITIAL_RING, TILE_PAD, TILE_PIXELS, sectorKey, tileTextureBounds } from "./stream";
import { StreamedForest, forestModelIds } from "./streaming";
import { batchesFor, type ModelBatch } from "./window";

const SEED = 2030;
const STYLE: GroundStyle = "natural";

function setup(quality: "LOW" | "MEDIUM" = "LOW", radius = 2) {
  const forest = forestOf(SEED);
  const applied: ModelBatch[][] = [];
  const instancer = { setBatches: (b: ModelBatch[]) => void applied.push(b) } as unknown as ForestInstancer;
  const stream = new StreamedForest({
    forest,
    profile: VIEW_PROFILES[quality],
    quality,
    radius,
    groundStyle: STYLE,
    palette: new PaletteStore(),
    instancer,
    anisotropy: 1,
    receiveShadow: false,
    tuneGround: () => {},
  });
  return { forest, stream, applied };
}

const at = (forest: ReturnType<typeof forestOf>, ix: number, iz: number) => {
  const b = forest.sector(ix, iz).bounds;
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
};

function pump(stream: StreamedForest, x: number, z: number, until: () => boolean, maxFrames = 20000) {
  let frames = 0;
  do stream.update(x, z, 6, performance.now() + frames * 300);
  while (!until() && ++frames < maxFrames);
  expect(frames).toBeLessThan(maxFrames);
  return frames;
}

const countInstances = (forest: ReturnType<typeof forestOf>, keys: Iterable<string>) => {
  let n = 0;
  for (const key of keys) {
    const [ix, iz] = key.split("_").map(Number);
    n += batchesFor(forest.sector(ix, iz).objects).instanceCount;
  }
  return n;
};

describe("F1: streamowane sektory lasu", () => {
  it("ładuje pierścień początkowy, potem okno, a instancje odpowiadają obiektom załadowanych sektorów", () => {
    const { forest, stream, applied } = setup("LOW", 2);
    const p = at(forest, 4, 4);
    stream.prepareInitial(p.x, p.z);
    expect(stream.initialReady()).toBe(false);
    expect(stream.initialProgress()).toBe(0);

    pump(stream, p.x, p.z, () => stream.initialReady());
    expect(stream.initialProgress()).toBe(1);
    const ring = (2 * Math.min(INITIAL_RING, 2) + 1) ** 2;
    expect(stream.stats().resident).toBeGreaterThanOrEqual(ring);
    expect(stream.group.children.filter((c) => c.name.startsWith("ground:")).length).toBe(stream.stats().resident);

    pump(stream, p.x, p.z, () => stream.stats().queued === 0 && !stream.stats().building);
    expect(stream.stats().resident).toBe(25);
    stream.update(p.x, p.z, 0, 1e12);
    const last = applied[applied.length - 1];
    const total = last.reduce((n, b) => n + b.ids.length, 0);
    expect(total).toBe(countInstances(forest, stream.loadedKeys));
    expect(new Set(last.flatMap((b) => b.ids)).size).toBe(total);
    stream.dispose();
  }, 60_000);

  it("ruch przez granicę sektora dociąga nowe sektory i zwalnia stare (geometria i tekstury są zwalniane)", () => {
    const { forest, stream, applied } = setup("LOW", 2);
    const a = at(forest, 4, 4);
    stream.prepareInitial(a.x, a.z);
    pump(stream, a.x, a.z, () => stream.stats().resident === 25 && !stream.stats().building);

    const disposed: string[] = [];
    for (const child of stream.group.children) {
      if (!(child instanceof THREE.Mesh) || !child.name.startsWith("ground:")) continue;
      child.geometry.addEventListener("dispose", () => disposed.push(child.name));
    }

    const edge = at(forest, 8, 4);
    for (let ix = 4; ix <= 8; ix++) {
      const p = at(forest, ix, 4);
      pump(stream, p.x, p.z, () => stream.stats().queued === 0 && !stream.stats().building);
    }
    const loaded = stream.loadedKeys;
    for (let iz = 2; iz <= 6; iz++) for (let ix = 6; ix <= 9; ix++) expect(loaded.has(sectorKey({ ix, iz }))).toBe(true);
    expect(loaded.has("2_4")).toBe(false);
    expect(loaded.has("3_4")).toBe(false);
    expect(disposed.length).toBeGreaterThan(0);
    expect(stream.group.children.filter((c) => c.name.startsWith("ground:")).length).toBe(loaded.size);
    expect(loaded.size).toBeLessThanOrEqual(7 * 6);

    stream.update(edge.x, edge.z, 0, 1e12);
    const last = applied[applied.length - 1];
    expect(last.reduce((n, b) => n + b.ids.length, 0)).toBe(countInstances(forest, loaded));
    stream.dispose();
  }, 120_000);

  it("kręcenie się na granicy sektorów nie buduje nic nowego", () => {
    const { forest, stream } = setup("LOW", 2);
    const a = at(forest, 4, 4);
    stream.prepareInitial(a.x, a.z);
    pump(stream, a.x, a.z, () => stream.stats().resident === 25 && !stream.stats().building);
    const border = forest.sector(4, 4).bounds.maxX;
    const before = stream.group.children.map((c) => c.uuid).sort();
    for (let i = 0; i < 30; i++) stream.update(border + (i % 2 ? 0.3 : -0.3), a.z, 6);
    pump(stream, border + 0.3, a.z, () => stream.stats().queued === 0 && !stream.stats().building);
    for (let i = 0; i < 30; i++) stream.update(border + (i % 2 ? 0.3 : -0.3), a.z, 6);
    const grown = stream.stats().resident;
    expect(grown).toBeLessThanOrEqual(30);
    const settled = stream.group.children.map((c) => c.uuid).sort();
    for (let i = 0; i < 30; i++) stream.update(border + (i % 2 ? 0.3 : -0.3), a.z, 6);
    expect(stream.group.children.map((c) => c.uuid).sort()).toEqual(settled);
    expect(before.length).toBeGreaterThan(0);
    stream.dispose();
  }, 120_000);

  it("dispose zwalnia wszystkie sektory i można utworzyć strumień ponownie (wielokrotne wejście do lasu)", () => {
    for (let round = 0; round < 3; round++) {
      const { forest, stream } = setup("LOW", 2);
      const p = at(forest, 2 + round, 3);
      stream.prepareInitial(p.x, p.z);
      pump(stream, p.x, p.z, () => stream.initialReady());
      expect(stream.stats().resident).toBeGreaterThan(0);
      stream.dispose();
      expect(stream.group.children).toHaveLength(0);
      expect(stream.stats().resident).toBe(0);
      expect(stream.update(p.x, p.z, 5)).toBe(false);
    }
  }, 120_000);

  it("wszystkie modele lasu są wykryte do wczytania przed streamingiem (bez ukrytych odmian)", () => {
    const ids = forestModelIds(forestOf(SEED));
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
    const forest = forestOf(SEED);
    const seen = new Set<string>();
    for (const sector of forest.allSectors()) for (const b of batchesFor(sector.objects).batches) seen.add(b.modelId);
    expect([...seen].sort()).toEqual(ids);
  });
});

describe("F1: szwy między płytkami gruntu", () => {
  const meanPatch = (data: Uint8Array, size: number, mpp: number, minX: number, minZ: number, x0: number, z0: number, w: number, h: number) => {
    const sum = [0, 0, 0];
    let n = 0;
    const i0 = Math.floor((x0 - minX) / mpp);
    const i1 = Math.ceil((x0 + w - minX) / mpp);
    const j0 = Math.floor((z0 - minZ) / mpp);
    const j1 = Math.ceil((z0 + h - minZ) / mpp);
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const k = (j * size + i) * 4;
        sum[0] += data[k];
        sum[1] += data[k + 1];
        sum[2] += data[k + 2];
        n++;
      }
    }
    return sum.map((v) => v / n);
  };

  it("tekstury sąsiednich sektorów zgadzają się na wspólnej krawędzi (zapas TILE_PAD zastępuje brakujące dane)", () => {
    const forest = forestOf(SEED);
    const size = TILE_PIXELS.LOW;
    const build = (ix: number, iz: number) => {
      const sector = forest.sector(ix, iz);
      const bounds = tileTextureBounds(sector.bounds, TILE_PAD);
      const objects = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) objects.push(...forest.sector(ix + dx, iz + dz).objects);
      const b = createGroundBuilder({ forest, bounds, objects, size, style: STYLE });
      let done = false;
      while (!done) done = b.step(64);
      return { data: b.data, mpp: b.metersPerPixel, bounds };
    };
    const west = build(4, 4);
    const east = build(5, 4);
    const edgeX = forest.sector(4, 4).bounds.maxX;
    const minZ = forest.sector(4, 4).bounds.minZ;
    let worst = 0;
    for (let z = minZ + 1; z < minZ + 28; z += 3) {
      const a = meanPatch(west.data, size, west.mpp, west.bounds.minX, west.bounds.minZ, edgeX - 0.8, z, 1.6, 2);
      const b = meanPatch(east.data, size, east.mpp, east.bounds.minX, east.bounds.minZ, edgeX - 0.8, z, 1.6, 2);
      worst = Math.max(worst, Math.max(...a.map((v, i) => Math.abs(v - b[i]))));
    }
    expect(worst).toBeLessThan(5);
  }, 60_000);
});
