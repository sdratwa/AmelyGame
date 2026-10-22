import { SOUND_REGISTRY, type PlayerSoundEvent } from "../multiplayer/protocol";
import { PlayerStepEmitter, SPATIAL_DEFAULTS, stepGain } from "./playerSpatial";
import type { Player } from "../multiplayer/protocol";
import { gameHour, MidnightWatcher } from "./clock";
import {
  FootstepScheduler,
  NPC_STEP_SOUND,
  NPC_VARIATION,
  PLAYER_STRIDE,
  PLAYER_VARIATION,
  StepVoicing,
  npcStepAttenuationDb,
  npcStepFade,
  npcStepLowpass,
  type StepEvent,
} from "./footsteps";
import { AssetLoader } from "./loader";
import {
  AMBIENCE_DAY,
  AMBIENCE_NIGHT,
  isAudioManifest,
  MANIFEST_URL,
  WOLVES,
  type AudioManifest,
} from "./manifest";
import { ambientMix, birdActivity, phaseOf, type DayPhase } from "./mix";
import { DEFAULT_AUDIO_SETTINGS, loadSettings, saveSettings, type AudioSettings, type StorageLike } from "./settings";
import { forkRng } from "./shuffleBag";
import { relativeBearingDeg } from "./spatial";
import { DEFAULT_SURFACE, FOOTSTEP_POOLS, SURFACE_PROFILES, type SurfaceId } from "./surfaces";
import { BIRD_IDS, WildlifeScheduler, type BirdEvent } from "./wildlife";
import { WolvesLedger } from "./wolvesLedger";

/** Wysokość uszu gracza (m): punkt odniesienia dla wysokości źródeł. */
const EAR_HEIGHT = 1.6;
const TICK_MS = 200;
const FADE_IN_TAU = 0.9;
const MIX_TAU = 0.8;
const MODE_TAU = 0.4;
const LEAVE_MS = 700;
const IDLE_RELEASE_MS = 90_000;
const LOOKAHEAD_HOURS = 1.25;
const DIALOG_AMBIENCE = 0.45;

/** Stałe zdarzenia wilków: daleki odgłos z głębi lasu. */
export const WOLVES_CONFIG = {
  distance: [85, 115] as const,
  height: 3,
  gain: 1.5,
  duck: 0.6,
  panner: { ref: 40, rolloff: 0.6 },
} as const;
const BIRD_PANNER = { ref: 10, rolloff: 1.2 } as const;

/**
 * Poziomy bazowe kroków (mnożnik głośności po wyrównaniu próbek do wspólnego RMS -32,8 dBFS i szczytu <= -6 dBFS). Do strojenia
 * po odsłuchu; suwaki PLAYER/NPC FOOTSTEPS w panelu diagnostycznym mnożą te wartości (0-2).
 */
export const STEP_LEVELS = { player: 1.3, npc: 1.6 } as const;
const PLAYER_MAX_VOICES = 3;
const STEP_RATE_WINDOW = 5;
const EMITTER_ACTIVE_MS = 1200;
const PREVIEW_GAP_MS = 750;
const PREVIEW_DISTANCE = 6;

export type StepVolumes = { player: number; npc: number };
export type SurfaceResolver = (x: number, z: number) => SurfaceId;
/** Zdarzenia ruchu z pętli gry (renderer): kroki gracza i trolla bez stanu Reacta i bez własnych timerów. */
export type StepSink = {
  playerMotion(distance: number, dt: number, x: number, z: number): void;
  npcStep(x: number, z: number, foot: 0 | 1): void;
};

export type AudioMode = { dialog: boolean; frozen: boolean };
export type ListenerPose = { x: number; y?: number; z: number; yaw: number };

export type EffectInfo = { label: string; kind: "bird" | "wolves" | "wolves-test"; at: number; distance: number; bearingDeg: number; rate: number };

export type MidnightInfo = { midnight: number; result: string };

export type StepDiagnostics = {
  ready: boolean;
  loaded: number;
  total: number;
  player: { last: number | null; count: number; perSecond: number; surface: SurfaceId | null; surfaceLabel: string };
  npc: { last: number | null; count: number; emitterActive: boolean; lastDistance: number | null; lastAttenuationDb: number | null; lastBearingDeg: number | null; lastFoot: "L" | "P" | null; culled: number };
  volumes: StepVolumes;
  previewing: boolean;
};

export type AudioDiagnostics = {
  active: boolean;
  error: string | null;
  contextState: string;
  hour: number;
  phase: DayPhase;
  background: string;
  dayGain: number;
  nightGain: number;
  dayLoaded: boolean;
  nightLoaded: boolean;
  activeEffects: number;
  activeSteps: number;
  lastEffect: EffectInfo | null;
  wolvesLastMidnight: number | null;
  lastMidnight: MidnightInfo | null;
  steps: StepDiagnostics;
  walking: boolean;
  running: boolean;
  mode: AudioMode;
  muted: boolean;
  loaded: string[];
};

type Voice = {
  kind: "bird" | "wolves" | "step" | "npcstep";
  source: AudioBufferSourceNode;
  nodes: AudioNode[];
  done: boolean;
};

type StepPool = { ids: string[]; buffers: AudioBuffer[] };

type StepsState = {
  buffers: Map<string, AudioBuffer>;
  pools: Map<string, StepPool>;
  ready: boolean;
  player: {
    scheduler: FootstepScheduler;
    voicing: StepVoicing;
    bus: GainNode;
    voices: number;
    last: number | null;
    count: number;
    surface: SurfaceId | null;
    times: number[];
  };
  npc: {
    voicing: StepVoicing;
    bus: GainNode;
    heavy: BiquadFilterNode;
    lowpass: BiquadFilterNode;
    panner: PannerNode;
    voices: number;
    last: number | null;
    count: number;
    lastAt: number;
    lastDistance: number | null;
    lastAttenuationDb: number | null;
    lastBearingDeg: number | null;
    lastFoot: "L" | "P" | null;
    culled: number;
  };
  preview: { timers: ReturnType<typeof setTimeout>[] };
};

type Layer = {
  id: string;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  primed: boolean;
  idleSince: number | null;
};

