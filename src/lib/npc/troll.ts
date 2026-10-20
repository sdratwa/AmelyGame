import * as THREE from "three";
import { sceneNodeName, type TrollAsset } from "@/lib/assets/characters";
import { rngStream } from "@/lib/game/core/rng";
import type { HeightField } from "@/lib/game/world/terrain";
import type { WalkWorld } from "@/lib/game/world/walk";
import { NpcAnimator, type AnimStateSpec } from "./animator";
import { ENCOUNTER, TrollEncounter, type DialogOutcome, type EncounterBody, type EncounterState } from "./encounter";
import { cycleTimes, lowestPointOver, measureStanceSpeed } from "./ground";
import { Patroller, planPatrolRoute, type Blocker, type Point } from "./patrol";
import { measureRootMotion, stripRootMotion, verticalAxisOf, worldDrift } from "./rootMotion";
import { detectFootfalls, FootfallTracker, type Footfall, type FootfallAnalysis } from "./trollSteps";

/** Promień kolizji trolla z graczem (m): korpus ma ok. 1 m w obrysie, ręce mogą wystawać poza niego. */
export const TROLL_RADIUS = 0.9;
/** Maksymalna odległość patrolu od kotwicy W1b (m); mieści się w zasięgu rozmowy (TROLL_RANGE = 6 m) z zapasem. */
export const TROLL_PATROL_RADIUS = 2.6;
/** Poziomy ruch bioder w świecie na cykl (m), od którego klip uznajemy za mający root motion i usuwamy go (Walk z pliku chodzi w miejscu). */
export const ROOT_MOTION_LIMIT = 0.05;

/** Stany animacji trolla -> klipy w pliku GLB. Nowy klip = nowy wpis tutaj (stan i klip), bez zmian w logice NPC. */
export const TROLL_CLIPS = {
  walk: "Walk",
  idle: "Idle",
  nervous: "Nervous",
  surprised: "Surprised",
  happy: "Happy",
  dance: "Dance",
  angry: "Angry",
} as const;

export type TrollAnimState = keyof typeof TROLL_CLIPS;
/** Reakcja z gry (adapter zdarzeń): na razie tylko gniew po nieudanej interakcji. */
export type TrollReaction = "angry";

/** Czasy płynnych przejść (s): 0,2-0,4 s, bez skoków między pozami. */
export const TROLL_FADE = { loop: 0.3, reaction: 0.3, nervous: 0.35 } as const;

export const TROLL_STATES: readonly AnimStateSpec[] = [
  { id: "idle", clip: TROLL_CLIPS.idle, loop: true, fade: TROLL_FADE.loop },
  { id: "walk", clip: TROLL_CLIPS.walk, loop: true, fade: TROLL_FADE.loop, locomotion: true },
  { id: "nervous", clip: TROLL_CLIPS.nervous, loop: false, fade: TROLL_FADE.nervous, interruptible: true },
  { id: "surprised", clip: TROLL_CLIPS.surprised, loop: false, fade: TROLL_FADE.reaction },
  { id: "happy", clip: TROLL_CLIPS.happy, loop: false, fade: TROLL_FADE.reaction },
  { id: "dance", clip: TROLL_CLIPS.dance, loop: false, fade: TROLL_FADE.reaction },
  { id: "angry", clip: TROLL_CLIPS.angry, loop: false, fade: TROLL_FADE.reaction },
];

export type TrollAnimationSet = {
  /** Klipy do mixera: z pliku, a przy wykrytym root motion (Walk) poprawione kopie. */
  clips: THREE.AnimationClip[];
  states: readonly AnimStateSpec[];
  /** Prędkość chodu (m/s), przy której stopy nie ślizgają się po ziemi (z ruchu stopy w fazie podparcia). */
  nominalSpeed: number;
  /** Poziome przesunięcie bioder w świecie na cykl dla każdego klipu (m) przed korektą. */
  hipsDrift: Record<string, number>;
  /** Klipy, z których usunięto root motion (puste, gdy plik ma wszystkie animacje w miejscu). */
  stripped: string[];
  /** Kontakty stóp z ziemią w cyklu Walk (do dźwięku kroków). */
  footfalls: FootfallAnalysis;
};

