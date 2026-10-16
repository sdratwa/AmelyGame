import * as THREE from "three";
import {
  createInstancedModel,
  instancedCost,
  type AssetLibrary,
  type InstancedModel,
  type ModelAsset,
} from "@/lib/assets";
import { FOLIAGE, HUE_SWAP_TO_GREEN, MATERIAL_TYPES, STABLE_NORMAL } from "./disposition";
import { GRADE_UNIFORM_DECL, NOISE_GLSL, NORMAL_UP_FRAGMENT, PHASE_VERTEX, PaletteStore, STABLE_NORMAL_FRAGMENT, gradeFragment } from "./grading";
import { SHADOW_CASTERS, type ForestViewProfile, type ViewOverrides } from "./profiles";
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
export function tuneMaterial(material: THREE.Material, uniforms: FoliageUniforms, palette: PaletteStore = new PaletteStore()): void {
  const id = String(material.userData.assetMaterialId ?? material.name);
  if (!(id in MATERIAL_TYPES) || material.userData.forestTuned) return;
  const foliage = FOLIAGE[id];
  const swap = HUE_SWAP_TO_GREEN.has(id);
  const leafy = MATERIAL_TYPES[id] === "foliage";
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
  material.customProgramCacheKey = () => `forest2:${id}`;
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

type Entry = { batch: ModelBatch; asset: ModelAsset; model: InstancedModel };

/**
 * Wszystkie instancje okna lasu: po jednym `InstancedModel` na model (instancing V1), a przydział LOD, odcięcie
 * odległościowe i frustum robi `createBatchSelector`. Nie dotyka WebGL, więc działa w testach w Node.
 */
export class ForestInstancer {
  readonly group = new THREE.Group();
  readonly uniforms = createFoliageUniforms();
  private entries: Entry[] = [];
  private readonly assets = new Map<string, ModelAsset>();
  private last: InstancerStats = { visible: 0, total: 0, activeModels: 0, triangles: 0, drawCalls: 0, perLevel: [], fallbackModels: 0 };

  constructor(
    readonly library: AssetLibrary,
    readonly window: { batches: readonly ModelBatch[] },
    readonly profile: ForestViewProfile,
    private overrides: ViewOverrides,
    readonly palette: PaletteStore = new PaletteStore(),
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
      for (const lod of asset.levels) for (const part of lod.parts) tuneMaterial(part.material, this.uniforms, this.palette);
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
    const wantShadow = this.profile.shadows.enabled && this.overrides.shadows;
    for (const batch of batches) {
      const asset = this.assets.get(batch.modelId);
      if (!asset) throw new Error(`Model ${batch.modelId} nie został załadowany (preload)`);
      const casts = SHADOW_CASTERS.has(batch.kind);
      const model = createInstancedModel(asset, batch.placements, {
        profile: this.profile.assets,
        castShadow: wantShadow && casts,
        receiveShadow: wantShadow,
      });
      this.group.add(model.group);
      this.entries.push({ batch, asset, model });
    }
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