type Session = {
  ctx: AudioContext;
  saveId: string;
  master: GainNode;
  compressor: DynamicsCompressorNode;
  ambienceVol: GainNode;
  ambienceMode: GainNode;
  duck: GainNode;
  fade: GainNode;
  effectsVol: GainNode;
  layers: Record<"day" | "night", Layer>;
  voices: Set<Voice>;
  loader: AssetLoader | null;
  watcher: MidnightWatcher;
  birds: WildlifeScheduler;
  steps: StepsState;
  hidden: boolean;
  disposed: boolean;
  timer: ReturnType<typeof setInterval> | null;
  lastTick: number;
  pose: ListenerPose | null;
  elapsed: number;
  hour: number;
  naturalMidnights: Set<number>;
  wolvesLoading: boolean;
  cleanup: (() => void)[];
};

export type ControllerDeps = {
  createContext?: () => AudioContext;
  fetch?: typeof fetch;
  rng?: () => number;
  now?: () => number;
  storage?: StorageLike | null;
  canPlayType?: (type: string) => string;
  document?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> | null;
  window?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  manifestUrl?: string;
};

const GESTURE_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

function sampleNumber(id: string | undefined): number | null {
  const n = Number(id?.split(".").pop());
  return Number.isFinite(n) ? n : null;
}

function setParam(param: AudioParam, value: number, now: number, tau: number): void {
  param.setTargetAtTime(value, now, tau);
}

function setPosition(node: PannerNode, x: number, y: number, z: number): void {
  if (node.positionX) {
    node.positionX.value = x;
    node.positionY.value = y;
    node.positionZ.value = z;
  } else {
    node.setPosition(x, y, z);
  }
}

/**
 * Jedyny kontroler dźwięku lasu: trzy warstwy (ambient, zwierzęta i zdarzenia, kroki) w jednym grafie Web Audio,
 * jedna pętla czasowa, jedna kolejka wczytywania i jedno miejsce zwalniania zasobów.
 * Losowość pochodzi z własnego generatora, nigdy z seeda świata ani z logiki questów.
 */
export class ForestAudioController {
  private session: Session | null = null;
  private readonly closing = new Set<{ session: Session; timer: ReturnType<typeof setTimeout> }>();
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private settingsLoaded = false;
  private readonly subscribers = new Set<() => void>();
  private manifest: AudioManifest | null = null;
  private manifestLoading: Promise<AudioManifest> | null = null;
  private mode: AudioMode = { dialog: false, frozen: false };
  private error: string | null = null;
  private lastEffect: EffectInfo | null = null;
  private lastMidnight: MidnightInfo | null = null;
  private lastWolvesSave: string | null = null;
  private stepVolumes: StepVolumes = { player: 1, npc: 1 };
  spatialSettings = { ...SPATIAL_DEFAULTS };
  private remoteEmitters = new Map<
    string,
    {
      scheduler: PlayerStepEmitter;
      sources: Map<AudioBufferSourceNode, { pan: PannerNode; gain: GainNode }>;
      last: Player;
    }
  >();
  clearRemotePlayers(): void {
    for (const e of this.remoteEmitters.values())
      for (const source of e.sources.keys()) {
        try {
          source.stop();
          source.onended?.(new Event("ended"));
        } catch {}
      }
    this.remoteEmitters.clear();
  }
  remotePlayersMotion(players: Player[], dt: number): void {
    const s = this.session;
    for (const [id, e] of this.remoteEmitters)
      if (!players.some((p) => p.playerId === id)) {
        for (const source of e.sources.keys()) {
          try {
            source.stop();
            source.onended?.(new Event("ended"));
          } catch {}
        }
        this.remoteEmitters.delete(id);
      }
    if (!s || !this.running(s) || !s.steps.ready || !s.pose) return;
    for (const p of players) {
      let e = this.remoteEmitters.get(p.playerId);
      if (!e) {
        e = { scheduler: new PlayerStepEmitter(), sources: new Map(), last: p };
        this.remoteEmitters.set(p.playerId, e);
      }
      e.last = p;
      const step = e.scheduler.update(p, dt);
      const cfg = this.spatialSettings,
        range = p.crouching
          ? cfg.crouchRange
          : p.running
            ? cfg.runRange
            : cfg.walkRange;
      const distance = Math.hypot(
        p.x - s.pose.x,
        p.z - s.pose.z,
        p.y - (s.pose.y ?? EAR_HEIGHT),
      );
      const attenuation = stepGain(
        distance,
        range,
        cfg.refDistance,
        cfg.rolloff,
      );
      const volume = cfg.enabled
        ? cfg.volume * attenuation * (p.crouching ? 0.25 : p.running ? 1.3 : 1)
        : 0;
      for (const active of e.sources.values()) {
        setPosition(active.pan, p.x, p.y + 0.1, p.z);
        active.gain.gain.value = volume;
      }
      if (!step || volume <= 0 || e.sources.size >= 3) continue;
      const surface = this.surfaceResolver?.(p.x, p.z) ?? DEFAULT_SURFACE;
      const pool = s.steps.pools.get(SURFACE_PROFILES[surface].pool);
      if (!pool?.buffers.length) continue;
      const source = s.ctx.createBufferSource();
      source.buffer =
        pool.buffers[Math.floor(this.rng() * pool.buffers.length)];
      const gain = s.ctx.createGain();
      gain.gain.value = volume;
      const pan = s.ctx.createPanner();
      pan.panningModel = "HRTF";
      pan.rolloffFactor = 0;
      setPosition(pan, p.x, p.y + 0.1, p.z);
      source.connect(gain);
      gain.connect(pan);
      pan.connect(s.effectsVol);
      e.sources.set(source, { pan, gain });
      source.onended = () => {
        e!.sources.delete(source);
        source.disconnect();
        gain.disconnect();
        pan.disconnect();
      };
      source.start();
    }
  }
  async playPlayerSound(event: PlayerSoundEvent): Promise<boolean> {
    const s = this.session,
      cfg = SOUND_REGISTRY[event.soundId];
    if (!s || !this.running(s) || !s.loader || !cfg?.asset || !s.pose)
      return false;
    const buffer = await s.loader.load(cfg.asset).catch(() => null);
    if (!buffer || s.disposed || !this.running(s)) return false;
    const source = s.ctx.createBufferSource();
    source.buffer = buffer;
    const pan = s.ctx.createPanner();
    pan.panningModel = "HRTF";
    pan.distanceModel = "inverse";
    pan.refDistance = cfg.refDistance;
    pan.rolloffFactor = cfg.rolloff;
    pan.maxDistance = cfg.range;
    setPosition(pan, event.x, event.y, event.z);
    const gain = s.ctx.createGain();
    const distance = Math.hypot(event.x - s.pose.x, event.z - s.pose.z);
    gain.gain.value = cfg.gain * Math.max(0, 1 - (distance / cfg.range) ** 4);
    source.connect(gain);
    gain.connect(pan);
    pan.connect(s.effectsVol);
    const voice: Voice = {
      kind: "bird",
      source,
      nodes: [gain, pan],
      done: false,
    };
    s.voices.add(voice);
    source.onended = () => this.finishVoice(s, voice, false);
    source.start();
    return true;
  }
  configureSpatial(patch: Partial<typeof SPATIAL_DEFAULTS>) {
    Object.assign(this.spatialSettings, patch);
  }
  spatialDiagnostics() {
    return {
      emitterDetails: [...this.remoteEmitters].map(([playerId, e]) => ({
        playerId,
        x: e.last.x,
        y: e.last.y + 0.1,
        z: e.last.z,
        voices: e.sources.size,
      })),
      emitters: this.remoteEmitters.size,
      voices: [...this.remoteEmitters.values()].reduce(
        (n, e) => n + e.sources.size,
        0,
      ),
      nearest: this.session?.pose
        ? Math.min(
            ...[...this.remoteEmitters.values()].map((e) =>
              Math.hypot(
                e.last.x - this.session!.pose!.x,
                e.last.z - this.session!.pose!.z,
              ),
            ),
          )
        : Infinity,
    };
  }
  private surfaceResolver: SurfaceResolver | null = null;

