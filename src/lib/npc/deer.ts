import * as THREE from "three";
import { sceneNodeName, DEER_WALK_CLIP, type DeerAsset } from "@/lib/assets/characters";
import { rngStream } from "@/lib/game/core/rng";
import type { HeightField } from "@/lib/game/world/terrain";
import type { WalkWorld } from "@/lib/game/world/walk";
import { NpcAnimator, type AnimStateSpec } from "./animator";
import { DEER_BEHAVIOR, DeerBrain, type DeerMode } from "./deerBrain";
import { balancedTilt, cycleTimes, footSamplesOver, lowestPointOver, measureStanceSpeed } from "./ground";
import { HeadLook, HeadRig, type LookIntent } from "./headRig";
import type { Blocker, Point } from "./patrol";
import { stripRootMotion, verticalAxisOf, worldDrift } from "./rootMotion";

/** Promień ciała jelenia (m) przy sprawdzaniu wolnego miejsca: tułów ma ok. 1,4 m długości i 0,5 m szerokości. */
export const DEER_BODY_RADIUS = 0.7;
/** Promień kolizji z graczem (m). */
export const DEER_BLOCK_RADIUS = 0.65;
/** Poziomy ruch bioder w świecie na cykl (m), od którego klip uznajemy za mający root motion i usuwamy go (Walk z pliku chodzi w miejscu). */
export const DEER_ROOT_MOTION_LIMIT = 0.05;
/** Gdy pomiar kroku zawiedzie, prędkość chodu (m/s) szacowana z długości cyklu. */
const FALLBACK_WALK_SPEED = 0.9;

export const DEER_REST_CLIP = "deer.rest";
export const DEER_STATES: readonly AnimStateSpec[] = [
  { id: "rest", clip: DEER_REST_CLIP, loop: true, fade: 0.45 },
  { id: "walk", clip: DEER_WALK_CLIP, loop: true, fade: 0.4, locomotion: true },
];

export type DeerAnimationSet = {
  clips: THREE.AnimationClip[];
  states: readonly AnimStateSpec[];
  nominalSpeed: number;
  hipsDrift: number;
  stripped: boolean;
  /** Przechył ciała w pozie chodu (rad), który wyrównuje wysokość przednich i tylnych kopyt (zad w klipie leży ok. 10 cm niżej). */
  walkTilt: number;
};

/**
 * Poza spoczynkowa jako klip: stała poza wiązania pliku (jeleń stoi na czterech nogach), bez ruchu nóg. Plik nie ma klipu Idle,
 * więc stojący jeleń nie odtwarza chodu zatrzymanego w losowej klatce (nogi w półkroku), tylko tę poza. Ścieżki bierzemy z
 * klipu chodu, a wartości z kości sceny przed jakąkolwiek animacją.
 */
export function buildRestClip(scene: THREE.Object3D, walk: THREE.AnimationClip): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const times = [0, 1];
  for (const track of walk.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    const node = scene.getObjectByName(parsed.nodeName);
    if (!node) continue;
    if (parsed.propertyName === "quaternion") tracks.push(new THREE.QuaternionKeyframeTrack(track.name, times, [...node.quaternion.toArray(), ...node.quaternion.toArray()]));
    else if (parsed.propertyName === "position") tracks.push(new THREE.VectorKeyframeTrack(track.name, times, [...node.position.toArray(), ...node.position.toArray()]));
    else if (parsed.propertyName === "scale") tracks.push(new THREE.VectorKeyframeTrack(track.name, times, [...node.scale.toArray(), ...node.scale.toArray()]));
  }
  return new THREE.AnimationClip(DEER_REST_CLIP, 1, tracks);
}

/**
 * Przygotowuje animacje jelenia: klip chodu (z usunięciem root motion tylko tam, gdzie go wykryto; plik chodzi w miejscu),
 * poza spoczynkowa, prędkość chodu bez ślizgania stóp i przechył ciała wyrównujący kopyta. Wywołuj przed dodaniem sceny do grupy.
 */
export function buildDeerAnimations(asset: DeerAsset): DeerAnimationSet {
  const hipsName = sceneNodeName(asset.entry.hipsBone);
  const hips = asset.scene.getObjectByName(hipsName)!;
  const original = asset.clips.find((c) => c.name === DEER_WALK_CLIP)!;
  const rest = buildRestClip(asset.scene, original);
  const hipsDrift = worldDrift(asset.scene, original, hips, asset.scale);
  const stripped = hipsDrift > DEER_ROOT_MOTION_LIMIT;
  const walk = stripped ? stripRootMotion(original, hipsName, verticalAxisOf(hips)).clip : original;
  const feet = asset.entry.feet.map((n) => asset.scene.getObjectByName(sceneNodeName(n))!);
  const measured = measureStanceSpeed(asset.scene, walk, feet, asset.scale, 96, 0.025, { x: -1, y: 0, z: 0 });
  const times = cycleTimes(walk, 48);
  const walkTilt = balancedTilt(footSamplesOver(asset.skinned, asset.scene, walk, times));
  return {
    clips: [walk, rest],
    states: DEER_STATES,
    nominalSpeed: measured > 0.3 && measured < 3 ? measured : FALLBACK_WALK_SPEED,
    hipsDrift,
    stripped,
    walkTilt,
  };
}