/**
 * Przygotowuje animacje trolla do gry: mierzy ruch bioder każdego klipu w świecie i usuwa poziomy root motion tylko tam,
 * gdzie go wykryto (plik animowany w Blenderze chodzi w miejscu, więc zwykle nic nie zmienia), oraz wyznacza prędkość
 * patrolu z ruchu stóp. Wywołuj przed dodaniem sceny do grupy ze skalą: pomiary używają `asset.scale`.
 */
export function buildTrollAnimations(asset: TrollAsset): TrollAnimationSet {
  const hipsName = sceneNodeName(asset.entry.hipsBone);
  const hips = asset.scene.getObjectByName(hipsName)!;
  const vertical = verticalAxisOf(hips);
  const hipsDrift: Record<string, number> = {};
  const stripped: string[] = [];
  const clips = asset.clips.map((clip) => {
    const drift = worldDrift(asset.scene, clip, hips, asset.scale);
    hipsDrift[clip.name] = drift;
    if (drift <= ROOT_MOTION_LIMIT) return clip;
    stripped.push(clip.name);
    return stripRootMotion(clip, hipsName, vertical).clip;
  });
  const walk = clips.find((c) => c.name === TROLL_CLIPS.walk)!;
  const toes = ["mixamorig:LeftToeBase", "mixamorig:RightToeBase"].map((n) => asset.scene.getObjectByName(sceneNodeName(n))!);
  const ankles = ["mixamorig:LeftFoot", "mixamorig:RightFoot"].map((n) => asset.scene.getObjectByName(sceneNodeName(n))!) as [THREE.Object3D, THREE.Object3D];
  return {
    clips,
    states: TROLL_STATES,
    nominalSpeed: measureStanceSpeed(asset.scene, walk, toes, asset.scale),
    hipsDrift,
    stripped,
    footfalls: detectFootfalls(asset.scene, walk, ankles, asset.scale),
  };
}

/** Punkty terenu pod stopami (m, układ postaci: x w bok, z do przodu): obie stopy rozstawione szeroko, więc na zboczu liczy się najwyższy z nich. */
const FOOTPRINT: readonly (readonly [number, number])[] = [-0.7, -0.35, 0, 0.35, 0.7].flatMap((x) => [-0.7, -0.35, 0, 0.35, 0.7].map((z) => [x, z] as const));

const wrapAngle = (a: number) => {
  const r = a % (Math.PI * 2);
  return r > Math.PI ? r - Math.PI * 2 : r < -Math.PI ? r + Math.PI * 2 : r;
};

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

export type PatrolMode = "run" | "stop" | "face";

/** Krok trolla (kontakt stopy z ziemią w Walk): pozycja w świecie, stopa i prędkość patrolu w chwili kroku. */
export type TrollStep = { x: number; z: number; foot: 0 | 1; speed: number };

/** Ruch poniżej tej prędkości patrolu (m/s) nie daje kroków, a waga Walk poniżej tej wartości oznacza trwający crossfade. */
export const STEP_MIN_SPEED = 0.15;
export const STEP_MIN_WEIGHT = 0.85;

/** Czynności zlecane przez maszynę spotkania: ruch patrolu, obrót i animacje trolla. */
class TrollBody implements EncounterBody {
  constructor(
    private readonly patrol: Patroller,
    private readonly animator: NpcAnimator,
    private readonly setPatrolMode: (mode: PatrolMode) => void,
    private readonly playerOf: () => Point | null,
  ) {}

  runPatrol(): void {
    this.setPatrolMode("run");
  }

  stopPatrol(face: boolean): void {
    this.setPatrolMode(face ? "face" : "stop");
  }

  get atRest(): boolean {
    return this.patrol.speed < 1e-3 && !this.patrol.moving;
  }

  get yawError(): number {
    const p = this.playerOf();
    return p ? Math.abs(wrapAngle(Math.atan2(p.x - this.patrol.x, p.z - this.patrol.z) - this.patrol.yaw)) : 0;
  }

  get locked(): boolean {
    return this.animator.locked;
  }

  get reacting(): boolean {
    return this.animator.isReacting;
  }

