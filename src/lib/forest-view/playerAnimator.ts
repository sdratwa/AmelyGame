import * as THREE from "three";
import type { PlayerAsset, PlayerClipName } from "@/lib/assets/characters";
import { PLAYER_REQUIRED_CLIPS } from "@/lib/assets/characters";
import { clipTimeScale, emptyWeights, LOCOMOTION_CLIPS, mirrorShare, targetWeights, type AnimIntent, type LocomotionClip, type LocomotionWeights } from "@/lib/tpp/animationState";
import type { TppConfig } from "@/lib/tpp/config";
import { CLIP_PHASE_ANCHOR, JUMP_AIR_CLIP_TIME, JUMP_APEX_CLIP_TIME, MIRRORED_CLIPS, mirrorName, preparePlayerClips, type ClipPrepReport } from "./clipPrep";

/** Zdarzenia fizyki potrzebne animatorowi (z `PlayerState`). */
export type AnimEvents = { justJumped: boolean; falling: boolean; grounded: boolean };

export type PlayerAnimStats = {
  weights: Readonly<LocomotionWeights>;
  jump: number;
  dominant: string;
};

const JUMP_FADE_IN = 0.06;
const JUMP_FADE_OUT = 0.15;

const STAND_GROUP: readonly LocomotionClip[] = ["walk", "run"];
const CROUCH_GROUP: readonly LocomotionClip[] = ["crouch_walk_forward", "crouch_walk_back", "crouch_sneak_left", "crouch_sneak_right"];

/**
 * Animacje gracza na jednym `AnimationMixer` (jeden szkielet, jeden mikser, aktualizowany raz na klatkę). Wszystkie klipy
 * pętlowe są stale odtwarzane z wagami (suma = 1, więc pozy nie mieszają się z pozą wiązania) i wygładzanymi w czasie
 * (crossfade), a ich czas jest prowadzony ręcznie: chód i bieg dzielą fazę kroku (bez ślizgania nóg przy przejściu),
 * tak samo klipy kucania w ruchu. Tempo klipów jest dopasowane do prędkości w świecie. Skok to `LoopOnce` z
 * `clampWhenFinished`, dopasowany do rzeczywistego czasu lotu; sam klip nie przesuwa postaci (patrz `clipPrep`).
 */
export class PlayerAnimator {
  readonly mixer: THREE.AnimationMixer;
  readonly reports: ClipPrepReport[];
  private readonly actions = {} as Record<PlayerClipName, THREE.AnimationAction>;
  private readonly duration = {} as Record<PlayerClipName, number>;
  /** Lustrzane kopie klipów chodu w kuckach (ukosy w lewo); wagi wynikają z wag logicznych, nie są wygładzane osobno. */
  private readonly mirrored = {} as Record<(typeof MIRRORED_CLIPS)[number], THREE.AnimationAction>;
  private readonly weights = emptyWeights();
  private readonly target = emptyWeights();
  private jumpWeight = 0;
  private jumpActive = false;
  private standPhase = 0;
  private crouchPhase = 0;
  private idlePhase = 0;
  private crouchIdlePhase = 0;
  private disposed = false;
  private preview: PlayerClipName | null = null;
  private previewPhase = 0;

