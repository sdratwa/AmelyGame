import { mulberry32, streamSeed, type Rng } from "../../../core/rng";
import { objectId, sectorBounds, sectorCount, type Bounds, type RegionDef } from "../../bounds";
import { valueNoise2 } from "../../noise";
import { makeObject, type WorldObject } from "../../objects";
import { buildRockProfile } from "../../rockPhysics";
import type { HeightField } from "../../terrain";
import type { ForestGeometry } from "./geometry";
import { buildPaving } from "./paving";
import type { DensityLayer, EnvironmentProfile, ProfileTable } from "./profiles";
import type { PavingOptions, ProRockTuning, ProTuning } from "./pro";
import {
  ROCK_CLASSES,
  ROCK_CLASS_IDS,
  ROCK_JITTER,
  ROCK_MAX_TILT,
  SPECIES,
  groupIndex,
  type LayerId,
  type RockClass,
  type Species,
  type SpeciesGroup,
} from "./species";

/**
 * Rozsiew roślinności W1a. Zasady:
 * - Kandydaci są funkcją czystą (seed, warstwa, komórka siatki, numer): każda warstwa ma własny strumień, więc zmiana
 *   liczby kwiatów nie przesuwa drzew ani skał (warstwy zależą tylko od warstw wcześniejszych w kolejności
 *   drzewa -> skały -> reszta).
 * - Gęstość zmienia się w przestrzeni przez akceptację kandydatów (prawdopodobieństwo = lokalna intensywność / maksimum
 *   warstwy), a konflikty rozstrzyga rzadzenie typu Matérn II po znacznikach: wynik nie zależy od kolejności ani od okna.
 * - Sektor widzi okno większe od siebie o stały margines (drzewa 8 m, skały 3 m), więc dowolny sektor da się
 *   odtworzyć z samego seeda i jest identyczny jak ten sam wycinek całego świata.
 * - Bez losowości z środowiska, zegara i funkcji trygonometrycznych w decyzjach; współrzędne zaokrąglane do 1 mm.
 */

export type LayerConfig = {
  cell: number;
  perCell: number;
  members: readonly [number, number];
  spread: number;
};

export const LAYERS: Readonly<Record<LayerId, LayerConfig>> = {
  tree: { cell: 8, perCell: 6, members: [1, 1], spread: 0 },
  ancient: { cell: 36, perCell: 1, members: [1, 1], spread: 0 },
  rock: { cell: 16, perCell: 2, members: [1, 4], spread: 3.2 },
  bush: { cell: 5, perCell: 1, members: [1, 1], spread: 0 },
  fern: { cell: 4, perCell: 2, members: [1, 1], spread: 0 },
  plant: { cell: 4, perCell: 1, members: [1, 1], spread: 0 },
  grass: { cell: 3, perCell: 3, members: [1, 1], spread: 0 },
  flower: { cell: 6, perCell: 1, members: [3, 7], spread: 2.4 },
  mushroom: { cell: 1, perCell: 0, members: [2, 5], spread: 1.4 },
};

/** Maksymalna gęstość (obiektów na 100 m²), jaką warstwa może osiągnąć; wyższe wartości w profilach są obcinane. */
export function layerCapacityPer100m2(layer: DensityLayer): number {
  const c = LAYERS[layer];
  const mean = (c.members[0] + c.members[1]) / 2;
  return ((c.perCell * mean) / (c.cell * c.cell)) * 100;
}

type ClusterCfg = { s1: number; lo: number; hi: number; floor: number; m0: number; s2: number; amp: number };

/** Skupiska i prześwity: skala (m), próg gładkiego przejścia, dolna wartość, średnia szumu i drobna zmienność. */
const CLUSTER: Readonly<Record<"tree" | "ancient" | "rock" | "bush" | "fern" | "plant" | "grass" | "flower", ClusterCfg>> = {
  tree: { s1: 45, lo: 0.3, hi: 0.7, floor: 0.25, m0: 0.5, s2: 12, amp: 0.3 },
  ancient: { s1: 80, lo: 0.35, hi: 0.65, floor: 0.3, m0: 0.5, s2: 30, amp: 0.2 },
  rock: { s1: 50, lo: 0.4, hi: 0.6, floor: 0.3, m0: 0.5, s2: 20, amp: 0.3 },
  bush: { s1: 22, lo: 0.35, hi: 0.65, floor: 0.15, m0: 0.5, s2: 8, amp: 0.3 },
  fern: { s1: 18, lo: 0.35, hi: 0.65, floor: 0.2, m0: 0.5, s2: 6, amp: 0.3 },
  plant: { s1: 25, lo: 0.3, hi: 0.7, floor: 0.4, m0: 0.5, s2: 8, amp: 0.25 },
  grass: { s1: 20, lo: 0.3, hi: 0.7, floor: 0.35, m0: 0.5, s2: 5, amp: 0.3 },
  flower: { s1: 16, lo: 0.55, hi: 0.78, floor: 0.03, m0: 0.17, s2: 5, amp: 0.25 },
};

const smooth = (t: number) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};
const q3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 10000) / 10000;
const lerp = (lo: number, hi: number, t: number) => lo + (hi - lo) * t;
const TWO_PI = Math.PI * 2;

/** Skrót (ziarno, a, b, c) -> int32; ziarno dla `mulberry32` konkretnej komórki i numeru. */
function cellSeed(seed: number, a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h | 0;
}

const cellKey = (ix: number, iz: number) => (ix + 4096) * 8192 + (iz + 4096);

/** Punkt z jednostkowego koła (próbkowanie z odrzucaniem, bez trygonometrii). */
function unitDisc(rng: Rng): [number, number] {
  for (let i = 0; i < 16; i++) {
    const x = rng() * 2 - 1;
    const z = rng() * 2 - 1;
    const d = x * x + z * z;
    if (d <= 1 && d > 1e-4) return [x, z];
  }
  return [0.5, 0.5];
}

type Cand = {
  x: number;
  z: number;
  sp: Species;
  scale: number;
  yaw: number;
  mark: number;
  /** Promień odstępu w rzadzeniu (drzewa, krzewy) albo kolizji + odstęp (skały). */
  r: number;
  /** Promień kolizji (m) z uwzględnieniem skali; 0 = brak. */
  collR: number;
  scaleXYZ?: readonly [number, number, number];
  tilt?: readonly [number, number];
  rockClass?: RockClass;
  seed: number;
};