  constructor(private readonly deps: ControllerDeps = {}) {}

  // --- zależności ---------------------------------------------------------------------------------------------

  private get storage(): StorageLike | null {
    if (this.deps.storage !== undefined) return this.deps.storage;
    try {
      return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
      return null;
    }
  }

  private now(): number {
    return (this.deps.now ?? (() => performance.now()))();
  }

  private rng(): number {
    return (this.deps.rng ?? Math.random)();
  }

  private get doc() {
    return this.deps.document !== undefined ? this.deps.document : typeof document !== "undefined" ? document : null;
  }

  private get win() {
    return this.deps.window !== undefined ? this.deps.window : typeof window !== "undefined" ? window : null;
  }

  private ledger(): WolvesLedger {
    return new WolvesLedger(this.storage);
  }

  // --- ustawienia ---------------------------------------------------------------------------------------------

  getSettings(): AudioSettings {
    if (!this.settingsLoaded) {
      this.settings = loadSettings(this.storage);
      this.settingsLoaded = true;
    }
    return this.settings;
  }

  updateSettings(patch: Partial<AudioSettings>): void {
    const next = { ...this.getSettings(), ...patch };
    const clean = {
      master: Math.min(1, Math.max(0, next.master)),
      ambience: Math.min(1, Math.max(0, next.ambience)),
      effects: Math.min(1, Math.max(0, next.effects)),
      muted: Boolean(next.muted),
    };
    this.settings = clean;
    saveSettings(this.storage, clean);
    this.applySettings();
    for (const fn of this.subscribers) fn();
  }

  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private applySettings(): void {
    const s = this.session;
    if (!s || s.disposed) return;
    const t = s.ctx.currentTime;
    const cfg = this.getSettings();
    setParam(s.master.gain, cfg.muted ? 0 : cfg.master, t, 0.05);
    setParam(s.ambienceVol.gain, cfg.ambience, t, 0.08);
    setParam(s.effectsVol.gain, cfg.effects, t, 0.08);
  }

  // --- cykl życia -----------------------------------------------------------------------------------------------

  get active(): boolean {
    return this.session !== null && !this.session.disposed;
  }

  /** Wejście do lasu: tworzy kontekst audio (wywołuj z gestu użytkownika albo tuż po nim) i uruchamia pętlę czasu. */
  enter(init: { elapsed: number; saveId: string | null }): void {
    if (this.session && !this.session.disposed) {
      this.session.watcher.rebase(init.elapsed);
      this.session.elapsed = init.elapsed;
      this.session.hour = gameHour(init.elapsed);
      return;
    }
    let ctx: AudioContext;
    try {
      const factory = this.deps.createContext ?? (() => new AudioContext({ latencyHint: "interactive" }));
      ctx = factory();
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Web Audio jest niedostępne";
      return;
    }
    this.error = null;
    const cfg = this.getSettings();
    const t = ctx.currentTime;
    const gain = (value: number) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };
    const master = gain(cfg.muted ? 0 : cfg.master);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.ratio.value = 4;
    const ambienceVol = gain(cfg.ambience);
    const ambienceMode = gain(this.mode.dialog ? DIALOG_AMBIENCE : 1);
    const duck = gain(1);
    const fade = gain(0);
    const effectsVol = gain(cfg.effects);
    ambienceVol.connect(ambienceMode);
    ambienceMode.connect(duck);
    duck.connect(fade);
    fade.connect(master);
    effectsVol.connect(master);
    master.connect(compressor);
    compressor.connect(ctx.destination);
    const layer = (id: string): Layer => {
      const g = gain(0);
      g.connect(ambienceVol);
      return { id, gain: g, source: null, primed: false, idleSince: null };
    };

    const rng = () => this.rng();
    const session: Session = {
      ctx,
      saveId: init.saveId ?? "local",
      master,
      compressor,
      ambienceVol,
      ambienceMode,
      duck,
      fade,
      effectsVol,
      layers: { day: layer(AMBIENCE_DAY), night: layer(AMBIENCE_NIGHT) },
      voices: new Set(),
      loader: null,
      watcher: new MidnightWatcher(init.elapsed),
      birds: new WildlifeScheduler(rng),
      steps: this.createSteps(ctx, effectsVol),
      hidden: Boolean(this.doc?.hidden),
      disposed: false,
      timer: null,
      lastTick: this.now(),
      pose: null,
      elapsed: init.elapsed,
      hour: gameHour(init.elapsed),
      naturalMidnights: new Set(),
      wolvesLoading: false,
      cleanup: [],
    };
    this.session = session;
    setParam(fade.gain, 1, t, FADE_IN_TAU);

