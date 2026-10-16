import * as THREE from "three";
import type { ForestSector, ForestWorld } from "@/lib/game/world/generators/v2";
import { lookOf } from "./disposition";
import { buildGroundMesh, buildWaterMesh, createGroundBuilder, type GroundBuilder, type GroundMeshData, type GroundStyle } from "./ground";
import type { ForestInstancer } from "./instancer";
import type { PaletteStore } from "./grading";
import type { ForestViewProfile } from "./profiles";
import {
  INITIAL_RING,
  TILE_PAD,
  TILE_PIXELS,
  padUvs,
  planStream,
  sectorKey,
  sectorsAround,
  tileTextureBounds,
  type SectorCoord,
  type StreamPlan,
} from "./stream";
import { batchesFor, mergeBatches, type ModelBatch } from "./window";

/** Ile razy na sekundę najwyżej przebudowujemy bufory instancji po dociągnięciu lub zwolnieniu sektorów. */
const INSTANCE_APPLY_INTERVAL_MS = 250;
/** Limit pamięci podręcznej pikseli gruntu między wejściami do lasu (sektorów; ~1 MB każdy dla 512 px). */
const TILE_CACHE_LIMIT = 64;

const tileCache = new Map<string, Uint8Array>();

function cachedTile(key: string): Uint8Array | undefined {
  const hit = tileCache.get(key);
  if (hit) {
    tileCache.delete(key);
    tileCache.set(key, hit);
  }
  return hit;
}

function rememberTile(key: string, data: Uint8Array): void {
  tileCache.delete(key);
  tileCache.set(key, data);
  while (tileCache.size > TILE_CACHE_LIMIT) tileCache.delete(tileCache.keys().next().value as string);
}

export function clearTileCache(): void {
  tileCache.clear();
}

export type StreamedForestOptions = {
  forest: ForestWorld;
  profile: ForestViewProfile;
  quality: keyof typeof TILE_PIXELS;
  radius: number;
  groundStyle: GroundStyle;
  palette: PaletteStore;
  instancer: ForestInstancer;
  anisotropy: number;
  receiveShadow: boolean;
  tuneGround: (material: THREE.MeshStandardMaterial) => void;
};

export type StreamStats = {
  center: string;
  resident: number;
  wanted: number;
  queued: number;
  building: boolean;
  groundTriangles: number;
  instances: number;
  cachedTiles: number;
};

type Tile = {
  coord: SectorCoord;
  key: string;
  sector: ForestSector;
  mesh: THREE.Mesh;
  batches: ModelBatch[];
  triangles: number;
};

type Job = {
  coord: SectorCoord;
  key: string;
  sector: ForestSector;
  cacheKey: string;
  builder: GroundBuilder | null;
  data: Uint8Array | null;
};