class Grid {
  private readonly cells = new Map<number, Cand[]>();
  constructor(private readonly size = 8) {}
  add(c: Cand): void {
    const key = cellKey(Math.floor(c.x / this.size), Math.floor(c.z / this.size));
    const list = this.cells.get(key);
    if (list) list.push(c);
    else this.cells.set(key, [c]);
  }
  /** Wywołuje `visit` dla kandydatów z komórek, które mogą leżeć w odległości `r` od punktu. */
  near(x: number, z: number, r: number, visit: (c: Cand) => boolean | void): void {
    const x0 = Math.floor((x - r) / this.size);
    const x1 = Math.floor((x + r) / this.size);
    const z0 = Math.floor((z - r) / this.size);
    const z1 = Math.floor((z + r) / this.size);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const list = this.cells.get(cellKey(ix, iz));
        if (!list) continue;
        for (const c of list) if (visit(c) === true) return;
      }
    }
  }
}

const expand = (b: Bounds, m: number): Bounds => ({ minX: b.minX - m, minZ: b.minZ - m, maxX: b.maxX + m, maxZ: b.maxZ + m });
const inside = (b: Bounds, x: number, z: number) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

export type VegetationOptions = {
  seed: number;
  variant: number;
  region: RegionDef;
  terrain: HeightField;
  geometry: ForestGeometry;
  profiles: ProfileTable;
  /** Dodatkowy margines okien (m), tylko do testów poprawności marginesów: wynik nie może zależeć od jego wartości. */
  halo?: number;
  /**
   * Tryb deweloperski prototypu Pro: katalog gatunków (np. `SPECIES_ALL`) zamiast zamrożonej tabeli v2. Brak = generator v2
   * bez żadnej zmiany wyniku (dodatkowe losowania i reguły działają wyłącznie, gdy katalog jest podany).
   */
  catalog?: readonly Species[];
  /** Tryb Pro: brukowanie drogi (wymaga `catalog` z grupami `rockpath` i `pebble`). */
  paving?: PavingOptions;
  /** Tryb Pro: strojenie trawy w kępach, formacji skalnych (wymaga `catalog`). Brak = zachowanie sprzed poprawki. */
  tuning?: ProTuning;
  /**
   * `gameplay`: tylko warstwa autorytatywna (drzewa, drzewa stare, skały), bez roślinności kosmetycznej, grzybów, płatków,
   * kamyków i bruku. Domyślnie wszystko (`all`). Identyfikatory i pozycje drzew i skał są takie same w obu trybach.
   */
  layers?: "gameplay" | "all";
  /**
   * Fizyka skał v1 (generator v5): skały dostają `WorldObject.rock` (wysokość i powierzchnia stania). Nie zmienia pozycji,
   * ID, kolizji kołowych ani losowań; bez tej opcji wynik jest bit w bit taki jak w generatorach v2-v4.
   */
  rockPhysics?: boolean;
};

type Draft = { c: Cand; kind: string };

export class VegetationGenerator {
  private readonly layerSeed: Record<string, number> = {};
  private readonly noiseSeed: Record<string, [number, number]> = {};
  private readonly moistSeed: number;
  private readonly mushroomSeed: number;
  private readonly decorSeed: number;
  private readonly pavingSeed: number;
  private pavingCache: Cand[] | null = null;
  private readonly ext: boolean;
  /** Największy promień kolizji skały (m): tryb Pro ma duże głazy i formacje, więc okna rzadzenia są szersze. */
  private readonly rockReach: number;
  private readonly weights: Float64Array;
  private readonly treeCells = new Map<number, Cand[]>();
  private readonly ancientCells = new Map<number, Cand[]>();
  private readonly rockCells = new Map<number, Cand[]>();
  private readonly halo: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly speciesByGroup = new Map<SpeciesGroup, readonly Species[]>();
  private readonly profiles: readonly EnvironmentProfile[];

  constructor(private readonly o: VegetationOptions) {
    const suffix = o.variant > 0 ? `#v${o.variant}` : "";
    const key = (name: string) => streamSeed(o.seed, `forest.veg.${name}${suffix}`) | 0;
    for (const layer of Object.keys(LAYERS)) {
      this.layerSeed[layer] = key(layer);
      this.noiseSeed[layer] = [key(`${layer}.n1`), key(`${layer}.n2`)];
    }
    this.moistSeed = key("moisture");
    this.mushroomSeed = key("mushroom_rings");
    this.decorSeed = key("decor");
    this.pavingSeed = key("paving");
    this.ext = o.catalog !== undefined;
    this.rockReach = this.ext ? Math.max(3.6, 2.461 * (o.tuning?.rocks.scale[1] ?? 0) * (1 + ROCK_JITTER.x)) : 2.1;
    this.weights = new Float64Array(o.geometry.weightCount);
    this.halo = o.halo ?? 0;
    const { nx, nz } = sectorCount(o.region);
    this.nx = nx;
    this.nz = nz;
    this.profiles = o.geometry.weightProfiles;
    for (const [group, list] of groupIndex(o.catalog ?? SPECIES)) this.speciesByGroup.set(group, list);
  }

  /** Czyści pamięć podręczną komórek (wynik się nie zmienia, tylko jest liczony od nowa). */
  clearCache(): void {
    this.pavingCache = null;
    this.treeCells.clear();
    this.ancientCells.clear();
    this.rockCells.clear();
  }

  private mixDensity(layer: DensityLayer): number {
    let s = 0;
    for (let i = 0; i < this.profiles.length; i++) s += this.weights[i] * this.profiles[i].density[layer];
    return s;
  }

  private mixed(pick: (p: EnvironmentProfile) => number): number {
    let s = 0;
    for (let i = 0; i < this.profiles.length; i++) s += this.weights[i] * pick(this.profiles[i]);
    return s;
  }

  private cluster(layer: keyof typeof CLUSTER, x: number, z: number, override?: ClusterCfg): number {
    const c = override ?? CLUSTER[layer];
    const ns = this.noiseSeed[layer];
    const n1 = valueNoise2(ns[0], x / c.s1, z / c.s1);
    const base = (c.floor + (1 - c.floor) * smooth((n1 - c.lo) / (c.hi - c.lo))) / (c.floor + (1 - c.floor) * c.m0);
    const n2 = valueNoise2(ns[1], x / c.s2, z / c.s2);
    return base * (1 - c.amp + 2 * c.amp * n2);
  }