  setBase(state: "walk" | "idle"): void {
    this.animator.setBase(state);
  }

  play(state: string, then?: readonly string[]): boolean {
    return this.animator.trigger(state, { then });
  }

  cancelReaction(): boolean {
    return this.animator.cancel();
  }
}

/**
 * Troll w lesie: warstwa prezentacji. Pozycję i kierunek wyznacza patrol (`Patroller`), animacje odtwarza `NpcAnimator`
 * (klipy chodzą w miejscu, więc nie ma podwójnego przesuwania), a zachowanie wobec gracza prowadzi `TrollEncounter`
 * (patrol, alert, zauważenie, dialog, reakcje). Nie zawiera logiki questa ani zagadek: dialog dostaje wynik z zewnątrz
 * przez `resolveDialog`, stan gry dostaje tylko prośby `react(...)` z adaptera zdarzeń.
 */
export class TrollNpc {
  readonly group = new THREE.Group();
  readonly animator: NpcAnimator;
  readonly patrol: Patroller;
  readonly encounter: TrollEncounter;
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
  private patrolMode: PatrolMode = "run";
  private player: Point | null = null;
  private lastDistance = Infinity;
  private disposed = false;
  private dialogListener: (() => void) | null = null;
  private stepListener: ((step: TrollStep) => void) | null = null;
  private readonly stepEvent: TrollStep = { x: 0, z: 0, foot: 0, speed: 0 };
  private readonly footfalls: FootfallTracker;

  constructor(options: TrollNpcOptions) {
    this.asset = options.asset;
    this.terrain = options.terrain;
    this.scale = options.asset.scale;
    const asset = options.asset;
    asset.scene.removeFromParent();
    this.animations = buildTrollAnimations(asset);
    const byName = (name: string) => this.animations.clips.find((c) => c.name === name)!;
    // Przesunięcie pionowe osobno dla każdego stanu: najniższy punkt stóp w całym klipie leży na terenie, więc stopy nigdy
    // nie wchodzą w ziemię, a pionowy ruch bioder z animacji zostaje zachowany (nie wyrównujemy go klatka po klatce).
    for (const spec of this.animations.states) {
      const clip = byName(spec.clip);
      const samples = Math.min(96, Math.max(24, Math.round(clip.duration * 12)));
      this.stateOffsets.set(spec.id, -lowestPointOver(asset.skinned, asset.scene, [{ clip, times: cycleTimes(clip, samples) }]));
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
      { speed: this.animations.nominalSpeed, waitMin: 4, waitMax: 8, turnRate: 1.6, turnAccel: 4, accel: 4 },
      rngStream(options.seed, "npc.troll.pauses"),
    );

    this.animator = new NpcAnimator(asset.scene, {
      clips: this.animations.clips,
      states: this.animations.states,
      base: "idle",
      onFinished: (id) => this.encounter.animationFinished(id),
    });
    this.encounter = new TrollEncounter(this.body(), rngStream(options.seed, "npc.troll.nervous"), {
      onDialogRequested: () => this.dialogListener?.(),
    });
    this.footfalls = new FootfallTracker(this.animations.footfalls, (f) => this.emitStep(f));
    this.group.name = "troll";
    this.group.scale.setScalar(this.scale);
    this.group.add(asset.scene);
    asset.skinned.frustumCulled = false;
    this.setShadows(options.castShadow, options.receiveShadow);
    this.syncTransform(0);
  }

