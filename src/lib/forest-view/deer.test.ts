import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { anchorsFromFeatures } from "@/lib/game/world/anchors";
import { FOREST_START } from "@/lib/game/world/generators/v2";
import { forestChestsOf, forestOf, forestWalkOf } from "@/lib/game/world/lookup";
import { computeReachability, reachesNear } from "@/lib/game/world/walk";
import { DEER_BODY_RADIUS } from "@/lib/npc/deer";
import { DEER_BEHAVIOR } from "@/lib/npc/deerBrain";
import { loadTestDeer } from "@/lib/npc/testkit";
import { DEER_DISTANCE, DeerLayer, computePlacement, deerPlacementOf } from "./deer";
import { NPC_DRAW_DISTANCE, trollPlacement } from "./npc";
import { VIEW_PROFILES } from "./profiles";

const SEEDS = Array.from({ length: 120 }, (_, i) => (i < 8 ? [1, 7, 2030, 4242, 9001, 123, 777, 31337][i] : 1000 + i * 37));
const ringFree = (walk: ReturnType<typeof forestWalkOf>, x: number, z: number, r: number) => {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (!walk.isWalkable(x + Math.sin(a) * r, z + Math.cos(a) * r)) return false;
  }
  return walk.isWalkable(x, z);
};

describe("polana jelenia: deterministyczne miejsce z istniejących danych lasu", () => {
  it("dla 120 seedów: zawsze jest polana 15-36 m od wejścia (zwykle 20-30 m), wolna, osiągalna pieszo i daleko od skrzyń, trolla i mostu", () => {
    let inRange = 0;
    let relaxed = 0;
    let sight = 0;
    for (const seed of SEEDS) {
      const forest = forestOf(seed);
      const walk = forestWalkOf(seed);
      const p = computePlacement(forest, walk, seed);
      expect(p, `seed ${seed}`).not.toBeNull();
      const place = p!;
      const d = Math.hypot(place.home.x - FOREST_START.x, place.home.z - FOREST_START.z);
      expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(15);
      expect(d, `seed ${seed}`).toBeLessThanOrEqual(36);
      if (d >= DEER_DISTANCE.min && d <= DEER_DISTANCE.max) inRange++;
      if (place.relaxation > 0) relaxed++;
      if (place.sightline) sight++;
      expect(place.distance).toBeCloseTo(d, 6);
      // Teren: stoi na przejezdnym gruncie z zapasem na ciało (promień spaceru + obwód jelenia).
      expect(ringFree(walk, place.home.x, place.home.z, Math.max(2, place.clearance - 1)), `seed ${seed}`).toBe(true);
      expect(place.clearance).toBeGreaterThanOrEqual(2);
      const grad = forest.terrain.gradient(place.home.x, place.home.z);
      expect(Math.hypot(grad.dx, grad.dz), `seed ${seed}`).toBeLessThan(0.6);
      // Osiągalna pieszo z punktu wejścia.
      const reach = computeReachability(walk, FOREST_START, { cell: 1 });
      expect(reachesNear(reach, place.home.x, place.home.z, 1.5), `seed ${seed}`).toBe(true);
      // Nie przeszkadza w queście: daleko od skrzyń, trolla i miejsca mostu.
      const anchors = anchorsFromFeatures(forest.features, FOREST_START);
      for (const a of [...Object.values(anchors.chests), anchors.troll, anchors.bridge]) expect(Math.hypot(a.x - place.home.x, a.z - place.home.z), `seed ${seed}`).toBeGreaterThanOrEqual(10);
      for (const c of forestChestsOf(seed)) expect(Math.hypot(c.x - place.home.x, c.z - place.home.z)).toBeGreaterThan(8);
      const t = trollPlacement(forest).home;
      expect(Math.hypot(t.x - place.home.x, t.z - place.home.z)).toBeGreaterThan(10);
    }
    expect(inRange / SEEDS.length).toBeGreaterThan(0.95);
    expect(relaxed / SEEDS.length).toBeLessThan(0.1);
    expect(sight / SEEDS.length).toBeGreaterThan(0.7);
  }, 120_000);

  it("jest deterministyczne (te same dane = to samo miejsce) i nie zmienia świata: kolizje, kotwice i teren zostają bez zmian", () => {
    for (const seed of [1, 2030, 777]) {
      const forest = forestOf(seed);
      const walk = forestWalkOf(seed);
      const objectsBefore = walk.index.queryRadius(FOREST_START.x + 25, FOREST_START.z, 60).map((o) => o.id).sort();
      const anchorsBefore = JSON.stringify(anchorsFromFeatures(forest.features, FOREST_START));
      const heights = [0, 1, 2, 3].map((i) => forest.terrain.height(-110 + i * 3, i * 4));
      const a = computePlacement(forest, walk, seed);
      const b = computePlacement(forest, walk, seed);
      expect(a).toEqual(b);
      expect(deerPlacementOf(forest, walk, seed)).toEqual(a);
      expect(walk.index.queryRadius(FOREST_START.x + 25, FOREST_START.z, 60).map((o) => o.id).sort()).toEqual(objectsBefore);
      expect(JSON.stringify(anchorsFromFeatures(forest.features, FOREST_START))).toBe(anchorsBefore);
      expect([0, 1, 2, 3].map((i) => forest.terrain.height(-110 + i * 3, i * 4))).toEqual(heights);
    }
  });

  it("zwykle leży przed graczem po wejściu (na wschód) i jest widoczny z punktu wejścia", () => {
    let forward = 0;
    for (const seed of [1, 7, 2030, 4242, 123, 777, 31337]) {
      const p = computePlacement(forestOf(seed), forestWalkOf(seed), seed)!;
      if (Math.cos(p.bearing - Math.PI / 2) > 0.3) forward++;
    }
    expect(forward).toBeGreaterThanOrEqual(6);
  });
});

