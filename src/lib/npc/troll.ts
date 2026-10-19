import * as THREE from "three";
import { sceneNodeName, type TrollAsset } from "@/lib/assets/characters";
import { rngStream } from "@/lib/game/core/rng";
import type { HeightField } from "@/lib/game/world/terrain";
import type { WalkWorld } from "@/lib/game/world/walk";
import { NpcAnimator, type AnimStateSpec, type ProceduralBone } from "./animator";
import { cycleTimes, lowestPointOver } from "./ground";
import { Patroller, planPatrolRoute, type Blocker, type Point } from "./patrol";
import { measureRootMotion, nominalSpeed, poseClipFrom, stripRootMotion, type RootMotion } from "./rootMotion";

/** Promień kolizji trolla z graczem (m): korpus ma ok. 1 m w obrysie, ręce mogą wystawać poza niego. */
export const TROLL_RADIUS = 0.9;
/** Maksymalna odległość patrolu od kotwicy W1b (m); mieści się w zasięgu rozmowy (TROLL_RANGE = 6 m) z zapasem. */
export const TROLL_PATROL_RADIUS = 2.6;
/** Poza animacją chodu model nie ma spoczynkowej: Idle to nieruchoma poza z chwili chodu, gdy stopy są równo przy sobie. */
export const TROLL_IDLE_POSE = { clip: "walk", time: 0.067 } as const;
/** Klipy z pliku GLB użyte w grze i ich stany logiczne (nowe stany, np. talk, dodaje się tu i w `registerState`). */
export const TROLL_CLIPS = { walk: "walk", angry: "angry_01", idle: "idle" } as const;

export type TrollReaction = "angry";

type Vec3 = [number, number, number];
const PROCEDURAL_IDLE: ProceduralBone[] = ([
  { bone: "mixamorig:Spine", amp: [0.012, 0, 0.008], freq: [0.22, 0, 0.15] },
  { bone: "mixamorig:Spine1", amp: [0.01, 0.02, 0], freq: [0.22, 0.09, 0], phase: [0.8, 0, 0] },
  { bone: "mixamorig:Spine2", amp: [0.012, 0.015, 0.006], freq: [0.22, 0.07, 0.12], phase: [1.6, 0.5, 0] },
  { bone: "mixamorig:Neck", amp: [0.01, 0.04, 0], freq: [0.17, 0.08, 0], phase: [0.4, 1.1, 0] },
  { bone: "mixamorig:Head", amp: [0.02, 0.09, 0.015], freq: [0.13, 0.08, 0.1], phase: [0, 2, 0.5] },
] as { bone: string; amp: Vec3; freq: Vec3; phase?: Vec3 }[]).map((p) => ({ ...p, bone: sceneNodeName(p.bone) }));

export type TrollAnimationSet = {
  clips: THREE.AnimationClip[];
  states: AnimStateSpec[];
  /** Prędkość chodu (m/s), przy której stopy nie ślizgają się po ziemi. */
  nominalSpeed: number;
  walkRootMotion: RootMotion;
  angryRootMotion: RootMotion;
};

/**
 * Przygotowuje animacje trolla do gry: usuwa poziomy root motion z `walk` i `angry_01` (pozycją NPC rządzi patrol),
 * dodaje klip Idle jako nieruchomą pozę oraz opisuje stany. Klipy z pliku nie są zmieniane.
 */
