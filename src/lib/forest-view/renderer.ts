import * as THREE from "three";
import { AssetLibrary, DEFAULT_QUALITY, type QualityId } from "@/lib/assets";
import { loadTrollAsset, type TrollAsset } from "@/lib/assets/characters";
import { loadChestAsset } from "@/lib/assets/props";
import { forestChestsOf, forestOf, forestWalkOf, syncHarvestedColliders } from "@/lib/game/world/lookup";
import { BRIDGE_FLAG } from "@/lib/game/world/generators/v2";
import { BENCHMARK_SECONDS, benchmarkPose, buildBenchmarkRoute, type BenchmarkRoute } from "./benchmark";
import { atmosphereAt, DEFAULT_HOUR, type AtmosphereState, type Rgb } from "./atmosphere";
import { FirstPersonController, type MoveInput } from "./controller";
import { FrameStats } from "./frameStats";
import { buildGroundMesh, buildWaterMesh, createGroundBuilder, type GroundMeshData, type GroundStyle } from "./ground";
import { GRADE_UNIFORM_DECL, GROUND_DETAIL_FRAGMENT, NOISE_GLSL, PaletteStore, gradeFragment } from "./grading";
import { GrassLab, sanitizeLab, type LabOptions } from "./grassLab";
import { ForestInstancer, type InstancerStats } from "./instancer";
import { DEFAULT_OVERRIDES, VIEW_PROFILES, type ForestViewProfile, type ViewOverrides } from "./profiles";
import { NpcLayer, type NpcStats } from "./npc";
import { ChestLayer, FxBurst, type BurstKind } from "./props";
import { STREAM_RADIUS } from "./stream";
import { forestModelIds, StreamedForest, type StreamStats } from "./streaming";
import { buildForestWindow, type ForestWindow, type WindowOptions } from "./window";
import { DEFAULT_PRESET, isModified, presetConfig, sanitizeTuning, tintedFog, type PresetId, type VisualConfig, type VisualTuning } from "./visual";

export type PanelStats = {
  fps: number;
  avgFps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  visibleInstances: number;
  totalInstances: number;
  activeModels: number;
  lod0Instances: number;
  lod1Instances: number;
  estimatedModelTriangles: number;
  fallbackModels: number;
  quality: QualityId;
  seed: number;
  sectorId: string;
  windowSectors: number;
  position: { x: number; y: number; z: number };
  groundTriangles: number;
  locked: boolean;
  loading: string | null;
  error: string | null;
  benchmark: { running: boolean; progress: number };
  showcase: { id: string; ix: number; iz: number; qualifies: boolean }[];
  stress: boolean;
  preset: PresetId;
  presetModified: boolean;
  /** Tymczasowy tryb diagnostyczny trawy jest włączony. */
  lab: boolean;
  /** Tryb streamingu (gra): stan okna sektorów; w prototypie null. */
  stream: StreamStats | null;
  /** Postęp ładowania początkowego pierścienia sektorów (0-1) w trybie streamingu. */
  loadProgress: number;
  /** Troll (prezentacja): stan animacji i patrolu; null, gdy model się nie wczytał albo nie jesteśmy w lesie. */
  npc?: NpcStats | null;
  /** Błąd wczytania modelu NPC (gra działa dalej bez niego). */
  npcError?: string | null;
};

export type BenchmarkReport = {
  quality: QualityId;
  seed: number;
  sector: string;
  windowSectors: number;
  seconds: number;
  frames: number;
  averageFps: number;
  onePercentLowFps: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgDrawCalls: number;
  avgTriangles: number;
  canvas: string;
  pixelRatio: number;
  gpu: string;
  userAgent: string;
  overrides: ViewOverrides;
  visual: VisualConfig;
  note: string;
};

/** Tryb gry: cały las 300 x 300 m z streamingiem sektorów zamiast jednego okna prototypu. */
export type StreamOptions = {
  seed: number;
  /** Pozycja startowa gracza (już zwalidowana, np. `safeForestPose`). */
  pose: { x: number; z: number; yaw: number };
  /** Czy most jest zbudowany (otwiera przejście przez rzekę). */
  bridgeBuilt?: boolean;
  /** Identyfikatory skrzyń otwartych w zapisie (pokrywa od razu otwarta, bez animacji). */
  opened?: readonly string[];
  /** Identyfikatory zebranych drzew i skał (znikają z lasu i z kolizji). */
  harvested?: readonly string[];
};

export type RendererOptions = {
  container: HTMLElement;
  /** Tryb gry (streaming). Bez tego renderer działa jak prototyp `/dev/forest`. */
  stream?: StreamOptions;
  window?: WindowOptions;
  quality?: QualityId;
  hour?: number;
  overrides?: Partial<ViewOverrides>;
  visual?: VisualConfig;
  onStats?: (stats: PanelStats) => void;
  /** Zmiana ustawień laboratorium trawy wywołana z poziomu sceny (przeciąganie myszą, kółko, obrót automatyczny). */
  onLab?: (options: LabOptions) => void;
};

/** Limity czasu pracy streamingu na klatkę (ms): w trakcie ładowania ekran jest zasłonięty, w grze liczy się płynność. */
const LOADING_BUDGET_MS = 28;
const STREAM_BUDGET_MS = 4;