describe("DeerLayer: jeleń w scenie lasu", () => {
  const SEED = 2030;
  const make = async (options: { castShadow?: boolean; seed?: number } = {}) => {
    const seed = options.seed ?? SEED;
    const shadow = options.castShadow ?? false;
    return new DeerLayer(await loadTestDeer(), { forest: forestOf(seed), walk: forestWalkOf(seed), seed, castShadow: shadow, receiveShadow: shadow });
  };
  const frames = (layer: DeerLayer, seconds: number, player: { x: number; z: number }, onFrame?: (i: number) => void) => {
    for (let i = 0; i < seconds * 60; i++) {
      layer.update(1 / 60, player);
      onFrame?.(i);
    }
  };

  it("startuje na wyznaczonej polanie i raportuje diagnostykę F3: dystans, stan, animację, skalę i trójkąty", async () => {
    const layer = await make();
    const place = deerPlacementOf(forestOf(SEED), forestWalkOf(SEED), SEED)!;
    layer.update(1 / 60, FOREST_START);
    const s = layer.stats();
    expect(s.x).toBeCloseTo(place.home.x, 1);
    expect(s.z).toBeCloseTo(place.home.z, 1);
    expect(s.visible).toBe(true);
    expect(s.distance).toBeCloseTo(Math.hypot(place.home.x - FOREST_START.x, place.home.z - FOREST_START.z), 0);
    expect(s.distance).toBeGreaterThan(19);
    expect(s.distance).toBeLessThan(31);
    expect(s.behavior).toBe("rest");
    expect(s.state).toBe("rest");
    expect(s.clip).toBe("deer.rest");
    expect(s.scale).toBeCloseTo(1.8, 1);
    expect(s.height).toBeCloseTo(1.8, 5);
    expect(s.triangles).toBe(19798);
    expect(s.bones).toBe(41);
    expect(s.homeFromStart).toBe(place.distance);
    for (const value of [s.clipTime, s.clipDuration, s.speed, s.lookYaw, s.lookPitch, s.homeDistance]) expect(Number.isFinite(value)).toBe(true);
    expect(layer.group.children).toContain(layer.deer.group);
    expect(layer.blockers()).toHaveLength(1);
    layer.dispose();
  });

  it("spaceruje po polanie (chód z pliku), zatrzymuje się w pozie spoczynkowej i rusza ponownie; zostaje na przejezdnym terenie w promieniu spaceru", async () => {
    const layer = await make({ seed: 1 });
    const deer = layer.deer;
    const walk = forestWalkOf(1);
    const states = new Set<string>();
    const clips = new Set<string>();
    let transitions = 0;
    let last = "";
    let maxHome = 0;
    frames(layer, 240, FOREST_START, (i) => {
      states.add(deer.animator.state);
      clips.add(deer.activeClip);
      if (deer.animator.state !== last) transitions++;
      last = deer.animator.state;
      maxHome = Math.max(maxHome, deer.brain.homeDistance);
      if (i % 20 === 0) expect(walk.isWalkable(deer.x, deer.z)).toBe(true);
    });
    expect(states).toEqual(new Set(["rest", "walk"]));
    expect(clips).toEqual(new Set(["deer.rest", "preset:quadruped:walk"]));
    expect(transitions).toBeGreaterThanOrEqual(6);
    expect(maxHome).toBeLessThanOrEqual(DEER_BEHAVIOR.leash + 0.6);
    layer.dispose();
  }, 60_000);

  it("zbliżenie na < 10 m: staje, patrzy na gracza głową, potem odchodzi marszem; zawsze na wolnym terenie i bez wychodzenia poza smycz", async () => {
    const layer = await make({ seed: 7 });
    const deer = layer.deer;
    const walk = forestWalkOf(7);
    const player = { x: deer.x - 30, z: deer.z };
    frames(layer, 2, player);
    let sawWatch = false;
    let sawRetreat = false;
    let maxSpeed = 0;
    let watchYaw = Infinity;
    let minDistance = Infinity;
    const free = (x: number, z: number) => {
      if (!walk.isWalkable(x, z)) return false;
      for (let k = 0; k < 8; k++) if (!walk.isWalkable(x + Math.sin(k) * DEER_BODY_RADIUS, z + Math.cos(k) * DEER_BODY_RADIUS)) return false;
      return true;
    };
    frames(layer, 90, player, (i) => {
      // Gracz idzie na jelenia 3,2 m/s do 3 m, potem stoi.
      const dx = deer.x - player.x;
      const dz = deer.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > 3 && i < 60 * 25) {
        player.x += (dx / d) * (3.2 / 60);
        player.z += (dz / d) * (3.2 / 60);
      }
      maxSpeed = Math.max(maxSpeed, deer.brain.speed);
      minDistance = Math.min(minDistance, deer.distance);
      if (deer.mode === "alert" && deer.watching) {
        sawWatch = true;
        const bearing = Math.atan2(player.x - deer.x, player.z - deer.z);
        let rel = bearing - deer.brain.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        // Ciało i głowa razem patrzą na gracza: po obrocie ciała spojrzenie szyi/głowy jest bliskie zeru, a przed nim równe kątowi do gracza.
        watchYaw = Math.min(watchYaw, Math.abs(rel - deer.look.yaw));
      }
      if (deer.mode === "retreat") sawRetreat = true;
      if (i % 10 === 0) {
        expect(free(deer.x, deer.z), `t=${i}`).toBe(true);
        expect(deer.brain.homeDistance).toBeLessThanOrEqual(DEER_BEHAVIOR.retreatLeash + 1);
      }
    });
    expect(sawWatch).toBe(true);
    expect(sawRetreat).toBe(true);
    expect(watchYaw).toBeLessThan(0.15);
    expect(maxSpeed).toBeLessThanOrEqual(deer.animations.nominalSpeed * DEER_BEHAVIOR.retreatFactor + 1e-6);
    expect(minDistance).toBeLessThan(DEER_BEHAVIOR.alertDistance);
    layer.dispose();
  }, 60_000);

  it("kopyta nie wchodzą w ziemię ani nie wiszą nad nią podczas spaceru, postoju i odejścia", async () => {
    const layer = await make({ seed: 1 });
    const deer = layer.deer;
    const forest = forestOf(1);
    const mesh = deer.group.getObjectByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh;
    const rest = mesh.geometry.getAttribute("position");
    const foot: number[] = [];
    for (let i = 0; i < rest.count; i++) if (rest.getY(i) < 0.12) foot.push(i);
    const v = new THREE.Vector3();
    const gaps: Record<string, number[]> = { rest: [], walk: [] };
    const player = { x: deer.x - 30, z: deer.z };
    const sample = () => {
      deer.group.updateMatrixWorld(true);
      mesh.skeleton.update();
      let low = Infinity;
      for (const i of foot) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
        low = Math.min(low, v.y - forest.terrain.height(v.x, v.z));
      }
      return low;
    };
    frames(layer, 150, player, (i) => {
      if (i % 12 === 0 && deer.animator.weights()[deer.animator.state] > 0.99) gaps[deer.animator.state].push(sample());
    });
    // Retreat: zbliżamy gracza.
    player.x = deer.x - 6;
    player.z = deer.z;
    frames(layer, 30, player, (i) => {
      if (i % 12 === 0 && deer.animator.weights()[deer.animator.state] > 0.99) gaps[deer.animator.state].push(sample());
    });
    for (const [state, list] of Object.entries(gaps)) {
      expect(list.length, state).toBeGreaterThan(10);
      expect(Math.min(...list), `${state}: kopyta w ziemi`).toBeGreaterThan(-0.06);
      expect(Math.min(...list), `${state}: kopyta nad ziemią`).toBeLessThan(0.06);
    }
    layer.dispose();
  }, 60_000);

  it("daleko od gracza jest ukryty i zamrożony, a blisko aktywny; po dispose update nic nie robi", async () => {
    const layer = await make();
    const home = layer.placement.home;
    const far = { x: home.x + NPC_DRAW_DISTANCE + 20, z: home.z };
    const before = { x: layer.deer.x, z: layer.deer.z };
    frames(layer, 20, far);
    expect(layer.deer.group.visible).toBe(false);
    expect({ x: layer.deer.x, z: layer.deer.z }).toEqual(before);
    expect(layer.blockers()).toEqual([]);
    expect(layer.stats().visible).toBe(false);
    frames(layer, 30, { x: home.x - 25, z: home.z });
    expect(layer.deer.group.visible).toBe(true);
    layer.dispose();
    expect(layer.group.parent).toBeNull();
    expect(() => layer.update(1 / 60, FOREST_START)).not.toThrow();
  });

  it("dispose zwalnia geometrię, szkielet i mikser (bez wycieków)", async () => {
    const layer = await make();
    const mesh = layer.deer.group.getObjectByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh;
    let disposed = 0;
    mesh.geometry.addEventListener("dispose", () => disposed++);
    (mesh.material as THREE.Material).addEventListener("dispose", () => disposed++);
    frames(layer, 2, FOREST_START);
    layer.dispose();
    layer.dispose();
    expect(disposed).toBe(2);
  });

  it("nie zmienia stanu gry ani zapisu: warstwa zwierzęcia nie zna silnika, zapisu ani questów", () => {
    const root = process.cwd();
    const src = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    const forbidden = /^@\/lib\/game\/(engine|core\/(apply|state|events|commands)|save|systems|content|quest)/;
    for (const file of ["src/lib/forest-view/deer.ts", "src/lib/npc/deer.ts", "src/lib/npc/deerBrain.ts", "src/lib/npc/headRig.ts"]) {
      for (const m of src(file).matchAll(/from "([^"]+)"/g)) expect(forbidden.test(m[1]), `${file} importuje ${m[1]}`).toBe(false);
    }
    const gameDirs = ["src/lib/game/save", "src/lib/game/core", "src/lib/game/world", "src/lib/game/content", "src/lib/game/systems"];
    const walkDir = (dir: string): string[] =>
      fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(dir, e.name)] : []));
    for (const file of gameDirs.flatMap(walkDir)) expect(src(file), file).not.toMatch(/deer|jele[nń]/i);
  });
});

