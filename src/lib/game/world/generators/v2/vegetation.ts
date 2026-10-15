import { mulberry32, streamSeed, type Rng } from "../../../core/rng";
import { objectId, sectorBounds, sectorCount, type Bounds, type RegionDef } from "../../bounds";
import { valueNoise2 } from "../../noise";
import { makeObject, type WorldObject } from "../../objects";
import type { HeightField } from "../../terrain";
import type { ForestGeometry } from "./geometry";
import type { DensityLayer, EnvironmentProfile, ProfileTable } from "./profiles";
import {
  ROCK_CLASSES,
  ROCK_CLASS_IDS,
  ROCK_JITTER,
  ROCK_MAX_TILT,
  SPECIES,
  speciesOfGroup,
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
};

type Draft = { c: Cand; kind: string };

export class VegetationGenerator {
  private readonly layerSeed: Record<string, number> = {};
  private readonly noiseSeed: Record<string, [number, number]> = {};
  private readonly moistSeed: number;
  private readonly mushroomSeed: number;
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
    this.weights = new Float64Array(o.geometry.weightCount);
    this.halo = o.halo ?? 0;
    const { nx, nz } = sectorCount(o.region);
    this.nx = nx;
    this.nz = nz;
    this.profiles = o.geometry.weightProfiles;
    for (const sp of SPECIES) {
      if (!this.speciesByGroup.has(sp.group)) this.speciesByGroup.set(sp.group, speciesOfGroup(sp.group));
    }
  }

  /** Czyści pamięć podręczną komórek (wynik się nie zmienia, tylko jest liczony od nowa). */
  clearCache(): void {
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

  private cluster(layer: keyof typeof CLUSTER, x: number, z: number): number {
    const c = CLUSTER[layer];
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
        sp = this.pickSpecies(uSp * (wB + wP) < wB ? "broadleaf" : "pine", uVar);
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
      geo.profileWeights(x0, z0, this.weights);
      const lambda = (this.mixDensity("rock") / 100 / meanMembers) * this.cluster("rock", x0, z0);
      if (uAcc * maxI >= lambda * 4) continue;
      const lambdaSlope = lambda * (1 + Math.min(this.slopeTan(x0, z0), 0.65) * 4.5);
      if (uAcc * maxI >= lambdaSlope) continue;
      const count = cfg.members[0] + Math.floor(uCount * (cfg.members[1] - cfg.members[0] + 1));
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
        const sp = this.pickSpecies("rock", uModel);
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

  /** Skały w `area` po rzadzeniu i usunięciu tych, które nachodzą na drzewa. Wymaga drzew z okna `area` + 4 m. */
  private rocksIn(area: Bounds, trees: Grid): Cand[] {
    const win = expand(area, 4.5);
    const cwin = expand(area, 8);
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
      pool.near(cand.x, cand.z, cand.collR + 2.3, (other) => {
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
      case "bush":
        return { plain: this.mixed((p) => p.mix.bush.plain), flowering: this.mixed((p) => p.mix.bush.flowering) };
      case "plant":
        return {
          leafy: this.mixed((p) => p.mix.plant.leafy),
          ground: this.mixed((p) => p.mix.plant.ground),
          clover: this.mixed((p) => p.mix.plant.clover),
        };
      case "grass":
        return { common: this.mixed((p) => p.mix.grass.common), wispy: this.mixed((p) => p.mix.grass.wispy) };
    }
  }

  /**
   * Kandydaci warstw niskich (krzewy, paprocie, runo, trawa, kwiaty) w `area`, po akceptacji gęstości i wykluczeniach
   * terenowych (woda, ścieżki, polany), ale przed zderzeniem z drzewami i skałami.
   */
  private smallCandidates(layer: "bush" | "fern" | "plant" | "grass" | "flower", area: Bounds): Cand[] {
    const cfg = LAYERS[layer];
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
          if (!inside(win, x0, z0)) continue;
          geo.profileWeights(x0, z0, this.weights);
          const lambda = (this.mixDensity(layer) / 100 / meanMembers) * this.cluster(clusterLayer, x0, z0);
          if (uAcc * maxI >= lambda * envMax) continue;
          let env = 1;
          if (layer === "fern") env = 0.4 + 1.6 * this.moisture(x0, z0);
          else if (layer === "grass") env = 1.25 - 0.5 * this.moisture(x0, z0);
          else if (layer === "flower") env = 1.2 - 0.4 * this.moisture(x0, z0);
          else if (layer === "bush") env = 1 - smooth((this.slopeTan(x0, z0) - 0.45) / 0.3);
          if (uAcc * maxI >= lambda * env) continue;
          const count = cfg.members[0] + Math.floor(uCount * (cfg.members[1] - cfg.members[0] + 1));
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
              sp = this.pickSpecies(this.pickGroup(this.groupWeights(layer), uGroup) as SpeciesGroup, uVar);
            }
            const scale = q3(lerp(sp.scale[0], sp.scale[1], uScale));
            const water = geo.waterGap(x, z);
            const trail = geo.trailGap(x, z);
            if (layer === "bush") {
              if (water < 0.3 + sp.footprint * scale * 0.5 || trail < 0.5 || geo.inKeepClear(x, z, 0.5)) continue;
            } else if (layer === "fern") {
              if (water < 0.3 || trail < 0.15) continue;
            } else if (layer === "plant") {
              if (water < 0.2 || trail < 0) continue;
            } else if (layer === "grass") {
              if (water < 0.1 || trail < -0.1) continue;
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
      const sp = this.pickSpecies("mushroom", 0);
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
    const treeList = this.treesIn(expand(B, 8 + halo));
    const treeGrid = new Grid(8);
    for (const t of treeList) treeGrid.add(t);
    const rockList = this.rocksIn(expand(B, 3 + halo), treeGrid);
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
      if (!hit) rockGrid.near(c.x, c.z, radius + 2.0, test);
      return hit;
    };

    const drafts: Draft[] = [];
    for (const t of treeList) if (own(t.x, t.z)) drafts.push({ c: t, kind: t.sp.kind });
    for (const r of rockList) if (own(r.x, r.z)) drafts.push({ c: r, kind: "rock" });

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
      return makeObject({
        ...base,
        scaleXYZ: c.scaleXYZ,
        tilt: c.tilt,
        collider: { shape: "circle", r: q3(c.collR) },
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