  private moisture(x: number, z: number): number {
    const g = Math.max(0, this.o.geometry.riverGapProxy(x, z));
    const river = 0.55 / (1 + (g / 28) * (g / 28));
    return river + 0.45 * valueNoise2(this.moistSeed, x / 70, z / 70);
  }

  private slopeTan(x: number, z: number): number {
    const g = this.o.terrain.gradient(x, z);
    return Math.sqrt(g.dx * g.dx + g.dz * g.dz);
  }

  private inRegion(x: number, z: number, margin: number): boolean {
    const b = this.o.region.bounds;
    return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
  }

  private pickSpecies(group: SpeciesGroup, u: number): Species {
    const list = this.speciesByGroup.get(group)!;
    return list[Math.min(list.length - 1, Math.floor(u * list.length))];
  }

  private pickGroup<G extends string>(weights: Record<G, number>, u: number): G {
    const keys = Object.keys(weights) as G[];
    let total = 0;
    for (const k of keys) total += weights[k];
    let acc = 0;
    const target = u * total;
    for (const k of keys) {
      acc += weights[k];
      if (target < acc) return k;
    }
    return keys[keys.length - 1];
  }

  /** Wybór grupy drzew w trybie Pro: grupy bazowe jak w v2 (te same wagi) plus grupy Pro o wadze z profilu (tylko dodatnie). */
  private pickTreeGroup(u: number, wB: number, wP: number): SpeciesGroup {
    const rec: Record<string, number> = { broadleaf: wB, pine: wP };
    const extra: [SpeciesGroup, number][] = [
      ["birch", this.mixed((p) => p.pro?.tree?.birch ?? 0)],
      ["giantpine", this.mixed((p) => p.pro?.tree?.giantpine ?? 0)],
      ["tallthick", this.mixed((p) => p.pro?.tree?.tallthick ?? 0)],
      ["blossom", this.mixed((p) => p.pro?.tree?.blossom ?? 0)],
      ["dead", this.mixed((p) => p.pro?.tree?.dead ?? 0)],
    ];
    for (const [g, w] of extra) if (w > 0) rec[g] = w;
    return this.pickGroup(rec, u) as SpeciesGroup;
  }

  /** Gatunek skały w trybie Pro: duże głazy (tylko klasa L) i warianty pustynne wg udziałów z profilu. */
  private pickRockSpecies(cls: RockClass, uModel: number, uDesert: number): Species {
    const big = cls === "l" ? this.mixed((p) => p.pro?.rockBig ?? 0) : 0;
    const desert = this.mixed((p) => p.pro?.rockDesert ?? 0);
    let isBig = false;
    let u = uModel;
    if (big > 0) {
      if (uModel < big) {
        isBig = true;
        u = uModel / big;
      } else u = (uModel - big) / (1 - big);
    }
    const isDesert = uDesert < desert;
    const group: SpeciesGroup = isBig ? (isDesert ? "rockbigdesert" : "rockbig") : isDesert ? "rockdesert" : "rock";
    return this.pickSpecies(group, Math.min(0.999999, u));
  }

  /** Wagi grup grzybów w trybie Pro (pospolity = 1). */
  private mushroomWeights(): Record<string, number> {
    const rec: Record<string, number> = { mushroom: 1 };
    const cap = this.mixed((p) => p.pro?.mushroom?.mushroomcap ?? 0);
    const bracket = this.mixed((p) => p.pro?.mushroom?.bracket ?? 0);
    if (cap > 0) rec.mushroomcap = cap;
    if (bracket > 0) rec.bracket = bracket;
    return rec;
  }

  // ----- drzewa -----

  private treeCell(cx: number, cz: number, ancient: boolean): Cand[] {
    const cache = ancient ? this.ancientCells : this.treeCells;
    const key = cellKey(cx, cz);
    const hit = cache.get(key);
    if (hit) return hit;
    const layer: LayerId = ancient ? "ancient" : "tree";
    const cfg = LAYERS[layer];
    const out: Cand[] = [];
    const maxI = cfg.perCell / (cfg.cell * cfg.cell);
    for (let k = 0; k < cfg.perCell; k++) {
      const rng = mulberry32(cellSeed(this.layerSeed[layer], cx, cz, k + 1));
      const x = q3((cx + rng()) * cfg.cell);
      const z = q3((cz + rng()) * cfg.cell);
      const uAcc = rng();
      const uMark = rng();
      const uSp = rng();
      const uVar = rng();
      const uScale = rng();
      const uYaw = rng();
      if (!this.inRegion(x, z, 0.8)) continue;
      this.o.geometry.profileWeights(x, z, this.weights);
      const lambda = (this.mixDensity(ancient ? "ancient" : "tree") / 100) * this.cluster(layer, x, z);
      if (uAcc * maxI >= lambda) continue;
      const tan = this.slopeTan(x, z);
      if (uAcc * maxI >= lambda * (1 - smooth((tan - 0.25) / 0.28))) continue;

      let sp: Species;
      if (ancient) {
        sp = this.pickSpecies("ancient", uVar);
      } else {
        const h = this.o.terrain.height(x, z);
        const moist = this.moisture(x, z);
        const wB = this.mixed((p) => p.mix.tree.broadleaf) * (0.6 + 0.9 * moist);
        const wP = this.mixed((p) => p.mix.tree.pine) * Math.max(0.4, Math.min(1.8, 1 + 0.18 * h)) * (1.3 - 0.6 * moist);
        const group: SpeciesGroup = this.ext ? this.pickTreeGroup(uSp, wB, wP) : uSp * (wB + wP) < wB ? "broadleaf" : "pine";
        sp = this.pickSpecies(group, uVar);
      }
      const scale = q3(lerp(sp.scale[0], sp.scale[1], uScale));
      const collR = sp.collider! * scale;
      if (this.o.geometry.inKeepClear(x, z, collR)) continue;
      if (this.o.geometry.waterGap(x, z) < collR + 1.0) continue;
      if (this.o.geometry.trailGap(x, z) < collR + 0.9) continue;
      out.push({
        x,
        z,
        sp,
        scale,
        yaw: q3(uYaw * TWO_PI),
        mark: ancient ? uMark - 2 : uMark,
        r: sp.crown * scale,
        collR,
        seed: cellSeed(this.mushroomSeed, cx, cz, k + 1 + (ancient ? 100 : 0)),
      });
    }
    cache.set(key, out);
    return out;
  }