  private body(): EncounterBody {
    return new TrollBody(this.patrol, this.animator, (mode) => {
      this.patrolMode = mode;
    }, () => this.player);
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

  /** Odległość od gracza w ostatnim kroku (m); Infinity, gdy nie było gracza. */
  get distance(): number {
    return this.lastDistance;
  }

  get encounterState(): EncounterState {
    return this.encounter.state;
  }

  /** Klip aktualnie odtwarzanego stanu animacji (nazwa z pliku GLB). */
  get activeClip(): string {
    return this.animations.states.find((s) => s.id === this.animator.state)?.clip ?? this.animator.state;
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

  /** Reakcja z gry (np. gniew po nieudanej próbie). Zwraca false, gdy trwa sekwencja spotkania albo reakcja. */
  react(kind: TrollReaction): boolean {
    return kind === "angry" ? this.encounter.reactAngry() : false;
  }

  /** Wynik dialogu (testowego lub prawdziwego T1); jedyne wejście dialogu do zachowania trolla. */
  resolveDialog(outcome: DialogOutcome): boolean {
    return this.encounter.resolveDialog(outcome);
  }

  /** Odbiorca prośby o dialog (po Surprised). Jeden odbiorca; `null` wyłącza. Po `dispose` nie jest wywoływany. */
  setDialogListener(listener: (() => void) | null): void {
    this.dialogListener = listener;
  }

  /** Odbiorca kroków (kontakt stopy z ziemią w Walk). Jeden odbiorca; `null` wyłącza. Po `dispose` nie jest wywoływany. */
  setStepListener(listener: ((step: TrollStep) => void) | null): void {
    this.stepListener = listener;
  }

  /** Czy animacja i ruch dają teraz kroki: stan Walk z pełną wagą (bez crossfade) i ruch patrolu. */
  get stepping(): boolean {
    return this.animator.state === "walk" && this.animator.weightOf("walk") >= STEP_MIN_WEIGHT && this.patrol.speed >= STEP_MIN_SPEED;
  }

  get stepsEmitted(): number {
    return this.footfalls.emitted;
  }

  private emitStep(f: Footfall): void {
    const listener = this.stepListener;
    if (!listener || this.disposed) return;
    const e = this.stepEvent;
    e.x = this.patrol.x;
    e.z = this.patrol.z;
    e.foot = f.foot;
    e.speed = this.patrol.speed;
    listener(e);
  }

  has(state: string): boolean {
    return this.animator.has(state);
  }

  /** Jeden krok: zachowanie -> patrol -> stan animacji -> tempo kroków -> transformacja w świecie. `player` to pozycja gracza. */
  update(dt: number, player?: Point | null): void {
    if (this.disposed) return;
    this.player = player ?? null;
    this.lastDistance = player ? Math.hypot(player.x - this.patrol.x, player.z - this.patrol.z) : Infinity;
    this.encounter.update(dt, { distance: this.lastDistance });
    const blockers = player ? [{ x: player.x, z: player.z, r: 0.4 }] : undefined;
    if (this.patrolMode === "run") this.patrol.update(dt, { face: player ?? undefined, blockers, radius: TROLL_RADIUS });
    else this.patrol.update(dt, { stop: true, face: this.patrolMode === "face" ? (player ?? undefined) : undefined });
    if (this.patrolMode === "run") this.animator.setBase(this.patrol.mode === "walk" ? "walk" : "idle");
    if (this.patrol.mode === "walk") this.animator.setLocomotionSpeed(this.patrol.speed / Math.max(this.animations.nominalSpeed, 1e-6));
    this.animator.update(dt);
    this.footfalls.update({ active: this.stepping, time: this.animator.stateTime });
    this.syncTransform(dt);
  }

  private syncTransform(dt: number): void {
    const p = this.patrol;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    // Stopy rozstawione poziomo i wzdłuż kierunku marszu: bierzemy najwyższy punkt terenu, żeby żadna stopa nie weszła w ziemię.
    let ground = -Infinity;
    for (const [fx, fz] of FOOTPRINT) {
      ground = Math.max(ground, this.terrain.height(p.x + fx * c + fz * s, p.z - fx * s + fz * c));
    }
    if (!this.grounded) {
      this.groundY = ground;
      this.grounded = true;
    } else {
      this.groundY += (ground - this.groundY) * (1 - Math.exp(-30 * Math.min(Math.max(dt, 0), 0.1)));
    }
    this.group.position.set(p.x, this.groundY + this.groundOffset * this.scale, p.z);
    this.group.rotation.y = p.yaw;
  }

  /** Sprząta mikser, nasłuch zakończenia klipów i zasoby; po wywołaniu `update` nic nie robi. Można wywołać wielokrotnie. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dialogListener = null;
    this.stepListener = null;
    this.encounter.dispose();
    this.animator.dispose();
    this.group.removeFromParent();
    this.asset.dispose();
  }
}

export { ENCOUNTER, measureRootMotion };
