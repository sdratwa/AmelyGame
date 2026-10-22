import type { SectorId } from "../../../core/ids";
import {
  FOREST_START_REGION,
  sectorBounds,
  sectorCount,
  sectorId,
  sectorsOverlapping,
  type Bounds,
  type RegionDef,
} from "../../bounds";
import type { FeatureMap } from "../../features";
import type { WorldObject } from "../../objects";
import { buildWorld, prepareWorld, type BuiltWorld, type WorldPlan, type WorldRecipe } from "../../pipeline";
import type { Terrain } from "../../terrain";
import { withDunes } from "./dunes";
import { ForestGeometry } from "./geometry";
import { FOREST_START, planForest } from "./plan";
import { DEFAULT_PROFILES, type AnyProfileId, type ProfileTable } from "./profiles";
import type { ProOptions } from "./pro";
import { validateForest } from "./validate";
import { VegetationGenerator } from "./vegetation";

/** Numer wersji generatora lasu W1a (wersja ROBOCZA do czasu rejestracji w zapisach; generator v1 pozostaje zamrożony). */
export const FOREST_GEN_VERSION = 2;

export type ForestOptions = {
  variant?: number;
  profiles?: ProfileTable;
  /** Tylko testy: dodatkowy margines okien rozsiewu (wynik nie może od niego zależeć). */
  halo?: number;
  /**
   * Tryb deweloperski prototypu Pro (`/dev/forest-pro`): wszystkie modele paczki Pro, 4 strefy-ćwiartki i bruk drogi głównej.
   * Domyślnie wyłączony: bez tej opcji wynik jest bit w bit taki jak w zamrożonym generatorze v2.
   */
  pro?: ProOptions;
  /** `gameplay`: tylko warstwa autorytatywna świata (drzewa i skały z ich ID i kolizjami); domyślnie `all`. */
  layers?: "gameplay" | "all";
};

export type ForestSector = {
  id: SectorId;
  ix: number;
  iz: number;
  bounds: Bounds;
  /** Wszystkie obiekty, których pozycja należy do sektora; stabilne ID, y = wysokość terenu. */
  objects: readonly WorldObject[];
  /** Podzbiór z kolizją (drzewa i skały), do ruchu gracza. */
  colliders: readonly WorldObject[];
  /** Liczba obiektów wg rodzaju (`tree`, `rock`, `grass`...). */
  counts: Readonly<Record<string, number>>;
  /** Obiekty pogrupowane wg modelu (`tree.common.1`...) – gotowe pod instancing. */
  byModel: ReadonlyMap<string, readonly WorldObject[]>;
};

export type SectorDiff = { enter: ForestSector[]; leave: SectorId[]; current: ForestSector[] };

/**
 * Okno aktywnych sektorów wokół gracza (domyślnie promień 3 = 7 x 7). `update` zwraca różnicę względem
 * poprzedniego okna i nie robi nic (zwraca null), dopóki gracz nie zmieni sektora.
 */
export class ActiveSectorWindow {
  private centerKey = "";
  private keys = new Map<SectorId, ForestSector>();

  constructor(
    private readonly forest: ForestWorld,
    readonly radius = 3,
  ) {}

  get sectors(): ForestSector[] {
    return [...this.keys.values()];
  }

  update(x: number, z: number): SectorDiff | null {
    const center = this.forest.sectorCoordClamped(x, z);
    const key = `${center.ix}_${center.iz}`;
    if (key === this.centerKey) return null;
    this.centerKey = key;
    const next = new Map<SectorId, ForestSector>();
    const { nx, nz } = this.forest.sectorGrid;
    for (let iz = Math.max(0, center.iz - this.radius); iz <= Math.min(nz - 1, center.iz + this.radius); iz++) {
      for (let ix = Math.max(0, center.ix - this.radius); ix <= Math.min(nx - 1, center.ix + this.radius); ix++) {
        const sector = this.forest.sector(ix, iz);
        next.set(sector.id, sector);
      }
    }
    const enter = [...next.values()].filter((s) => !this.keys.has(s.id));
    const leave = [...this.keys.keys()].filter((id) => !next.has(id));
    this.keys = next;
    return { enter, leave, current: [...next.values()] };
  }
}