  /** Drzewa, które przeżyły rzadzenie i leżą w `area` (domknięty prostokąt). Okno kandydatów: `area` + 8 m. */
  private treesIn(area: Bounds): Cand[] {
    const win = expand(area, 8);
    const pool = new Grid(8);
    const all: Cand[] = [];
    const c = LAYERS.tree.cell;
    for (let iz = Math.floor(win.minZ / c); iz <= Math.floor(win.maxZ / c); iz++) {
      for (let ix = Math.floor(win.minX / c); ix <= Math.floor(win.maxX / c); ix++) {
        for (const cand of this.treeCell(ix, iz, false)) {
          if (inside(win, cand.x, cand.z)) {
            pool.add(cand);
            all.push(cand);
          }
        }
      }
    }
    const ca = LAYERS.ancient.cell;
    for (let iz = Math.floor(win.minZ / ca); iz <= Math.floor(win.maxZ / ca); iz++) {
      for (let ix = Math.floor(win.minX / ca); ix <= Math.floor(win.maxX / ca); ix++) {
        for (const cand of this.treeCell(ix, iz, true)) {
          if (inside(win, cand.x, cand.z)) {
            pool.add(cand);
            all.push(cand);
          }
        }
      }
    }
    const survivors: Cand[] = [];
    for (const cand of all) {
      if (!inside(area, cand.x, cand.z)) continue;
      let removed = false;
      pool.near(cand.x, cand.z, cand.r + 4.5, (other) => {
        if (other === cand || other.mark >= cand.mark) return;
        const dx = other.x - cand.x;
        const dz = other.z - cand.z;
        const rr = other.r + cand.r;
        if (dx * dx + dz * dz < rr * rr) {
          removed = true;
          return true;
        }
      });
      if (!removed) survivors.push(cand);
    }
    return survivors;
  }

  // ----- skały -----

  private rockCell(cx: number, cz: number): Cand[] {
    const key = cellKey(cx, cz);
    const hit = this.rockCells.get(key);
    if (hit) return hit;
    const cfg = LAYERS.rock;
    const out: Cand[] = [];
    const maxI = cfg.perCell / (cfg.cell * cfg.cell);
    const meanMembers = (cfg.members[0] + cfg.members[1]) / 2;
    const geo = this.o.geometry;
    for (let k = 0; k < cfg.perCell; k++) {
      const rng = mulberry32(cellSeed(this.layerSeed.rock, cx, cz, k + 1));
      const x0 = q3((cx + rng()) * cfg.cell);
      const z0 = q3((cz + rng()) * cfg.cell);
      const uAcc = rng();
      const uCount = rng();
      const uForm = this.ext ? rng() : 0;
      geo.profileWeights(x0, z0, this.weights);
      const lambda = (this.mixDensity("rock") / 100 / meanMembers) * this.cluster("rock", x0, z0);
      if (uAcc * maxI >= lambda * 4) continue;
      const lambdaSlope = lambda * (1 + Math.min(this.slopeTan(x0, z0), 0.65) * 4.5);
      if (uAcc * maxI >= lambdaSlope) continue;
      const count = cfg.members[0] + Math.floor(uCount * (cfg.members[1] - cfg.members[0] + 1));
      const rockTuning = this.ext ? this.o.tuning?.rocks : undefined;
      if (rockTuning && uForm < this.mixed((p) => p.pro?.formations ?? 0)) {
        this.pushFormation(out, cx, cz, k, x0, z0, rockTuning);
        continue;
      }
      let anchorClass = 2;
      for (let m = 0; m < count; m++) {
        const mr = mulberry32(cellSeed(this.layerSeed.rock, cx, cz, (k + 1) * 16 + m));
        let x = x0;
        let z = z0;
        if (m > 0) {
          const [dx, dz] = unitDisc(mr);
          x = q3(x0 + dx * cfg.spread);
          z = q3(z0 + dz * cfg.spread);
        }
        const uCls = mr();
        const uModel = mr();
        const uScale = mr();
        const ux = mr();
        const uy = mr();
        const uz = mr();
        const uYaw = mr();
        const uTx = mr();
        const uTz = mr();
        const uMark = mr();
        const uDesert = this.ext ? mr() : 0;
        if (!this.inRegion(x, z, 0.6)) continue;
        geo.profileWeights(x, z, this.weights);
        const cls = this.pickGroup(
          {
            s: this.mixed((p) => p.mix.rock.s),
            m: this.mixed((p) => p.mix.rock.m),
            l: this.mixed((p) => p.mix.rock.l),
          },
          uCls,
        );
        const clsIndex = Math.min(ROCK_CLASS_IDS.indexOf(cls), m === 0 ? 2 : anchorClass);
        if (m === 0) anchorClass = clsIndex;
        const rockClass = ROCK_CLASS_IDS[clsIndex];
        const sp = this.ext ? this.pickRockSpecies(rockClass, uModel, uDesert) : this.pickSpecies("rock", uModel);
        const base = lerp(ROCK_CLASSES[rockClass].scale[0], ROCK_CLASSES[rockClass].scale[1], uScale);
        const sx = q3(base * (1 + (ux * 2 - 1) * ROCK_JITTER.x));
        const sy = q3(base * (1 + (uy * 2 - 1) * ROCK_JITTER.y));
        const sz = q3(base * (1 + (uz * 2 - 1) * ROCK_JITTER.z));
        const collR = sp.collider! * ((sx + sz) / 2);
        if (geo.inKeepClear(x, z, collR)) continue;
        if (geo.waterGap(x, z) < collR + 0.2) continue;
        if (geo.trailGap(x, z) < collR + 0.6) continue;
        out.push({
          x,
          z,
          sp,
          scale: base,
          yaw: q3(uYaw * TWO_PI),
          mark: uMark,
          r: collR + 0.1,
          collR,
          scaleXYZ: [sx, sy, sz],
          tilt: [q3((uTx * 2 - 1) * ROCK_MAX_TILT), q3((uTz * 2 - 1) * ROCK_MAX_TILT)],
          rockClass,
          seed: 0,
        });
      }
    }
    this.rockCells.set(key, out);
    return out;
  }

