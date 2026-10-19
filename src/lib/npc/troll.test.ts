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
    expect(max - min).toBeLessThan(2.85);
    expect(npc.scale).toBeCloseTo(2.7 / 0.949, 2);
  });

  it("stopy nie wchodzą w teren w żadnej fazie idle, chodu i gniewu (wiele seedów, zbocza)", () => {
    for (const seed of SEEDS) {
      const { npc, place, forest } = makeNpc(seed);
      const foot: number[] = [];
      const pos = asset.skinned.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0.15) foot.push(i);
      const v = new THREE.Vector3();
      let worstPenetration = 0;
      let maxFloat = 0;
      const sample = () => {
        npc.group.updateMatrixWorld(true);
        asset.skinned.skeleton.update();
        let lowest = Infinity;
        for (const i of foot) {
          asset.skinned.getVertexPosition(i, v);
          v.applyMatrix4(asset.skinned.matrixWorld);
          const ground = forest.terrain.height(v.x, v.z);
          lowest = Math.min(lowest, v.y - ground);
        }
        worstPenetration = Math.max(worstPenetration, -lowest);
        maxFloat = Math.max(maxFloat, lowest);
      };
      for (let i = 0; i < 60 * 60; i++) {
        npc.update(1 / 60, FAR(place.home));
        if (i === 60 * 20) npc.react("angry");
        if (i % 5 === 0) sample();
      }
      // Dopuszczamy 2 cm zapasu na wygładzanie wysokości terenu i niewielkie różnice zbocza pod stopami.
      expect(worstPenetration, `seed ${seed}`).toBeLessThan(0.05);
      expect(maxFloat, `seed ${seed}`).toBeLessThan(0.5);
    }
  });

  it("jeden materiał i jedna siatka ze skórą w scenie trolla; cień włączany przez profil", () => {
    const { npc } = makeNpc(2030, true);
    expect(asset.skinned.castShadow).toBe(true);
    npc.setShadows(false, false);
    expect(asset.skinned.castShadow).toBe(false);
    expect(asset.skinned.frustumCulled).toBe(false);
  });
});