function toGeometry(m: GroundMeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(m.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Streaming lasu wokół gracza: dla każdego sektora okna powstaje płytka gruntu (siatka z tego samego terenu co kolizje
 * i własna tekstura z zapasem na krawędziach) oraz partie instancji; sektory poza oknem są zwalniane. Praca nad
 * kolejnymi płytkami idzie porcjami w limicie czasu klatki, od sektorów najbliższych graczowi. Kolizje nie są tu
 * streamowane: świat chodzenia zna wszystkie ~2000 colliderów lasu, więc gracz nie może wejść w niezaładowany sektor.
 */
export class StreamedForest {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly pixels: number;
  private readonly size: number;
  private job: Job | null = null;
  private plan: StreamPlan | null = null;
  private queue: SectorCoord[] = [];
  private water: THREE.Mesh | null = null;
  private waterKey = "";
  private lastWater = -Infinity;
  private instancesDirty = false;
  private initialApplied = false;
  private initialLatched = false;
  private lastApply = 0;
  private lastCenter = "";
  private applied = 0;
  private disposed = false;
  private readonly initialKeys = new Set<string>();
  private removed: ReadonlySet<string> = new Set();

  constructor(private readonly o: StreamedForestOptions) {
    this.group.name = "forest-stream";
    this.pixels = TILE_PIXELS[o.quality];
    this.size = o.forest.region.sectorSize;
  }

  get loadedKeys(): ReadonlySet<string> {
    return new Set(this.tiles.keys());
  }

  /** Czy gotowy jest pierścień sektorów wokół punktu startowego (ekran ładowania znika). */
  initialReady(): boolean {
    if (this.initialLatched) return true;
    this.initialLatched = this.initialKeys.size > 0 && [...this.initialKeys].every((k) => this.tiles.has(k));
    return this.initialLatched;
  }

  initialProgress(): number {
    if (this.initialKeys.size === 0) return 0;
    let done = this.tiles.size === 0 ? 0 : [...this.initialKeys].filter((k) => this.tiles.has(k)).length;
    if (this.job && this.initialKeys.has(this.job.key) && this.job.builder) done += this.job.builder.progress();
    return Math.min(1, done / this.initialKeys.size);
  }

  /** Ustawia pierścień ładowany przed wejściem (wołać raz, przed pierwszym `update`). */
  prepareInitial(x: number, z: number): void {
    const center = this.o.forest.sectorCoordClamped(x, z);
    const grid = this.o.forest.sectorGrid;
    for (const c of sectorsAround(grid, center, Math.min(INITIAL_RING, this.o.radius))) this.initialKeys.add(sectorKey(c));
  }

  /**
   * Jedna klatka streamingu: aktualizuje plan przy zmianie sektora gracza, wyładowuje sektory poza oknem, buduje
   * kolejne płytki w limicie `budgetMs` i (z ograniczeniem częstości) odświeża instancje. Zwraca true, gdy zmienił się
   * zestaw instancji (kamera musi przeliczyć widoczność).
   */
  update(x: number, z: number, budgetMs: number, now = performance.now()): boolean {
    if (this.disposed) return false;
    const loaded = new Set(this.tiles.keys());
    this.plan = planStream(this.o.forest.region, this.o.forest.sectorGrid, x, z, this.o.radius, loaded);
    const centerKey = sectorKey(this.plan.center);
    this.lastCenter = centerKey;
    for (const key of this.plan.evict) this.evict(key);
    this.queue = this.plan.load;
    if (this.job && !this.queue.some((c) => sectorKey(c) === this.job?.key)) this.job = null;

    const start = performance.now();
    while (performance.now() - start < budgetMs) {
      if (!this.job) {
        const next = this.queue.find((c) => !this.tiles.has(sectorKey(c)));
        if (!next) break;
        this.job = this.startJob(next);
      }
      if (this.stepJob(this.job)) {
        this.finishJob(this.job);
        this.job = null;
      }
    }
    if (!this.initialReady()) return false;
    this.refreshWater(now);
    const first = !this.initialApplied;
    this.initialApplied = true;
    return this.applyInstances(now, first);
  }

  /**
   * Ustawia obiekty usunięte ze świata (zebrane drzewa i skały). Przebudowuje tylko partie sektorów, które zawierają
   * zmienione obiekty, i wymusza odświeżenie instancji bez czekania na limit częstości.
   */
  setRemoved(ids: ReadonlySet<string>): void {
    const changed = new Set<string>();
    for (const id of ids) if (!this.removed.has(id)) changed.add(id);
    for (const id of this.removed) if (!ids.has(id)) changed.add(id);
    this.removed = new Set(ids);
    if (changed.size === 0) return;
    for (const tile of this.tiles.values()) {
      if (!tile.sector.objects.some((o) => changed.has(o.id))) continue;
      tile.batches = this.batchesOf(tile.sector);
      this.instancesDirty = true;
      this.lastApply = -Infinity;
    }
  }

  private batchesOf(sector: ForestSector): ModelBatch[] {
    const objects = this.removed.size === 0 ? sector.objects : sector.objects.filter((o) => !this.removed.has(o.id));
    return batchesFor(objects).batches;
  }

  stats(): StreamStats {
    let triangles = 0;
    for (const t of this.tiles.values()) triangles += t.triangles;
    return {
      center: this.lastCenter,
      resident: this.tiles.size,
      wanted: this.plan ? this.plan.load.length + this.tiles.size - this.plan.evict.length : 0,
      queued: this.plan ? this.plan.load.length : 0,
      building: this.job !== null,
      groundTriangles: triangles + (this.water ? (this.water.geometry.index?.count ?? 0) / 3 : 0),
      instances: this.applied,
      cachedTiles: tileCache.size,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const key of [...this.tiles.keys()]) this.evict(key, false);
    this.clearWater();
    this.job = null;
    this.group.clear();
  }

  private startJob(coord: SectorCoord): Job {
    const sector = this.o.forest.sector(coord.ix, coord.iz);
    const cacheKey = `${this.o.forest.seed}:${this.o.groundStyle}:${this.pixels}:${sectorKey(coord)}`;
    const data = cachedTile(cacheKey) ?? null;
    return { coord, key: sectorKey(coord), sector, cacheKey, builder: null, data };
  }

  /** Zwraca true, gdy płytka ma gotowe piksele. */
  private stepJob(job: Job): boolean {
    if (job.data) return true;
    if (!job.builder) {
      const forest = this.o.forest;
      const grid = forest.sectorGrid;
      const objects: ForestSector["objects"][number][] = [];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ix = job.coord.ix + dx;
          const iz = job.coord.iz + dz;
          if (ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz) continue;
          objects.push(...forest.sector(ix, iz).objects);
        }
      }
      job.builder = createGroundBuilder({
        forest,
        bounds: tileTextureBounds(job.sector.bounds, TILE_PAD),
        objects,
        size: this.pixels,
        style: this.o.groundStyle,
      });
    }
    if (!job.builder.step(16)) return false;
    job.data = job.builder.data;
    rememberTile(job.cacheKey, job.data);
    return true;
  }

  private finishJob(job: Job): void {
    if (!job.data) return;
    const o = this.o;
    const texture = new THREE.DataTexture(job.data, this.pixels, this.pixels, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = o.anisotropy;
    texture.needsUpdate = true;

    const meshData = buildGroundMesh(o.forest.terrain, job.sector.bounds, o.profile.groundCell);
    padUvs(meshData.uvs, this.size, TILE_PAD);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
    o.tuneGround(material);
    const mesh = new THREE.Mesh(toGeometry(meshData), material);
    mesh.name = `ground:${job.key}`;
    mesh.receiveShadow = o.receiveShadow;
    mesh.userData.texture = texture;
    this.group.add(mesh);
    this.tiles.set(job.key, {
      coord: job.coord,
      key: job.key,
      sector: job.sector,
      mesh,
      batches: this.batchesOf(job.sector),
      triangles: meshData.triangleCount,
    });
    this.instancesDirty = true;
  }

  private evict(key: string, markDirty = true): void {
    const tile = this.tiles.get(key);
    if (!tile) return;
    this.group.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    (tile.mesh.userData.texture as THREE.Texture | undefined)?.dispose();
    (tile.mesh.material as THREE.Material).dispose();
    this.tiles.delete(key);
    if (markDirty) this.instancesDirty = true;
  }

  private applyInstances(now: number, force: boolean): boolean {
    if (!this.instancesDirty) return false;
    if (!force && now - this.lastApply < INSTANCE_APPLY_INTERVAL_MS) return false;
    const parts = [...this.tiles.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((t) => t.batches);
    const merged = mergeBatches(parts);
    this.o.instancer.setBatches(merged);
    this.applied = merged.reduce((n, b) => n + b.ids.length, 0);
    this.instancesDirty = false;
    this.lastApply = now;
    return true;
  }

  /** Lustro wody obejmuje prostokąt załadowanych sektorów; przebudowa tylko przy zmianie jego zasięgu. */
  private refreshWater(now: number): void {
    if (this.tiles.size === 0) return;
    let minIx = Infinity;
    let maxIx = -Infinity;
    let minIz = Infinity;
    let maxIz = -Infinity;
    for (const t of this.tiles.values()) {
      minIx = Math.min(minIx, t.coord.ix);
      maxIx = Math.max(maxIx, t.coord.ix);
      minIz = Math.min(minIz, t.coord.iz);
      maxIz = Math.max(maxIz, t.coord.iz);
    }
    const key = `${minIx}_${minIz}-${maxIx}_${maxIz}`;
    if (key === this.waterKey || now - this.lastWater < INSTANCE_APPLY_INTERVAL_MS) return;
    this.waterKey = key;
    this.lastWater = now;
    this.clearWater();
    const first = this.o.forest.sector(minIx, minIz).bounds;
    const last = this.o.forest.sector(maxIx, maxIz).bounds;
    const data = buildWaterMesh(this.o.forest, { minX: first.minX, minZ: first.minZ, maxX: last.maxX, maxZ: last.maxZ });
    if (!data) return;
    const water = new THREE.Mesh(
      toGeometry(data),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(0.18, 0.4, 0.38, THREE.SRGBColorSpace),
        roughness: 0.12,
        metalness: 0,
        transparent: true,
        opacity: 0.78,
      }),
    );
    water.name = "water";
    this.water = water;
    this.group.add(water);
  }

  private clearWater(): void {
    if (!this.water) return;
    this.group.remove(this.water);
    this.water.geometry.dispose();
    (this.water.material as THREE.Material).dispose();
    this.water = null;
  }
}

/** Identyfikatory wszystkich modeli występujących w lesie (bez ukrytych odmian): ładowane raz, przed streamingiem. */
export function forestModelIds(forest: ForestWorld): string[] {
  const ids = new Set<string>();
  for (const sector of forest.allSectors()) {
    for (const o of sector.objects) {
      const id = o.variant ? `${o.kind}.${o.variant}` : o.kind;
      if (lookOf(id).mode !== "hide") ids.add(id);
    }
  }
  return [...ids].sort();
}