export function buildTrollAnimations(asset: TrollAsset): TrollAnimationSet {
  const hips = sceneNodeName(asset.entry.hipsBone);
  const walkSource = asset.clips.find((c) => c.name === TROLL_CLIPS.walk)!;
  const angrySource = asset.clips.find((c) => c.name === TROLL_CLIPS.angry)!;
  const walk = stripRootMotion(walkSource, hips);
  const angry = stripRootMotion(angrySource, hips);
  const idle = poseClipFrom(asset.scene, walk.clip, TROLL_IDLE_POSE.time, TROLL_CLIPS.idle);
  const states: AnimStateSpec[] = [
    { id: "idle", clip: TROLL_CLIPS.idle, loop: true, fade: 0.3, procedural: true },
    { id: "walk", clip: TROLL_CLIPS.walk, loop: true, fade: 0.25, startTime: TROLL_IDLE_POSE.time, locomotion: true },
    { id: "angry", clip: TROLL_CLIPS.angry, loop: false, fade: 0.25 },
  ];
  return {
    clips: [walk.clip, angry.clip, idle],
    states,
    nominalSpeed: nominalSpeed(walk.removed, asset.scale),
    walkRootMotion: walk.removed,
    angryRootMotion: angry.removed,
  };
}

export type TrollNpcOptions = {
  asset: TrollAsset;
  walk: Pick<WalkWorld, "isWalkable">;
  terrain: HeightField;
  /** Kotwica W1b trolla: środek patrolu. */
  home: Point;
  /** Punkt, ku któremu troll patrzy na początku (np. pilnowana skrzynia). */
  faceTo: Point;
  seed: number;
  castShadow: boolean;
  receiveShadow: boolean;
};

/**
 * Troll w lesie: warstwa prezentacji. Pozycję i kierunek wyznacza patrol (`Patroller`), animacja tylko odtwarza kroki
 * w miejscu (bez root motion) z tempem dopasowanym do prędkości patrolu, a reakcje (gniew) są jednorazowe. Nie zawiera
 * logiki questa ani zagadek: stan gry dostaje tylko prośby `react(...)` z adaptera zdarzeń.
 */
export class TrollNpc {
  readonly group = new THREE.Group();
  readonly animator: NpcAnimator;
  readonly patrol: Patroller;
  readonly route: readonly Point[];
  readonly animations: TrollAnimationSet;
  /** Przesunięcie modelu w górę (jednostki modelu) dla każdego stanu animacji: najniższy punkt stóp w cyklu leży na terenie. */
  readonly stateOffsets = new Map<string, number>();
  readonly scale: number;
  readonly footprintRadius = TROLL_RADIUS;
  private readonly asset: TrollAsset;
  private readonly terrain: HeightField;
  private groundY = 0;
  private grounded = false;

  constructor(options: TrollNpcOptions) {
    this.asset = options.asset;
    this.terrain = options.terrain;
    this.scale = options.asset.scale;
    const asset = options.asset;
    this.animations = buildTrollAnimations(asset);
    const byName = (name: string) => this.animations.clips.find((c) => c.name === name)!;
    // Przesunięcie pionowe osobno dla każdego stanu: najniższy punkt stóp w całym cyklu danego klipu leży na terenie, więc
    // stopy nigdy nie wchodzą w ziemię, a pionowy ruch bioder z animacji zostaje zachowany (nie wyrównujemy go klatka po klatce).
    for (const spec of this.animations.states) {
      const clip = byName(spec.clip);
      const times = spec.loop && spec.id === "walk" ? cycleTimes(clip, 24) : spec.loop ? [0] : cycleTimes(clip, 24);
      this.stateOffsets.set(spec.id, -lowestPointOver(asset.skinned, asset.scene, [{ clip, times }]));
    }

    const isFree = (clearance: number) => (x: number, z: number) => {
      if (!options.walk.isWalkable(x, z)) return false;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (!options.walk.isWalkable(x + Math.sin(a) * clearance, z + Math.cos(a) * clearance)) return false;
      }
      return true;
    };
    let route: Point[] = [];
    for (const clearance of [0.9, 0.6]) {
      route = planPatrolRoute(options.home, isFree(clearance), rngStream(options.seed, "npc.troll.patrol"), { maxRadius: TROLL_PATROL_RADIUS, points: 4 });
      if (route.length >= 2) break;
    }
    this.route = route;
    const yaw = Math.atan2(options.faceTo.x - options.home.x, options.faceTo.z - options.home.z);
    this.patrol = new Patroller(
      route,
      { x: options.home.x, z: options.home.z, yaw },
      { speed: this.animations.nominalSpeed, waitMin: 4, waitMax: 8, turnRate: 1.4, accel: 4 },
      rngStream(options.seed, "npc.troll.pauses"),
    );

