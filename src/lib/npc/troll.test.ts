import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { sceneNodeName, type TrollAsset } from "@/lib/assets/characters";
import { trollPlacement } from "@/lib/forest-view/npc";
import { FirstPersonController } from "@/lib/forest-view/controller";
import { chestCollider } from "@/lib/game/world/chests";
import { forestChestsOf, forestOf, forestWalkOf } from "@/lib/game/world/lookup";
import { NpcAnimator } from "./animator";
import { loadTestTroll } from "./testkit";
import { buildTrollAnimations, TROLL_PATROL_RADIUS, TROLL_RADIUS, TrollNpc } from "./troll";

const SEEDS = [1, 7, 2030, 4242, 9001];
let asset: TrollAsset;

beforeEach(async () => {
  asset = await loadTestTroll();
});

const makeNpc = (seed: number, shadows = false) => {
  const forest = forestOf(seed);
  const place = trollPlacement(forest);
  const npc = new TrollNpc({ asset, walk: forestWalkOf(seed), terrain: forest.terrain, home: place.home, faceTo: place.faceTo, seed, castShadow: shadows, receiveShadow: shadows });
  return { npc, forest, place };
};

const FAR = (home: { x: number; z: number }) => ({ x: home.x + 40, z: home.z });

describe("troll w lesie: umieszczenie i patrol", () => {
  it("stoi w miejscu kotwicy W1b i patroluje w jej pobliżu po terenie, którym da się chodzić (wiele seedów)", () => {
    for (const seed of SEEDS) {
      const { npc, place } = makeNpc(seed);
      expect(npc.group.position.x).toBeCloseTo(place.home.x, 6);
      expect(npc.group.position.z).toBeCloseTo(place.home.z, 6);
      expect(npc.route.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      const walk = forestWalkOf(seed);
      let moved = 0;
      for (let i = 0; i < 60 * 150; i++) {
        npc.update(1 / 60, FAR(place.home));
        const d = Math.hypot(npc.x - place.home.x, npc.z - place.home.z);
        expect(d, `seed ${seed}`).toBeLessThanOrEqual(TROLL_PATROL_RADIUS + 1e-6);
        if (i % 30 === 0) expect(walk.isWalkable(npc.x, npc.z), `seed ${seed} t=${i / 60}`).toBe(true);
        if (npc.patrol.mode === "walk") moved++;
      }
      expect(moved / 60, `seed ${seed}`).toBeGreaterThan(20);
    }
  });

  it("nie wchodzi w skrzynię, którą pilnuje (ani w jej collider)", () => {
    for (const seed of SEEDS) {
      const { npc, place } = makeNpc(seed);
      const guarded = forestChestsOf(seed).find((c) => Math.hypot(c.x - place.faceTo.x, c.z - place.faceTo.z) < 1e-6)!;
      const collider = chestCollider(guarded).collider!;
      expect(collider.shape).toBe("box");
      let minDist = Infinity;
      for (let i = 0; i < 60 * 150; i++) {
        npc.update(1 / 60, FAR(place.home));
        minDist = Math.min(minDist, Math.hypot(npc.x - guarded.x, npc.z - guarded.z));
      }
      expect(minDist, `seed ${seed}`).toBeGreaterThan(0.9);
    }
  });

  it("patrol jest deterministyczny: ten sam seed daje tę samą trasę i te same pozycje", async () => {
    const a = makeNpc(2030);
    const other = await loadTestTroll();
    const forest = forestOf(2030);
    const place = trollPlacement(forest);
    const b = new TrollNpc({ asset: other, walk: forestWalkOf(2030), terrain: forest.terrain, home: place.home, faceTo: place.faceTo, seed: 2030, castShadow: false, receiveShadow: false });
    expect(b.route).toEqual(a.npc.route);
    for (let i = 0; i < 60 * 40; i++) {
      a.npc.update(1 / 60, FAR(place.home));
      b.update(1 / 60, FAR(place.home));
    }
    expect([b.x, b.z, b.patrol.yaw]).toEqual([a.npc.x, a.npc.z, a.npc.patrol.yaw]);
  });

  it("początkowo patrzy ku pilnowanej skrzyni", () => {
    const { npc, place } = makeNpc(2030);
    const expected = Math.atan2(place.faceTo.x - place.home.x, place.faceTo.z - place.home.z);
    expect(npc.patrol.yaw).toBeCloseTo(expected, 6);
    expect(npc.group.rotation.y).toBeCloseTo(expected, 6);
  });
});

/** Wysokość świata najniższych punktów stóp: dolne 16% siatki w pozie wiązania (jak w `lowestPointOver`). */
const footVertices = (npc: TrollNpc): number[] => {
  npc.group.updateMatrixWorld(true);
  asset.skinned.skeleton.update();
  const v = new THREE.Vector3();
  const ys: number[] = [];
  const count = asset.skinned.geometry.getAttribute("position").count;
  for (let i = 0; i < count; i++) {
    asset.skinned.getVertexPosition(i, v);
    ys.push(v.applyMatrix4(asset.skinned.matrixWorld).y);
  }
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  return ys.flatMap((y, i) => (y < min + (max - min) * 0.16 ? [i] : []));
};

describe("troll: skala, teren i stopy", () => {
  it("ma ok. 2,7 m wysokości po skali świata w pozie spoczynkowej", () => {
    const { npc } = makeNpc(2030);
    npc.update(1 / 60, FAR({ x: 0, z: 0 }));
    npc.group.updateMatrixWorld(true);
    asset.skinned.skeleton.update();
    const v = new THREE.Vector3();
    const pos = asset.skinned.geometry.getAttribute("position");
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pos.count; i += 3) {
      asset.skinned.getVertexPosition(i, v);
      v.applyMatrix4(asset.skinned.matrixWorld);
      min = Math.min(min, v.y);
      max = Math.max(max, v.y);
    }
    expect(max - min).toBeGreaterThan(2.45);
    expect(max - min).toBeLessThan(2.95);
    expect(npc.scale).toBeCloseTo(2.7 / 0.0094904, 1);
  });

  it("cała postać jest skalowana jednolicie: skala grupy jest jedna, a kości nie mają własnej skali", () => {
    const { npc } = makeNpc(2030);
    expect(npc.group.scale.x).toBe(npc.group.scale.y);
    expect(npc.group.scale.y).toBe(npc.group.scale.z);
    for (const bone of asset.skinned.skeleton.bones) expect(bone.scale.toArray().map((x) => Math.round(x * 1e4) / 1e4)).toEqual([1, 1, 1]);
  });

  it("stopy nie wchodzą w teren w żadnej fazie: patrol, alert, zauważenie, Happy, Dance i Angry (wiele seedów, zbocza)", () => {
    for (const seed of SEEDS) {
      const { npc, place, forest } = makeNpc(seed);
      const foot = footVertices(npc);
      const v = new THREE.Vector3();
      let worstPenetration = 0;
      let maxFloat = 0;
      const seen = new Set<string>();
      const sample = () => {
        npc.group.updateMatrixWorld(true);
        asset.skinned.skeleton.update();
        let lowest = Infinity;
        for (const i of foot) {
          asset.skinned.getVertexPosition(i, v);
          v.applyMatrix4(asset.skinned.matrixWorld);
          const dh = v.y - forest.terrain.height(v.x, v.z);
          lowest = Math.min(lowest, dh);
        }
        worstPenetration = Math.max(worstPenetration, -lowest);
        maxFloat = Math.max(maxFloat, lowest);
        seen.add(npc.animator.state);
      };
      let player = { x: 0, z: 0 };
      const run = (seconds: number, at: { x: number; z: number }, hook?: (i: number) => void) => {
        for (let i = 0; i < 60 * seconds; i++) {
          hook?.(i);
          npc.update(1 / 60, at);
          if (i % 4 === 0) sample();
        }
      };
      run(25, FAR(place.home));
      player = { x: npc.x + 3, z: npc.z + 1 };
      run(12, player);
      expect(npc.encounterState, `seed ${seed}`).toBe("dialog");
      npc.resolveDialog("correct");
      run(22, player);
      npc.encounter.restart();
      run(14, player);
      expect(npc.encounterState, `seed ${seed}`).toBe("dialog");
      npc.resolveDialog("wrong");
      run(6, player);
      expect([...seen].sort(), `seed ${seed}`).toEqual(["angry", "dance", "happy", "idle", "nervous", "surprised", "walk"]);
      // Podczas płynnych przejść między pozami stopa bywa o kilka cm niżej niż średnia ważona przesunięć stanów (stopa ma ok. 0,4 m).
      expect(worstPenetration, `seed ${seed}`).toBeLessThan(0.1);
      expect(maxFloat, `seed ${seed}`).toBeLessThan(0.5);
    }
  }, 60_000);

  it("jeden materiał i jedna siatka ze skórą w scenie trolla; cień włączany przez profil", () => {
    const { npc } = makeNpc(2030, true);
    expect(asset.skinned.castShadow).toBe(true);
    npc.setShadows(false, false);
    expect(asset.skinned.castShadow).toBe(false);
    expect(asset.skinned.frustumCulled).toBe(false);
  });
});

