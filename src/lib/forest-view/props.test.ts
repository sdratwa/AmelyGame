import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { loadChestAsset, type ChestAsset } from "@/lib/assets/props";
import { forestChestsOf, forestOf } from "@/lib/game/world/lookup";
import { CHEST_DRAW_DISTANCE, CHEST_OPEN_SECONDS, ChestLayer, FxBurst, openEase } from "./props";

const SEED = 2030;
const DIR = path.join(process.cwd(), "public/props");
const loader = new GLTFLoader();
const readJson = async (url: string) => JSON.parse(fs.readFileSync(path.join(DIR, url.replace(/^\/props\//, "")), "utf8"));
const readGlb = async (url: string) => {
  const buf = fs.readFileSync(path.join(DIR, url.replace(/^\/props\//, "")));
  return loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "");
};

let asset: ChestAsset;
beforeAll(async () => {
  asset = await loadChestAsset({ loadJson: readJson, loadGlb: readGlb });
});

const makeLayer = () => {
  const placements = [...forestChestsOf(SEED)];
  return { layer: new ChestLayer(asset, placements, { castShadow: false, receiveShadow: false }), placements };
};

const lidAngleOf = (layer: ChestLayer, id: string) => {
  const m = layer.lidMatrix(id)!;
  const body = layer.bodyMatrix(id)!;
  const rel = body.clone().invert().multiply(m);
  const q = new THREE.Quaternion();
  rel.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return new THREE.Euler().setFromQuaternion(q, "XYZ").x;
};

describe("M1: animacja pokrywy skrzyni", () => {
  it("openEase: zaczyna od 0, kończy dokładnie na 1, jest ograniczone i ma niewielkie przeszarżowanie", () => {
    expect(openEase(0)).toBe(0);
    expect(openEase(1)).toBe(1);
    expect(openEase(-3)).toBe(0);
    expect(openEase(9)).toBe(1);
    let max = 0;
    for (let t = 0; t <= 1; t += 0.01) max = Math.max(max, openEase(t));
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(1.1);
  });

  it("czas otwierania mieści się w 0,7-1,0 s", () => {
    expect(CHEST_OPEN_SECONDS).toBeGreaterThanOrEqual(0.7);
    expect(CHEST_OPEN_SECONDS).toBeLessThanOrEqual(1);
  });

  it("dwie siatki instancjonowane (korpus, pokrywy) = dwa wywołania rysowania dla wszystkich skrzyń", () => {
    const { layer, placements } = makeLayer();
    const p = placements[0];
    layer.update(0, { x: p.x, z: p.z });
    const meshes: THREE.InstancedMesh[] = [];
    layer.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o as THREE.InstancedMesh);
    });
    expect(meshes).toHaveLength(2);
    expect(layer.ids).toHaveLength(3);
    layer.dispose();
  });

  it("pokrywa otwiera się płynnie wokół zawiasu do pełnego kąta i zostaje otwarta; zawias się nie przesuwa", () => {
    const { layer, placements } = makeLayer();
    const target = placements[0];
    layer.update(0, { x: target.x, z: target.z });
    expect(lidAngleOf(layer, target.id)).toBeCloseTo(0, 5);
    const hingeWorld = (id: string) => new THREE.Vector3().setFromMatrixPosition(layer.lidMatrix(id)!);
    const hingeBefore = hingeWorld(target.id);

    layer.setOpened((id) => id === target.id, true);
    const angles: number[] = [];
    let t = 0;
    while (layer.isAnimating() && t < 3) {
      layer.update(1 / 60, { x: target.x, z: target.z });
      angles.push(lidAngleOf(layer, target.id));
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(0.6);
    expect(t).toBeLessThan(1.05);
    const full = (asset.entry.openAngleDeg * Math.PI) / 180;
    expect(angles[angles.length - 1]).toBeCloseTo(full, 3);
    expect(Math.abs(angles[0])).toBeLessThan(Math.abs(full) * 0.1);
    // Kąt rośnie w kierunku pełnego otwarcia (bez gwałtownych skoków), z jedynym przeszarżowaniem tuż przed końcem.
    const steps = angles.slice(1).map((a, i) => Math.abs(a) - Math.abs(angles[i]));
    expect(Math.max(...steps)).toBeLessThan(Math.abs(full) * 0.12);
    expect(hingeWorld(target.id).distanceTo(hingeBefore)).toBeLessThan(1e-4);

    for (let i = 0; i < 120; i++) layer.update(1 / 60, { x: target.x, z: target.z });
    expect(lidAngleOf(layer, target.id)).toBeCloseTo(full, 4);
    expect(layer.openness(target.id)).toBe(1);
    layer.dispose();
  });

  it("skrzynie otwierają się niezależnie: otwarcie jednej nie rusza pokryw pozostałych", () => {
    const { layer, placements } = makeLayer();
    const c = placements[1];
    layer.update(0);
    layer.setOpened((id) => id === c.id, true);
    for (let i = 0; i < 100; i++) layer.update(1 / 60);
    for (const p of placements) expect(layer.openness(p.id)).toBe(p.id === c.id ? 1 : 0);
    layer.setOpened((id) => id === c.id || id === placements[2].id, true);
    layer.update(1 / 60);
    expect(layer.openness(placements[2].id)).toBeGreaterThan(0);
    expect(layer.openness(placements[2].id)).toBeLessThan(1);
    expect(layer.openness(c.id)).toBe(1);
    expect(layer.openness(placements[0].id)).toBe(0);
    layer.dispose();
  });

  it("wczytanie zapisu ustawia otwarte pokrywy od razu, bez animacji, a ponowne ustawienie niczego nie restartuje", () => {
    const { layer, placements } = makeLayer();
    const started = layer.setOpened((id) => id === placements[0].id, false);
    expect(started).toEqual([]);
    expect(layer.isAnimating()).toBe(false);
    layer.update(0);
    expect(layer.openness(placements[0].id)).toBe(1);
    expect(layer.setOpened((id) => id === placements[0].id, true)).toEqual([]);
    expect(layer.isAnimating()).toBe(false);
    layer.dispose();
  });

  it("zamknięta pokrywa leży na korpusie: pivot zawiasu na górnej krawędzi, bez wiszenia nad terenem", () => {
    const { layer, placements } = makeLayer();
    const forest = forestOf(SEED);
    const p = placements[0];
    layer.update(0, { x: p.x, z: p.z });
    const body = layer.bodyMatrix(p.id)!;
    const base = new THREE.Vector3().setFromMatrixPosition(body);
    expect(base.y).toBeCloseTo(p.y, 4);
    expect(p.y).toBeLessThanOrEqual(forest.terrain.height(p.x, p.z) + 1e-6);
    expect(forest.terrain.height(p.x, p.z) - p.y).toBeLessThan(0.45);
    layer.dispose();
  });

  it("skrzynie dalej niż limit dystansu nie są rysowane", () => {
    const { layer, placements } = makeLayer();
    layer.update(0, { x: placements[0].x + CHEST_DRAW_DISTANCE * 3, z: placements[0].z });
    expect(layer.visibleCount).toBe(0);
    layer.update(0, { x: placements[0].x + CHEST_DRAW_DISTANCE * 3 + 4, z: placements[0].z });
    layer.update(0, { x: placements[0].x, z: placements[0].z });
    expect(layer.visibleCount).toBeGreaterThanOrEqual(1);
    layer.dispose();
  });
});

describe("M1: efekt cząstek", () => {
  it("jedno wywołanie rysowania, bufor kołowy ograniczony, cząstki wygasają", () => {
    const fx = new FxBurst();
    expect(fx.points.visible).toBe(false);
    for (let i = 0; i < 20; i++) fx.spawn("wood", 1, 1, 1);
    expect(fx.aliveCount).toBeLessThanOrEqual(FxBurst.CAPACITY);
    expect(fx.points.visible).toBe(true);
    for (let i = 0; i < 200; i++) fx.update(1 / 30);
    expect(fx.aliveCount).toBe(0);
    expect(fx.points.visible).toBe(false);
    fx.dispose();
  });
});