    this.animator = new NpcAnimator(asset.scene, {
      clips: this.animations.clips,
      states: this.animations.states,
      base: "idle",
      procedural: PROCEDURAL_IDLE,
    });
    this.group.name = "troll";
    this.group.scale.setScalar(this.scale);
    this.group.add(asset.scene);
    asset.skinned.frustumCulled = false;
    this.setShadows(options.castShadow, options.receiveShadow);
    this.syncTransform(0);
  }

  setShadows(cast: boolean, receive: boolean): void {
    this.asset.skinned.castShadow = cast;
    this.asset.skinned.receiveShadow = receive;
  }

  get x(): number {
    return this.patrol.x;
  }

  get z(): number {
    return this.patrol.z;
  }

  /** Bieżące przesunięcie pionowe (jednostki modelu): średnia ważona wag aktywnych stanów animacji. */
  get groundOffset(): number {
    const weights = this.animator.weights();
    let sum = 0;
    let total = 0;
    for (const [id, w] of Object.entries(weights)) {
      const offset = this.stateOffsets.get(id);
      if (offset === undefined) continue;
      sum += offset * w;
      total += w;
    }
    return total > 0 ? sum / total : (this.stateOffsets.get(this.animator.state) ?? 0);
  }

  /** Okrąg kolizji dla gracza. */
  blocker(): Blocker {
    return { x: this.patrol.x, z: this.patrol.z, r: TROLL_RADIUS };
  }

  /** Reakcja z gry (np. gniew po nieudanej próbie). Zwraca false, gdy model nie ma takiej animacji albo trwa inna reakcja. */
  react(kind: TrollReaction): boolean {
    return this.animator.trigger(kind);
  }

  has(state: string): boolean {
    return this.animator.has(state);
  }

  /** Jeden krok: patrol -> stan animacji -> tempo kroków -> transformacja w świecie. `player` to pozycja gracza (kierunek patrzenia, ustępowanie). */
  update(dt: number, player?: Point | null): void {
    const reacting = this.animator.isReacting;
    this.patrol.update(dt, {
      hold: reacting,
      face: player ?? undefined,
      blockers: player ? [{ x: player.x, z: player.z, r: 0.4 }] : undefined,
      radius: TROLL_RADIUS,
    });
    if (!reacting) this.animator.setBase(this.patrol.mode === "walk" ? "walk" : "idle");
    if (this.patrol.mode === "walk") this.animator.setLocomotionSpeed(this.patrol.speed / Math.max(this.animations.nominalSpeed, 1e-6));
    this.animator.update(dt);
    this.syncTransform(dt);
  }

  private syncTransform(dt: number): void {
    const p = this.patrol;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    // Stopy rozstawione poziomo i wzdłuż kierunku marszu: bierzemy najwyższy punkt terenu, żeby żadna stopa nie weszła w ziemię.
    let ground = -Infinity;
    for (const [fx, fz] of [
      [0, 0],
      [0, 0.5],
      [0, -0.5],
      [0.4, 0],
      [-0.4, 0],
    ]) {
      ground = Math.max(ground, this.terrain.height(p.x + fx * c + fz * s, p.z - fx * s + fz * c));
    }
    if (!this.grounded) {
      this.groundY = ground;
      this.grounded = true;
    } else {
      this.groundY += (ground - this.groundY) * (1 - Math.exp(-8 * Math.min(Math.max(dt, 0), 0.1)));
    }
    this.group.position.set(p.x, this.groundY + this.groundOffset * this.scale, p.z);
    this.group.rotation.y = p.yaw;
  }

  dispose(): void {
    this.animator.dispose();
    this.group.removeFromParent();
    this.asset.dispose();
  }
}

export { measureRootMotion };
