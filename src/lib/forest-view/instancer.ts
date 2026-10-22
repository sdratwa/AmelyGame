import * as THREE from "three";
import {
  createInstancedModel,
  instancedCost,
  type AssetLibrary,
  type InstancedModel,
  type ModelAsset,
  type Placement,
} from "@/lib/assets";
import { FOLIAGE, HUE_SWAP_TO_GREEN, MATERIAL_TYPES, PRO_FOLIAGE, PRO_MATERIAL_TYPES, STABLE_NORMAL } from "./disposition";
import { GRADE_UNIFORM_DECL, NOISE_GLSL, NORMAL_UP_FRAGMENT, PHASE_VERTEX, PaletteStore, STABLE_NORMAL_FRAGMENT, gradeFragment } from "./grading";
import { SHADOW_CASTERS, type ForestViewProfile, type ViewKind, type ViewOverrides } from "./profiles";
import { createBatchSelector, frustumFor } from "./selector";
import type { ModelBatch } from "./window";

/** `uFix`: 1 = stabilne oświetlenie dwustronnych źdźbeł (domyślnie), 0 = zachowanie sprzed poprawki (diagnostyka). */
export type FoliageUniforms = { uTime: { value: number }; uWind: { value: number }; uFix: { value: number } };

export function createFoliageUniforms(): FoliageUniforms {
  return { uTime: { value: 0 }, uWind: { value: 1 }, uFix: { value: 1 } };
}

/**
 * Dopracowanie współdzielonych materiałów (bez kopiowania): korekta koloru sterowana uniformami (paleta V2b), wiatr
 * zależny od wysokości wierzchołka i pozycji instancji, przyciemnienie nasady roślin (wtopienie w grunt), pochylenie
 * normalnych liści ku górze, stabilna normalna cienkich źdźbeł trawy (bez odwracania na tylnej ściance) oraz zamiana czerwonej tekstury starych drzew na zieloną (jak w V2a, gdy paleta nie ma tintu).
 * Idempotentne. Bez `palette` (testy) korekta jest neutralna i daje kolory V2a.
 */
export function tuneMaterial(
  material: THREE.Material,
  uniforms: FoliageUniforms,
  palette: PaletteStore = new PaletteStore(),
  packColors = false,
): void {
  const id = String(material.userData.assetMaterialId ?? material.name);
  const type = MATERIAL_TYPES[id] ?? PRO_MATERIAL_TYPES[id];
  if (type === undefined || material.userData.forestTuned) return;
  const foliage = FOLIAGE[id] ?? PRO_FOLIAGE[id];
  // `packColors` (prototyp Pro): oryginalne kolory paczki, więc bez zamiany czerwonych liści starych drzew na zielone.
  const swap = !packColors && HUE_SWAP_TO_GREEN.has(id);
  const leafy = type === "foliage";
  const stable = STABLE_NORMAL.has(id);
  const grade = palette.get(id);
  material.userData.forestTuned = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uFix = uniforms.uFix;
    shader.uniforms.uGreenSat = palette.greenSat;
    Object.assign(shader.uniforms, grade);
    const wind = foliage
      ? `
          vForestH = position.y;
          #ifdef USE_INSTANCING
            float fPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.29;
          #else
            float fPhase = 0.0;
          #endif
          float fH = clamp(position.y / ${foliage.height.toFixed(2)}, 0.0, 1.0);
          float fW = fH * fH * uWind * ${foliage.amplitude.toFixed(3)};
          float fS = sin(uTime * 1.5 + fPhase + position.x * 0.9) * 0.6 + sin(uTime * 2.6 + fPhase * 1.7 + position.z * 1.1) * 0.4;
          transformed.x += fS * fW;
          transformed.z += fS * fW * 0.6;`
      : "";
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform float uWind;\nvarying float vForestH;\nvarying float vGrPhase;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${PHASE_VERTEX}${wind}`);
    const root = foliage && foliage.rootShade > 0 ? `diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, ${foliage.rootShade.toFixed(2)}, vForestH));` : "";
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRADE_UNIFORM_DECL}\nuniform float uFix;\nvarying float vForestH;\n${NOISE_GLSL}`)
      .replace("#include <map_fragment>", `#include <map_fragment>${gradeFragment({ swap, foliage: leafy })}\n${root}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${stable ? STABLE_NORMAL_FRAGMENT : ""}${leafy ? NORMAL_UP_FRAGMENT : ""}`);
  };
  material.customProgramCacheKey = () => (packColors ? `forest2pro:${id}` : `forest2:${id}`);
  material.needsUpdate = true;
}

export type InstancerStats = {
  /** Instancje po przydziale (widoczne), wszystkie, aktywne modele (z >= 1 widoczną instancją). */
  visible: number;
  total: number;
  activeModels: number;
  /** Szacunek z danych modeli (bez gruntu i cieni): trójkąty i wywołania rysowania po przydziale LOD. */
  triangles: number;
  drawCalls: number;
  perLevel: number[];
  fallbackModels: number;
};