/** Punkty terenu pod ciałem (m, układ jelenia: s wzdłuż kierunku marszu, l w bok): sześć wzdłuż osi i cztery boczne. */
const BODY_SAMPLES: readonly (readonly [number, number])[] = [
  [-0.7, 0],
  [-0.35, 0],
  [0, 0],
  [0.35, 0],
  [0.7, 0],
  [-0.5, 0.25],
  [-0.5, -0.25],
  [0.5, 0.25],
  [0.5, -0.25],
];
const MAX_SLOPE_TILT = 0.45;

export type DeerNpcOptions = {
  asset: DeerAsset;
  walk: Pick<WalkWorld, "isWalkable">;
  terrain: HeightField;
  /** Środek polany: tu jeleń stoi na początku i spaceruje wokół. */
  home: Point;
  /** Początkowy azymut (`atan2(dx, dz)`); bez niego deterministyczny z seeda. */
  yaw?: number;
  seed: number;
  castShadow: boolean;
  receiveShadow: boolean;
};

const wrapAngle = (a: number) => {
  const r = a % (Math.PI * 2);
  return r > Math.PI ? r - Math.PI * 2 : r < -Math.PI ? r + Math.PI * 2 : r;
};

/**
 * Jeleń w lesie: warstwa prezentacji jednego zwierzęcia. Pozycję i zachowanie wyznacza `DeerBrain`, animacje odtwarza
 * `NpcAnimator` (chód z pliku i poza spoczynkowa), głowę koryguje i porusza `HeadRig`, a teren i kolizje pochodzą z istniejących
 * danych świata (`WalkWorld`, `HeightField`). Nie zna stanu gry, zapisu ani questów.
 */
export class DeerNpc {
  readonly group = new THREE.Group();
  readonly animator: NpcAnimator;
  readonly brain: DeerBrain;
  readonly head: HeadRig;
  readonly look: HeadLook;
  readonly animations: DeerAnimationSet;
  /** Przesunięcie modelu w górę (jednostki modelu) dla każdego stanu animacji: najniższy punkt kopyt w cyklu leży na terenie. */
  readonly stateOffsets = new Map<string, number>();
  readonly scale: number;
  private readonly asset: DeerAsset;
  private readonly terrain: HeightField;
  private readonly walkWorld: Pick<WalkWorld, "isWalkable">;
  private groundY = 0;
  private slopeTilt = 0;
  private grounded = false;
  private player: Point | null = null;
  private lastDistance = Infinity;
  private intent: LookIntent = { kind: "free", walking: false };
  private disposed = false;

  constructor(options: DeerNpcOptions) {
    this.asset = options.asset;
    this.terrain = options.terrain;
    this.walkWorld = options.walk;
    this.scale = options.asset.scale;
    const asset = options.asset;
    asset.scene.removeFromParent();
    this.animations = buildDeerAnimations(asset);
    const byName = (name: string) => this.animations.clips.find((c) => c.name === name)!;
    for (const spec of this.animations.states) {
      const clip = byName(spec.clip);
      const tilt = spec.id === "walk" ? this.animations.walkTilt : 0;
      const samples = spec.id === "walk" ? 48 : 1;
      this.stateOffsets.set(spec.id, -lowestPointOver(asset.skinned, asset.scene, [{ clip, times: cycleTimes(clip, samples) }], 0.16, tilt));
    }
    const sceneOf = (name: string) => asset.scene.getObjectByName(sceneNodeName(name))!;
    this.head = new HeadRig({
      head: sceneOf(asset.entry.head.bone),
      neck: asset.scene.getObjectByName("tripoSpine_4"),
      correction: asset.entry.head,
    });
    this.look = new HeadLook(rngStream(options.seed, "npc.deer.look"));
    this.animator = new NpcAnimator(asset.scene, { clips: this.animations.clips, states: this.animations.states, base: "rest" });
    const rng = rngStream(options.seed, "npc.deer.brain");
    this.brain = new DeerBrain(
      { ...DEER_BEHAVIOR, walkSpeed: this.animations.nominalSpeed },
      options.home,
      options.yaw ?? rng() * Math.PI * 2,
      { free: (x, z) => this.bodyFree(x, z) },
      rng,
    );
    this.group.name = "deer";
    this.group.scale.setScalar(this.scale);
    this.group.add(asset.scene);
    asset.skinned.frustumCulled = false;
    this.setShadows(options.castShadow, options.receiveShadow);
    this.syncTransform(0);
  }