  /**
   * Formacja skalna (tryb Pro): kotwica i 2-4 głazy stykające się z nią i ze sobą (odstęp = suma promieni kolizji + 0,3-1,1 m),
   * więc zwykłe rzadzenie Matérn zostawia całą grupę. Skład (zwykłe/pustynne) wg profilu w punkcie kotwicy.
   * Losowania są tylko z generatorów komórki, więc wynik nie zależy od okna ani kolejności sektorów.
   */
  private pushFormation(out: Cand[], cx: number, cz: number, k: number, x0: number, z0: number, t: ProRockTuning): void {
    const geo = this.o.geometry;
    const cr = mulberry32(cellSeed(this.layerSeed.rock, cx, cz, 4000 + k));
    const count = t.members[0] + Math.floor(cr() * (t.members[1] - t.members[0] + 1));
    const desert = this.mixed((p) => p.pro?.rockDesert ?? 0);
    let anchorR = 0;
    for (let m = 0; m < count; m++) {
      const mr = mulberry32(cellSeed(this.layerSeed.rock, cx, cz, 5000 + (k + 1) * 16 + m));
      const [dx, dz] = unitDisc(mr);
      const uSpecies = mr();
      const uBig = mr();
      const uScale = mr();
      const ux = mr();
      const uy = mr();
      const uz = mr();
      const uYaw = mr();
      const uTx = mr();
      const uTz = mr();
      const uMark = mr();
      const uDesert = mr();
      const uDist = mr();
      const big = m === 0 || uBig >= t.mediumShare;
      const isDesert = uDesert < desert;
      const group: SpeciesGroup = big ? (isDesert ? "rockbigdesert" : "rockbig") : isDesert ? "rockdesert" : "rock";
      const sp = this.pickSpecies(group, Math.min(0.999999, uSpecies));
      const base = m === 0 ? lerp(t.scale[0], t.scale[1], uScale) : lerp(t.scale[0] * 0.55, t.scale[1] * 0.8, uScale) * (big ? 1 : 0.9);
      const sx = q3(base * (1 + (ux * 2 - 1) * ROCK_JITTER.x));
      const sy = q3(base * (1 + (uy * 2 - 1) * ROCK_JITTER.y));
      const sz = q3(base * (1 + (uz * 2 - 1) * ROCK_JITTER.z));
      const collR = sp.collider! * ((sx + sz) / 2);
      let x = x0;
      let z = z0;
      if (m === 0) anchorR = collR;
      else {
        const len = Math.sqrt(dx * dx + dz * dz);
        const dist = anchorR + collR + 0.3 + uDist * 0.8;
        x = q3(x0 + (dx / len) * dist);
        z = q3(z0 + (dz / len) * dist);
      }
      if (!this.inRegion(x, z, 0.6)) continue;
      if (geo.inKeepClear(x, z, collR)) continue;
      if (geo.waterGap(x, z) < collR + 0.2) continue;
      if (geo.trailGap(x, z) < collR + 0.6) continue;
      out.push({
        x,
        z,
        sp,
        scale: base,
        yaw: q3(uYaw * TWO_PI),
        mark: uMark,
        r: collR + 0.1,
        collR,
        scaleXYZ: [sx, sy, sz],
        tilt: [q3((uTx * 2 - 1) * ROCK_MAX_TILT), q3((uTz * 2 - 1) * ROCK_MAX_TILT)],
        rockClass: "l",
        seed: 0,
      });
    }
  }

  /** Skały w `area` po rzadzeniu i usunięciu tych, które nachodzą na drzewa. Wymaga drzew z okna `area` + 4 m. */
  private rocksIn(area: Bounds, trees: Grid): Cand[] {
    const winMargin = this.ext ? Math.max(7.5, 2 * this.rockReach + 0.4) : 4.5;
    const win = expand(area, winMargin);
    // Formacja sięga do 2 promieni kolizji od kotwicy, więc komórki sprawdzamy odpowiednio dalej.
    const cwin = expand(area, this.ext ? winMargin + Math.max(3.5, 2 * this.rockReach + 1.6) : 8);
    const c = LAYERS.rock.cell;
    const pool = new Grid(8);
    const all: Cand[] = [];
    for (let iz = Math.floor(cwin.minZ / c); iz <= Math.floor(cwin.maxZ / c); iz++) {
      for (let ix = Math.floor(cwin.minX / c); ix <= Math.floor(cwin.maxX / c); ix++) {
        for (const cand of this.rockCell(ix, iz)) {
          if (inside(win, cand.x, cand.z)) {
            pool.add(cand);
            all.push(cand);
          }
        }
      }
    }
    const survivors: Cand[] = [];
    for (const cand of all) {
      if (!inside(area, cand.x, cand.z)) continue;
      let removed = false;
      pool.near(cand.x, cand.z, cand.collR + (this.ext ? this.rockReach + 0.3 : 2.3), (other) => {
        if (other === cand || other.mark >= cand.mark) return;
        const dx = other.x - cand.x;
        const dz = other.z - cand.z;
        const rr = other.collR + cand.collR + 0.2;
        if (dx * dx + dz * dz < rr * rr) {
          removed = true;
          return true;
        }
      });
      if (removed) continue;
      trees.near(cand.x, cand.z, cand.collR + 2.2, (t) => {
        const dx = t.x - cand.x;
        const dz = t.z - cand.z;
        const rr = t.collR + cand.collR + 0.4;
        if (dx * dx + dz * dz < rr * rr) {
          removed = true;
          return true;
        }
      });
      if (!removed) survivors.push(cand);
    }
    return survivors;
  }

  // ----- roślinność niska -----

  private groupWeights(layer: "bush" | "plant" | "grass"): Record<string, number> {
    switch (layer) {
      case "bush": {
        const rec: Record<string, number> = { plain: this.mixed((p) => p.mix.bush.plain), flowering: this.mixed((p) => p.mix.bush.flowering) };
        if (this.ext) {
          const big = this.mixed((p) => p.pro?.bush?.bushbig ?? 0);
          const long = this.mixed((p) => p.pro?.bush?.bushlong ?? 0);
          if (big > 0) rec.bushbig = big;
          if (long > 0) rec.bushlong = long;
        }
        return rec;
      }
      case "plant":
        return {
          leafy: this.mixed((p) => p.mix.plant.leafy),
          ground: this.mixed((p) => p.mix.plant.ground),
          clover: this.mixed((p) => p.mix.plant.clover),
        };
      case "grass": {
        const rec: Record<string, number> = { common: this.mixed((p) => p.mix.grass.common), wispy: this.mixed((p) => p.mix.grass.wispy) };
        if (this.ext) {
          const wide = this.mixed((p) => p.pro?.grass?.wide ?? 0);
          const wheat = this.mixed((p) => p.pro?.grass?.wheat ?? 0);
          if (wide > 0) rec.wide = wide;
          if (wheat > 0) rec.wheat = wheat;
        }
        return rec;
      }
    }
  }