    this.attachBrowserHooks(session);
    session.timer = setInterval(() => this.tick(session), TICK_MS);
    this.resume(session);
    this.mount(session).catch(() => undefined);
  }

  /** Wyjście z lasu: szybkie wyciszenie, potem zatrzymanie źródeł, rozłączenie grafu i zamknięcie kontekstu. */
  leave(): void {
    this.clearRemotePlayers();
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.timer !== null) clearInterval(s.timer);
    s.timer = null;
    if (!s.disposed) setParam(s.fade.gain, 0, s.ctx.currentTime, 0.12);
    const entry = {
      session: s,
      timer: setTimeout(() => {
        this.closing.delete(entry);
        this.disposeSession(s);
      }, LEAVE_MS),
    };
    this.closing.add(entry);
  }

  /** Natychmiastowe zwolnienie wszystkiego (zamknięcie aplikacji, testy). */
  dispose(): void {
    this.clearRemotePlayers();
    const s = this.session;
    this.session = null;
    if (s) this.disposeSession(s);
    for (const entry of this.closing) {
      clearTimeout(entry.timer);
      this.disposeSession(entry.session);
    }
    this.closing.clear();
    this.subscribers.clear();
  }

  private disposeSession(s: Session): void {
    if (s.disposed) return;
    s.disposed = true;
    if (s.timer !== null) clearInterval(s.timer);
    s.timer = null;
    for (const undo of s.cleanup) undo();
    s.cleanup = [];
    for (const voice of [...s.voices]) this.finishVoice(s, voice, true);
    for (const layer of Object.values(s.layers)) {
      this.stopLayer(layer);
      layer.gain.disconnect();
    }
    s.loader?.dispose();
    s.loader = null;
    this.disposeSteps(s);
    for (const node of [s.ambienceVol, s.ambienceMode, s.duck, s.fade, s.effectsVol, s.master, s.compressor]) node.disconnect();
    s.ctx.close().catch(() => undefined);
  }

  // --- przeglądarka: autoplay i widoczność karty ------------------------------------------------------------------------

  private attachBrowserHooks(s: Session): void {
    const win = this.win;
    if (win) {
      const onGesture = () => {
        if (s.disposed || s.hidden) return;
        if (s.ctx.state === "suspended") this.resume(s);
      };
      for (const name of GESTURE_EVENTS) win.addEventListener(name, onGesture, { capture: true, passive: true });
      s.cleanup.push(() => {
        for (const name of GESTURE_EVENTS) win.removeEventListener(name, onGesture, { capture: true } as EventListenerOptions);
      });
    }
    const doc = this.doc;
    if (doc) {
      const onVisibility = () => {
        if (s.disposed) return;
        s.hidden = Boolean(doc.hidden);
        if (s.hidden) {
          this.clearRemotePlayers();
          s.ctx.suspend().catch(() => undefined);
          s.steps.player.scheduler.reset();
        } else {
          s.lastTick = this.now();
          this.resume(s);
        }
      };
      doc.addEventListener("visibilitychange", onVisibility);
      s.cleanup.push(() => doc.removeEventListener("visibilitychange", onVisibility));
    }
  }

  private resume(s: Session): void {
    if (s.disposed || s.hidden) return;
    if (s.ctx.state === "running") return;
    s.ctx.resume().catch(() => undefined);
  }

  private running(s: Session): boolean {
    return !s.disposed && !s.hidden && s.ctx.state === "running";
  }

  // --- wczytywanie zasobów ----------------------------------------------------------------------------------------------

  private loadManifest(): Promise<AudioManifest> {
    if (this.manifest) return Promise.resolve(this.manifest);
    this.manifestLoading ??= (async () => {
      const doFetch = this.deps.fetch ?? fetch.bind(globalThis);
      const response = await doFetch(this.deps.manifestUrl ?? MANIFEST_URL);
      if (!response.ok) throw new Error(`Manifest audio: HTTP ${response.status}`);
      const json: unknown = await response.json();
      if (!isAudioManifest(json)) throw new Error("Manifest audio ma zły format");
      this.manifest = json;
      return json;
    })().finally(() => {
      this.manifestLoading = null;
    });
    return this.manifestLoading;
  }

  private async mount(s: Session): Promise<void> {
    try {
      const manifest = await this.loadManifest();
      if (s.disposed) return;
      const canPlay = this.deps.canPlayType ?? ((type: string) => (typeof Audio !== "undefined" ? new Audio().canPlayType(type) : ""));
      s.loader = new AssetLoader(s.ctx, manifest, {
        fetch: this.deps.fetch ?? fetch.bind(globalThis),
        canPlay: (type) => canPlay(type) !== "",
      });
      this.prepareFootsteps(s, manifest);
      this.updateAmbience(s);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Cztery próbki kroków dekodowane raz na sesję; gracz i troll dzielą te same `AudioBuffer`y. */
  private prepareFootsteps(s: Session, manifest: AudioManifest): void {
    const loader = s.loader;
    if (!loader) return;
    for (const ids of Object.values(FOOTSTEP_POOLS)) {
      for (const id of ids) {
        if (!(id in manifest.assets)) continue;
        loader
          .load(id)
          .then((buffer) => {
            if (s.disposed) return;
            s.steps.buffers.set(id, buffer);
            this.rebuildStepPools(s);
          })
          .catch(() => undefined);
      }
    }
  }

  private rebuildStepPools(s: Session): void {
    const steps = s.steps;
    steps.pools.clear();
    for (const [key, ids] of Object.entries(FOOTSTEP_POOLS)) {
      const have = ids.filter((id) => steps.buffers.has(id));
      steps.pools.set(key, { ids: have, buffers: have.map((id) => steps.buffers.get(id) as AudioBuffer) });
    }
    steps.ready = [...steps.pools.values()].every((p) => p.buffers.length > 0);
  }

  private createSteps(ctx: AudioContext, effectsVol: GainNode): StepsState {
    const gain = (value: number) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };
    const volumes = this.stepVolumes;
    const playerBus = gain(STEP_LEVELS.player * volumes.player);
    playerBus.connect(effectsVol);
    const npcBus = gain(STEP_LEVELS.npc * volumes.npc);
    const heavy = ctx.createBiquadFilter();
    heavy.type = "lowshelf";
    heavy.frequency.value = NPC_STEP_SOUND.heavyShelf.frequency;
    heavy.gain.value = NPC_STEP_SOUND.heavyShelf.gainDb;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = NPC_STEP_SOUND.lowpass.base;
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = NPC_STEP_SOUND.refDistance;
    panner.rolloffFactor = NPC_STEP_SOUND.rolloff;
    panner.maxDistance = 10000;
    heavy.connect(lowpass);
    lowpass.connect(panner);
    panner.connect(npcBus);
    npcBus.connect(effectsVol);
    const base = () => this.rng();
    return {
      buffers: new Map(),
      pools: new Map(),
      ready: false,
      player: {
        scheduler: new FootstepScheduler(PLAYER_STRIDE),
        voicing: new StepVoicing(forkRng(base), PLAYER_VARIATION),
        bus: playerBus,
        voices: 0,
        last: null,
        count: 0,
        surface: null,
        times: [],
      },
      npc: {
        voicing: new StepVoicing(forkRng(base), NPC_VARIATION),
        bus: npcBus,
        heavy,
        lowpass,
        panner,
        voices: 0,
        last: null,
        count: 0,
        lastAt: -Infinity,
        lastDistance: null,
        lastAttenuationDb: null,
        lastBearingDeg: null,
        lastFoot: null,
        culled: 0,
      },
      preview: { timers: [] },
    };
  }

  private disposeSteps(s: Session): void {
    const st = s.steps;
    this.cancelPreview(st);
    st.buffers.clear();
    st.pools.clear();
    st.ready = false;
    for (const node of [st.player.bus, st.npc.heavy, st.npc.lowpass, st.npc.panner, st.npc.bus]) node.disconnect();
  }

  // --- zegar, tryb i pozycja -------------------------------------------------------------------------------------------

  /**
   * Czas gry. Wywołuj przy każdej zmianie `elapsed`. Naturalny upływ czasu może wywołać wilki o północy,
   * a skok (zapowiedziany przez `jumpClock` albo duża zmiana) tylko przesuwa punkt odniesienia.
   */
  setClock(elapsed: number): void {
    const s = this.session;
    if (!s || s.disposed) return;
    const step = s.watcher.advance(elapsed, this.now());
    if (step.kind === "ignored") return;
    s.elapsed = elapsed;
    s.hour = gameHour(elapsed);
    if (step.kind === "crossed") this.onMidnight(s, step.midnight);
  }

  /** Zapowiedź ręcznej zmiany czasu (panel deweloperski) na `target`: bez wilków za pominięte północe. */
  jumpClock(target: number): void {
    const s = this.session;
    if (!s || s.disposed) return;
    s.watcher.expectJump(target, this.now());
  }

  setMode(mode: AudioMode): void {
    const changed = mode.dialog !== this.mode.dialog || mode.frozen !== this.mode.frozen;
    this.mode = { ...mode };
    const s = this.session;
    if (!s || s.disposed || !changed) return;
    setParam(s.ambienceMode.gain, mode.dialog ? DIALOG_AMBIENCE : 1, s.ctx.currentTime, MODE_TAU);
    if (mode.dialog || mode.frozen) s.steps.player.scheduler.reset();
  }

  /** Pozycja i kierunek gracza (z kamery): ustawia tylko odbiornik dźwięku 3D. Kroki idą osobno przez `playerMotion`. */
  setPose(pose: ListenerPose): void {
    const s = this.session;
    if (!s || s.disposed) return;
    const ctxTime = s.ctx.currentTime;
    pose = {...pose,y:pose.y ?? s.pose?.y ?? EAR_HEIGHT};
    s.pose = pose;
    const l = s.ctx.listener;
    const fx = -Math.sin(pose.yaw);
    const fz = -Math.cos(pose.yaw);
    if (l.positionX) {
      setParam(l.positionX, pose.x, ctxTime, 0.015);
      setParam(l.positionY, pose.y ?? s.pose?.y ?? EAR_HEIGHT, ctxTime, 0.015);
      setParam(l.positionZ, pose.z, ctxTime, 0.015);
      setParam(l.forwardX, fx, ctxTime, 0.02);
      setParam(l.forwardY, 0, ctxTime, 0.02);
      setParam(l.forwardZ, fz, ctxTime, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(pose.x, pose.y ?? EAR_HEIGHT, pose.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  // --- warstwa A: ambient -------------------------------------------------------------------------------------------

  private layerNeeded(s: Session, which: "day" | "night"): { now: number; soon: number } {
    return { now: ambientMix(s.hour)[which], soon: ambientMix(s.hour + LOOKAHEAD_HOURS)[which] };
  }

  private updateAmbience(s: Session): void {
    const loader = s.loader;
    if (!loader || s.disposed) return;
    const t = s.ctx.currentTime;
    const nowMs = this.now();
    for (const which of ["day", "night"] as const) {
      const layer = s.layers[which];
      const need = this.layerNeeded(s, which);
      const target = need.now;
      const wanted = need.now > 0.001 || need.soon > 0.001;
      if (wanted) {
        layer.idleSince = null;
        const buffer = loader.get(layer.id);
        if (!buffer && !loader.isLoading(layer.id)) loader.load(layer.id).catch(() => undefined);
        if (buffer && !layer.source) this.startLayer(s, layer, buffer, target);
      } else if (layer.source) {
        layer.idleSince ??= nowMs;
        if (nowMs - layer.idleSince > IDLE_RELEASE_MS) {
          this.stopLayer(layer);
          loader.release(layer.id);
          layer.idleSince = null;
        }
      }
      if (layer.primed) setParam(layer.gain.gain, target, t, MIX_TAU);
    }
    this.maintainWolvesBuffer(s);
    this.maintainBirdBuffers(s);
  }

  private startLayer(s: Session, layer: Layer, buffer: AudioBuffer, target: number): void {
    const source = s.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(layer.gain);
    layer.gain.gain.value = target;
    layer.primed = true;
    source.start(0, this.rng() * buffer.duration);
    layer.source = source;
  }

  private stopLayer(layer: Layer): void {
    const source = layer.source;
    if (source) {
      try {
        source.stop();
      } catch {
        // źródło mogło już zostać zatrzymane
      }
      source.disconnect();
    }
    layer.source = null;
    layer.primed = false;
  }

  // --- warstwa B: zwierzęta i zdarzenia ------------------------------------------------------------------------------

  private maintainBirdBuffers(s: Session): void {
    const loader = s.loader;
    if (!loader) return;
    const wanted = birdActivity(s.hour) > 0.03 || birdActivity(s.hour + LOOKAHEAD_HOURS) > 0.03;
    for (const id of BIRD_IDS) {
      if (wanted && loader.has(id) && !loader.get(id) && !loader.isLoading(id)) loader.load(id).catch(() => undefined);
      if (!wanted && loader.get(id)) loader.release(id);
    }
  }

  private maintainWolvesBuffer(s: Session): void {
    const loader = s.loader;
    if (!loader || !loader.has(WOLVES)) return;
    const h = s.hour;
    const near = h >= 22.75 || h < 0.5;
    const playing = [...s.voices].some((v) => v.kind === "wolves");
    if (near && !loader.get(WOLVES) && !loader.isLoading(WOLVES)) loader.load(WOLVES).catch(() => undefined);
    if (!near && !playing && !s.wolvesLoading && loader.get(WOLVES)) loader.release(WOLVES);
  }

  private effectCount(s: Session): number {
    let n = 0;
    for (const v of s.voices) if (v.kind === "bird" || v.kind === "wolves") n++;
    return n;
  }

  private tick(s: Session): void {
    if (s.disposed || s !== this.session) return;
    const now = this.now();
    const dt = Math.min(1, Math.max(0, (now - s.lastTick) / 1000));
    s.lastTick = now;
    if (s.hidden) return;
    this.updateAmbience(s);
    if (!this.running(s)) return;
    const event = s.birds.tick(dt, { hour: s.hour, dialog: this.mode.dialog, activeEffects: this.effectCount(s) });
    if (event) this.playBird(s, event);
  }

  private spatial(s: Session, bearing: number, distance: number, height: number) {
    const pose = s.pose ?? { x: 0, z: 0, yaw: 0 };
    return { x: pose.x + Math.cos(bearing) * distance, y: EAR_HEIGHT + height, z: pose.z + Math.sin(bearing) * distance };
  }

  private playBird(s: Session, e: BirdEvent): void {
    const buffer = s.loader?.get(e.sound);
    if (!buffer) return;
    const voice = this.startSpatialVoice(s, "bird", buffer, {
      gain: e.gain,
      rate: e.rate,
      bearing: e.bearing,
      distance: e.distance,
      height: e.height,
      panner: BIRD_PANNER,
    });
    if (voice) this.recordEffect({ label: e.sound, kind: "bird", at: this.now(), distance: e.distance, bearingDeg: this.bearingDeg(s, e.bearing), rate: e.rate });
  }

  private bearingDeg(s: Session, bearing: number): number {
    const yaw = s.pose?.yaw ?? 0;
    // kąt względem kierunku patrzenia: 0 = przed graczem, dodatni = na prawo
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const dx = Math.cos(bearing);
    const dz = Math.sin(bearing);
    return Math.round((Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz) * 180) / Math.PI);
  }

  private startSpatialVoice(
    s: Session,
    kind: "bird" | "wolves",
    buffer: AudioBuffer,
    o: { gain: number; rate: number; bearing: number; distance: number; height: number; panner: { ref: number; rolloff: number } },
  ): Voice | null {
    const ctx = s.ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = o.rate;
    const env = ctx.createGain();
    env.gain.value = o.gain;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = Math.min(16000, Math.max(3000, 16000 - o.distance * 130));
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = o.panner.ref;
    panner.rolloffFactor = o.panner.rolloff;
    panner.maxDistance = 10000;
    const p = this.spatial(s, o.bearing, o.distance, o.height);
    setPosition(panner, p.x, p.y, p.z);
    source.connect(env);
    env.connect(lowpass);
    lowpass.connect(panner);
    panner.connect(s.effectsVol);
    const voice: Voice = { kind, source, nodes: [env, lowpass, panner], done: false };
    s.voices.add(voice);
    source.onended = () => this.finishVoice(s, voice, false);
    source.start();
    return voice;
  }

  private finishVoice(s: Session, voice: Voice, stop: boolean): void {
    if (voice.done) return;
    voice.done = true;
    voice.source.onended = null;
    if (stop) {
      try {
        voice.source.stop();
      } catch {
        // już zatrzymane
      }
    }
    voice.source.disconnect();
    for (const node of voice.nodes) node.disconnect();
    s.voices.delete(voice);
    if (voice.kind === "step") s.steps.player.voices--;
    else if (voice.kind === "npcstep") s.steps.npc.voices--;
    if (voice.kind === "wolves" && !s.disposed && ![...s.voices].some((v) => v.kind === "wolves")) {
      setParam(s.duck.gain, 1, s.ctx.currentTime, 1.2);
    }
  }

  private recordEffect(info: EffectInfo): void {
    this.lastEffect = info;
  }

  // --- wilki ---------------------------------------------------------------------------------------------------------

  private onMidnight(s: Session, midnight: number): void {
    if (s.naturalMidnights.has(midnight)) return;
    s.naturalMidnights.add(midnight);
    if (this.ledger().played(s.saveId, midnight)) {
      this.lastMidnight = { midnight, result: "wilki już były tej nocy (zapis)" };
      return;
    }
    if (!this.running(s)) {
      this.lastMidnight = { midnight, result: "pominięte: dźwięk zablokowany albo karta w tle" };
      return;
    }
    this.lastMidnight = { midnight, result: "odtwarzanie" };
    this.playWolves(s, "natural", midnight).catch(() => {
      this.lastMidnight = { midnight, result: "błąd wczytania nagrania" };
    });
  }

  /** Ręczny test wilków: nie zapisuje północy, nie rusza harmonogramu ptaków ani zegara. */
  testWolves(): boolean {
    const s = this.session;
    if (!s || s.disposed || !this.running(s)) return false;
    if ([...s.voices].some((v) => v.kind === "wolves")) return false;
    this.playWolves(s, "test", null).catch(() => undefined);
    return true;
  }

  private async playWolves(s: Session, kind: "natural" | "test", midnight: number | null): Promise<void> {
    const loader = s.loader;
    if (!loader || !loader.has(WOLVES)) throw new Error("Brak nagrania wilków");
    s.wolvesLoading = true;
    let buffer: AudioBuffer;
    try {
      buffer = await loader.load(WOLVES);
    } finally {
      s.wolvesLoading = false;
    }
    if (s.disposed || s !== this.session) return;
    if (!this.running(s)) {
      if (midnight !== null) this.lastMidnight = { midnight, result: "pominięte: dźwięk zablokowany albo karta w tle" };
      return;
    }
    const [d0, d1] = WOLVES_CONFIG.distance;
    const bearing = this.rng() * Math.PI * 2;
    const distance = d0 + (d1 - d0) * this.rng();
    const voice = this.startSpatialVoice(s, "wolves", buffer, {
      gain: WOLVES_CONFIG.gain,
      rate: 1,
      bearing,
      distance,
      height: WOLVES_CONFIG.height,
      panner: WOLVES_CONFIG.panner,
    });
    if (!voice) return;
    setParam(s.duck.gain, WOLVES_CONFIG.duck, s.ctx.currentTime, 0.5);
    this.recordEffect({
      label: kind === "natural" ? "wilki (północ)" : "wilki (test)",
      kind: kind === "natural" ? "wolves" : "wolves-test",
      at: this.now(),
      distance,
      bearingDeg: this.bearingDeg(s, bearing),
      rate: 1,
    });
    if (kind === "natural" && midnight !== null) {
      this.ledger().record(s.saveId, midnight);
      this.lastWolvesSave = s.saveId;
      this.lastMidnight = { midnight, result: "odtworzone" };
    }
  }

  // --- warstwa C: kroki ---------------------------------------------------------------------------------------------

  setSurfaceResolver(resolver: SurfaceResolver | null): void {
    this.surfaceResolver = resolver;
  }

  /** Głośności kroków (tylko panel deweloperski, bez zapisu): mnożą `STEP_LEVELS` i podlegają ustawieniom master/efekty/wyciszenie. */
  setStepVolumes(patch: Partial<StepVolumes>): void {
    const clamp = (v: number) => Math.min(2, Math.max(0, v));
    this.stepVolumes = {
      player: patch.player === undefined ? this.stepVolumes.player : clamp(patch.player),
      npc: patch.npc === undefined ? this.stepVolumes.npc : clamp(patch.npc),
    };
    const s = this.session;
    if (s && !s.disposed) {
      const t = s.ctx.currentTime;
      setParam(s.steps.player.bus.gain, STEP_LEVELS.player * this.stepVolumes.player, t, 0.05);
      setParam(s.steps.npc.bus.gain, STEP_LEVELS.npc * this.stepVolumes.npc, t, 0.05);
    }
    for (const fn of this.subscribers) fn();
  }

  getStepVolumes(): StepVolumes {
    return { ...this.stepVolumes };
  }

  /** Ruch gracza w tej klatce (z pętli gry): akumulator drogi decyduje, czy przypada krok. Bez stanu Reacta i bez timerów. */
  playerMotion(distance: number, dt: number, x: number, z: number): void {
    const s = this.session;
    if (!s || s.disposed) return;
    const player = s.steps.player;
    const frozen = this.mode.frozen || this.mode.dialog || !this.running(s);
    if (!player.scheduler.update(distance, dt, frozen)) return;
    if (!s.steps.ready) return;
    const surface = this.surfaceResolver ? this.surfaceResolver(x, z) : DEFAULT_SURFACE;
    const profile = SURFACE_PROFILES[surface];
    const pool = s.steps.pools.get(profile.pool);
    if (!pool || pool.buffers.length === 0) return;
    const ev = player.voicing.next(profile.pool, pool.buffers.length, player.scheduler.running);
    player.surface = surface;
    if (player.voices >= PLAYER_MAX_VOICES) return;
    this.playPlayerStep(s, pool, ev, profile.gain, profile.lowpassHz);
    this.recordPlayerStep(player, pool, ev.sample);
  }

  private recordPlayerStep(player: StepsState["player"], pool: StepPool, sample: number): void {
    const now = this.now();
    player.last = sampleNumber(pool.ids[sample]);
    player.count++;
    player.times.push(now);
    while (player.times.length > 0 && now - player.times[0] > STEP_RATE_WINDOW * 1000) player.times.shift();
  }

  private playPlayerStep(s: Session, pool: StepPool, ev: StepEvent, surfaceGain: number, lowpassHz: number): void {
    const ctx = s.ctx;
    const source = ctx.createBufferSource();
    source.buffer = pool.buffers[ev.sample];
    source.playbackRate.value = ev.rate;
    const env = ctx.createGain();
    env.gain.value = ev.gain * surfaceGain;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = Math.min(18000, lowpassHz * ev.tone);
    source.connect(env);
    env.connect(lowpass);
    const panner=ctx.createPanner();panner.panningModel='HRTF';panner.rolloffFactor=0;
    setPosition(panner,s.pose?.x??0,(s.pose?.y??EAR_HEIGHT)-EAR_HEIGHT+0.1,s.pose?.z??0);
    lowpass.connect(panner);panner.connect(s.steps.player.bus);
    const voice: Voice = { kind: "step", source, nodes: [env, lowpass, panner], done: false };
    s.voices.add(voice);
    s.steps.player.voices++;
    source.onended = () => this.finishVoice(s, voice, false);
    source.start();
  }

  /** Krok trolla w jego pozycji w świecie (zdarzenie z fazy kontaktu stopy w animacji Walk), nie gracza i nie kamery. */
  npcStep(x: number, z: number, foot: 0 | 1): void {
    const s = this.session;
    if (!s || s.disposed || !s.pose || !s.steps.ready) return;
    if (this.mode.dialog || this.mode.frozen || !this.running(s)) return;
    const npc = s.steps.npc;
    const distance = Math.hypot(x - s.pose.x, z - s.pose.z);
    if (distance >= NPC_STEP_SOUND.cullDistance) {
      npc.culled++;
      return;
    }
    if (npc.voices >= NPC_STEP_SOUND.maxVoices) return;
    const surface = this.surfaceResolver ? this.surfaceResolver(x, z) : DEFAULT_SURFACE;
    const profile = SURFACE_PROFILES[surface];
    const pool = s.steps.pools.get(profile.pool);
    if (!pool || pool.buffers.length === 0) return;
    const ev = npc.voicing.next(profile.pool, pool.buffers.length, false);
    this.playNpcStep(s, pool, ev, x, z, distance, profile.gain);
    npc.last = sampleNumber(pool.ids[ev.sample]);
    npc.count++;
    npc.lastFoot = foot === 0 ? "L" : "P";
    npc.lastBearingDeg = relativeBearingDeg(s.pose, x, z);
  }

  private playNpcStep(s: Session, pool: StepPool, ev: StepEvent, x: number, z: number, distance: number, surfaceGain: number): void {
    const ctx = s.ctx;
    const npc = s.steps.npc;
    setPosition(npc.panner, x, NPC_STEP_SOUND.footHeight, z);
    npc.lowpass.frequency.value = Math.min(18000, npcStepLowpass(distance) * ev.tone);
    const source = ctx.createBufferSource();
    source.buffer = pool.buffers[ev.sample];
    source.playbackRate.value = ev.rate;
    const env = ctx.createGain();
    env.gain.value = ev.gain * surfaceGain * npcStepFade(distance);
    source.connect(env);
    env.connect(npc.heavy);
    const voice: Voice = { kind: "npcstep", source, nodes: [env], done: false };
    s.voices.add(voice);
    npc.voices++;
    source.onended = () => this.finishVoice(s, voice, false);
    source.start();
    npc.lastAt = this.now();
    npc.lastDistance = Math.round(distance * 10) / 10;
    npc.lastAttenuationDb = Math.round(npcStepAttenuationDb(distance) * 10) / 10;
  }

  /** Odsłuch czterech próbek po kolei: `player` (bez zmienności, tuż przy uchu) albo `npc` (przestrzennie, 6 m przed graczem). */
  previewSteps(owner: "player" | "npc"): boolean {
    const s = this.session;
    if (!s || s.disposed || !this.running(s) || !s.steps.ready) return false;
    const st = s.steps;
    const pool = st.pools.get(SURFACE_PROFILES[DEFAULT_SURFACE].pool);
    if (!pool || pool.buffers.length === 0 || st.preview.timers.length > 0) return false;
    pool.buffers.forEach((_, i) => {
      const timer = setTimeout(() => {
        st.preview.timers = st.preview.timers.filter((t) => t !== timer);
        if (s.disposed || !this.running(s)) return;
        const ev: StepEvent = { sample: i, gain: 1, rate: 1, tone: 1, run: false };
        if (owner === "player") {
          this.playPlayerStep(s, pool, ev, 1, 16000);
          st.player.last = sampleNumber(pool.ids[i]);
        } else {
          const pose = s.pose ?? { x: 0, z: 0, yaw: 0 };
          const x = pose.x - Math.sin(pose.yaw) * PREVIEW_DISTANCE;
          const z = pose.z - Math.cos(pose.yaw) * PREVIEW_DISTANCE;
          this.playNpcStep(s, pool, { ...ev, rate: 0.94 }, x, z, PREVIEW_DISTANCE, 1);
          st.npc.last = sampleNumber(pool.ids[i]);
        }
      }, i * PREVIEW_GAP_MS);
      st.preview.timers.push(timer);
    });
    return true;
  }

  private cancelPreview(st: StepsState): void {
    for (const t of st.preview.timers) clearTimeout(t);
    st.preview.timers = [];
  }

  // --- diagnostyka ---------------------------------------------------------------------------------------------------

  private stepDiagnostics(s: Session | null): StepDiagnostics {
    const total = Object.values(FOOTSTEP_POOLS).reduce((n, ids) => n + ids.length, 0);
    if (!s) {
      return {
        ready: false,
        loaded: 0,
        total,
        player: { last: null, count: 0, perSecond: 0, surface: null, surfaceLabel: "-" },
        npc: { last: null, count: 0, emitterActive: false, lastDistance: null, lastAttenuationDb: null, lastBearingDeg: null, lastFoot: null, culled: 0 },
        volumes: { ...this.stepVolumes },
        previewing: false,
      };
    }
    const { player, npc } = s.steps;
    const now = this.now();
    const recent = player.times.filter((t) => now - t <= STEP_RATE_WINDOW * 1000);
    const perSecond = recent.length > 1 ? Math.round(((recent.length - 1) / ((recent[recent.length - 1] - recent[0]) / 1000)) * 100) / 100 : 0;
    return {
      ready: s.steps.ready,
      loaded: s.steps.buffers.size,
      total,
      player: {
        last: player.last,
        count: player.count,
        perSecond: now - (recent[recent.length - 1] ?? -Infinity) > 1500 ? 0 : perSecond,
        surface: player.surface,
        surfaceLabel: player.surface ? SURFACE_PROFILES[player.surface].label : "-",
      },
      npc: {
        last: npc.last,
        count: npc.count,
        emitterActive: now - npc.lastAt < EMITTER_ACTIVE_MS,
        lastDistance: npc.lastDistance,
        lastAttenuationDb: npc.lastAttenuationDb,
        lastBearingDeg: npc.lastBearingDeg,
        lastFoot: npc.lastFoot,
        culled: npc.culled,
      },
      volumes: { ...this.stepVolumes },
      previewing: s.steps.preview.timers.length > 0,
    };
  }

  getDiagnostics(): AudioDiagnostics {
    const s = this.session;
    const hour = s ? s.hour : 0;
    const mix = ambientMix(hour);
    const dayGain = s ? s.layers.day.gain.gain.value : 0;
    const nightGain = s ? s.layers.night.gain.gain.value : 0;
    let background = "-";
    if (s) {
      const d = dayGain > 0.02;
      const n = nightGain > 0.02;
      background = d && n ? `dzień + noc (crossfade, ${mix.phase})` : d ? "dzień (birds-in-forest-loop-1239)" : n ? "noc (forest-at-night-1224)" : "cisza (ładowanie)";
    }
    let effects = 0;
    let steps = 0;
    if (s) {
      for (const v of s.voices) {
        if (v.kind === "bird" || v.kind === "wolves") effects++;
        else steps++;
      }
    }
    const saveId = s?.saveId ?? this.lastWolvesSave;
    return {
      active: this.active,
      error: this.error,
      contextState: s ? (s.hidden ? "wstrzymany (karta w tle)" : s.ctx.state) : "-",
      hour,
      phase: phaseOf(hour),
      background,
      dayGain,
      nightGain,
      dayLoaded: Boolean(s?.layers.day.source),
      nightLoaded: Boolean(s?.layers.night.source),
      activeEffects: effects,
      activeSteps: steps,
      lastEffect: this.lastEffect,
      wolvesLastMidnight: saveId ? this.ledger().last(saveId) : null,
      lastMidnight: this.lastMidnight,
      steps: this.stepDiagnostics(s),
      walking: Boolean(s?.steps.player.scheduler.walking),
      running: Boolean(s?.steps.player.scheduler.running),
      mode: this.mode,
      muted: this.getSettings().muted,
      loaded: s?.loader?.loaded() ?? [],
    };
  }
}

let shared: ForestAudioController | null = null;

/** Jedyna instancja kontrolera w aplikacji. */
export function getForestAudio(): ForestAudioController {
  shared ??= new ForestAudioController();
  return shared;
}
