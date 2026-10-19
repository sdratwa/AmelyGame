import * as THREE from "three";

/** Opis stanu animacji NPC: nazwa stanu logicznego i klip, który go odtwarza. Nowy stan = nowy wpis, bez zmian w logice NPC. */
export type AnimStateSpec = {
  id: string;
  /** Nazwa klipu w rejestrze animatora. */
  clip: string;
  loop: boolean;
  /** Czas płynnego przejścia do tego stanu (s). */
  fade?: number;
  timeScale?: number;
  /** Chwila klipu, od której stan startuje (np. faza kroku zgodna z pozą spoczynkową). */
  startTime?: number;
  /** Na tym stanie działa delikatny ruch proceduralny (oddech, ruch głowy); stan nie może mieć własnego ruchu ciała. */
  procedural?: boolean;
  /** Tempo klipu jest skalowane do prędkości w świecie (`setLocomotionSpeed`), żeby stopy nie ślizgały się po ziemi. */
  locomotion?: boolean;
};

/** Amplitudy (rad) i częstotliwości (Hz) sinusoidalnego ruchu kości w osiach X, Y, Z (obrót lokalny). */
export type ProceduralBone = { bone: string; amp: [number, number, number]; freq: [number, number, number]; phase?: [number, number, number] };

export type AnimatorOptions = {
  clips: readonly THREE.AnimationClip[];
  states: readonly AnimStateSpec[];
  /** Stan podstawowy (spokojne zachowanie), do którego wracają reakcje jednorazowe. */
  base: string;
  procedural?: readonly ProceduralBone[];
  onChange?: (change: { from: string | null; to: string; kind: "base" | "reaction" | "return" }) => void;
};

const DEFAULT_FADE = 0.25;
const PROCEDURAL_BLEND_SECONDS = 0.5;

/**
 * Kontroler animacji NPC na `THREE.AnimationMixer`: rejestr klipów i stanów, stan podstawowy (idle/walk), jednorazowe
 * reakcje (np. gniew) z powrotem do stanu podstawowego i warstwa proceduralna dla spokojnych stanów. Kontroler nie
 * zakłada niczego o konkretnej postaci: kolejne klipy (talk, wave...) dodaje się przez `registerClip` i `registerState`,
 * a prośba o stan, którego nie ma (`has`), zwraca false i niczego nie udaje.
 */