describe("troll: chód bez ślizgania i bez podwójnego przesuwania", () => {
  /** `factor` mnoży prędkość NPC w świecie względem prędkości nominalnej klipu (1 = patrol, 0 = klip sam). */
  const measureSlip = (factor: number) => {
    const set = buildTrollAnimations(asset);
    const animator = new NpcAnimator(asset.scene, { clips: set.clips, states: set.states, base: "idle" });
    animator.setBase("walk");
    const speed = set.nominalSpeed;
    const toes = ["mixamorig:LeftToeBase", "mixamorig:RightToeBase"].map((n) => asset.scene.getObjectByName(sceneNodeName(n))!);
    const p = new THREE.Vector3();
    const series: { y: number; z: number }[][] = [[], []];
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 8; i++) {
      animator.update(dt);
      asset.scene.updateMatrixWorld(true);
      if (i < 60) continue;
      const npcZ = speed * factor * (i * dt);
      toes.forEach((toe, k) => {
        toe.getWorldPosition(p);
        series[k].push({ y: p.y * asset.scale, z: p.z * asset.scale + npcZ });
      });
    }
    const floor = Math.min(...series.flat().map((q) => q.y));
    const speeds: number[] = [];
    for (const s of series) {
      for (let i = 1; i < s.length - 1; i++) {
        if (s[i - 1].y - floor < 0.02 && s[i].y - floor < 0.02 && s[i + 1].y - floor < 0.02) speeds.push(Math.abs(s[i + 1].z - s[i - 1].z) / (2 * dt));
      }
    }
    speeds.sort((x, y) => x - y);
    animator.dispose();
    return { median: speeds.length > 0 ? speeds[Math.floor(speeds.length * 0.5)] : Infinity, contactFrames: speeds.length, speed, set };
  };

  it("Walk z pliku chodzi w miejscu: żadnego klipu nie trzeba poprawiać, a prędkość patrolu wynika z kroku stóp", () => {
    const { set } = measureSlip(1);
    expect(set.stripped).toEqual([]);
    for (const name of Object.values(set.hipsDrift)) expect(name).toBeLessThan(0.05);
    expect(set.nominalSpeed).toBeGreaterThan(0.6);
    expect(set.nominalSpeed).toBeLessThan(2);
  });

  it("stopa w kontakcie z ziemią prawie nie ślizga się, gdy NPC idzie z prędkością nominalną (animacja nie przesuwa postaci drugi raz)", () => {
    const patrol = measureSlip(1);
    expect(patrol.contactFrames).toBeGreaterThan(100);
    expect(patrol.median).toBeLessThan(patrol.speed * 0.4);
  });

  it("kontrola testu: gdyby postać była przesuwana dwa razy szybciej albo stała, stopa ślizgałaby się wielokrotnie bardziej", () => {
    const patrol = measureSlip(1);
    const doubled = measureSlip(2);
    const still = measureSlip(0);
    expect(doubled.median).toBeGreaterThan(doubled.speed * 0.7);
    expect(still.median).toBeGreaterThan(still.speed * 0.7);
    expect(doubled.median).toBeGreaterThan(patrol.median * 3);
    expect(still.median).toBeGreaterThan(patrol.median * 3);
  });

  it("pętla animacji nie powoduje skoku bioder w świecie (brak teleportu przy zawinięciu)", () => {
    const set = buildTrollAnimations(asset);
    const animator = new NpcAnimator(asset.scene, { clips: set.clips, states: set.states, base: "idle" });
    animator.setBase("walk");
    const hips = asset.scene.getObjectByName(sceneNodeName("mixamorig:Hips"))!;
    const p = new THREE.Vector3();
    let prev: THREE.Vector3 | null = null;
    let prevTime = 0;
    let maxJump = 0;
    let wraps = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 12; i++) {
      animator.update(dt);
      asset.scene.updateMatrixWorld(true);
      hips.getWorldPosition(p);
      const t = animator.stateTime;
      const world = new THREE.Vector3(p.x * asset.scale, p.y * asset.scale, p.z * asset.scale + set.nominalSpeed * i * dt);
      if (prev && i > 30) {
        maxJump = Math.max(maxJump, world.distanceTo(prev));
        if (t < prevTime) wraps++;
      }
      prev = world;
      prevTime = t;
    }
    expect(wraps).toBeGreaterThanOrEqual(5);
    expect(maxJump).toBeLessThan(0.06);
    animator.dispose();
  });
});