const toLinear = (c: Rgb) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uGlow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    float t = smoothstep(-0.02, 0.75, h);
    vec3 col = mix(uHorizon, uZenith, pow(t, 0.65));
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(s, 6.0) * 0.12 + pow(s, 48.0) * 0.28 + pow(s, 900.0) * 1.2) * uGlow;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const PARTICLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uSize;
  attribute vec4 aSeed;
  varying float vAlpha;
  void main() {
    vec3 box = vec3(36.0, 11.0, 36.0);
    vec3 p = aSeed.xyz * box;
    p += vec3(sin(uTime * 0.21 + aSeed.w * 6.28) * 1.6, uTime * (0.05 + aSeed.w * 0.06), cos(uTime * 0.17 + aSeed.w * 9.0) * 1.6);
    p = mod(p - uCenter + box * 0.5, box) - box * 0.5;
    vec4 mv = viewMatrix * vec4(p + uCenter, 1.0);
    gl_Position = projectionMatrix * mv;
    float fade = 1.0 - smoothstep(0.35, 0.5, length(p.xz) / 36.0);
    vAlpha = fade * (0.35 + 0.65 * fract(aSeed.w * 7.0));
    gl_PointSize = uSize * (0.6 + aSeed.w) / max(0.5, -mv.z) * 90.0;
  }