  /**
   * Kandydaci warstw niskich (krzewy, paprocie, runo, trawa, kwiaty) w `area`, po akceptacji gęstości i wykluczeniach
   * terenowych (woda, ścieżki, polany), ale przed zderzeniem z drzewami i skałami.
   */
  private smallCandidates(layer: "bush" | "fern" | "plant" | "grass" | "flower", area: Bounds): Cand[] {
    // Tryb Pro: trawa w zwartych kępach (Preview_1/2) zamiast pojedynczych kępek.
    const clump = layer === "grass" && this.ext ? (this.o.tuning?.grass ?? null) : null;
    const cfg: LayerConfig = clump ? { cell: clump.cell, perCell: clump.perCell, members: clump.members, spread: clump.spread } : LAYERS[layer];
    const geo = this.o.geometry;
    const out: Cand[] = [];
    const maxI = cfg.perCell / (cfg.cell * cfg.cell);
    const meanMembers = (cfg.members[0] + cfg.members[1]) / 2;
    const win = expand(area, cfg.spread);
    const clusterLayer = layer;
    const envMax = layer === "fern" ? 2 : layer === "grass" ? 1.25 : layer === "flower" ? 1.2 : 1;
    for (let iz = Math.floor(win.minZ / cfg.cell); iz <= Math.floor(win.maxZ / cfg.cell); iz++) {
      for (let ix = Math.floor(win.minX / cfg.cell); ix <= Math.floor(win.maxX / cfg.cell); ix++) {
        for (let k = 0; k < cfg.perCell; k++) {
          const rng = mulberry32(cellSeed(this.layerSeed[layer], ix, iz, k + 1));
          const x0 = q3((ix + rng()) * cfg.cell);
          const z0 = q3((iz + rng()) * cfg.cell);
          const uAcc = rng();
          const uCount = rng();
          const uDominant = clump ? rng() : 0;
          if (!inside(win, x0, z0)) continue;
          geo.profileWeights(x0, z0, this.weights);
          const lambda = (this.mixDensity(layer) / 100 / meanMembers) * this.cluster(clusterLayer, x0, z0, clump?.cluster);
          if (uAcc * maxI >= lambda * envMax) continue;
          let env = 1;
          if (layer === "fern") env = 0.4 + 1.6 * this.moisture(x0, z0);
          else if (layer === "grass") env = 1.25 - 0.5 * this.moisture(x0, z0);
          else if (layer === "flower") env = 1.2 - 0.4 * this.moisture(x0, z0);
          else if (layer === "bush") env = 1 - smooth((this.slopeTan(x0, z0) - 0.45) / 0.3);
          if (uAcc * maxI >= lambda * env) continue;
          const count = cfg.members[0] + Math.floor(uCount * (cfg.members[1] - cfg.members[0] + 1));
          // Gatunek dominujący kępy: z wag profilu w środku kępy (wagi są ustawione powyżej, przed pętlą członków).
          const dominantGroup = clump ? (this.pickGroup(this.groupWeights("grass"), uDominant) as SpeciesGroup) : null;
          for (let m = 0; m < count; m++) {
            const mr = mulberry32(cellSeed(this.layerSeed[layer], ix, iz, (k + 1) * 16 + m));
            let x = x0;
            let z = z0;
            if (cfg.spread > 0) {
              const [dx, dz] = unitDisc(mr);
              x = q3(x0 + dx * cfg.spread);
              z = q3(z0 + dz * cfg.spread);
            }
            const uVar = mr();
            const uGroup = mr();
            const uScale = mr();
            const uYaw = mr();
            const uMark = mr();
            if (!inside(area, x, z) || !this.inRegion(x, z, 0.25)) continue;
            let sp: Species;
            if (layer === "fern") {
              sp = this.pickSpecies("fern", uVar);
            } else if (layer === "flower") {
              sp = this.pickSpecies("flower", uVar);
            } else {
              geo.profileWeights(x, z, this.weights);
              let group: SpeciesGroup;
              if (clump && dominantGroup !== null) {
                group =
                  uGroup < clump.dominant
                    ? dominantGroup
                    : (this.pickGroup(this.groupWeights(layer), Math.min(0.999999, (uGroup - clump.dominant) / (1 - clump.dominant))) as SpeciesGroup);
              } else group = this.pickGroup(this.groupWeights(layer), uGroup) as SpeciesGroup;
              sp = this.pickSpecies(group, uVar);
            }
            const scale = q3(lerp(sp.scale[0], sp.scale[1], uScale) * (clump ? clump.scale : 1) * (layer === "flower" && this.ext ? (this.o.tuning?.flowerScale ?? 1) : 1));
            const water = geo.waterGap(x, z);
            const trail = geo.trailGap(x, z);
            if (layer === "bush") {
              if (water < 0.3 + sp.footprint * scale * 0.5 || trail < 0.5 || geo.inKeepClear(x, z, 0.5)) continue;
            } else if (layer === "fern") {
              if (water < 0.3 || trail < 0.15) continue;
            } else if (layer === "plant") {
              if (water < 0.2 || trail < 0) continue;
            } else if (layer === "grass") {
              // Trawa nie rośnie na ścieżce (Pro: także na jej krawędzi); zwykły generator zachowuje dawny margines.
              if (water < 0.1 || trail < (this.ext ? 0.05 : -0.1)) continue;
            } else if (water < 0.3 || trail < 0.1) continue;
            out.push({ x, z, sp, scale, yaw: q3(uYaw * TWO_PI), mark: uMark, r: layer === "bush" ? sp.crown * scale : 0, collR: 0, seed: 0 });
          }
        }
      }
    }
    return out;
  }

