import { NET } from "../multiplayer/protocol";
import * as THREE from "three";
import { RemotePlayers, createRemoteTemplate } from "./remotePlayers";
import type { MultiplayerClient } from "../multiplayer/client";
import { getForestAudio } from "../audio/controller";
import { AssetLibrary, DEFAULT_QUALITY, type QualityId } from "@/lib/assets";
import { loadDeerAsset, loadPlayerAsset, loadTrollAsset, type DeerAsset, type PlayerAsset, type TrollAsset } from "@/lib/assets/characters";
import { loadBridgeAsset } from "@/lib/assets/bridge";
import { loadChestAsset } from "@/lib/assets/props";
import type { WorldRef } from "@/lib/game/world/types";
import type { WalkWorld } from "@/lib/game/world/walk";
import { authoritativeForestOf, forestBridgeOf, forestChestsOf, forestOf, forestWalkOf, syncBridgeColliders, syncHarvestedColliders } from "@/lib/game/world/lookup";
import { BRIDGE_FLAG, PRO_GROUND } from "@/lib/game/world/generators/v2";
import { isReachClear } from "@/lib/game/systems/reach";
import { BENCHMARK_SECONDS, benchmarkPose, buildBenchmarkRoute, type BenchmarkRoute } from "./benchmark";
import { TOUR_WARMUP_SECONDS, TourLegRecorder, buildTourLegs, tourDuration, tourLegAt, tourPose, type TourLeg, type TourLegReport } from "./proTour";
import { atmosphereAt, DEFAULT_HOUR, type AtmosphereState, type Rgb } from "./atmosphere";
import { FirstPersonController, type MoveInput } from "./controller";
import { ThirdPersonRig, type TppSnapshot } from "@/lib/tpp/thirdPersonRig";
import type { TppConfig } from "@/lib/tpp/config";
import { PlayerModel } from "./playerModel";
import { PlayerAnimator, type PlayerAnimStats } from "./playerAnimator";
import { AppearanceRig, type AppearanceStats } from "./appearance/appearanceRig";
import { DEFAULT_APPEARANCE, devFitOverrides, normalizeAppearance, type CharacterAppearanceV1 } from "@/lib/character";
import { mergeMove } from "@/lib/input/analog";
import { TPP_BUTTONS } from "@/lib/input/gamepadConfig";
import type { InputHub } from "@/lib/input/inputHub";
import { applyTouchToTpp, externalMove, type ExternalMove } from "@/lib/input/touchAdapter";
import type { TouchInput } from "@/lib/input/touchInput";
import { FrameStats } from "./frameStats";
import { buildGroundMesh, buildWaterMesh, createGroundBuilder, desertWeightFn, type GroundMeshData, type GroundStyle } from "./ground";
import { GRADE_UNIFORM_DECL, GROUND_DETAIL_FRAGMENT, NOISE_GLSL, PRO_GROUND_ALBEDO, PRO_GROUND_DECL, PRO_GROUND_NORMAL, PaletteStore, gradeFragment } from "./grading";
import { GrassLab, sanitizeLab, type LabOptions } from "./grassLab";
import { ForestInstancer, PATH_SINK_DEFAULT, PRO_KIND_SCALE_DEFAULTS, type InstancerStats, type PathSink } from "./instancer";
import { DEFAULT_OVERRIDES, VIEW_PROFILES, type ForestViewProfile, type ViewKind, type ViewOverrides } from "./profiles";
import type { DialogOutcome } from "@/lib/npc/encounter";
import { DeerLayer, type DeerStats } from "./deer";
import type { StepSink } from "@/lib/audio/controller";
import type { ForestWorld } from "@/lib/game/world/generators/v2/forest";
import { surfaceFromWorld, type SurfaceId } from "@/lib/audio/surfaces";
import { NpcLayer, type NpcStats } from "./npc";
import type { TrollMaterialMode } from "@/lib/npc/trollMaterials";
import { BridgeLayer } from "./bridge";
import { ChestLayer, FxBurst, type BurstKind } from "./props";
import { STREAM_RADIUS } from "./stream";
import { forestModelIds, StreamedForest, type StreamStats } from "./streaming";
import { buildForestWindow, type ForestWindow, type WindowOptions } from "./window";
import { DEFAULT_PRESET, PRO_DEFAULT_CONFIG, isModified, presetConfig, sanitizeTuning, tintedFog, type PresetId, type VisualConfig, type VisualTuning } from "./visual";

export type PanelStats = {
  /** Tylko w trybie trzecioosobowym. */
  tpp?: TppDiagnostics;
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
  /** Prototyp Pro: nazwa odcinka trasy pomiarowej, który trwa; null poza trasą. */
  tourLeg?: string | null;
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
  /** Jeleń (prezentacja): zachowanie, animacja i model; null, gdy model się nie wczytał albo nie jesteśmy w lesie. */
  deer?: DeerStats | null;
  /** Błąd wczytania modelu jelenia (gra działa dalej bez niego). */
  deerError?: string | null;
  /** Wygląd postaci gracza (TPP): elementy, trójkąty, brakujące zasoby. */
  appearance?: AppearanceStats | null;
  /** Most i latarnie (panel dev); null, gdy most nie stoi albo model się nie wczytał. */
  bridge?: { built: boolean; triangles: number; bays: number; length: number; lamps: number; level: number; lights: number; markers: boolean } | null;
  bridgeError?: string | null;
};

/** Raport trasy przez 4 strefy prototypu Pro (plus droga główna): jeden wpis na odcinek, do porównania stref. */
export type ZoneTourReport = {
  kind: "forest-pro-zone-tour";
  quality: QualityId;
  seed: number;
  windowSectors: number;
  totalSeconds: number;
  legs: TourLegReport[];
  canvas: string;
  pixelRatio: number;
  gpu: string;
  userAgent: string;
  overrides: ViewOverrides;
  visual: VisualConfig;
  note: string;
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
  /** Wersja generatora świata z zapisu (od 3: las z paczką Pro). Brak = 2 (zamrożony las v2). */
  genVersion?: number;
  /** Pozycja startowa gracza (już zwalidowana, np. `safeForestPose`). */
  pose: { x: number; z: number; yaw: number };
  /** Czy most jest zbudowany (otwiera przejście przez rzekę). */
  bridgeBuilt?: boolean;
  /** Identyfikatory skrzyń otwartych w zapisie (pokrywa od razu otwarta, bez animacji). */
  opened?: readonly string[];
  /** Identyfikatory zebranych drzew i skał (znikają z lasu i z kolizji). */
  harvested?: readonly string[];
  /**
   * Sterowanie trzecioosobowe (dev, `/dev/third-person`): zamiast kamery z oczu gracza renderer pokazuje postać z GLB
   * i kamerę za nią. Bez tej opcji las działa jak dotąd (pierwsza osoba).
   */
  thirdPerson?: { config?: Partial<TppConfig> };
  /** Wygląd postaci gracza (tryb TPP); domyślny z `DEFAULT_APPEARANCE`. Zmiana w trakcie gry: `setPlayerAppearance`. */
  appearance?: CharacterAppearanceV1;
};

