import * as THREE from "three";
import { SHADOW_MAP_SIZE, candelaOf, cutoffOf, type LanternConfig } from "./config";
import { createGlowSprite, createGlowTexture } from "./glow";
import {
  approach,
  attachTransform,
  baseLightColor,
  flickerSample,
  glowOpacity,
  glowWorldSize,
  lanternLod,
  lightScaleAt,
  pixelWorldAt1m,
  selectLightCandidates,
  shiftWarmth,
  terrainBlocks,
  type LanternLod,
  type LightCandidate,
  type Rgb,
} from "./math";
import { setSrgb } from "./materials";
import { createLanternVisualAssets, createProceduralLantern, type LanternVisual, type LanternVisualAssets, type LanternVisualFactory } from "./visual";

/** Lampa jednego gracza: stan z gry (lokalnie) albo z migawki serwera (zdalnie). Kość dłoni może jeszcze nie istnieć. */
export type LanternSource = {
  id: string;
  enabled: boolean;
  hand: THREE.Object3D | null;
  /** Rozsynchronizowuje migotanie lamp różnych graczy. */
  seed: number;
  /** Lampa gracza lokalnego dostaje światło przed cudzymi i (jeśli włączone) cień. */
  priority: boolean;
};

export type LanternFrameEnv = {
  time: number;
  dt: number;
  /** 0 noc, 1 dzień (z modelu atmosfery świata). */
  daylight: number;
  /** Gęstość mgły `FogExp2` (0 gdy brak mgły). */
  fogDensity: number;
  camera: { x: number; y: number; z: number };
  fovRad: number;
  viewportHeightPx: number;
  /** Wysokość terenu do zasłaniania blasku wzgórzami; `null` = bez sprawdzania. */
  heightAt: ((x: number, z: number) => number) | null;
};

export type LanternStats = {
  lit: number;
  lights: number;
  poolSize: number;
  near: number;
  mid: number;
  far: number;
  glows: number;
  occluded: number;
  shadows: boolean;
};

export type LanternSystemOptions = {
  /** Stała liczba `PointLight` w scenie (zmiana liczby świateł przeładowuje shadery, więc pula się nie zmienia). */
  poolSize: number;
  /** Na telefonach `false`: cienie dynamiczne lampy są zawsze wyłączone, niezależnie od konfiguracji. */
  allowShadows: boolean;
  glowTextureSize?: number;
  factory?: LanternVisualFactory;
};

type Entry = {
  id: string;
  hand: THREE.Object3D;
  visual: LanternVisual;
  sprite: THREE.Sprite;
  parentScale: number;
  seed: number;
  flame: THREE.Vector3;
  distance: number;
  lod: LanternLod;
  /** Płynne zapalenie (0 -> 1). */
  level: number;
  occlusion: number;
  occlusionTarget: number;
  occlusionInit: boolean;
  losTimer: number;
  slot: number;
  scale: number;
  flickerGlow: number;
};

/** Odległość, od której sprawdzamy zasłanianie terenem (bliżej wystarcza test głębi). */
const LOS_MIN_DISTANCE = 20;
const LOS_INTERVAL = 0.12;
const FADE_IN_RATE = 10;

const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();

/**
 * Wszystkie lampy naftowe w scenie: model w dłoni, rzeczywiste światło z małej STAŁEJ puli `PointLight` (tylko
 * najbliższe lampy dostają światło), blask sprite'em z daleka (bez światła) i LOD. Nic tu nie zmienia stanu gry:
 * system tylko wyświetla to, co dostał w `LanternSource`.
 */
export class LanternSystem {
  readonly group = new THREE.Group();
  private config: LanternConfig;
  private readonly pool: THREE.PointLight[] = [];
  private readonly slotOwner: (string | null)[] = [];
  private readonly slotFade: number[] = [];
  private readonly entries = new Map<string, Entry>();
  private readonly assets: LanternVisualAssets;
  private readonly glowTexture: THREE.DataTexture;
  private readonly factory: LanternVisualFactory;
  private disposed = false;
  private lastStats: LanternStats;

  constructor(
    initial: LanternConfig,
    private readonly options: LanternSystemOptions,
  ) {
    this.config = initial;
    this.group.name = "oil-lanterns";
    this.assets = createLanternVisualAssets();
    this.glowTexture = createGlowTexture(options.glowTextureSize ?? 64);
    this.factory = options.factory ?? createProceduralLantern;
    for (let i = 0; i < Math.max(0, options.poolSize); i++) {
      const light = new THREE.PointLight(0xffbd55, 0, cutoffOf(initial), initial.decay);
      light.name = `oil-lantern-light-${i}`;
      light.castShadow = false;
      this.pool.push(light);
      this.slotOwner.push(null);
      this.slotFade.push(0);
      this.group.add(light);
    }
    this.lastStats = this.emptyStats();
  }

  setConfig(cfg: LanternConfig): void {
    this.config = cfg;
  }

  get poolSize(): number {
    return this.pool.length;
  }

  stats(): LanternStats {
    return this.lastStats;
  }