/**
 * Zagłębienie bruku drogi w ziemi (tylko widok, prototyp Pro): płyty `rockpath` i kamyki `pebble` są obniżane o `max` metrów,
 * a losowość `random` (0-1) rozrzuca głębokość między `max * (1 - random)` a `max` (stabilnie dla danej pozycji).
 */
export type PathSink = { max: number; random: number };
export const PATH_SINK_DEFAULT: PathSink = { max: 0.055, random: 0.22 };

/** Domyślne mnożniki skali rodzajów w widoku prototypu Pro (wybrane przez autora suwakami; 1 = skala z generatora). */
export const PRO_KIND_SCALE_DEFAULTS: Partial<Record<ViewKind, number>> = { fern: 2.34, plant: 0.9, decor: 1, mushroom: 0.73, bush: 1.31 };

const isPaved = (b: ModelBatch) => b.kind === "path" || b.modelId.startsWith("pebble.");

/** Stabilna liczba z [0, 1) z pozycji (całkowitoliczbowy hash, bez losowania w czasie działania). */
function hash01(x: number, z: number): number {
  let h = Math.imul(Math.round(x * 100) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 100) | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** `batch` to partia z zastosowanym mnożnikiem skali rodzaju (widok), `source` to oryginał z generatora. */
type Entry = { batch: ModelBatch; source: ModelBatch; asset: ModelAsset; model: InstancedModel };

/**
 * Wszystkie instancje okna lasu: po jednym `InstancedModel` na model (instancing V1), a przydział LOD, odcięcie
 * odległościowe i frustum robi `createBatchSelector`. Nie dotyka WebGL, więc działa w testach w Node.
 */
export class ForestInstancer {
  readonly group = new THREE.Group();
  readonly uniforms = createFoliageUniforms();
  private entries: Entry[] = [];
  /** Mnożniki skali instancji wg rodzaju (tylko widok; generator i kolizje bez zmian). Brak wpisu = 1. */
  private readonly kindScale: Partial<Record<ViewKind, number>> = {};
  private pathSink: PathSink = { max: 0, random: 0 };
  private readonly assets = new Map<string, ModelAsset>();
  private last: InstancerStats = { visible: 0, total: 0, activeModels: 0, triangles: 0, drawCalls: 0, perLevel: [], fallbackModels: 0 };

  constructor(
    readonly library: AssetLibrary,
    readonly window: { batches: readonly ModelBatch[] },
    readonly profile: ForestViewProfile,
    private overrides: ViewOverrides,
    readonly palette: PaletteStore = new PaletteStore(),
    /** Prototyp Pro: oryginalne kolory paczki (bez zamiany czerwieni na zieleń). */
    private readonly packColors = false,
  ) {
    this.group.name = "forest-instances";
  }

  /** Ładuje modele (zawsze z zastępnikiem przy błędzie, który jest oznaczony w statystykach) i buduje instancje. */
  async init(): Promise<{ failed: string[] }> {
    const failed = await this.preload(this.window.batches.map((b) => b.modelId));
    this.setBatches(this.window.batches);
    return { failed };
  }

  /** Ładuje (z cache biblioteki) modele o podanych ID i dostraja ich materiały; nie tworzy instancji. */
  async preload(modelIds: readonly string[]): Promise<string[]> {
    const failed: string[] = [];
    const wanted = [...new Set(modelIds)].filter((id) => !this.assets.has(id));
    const loaded = await Promise.all(wanted.map(async (id) => ({ id, asset: await this.library.loadOrFallback(id) })));
    for (const { id, asset } of loaded) {
      if (asset.fallback) failed.push(asset.id);
      for (const lod of asset.levels) for (const part of lod.parts) tuneMaterial(part.material, this.uniforms, this.palette, this.packColors);
      this.assets.set(id, asset);
    }
    return failed;
  }

  /**
   * Zastępuje wszystkie instancje nowym zestawem partii (modele muszą być wcześniej załadowane przez `preload`).
   * Geometrie i materiały zostają w bibliotece, więc wymiana kosztuje tylko bufory instancji.
   */
  setBatches(batches: readonly ModelBatch[]): void {
    for (const { model } of this.entries) {
      this.group.remove(model.group);
      model.dispose();
    }
    this.entries = [];
    for (const source of batches) {
      const asset = this.assets.get(source.modelId);
      if (!asset) throw new Error(`Model ${source.modelId} nie został załadowany (preload)`);
      const entry = this.makeEntry(source, asset);
      this.group.add(entry.model.group);
      this.entries.push(entry);
    }
  }

  private scaledBatch(source: ModelBatch): ModelBatch {
    const sinkMax = isPaved(source) ? this.pathSink.max : 0;
    const k = this.kindScale[source.kind] ?? 1;
    if (k === 1 && sinkMax <= 0) return source;
    if (sinkMax > 0) {
      const r = this.pathSink.random;
      return {
        ...source,
        placements: source.placements.map((p) => ({ ...p, y: p.y - sinkMax * (1 - r * hash01(p.x, p.z)) })),
      };
    }
    const mul = (s: Placement["scale"]): Placement["scale"] => (s === undefined ? k : typeof s === "number" ? s * k : [s[0] * k, s[1] * k, s[2] * k]);
    return {
      ...source,
      placements: source.placements.map((p) => ({ ...p, scale: mul(p.scale) })),
      radius: source.radius.map((r) => r * k),
      centerY: source.centerY.map((c) => c * k),
    };
  }

  private makeEntry(source: ModelBatch, asset: ModelAsset): Entry {
    const wantShadow = this.profile.shadows.enabled && this.overrides.shadows;
    const batch = this.scaledBatch(source);
    const casts = SHADOW_CASTERS.has(batch.kind);
    const model = createInstancedModel(asset, batch.placements, {
      profile: this.profile.assets,
      castShadow: wantShadow && casts,
      receiveShadow: wantShadow,
    });
    return { batch, source, asset, model };
  }

  /**
   * Mnoży skalę wszystkich instancji danego rodzaju (np. trawy, kwiatów) bez przebudowy świata; przebudowuje tylko bufory
   * instancji tego rodzaju. Wołać po `setBatches`/`init`; wartość zostaje zapamiętana dla kolejnych `setBatches`.
   */
  setKindScale(kind: ViewKind, scale: number): void {
    const k = Math.max(0.05, Math.min(4, scale));
    if ((this.kindScale[kind] ?? 1) === k) return;
    this.kindScale[kind] = k;
    this.rebuildEntries((b) => b.kind === kind);
  }

  /** Zagłębienie płyt bruku i kamyków drogi w ziemi (patrz `PathSink`); przebudowuje tylko ich bufory instancji. */
  setPathSink(sink: PathSink): void {
    this.pathSink = { max: Math.max(0, Math.min(0.5, sink.max)), random: Math.max(0, Math.min(1, sink.random)) };
    this.rebuildEntries(isPaved);
  }

  private rebuildEntries(match: (b: ModelBatch) => boolean): void {
    this.entries = this.entries.map((e) => {
      if (!match(e.source)) return e;
      this.group.remove(e.model.group);
      e.model.dispose();
      const next = this.makeEntry(e.source, e.asset);
      this.group.add(next.model.group);
      return next;
    });
  }

  setOverrides(overrides: ViewOverrides): void {
    this.overrides = overrides;
    const wantShadow = this.profile.shadows.enabled && overrides.shadows;
    this.uniforms.uWind.value = overrides.wind && this.profile.atmosphere.wind ? 1 : 0;
    for (const { batch, model } of this.entries) {
      const casts = wantShadow && SHADOW_CASTERS.has(batch.kind);
      model.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = casts;
        mesh.receiveShadow = wantShadow;
      });
    }
  }

  /** Przelicza widoczność względem kamery. Wołać gdy kamera zauważalnie się przesunęła/obróciła albo zmieniły się ustawienia. */
  update(camera: THREE.PerspectiveCamera): InstancerStats {
    camera.updateMatrixWorld(true);
    const frustum = frustumFor(camera);
    const position = camera.getWorldPosition(new THREE.Vector3());
    const ctx = {
      profile: this.profile,
      overrides: this.overrides,
      camera: position,
      frustum,
      shadowKeepRange: this.profile.shadows.keepRange,
    };
    let visible = 0;
    let total = 0;
    let active = 0;
    let triangles = 0;
    let drawCalls = 0;
    let fallback = 0;
    const perLevel = [0, 0];
    for (const { batch, asset, model } of this.entries) {
      model.updateWith(createBatchSelector(ctx, batch, asset));
      const counts = model.counts();
      const n = counts.reduce((a, b) => a + b, 0);
      visible += n;
      total += model.total;
      if (n > 0) active++;
      const cost = instancedCost(asset, counts);
      triangles += cost.triangles;
      drawCalls += cost.drawCalls;
      if (asset.fallback) fallback++;
      counts.forEach((c, i) => {
        const level = asset.levels[i]?.level ?? i;
        perLevel[Math.min(1, level)] += c;
      });
    }
    this.last = { visible, total, activeModels: active, triangles, drawCalls, perLevel, fallbackModels: fallback };
    return this.last;
  }

  get stats(): InstancerStats {
    return this.last;
  }

  dispose(): void {
    for (const { model } of this.entries) model.dispose();
    this.entries = [];
    this.group.clear();
  }
}