/** Dane panelu deweloperskiego TPP (odświeżane razem z `PanelStats`). */
/** Stan gracza w trzeciej osobie (patrz `getPlayerView`). */
export type PlayerView = {
  x: number;
  y: number;
  z: number;
  speed: number;
  grounded: boolean;
  crouching: boolean;
  bodyYaw: number;
  aimYaw: number;
  /** Wspólny punkt interakcji na wysokości tułowia postaci. */
  torsoY: number;
};

export type TppDiagnostics = TppSnapshot & {
  /** Dominująca animacja ruchu albo `jump`. */
  animation: string;
  jumpWeight: number;
  /** Błąd wczytania modelu (wtedy gracz jest widoczny jako kapsuła zastępcza). */
  modelError: string | null;
  config: TppConfig;
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
/** Klatka dłuższa niż to (zacięcie) nie wnosi drogi do kroków gracza: prędkość z takiej klatki byłaby niewiarygodna. */
const MAX_STEP_FRAME_DT = 0.1;

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
  private tour: { legs: TourLeg[]; recorders: TourLegRecorder[]; t: number; total: number; resolve: (r: ZoneTourReport) => void } | null = null;
  private built: Built | null = null;
  private stream: StreamedForest | null = null;
  private streamOptions: StreamOptions | null = null;
  private chestLayer: ChestLayer | null = null;
  private bridgeLayer: BridgeLayer | null = null;
  private bridgeLoad: Promise<void> | null = null;
  private bridgeAnimate = false;
  private bridgeError: string | null = null;
  private bridgeMarkers = false;
  private npcLayer: NpcLayer | null = null;
  private npcMaterialMode: TrollMaterialMode = "matte";
  private npcError: string | null = null;
  private deerLayer: DeerLayer | null = null;
  private deerError: string | null = null;
  private npcDialogListener: (() => void) | null = null;
  multiplayer: MultiplayerClient | null = null;
  private remotePlayers: RemotePlayers | null = null;
  /** Czysty (bez ubrania lokalnego gracza) wzorzec modelu dla graczy zdalnych; tworzony przed `AppearanceRig` lokalnego. */
  private remoteTemplate: PlayerAsset | null = null;
  private netElapsed = 0;
  private stepSink: StepSink | null = null;
  private stepForest: ForestWorld | null = null;
  private fx: FxBurst | null = null;
  private openedChests = new Set<string>();
  private harvestedIds = new Set<string>();
  private readonly worldFlags = new Set<string>();
  private suspended = false;
  private loadProgress = 0;
  private controller: FirstPersonController | null = null;
  private tpp: { rig: ThirdPersonRig; model: PlayerModel | null; animator: PlayerAnimator | null; appearance: AppearanceRig | null; placeholder: THREE.Group | null; detach: () => void; modelError: string | null } | null = null;
  private playerAppearance: CharacterAppearanceV1 = { ...DEFAULT_APPEARANCE };
  private tppAssetError: string | null = null;
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
  /** Hub wejścia (pad); odczyt w `frame`, bez własnej pętli. */
  private inputHub: InputHub | null = null;
  private detachInputHub: (() => void) | null = null;
  private readonly moveOut: MoveInput = { forward: 0, right: 0, sprint: false };
  private touchInput: TouchInput | null = null;
  private readonly extMove: ExternalMove = { x: 0, y: 0, sprint: false };
  private readonly touchLook = { x: 0, y: 0 };
  private locked = false;
  private loading: string | null = "Przygotowanie sceny";
  private error: string | null = null;
  private lastCamPos = new THREE.Vector3(1e9, 0, 0);
  private lastCamDir = new THREE.Vector3();
  private lastInstanceUpdate = 0;
  private dirtyInstances = true;
  /** Uniformy gruntu Pro (pęknięcia, fale piasku); zmieniane na żywo przez `setProGround`. */
  private readonly proGround = createProGroundUniforms();
  /** Zapamiętane mnożniki skali rodzajów, nakładane też na instancer zbudowany później (np. po zmianie seeda). */
  private readonly kindScales: Partial<Record<ViewKind, number>> = {};
  /** Zagłębienie bruku drogi (tylko tryb Pro); suwaki zmieniają je na żywo. */
  private pathSink: PathSink = { max: 0, random: 0 };
  private lastEmit = 0;
  private cleanup: (() => void)[] = [];
  private readonly onStats?: (stats: PanelStats) => void;
  private readonly onLab?: (options: LabOptions) => void;

  constructor(options: RendererOptions) {
    this.container = options.container;
    this.onStats = options.onStats;
    this.onLab = options.onLab;
    this.windowOptions = options.window ?? {};
    // Las gry od generatora v3 (paczka Pro) dostaje te same domyślne ustawienia widoku co prototyp /dev/forest-pro.
    const proWorld = (options.stream?.genVersion ?? 2) >= 3;
    if (this.windowOptions.pro || proWorld) {
      this.pathSink = { ...PATH_SINK_DEFAULT };
      Object.assign(this.kindScales, PRO_KIND_SCALE_DEFAULTS);
    }
    this.streamOptions = options.stream ?? null;
    if (options.stream?.appearance) this.playerAppearance = normalizeAppearance(options.stream.appearance);
    this.openedChests = new Set(options.stream?.opened ?? []);
    this.harvestedIds = new Set(options.stream?.harvested ?? []);
    if (options.stream?.bridgeBuilt) this.worldFlags.add(BRIDGE_FLAG);
    this.quality = options.quality ?? DEFAULT_QUALITY;
    this.profile = VIEW_PROFILES[this.quality];
    this.overrides = { ...DEFAULT_OVERRIDES, ...options.overrides };
    this.hour = options.hour ?? DEFAULT_HOUR;
    this.visual = options.visual
      ? structuredClone(options.visual)
      : proWorld
        ? { ...presetConfig(PRO_DEFAULT_CONFIG.preset), tuning: { ...PRO_DEFAULT_CONFIG.tuning } }
        : presetConfig(DEFAULT_PRESET);
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
    this.bridgeLayer?.setHour(hour);
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

  /** Czy rozgrywka działa w trzeciej osobie (jedyne autorytatywne źródło stanu gracza to wtedy `ThirdPersonRig`). */
  get isThirdPerson(): boolean {
    return this.tpp !== null;
  }

  /**
   * Autorytatywny stan gracza TPP: pozycja, prędkość, grounded oraz dwa kierunki (ciało i kamera). `aimYaw` to kierunek,
   * który widzi gracz, i właśnie on trafia do `getPose().yaw` (zapis, minimapa, audio, interakcje). Null poza TPP.
   */
  getPlayerView(): PlayerView | null {
    const t = this.tpp;
    if (!t) return null;
    const s = t.rig.controller.state;
    return {
      x: s.x,
      y: s.y,
      z: s.z,
      speed: s.speed,
      grounded: s.grounded,
      crouching: s.crouching,
      bodyYaw: s.bodyYaw,
      aimYaw: t.rig.camera.yaw,
      torsoY: s.y + s.capsuleHeight * 0.6,
    };
  }

  /** Flaga świata `bridge.built`: otwiera lub zamyka przejście przez rzekę (kolizje, nie wygląd). */
  setBridgeBuilt(built: boolean): void {
    const was = this.worldFlags.has(BRIDGE_FLAG);
    if (built) this.worldFlags.add(BRIDGE_FLAG);
    else this.worldFlags.delete(BRIDGE_FLAG);
    // Pojawienie się z animacją tylko przy zmianie w trakcie sesji (po wczytaniu zapisu most stoi od razu).
    this.applyBridge(this.controller !== null && built && !was);
  }

  /** Markery deweloperskie pozycji latarni mostu (panel O/F3); widoczne, gdy most stoi. */
  setBridgeLampMarkers(on: boolean): void {
    this.bridgeMarkers = on;
    this.bridgeLayer?.lamps.setMarkers(on);
  }

  private bridgeStats(): NonNullable<PanelStats["bridge"]> | null {
    const l = this.bridgeLayer;
    if (!l) return null;
    const ls = l.lampStats();
    return { built: l.isBuilt, triangles: l.triangles, bays: l.layout.bays, length: l.layout.length, lamps: ls.lamps, level: ls.level, lights: ls.lights, markers: ls.markers };
  }

  /** Błąd wczytania modelu mostu (kolizje i przejście działają bez niego); null, gdy brak. */
  getBridgeError(): string | null {
    return this.bridgeError;
  }

  /**
   * Zgrywa most z flagą świata: collidery poręczy, wysokość pokładu w kontrolerze i widoczność modelu (ładowanego
   * leniwie dopiero, gdy most jest zbudowany). Wywoływane po zmianie flagi i po zbudowaniu lasu.
   */
  private streamWorld(): WorldRef | null {
    const o = this.streamOptions;
    return o ? { seed: o.seed, genVersion: o.genVersion ?? 2 } : null;
  }

  private applyBridge(animate: boolean): void {
    const world = this.streamWorld();
    if (!world) return;
    const built = this.worldFlags.has(BRIDGE_FLAG);
    syncBridgeColliders(world, built);
    const deck = built ? (x: number, z: number) => forestBridgeOf(world).deckHeightAt(x, z) : null;
    if (this.controller) this.controller.deckHeight = deck;
    if (this.tpp) this.tpp.rig.deckHeight = deck;
    if (!built) {
      this.bridgeLayer?.setBuilt(false, false);
      return;
    }
    if (this.bridgeLayer) {
      this.bridgeLayer.setBuilt(true, animate);
      return;
    }
    this.bridgeAnimate = animate;
    void this.loadBridge(world);
  }

  private loadBridge(world: WorldRef): Promise<void> {
    if (this.bridgeLoad) return this.bridgeLoad;
    const gen = this.generation;
    this.bridgeLoad = (async () => {
      let asset: Awaited<ReturnType<typeof loadBridgeAsset>> | null = null;
      try {
        asset = await loadBridgeAsset();
        if (gen !== this.generation || this.disposed || this.streamOptions?.seed !== world.seed) {
          asset.dispose();
          return;
        }
        const layer = new BridgeLayer(asset, forestBridgeOf(world), { receiveShadow: this.shadowsOn() });
        layer.setHour(this.hour);
        layer.lamps.setMarkers(this.bridgeMarkers);
        this.bridgeLayer = layer;
        this.scene.add(layer.group);
        this.bridgeError = null;
        layer.setBuilt(this.worldFlags.has(BRIDGE_FLAG), this.bridgeAnimate);
      } catch (e) {
        asset?.dispose();
        this.bridgeError = e instanceof Error ? e.message : String(e);
        console.error(e);
      } finally {
        if (gen === this.generation) this.bridgeLoad = null;
      }
    })();
    return this.bridgeLoad;
  }

  /**
   * Stan otwarcia skrzyń wg gry (źródło prawdy to stan gry, renderer tylko go pokazuje). Skrzynia, która właśnie się
   * otworzyła, animuje pokrywę i sypie iskry; przy `animate = false` (wczytanie zapisu) pokrywa jest od razu otwarta.
   */
  setChestStates(opened: Iterable<string>, animate = true): void {
    this.openedChests = new Set(opened);
    const layer = this.chestLayer;
    const world = this.streamWorld();
    if (!layer || !world) return;
    const started = layer.setOpened((id) => this.openedChests.has(id), animate);
    for (const id of started) {
      const c = forestChestsOf(world).find((p) => p.id === id);
      if (c) this.fx?.spawn("sparkle", c.x, c.y + 0.7, c.z);
    }
  }

  /** Zebrane drzewa i skały: znikają z instancji i z kolizji (świat chodzenia jest wspólny dla całego lasu). */
  setHarvested(ids: Iterable<string>): void {
    this.harvestedIds = new Set(ids);
    const world = this.streamWorld();
    if (!world) return;
    syncHarvestedColliders(world, [...this.harvestedIds]);
    this.stream?.setRemoved(this.harvestedIds);
  }

  /** Reakcja NPC z gry (np. gniew trolla po nieudanej próbie); false, gdy nic się nie wydarzyło (brak animacji, trwa inna reakcja, NPC daleko). */
  reactNpc(npc: "troll", kind: "angry"): boolean {
    return this.npcLayer?.react(npc, kind) ?? false;
  }

  /**
   * Odbiorca prośby o dialog z trollem (po animacji Surprised). Zapamiętany także przed końcem ładowania lasu i podpinany do
   * każdej nowej warstwy NPC; `null` wyłącza. Dialog testowy dziś, prawdziwy T1 później: ten sam punkt wejścia.
   */
  onNpcDialog(listener: (() => void) | null): void {
    this.npcDialogListener = listener;
    this.npcLayer?.onDialog(listener);
  }

  /**
   * Odbiorca zdarzeń kroków (kontroler audio): gracz co klatkę z faktycznie przebytą drogą, troll przy kontakcie stopy z animacji Walk.
   * Zapamiętany także przed końcem ładowania lasu i podpinany do każdej nowej warstwy NPC; `null` wyłącza.
   */
  setStepSink(sink: StepSink | null): void {
    this.stepSink = sink;
    this.npcLayer?.onStep(sink ? (step) => sink.npcStep(step.x, step.z, step.foot) : null);
  }

  /** Nawierzchnia pod punktem z danych świata (bez raycastów); wołana tylko przy kroku, nie co klatkę. */
  surfaceAt(x: number, z: number): SurfaceId {
    const forest = this.stepForest;
    return forest ? surfaceFromWorld(forest.surfaceAt(x, z)) : "litter";
  }

  /** Wynik dialogu z trollem: steruje wyłącznie animacją i zachowaniem trolla, nigdy stanem gry. */
  resolveNpcDialog(outcome: DialogOutcome): boolean {
    return this.npcLayer?.resolveDialog(outcome) ?? false;
  }

  /** Materiał trolla do porównania w panelu dev (matowy po korekcie albo oryginalny z pliku); zapamiętany także dla kolejnej warstwy NPC. */
  setNpcMaterialMode(mode: TrollMaterialMode): void {
    this.npcMaterialMode = mode;
    this.npcLayer?.setMaterialMode(mode);
  }

  get npcMaterial(): TrollMaterialMode {
    return this.npcMaterialMode;
  }

  /** Testowe ponowienie spotkania z trollem bez resetowania gry. */
  restartNpcEncounter(): boolean {
    return this.npcLayer?.restartEncounter() ?? false;
  }

  /** Świadoma rozmowa (E) z trollem z bliska; false, gdy jest za daleko albo trwa sekwencja spotkania. */
  talkToNpc(): boolean {
    if (!this.npcReachable()) return false;
    return this.npcLayer?.requestTalk() ?? false;
  }

  /** Czy E może teraz zacząć rozmowę z trollem (do podpowiedzi). */
  get canTalkToNpc(): boolean {
    return (this.npcLayer?.canTalk ?? false) && this.npcReachable();
  }

  /** TPP: rozmowa z trollem wymaga czystej linii od postaci (drzewo lub skała między nimi ją blokuje). W pierwszej osobie bez zmian. */
  private npcReachable(): boolean {
    const t = this.tpp;
    const npc = this.npcLayer;
    const world = this.streamWorld();
    if (!t || !npc || !world) return true;
    const s = t.rig.controller.state;
    return isReachClear(authoritativeForestOf(world), { x: s.x, z: s.z }, npc.position);
  }

  /** Krótki efekt cząstek (drzazgi, odłamki) w danym punkcie świata. */
  burst(kind: BurstKind, x: number, y: number, z: number): void {
    this.fx?.spawn(kind, x, y, z);
  }

  /** Zawieszenie sterowania (np. otwarty dziennik): zeruje klawisze i zatrzymuje ruch gracza. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) {
      this.keys.clear();
      this.tpp?.rig.input.releaseAll();
      this.touchInput?.reset();
    }
  }

  /** Podłącza wejście dotykowe (telefon): joystick, kamera i przyciski czytane w `frame`. `null` odłącza. */
  setTouchInput(touch: TouchInput | null): void {
    this.touchInput?.reset();
    this.touchInput = touch;
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

  /** Pęknięcia gruntu Pro na żywo: rozmiar komórki i szerokość linii (m), siła (0-1) i zakres wygaszania (m od kamery). */
  setProGround(p: { cell?: number; width?: number; strength?: number; fadeNear?: number; fadeFar?: number }): void {
    const u = this.proGround;
    if (p.cell !== undefined) u.uPro.value.x = Math.max(0.05, p.cell);
    if (p.width !== undefined) u.uPro.value.y = Math.max(0.002, p.width);
    if (p.strength !== undefined) u.uPro.value.z = Math.max(0, Math.min(1, p.strength));
    if (p.fadeNear !== undefined) u.uProFade.value.x = Math.max(0, p.fadeNear);
    if (p.fadeFar !== undefined) u.uProFade.value.y = Math.max(u.uProFade.value.x + 0.1, p.fadeFar);
  }

  /** Zagłębienie płyt bruku i kamyków drogi w ziemi (tryb Pro), bez przebudowy świata. */
  setPathSink(sink: PathSink): void {
    this.pathSink = sink;
    this.instancer?.setPathSink(sink);
    this.dirtyInstances = true;
  }

  /** Skala instancji rodzaju (trawa, kwiaty) tylko w widoku, bez przebudowy świata. */
  setKindScale(kind: ViewKind, scale: number): void {
    this.kindScales[kind] = scale;
    this.instancer?.setKindScale(kind, scale);
    this.dirtyInstances = true;
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

  /** Przenosi gracza w pobliże punktu (najbliższe miejsce bez kolizji); używane przez przyciski stref prototypu Pro. */
  teleportNear(x: number, z: number): void {
    const win = this.built?.window;
    const ctl = this.controller;
    if (!win || !ctl || this.bench || this.tour) return;
    for (let r = 0; r < 40; r++) {
      for (let k = 0; k < 16; k++) {
        const px = x + r * Math.cos((k / 16) * Math.PI * 2);
        const pz = z + r * Math.sin((k / 16) * Math.PI * 2);
        if (win.walk.isWalkable(px, pz)) return void ctl.teleport(px, pz);
      }
    }
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
    this.tour = null;
  }

  /** Trasa pomiarowa przez 4 strefy i drogę główną (prototyp Pro); wynik to raport JSON z podziałem na odcinki. */
  runZoneTour(): Promise<ZoneTourReport> {
    return new Promise((resolve, reject) => {
      if (!this.built || this.bench || this.tour) return reject(new Error("Test trasy niedostępny"));
      const legs = buildTourLegs(this.built.window);
      document.exitPointerLock?.();
      this.tour = { legs, recorders: legs.map((l) => new TourLegRecorder(l)), t: 0, total: tourDuration(legs), resolve };
    });
  }

  /** Podłącza hub wejścia (pad): renderer staje się "kierowcą" odczytu w swojej pętli `frame`. */
  setInputHub(hub: InputHub | null): void {
    this.detachInputHub?.();
    this.detachInputHub = null;
    this.inputHub = hub;
    if (hub) this.detachInputHub = hub.attachDriver();
  }

  dispose(): void {
    this.remotePlayers?.dispose();
    getForestAudio().clearRemotePlayers();
    this.disposed = true;
    this.setInputHub(null);
    this.npcDialogListener = null;
    this.stepSink = null;
    this.stepForest = null;
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
    if (this.bridgeLayer) {
      this.scene.remove(this.bridgeLayer.group);
      this.bridgeLayer.dispose();
      this.bridgeLayer = null;
    }
    this.bridgeLoad = null;
    if (this.chestLayer) {
      this.scene.remove(this.chestLayer.group);
      this.chestLayer.dispose();
      this.chestLayer = null;
    }
    this.stepForest = null;
    if (this.npcLayer) {
      this.scene.remove(this.npcLayer.group);
      this.npcLayer.onStep(null);
      this.npcLayer.dispose();
      this.npcLayer = null;
    }
    if (this.deerLayer) {
      this.scene.remove(this.deerLayer.group);
      this.deerLayer.dispose();
      this.deerLayer = null;
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
    this.disposeTpp();
    this.disposeView();
    this.controller = null;
  }

  private disposeTpp(): void {
    this.remotePlayers?.dispose();
    this.remotePlayers = null;
    this.remoteTemplate?.dispose();
    this.remoteTemplate = null;
    getForestAudio().clearRemotePlayers();
    const t = this.tpp;
    if (!t) return;
    this.tpp = null;
    t.detach();
    t.rig.dispose();
    t.animator?.dispose();
    t.appearance?.dispose();
    t.model?.dispose();
    if (t.placeholder) {
      t.placeholder.removeFromParent();
      t.placeholder.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
    }
  }

  /** Dane diagnostyczne TPP (null poza trybem trzecioosobowym albo przed końcem ładowania). */
  getTppSnapshot(): TppDiagnostics | null {
    const t = this.tpp;
    if (!t) return null;
    const st: PlayerAnimStats | null = t.animator?.stats() ?? null;
    return { ...t.rig.snapshot(), animation: st?.dominant ?? "-", jumpWeight: st?.jump ?? 0, modelError: t.modelError, config: { ...t.rig.config } };
  }

  /**
   * Zmienia wygląd postaci gracza bez restartu: kontroler, animacje, pozycja i świat zostają nietknięte, a wymieniane są
   * tylko zmienione elementy. Wywołane przed wczytaniem postaci zapamiętuje wygląd na później.
   */
  setPlayerAppearance(appearance: CharacterAppearanceV1): void {
    this.playerAppearance = normalizeAppearance(appearance);
    this.tpp?.appearance?.apply(this.playerAppearance);
  }

  /** Dane diagnostyczne wyglądu (null poza TPP albo gdy rig wyglądu się nie utworzył). */
  getAppearanceStats(): AppearanceStats | null {
    return this.tpp?.appearance?.stats() ?? null;
  }

  /** Dostęp do rigu wyglądu dla narzędzi deweloperskich (dopasowanie fryzur). */
  get appearanceRig(): AppearanceRig | null {
    return this.tpp?.appearance ?? null;
  }

  /** Zmienia parametry sterowania TPP na żywo (suwaki panelu); wartości spoza zakresów są przycinane. */
  setTppConfig(patch: Partial<TppConfig>): void {
    this.tpp?.rig.setConfig(patch);
    if (patch.modelYawDeg !== undefined) this.tpp?.model?.setModelYawDeg(this.tpp.rig.config.modelYawDeg);
  }

  /** Ustawia gracza TPP w punkcie (najbliższe miejsce bez kolizji nie jest szukane: punkt musi być sprawdzony wcześniej). */
  teleportTpp(x: number, z: number, yaw?: number): void {
    const t = this.tpp;
    if (!t) return;
    t.rig.teleport(x, z, yaw ?? t.rig.controller.state.bodyYaw);
  }

  /** Generuje wszystkie sektory lasu (do pamięci świata) porcjami z oddawaniem sterowania i postępem w komunikacie ładowania. */
  private async warmForest(forest: ForestWorld, label: string, gen: number): Promise<void> {
    const { nx, nz } = forest.sectorGrid;
    const total = nx * nz;
    let done = 0;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        forest.sector(ix, iz);
        done++;
        if (done % 4 === 0) {
          this.loading = `${label} ${Math.round((done / total) * 100)}%`;
          await tick();
          if (gen !== this.generation || this.disposed) return;
        }
      }
    }
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
      const world = this.streamWorld() as WorldRef;
      const pro = world.genVersion >= 3;
      // Warstwa autorytatywna (kolizje) i las do rysowania powstają porcjami, żeby okno nie zamarzało i pokazywało postęp.
      await this.warmForest(authoritativeForestOf(world), "Kolizje lasu", gen);
      if (gen !== this.generation || this.disposed) return;
      const walk = forestWalkOf(world);
      const forest = forestOf(world);
      await this.warmForest(forest, "Generowanie lasu", gen);
      if (gen !== this.generation || this.disposed) return;
      await tick();
      if (gen !== this.generation || this.disposed) return;
      this.stepForest = forest;
      const library = new AssetLibrary({
        profile: this.profile.assets,
        onError: (e) => {
          this.error = e.message;
        },
      });
      const instancer = new ForestInstancer(library, { batches: [] }, this.profile, this.overrides, this.palette, pro);
      for (const [kind, k] of Object.entries(this.kindScales)) instancer.setKindScale(kind as ViewKind, k);
      instancer.setPathSink(this.pathSink);
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
      let deerAsset: DeerAsset | null = null;
      this.deerError = null;
      try {
        deerAsset = await loadDeerAsset();
      } catch (e) {
        this.deerError = e instanceof Error ? e.message : String(e);
        console.error(e);
      }
      let playerAsset: PlayerAsset | null = null;
      this.tppAssetError = null;
      if (opts.thirdPerson) {
        this.loading = "Wczytywanie postaci gracza";
        try {
          playerAsset = await loadPlayerAsset();
        } catch (e) {
          this.tppAssetError = e instanceof Error ? e.message : String(e);
          console.error(e);
        }
      }
      if (gen !== this.generation || this.disposed) {
        chestAsset?.dispose();
        trollAsset?.dispose();
        deerAsset?.dispose();
        playerAsset?.dispose();
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
        tuneGround: (material) => tuneGroundMaterial(material, this.palette, pro ? this.proGround : null),
        desertAt: pro ? (desertWeightFn(forest) ?? undefined) : undefined,
        cacheTag: pro ? `g${world.genVersion}:` : undefined,
      });
      stream.prepareInitial(opts.pose.x, opts.pose.z);
      stream.setRemoved(this.harvestedIds);
      syncHarvestedColliders(world, [...this.harvestedIds]);
      if (chestAsset) {
        const shadows = this.shadowsOn();
        const layer = new ChestLayer(chestAsset, forestChestsOf(world), { castShadow: shadows, receiveShadow: shadows });
        layer.setOpened((id) => this.openedChests.has(id), false);
        this.chestLayer = layer;
        this.scene.add(layer.group);
      }
      if (trollAsset) {
        const shadows = this.shadowsOn();
        try {
          const npc = new NpcLayer(trollAsset, { forest, walk, seed: opts.seed, castShadow: shadows, receiveShadow: shadows, materialMode: this.npcMaterialMode });
          npc.onDialog(this.npcDialogListener);
          const sink = this.stepSink;
          if (sink) npc.onStep((step) => sink.npcStep(step.x, step.z, step.foot));
          this.npcLayer = npc;
          this.scene.add(npc.group);
        } catch (e) {
          this.npcError = e instanceof Error ? e.message : String(e);
          console.error(e);
          trollAsset.dispose();
        }
      }
      if (deerAsset) {
        const shadows = this.shadowsOn();
        try {
          const fauna = new DeerLayer(deerAsset, { forest, walk, seed: opts.seed, castShadow: shadows, receiveShadow: shadows });
          this.deerLayer = fauna;
          this.scene.add(fauna.group);
        } catch (e) {
          this.deerError = e instanceof Error ? e.message : String(e);
          console.error(e);
          deerAsset.dispose();
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
      if (opts.thirdPerson) this.createTpp(playerAsset, walk, forest.terrain, opts.pose, opts.thirdPerson.config ?? {});
      this.applyBridge(false);
      this.lastCamPos.set(1e9, 0, 0);
      this.dirtyInstances = true;
      this.applyProfileToRenderer();
      this.loading = "Wczytywanie lasu";
    } catch (e) {
      if (gen === this.generation) this.fail(e);
    }
  }

  /** Tworzy sterowanie, model i animacje TPP; błąd modelu nie przerywa gry (gracz jest wtedy kapsułą zastępczą). */
  private createTpp(asset: PlayerAsset | null, walk: WalkWorld, terrain: ForestWorld["terrain"], pose: { x: number; z: number; yaw: number }, config: Partial<TppConfig>): void {
    const rig = new ThirdPersonRig(walk, terrain, pose, config);
    rig.flags = this.worldFlags;
    const isField = (e: unknown) => {
      const t = (e as { target?: unknown }).target;
      return t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
    };
    const detach = rig.input.attach(window, document, () => this.locked && !this.bench && !this.suspended, isField);
    let model: PlayerModel | null = null;
    let animator: PlayerAnimator | null = null;
    let appearance: AppearanceRig | null = null;
    let placeholder: THREE.Group | null = null;
    let modelError = this.tppAssetError;
    if (asset) {
      try {
        const shadows = this.shadowsOn();
        this.remoteTemplate?.dispose();
        this.remoteTemplate = createRemoteTemplate(asset);
        model = new PlayerModel(asset, { castShadow: shadows, receiveShadow: shadows, targetHeight: rig.config.characterHeight, modelYawDeg: rig.config.modelYawDeg });
        animator = new PlayerAnimator(asset, model.hipsName);
        this.scene.add(model.group);
        try {
          // Wygląd jest dodatkiem: jego błąd nie może przerwać gry (postać zostaje w bazowym stroju).
          appearance = new AppearanceRig(asset, { castShadow: shadows, receiveShadow: shadows, fits: devFitOverrides() });
          appearance.apply(this.playerAppearance);
        } catch (e) {
          console.error(e);
          appearance?.dispose();
          appearance = null;
        }
      } catch (e) {
        modelError = e instanceof Error ? e.message : String(e);
        console.error(e);
        animator?.dispose();
        animator = null;
        model = null;
        asset.dispose();
      }
    }
    if (!model) {
      // Kapsuła zastępcza o wymiarach kolizji, żeby sterowanie i kamerę dało się sprawdzić bez modelu.
      const h = rig.config.standHeight;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, Math.max(0.1, h - 0.6), 4, 10), new THREE.MeshStandardMaterial({ color: 0xff8844 }));
      body.position.y = h / 2;
      placeholder = new THREE.Group();
      placeholder.add(body);
      this.scene.add(placeholder);
    }
    this.tpp = { rig, model, animator, appearance, placeholder, detach, modelError };
  }

  private groundSize(): number {
    const stress = (this.windowOptions.radius ?? 1) > 1;
    if (this.windowOptions.pro) return Math.max(this.profile.groundTexture, 3072);
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
    const pro = this.windowOptions.pro === true;
    const mesh = buildGroundMesh(win.forest.terrain, win.windowBounds, cell, pro ? (desertWeightFn(win.forest) ?? undefined) : undefined);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
    tuneGroundMaterial(material, this.palette, pro ? this.proGround : null);
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
    const instancer = new ForestInstancer(library, this.built.window, this.profile, this.overrides, this.palette, this.windowOptions.pro === true);
    for (const [kind, k] of Object.entries(this.kindScales)) instancer.setKindScale(kind as ViewKind, k);
    instancer.setPathSink(this.pathSink);
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
    this.bridgeLayer?.setShadows(shadows);
    this.npcLayer?.setShadows(shadows, shadows);
    this.deerLayer?.setShadows(shadows, shadows);
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
      if (!this.locked) {
        this.keys.clear();
        this.tpp?.rig.input.releaseAll();
      }
    };
    const move = (e: MouseEvent) => {
      if (this.locked && !this.bench && !this.tpp) this.controller?.look(e.movementX, e.movementY);
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
    const k = this.keys;
    const forward = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const right = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    const ext = externalMove(this.touchInput, this.inputHub, this.extMove);
    return mergeMove(forward, right, sprint, ext.x, ext.y, ext.sprint, this.suspended, this.moveOut);
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
    this.inputHub?.pump(time);

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
      } else if (this.tour) {
        const tr = this.tour;
        tr.t += dt;
        const at = tourLegAt(tr.legs, tr.t);
        if (at) {
          const pose = tourPose(tr.legs[at.index], at.local);
          ctl.teleport(pose.x, pose.z, pose.yaw);
          ctl.state.pitch = pose.pitch;
        }
      } else if (!this.loading && !this.suspended) {
        ctl.blockers = [...(this.npcLayer?.blockers() ?? []), ...(this.deerLayer?.blockers() ?? [])];
        const px = ctl.state.x;
        const pz = ctl.state.z;
        const pad = this.inputHub;
        const tpp = this.tpp;
        if (tpp) {
          tpp.rig.blockers = ctl.blockers;
          // Ruch, skok, kucanie i kamera z dotyku (joystick ma pierwszeństwo przed padem); bez dotyku ruch idzie z pada.
          applyTouchToTpp(this.touchInput, pad, { input: tpp.rig.input, camera: tpp.rig.camera }, this.extMove, this.touchLook);
          if (pad) {
            const gp = pad.pad;
            if (gp.status === "ready") {
              if (gp.pressed[TPP_BUTTONS.jump] === 1) tpp.rig.input.requestJump();
              if (gp.pressed[TPP_BUTTONS.crouch] === 1) tpp.rig.input.requestCrouchToggle();
            }
            if (pad.look.x !== 0 || pad.look.y !== 0) tpp.rig.camera.lookAnalog(pad.look.x, pad.look.y, dt, pad.lookYawRate, pad.lookPitchRate);
          }
          this.updateTpp(dt, ctl);
        } else {
          if (pad && (pad.look.x !== 0 || pad.look.y !== 0)) ctl.lookAnalog(pad.look.x, pad.look.y, dt, pad.lookYawRate, pad.lookPitchRate);
          const touch = this.touchInput;
          if (touch?.isEnabled) {
            touch.consumeLook(this.touchLook);
            if (this.touchLook.x !== 0 || this.touchLook.y !== 0) ctl.look(this.touchLook.x, this.touchLook.y);
          }
          ctl.update(dt, this.moveInput());
        }
        const walked = dt > MAX_STEP_FRAME_DT ? 0 : Math.hypot(ctl.state.x - px, ctl.state.z - pz);
        this.stepSink?.playerMotion(this.tpp && !this.tpp.rig.controller.state.grounded ? 0 : walked, Math.min(dt, MAX_STEP_FRAME_DT), ctl.state.x, ctl.state.z);
      } else {
        this.stepSink?.playerMotion(0, Math.min(dt, MAX_STEP_FRAME_DT), ctl.state.x, ctl.state.z);
      }
      const s = ctl.state;
      const tppRig = this.tpp?.rig;
      if (tppRig) {
        const pose = tppRig.cameraPose;
        this.camera.position.set(pose.x, pose.y, pose.z);
        this.camera.rotation.set(pose.pitch, pose.yaw, 0);
      } else {
        this.camera.position.set(s.x, s.eyeY, s.z);
        this.camera.rotation.set(s.pitch, s.yaw, 0);
      }
      this.updateInstances(time);
      this.updateSun();
      this.chestLayer?.update(dt, s);
      this.bridgeLayer?.update(dt, this.camera.position.x, this.camera.position.z);
      // Troll żyje także w trakcie własnego dialogu (stoi w Idle i patrzy na gracza), choć sterowanie graczem jest wstrzymane.
      if (!this.suspended || this.npcLayer?.dialogActive) this.npcLayer?.update(dt, s);
      if (!this.suspended) this.deerLayer?.update(dt, s);
      this.fx?.update(dt);
    }
    this.skyUniforms.uSunDir.value.set(...this.atmosphere.sunDir);
    this.sky.position.copy(this.camera.position);
    if (this.instancer) this.instancer.uniforms.uTime.value = this.elapsed;
    this.particleUniforms.uTime.value = this.elapsed;
    this.particleUniforms.uCenter.value.copy(this.camera.position);
    this.particleUniforms.uSize.value = 0.05;

    if (this.multiplayer && this.tpp?.model && this.remoteTemplate) {
      this.remotePlayers ??= new RemotePlayers(this.scene, this.remoteTemplate);
      this.multiplayer.syncAppearance(this.playerAppearance);
      const players = this.multiplayer.remote();
      this.remotePlayers.update(players, dt, this.multiplayer.appearances);
      getForestAudio().remotePlayersMotion(players, dt);
      const s = this.tpp.rig.controller.state;
      getForestAudio().setPose({
        x: s.x,
        y: s.y + this.tpp.rig.controller.state.capsuleHeight * 0.92,
        z: s.z,
        yaw: this.tpp.rig.camera.yaw,
      });
      this.netElapsed += dt;
      if (this.netElapsed >= 1 / NET.hz) {
        this.netElapsed = 0;
        this.multiplayer.send({
          x: s.x,
          y: s.y,
          z: s.z,
          bodyYaw: s.bodyYaw,
          vx: this.suspended ? 0 : s.vx,
          vz: this.suspended ? 0 : s.vz,
          speed: this.suspended ? 0 : s.speed,
          crouching: s.crouching,
          grounded: s.grounded,
          running: s.speed > 4.4,
          animation: this.tpp.animator?.stats().dominant ?? "idle",
        });
      }
    }
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
    if (this.tour) {
      const tr = this.tour;
      const at = tourLegAt(tr.legs, tr.t);
      if (at && at.local >= TOUR_WARMUP_SECONDS) {
        tr.recorders[at.index].push(dtMs, info.render.calls, info.render.triangles, this.instancerStats);
      }
      if (!at) {
        this.tour = null;
        tr.resolve(this.makeTourReport(tr.recorders, tr.total));
      }
    }
    if (time - this.lastEmit > 250) {
      this.lastEmit = time;
      if (lab && lab.current.motion === "orbit") this.onLab?.(lab.current);
      this.emit();
    }
  };

  /**
   * Jedna klatka TPP: kapsuła i kamera, potem model i animacje (jeden `mixer.update`). Stan `FirstPersonController`
   * jest tylko lustrem (pozycja, kierunek, oczy), dzięki czemu skrzynie, NPC, zwierzęta i strumieniowanie działają bez zmian.
   */
  private updateTpp(dt: number, ctl: FirstPersonController): void {
    const t = this.tpp;
    if (!t) return;
    const s = t.rig.update(dt);
    if(s.justJumped) this.multiplayer?.recordJump();
    ctl.state.x = s.x;
    ctl.state.z = s.z;
    // Lustro tylko do odczytu dla warstw, które czytają stan pierwszej osoby; kierunek = kierunek kamery (jak `getPose`).
    ctl.state.yaw = t.rig.camera.yaw;
    ctl.state.eyeY = t.rig.eyeY;
    ctl.lastBlock = s.lastBlock;
    if (t.model) t.model.setPose(s.x, s.y, s.z, s.bodyYaw);
    else if (t.placeholder) {
      t.placeholder.position.set(s.x, s.y, s.z);
      t.placeholder.rotation.y = s.bodyYaw;
      t.placeholder.scale.y = s.capsuleHeight / t.rig.config.standHeight;
    }
    t.animator?.update(dt, t.rig.animIntent(), s, t.rig.config, t.rig.controller.expectedAirTime);
  }

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

  private makeTourReport(recorders: readonly TourLegRecorder[], total: number): ZoneTourReport {
    const size = this.renderer.getSize(new THREE.Vector2());
    return {
      kind: "forest-pro-zone-tour",
      quality: this.quality,
      seed: this.built?.window.seed ?? 0,
      windowSectors: this.built?.window.sectors.length ?? 0,
      totalSeconds: total,
      legs: recorders.map((r) => r.report()),
      canvas: `${size.x}x${size.y}`,
      pixelRatio: this.renderer.getPixelRatio(),
      gpu: this.gpuName(),
      userAgent: navigator.userAgent,
      overrides: this.overrides,
      visual: this.visual,
      note: "FPS jest ograniczany przez odświeżanie monitora (vsync). Pierwsze 1,5 s każdego odcinka nie wchodzi do statystyk. Wartości zależą od GPU i przeglądarki.",
    };
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
      tpp: this.getTppSnapshot() ?? undefined,
      groundTriangles: this.built?.groundTriangles ?? 0,
      locked: this.locked,
      loading: this.loading,
      error: this.error,
      benchmark: {
        running: this.bench !== null || this.tour !== null,
        progress: this.bench ? Math.min(1, this.bench.t / BENCHMARK_SECONDS) : this.tour ? Math.min(1, this.tour.t / Math.max(0.01, this.tour.total)) : 0,
      },
      tourLeg: this.tour ? (this.tour.legs[tourLegAt(this.tour.legs, this.tour.t)?.index ?? 0]?.label ?? null) : null,
      showcase: (this.built?.window.showcase ?? []).map((q) => ({ id: q.id, ix: q.ix, iz: q.iz, qualifies: q.qualifies })),
      stress: (this.windowOptions.radius ?? 1) > 1,
      preset: this.visual.preset,
      presetModified: isModified(this.visual),
      lab: this.lab !== null,
      stream: this.stream?.stats() ?? null,
      loadProgress: this.loadProgress,
      npc: this.npcLayer?.stats() ?? null,
      npcError: this.npcError,
      deer: this.deerLayer?.stats() ?? null,
      deerError: this.deerError,
      appearance: this.tpp?.appearance?.stats() ?? null,
      bridge: this.bridgeStats(),
      bridgeError: this.bridgeError,
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
  if (m.desert) g.setAttribute("aDesert", new THREE.BufferAttribute(m.desert, 1));
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


/** Uniformy shadera gruntu Pro współdzielone z panelem (suwaki zmieniają je na żywo, bez przeładowania). */
export type ProGroundUniforms = { uPro: { value: THREE.Vector4 }; uProTone: { value: number }; uProFade: { value: THREE.Vector2 } };

export function createProGroundUniforms(): ProGroundUniforms {
  return {
    uPro: { value: new THREE.Vector4(PRO_GROUND.crackCell, PRO_GROUND.crackWidth, PRO_GROUND.crackStrength, PRO_GROUND.rippleTilt) },
    uProTone: { value: PRO_GROUND.rippleTone },
    uProFade: { value: new THREE.Vector2(PRO_GROUND.crackFadeNear, PRO_GROUND.crackFadeFar) },
  };
}

function tuneGroundMaterial(material: THREE.MeshStandardMaterial, palette: PaletteStore, pro: ProGroundUniforms | null = null): void {
  const grade = palette.get("ground");
  if (pro) material.defines = { ...(material.defines ?? {}), PRO_GROUND: 1 };
  material.onBeforeCompile = (shader) => {
    if (pro) {
      shader.uniforms.uPro = pro.uPro;
      shader.uniforms.uProTone = pro.uProTone;
      shader.uniforms.uProFade = pro.uProFade;
    }
    shader.uniforms.uGreenSat = palette.greenSat;
    shader.uniforms.uDetail = palette.groundDetail;
    Object.assign(shader.uniforms, grade);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vGroundXZ;\nvarying float vGrPhase;${pro ? "\nattribute float aDesert;\nvarying float vDesert;" : ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvGroundXZ = position.xz;\nvGrPhase = 0.5;${pro ? "\nvDesert = aDesert;" : ""}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRADE_UNIFORM_DECL}\nuniform float uDetail;\nvarying vec2 vGroundXZ;\n${NOISE_GLSL}${pro ? `\n${PRO_GROUND_DECL}` : ""}`)
      .replace("#include <map_fragment>", `#include <map_fragment>${pro ? `\n${PRO_GROUND_ALBEDO}` : ""}${gradeFragment({ swap: false, foliage: false })}\n${GROUND_DETAIL_FRAGMENT}`);
    if (pro) shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${PRO_GROUND_NORMAL}`);
  };
  material.customProgramCacheKey = () => (pro ? "forest2:ground:pro" : "forest2:ground");
}