  /** Liczba żywych lamp (modele w dłoniach); po wyłączeniu wszystkich i opuszczeniu świata ma wrócić do 0. */
  get activeCount(): number {
    return this.entries.size;
  }

  update(sources: readonly LanternSource[], env: LanternFrameEnv): void {
    if (this.disposed) return;
    const cfg = this.config;
    this.sync(sources);

    const pixelWorld = pixelWorldAt1m(env.fovRad, env.viewportHeightPx);
    const stats = this.emptyStats();
    const candidates: LightCandidate[] = [];

    for (const e of this.entries.values()) {
      const attach = attachTransform(cfg, e.parentScale);
      const root = e.visual.root;
      root.position.set(attach.position[0], attach.position[1], attach.position[2]);
      root.rotation.set(attach.rotation[0], attach.rotation[1], attach.rotation[2]);
      root.scale.setScalar(attach.scale);
      root.updateWorldMatrix(true, true);
      e.visual.flameAnchor.getWorldPosition(e.flame);

      e.distance = Math.hypot(e.flame.x - env.camera.x, e.flame.y - env.camera.y, e.flame.z - env.camera.z);
      e.lod = lanternLod(e.distance, cfg);
      e.scale = lightScaleAt(e.distance, cfg);
      e.level = approach(e.level, 1, env.dt, FADE_IN_RATE);

      const flick = flickerSample(env.time, e.seed, cfg);
      const flameColor = shiftWarmth(hexRgb(cfg.glowColor), flick.colorShift);
      e.flickerGlow = 0.85 + 0.15 * flick.intensity * flick.intensity;
      e.visual.update({ emissive: cfg.flameEmissive * flick.intensity, flameColor: shiftWarmth([1, 0.78, 0.38], flick.colorShift), flameScale: 0.9 + 0.2 * (flick.intensity - 0.5) });

      stats.lit++;
      if (e.lod === "near") stats.near++;
      else if (e.lod === "mid") stats.mid++;
      else stats.far++;

      // Blask: zasłanianie terenem sprawdzamy rzadko i tylko z daleka, a wynik wygładzamy.
      e.losTimer -= env.dt;
      if (e.losTimer <= 0 || !e.occlusionInit) {
        e.losTimer = LOS_INTERVAL;
        const blocked = env.heightAt !== null && e.distance > LOS_MIN_DISTANCE && terrainBlocks(env.camera, e.flame, env.heightAt);
        const target = blocked ? 0 : 1;
        if (!e.occlusionInit) {
          e.occlusion = target;
          e.occlusionInit = true;
        }
        e.occlusionTarget = target;
      }
      e.occlusion = approach(e.occlusion, e.occlusionTarget, env.dt, 6);
      if (e.occlusion < 0.5) stats.occluded++;

      const opacity = glowOpacity(cfg, { distance: e.distance, daylight: env.daylight, fogDensity: env.fogDensity, occlusion: e.occlusion, flicker: e.flickerGlow }) * e.level;
      const sprite = e.sprite;
      sprite.visible = opacity > 0.003;
      if (sprite.visible) {
        sprite.position.copy(e.flame);
        const size = glowWorldSize(e.distance, cfg, pixelWorld);
        sprite.scale.set(size, size, 1);
        const material = sprite.material;
        material.opacity = opacity;
        material.color.copy(setSrgb(tmpColor, flameColor));
        stats.glows++;
      }

      if (cfg.lightEnabled && e.scale > 0.001) candidates.push({ id: e.id, distance: e.distance, scale: e.scale, priority: this.isPriority(e.id, sources) });
    }

    this.applyLights(candidates, cfg, env, stats);
    this.lastStats = stats;
  }

  /** Zwalnia wszystkie lampy (modele, sprite'y i światła wracają do stanu spoczynku). */
  releaseAll(): void {
    for (const id of [...this.entries.keys()]) this.release(id);
    for (let i = 0; i < this.pool.length; i++) {
      this.pool[i].intensity = 0;
      this.pool[i].castShadow = false;
      this.slotOwner[i] = null;
      this.slotFade[i] = 0;
    }
    this.lastStats = this.emptyStats();
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseAll();
    this.disposed = true;
    for (const light of this.pool) {
      light.shadow.map?.dispose();
      light.dispose();
      light.removeFromParent();
    }
    this.assets.dispose();
    this.glowTexture.dispose();
    this.group.removeFromParent();
  }

  // ------------------------------------------------------------------ wnętrze

  private emptyStats(): LanternStats {
    return { lit: 0, lights: 0, poolSize: this.pool.length, near: 0, mid: 0, far: 0, glows: 0, occluded: 0, shadows: false };
  }

  private isPriority(id: string, sources: readonly LanternSource[]): boolean {
    for (const s of sources) if (s.id === id) return s.priority;
    return false;
  }