`;
const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.0, 1.0, d)) * vAlpha * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

type Built = {
  window: ForestWindow;
  ground: THREE.Mesh;
  water: THREE.Mesh | null;
  groundTriangles: number;
  groundTextureSize: number;
  textures: Map<GroundStyle, THREE.DataTexture>;
};

/**
 * Renderer prototypu V2a (Three.js bez React): scena lasu z generatora W1a, światło słoneczne z cieniami, mgła, niebo,
 * kamera pierwszoosobowa z pointer lock oraz pomiary wydajności. Zmiana jakości przebudowuje tylko zasoby widoku
 * (biblioteka GLB, instancje, rozmiar cieni i tekstury), a świat i pozycja gracza zostają.
 */
export class ForestRenderer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 620);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1);
  private readonly sky: THREE.Mesh;
  private readonly skyUniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uGlow: { value: 1 },
  };
  private readonly particles: THREE.Points;
  private readonly particleUniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uSize: { value: 0.05 },
    uColor: { value: new THREE.Color(1, 0.95, 0.8) },
    uOpacity: { value: 0.5 },
  };
  private readonly frameStats = new FrameStats(0.5);
  private bench: { stats: FrameStats; route: BenchmarkRoute; t: number; calls: number; tris: number; n: number; resolve: (r: BenchmarkReport) => void } | null = null;
  private built: Built | null = null;
  private stream: StreamedForest | null = null;
  private streamOptions: StreamOptions | null = null;
  private chestLayer: ChestLayer | null = null;
  private npcLayer: NpcLayer | null = null;
  private npcError: string | null = null;
  private fx: FxBurst | null = null;
  private openedChests = new Set<string>();
  private harvestedIds = new Set<string>();
  private readonly worldFlags = new Set<string>();
  private suspended = false;
  private loadProgress = 0;
  private controller: FirstPersonController | null = null;
  private library: AssetLibrary | null = null;
  private instancer: ForestInstancer | null = null;
  private lab: GrassLab | null = null;
  private labOptions: LabOptions | null = null;
  private labGen = 0;
  private labDrag = false;
  private instancerStats: InstancerStats = { visible: 0, total: 0, activeModels: 0, triangles: 0, drawCalls: 0, perLevel: [0, 0], fallbackModels: 0 };
  private profile: ForestViewProfile;
  private quality: QualityId;
  private overrides: ViewOverrides;
  private atmosphere: AtmosphereState;
  private visual: VisualConfig;
  private readonly palette = new PaletteStore();
  private groundJob = 0;
  private hour: number;
  private windowOptions: WindowOptions;
  private generation = 0;
  private disposed = false;
  private raf = 0;
  private lastTime = 0;
  private elapsed = 0;
  private keys = new Set<string>();
  private locked = false;
  private loading: string | null = "Przygotowanie sceny";
  private error: string | null = null;
  private lastCamPos = new THREE.Vector3(1e9, 0, 0);
  private lastCamDir = new THREE.Vector3();
  private lastInstanceUpdate = 0;
  private dirtyInstances = true;
  private lastEmit = 0;
  private cleanup: (() => void)[] = [];
  private readonly onStats?: (stats: PanelStats) => void;
  private readonly onLab?: (options: LabOptions) => void;

  constructor(options: RendererOptions) {
    this.container = options.container;
    this.onStats = options.onStats;
    this.onLab = options.onLab;
    this.windowOptions = options.window ?? {};
    this.streamOptions = options.stream ?? null;
    this.openedChests = new Set(options.stream?.opened ?? []);
    this.harvestedIds = new Set(options.stream?.harvested ?? []);
    if (options.stream?.bridgeBuilt) this.worldFlags.add(BRIDGE_FLAG);
    this.quality = options.quality ?? DEFAULT_QUALITY;
    this.profile = VIEW_PROFILES[this.quality];
    this.overrides = { ...DEFAULT_OVERRIDES, ...options.overrides };
    this.hour = options.hour ?? DEFAULT_HOUR;
    this.visual = options.visual ? structuredClone(options.visual) : presetConfig(DEFAULT_PRESET);
    this.atmosphere = atmosphereAt(this.hour, this.visual.look.dayModel);
    this.palette.setPalette(this.visual.look.palette, this.visual.tuning.greenSaturation, this.visual.look.groundDetail);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.style.cssText = "display:block;width:100%;height:100%;outline:none";
    this.renderer.domElement.tabIndex = 0;
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.camera.rotation.order = "YXZ";

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    const geometry = new THREE.BufferGeometry();
    const count = 320;
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seeds[i] = hash(i);
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    this.particles = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({ uniforms: this.particleUniforms, vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.applyAtmosphere();
    this.applyProfileToRenderer();
    this.bindInput();
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.cleanup.push(() => ro.disconnect());
    const canvas = this.renderer.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      this.error = "Utracono kontekst WebGL (karta graficzna przerwała renderowanie). Odśwież stronę.";
    };
    canvas.addEventListener("webglcontextlost", lost);
    this.cleanup.push(() => canvas.removeEventListener("webglcontextlost", lost));
    this.raf = requestAnimationFrame(this.frame);
    if (this.streamOptions) void this.startStream();
    else void this.rebuildWorld();
  }

  // ---- publiczne API ----

  setQuality(id: QualityId): void {
    if (id === this.quality) return;
    this.quality = id;
    this.profile = VIEW_PROFILES[id];
    this.applyProfileToRenderer();
    void this.rebuildView();
  }

  setHour(hour: number): void {
    this.hour = hour;
    this.atmosphere = atmosphereAt(hour, this.visual.look.dayModel);
    this.applyAtmosphere();
  }

  getHour(): number {
    return this.hour;
  }

  /** Pozycja gracza (tryb gry): do zapisu w stanie gry; przed końcem ładowania zwraca pozycję startową. */
  getPose(): { x: number; z: number; yaw: number } | null {
    const s = this.controller?.state;
    if (s) return { x: s.x, z: s.z, yaw: s.yaw };
    return this.streamOptions ? { ...this.streamOptions.pose } : null;
  }

  /** Flaga świata `bridge.built`: otwiera lub zamyka przejście przez rzekę (kolizje, nie wygląd). */
  setBridgeBuilt(built: boolean): void {
    if (built) this.worldFlags.add(BRIDGE_FLAG);
    else this.worldFlags.delete(BRIDGE_FLAG);
  }

  /**
   * Stan otwarcia skrzyń wg gry (źródło prawdy to stan gry, renderer tylko go pokazuje). Skrzynia, która właśnie się
   * otworzyła, animuje pokrywę i sypie iskry; przy `animate = false` (wczytanie zapisu) pokrywa jest od razu otwarta.
   */
  setChestStates(opened: Iterable<string>, animate = true): void {
    this.openedChests = new Set(opened);
    const layer = this.chestLayer;
    const seed = this.streamOptions?.seed;
    if (!layer || seed === undefined) return;
    const started = layer.setOpened((id) => this.openedChests.has(id), animate);
    for (const id of started) {
      const c = forestChestsOf(seed).find((p) => p.id === id);
      if (c) this.fx?.spawn("sparkle", c.x, c.y + 0.7, c.z);
    }
  }

  /** Zebrane drzewa i skały: znikają z instancji i z kolizji (świat chodzenia jest wspólny dla całego lasu). */
  setHarvested(ids: Iterable<string>): void {
    this.harvestedIds = new Set(ids);
    const seed = this.streamOptions?.seed;
    if (seed === undefined) return;
    syncHarvestedColliders(seed, [...this.harvestedIds]);
    this.stream?.setRemoved(this.harvestedIds);
  }

  /** Reakcja NPC z gry (np. gniew trolla po nieudanej próbie); false, gdy nic się nie wydarzyło (brak animacji, trwa inna reakcja, NPC daleko). */
  reactNpc(npc: "troll", kind: "angry"): boolean {
    return this.npcLayer?.react(npc, kind) ?? false;
  }

  /** Krótki efekt cząstek (drzazgi, odłamki) w danym punkcie świata. */
  burst(kind: BurstKind, x: number, y: number, z: number): void {
    this.fx?.spawn(kind, x, y, z);
  }

  /** Zawieszenie sterowania (np. otwarty dziennik): zeruje klawisze i zatrzymuje ruch gracza. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.keys.clear();
  }

  get isStreaming(): boolean {
    return this.streamOptions !== null;
  }

  getVisual(): VisualConfig {
    return this.visual;
  }

  /** Szybka zmiana presetu: tylko uniformy, światła i (jeśli trzeba) tekstura gruntu; modele i świat zostają. */
  setPreset(id: PresetId): void {
    this.setVisual(presetConfig(id));
  }

  setVisual(config: VisualConfig): void {
    this.visual = structuredClone(config);
    this.visual.tuning = sanitizeTuning(this.visual.tuning);
    this.atmosphere = atmosphereAt(this.hour, this.visual.look.dayModel);
    this.palette.setPalette(this.visual.look.palette, this.visual.tuning.greenSaturation, this.visual.look.groundDetail);
    this.applyAtmosphere();
    this.applyProfileToRenderer();
    void this.ensureGroundStyle();
  }

  /** Zmiana suwaków VISUAL TUNING bez zmiany presetu bazowego. */
  setTuning(partial: Partial<VisualTuning>): void {
    this.visual = { ...this.visual, tuning: sanitizeTuning({ ...this.visual.tuning, ...partial }) };
    this.palette.setPalette(this.visual.look.palette, this.visual.tuning.greenSaturation, this.visual.look.groundDetail);
    this.applyAtmosphere();
    this.applyProfileToRenderer();
  }

  setOverrides(partial: Partial<ViewOverrides>): void {
    this.overrides = { ...this.overrides, ...partial };
    this.applyAtmosphere();
    this.applyProfileToRenderer();
    this.instancer?.setOverrides(this.overrides);
    if (this.lab) this.lab.setOptions(this.lab.current, this.shadowsOn());
    this.dirtyInstances = true;
  }

  /** Włącza (opcje) albo wyłącza (`null`) tymczasowy tryb diagnostyczny trawy: kępa z bliska, kamera orbitalna, przełączniki. */
  setGrassLab(options: LabOptions | null): void {
    if (!options) {
      this.labOptions = null;
      this.unmountLab();
      return;
    }
    this.labOptions = sanitizeLab(options);
    if (this.lab) this.lab.setOptions(this.labOptions, this.shadowsOn());
    else void this.mountLab();
  }

  getGrassLab(): LabOptions | null {
    return this.labOptions;
  }

  getOverrides(): ViewOverrides {
    return this.overrides;
  }

  /** Nowy seed i/lub sektor: przebudowuje okno lasu z generatora. Gracz wraca na start wybranego sektora. */
  setWindow(options: WindowOptions): void {
    this.windowOptions = { ...this.windowOptions, ...options };
    void this.rebuildWorld();
  }

  get currentWindow(): ForestWindow | null {
    return this.built?.window ?? null;
  }

  lockPointer(): void {
    this.renderer.domElement.requestPointerLock?.();
  }

  runBenchmark(): Promise<BenchmarkReport> {
    return new Promise((resolve, reject) => {
      if (!this.built || this.bench) return reject(new Error("Test FPS niedostępny"));
      document.exitPointerLock?.();
      this.bench = { stats: new FrameStats(0.5, true), route: buildBenchmarkRoute(this.built.window), t: 0, calls: 0, tris: 0, n: 0, resolve };
    });
  }

  cancelBenchmark(): void {
    this.bench = null;
  }

  dispose(): void {
    this.disposed = true;
    this.unmountLab();
    cancelAnimationFrame(this.raf);
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.disposeStream();
    this.disposeView();
    this.disposeBuilt();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.particles.geometry.dispose();
    (this.particles.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // ---- budowanie ----

  private async rebuildWorld(): Promise<void> {
    const gen = ++this.generation;
    this.loading = "Generowanie lasu z seeda";
    this.error = null;
    await tick();
    if (gen !== this.generation || this.disposed) return;
    try {
      const radius = this.windowOptions.radius ?? 1;
      const win = buildForestWindow({ ...this.windowOptions, radius });
      this.loading = "Budowanie terenu";
      await tick();
      if (gen !== this.generation || this.disposed) return;
      const built = await this.buildGround(win, gen);
      if (!built || gen !== this.generation || this.disposed) {
        if (built) disposeBuilt(built);
        return;
      }
      this.disposeBuilt();
      this.built = built;
      this.scene.add(built.ground);
      if (built.water) this.scene.add(built.water);
      this.controller = new FirstPersonController(win.walk, win.forest.terrain, win.start);
      this.lastCamPos.set(1e9, 0, 0);
      await this.buildInstances(gen);
    } catch (e) {
      if (gen === this.generation) this.fail(e);
    }
  }

  private async rebuildView(): Promise<void> {
    if (this.streamOptions) return void this.restartStream();
    const gen = ++this.generation;
    if (!this.built) return void this.rebuildWorld();
    this.loading = `Ładowanie modeli (${this.quality})`;
    this.error = null;
    try {
      const win = this.built.window;
      if (this.built.groundTextureSize !== this.profile.groundTexture) {
        this.loading = "Budowanie tekstury gruntu";
        const old = this.built;
        const fresh = await this.buildGround(win, gen);
        if (!fresh || gen !== this.generation || this.disposed) {
          if (fresh) disposeBuilt(fresh);
          return;
        }
        this.scene.remove(old.ground);
        if (old.water) this.scene.remove(old.water);
        disposeMesh(old.ground);
        if (old.water) disposeMesh(old.water);
        this.built = fresh;
        this.scene.add(fresh.ground);
        if (fresh.water) this.scene.add(fresh.water);
      }
      await this.buildInstances(gen);
    } catch (e) {
      if (gen === this.generation) this.fail(e);
    }
  }

  private async restartStream(): Promise<void> {
    const pose = this.getPose();
    if (!this.streamOptions || !pose) return;
    this.streamOptions = { ...this.streamOptions, pose };
    await this.startStream();
  }

  private disposeStream(): void {
    if (this.chestLayer) {
      this.scene.remove(this.chestLayer.group);
      this.chestLayer.dispose();
      this.chestLayer = null;
    }
    if (this.npcLayer) {
      this.scene.remove(this.npcLayer.group);
      this.npcLayer.dispose();
      this.npcLayer = null;
    }
    if (this.fx) {
      this.fx.dispose();
      this.fx = null;
    }
    if (this.stream) {
      this.scene.remove(this.stream.group);
      this.stream.dispose();
      this.stream = null;
    }
    this.disposeView();
    this.controller = null;
  }

  /** Buduje las gry: świat chodzenia całego lasu, modele i streamowane sektory wokół pozycji startowej. */
  private async startStream(): Promise<void> {
    const opts = this.streamOptions;
    if (!opts) return;
    const gen = ++this.generation;
    this.loading = "Generowanie lasu";
    this.error = null;
    this.loadProgress = 0;
    this.disposeStream();
    await tick();
    if (gen !== this.generation || this.disposed) return;
    try {
      const forest = forestOf(opts.seed);
      const walk = forestWalkOf(opts.seed);
      await tick();
      if (gen !== this.generation || this.disposed) return;
      const library = new AssetLibrary({
        profile: this.profile.assets,
        onError: (e) => {
          this.error = e.message;
        },
      });
      const instancer = new ForestInstancer(library, { batches: [] }, this.profile, this.overrides, this.palette);
      this.loading = `Ładowanie modeli (${this.quality})`;
      await instancer.preload(forestModelIds(forest));
      if (gen !== this.generation || this.disposed) {
        instancer.dispose();
        await library.dispose();
        return;
      }
      let chestAsset: Awaited<ReturnType<typeof loadChestAsset>> | null = null;
      try {
        chestAsset = await loadChestAsset();
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        console.error(e);
      }
      let trollAsset: TrollAsset | null = null;
      this.npcError = null;
      try {
        trollAsset = await loadTrollAsset();
      } catch (e) {
        this.npcError = e instanceof Error ? e.message : String(e);
        console.error(e);
      }
      if (gen !== this.generation || this.disposed) {
        chestAsset?.dispose();
        trollAsset?.dispose();
        instancer.dispose();
        await library.dispose();
        return;
      }
      const stream = new StreamedForest({
        forest,
        profile: this.profile,
        quality: this.quality,
        radius: STREAM_RADIUS[this.quality],
        groundStyle: this.visual.look.groundStyle,
        palette: this.palette,
        instancer,
        anisotropy: Math.min(this.profile.assets.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
        receiveShadow: this.shadowsOn(),
        tuneGround: (material) => tuneGroundMaterial(material, this.palette),
      });
      stream.prepareInitial(opts.pose.x, opts.pose.z);
      stream.setRemoved(this.harvestedIds);
      syncHarvestedColliders(opts.seed, [...this.harvestedIds]);
      if (chestAsset) {
        const shadows = this.shadowsOn();
        const layer = new ChestLayer(chestAsset, forestChestsOf(opts.seed), { castShadow: shadows, receiveShadow: shadows });
        layer.setOpened((id) => this.openedChests.has(id), false);
        this.chestLayer = layer;
        this.scene.add(layer.group);
      }
      if (trollAsset) {
        const shadows = this.shadowsOn();
        try {
          const npc = new NpcLayer(trollAsset, { forest, walk, seed: opts.seed, castShadow: shadows, receiveShadow: shadows });
          this.npcLayer = npc;
          this.scene.add(npc.group);
        } catch (e) {
          this.npcError = e instanceof Error ? e.message : String(e);
          console.error(e);
          trollAsset.dispose();
        }
      }
      const fx = new FxBurst();
      this.fx = fx;
      this.scene.add(fx.points);
      this.library = library;
      this.instancer = instancer;
      this.stream = stream;
      this.scene.add(stream.group, instancer.group);
      instancer.setOverrides(this.overrides);
      const controller = new FirstPersonController(walk, forest.terrain, opts.pose);
      controller.flags = this.worldFlags;
      this.controller = controller;
      this.lastCamPos.set(1e9, 0, 0);
      this.dirtyInstances = true;
      this.applyProfileToRenderer();
      this.loading = "Wczytywanie lasu";
    } catch (e) {
      if (gen === this.generation) this.fail(e);
    }
  }

  private groundSize(): number {
    const stress = (this.windowOptions.radius ?? 1) > 1;
    return stress ? Math.max(this.profile.groundTexture, 2048) : this.profile.groundTexture;
  }

  /** Tekstura gruntu w danym stylu; `gen` przerywa pracę po zmianie świata, `report` pokazuje postęp na ekranie ładowania. */
  private async buildGroundTexture(win: ForestWindow, size: number, style: GroundStyle, accept: () => boolean, report: boolean): Promise<THREE.DataTexture | null> {
    const builder = createGroundBuilder({ forest: win.forest, bounds: win.windowBounds, objects: win.objects, size, style });
    const rows = report ? 64 : 24;
    while (!builder.step(rows)) {
      if (report) this.loading = `Tekstura gruntu ${Math.round(builder.progress() * 100)}%`;
      await tick();
      if (!accept() || this.disposed) return null;
    }
    const texture = new THREE.DataTexture(builder.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(this.profile.assets.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
  }

  private async buildGround(win: ForestWindow, gen: number): Promise<Built | null> {
    const profile = this.profile;
    const stress = (this.windowOptions.radius ?? 1) > 1;
    const size = this.groundSize();
    const style = this.visual.look.groundStyle;
    const texture = await this.buildGroundTexture(win, size, style, () => gen === this.generation, true);
    if (!texture) return null;
    const textures = new Map<GroundStyle, THREE.DataTexture>([[style, texture]]);

    const cell = stress ? Math.max(profile.groundCell, 1.4) : profile.groundCell;
    const mesh = buildGroundMesh(win.forest.terrain, win.windowBounds, cell);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
    tuneGroundMaterial(material, this.palette);
    const ground = new THREE.Mesh(toGeometry(mesh), material);
    ground.name = "ground";
    ground.receiveShadow = true;
    ground.userData.textures = textures;

    const waterData = buildWaterMesh(win.forest, win.windowBounds);
    const water = waterData
      ? new THREE.Mesh(
          toGeometry(waterData),
          new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.18, 0.4, 0.38, THREE.SRGBColorSpace), roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.78 }),
        )
      : null;
    if (water) water.name = "water";
    return { window: win, ground, water, groundTriangles: mesh.triangleCount + (waterData?.triangleCount ?? 0), groundTextureSize: size, textures };
  }

  /**
   * Dopasowuje teksturę gruntu do stylu aktualnego presetu. Tekstury obu stylów są trzymane w pamięci, więc powrót do
   * już zbudowanego stylu jest natychmiastowy; pierwsza zmiana buduje drugi styl w tle (porcjami, bez blokowania klatek).
   */
  private async ensureGroundStyle(): Promise<void> {
    const built = this.built;
    if (!built) return;
    const style = this.visual.look.groundStyle;
    const material = built.ground.material as THREE.MeshStandardMaterial;
    const have = built.textures.get(style);
    const job = ++this.groundJob;
    if (have) {
      if (material.map !== have) material.map = have;
      return;
    }
    const texture = await this.buildGroundTexture(built.window, built.groundTextureSize, style, () => job === this.groundJob && this.built === built, false);
    if (!texture) return;
    built.textures.set(style, texture);
    if (this.visual.look.groundStyle === style && this.built === built) material.map = texture;
  }

  private async buildInstances(gen: number): Promise<void> {
    if (!this.built) return;
    const library = new AssetLibrary({
      profile: this.profile.assets,
      onError: (e) => {
        this.error = e.message;
      },
    });
    const instancer = new ForestInstancer(library, this.built.window, this.profile, this.overrides, this.palette);
    this.loading = `Ładowanie modeli (${this.quality})`;
    await instancer.init();
    if (gen !== this.generation || this.disposed) {
      instancer.dispose();
      await library.dispose();
      return;
    }
    const oldInstancer = this.instancer;
    const oldLibrary = this.library;
    if (oldInstancer) this.scene.remove(oldInstancer.group);
    this.instancer = instancer;
    this.library = library;
    this.unmountLab();
    this.scene.add(instancer.group);
    instancer.setOverrides(this.overrides);
    this.dirtyInstances = true;
    this.applyProfileToRenderer();
    this.loading = null;
    oldInstancer?.dispose();
    void oldLibrary?.dispose();
    if (this.labOptions) void this.mountLab();
  }

  private shadowsOn(): boolean {
    return this.profile.shadows.enabled && this.overrides.shadows;
  }

  private async mountLab(): Promise<void> {
    const built = this.built;
    const instancer = this.instancer;
    const library = this.library;
    if (!this.labOptions || !built || !instancer || !library || this.lab) return;
    const gen = ++this.labGen;
    const start = built.window.start;
    const center = new THREE.Vector3(start.x, built.window.forest.terrain.height(start.x, start.z), start.z);
    const lab = new GrassLab(library, this.profile, instancer.uniforms, this.palette, center);
    try {
      await lab.init();
    } catch (e) {
      lab.dispose();
      if (gen === this.labGen) this.fail(e);
      return;
    }
    if (gen !== this.labGen || this.disposed || !this.labOptions || this.instancer !== instancer) {
      lab.dispose();
      return;
    }
    this.lab = lab;
    this.scene.add(lab.group);
    instancer.group.visible = false;
    built.ground.visible = false;
    if (built.water) built.water.visible = false;
    lab.setOptions(this.labOptions, this.shadowsOn());
    document.exitPointerLock?.();
  }

  private unmountLab(): void {
    this.labGen++;
    const lab = this.lab;
    this.lab = null;
    if (lab) {
      this.scene.remove(lab.group);
      lab.dispose();
    }
    if (this.instancer) this.instancer.group.visible = true;
    if (this.built) {
      this.built.ground.visible = true;
      if (this.built.water) this.built.water.visible = true;
    }
    this.dirtyInstances = true;
  }

  private patchLab(patch: Partial<LabOptions>): void {
    if (!this.lab || !this.labOptions) return;
    this.labOptions = sanitizeLab({ ...this.lab.current, ...patch });
    this.lab.setOptions(this.labOptions, this.shadowsOn());
    this.onLab?.(this.labOptions);
  }

  private disposeView(): void {
    if (this.instancer) {
      this.scene.remove(this.instancer.group);
      this.instancer.dispose();
      this.instancer = null;
    }
    void this.library?.dispose();
    this.library = null;
  }

  private disposeBuilt(): void {
    if (!this.built) return;
    this.scene.remove(this.built.ground);
    disposeMesh(this.built.ground);
    if (this.built.water) {
      this.scene.remove(this.built.water);
      disposeMesh(this.built.water);
    }
    this.built = null;
  }

  private fail(e: unknown): void {
    this.loading = null;
    this.error = e instanceof Error ? e.message : String(e);
    console.error(e);
  }

  // ---- stan renderera ----

  private applyProfileToRenderer(): void {
    const p = this.profile;
    const shadows = p.shadows.enabled && this.overrides.shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.chestLayer?.setShadows(shadows, shadows);
    this.npcLayer?.setShadows(shadows, shadows);
    const sc = this.sun.shadow.camera;
    const d = p.shadows.distance;
    sc.left = -d;
    sc.right = d;
    sc.top = d;
    sc.bottom = -d;
    sc.near = 1;
    sc.far = 260;
    sc.updateProjectionMatrix();
    const look = this.visual.look;
    this.sun.shadow.bias = look.shadowBias;
    this.sun.shadow.normalBias = look.shadowNormalBias;
    this.sun.shadow.radius = look.shadowRadius;
    this.sun.shadow.intensity = this.visual.tuning.shadow;
    if (this.sun.shadow.mapSize.x !== p.shadows.mapSize) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(p.shadows.mapSize, p.shadows.mapSize);
    }
    if (this.built) this.built.ground.receiveShadow = shadows;
    this.particles.visible = p.atmosphere.particles > 0;
    (this.particles.geometry as THREE.BufferGeometry).setDrawRange(0, p.atmosphere.particles);
    this.resize();
  }

  private applyAtmosphere(): void {
    const a = this.atmosphere;
    const t = this.visual.tuning;
    const look = this.visual.look;
    this.sun.color.copy(toLinear(a.sunColor));
    this.sun.intensity = a.sunIntensity * t.sun;
    this.hemi.color.copy(toLinear(a.hemiSky));
    this.hemi.groundColor.copy(toLinear([a.hemiGround[0] * look.groundBounce, a.hemiGround[1] * look.groundBounce, a.hemiGround[2] * look.groundBounce]));
    this.hemi.intensity = a.hemiIntensity * t.ambient;
    this.renderer.toneMappingExposure = a.exposure * t.exposure;
    const fogColor = toLinear(tintedFog(a.fogColor, t));
    if (this.overrides.fog && t.fogDensity > 0) {
      const vis = this.profile.fogVisibility;
      const density = (1.8 / vis) * a.fogDensity * t.fogDensity;
      this.scene.fog = new THREE.FogExp2(fogColor, density);
    } else {
      this.scene.fog = null;
    }
    this.skyUniforms.uZenith.value.copy(toLinear(a.skyZenith));
    this.skyUniforms.uHorizon.value.copy(this.overrides.fog ? fogColor : toLinear(a.skyHorizon));
    this.skyUniforms.uSunDir.value.set(...a.sunDir);
    this.skyUniforms.uSunColor.value.copy(toLinear(a.sunColor));
    this.skyUniforms.uGlow.value = a.daylight;
    this.particleUniforms.uOpacity.value = 0.55 * a.daylight * look.particleBoost;
    this.particleUniforms.uColor.value.copy(toLinear(a.sunColor)).lerp(new THREE.Color(1, 1, 1), 0.4);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.profile.pixelRatioCap) * this.profile.renderScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirtyInstances = true;
  }

  // ---- wejście ----

  private bindInput(): void {
    const canvas = this.renderer.domElement;
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        if (down) this.keys.add(e.code);
        else this.keys.delete(e.code);
        e.preventDefault();
      }
    };
    const down = onKey(true);
    const up = onKey(false);
    const blur = () => this.keys.clear();
    const click = () => {
      if (!this.locked && !this.lab) canvas.requestPointerLock?.();
    };
    const labDown = (e: PointerEvent) => {
      if (!this.lab) return;
      this.labDrag = true;
      canvas.setPointerCapture?.(e.pointerId);
    };
    const labMove = (e: PointerEvent) => {
      if (!this.lab || !this.labDrag) return;
      const o = this.lab.current;
      this.patchLab({ azimuth: o.azimuth - e.movementX * 0.35, elevation: o.elevation + e.movementY * 0.35 });
    };
    const labUp = () => {
      this.labDrag = false;
    };
    const labWheel = (e: WheelEvent) => {
      if (!this.lab) return;
      e.preventDefault();
      this.patchLab({ distance: this.lab.current.distance * Math.exp(e.deltaY * 0.0012) });
    };
    const lockChange = () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.keys.clear();
    };
    const move = (e: MouseEvent) => {
      if (this.locked && !this.bench) this.controller?.look(e.movementX, e.movementY);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    canvas.addEventListener("click", click);
    canvas.addEventListener("pointerdown", labDown);
    canvas.addEventListener("pointermove", labMove);
    canvas.addEventListener("pointerup", labUp);
    canvas.addEventListener("pointercancel", labUp);
    canvas.addEventListener("wheel", labWheel, { passive: false });
    document.addEventListener("pointerlockchange", lockChange);
    document.addEventListener("mousemove", move);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("pointerdown", labDown);
      canvas.removeEventListener("pointermove", labMove);
      canvas.removeEventListener("pointerup", labUp);
      canvas.removeEventListener("pointercancel", labUp);
      canvas.removeEventListener("wheel", labWheel);
      document.removeEventListener("pointerlockchange", lockChange);
      document.removeEventListener("mousemove", move);
    });
  }

  private moveInput(): MoveInput {
    if (this.suspended) return { forward: 0, right: 0, sprint: false };
    const k = this.keys;
    const forward = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const right = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    return { forward, right, sprint: k.has("ShiftLeft") || k.has("ShiftRight") };
  }

  // ---- pętla ----

  private frame = (time: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtMs = this.lastTime ? time - this.lastTime : 16.7;
    this.lastTime = time;
    const dt = Math.min(dtMs / 1000, 0.25);
    this.elapsed += dt;
    this.frameStats.push(dtMs);

    const ctl = this.controller;
    const lab = this.lab;
    if (lab && this.built) {
      this.labOptions = lab.advance(dt);
      const pose = lab.pose();
      this.camera.position.copy(pose.position);
      this.camera.lookAt(pose.target);
      if (lab.current.occluder) lab.placeOccluder(new THREE.Vector3(...this.atmosphere.sunDir).normalize());
      this.updateSun();
    } else if (ctl && (this.built || this.stream)) {
      if (this.stream) this.advanceStream(ctl.state, time);
      if (this.bench) {
        const b = this.bench;
        b.t += dt;
        b.stats.push(dtMs);
        const pose = benchmarkPose(b.route, b.t);
        ctl.teleport(pose.x, pose.z, pose.yaw);
        ctl.state.pitch = pose.pitch;
      } else if (!this.loading && !this.suspended) {
        ctl.blockers = this.npcLayer?.blockers() ?? [];
        ctl.update(dt, this.moveInput());
      }
      const s = ctl.state;
      this.camera.position.set(s.x, s.eyeY, s.z);
      this.camera.rotation.set(s.pitch, s.yaw, 0);
      this.updateInstances(time);
      this.updateSun();
      this.chestLayer?.update(dt, s);
      if (!this.suspended) this.npcLayer?.update(dt, s);
      this.fx?.update(dt);
    }
    this.skyUniforms.uSunDir.value.set(...this.atmosphere.sunDir);
    this.sky.position.copy(this.camera.position);
    if (this.instancer) this.instancer.uniforms.uTime.value = this.elapsed;
    this.particleUniforms.uTime.value = this.elapsed;
    this.particleUniforms.uCenter.value.copy(this.camera.position);
    this.particleUniforms.uSize.value = 0.05;

    this.renderer.render(this.scene, this.camera);

    const info = this.renderer.info;
    if (this.bench) {
      const b = this.bench;
      b.calls += info.render.calls;
      b.tris += info.render.triangles;
      b.n++;
      if (b.t >= BENCHMARK_SECONDS) {
        this.bench = null;
        b.resolve(this.makeReport(b.stats, b.calls / b.n, b.tris / b.n));
      }
    }
    if (time - this.lastEmit > 250) {
      this.lastEmit = time;
      if (lab && lab.current.motion === "orbit") this.onLab?.(lab.current);
      this.emit();
    }
  };

  private advanceStream(pos: { x: number; z: number }, time: number): void {
    const stream = this.stream;
    if (!stream) return;
    const loading = this.loading !== null;
    if (stream.update(pos.x, pos.z, loading ? LOADING_BUDGET_MS : STREAM_BUDGET_MS, time)) this.dirtyInstances = true;
    if (!loading) return;
    this.loadProgress = stream.initialProgress();
    if (stream.initialReady()) {
      this.loading = null;
      this.loadProgress = 1;
      this.dirtyInstances = true;
    } else {
      this.loading = `Wczytywanie lasu ${Math.round(this.loadProgress * 100)}%`;
    }
  }

  private updateInstances(time: number): void {
    if (!this.instancer) return;
    const pos = this.camera.position;
    const dir = this.camera.getWorldDirection(this.tmpDir);
    const moved = pos.distanceToSquared(this.lastCamPos) > 0.6;
    const turned = dir.dot(this.lastCamDir) < 0.9985;
    if (!(this.dirtyInstances || moved || turned)) return;
    const minInterval = (this.windowOptions.radius ?? 1) > 1 ? 90 : 33;
    if (!this.dirtyInstances && time - this.lastInstanceUpdate < minInterval) return;
    this.instancerStats = this.instancer.update(this.camera);
    this.lastCamPos.copy(pos);
    this.lastCamDir.copy(dir);
    this.lastInstanceUpdate = time;
    this.dirtyInstances = false;
  }
  private tmpDir = new THREE.Vector3();

  private updateSun(): void {
    const p = this.camera.position;
    const dir = new THREE.Vector3(...this.atmosphere.sunDir).normalize();
    const shadows = this.profile.shadows.enabled && this.overrides.shadows;
    let cx = p.x;
    let cy = p.y;
    let cz = p.z;
    if (shadows) {
      // Przyciągnięcie środka mapy cieni do siatki tekseli, żeby cienie nie migotały przy ruchu.
      const texel = (2 * this.profile.shadows.distance) / this.profile.shadows.mapSize;
      const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, dir).normalize();
      const realUp = new THREE.Vector3().crossVectors(dir, right).normalize();
      const center = new THREE.Vector3(cx, cy, cz);
      const a = center.dot(right);
      const b = center.dot(realUp);
      center.addScaledVector(right, Math.round(a / texel) * texel - a).addScaledVector(realUp, Math.round(b / texel) * texel - b);
      cx = center.x;
      cy = center.y;
      cz = center.z;
    }
    this.sun.target.position.set(cx, cy, cz);
    this.sun.position.set(cx + dir.x * 130, cy + dir.y * 130, cz + dir.z * 130);
    this.sun.target.updateMatrixWorld();
  }

  // ---- raporty ----

  private gpuName(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "nieznana";
  }

  private makeReport(stats: FrameStats, calls: number, tris: number): BenchmarkReport {
    const s = stats.summary();
    const size = this.renderer.getSize(new THREE.Vector2());
    return {
      quality: this.quality,
      seed: this.built?.window.seed ?? 0,
      sector: this.built?.window.sector.id ?? "",
      windowSectors: this.built?.window.sectors.length ?? 0,
      seconds: s.seconds,
      frames: s.frames,
      averageFps: s.averageFps,
      onePercentLowFps: s.onePercentLowFps,
      medianMs: s.medianMs,
      p95Ms: s.p95Ms,
      p99Ms: s.p99Ms,
      maxMs: s.maxMs,
      avgDrawCalls: calls,
      avgTriangles: tris,
      canvas: `${size.x}x${size.y}`,
      pixelRatio: this.renderer.getPixelRatio(),
      gpu: this.gpuName(),
      userAgent: navigator.userAgent,
      overrides: this.overrides,
      visual: this.visual,
      note: "FPS jest ograniczany przez odświeżanie monitora (vsync). Wartości zależą od GPU i przeglądarki.",
    };
  }

  private emit(): void {
    if (!this.onStats) return;
    const info = this.renderer.info;
    const s = this.controller?.state;
    const st = this.instancerStats;
    this.onStats({
      fps: this.frameStats.currentFps,
      avgFps: this.frameStats.averageFps,
      frameMs: this.frameStats.frameMs,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      visibleInstances: st.visible,
      totalInstances: st.total,
      activeModels: st.activeModels,
      lod0Instances: st.perLevel[0],
      lod1Instances: st.perLevel[1],
      estimatedModelTriangles: st.triangles,
      fallbackModels: st.fallbackModels,
      quality: this.quality,
      seed: this.built?.window.seed ?? this.windowOptions.seed ?? 0,
      sectorId: this.built?.window.sector.id ?? "-",
      windowSectors: this.built?.window.sectors.length ?? 0,
      position: { x: s?.x ?? 0, y: s ? s.eyeY : 0, z: s?.z ?? 0 },
      groundTriangles: this.built?.groundTriangles ?? 0,
      locked: this.locked,
      loading: this.loading,
      error: this.error,
      benchmark: { running: this.bench !== null, progress: this.bench ? Math.min(1, this.bench.t / BENCHMARK_SECONDS) : 0 },
      showcase: (this.built?.window.showcase ?? []).map((q) => ({ id: q.id, ix: q.ix, iz: q.iz, qualifies: q.qualifies })),
      stress: (this.windowOptions.radius ?? 1) > 1,
      preset: this.visual.preset,
      presetModified: isModified(this.visual),
      lab: this.lab !== null,
      stream: this.stream?.stats() ?? null,
      loadProgress: this.loadProgress,
      npc: this.npcLayer?.stats() ?? null,
      npcError: this.npcError,
    });
  }
}

function hash(i: number): number {
  let h = Math.imul(i + 1, 2654435761) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function toGeometry(m: GroundMeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(m.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function disposeBuilt(b: Built): void {
  disposeMesh(b.ground);
  if (b.water) disposeMesh(b.water);
}

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const textures = mesh.userData.textures as Map<unknown, THREE.Texture> | undefined;
  textures?.forEach((t) => t.dispose());
  (mesh.material as THREE.Material).dispose();
}


function tuneGroundMaterial(material: THREE.MeshStandardMaterial, palette: PaletteStore): void {
  const grade = palette.get("ground");
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGreenSat = palette.greenSat;
    shader.uniforms.uDetail = palette.groundDetail;
    Object.assign(shader.uniforms, grade);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGroundXZ;\nvarying float vGrPhase;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroundXZ = position.xz;\nvGrPhase = 0.5;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRADE_UNIFORM_DECL}\nuniform float uDetail;\nvarying vec2 vGroundXZ;\n${NOISE_GLSL}`)
      .replace("#include <map_fragment>", `#include <map_fragment>${gradeFragment({ swap: false, foliage: false })}\n${GROUND_DETAIL_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => "forest2:ground";
}