export type ForestWorldInit = {
  seed: number;
  variant: number;
  terrain: Terrain;
  plan: WorldPlan;
  features: FeatureMap;
  region?: RegionDef;
  profiles?: ProfileTable;
  halo?: number;
  pro?: ProOptions;
  /**
   * Tylko z `pro`: dodaj wydmy (`tuning.dunes`) do terenu. Używa tego `createForest`; potok `buildWorld` (walidacja) liczy na
   * terenie bazowym, więc go nie włącza.
   */
  dunes?: boolean;
  layers?: "gameplay" | "all";
};

/**
 * Las W1a: teren, plan (rzeka, ścieżki, strefy) i roślinność liczona leniwie per sektor. Każdy sektor jest
 * funkcją czystą (seed, wersja, wariant, sektor), więc wynik nie zależy od kolejności zapytań ani od tego, które
 * sektory zostały już policzone; cały świat to suma sektorów.
 */
export class ForestWorld {
  readonly seed: number;
  readonly variant: number;
  readonly region: RegionDef;
  readonly terrain: Terrain;
  readonly plan: WorldPlan;
  readonly features: FeatureMap;
  readonly geometry: ForestGeometry;
  readonly profiles: ProfileTable;
  /** Opcje trybu Pro (null = zwykły generator v2). */
  readonly pro: ProOptions | null;
  readonly sectorGrid: { nx: number; nz: number };
  private readonly vegetation: VegetationGenerator;
  private readonly cache = new Map<number, ForestSector>();
  /** Liczba sektorów policzonych od zera (diagnostyka: brak ponownego liczenia przy ruchu gracza). */
  generatedSectors = 0;

  constructor(init: ForestWorldInit) {
    this.seed = init.seed >>> 0;
    this.variant = init.variant;
    this.region = init.region ?? FOREST_START_REGION;
    this.plan = init.plan;
    this.features = init.features;
    this.profiles = init.profiles ?? DEFAULT_PROFILES;
    this.pro = init.pro ?? null;
    this.geometry = new ForestGeometry(init.plan, this.region, this.profiles, this.pro?.quadrants);
    const dunes = init.dunes ? this.pro?.tuning?.dunes : undefined;
    this.terrain = dunes ? withDunes(init.terrain, this.geometry, this.seed, dunes) : init.terrain;
    this.sectorGrid = sectorCount(this.region);
    this.vegetation = new VegetationGenerator({
      seed: this.seed,
      variant: this.variant,
      region: this.region,
      terrain: this.terrain,
      geometry: this.geometry,
      profiles: this.profiles,
      halo: init.halo,
      catalog: this.pro?.catalog,
      paving: this.pro?.paving ?? undefined,
      tuning: this.pro?.tuning,
      layers: init.layers,
    });
  }

  get sectorTotal(): number {
    return this.sectorGrid.nx * this.sectorGrid.nz;
  }

  get cachedSectors(): number {
    return this.cache.size;
  }

  sectorCoordClamped(x: number, z: number): { ix: number; iz: number } {
    const b = this.region.bounds;
    const s = this.region.sectorSize;
    return {
      ix: Math.max(0, Math.min(this.sectorGrid.nx - 1, Math.floor((x - b.minX) / s))),
      iz: Math.max(0, Math.min(this.sectorGrid.nz - 1, Math.floor((z - b.minZ) / s))),
    };
  }