  /** Czy ciało jelenia (środek i pierścień o promieniu `DEER_BODY_RADIUS`) mieści się na przejezdnym terenie. */
  bodyFree(x: number, z: number): boolean {
    if (!this.walkWorld.isWalkable(x, z)) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (!this.walkWorld.isWalkable(x + Math.sin(a) * DEER_BODY_RADIUS, z + Math.cos(a) * DEER_BODY_RADIUS)) return false;
    }
    return true;
  }

  setShadows(cast: boolean, receive: boolean): void {
    this.asset.skinned.castShadow = cast;
    this.asset.skinned.receiveShadow = receive;
  }

  get x(): number {
    return this.brain.x;
  }

  get z(): number {
    return this.brain.z;
  }

  get distance(): number {
    return this.lastDistance;
  }

  get mode(): DeerMode {
    return this.brain.mode;
  }

  /** Klip aktualnie odtwarzanego stanu animacji (nazwa z pliku GLB albo poza spoczynkowa). */
  get activeClip(): string {
    return this.animations.states.find((s) => s.id === this.animator.state)?.clip ?? this.animator.state;
  }

  /** Przesunięcie pionowe (jednostki modelu): średnia ważona wag aktywnych stanów. */
  get groundOffset(): number {
    return this.blended((id) => this.stateOffsets.get(id));
  }

  /** Przechył ciała w pozie chodu, z wagą stanu chodu (rad). */
  get walkTilt(): number {
    return this.blended((id) => (id === "walk" ? this.animations.walkTilt : 0));
  }

  private blended(value: (id: string) => number | undefined): number {
    const weights = this.animator.weights();
    let sum = 0;
    let total = 0;
    for (const [id, w] of Object.entries(weights)) {
      const v = value(id);
      if (v === undefined) continue;
      sum += v * w;
      total += w;
    }
    return total > 0 ? sum / total : (value(this.animator.state) ?? 0);
  }

  blocker(): Blocker {
    return { x: this.brain.x, z: this.brain.z, r: DEER_BLOCK_RADIUS };
  }

  /** Jeden krok: zachowanie -> animacja -> głowa -> transformacja w świecie. `player` to pozycja gracza. */
  update(dt: number, player?: Point | null): void {
    if (this.disposed) return;
    this.player = player ?? null;
    this.lastDistance = player ? Math.hypot(player.x - this.brain.x, player.z - this.brain.z) : Infinity;
    this.brain.update(dt, player);
    const b = this.brain;
    const walking = b.speed > 0.06 || (this.animator.state === "walk" && b.speed > 0.02) || b.turning;
    this.animator.setBase(walking ? "walk" : "rest");
    if (walking) this.animator.setLocomotionSpeed(b.turning && b.speed < 0.05 ? 0.55 : b.gaitFactor);
    this.animator.update(dt);
    this.intent = this.lookIntent(walking);
    this.look.update(dt, this.intent);
    this.head.apply(this.look);
    this.syncTransform(dt);
  }

  private lookIntent(walking: boolean): LookIntent {
    const b = this.brain;
    if (b.lookAt) {
      const bearing = Math.atan2(b.lookAt.x - b.x, b.lookAt.z - b.z);
      const dist = Math.max(0.5, Math.hypot(b.lookAt.x - b.x, b.lookAt.z - b.z));
      // Oczy gracza są ok. 1,7 m nad ziemią, głowa jelenia ok. 1,4 m: patrzy lekko w górę z bliska, prosto z daleka.
      const pitch = Math.atan2(0.3, dist);
      return { kind: "watch", yaw: wrapAngle(bearing - b.yaw), pitch };
    }
    return { kind: "free", walking };
  }

  /** Czy głowa patrzy na gracza (diagnostyka). */
  get watching(): boolean {
    return this.look.isWatching;
  }

  private syncTransform(dt: number): void {
    const b = this.brain;
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    let front = 0;
    let rear = 0;
    let nf = 0;
    let nr = 0;
    const heights: { s: number; h: number }[] = [];
    for (const [s, l] of BODY_SAMPLES) {
      const h = this.terrain.height(b.x + fx * s + fz * l, b.z + fz * s - fx * l);
      heights.push({ s, h });
      if (s > 0.3) {
        front += h;
        nf++;
      } else if (s < -0.3) {
        rear += h;
        nr++;
      }
    }
    const slope = Math.max(-Math.tan(MAX_SLOPE_TILT), Math.min(Math.tan(MAX_SLOPE_TILT), (front / nf - rear / nr) / 1.2));
    let lift = -Infinity;
    for (const { s, h } of heights) lift = Math.max(lift, h - slope * s);
    const tilt = -Math.atan(slope);
    if (!this.grounded) {
      this.groundY = lift;
      this.slopeTilt = tilt;
      this.grounded = true;
    } else {
      const k = 1 - Math.exp(-12 * Math.min(Math.max(dt, 0), 0.1));
      this.groundY += (lift - this.groundY) * k;
      this.slopeTilt += (tilt - this.slopeTilt) * k;
    }
    this.asset.scene.rotation.z = this.walkTilt;
    this.group.position.set(b.x, this.groundY + this.groundOffset * this.scale, b.z);
    // Model patrzy w -X; azymut ruchu `atan2(dx, dz)` odpowiada obrotowi o yaw + 90°.
    this.group.rotation.set(0, b.yaw + Math.PI / 2, this.slopeTilt, "YZX");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.head.dispose();
    this.animator.dispose();
    this.group.removeFromParent();
    this.asset.dispose();
  }
}
