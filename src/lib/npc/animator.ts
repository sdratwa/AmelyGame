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
  /** Reakcję jednorazową wolno przerwać (płynnie) zmianą stanu podstawowego lub `cancel`; pozostałe grają do końca. */
  interruptible?: boolean;
};

export type TriggerOptions = {
  /** Kolejne reakcje jednorazowe odtwarzane po tej (płynne przejście z ostatniej klatki, każda w całości). */
  then?: readonly string[];
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
  /** Wywoływane, gdy klip jednorazowy dojdzie do końca (zdarzenie `finished` miksera), przed przejściem do następnego stanu. */
  onFinished?: (id: string) => void;
};

const DEFAULT_FADE = 0.3;
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
  private chain: string[] = [];
  private finishedId: string | null = null;
  private readonly finishListener = (event: { action?: THREE.AnimationAction }) => {
    for (const [id, action] of this.actions) {
      if (action === event.action && id === this.reactionId) this.finishedId = id;
    }
  };
  private procWeight = 0;
  private clock = 0;
  private speedFactor = 1;
  private readonly blend = new Map<string, number>();
  private fadeSeconds = DEFAULT_FADE;
  private readonly onChange?: AnimatorOptions["onChange"];
  private readonly onFinished?: AnimatorOptions["onFinished"];

  constructor(
    private readonly root: THREE.Object3D,
    options: AnimatorOptions,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    this.onChange = options.onChange;
    this.onFinished = options.onFinished;
    this.mixer.addEventListener("finished", this.finishListener as never);
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

  /** Długość klipu aktualnego stanu (s). */
  get stateDuration(): number {
    return this.currentId ? (this.actions.get(this.currentId)?.getClip().duration ?? 0) : 0;
  }

  /** Czy trwa reakcja, której nie wolno przerwać. */
  get locked(): boolean {
    return this.reactionId !== null && !this.specs.get(this.reactionId)?.interruptible;
  }

  /** Reakcje czekające w łańcuchu (po bieżącej). */
  get queued(): readonly string[] {
    return this.chain;
  }

  /** Wagi aktywnych stanów (do testów i diagnostyki przejść); zawsze sumują się do 1. */
  weights(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, w] of this.blend) if (w > 1e-4) out[id] = w;
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
    if (this.reactionId && !this.locked) this.clearReaction();
    if (!this.isReacting) this.switchTo(id, "base");
    return true;
  }

  /** Przerywa reakcję, jeśli wolno (płynny powrót do stanu podstawowego). Zwraca true, gdy nic już nie gra jako reakcja. */
  cancel(): boolean {
    if (!this.reactionId) return true;
    if (this.locked) return false;
    this.clearReaction();
    this.switchTo(this.baseId, "return");
    return true;
  }

  private clearReaction(): void {
    this.reactionId = null;
    this.chain = [];
    this.finishedId = null;
  }

  /**
   * Uruchamia jednorazową reakcję; po jej zakończeniu (zdarzenie `finished` miksera) gra kolejne z `then`, a na końcu wraca do
   * stanu podstawowego. Zwraca false, gdy reakcji (albo któregoś ogniwa łańcucha) nie ma albo trwa inna reakcja.
   */
  trigger(id: string, options: TriggerOptions = {}): boolean {
    const chain = options.then ?? [];
    for (const next of [id, ...chain]) {
      const spec = this.specs.get(next);
      if (!spec || spec.loop || !this.has(next)) return false;
    }
    if (this.reactionId && !this.cancel()) return false;
    this.chain = [...chain];
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
    // Wejście w klip, który jeszcze znika z poprzedniego przejścia, zaczyna od jego bieżącej wagi: suma wag zostaje równa 1.
    const carried = this.blend.get(id) ?? 0;
    next.reset();
    next.time = spec.startTime ?? 0;
    next.setEffectiveTimeScale(this.timeScaleOf(spec));
    next.play();
    this.currentId = id;
    this.fadeSeconds = Math.max(spec.fade ?? DEFAULT_FADE, 0);
    this.blend.set(id, prevId && this.fadeSeconds > 0 ? carried : 1);
    this.advanceBlend(0);
    this.onChange?.({ from: prevId, to: id, kind });
  }

  /**
   * Płynne przejście: waga bieżącego stanu rośnie liniowo, a pozostałych (także tych, które jeszcze znikają z poprzedniego
   * przejścia) maleje proporcjonalnie, więc suma wag zawsze wynosi 1 (żadnych dwóch pełnych animacji naraz i bez skoku do T-pose).
   */
  private advanceBlend(step: number): void {
    const id = this.currentId;
    if (!id) return;
    let current = this.blend.get(id) ?? 0;
    if (current < 1) current = this.fadeSeconds > 0 ? Math.min(1, current + step / this.fadeSeconds) : 1;
    this.blend.set(id, current);
    let others = 0;
    for (const [other, w] of this.blend) if (other !== id) others += w;
    const scale = others > 1e-9 ? (1 - current) / others : 0;
    for (const [other, w] of [...this.blend]) {
      if (other === id) continue;
      const next = w * scale;
      if (next <= 1e-4) {
        this.blend.delete(other);
        this.actions.get(other)?.stop();
      } else this.blend.set(other, next);
    }
    for (const [key, w] of this.blend) this.actions.get(key)?.setEffectiveWeight(w);
  }

  /** Posuwa animację o `dt` sekund; koniec reakcji wynika ze zdarzenia `finished` miksera, nie z licznika czasu. */
  update(dt: number): void {
    const step = Math.max(0, dt);
    this.clock += step;
    this.advanceBlend(step);
    this.mixer.update(step);
    const finished = this.finishedId;
    if (finished) {
      this.finishedId = null;
      const next = this.chain.shift();
      if (next) {
        this.reactionId = next;
        this.switchTo(next, "reaction");
      } else {
        this.reactionId = null;
        this.switchTo(this.baseId, "return");
      }
      // Ustawia wagi nowego przejścia od zera jeszcze w tej klatce (bez podwójnej wagi w odczycie i na ekranie).
      this.mixer.update(0);
      this.onFinished?.(finished);
    }
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
    this.mixer.removeEventListener("finished", this.finishListener as never);
    this.clearReaction();
    this.mixer.stopAllAction();
    this.blend.clear();
    this.mixer.uncacheRoot(this.root);
  }
}