  /** Kępy grzybów u podstawy drzew (jedna decyzja na drzewo, z jego własnego ziarna). */
  private mushrooms(trees: readonly Cand[], area: Bounds): Cand[] {
    const out: Cand[] = [];
    const geo = this.o.geometry;
    const cfg = LAYERS.mushroom;
    for (const t of trees) {
      if (!inside(area, t.x, t.z)) continue;
      geo.profileWeights(t.x, t.z, this.weights);
      const moist = this.moisture(t.x, t.z);
      const species = t.sp.group === "ancient" ? 2 : t.sp.group === "pine" ? 0.7 : 1;
      const chance = this.mixed((p) => p.mushroomChance) * (0.4 + 1.2 * moist) * species;
      const rng = mulberry32(t.seed);
      if (rng() >= chance) continue;
      const count = cfg.members[0] + Math.floor(rng() * (cfg.members[1] - cfg.members[0] + 1));
      const [ax, az] = unitDisc(rng);
      const al = Math.sqrt(ax * ax + az * az);
      const cxd = ax / al;
      const czd = az / al;
      const dist0 = t.collR + 0.5 + rng() * 0.6;
      let sp = this.pickSpecies("mushroom", 0);
      if (this.ext) {
        const g = this.pickGroup(this.mushroomWeights(), rng()) as SpeciesGroup;
        sp = this.pickSpecies(g, rng());
      }
      for (let m = 0; m < count; m++) {
        const [dx, dz] = unitDisc(rng);
        const uScale = rng();
        const uYaw = rng();
        const x = q3(t.x + cxd * dist0 + dx * 0.55);
        const z = q3(t.z + czd * dist0 + dz * 0.55);
        if (!this.inRegion(x, z, 0.25) || geo.waterGap(x, z) < 0.5 || geo.trailGap(x, z) < 0.3) continue;
        const scale = q3(lerp(sp.scale[0], sp.scale[1], uScale));
        out.push({ x, z, sp, scale, yaw: q3(uYaw * TWO_PI), mark: 0, r: 0, collR: 0, seed: 0 });
      }
    }
    return out;
  }

  /** Bruk drogi (tryb Pro): liczony raz dla całej drogi, potem filtrowany per sektor. */
  private pavingItems(): readonly Cand[] {
    if (this.pavingCache) return this.pavingCache;
    const opts = this.o.paving;
    const trail = opts ? this.o.geometry.trails.find((t) => t.id === opts.trailId) : undefined;
    const slabs = this.speciesByGroup.get("rockpath") ?? [];
    const pebbles = this.speciesByGroup.get("pebble") ?? [];
    this.pavingCache =
      opts && trail
        ? buildPaving(trail.points, opts, slabs, pebbles, this.pavingSeed).map((it) => ({
            x: it.x,
            z: it.z,
            sp: it.sp,
            scale: it.scale,
            yaw: it.yaw,
            mark: 0,
            r: 0,
            collR: 0,
            seed: 0,
          }))
        : [];
    return this.pavingCache;
  }

  /** Płatki pod drzewami kwitnącymi (tryb Pro): kępa wokół pnia, deterministyczna z pozycji drzewa. */
  private petals(trees: readonly Cand[], area: Bounds): Cand[] {
    const out: Cand[] = [];
    const geo = this.o.geometry;
    const list = this.speciesByGroup.get("petal");
    if (!list) return out;
    for (const t of trees) {
      if (t.sp.group !== "blossom" || !inside(area, t.x, t.z)) continue;
      geo.profileWeights(t.x, t.z, this.weights);
      const chance = this.mixed((p) => p.pro?.petals ?? 0);
      const rng = mulberry32(cellSeed(this.decorSeed, Math.round(t.x * 10), Math.round(t.z * 10), 1));
      if (rng() >= chance) continue;
      const count = 8 + Math.floor(rng() * 9);
      const reach = t.sp.crown * t.scale * 1.5;
      for (let m = 0; m < count; m++) {
        const [dx, dz] = unitDisc(rng);
        const uVar = rng();
        const uScale = rng();
        const uYaw = rng();
        const x = q3(t.x + dx * reach);
        const z = q3(t.z + dz * reach);
        // sqrt zamiast hypot: wynik sqrt jest dokładnie określony w każdym silniku JS (test determinizmu zabrania hypot).
        if (Math.sqrt(dx * dx * reach * reach + dz * dz * reach * reach) < t.collR + 0.25) continue;
        if (!this.inRegion(x, z, 0.25) || geo.waterGap(x, z) < 0.2 || geo.trailGap(x, z) < 0.1) continue;
        const sp = list[Math.min(list.length - 1, Math.floor(uVar * list.length))];
        out.push({ x, z, sp, scale: q3(lerp(0.8, 1.2, uScale)), yaw: q3(uYaw * TWO_PI), mark: 0, r: 0, collR: 0, seed: 0 });
      }
    }
    return out;
  }

  /** Kamyki wokół skał (tryb Pro): kępa przy podstawie skały, deterministyczna z pozycji skały. */
  private pebbles(rocks: readonly Cand[], area: Bounds): Cand[] {
    const out: Cand[] = [];
    const geo = this.o.geometry;
    const list = this.speciesByGroup.get("pebble");
    if (!list) return out;
    for (const r of rocks) {
      if (!inside(area, r.x, r.z)) continue;
      geo.profileWeights(r.x, r.z, this.weights);
      const chance = this.mixed((p) => p.pro?.pebbles ?? 0);
      const rng = mulberry32(cellSeed(this.decorSeed, Math.round(r.x * 10), Math.round(r.z * 10), 2));
      if (rng() >= chance) continue;
      const count = 3 + Math.floor(rng() * 6);
      for (let m = 0; m < count; m++) {
        const [ax, az] = unitDisc(rng);
        const al = Math.sqrt(ax * ax + az * az);
        const dist = r.collR * 0.9 + 0.25 + rng() * 1.8;
        const uVar = rng();
        const uScale = rng();
        const uYaw = rng();
        const x = q3(r.x + (ax / al) * dist);
        const z = q3(r.z + (az / al) * dist);
        if (!this.inRegion(x, z, 0.25) || geo.waterGap(x, z) < 0.2 || geo.trailGap(x, z) < 0.3) continue;
        const sp = list[Math.min(list.length - 1, Math.floor(uVar * list.length))];
        out.push({ x, z, sp, scale: q3(lerp(0.7, 1.6, uScale)), yaw: q3(uYaw * TWO_PI), mark: 0, r: 0, collR: 0, seed: 0 });
      }
    }
    return out;
  }