  /** Dopasowuje zbiór żywych lamp do źródeł: tworzy przy zapaleniu, zwalnia przy zgaszeniu, odejściu gracza lub zmianie kości. */
  private sync(sources: readonly LanternSource[]): void {
    const wanted = new Set<string>();
    for (const s of sources) {
      if (!s.enabled || !s.hand) continue;
      wanted.add(s.id);
      const existing = this.entries.get(s.id);
      if (existing && existing.hand !== s.hand) {
        this.release(s.id);
      }
      if (!this.entries.has(s.id)) this.create(s);
    }
    for (const id of [...this.entries.keys()]) if (!wanted.has(id)) this.release(id);
  }

  private create(s: LanternSource): void {
    const hand = s.hand!;
    const visual = this.factory(this.assets);
    hand.updateWorldMatrix(true, false);
    hand.getWorldScale(tmpVec);
    hand.add(visual.root);
    const sprite = createGlowSprite(this.glowTexture);
    this.group.add(sprite);
    this.entries.set(s.id, {
      id: s.id,
      hand,
      visual,
      sprite,
      parentScale: tmpVec.x,
      seed: s.seed,
      flame: new THREE.Vector3(),
      distance: Infinity,
      lod: "far",
      level: 0,
      occlusion: 1,
      occlusionTarget: 1,
      occlusionInit: false,
      losTimer: 0,
      slot: -1,
      scale: 0,
      flickerGlow: 1,
    });
  }

  private release(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.visual.dispose();
    e.sprite.removeFromParent();
    e.sprite.material.dispose();
    this.entries.delete(id);
    const slot = this.slotOwner.indexOf(id);
    if (slot >= 0) {
      this.slotOwner[slot] = null;
      this.slotFade[slot] = 0;
      this.pool[slot].intensity = 0;
    }
  }

  private applyLights(candidates: LightCandidate[], cfg: LanternConfig, env: LanternFrameEnv, stats: LanternStats): void {
    const cap = Math.min(this.pool.length, cfg.maxLights);
    const selected = selectLightCandidates(candidates, cap);
    const assigned = new Map<string, number>();
    const taken = new Array<boolean>(this.pool.length).fill(false);
    const wantShadow = cfg.shadowsEnabled && this.options.allowShadows;

    // Z włączonymi cieniami slot 0 (jedyny rzucający cień) zawsze należy do pierwszej (najważniejszej) lampy.
    if (wantShadow && selected.length > 0 && this.pool.length > 0) {
      assigned.set(selected[0].id, 0);
      taken[0] = true;
    }
    // Lampy zachowują dotychczasowe sloty, żeby światło nie przeskakiwało między źródłami.
    for (const c of selected) {
      if (assigned.has(c.id)) continue;
      const prev = this.slotOwner.indexOf(c.id);
      if (prev >= 0 && prev < cap && !taken[prev]) {
        assigned.set(c.id, prev);
        taken[prev] = true;
      }
    }
    for (const c of selected) {
      if (assigned.has(c.id)) continue;
      const free = taken.findIndex((t, i) => !t && i < cap);
      if (free >= 0) {
        assigned.set(c.id, free);
        taken[free] = true;
      }
    }

    const candela = candelaOf(cfg);
    const cutoff = cutoffOf(cfg);
    const base = baseLightColor(cfg);
    const ownerOfSlot = new Array<string | null>(this.pool.length).fill(null);
    for (const [id, slot] of assigned) ownerOfSlot[slot] = id;
    for (let i = 0; i < this.pool.length; i++) {
      const light = this.pool[i];
      const owner = ownerOfSlot[i];
      if (owner !== this.slotOwner[i]) {
        this.slotOwner[i] = owner;
        this.slotFade[i] = 0;
      }
      light.distance = cutoff;
      light.decay = cfg.decay;
      const e = owner ? this.entries.get(owner) : undefined;
      if (!e) {
        light.intensity = 0;
        this.setShadow(light, false, cfg);
        continue;
      }
      this.slotFade[i] = approach(this.slotFade[i], 1, env.dt, FADE_IN_RATE);
      const flick = flickerSample(env.time, e.seed, cfg);
      const color: Rgb = shiftWarmth(base, flick.colorShift);
      light.color.copy(setSrgb(tmpColor, color));
      light.position.set(e.flame.x, e.flame.y + cfg.heightOffset, e.flame.z);
      light.intensity = candela * flick.intensity * e.scale * e.level * this.slotFade[i];
      e.slot = i;
      stats.lights++;
      this.setShadow(light, i === 0 && wantShadow, cfg);
      if (i === 0 && wantShadow) stats.shadows = true;
    }
  }

  private setShadow(light: THREE.PointLight, on: boolean, cfg: LanternConfig): void {
    if (light.castShadow !== on) light.castShadow = on;
    if (!on) return;
    const size = SHADOW_MAP_SIZE[cfg.shadowQuality];
    if (light.shadow.mapSize.x !== size) {
      light.shadow.map?.dispose();
      light.shadow.map = null;
      light.shadow.mapSize.set(size, size);
    }
    light.shadow.camera.near = 0.05;
    light.shadow.camera.far = cutoffOf(cfg);
    light.shadow.bias = -0.002;
    light.shadow.normalBias = 0.02;
  }
}

function hexRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}