describe("troll: reakcja gniewu z gry (adapter zdarzeń) i powrót do spokoju", () => {
  it("angry z gry gra ok. 3,3 s w miejscu, potem troll wraca do patrolu", () => {
    const { npc, place } = makeNpc(2030);
    const far = FAR(place.home);
    for (let i = 0; i < 60 * 12; i++) npc.update(1 / 60, far);
    expect(npc.react("angry")).toBe(true);
    expect(npc.react("angry")).toBe(false);
    let angryFrames = 0;
    let stillFrom: { x: number; z: number } | null = null;
    for (let i = 0; i < 60 * 7; i++) {
      npc.update(1 / 60, far);
      if (npc.animator.state === "angry") {
        angryFrames++;
        if (angryFrames === 60) stillFrom = { x: npc.x, z: npc.z };
        if (stillFrom) expect(Math.hypot(npc.x - stillFrom.x, npc.z - stillFrom.z)).toBeLessThan(1e-6);
      }
    }
    expect(angryFrames / 60).toBeGreaterThan(3.0);
    expect(angryFrames / 60).toBeLessThan(3.6);
    expect(npc.animator.isReacting).toBe(false);
    expect(npc.encounterState).toBe("patrol");
    const at = { x: npc.x, z: npc.z };
    let farthest = 0;
    for (let i = 0; i < 60 * 40; i++) {
      npc.update(1 / 60, far);
      farthest = Math.max(farthest, Math.hypot(npc.x - at.x, npc.z - at.z));
    }
    expect(farthest).toBeGreaterThan(0.5);
  });

  it("wszystkie 7 stanów animacji z pliku jest dostępnych; Talk nie istnieje i nie jest udawany", () => {
    const { npc } = makeNpc(2030);
    for (const id of ["idle", "walk", "nervous", "surprised", "happy", "dance", "angry"]) expect(npc.has(id), id).toBe(true);
    expect(npc.has("talk")).toBe(false);
    expect(asset.clips.some((c) => /talk/i.test(c.name))).toBe(false);
  });
});

describe("troll: kolizja z graczem", () => {
  it("gracz nie wchodzi w trolla (okrąg kolizji), a przy próbie przejścia przez niego zatrzymuje się albo ślizga", () => {
    const seed = 2030;
    const { npc, place } = makeNpc(seed);
    const forest = forestOf(seed);
    const walk = forestWalkOf(seed);
    const start = { x: npc.x - 4, z: npc.z, yaw: -Math.PI / 2 };
    const controller = new FirstPersonController(walk, forest.terrain, start);
    controller.blockers = [npc.blocker()];
    for (let i = 0; i < 60 * 8; i++) {
      controller.update(1 / 60, { forward: 1, right: 0, sprint: false });
      const d = Math.hypot(controller.state.x - npc.x, controller.state.z - npc.z);
      expect(d).toBeGreaterThanOrEqual(TROLL_RADIUS + walk.config.playerRadius - 0.03);
    }
    expect(place.home).toBeDefined();
  });
});