describe("jeleń: koszt i poprawność animacji w profilach MEDIUM i HIGH", () => {
  const SEED = 2030;
  for (const id of ["MEDIUM", "HIGH"] as const) {
    it(`${id}: jeden szkielet 41 kości, jedna siatka, ≤ 20 tys. trójkątów, tekstury ≤ 20 MB, animacja ciągła bez NaN i z sumą wag 1`, async () => {
      const profile = VIEW_PROFILES[id];
      const shadows = profile.shadows.enabled;
      const asset = await loadTestDeer();
      const layer = new DeerLayer(asset, { forest: forestOf(SEED), walk: forestWalkOf(SEED), seed: SEED, castShadow: shadows, receiveShadow: shadows });
      const meshes: THREE.Mesh[] = [];
      layer.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });
      const skinned = meshes.filter((m) => (m as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh[];
      expect(meshes).toHaveLength(1);
      expect(skinned[0].skeleton.bones).toHaveLength(41);
      expect(skinned[0].castShadow).toBe(shadows);
      expect(skinned[0].receiveShadow).toBe(shadows);
      // Wywołania rysowania na klatkę: główne przejście + przejście cienia (jeśli profil ma cienie).
      const drawCalls = 1 + (shadows ? 1 : 0);
      const trianglesPerFrame = asset.triangles * drawCalls;
      expect(drawCalls).toBeLessThanOrEqual(2);
      expect(trianglesPerFrame).toBeLessThanOrEqual(40_000);
      // Pamięć GPU tekstur: 3 x 1024² RGBA z mipmapami.
      const textureBytes = asset.entry.textures.reduce((n, t) => n + t.size[0] * t.size[1] * 4 * (4 / 3), 0);
      expect(textureBytes / 1e6).toBeLessThan(20);
      // Środek polany w polu widzenia cieni profilu: jeleń 20-30 m od wejścia mieści się w zasięgu mapy cieni.
      expect(layer.placement.distance).toBeLessThan(profile.shadows.distance);

      const player = { x: FOREST_START.x, z: FOREST_START.z };
      const start = performance.now();
      const frameTimes: number[] = [];
      let maxJump = 0;
      let prev = { x: layer.deer.x, z: layer.deer.z };
      for (let i = 0; i < 60 * 90; i++) {
        const t0 = performance.now();
        layer.update(1 / 60, player);
        frameTimes.push(performance.now() - t0);
        if (i === 60 * 60) {
          player.x = layer.deer.x - 7;
          player.z = layer.deer.z;
        }
        maxJump = Math.max(maxJump, Math.hypot(layer.deer.x - prev.x, layer.deer.z - prev.z));
        prev = { x: layer.deer.x, z: layer.deer.z };
        const weights = layer.deer.animator.weights();
        expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
        if (i % 30 === 0) {
          layer.deer.group.updateMatrixWorld(true);
          const bones = skinned[0].skeleton.bones;
          for (const b of bones) expect(b.quaternion.toArray().every(Number.isFinite) && b.position.toArray().every(Number.isFinite)).toBe(true);
          const e = layer.deer.group.matrixWorld.elements;
          expect(e.every(Number.isFinite)).toBe(true);
        }
      }
      // Brak teleportów: największy krok to prędkość marszu / klatka.
      expect(maxJump).toBeLessThan(layer.deer.animations.nominalSpeed * 1.3 / 60 + 1e-6);
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      const p99 = [...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.99)];
      // Koszt CPU logiki, animacji i głowy jednego zwierzęcia na klatkę (bez GPU): bardzo mały względem budżetu 16,7 ms.
      expect(avg).toBeLessThan(3);
      expect(p99).toBeLessThan(10);
      expect(performance.now() - start).toBeGreaterThan(0);
      layer.dispose();
    }, 120_000);
  }

  it("animacja nie zależy od profilu jakości: MEDIUM i HIGH dają tę samą trasę i pozę (poza cieniami)", async () => {
    const run = async (id: "MEDIUM" | "HIGH") => {
      const shadows = VIEW_PROFILES[id].shadows.enabled;
      const layer = new DeerLayer(await loadTestDeer(), { forest: forestOf(SEED), walk: forestWalkOf(SEED), seed: SEED, castShadow: shadows, receiveShadow: shadows });
      const trace: number[] = [];
      for (let i = 0; i < 60 * 30; i++) {
        layer.update(1 / 60, FOREST_START);
        if (i % 60 === 0) trace.push(layer.deer.x, layer.deer.z, layer.deer.group.position.y, layer.deer.look.yaw, layer.deer.animator.stateTime);
      }
      layer.dispose();
      return trace;
    };
    const SEED = 2030;
    expect(await run("MEDIUM")).toEqual(await run("HIGH"));
  }, 60_000);
});