  constructor(
    private readonly asset: PlayerAsset,
    hipsBone: string,
  ) {
    for (const name of PLAYER_REQUIRED_CLIPS) {
      if (!asset.clips.some((c) => c.name === name)) throw new Error(`Brak animacji ${name}`);
    }
    const prepared = preparePlayerClips(asset.clips, hipsBone);
    this.reports = prepared.reports;
    this.mixer = new THREE.AnimationMixer(asset.scene);
    for (const name of PLAYER_REQUIRED_CLIPS) {
      const clip = prepared.clips.get(name)!;
      const action = this.mixer.clipAction(clip);
      this.duration[name] = clip.duration;
      action.enabled = true;
      if (name === "jump") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(0);
        action.timeScale = 1;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
        // Czas klipów pętlowych prowadzimy sami (wspólna faza grup), mikser tylko je ewaluuje.
        action.timeScale = 0;
        action.setEffectiveWeight(name === "idle" ? 1 : 0);
      }
      action.play();
      this.actions[name] = action;
    }
    for (const name of MIRRORED_CLIPS) {
      const action = this.mixer.clipAction(prepared.clips.get(mirrorName(name))!);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 0;
      action.setEffectiveWeight(0);
      action.play();
      this.mirrored[name] = action;
    }
    this.weights.idle = 1;
  }

  private fadeFor(intent: AnimIntent, cfg: TppConfig): number {
    const w = this.weights;
    const crouchSum = w.crouch_idle + w.crouch_walk_forward + w.crouch_walk_back + w.crouch_sneak_left + w.crouch_sneak_right;
    const switching = (intent.crouching && crouchSum < 0.999) || (!intent.crouching && crouchSum > 0.001);
    return Math.max(0.01, switching ? cfg.animCrouchFade : cfg.animCrossfade);
  }

  /**
   * Podgląd pojedynczego klipu (kreator postaci): klip gra w pętli z wagą 1, reszta z wagą 0, bez sterowania z fizyki.
   * `null` wraca do normalnego sterowania; nie zmienia klipów ani wag docelowych logiki gry.
   */
  setPreviewClip(name: PlayerClipName | null): void {
    this.preview = name;
    this.previewPhase = 0;
    if (name === null) {
      this.jumpActive = false;
      this.jumpWeight = 0;
    }
  }

  get previewClip(): PlayerClipName | null {
    return this.preview;
  }

  private updatePreview(step: number): void {
    const name = this.preview!;
    this.previewPhase = (this.previewPhase + step / Math.max(this.duration[name], 1e-3)) % 1;
    for (const k of PLAYER_REQUIRED_CLIPS) {
      const a = this.actions[k];
      const on = k === name;
      if (k === "jump" && on) {
        a.enabled = true;
        a.paused = false;
        a.timeScale = 0;
        a.play();
      }
      if (on) a.time = this.previewPhase * this.duration[k];
      a.setEffectiveWeight(on ? 1 : 0);
    }
    for (const m of MIRRORED_CLIPS) this.mirrored[m].setEffectiveWeight(0);
    this.mixer.update(step);
  }

  /** Jedna aktualizacja na klatkę. `expectedAirTime`: przewidywany czas lotu skoku (s), do dopasowania tempa klipu. */
  update(dt: number, intent: AnimIntent, ev: AnimEvents, cfg: TppConfig, expectedAirTime: number): void {
    if (this.disposed) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    if (this.preview) return this.updatePreview(step);

    // Skok: start od początku klipu, tempo dopasowane do lotu; spadek bez skoku trzyma pozę szczytu.
    const jump = this.actions.jump;
    if (ev.justJumped) {
      jump.reset();
      jump.timeScale = JUMP_AIR_CLIP_TIME / Math.max(0.15, expectedAirTime);
      jump.play();
      this.jumpActive = true;
    } else if (ev.falling && !this.jumpActive) {
      jump.reset();
      jump.time = JUMP_APEX_CLIP_TIME;
      jump.timeScale = 0;
      jump.play();
      this.jumpActive = true;
    }
    const airborne = !ev.grounded;
    const jumpTarget = airborne && this.jumpActive ? 1 : 0;
    const jumpRate = jumpTarget > this.jumpWeight ? 1 / JUMP_FADE_IN : 1 / JUMP_FADE_OUT;
    this.jumpWeight += Math.max(-jumpRate * step, Math.min(jumpRate * step, jumpTarget - this.jumpWeight));
    if (this.jumpWeight <= 0.001 && jumpTarget === 0) this.jumpActive = false;

    // Wagi klipów ruchu: cel z prędkości i pozy (bez względu na powietrze, wtedy je przykrywa skok), liniowo w czasie crossfade.
    targetWeights({ ...intent, airborne: false }, cfg, this.target);
    const rate = (1 / this.fadeFor(intent, cfg)) * step;
    let sum = 0;
    for (const k of LOCOMOTION_CLIPS) {
      const w = this.weights[k];
      const next = w + Math.max(-rate, Math.min(rate, this.target[k] - w));
      this.weights[k] = next;
      sum += next;
    }
    if (sum > 1e-6) for (const k of LOCOMOTION_CLIPS) this.weights[k] /= sum;

    // Fazy kroków: wspólna dla chodu i biegu oraz wspólna dla klipów kucania w ruchu; tempo z prędkości w świecie.
    const d = this.duration;
    const walkTs = clipTimeScale(intent.speed, cfg.nominalWalk, cfg);
    const runTs = clipTimeScale(intent.speed, cfg.nominalRun, cfg);
    const wr = this.weights.walk + this.weights.run;
    if (wr > 1e-4) {
      const rateWalk = walkTs / d.walk;
      const rateRun = runTs / d.run;
      this.standPhase = (this.standPhase + step * ((rateWalk * this.weights.walk + rateRun * this.weights.run) / wr)) % 1;
    }
    const crouchTs = clipTimeScale(intent.speed, cfg.nominalCrouch, cfg);
    let cw = 0;
    let cr = 0;
    for (const k of CROUCH_GROUP) {
      cw += this.weights[k];
      cr += (this.weights[k] * crouchTs) / d[k];
    }
    if (cw > 1e-4) this.crouchPhase = (this.crouchPhase + step * (cr / cw)) % 1;
    this.idlePhase = (this.idlePhase + step / d.idle) % 1;
    this.crouchIdlePhase = (this.crouchIdlePhase + step / d.crouch_idle) % 1;

    const loopScale = 1 - this.jumpWeight;
    for (const k of LOCOMOTION_CLIPS) {
      const a = this.actions[k];
      const phase = k === "idle" ? this.idlePhase : k === "crouch_idle" ? this.crouchIdlePhase : STAND_GROUP.includes(k) ? this.standPhase : this.crouchPhase;
      // Faza wspólna grupy przesunięta o kotwicę klipu: ten sam punkt kroku (lewa stopa wyprzedza prawą) w każdym klipie.
      a.time = ((phase + (CLIP_PHASE_ANCHOR[k] ?? 0)) % 1) * d[k];
      a.setEffectiveWeight(this.weights[k] * loopScale);
    }
    // Ruch w lewo: część wagi przodu i tyłu przechodzi na lustrzane kopie (symetria z ukosami w prawo).
    const left = this.weights.crouch_sneak_left;
    for (const name of MIRRORED_CLIPS) {
      const base = this.weights[name];
      const share = mirrorShare(left, base);
      const m = this.mirrored[name];
      m.time = ((this.crouchPhase + (CLIP_PHASE_ANCHOR[mirrorName(name)] ?? 0)) % 1) * d[name];
      m.setEffectiveWeight(base * share * loopScale);
      this.actions[name].setEffectiveWeight(base * (1 - share) * loopScale);
    }
    jump.setEffectiveWeight(this.jumpWeight);
    this.mixer.update(step);
  }

  stats(): PlayerAnimStats {
    let dominant: string = "idle";
    let best = -1;
    for (const k of LOCOMOTION_CLIPS) {
      const w = this.weights[k] * (1 - this.jumpWeight);
      if (w > best) {
        best = w;
        dominant = k;
      }
    }
    if (this.jumpWeight > best) dominant = "jump";
    return { weights: this.weights, jump: this.jumpWeight, dominant };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.asset.scene);
  }
}