  sector(ix: number, iz: number): ForestSector {
    const { nx, nz } = this.sectorGrid;
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) throw new Error(`Sektor poza regionem: ${ix}_${iz}`);
    const key = iz * nx + ix;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const objects = this.vegetation.generate(ix, iz);
    const counts: Record<string, number> = {};
    const byModel = new Map<string, WorldObject[]>();
    const colliders: WorldObject[] = [];
    for (const o of objects) {
      counts[o.kind] = (counts[o.kind] ?? 0) + 1;
      const model = `${o.kind}.${o.variant}`;
      const list = byModel.get(model);
      if (list) list.push(o);
      else byModel.set(model, [o]);
      if (o.collider) colliders.push(o);
    }
    const sector: ForestSector = {
      id: sectorId(this.region, ix, iz),
      ix,
      iz,
      bounds: sectorBounds(this.region, ix, iz),
      objects,
      colliders,
      counts,
      byModel,
    };
    this.cache.set(key, sector);
    this.generatedSectors++;
    return sector;
  }

  sectorAt(x: number, z: number): ForestSector | null {
    const b = this.region.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return null;
    const c = this.sectorCoordClamped(x, z);
    return this.sector(c.ix, c.iz);
  }

  createWindow(radius = 3): ActiveSectorWindow {
    return new ActiveSectorWindow(this, radius);
  }

  /** Zwalnia sektor z pamięci podręcznej (jego ponowne policzenie da identyczny wynik). */
  dropSector(ix: number, iz: number): boolean {
    return this.cache.delete(iz * this.sectorGrid.nx + ix);
  }

  clearCache(): void {
    this.cache.clear();
    this.vegetation.clearCache();
  }

  allSectors(): ForestSector[] {
    const out: ForestSector[] = [];
    for (let iz = 0; iz < this.sectorGrid.nz; iz++) {
      for (let ix = 0; ix < this.sectorGrid.nx; ix++) out.push(this.sector(ix, iz));
    }
    return out;
  }

  allObjects(): WorldObject[] {
    const out: WorldObject[] = [];
    for (const s of this.allSectors()) for (const o of s.objects) out.push(o);
    return out;
  }

  /** Obiekty z kolizją w pobliżu punktu (z sektorów sąsiadujących; największa obwiednia obiektu to ok. 5 m). */
  collidersNear(x: number, z: number, r: number): WorldObject[] {
    const out: WorldObject[] = [];
    const area = { minX: x - r - 5, minZ: z - r - 5, maxX: x + r + 5, maxZ: z + r + 5 };
    for (const c of sectorsOverlapping(this.region, area)) {
      for (const o of this.sector(c.ix, c.iz).colliders) {
        const rr = (o.collider?.shape === "circle" ? o.collider.r : o.radius) + r;
        if ((o.x - x) ** 2 + (o.z - z) ** 2 <= rr * rr) out.push(o);
      }
    }
    return out;
  }

  /** Rodzaj powierzchni pod punktem (dla dźwięku, śladów i minimapy): woda, ścieżka lub teren, plus profil środowiska. */
  surfaceAt(x: number, z: number): { surface: "water" | "path" | "ground"; y: number; profile: AnyProfileId } {
    const water = this.geometry.waterGap(x, z);
    const trail = this.geometry.trailGap(x, z);
    return {
      surface: water <= 0 ? "water" : trail <= 0 ? "path" : "ground",
      y: this.terrain.height(x, z),
      profile: this.geometry.dominantProfile(x, z),
    };
  }
}

/** Przepis świata dla `buildWorld` (pełny świat); używa tego samego `ForestWorld` co leniwe API. */
export function forestRecipe(options: ForestOptions = {}, onForest?: (forest: ForestWorld) => void): WorldRecipe {
  return {
    regions: [FOREST_START_REGION],
    start: { ...FOREST_START },
    plan: planForest,
    walkCell: 10,
    place(ctx) {
      const forest = new ForestWorld({
        seed: ctx.seed,
        variant: ctx.variant,
        terrain: ctx.terrain,
        plan: ctx.plan,
        features: ctx.features,
        profiles: options.profiles,
        halo: options.halo,
        pro: options.pro,
        layers: options.layers,
      });
      onForest?.(forest);
      return forest.allObjects();
    },
    validate: (ctx) => validateForest(ctx, options.profiles ?? DEFAULT_PROFILES),
  };
}

/** Leniwy świat: teren i plan od razu, obiekty dopiero przy pierwszym zapytaniu o sektor. */
export function createForest(seed: number, options: ForestOptions = {}): ForestWorld {
  const variant = options.variant ?? 0;
  const prepared = prepareWorld(forestRecipe(options), seed, FOREST_GEN_VERSION, { variant });
  return new ForestWorld({
    seed: prepared.seed,
    variant,
    terrain: prepared.terrain,
    plan: prepared.plan,
    features: prepared.features,
    profiles: options.profiles,
    halo: options.halo,
    pro: options.pro,
    dunes: true,
    layers: options.layers,
  });
}

/** Pełny, zwalidowany świat (potok W0) razem z `ForestWorld` użytym do jego wygenerowania. */
export function buildForest(seed: number, options: ForestOptions = {}): { world: BuiltWorld; forest: ForestWorld } {
  let forest: ForestWorld | undefined;
  const world = buildWorld(
    forestRecipe(options, (f) => {
      forest = f;
    }),
    seed,
    FOREST_GEN_VERSION,
    { variant: options.variant ?? 0 },
  );
  return { world, forest: forest! };
}