describe("troll: chód bez ślizgania i bez podwójnego przesuwania", () => {
  const measureSlip = (stripped: boolean, patrol = true) => {
    const set = buildTrollAnimations(asset);
    const walk = stripped ? set.clips.find((c) => c.name === "walk")! : asset.clips.find((c) => c.name === "walk")!;
    const animator = new NpcAnimator(asset.scene, {
      clips: [walk, set.clips.find((c) => c.name === "idle")!],
      states: [
        { id: "idle", clip: "idle", loop: true },
        { id: "walk", clip: "walk", loop: true, locomotion: true },
      ],
      base: "idle",
    });
    animator.setBase("walk");
    const speed = set.nominalSpeed;
    const toes = ["mixamorig:LeftToeBase", "mixamorig:RightToeBase"].map((n) => asset.scene.getObjectByName(sceneNodeName(n))!);
    const p = new THREE.Vector3();
    const series: { y: number; z: number }[][] = [[], []];
    const dt = 1 / 60;
    const total = 60 * 8;
    for (let i = 0; i < total; i++) {
      animator.update(dt);
      asset.scene.updateMatrixWorld(true);
      if (i < 60) continue;
      const npcZ = patrol ? speed * (i * dt) : 0;
      toes.forEach((toe, k) => {
        toe.getWorldPosition(p);
        series[k].push({ y: p.y * asset.scale, z: p.z * asset.scale + npcZ });
      });
    }
    // Kontakt z ziemią: kość palców tuż nad podłogą modelu i obie sąsiednie klatki też nisko (pomija początek i koniec fazy
    // przenoszenia, w której palce jeszcze dotykają ziemi, a stopa już leci). Miarą ślizgania jest mediana prędkości
    // świata stopy w kontakcie: stopa stojąca na ziemi ma ją bliską zeru, stopa wleczona przez NPC ma prędkość patrolu.
    const speeds: number[] = [];
    for (const s of series) {
      for (let i = 1; i < s.length - 1; i++) {
        if (s[i - 1].y < 0.015 && s[i].y < 0.015 && s[i + 1].y < 0.015) speeds.push(Math.abs(s[i + 1].z - s[i - 1].z) / (2 * dt));
      }
    }
    speeds.sort((x, y) => x - y);
    const pick = (q: number) => (speeds.length > 0 ? speeds[Math.floor(speeds.length * q)] : Infinity);
    const contactFrames = speeds.length;
    animator.dispose();
    return { median: pick(0.5), p75: pick(0.75), contactFrames, speed, stride: set.walkRootMotion.stride * asset.scale };
  };

  it("po usunięciu root motion stopa w kontakcie z ziemią porusza się tak samo jak w oryginale chodzącym w miejscu", () => {
    const stripped = measureSlip(true);
    const original = measureSlip(false, false);
    expect(stripped.stride).toBeGreaterThan(2);
    expect(stripped.contactFrames).toBeGreaterThan(100);
    // Oryginalny klip bez ruchu NPC wyznacza poślizg wynikający z samej animacji (przejście pięta-palce, napór bioder).
    expect(stripped.median).toBeCloseTo(original.median, 2);
    expect(stripped.p75).toBeCloseTo(original.p75, 2);
    expect(stripped.median).toBeLessThan(stripped.speed * 0.4);
  });

  it("kontrola testu: z oryginalnym klipem (root motion + ruch patrolu) stopa ślizgałaby się wielokrotnie bardziej", () => {
    const stripped = measureSlip(true);
    const doubled = measureSlip(false);
    expect(doubled.contactFrames).toBeGreaterThan(100);
    expect(doubled.median).toBeGreaterThan(doubled.speed * 0.9);
    expect(doubled.median).toBeGreaterThan(stripped.median * 3);
  });

  it("pętla animacji nie powoduje skoku bioder w świecie (brak teleportu przy zawinięciu)", () => {
    const set = buildTrollAnimations(asset);
    const animator = new NpcAnimator(asset.scene, {
      clips: set.clips,
      states: set.states,
      base: "idle",
    });
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
        const jump = world.distanceTo(prev);
        maxJump = Math.max(maxJump, jump);
        if (t < prevTime) wraps++;
      }
      prev = world;
      prevTime = t;
    }
    expect(wraps).toBeGreaterThanOrEqual(3);
    expect(maxJump).toBeLessThan(0.06);
    animator.dispose();
  });
});

describe("troll: reakcja gniewu i powrót do spokoju", () => {
  it("angry gra ok. 3,5 s w miejscu (postać stoi, patrzy na gracza), potem wraca do idle lub patrolu", () => {
    const { npc, place } = makeNpc(2030);
    const player = { x: place.home.x + 4, z: place.home.z + 1 };
    for (let i = 0; i < 60 * 8; i++) npc.update(1 / 60, player);
    const at = { x: npc.x, z: npc.z };
    expect(npc.react("angry")).toBe(true);
    expect(npc.react("angry")).toBe(false);
    let angryFrames = 0;
    for (let i = 0; i < 60 * 6; i++) {
      npc.update(1 / 60, player);
      if (npc.animator.state === "angry") {
        angryFrames++;
        expect(Math.hypot(npc.x - at.x, npc.z - at.z)).toBeLessThan(1e-9);
      }
    }
    expect(angryFrames / 60).toBeGreaterThan(3.1);
    expect(angryFrames / 60).toBeLessThan(3.7);
    expect(npc.animator.isReacting).toBe(false);
    expect(["idle", "walk"]).toContain(npc.animator.state);
    // Patrol rusza dalej po reakcji.
    let farthest = 0;
    for (let i = 0; i < 60 * 40; i++) {
      npc.update(1 / 60, FAR(place.home));
      farthest = Math.max(farthest, Math.hypot(npc.x - at.x, npc.z - at.z));
    }
    expect(farthest).toBeGreaterThan(0.5);
  });

  it("brak animacji Idle/Talk w pliku: troll ma Idle z pozy i nie udaje Talk", () => {
    const { npc } = makeNpc(2030);
    expect(npc.has("idle")).toBe(true);
    expect(npc.has("walk")).toBe(true);
    expect(npc.has("angry")).toBe(true);
    expect(npc.has("talk")).toBe(false);
    expect(asset.clips.some((c) => c.name === "idle" || c.name === "talk")).toBe(false);
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