export class NpcAnimator {
  readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly specs = new Map<string, AnimStateSpec>();
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly procedural: { bone: THREE.Object3D; def: ProceduralBone; base: THREE.Quaternion; written: THREE.Quaternion | null }[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private currentId: string | null = null;
  private baseId: string;
  private reactionId: string | null = null;
  private procWeight = 0;
  private clock = 0;
  private speedFactor = 1;
  private readonly onChange?: AnimatorOptions["onChange"];

  constructor(
    private readonly root: THREE.Object3D,
    options: AnimatorOptions,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    this.onChange = options.onChange;
    for (const clip of options.clips) this.registerClip(clip);
    for (const spec of options.states) this.registerState(spec);
    for (const def of options.procedural ?? []) {
      const bone = root.getObjectByName(def.bone);
      if (bone) this.procedural.push({ bone, def, base: bone.quaternion.clone(), written: null });
    }
    this.baseId = options.base;
    if (!this.has(options.base)) throw new Error(`Animator: stan podstawowy "${options.base}" nie ma klipu.`);
    this.switchTo(options.base, "base");
  }

  registerClip(clip: THREE.AnimationClip): void {
    this.clips.set(clip.name, clip);
  }

  registerState(spec: AnimStateSpec): void {
    this.specs.set(spec.id, spec);
    this.actions.delete(spec.id);
  }

  /** Czy stan istnieje i ma klip (stan bez klipu nie jest odtwarzany ani udawany). */
  has(id: string): boolean {
    const spec = this.specs.get(id);
    return !!spec && this.clips.has(spec.clip);
  }

  get states(): string[] {
    return [...this.specs.keys()].filter((id) => this.has(id));
  }

  /** Stan aktualnie odtwarzany (reakcja albo podstawowy). */
  get state(): string {
    return this.currentId ?? this.baseId;
  }

  get base(): string {
    return this.baseId;
  }

  get reaction(): string | null {
    return this.reactionId;
  }

  get isReacting(): boolean {
    return this.reactionId !== null;
  }

  /** Czas postępu klipu aktualnego stanu (s). */
  get stateTime(): number {
    return this.currentId ? (this.actions.get(this.currentId)?.time ?? 0) : 0;
  }

  /** Wagi aktywnych klipów (do testów i diagnostyki przejść). */
  weights(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, action] of this.actions) {
      const w = action.isRunning() ? action.getEffectiveWeight() : 0;
      if (w > 1e-4) out[id] = w;
    }
    return out;
  }

  get proceduralWeight(): number {
    return this.procWeight;
  }

  /** Ustawia stan podstawowy (pętla); w trakcie reakcji zostaje zapamiętany i wchodzi po jej zakończeniu. */
  setBase(id: string): boolean {
    const spec = this.specs.get(id);
    if (!spec || !spec.loop || !this.has(id)) return false;
    if (this.baseId === id && (this.isReacting || this.currentId === id)) return true;
    this.baseId = id;
    if (!this.isReacting) this.switchTo(id, "base");
    return true;
  }

  /** Uruchamia jednorazową reakcję i po jej końcu wraca do stanu podstawowego. Zwraca false, gdy reakcji nie ma albo trwa inna. */
  trigger(id: string): boolean {
    const spec = this.specs.get(id);
    if (!spec || spec.loop || !this.has(id) || this.isReacting) return false;
    this.reactionId = id;
    this.switchTo(id, "reaction");
    return true;
  }

  /** Współczynnik tempa stanów lokomocji (1 = tempo klipu; prędkość w świecie / prędkość nominalna klipu). */
  setLocomotionSpeed(factor: number): void {
    this.speedFactor = Math.min(2, Math.max(0.25, factor));
    const id = this.currentId;
    if (id && this.specs.get(id)?.locomotion) this.actions.get(id)?.setEffectiveTimeScale(this.timeScaleOf(this.specs.get(id)!));
  }

  private timeScaleOf(spec: AnimStateSpec): number {
    return (spec.timeScale ?? 1) * (spec.locomotion ? this.speedFactor : 1);
  }

  private actionOf(id: string): THREE.AnimationAction {
    let action = this.actions.get(id);
    if (!action) {
      const spec = this.specs.get(id)!;
      action = this.mixer.clipAction(this.clips.get(spec.clip)!);
      action.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, spec.loop ? Infinity : 1);
      action.clampWhenFinished = !spec.loop;
      this.actions.set(id, action);
    }
    return action;
  }

  private switchTo(id: string, kind: "base" | "reaction" | "return"): void {
    const spec = this.specs.get(id)!;
    const next = this.actionOf(id);
    const prevId = this.currentId;
    const prev = prevId && prevId !== id ? this.actions.get(prevId) : undefined;
    next.reset();
    next.time = spec.startTime ?? 0;
    next.setEffectiveTimeScale(this.timeScaleOf(spec));
    next.setEffectiveWeight(1);
    next.play();
    if (prev) next.crossFadeFrom(prev, spec.fade ?? DEFAULT_FADE, false);
    this.currentId = id;
    this.onChange?.({ from: prevId, to: id, kind });
  }

  /** Posuwa animację o `dt` sekund; po zakończeniu reakcji (z wyprzedzeniem na przejście) wraca do stanu podstawowego. */
  update(dt: number): void {
    const step = Math.max(0, dt);
    this.clock += step;
    const reactionId = this.reactionId;
    if (reactionId) {
      const action = this.actions.get(reactionId)!;
      const clip = action.getClip();
      const scale = Math.abs(action.getEffectiveTimeScale()) || 1;
      const fadeBack = this.specs.get(this.baseId)?.fade ?? DEFAULT_FADE;
      if (action.time + fadeBack * scale >= clip.duration - 1e-6) {
        this.reactionId = null;
        this.switchTo(this.baseId, "return");
      }
    }
    this.mixer.update(step);
    this.applyProcedural(step);
  }

  /**
   * Warstwa proceduralna nakłada obrót na poza z mixera. Mixer zapisuje kość tylko wtedy, gdy wartość z klipu się zmieniła
   * (poza spoczynkowa jest stała), więc nie wolno mnożyć obrotu kumulatywnie: pamiętamy poza bazową i ostatnio zapisany
   * wynik, a bazę odświeżamy tylko wtedy, gdy mixer kość faktycznie nadpisał.
   */
  private applyProcedural(dt: number): void {
    const spec = this.currentId ? this.specs.get(this.currentId) : undefined;
    const target = spec?.procedural && !this.reactionId ? 1 : 0;
    const k = Math.min(1, dt / PROCEDURAL_BLEND_SECONDS);
    this.procWeight += (target - this.procWeight) * k;
    if (this.procWeight < 1e-3 && target === 0) this.procWeight = 0;
    const w = this.procWeight;
    const t = this.clock * Math.PI * 2;
    for (const entry of this.procedural) {
      const { bone, def } = entry;
      if (entry.written && !bone.quaternion.equals(entry.written)) entry.base.copy(bone.quaternion);
      else if (!entry.written) entry.base.copy(bone.quaternion);
      if (w === 0) {
        bone.quaternion.copy(entry.base);
        entry.written = null;
        continue;
      }
      const ph = def.phase ?? [0, 0, 0];
      this.e.set(
        w * def.amp[0] * Math.sin(t * def.freq[0] + ph[0]),
        w * def.amp[1] * Math.sin(t * def.freq[1] + ph[1]),
        w * def.amp[2] * Math.sin(t * def.freq[2] + ph[2]),
      );
      bone.quaternion.copy(entry.base).multiply(this.q.setFromEuler(this.e));
      entry.written = bone.quaternion.clone();
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