  /** Obiekty sektora (ix, iz): wszystkie, których pozycja należy do tego sektora wg `sectorOf`. */
  generate(ix: number, iz: number): WorldObject[] {
    const region = this.o.region;
    const B = sectorBounds(region, ix, iz);
    const own = (x: number, z: number) => {
      const s = region.sectorSize;
      const sx = Math.min(this.nx - 1, Math.floor((x - region.bounds.minX) / s));
      const sz = Math.min(this.nz - 1, Math.floor((z - region.bounds.minZ) / s));
      return sx === ix && sz === iz;
    };
    const halo = this.halo;
    // Tryb Pro: większe okna, bo głazy Rock_Big (promień kolizji do 3,2 m) i korony Pro (do 4,3 m) sięgają dalej niż w v2.
    const treeList = this.treesIn(expand(B, 8 + halo + (this.ext ? 6 : 0)));
    const treeGrid = new Grid(8);
    for (const t of treeList) treeGrid.add(t);
    const rockList = this.rocksIn(expand(B, 3 + halo + (this.ext ? 4 : 0)), treeGrid);
    const rockGrid = new Grid(8);
    for (const r of rockList) rockGrid.add(r);

    const blocked = (c: Cand, radius: number): boolean => {
      let hit = false;
      const test = (b: Cand) => {
        const dx = b.x - c.x;
        const dz = b.z - c.z;
        const rr = b.collR + radius + 0.1;
        if (dx * dx + dz * dz < rr * rr) {
          hit = true;
          return true;
        }
      };
      treeGrid.near(c.x, c.z, radius + 1.4, test);
      if (!hit) rockGrid.near(c.x, c.z, radius + (this.ext ? this.rockReach + 0.2 : 2.0), test);
      return hit;
    };

    const drafts: Draft[] = [];
    for (const t of treeList) if (own(t.x, t.z)) drafts.push({ c: t, kind: t.sp.kind });
    for (const r of rockList) if (own(r.x, r.z)) drafts.push({ c: r, kind: "rock" });

    // Warstwa kosmetyczna (nie wchodzi do odcisku świata): tryb `gameplay` ją pomija, a ID i wyniki drzew i skał zostają
    // bez zmian, bo ID są numerowane osobno dla każdego rodzaju, a kandydaci kosmetyczni zależą od drzew i skał, nie odwrotnie.
    if (this.o.layers !== "gameplay") {
      const area = expand(B, 2.6 + halo);
      const bushPool = new Grid(4);
      const bushes = this.smallCandidates("bush", expand(B, 2.5 + halo));
      for (const b of bushes) bushPool.add(b);
      for (const b of bushes) {
        if (!own(b.x, b.z)) continue;
        let removed = false;
        bushPool.near(b.x, b.z, b.r + 1.4, (o) => {
          if (o === b || o.mark >= b.mark) return;
          const dx = o.x - b.x;
          const dz = o.z - b.z;
          const rr = o.r + b.r;
          if (dx * dx + dz * dz < rr * rr) {
            removed = true;
            return true;
          }
        });
        if (!removed && !blocked(b, b.sp.footprint * b.scale * 0.45)) drafts.push({ c: b, kind: "bush" });
      }
      for (const layer of ["fern", "plant", "grass"] as const) {
        for (const c of this.smallCandidates(layer, B)) {
          if (!own(c.x, c.z)) continue;
          if (!blocked(c, c.sp.footprint * c.scale * 0.3)) drafts.push({ c, kind: c.sp.kind });
        }
      }
      for (const c of this.smallCandidates("flower", B)) {
        if (own(c.x, c.z) && !blocked(c, c.sp.footprint * c.scale * 0.3)) drafts.push({ c, kind: c.sp.kind });
      }
      for (const c of this.mushrooms(treeList, area)) {
        if (own(c.x, c.z) && !blocked(c, c.sp.footprint * c.scale * 0.3)) drafts.push({ c, kind: "mushroom" });
      }
      if (this.ext) {
        for (const c of this.petals(treeList, area)) if (own(c.x, c.z)) drafts.push({ c, kind: c.sp.kind });
        for (const c of this.pebbles(rockList, area)) if (own(c.x, c.z)) drafts.push({ c, kind: c.sp.kind });
        for (const c of this.pavingItems()) if (own(c.x, c.z)) drafts.push({ c, kind: c.sp.kind });
      }
    }

    const byKind = new Map<string, Draft[]>();
    for (const d of drafts) {
      const list = byKind.get(d.kind);
      if (list) list.push(d);
      else byKind.set(d.kind, [d]);
    }
    const out: WorldObject[] = [];
    const kinds = [...byKind.keys()].sort();
    for (const kind of kinds) {
      const list = byKind.get(kind)!;
      list.sort((a, b) => a.c.x - b.c.x || a.c.z - b.c.z || (a.c.sp.model < b.c.sp.model ? -1 : 1));
      list.forEach((d, i) => out.push(this.toObject(d, ix, iz, i + 1)));
    }
    return out;
  }

  private toObject(d: Draft, ix: number, iz: number, n: number): WorldObject {
    const { c } = d;
    const sp = c.sp;
    const y = q4(this.o.terrain.height(c.x, c.z));
    const base = {
      id: objectId(d.kind, this.o.region, ix, iz, n),
      kind: d.kind,
      variant: sp.variant,
      x: c.x,
      z: c.z,
      y,
      yaw: c.yaw,
    };
    if (c.scaleXYZ) {
      const collider = { shape: "circle", r: q3(c.collR) } as const;
      const rock = this.o.rockPhysics ? buildRockProfile({ kind: d.kind, variant: sp.variant, scaleXYZ: c.scaleXYZ, yaw: c.yaw, tilt: c.tilt, collider }) : null;
      return makeObject({
        ...base,
        scaleXYZ: c.scaleXYZ,
        tilt: c.tilt,
        collider,
        ...(rock ? { rock } : {}),
        tags: [`size_${c.rockClass}`],
        radius: sp.footprint * Math.max(...c.scaleXYZ),
      });
    }
    if (sp.collider !== null) {
      return makeObject({ ...base, scale: c.scale, collider: { shape: "circle", r: q3(c.collR) }, radius: sp.footprint * c.scale });
    }
    return makeObject({ ...base, scale: c.scale, radius: q3(sp.footprint * c.scale) });
  }
}
