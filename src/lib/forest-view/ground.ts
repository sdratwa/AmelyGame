import type { Bounds } from "@/lib/game/world/bounds";
import { PRO_GROUND, SPECIES_ALL_BY_MODEL as SPECIES_BY_MODEL, type ForestWorld } from "@/lib/game/world/generators/v2";
import type { RiverRequest } from "@/lib/game/world/pipeline";
import type { HeightField } from "@/lib/game/world/terrain";
import type { WorldObject } from "@/lib/game/world/objects";

export type GroundMeshData = {
  /** Tryb Pro: waga pustyni w wierzchołkach (atrybut `aDesert` shadera gruntu: fale piasku); brak poza trybem Pro. */
  desert?: Float32Array;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
};

/** Siatka gruntu okna: wysokości z `terrain.height`, normalne z `terrain.normal` (ten sam teren co kolizje W0). */
export function buildGroundMesh(terrain: HeightField, bounds: Bounds, cell: number, desertAt?: (x: number, z: number) => number): GroundMeshData {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxZ - bounds.minZ;
  const nx = Math.max(1, Math.round(w / cell));
  const nz = Math.max(1, Math.round(h / cell));
  const vx = nx + 1;
  const vz = nz + 1;
  const positions = new Float32Array(vx * vz * 3);
  const normals = new Float32Array(vx * vz * 3);
  const uvs = new Float32Array(vx * vz * 2);
  const desert = desertAt ? new Float32Array(vx * vz) : undefined;
  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const x = bounds.minX + (w * i) / nx;
      const z = bounds.minZ + (h * j) / nz;
      const k = j * vx + i;
      positions[k * 3] = x;
      positions[k * 3 + 1] = terrain.height(x, z);
      positions[k * 3 + 2] = z;
      const n = terrain.normal(x, z);
      normals[k * 3] = n.x;
      normals[k * 3 + 1] = n.y;
      normals[k * 3 + 2] = n.z;
      uvs[k * 2] = i / nx;
      uvs[k * 2 + 1] = j / nz;
      if (desert && desertAt) desert[k] = desertAt(x, z);
    }
  }
  const indices = new Uint32Array(nx * nz * 6);
  let t = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * vx + i;
      const b = a + 1;
      const c = a + vx;
      const d = c + 1;
      indices[t++] = a;
      indices[t++] = c;
      indices[t++] = b;
      indices[t++] = b;
      indices[t++] = c;
      indices[t++] = d;
    }
  }
  return { desert, positions, normals, uvs, indices, vertexCount: vx * vz, triangleCount: nx * nz * 2 };
}

/** Wstęga lustra wody w obrębie okna (jeśli rzeka je przecina). Poziom wody = dno koryta + głębokość z planu. */
export function buildWaterMesh(forest: ForestWorld, bounds: Bounds): GroundMeshData | null {
  const river = forest.plan.terrain.find((r): r is RiverRequest => r.kind === "river");
  if (!river) return null;
  const pad = 4;
  const zs: number[] = [];
  for (let z = Math.floor(bounds.minZ / 2) * 2; z <= bounds.maxZ + 2; z += 2) zs.push(z);
  const rows = zs.filter((z) => {
    const r = forest.geometry.riverAt(z);
    return r.x + r.w + pad > bounds.minX && r.x - r.w - pad < bounds.maxX;
  });
  if (rows.length < 2) return null;
  const positions = new Float32Array(rows.length * 2 * 3);
  const normals = new Float32Array(rows.length * 2 * 3);
  const uvs = new Float32Array(rows.length * 2 * 2);
  rows.forEach((z, i) => {
    const r = forest.geometry.riverAt(z);
    const y = forest.terrain.height(r.x, z) + river.depth - 0.1;
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      positions[k * 3] = r.x + (s === 0 ? -1 : 1) * (r.w + 0.6);
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      normals[k * 3 + 1] = 1;
      uvs[k * 2] = s;
      uvs[k * 2 + 1] = z * 0.12;
    }
  });
  const indices = new Uint32Array((rows.length - 1) * 6);
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = i * 2;
    indices.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6);
  }
  return { positions, normals, uvs, indices, vertexCount: rows.length * 2, triangleCount: (rows.length - 1) * 2 };
}

export type GroundTexture = { data: Uint8Array; size: number; metersPerPixel: number };

/** Szum wartości na siatce całkowitej (bez Math.random): deterministyczny, gładki, [0, 1). */
function lattice(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iz, seed);
  const b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed);
  const d = lattice(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mixN = (a: number, b: number, t: number) => a + (b - a) * t;

type Rgb = readonly [number, number, number];
const GRASS_DARK: Rgb = [52, 88, 38];
const GRASS_LUSH: Rgb = [88, 128, 46];
const GRASS_SUN: Rgb = [126, 144, 62];
const MOSS: Rgb = [66, 92, 52];
const LITTER_A: Rgb = [118, 88, 52];
const LITTER_B: Rgb = [84, 62, 40];
const DIRT_A: Rgb = [156, 122, 80];
const DIRT_B: Rgb = [128, 98, 64];
const PEBBLE: Rgb = [176, 168, 152];
const MUD: Rgb = [66, 54, 42];
const GRAVEL: Rgb = [138, 128, 104];
const EARTH: Rgb = [102, 88, 68];

const lerp3 = (a: Rgb, b: Rgb, t: number): [number, number, number] => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];

const N_GRASS_DARK: Rgb = [58, 82, 46];
const N_GRASS_LUSH: Rgb = [92, 118, 54];
const N_GRASS_SUN: Rgb = [128, 138, 70];
const N_GRASS_DRY: Rgb = [138, 128, 78];
const N_MOSS: Rgb = [60, 88, 56];
const N_LITTER_A: Rgb = [126, 94, 58];
const N_LITTER_B: Rgb = [88, 66, 44];
const N_NEEDLES: Rgb = [140, 104, 60];
const N_EARTH: Rgb = [110, 92, 70];
const N_PATH_A: Rgb = [166, 130, 90];
const N_PATH_B: Rgb = [136, 104, 70];
const N_TROD: Rgb = [112, 98, 62];
const FLECKS: readonly Rgb[] = [
  [182, 132, 56],
  [118, 74, 42],
  [154, 150, 66],
  [96, 56, 34],
];

// Paleta prototypu Pro (strefy A: jesień, C: pustynia; brukowana droga). Używana tylko, gdy w świecie są profile `pro_*`.
const AUTUMN_GRASS: Rgb = [150, 136, 58];
const AUTUMN_LEAVES: Rgb = [166, 96, 40];
// Piasek jaśniejszy i cieplejszy niż wcześniej (Preview_3); cienie fal i pęknięć dorysowuje shader gruntu.
const DESERT_SAND: Rgb = [228, 200, 148];
const DESERT_DARK: Rgb = [198, 162, 110];
const PAVE_A: Rgb = [128, 124, 114];
const PAVE_B: Rgb = [156, 150, 138];

const FIELD_CELL = 0.5;

type Fields = {
  n: number;
  trail: Float32Array;
  water: Float32Array;
  slope: Float32Array;
  clearing: Float32Array;
  dense: Float32Array;
  sunny: Float32Array;
  riverside: Float32Array;
  /** Wagi stref prototypu Pro (jesienna, pustynna); zera poza trybem Pro. */
  autumn: Float32Array;
  desert: Float32Array;
  /** Czy świat ma profile `pro_*` (wtedy działa paleta Pro i malowanie bruku). */
  pro: boolean;
};

type FieldBuilder = { fields: Fields; step: (rows: number) => boolean };

/** Pola strefowe (ścieżka, woda, zbocze, profile roślinności) próbkowane co `FIELD_CELL`; liczone porcjami wierszy. */
function createFieldBuilder(forest: ForestWorld, bounds: Bounds): FieldBuilder {
  const n = Math.ceil((bounds.maxX - bounds.minX) / FIELD_CELL) + 1;
  const total = n * n;
  const f: Fields = {
    n,
    trail: new Float32Array(total),
    water: new Float32Array(total),
    slope: new Float32Array(total),
    clearing: new Float32Array(total),
    dense: new Float32Array(total),
    sunny: new Float32Array(total),
    riverside: new Float32Array(total),
    autumn: new Float32Array(total),
    desert: new Float32Array(total),
    pro: false,
  };
  const geo = forest.geometry;
  const w = new Float64Array(geo.weightCount);
  const ids = geo.weightProfiles.map((p) => p.id);
  f.pro = ids.some((id) => id.startsWith("pro_"));
  let j = 0;
  const fillRow = (row: number) => {
    for (let i = 0; i < n; i++) {
      const x = bounds.minX + i * FIELD_CELL;
      const z = bounds.minZ + row * FIELD_CELL;
      const k = row * n + i;
      f.trail[k] = Math.min(geo.trailGap(x, z), 8);
      f.water[k] = Math.min(geo.waterGap(x, z), 10);
      const g = forest.terrain.gradient(x, z);
      f.slope[k] = Math.sqrt(g.dx * g.dx + g.dz * g.dz);
      geo.profileWeights(x, z, w);
      for (let p = 0; p < ids.length; p++) {
        if (ids[p] === "clearing") f.clearing[k] += w[p];
        else if (ids[p] === "dense_forest") f.dense[k] += w[p];
        else if (ids[p] === "sunny_forest") f.sunny[k] += w[p];
        else if (ids[p] === "riverside") f.riverside[k] += w[p];
        else if (ids[p] === "pro_conifer") f.dense[k] += w[p] * 0.9;
        else if (ids[p] === "pro_autumn") {
          f.autumn[k] += w[p];
          f.sunny[k] += w[p] * 0.7;
        } else if (ids[p] === "pro_desert") {
          f.desert[k] += w[p];
          f.sunny[k] += w[p] * 0.6;
        }
      }
    }
  };
  return {
    fields: f,
    step(rows) {
      const end = Math.min(n, j + rows);
      while (j < end) fillRow(j++);
      return j >= n;
    },
  };
}

function sampleField(arr: Float32Array, n: number, fx: number, fz: number): number {
  const i = Math.min(n - 2, Math.max(0, Math.floor(fx)));
  const j = Math.min(n - 2, Math.max(0, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - i));
  const tz = Math.min(1, Math.max(0, fz - j));
  const a = arr[j * n + i];
  const b = arr[j * n + i + 1];
  const c = arr[(j + 1) * n + i];
  const d = arr[(j + 1) * n + i + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

type Brushes = { litter: Uint8Array; shade: Uint8Array; needles: Uint8Array; paved: Uint8Array };

/** Malowanie pędzlami pod obiektami: ściółka i cień pod koronami, ciemny kontakt przy skałach i krzewach (wtopienie w grunt). */
function paintBrushes(objects: readonly WorldObject[], bounds: Bounds, size: number, mpp: number, seed: number): Brushes {
  const litter = new Uint8Array(size * size);
  const shade = new Uint8Array(size * size);
  const needles = new Uint8Array(size * size);
  const paved = new Uint8Array(size * size);
  const stamp = (target: Uint8Array, cx: number, cz: number, radius: number, power: number, strength: number, dapple: number) => {
    const px = (cx - bounds.minX) / mpp;
    const pz = (cz - bounds.minZ) / mpp;
    const r = radius / mpp;
    const x0 = Math.max(0, Math.floor(px - r));
    const x1 = Math.min(size - 1, Math.ceil(px + r));
    const z0 = Math.max(0, Math.floor(pz - r));
    const z1 = Math.min(size - 1, Math.ceil(pz + r));
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.sqrt((i - px) ** 2 + (j - pz) ** 2) / r;
        if (d >= 1) continue;
        let v = (1 - d) ** power * strength;
        if (dapple > 0) v *= 1 - dapple + dapple * vnoise(i * mpp * 2.2, j * mpp * 2.2, seed + 7);
        const k = j * size + i;
        const b = Math.round(v * 255);
        if (b > target[k]) target[k] = b;
      }
    }
  };
  for (const o of objects) {
    const scale = o.scaleXYZ ? (o.scaleXYZ[0] + o.scaleXYZ[2]) / 2 : (o.scale ?? 1);
    const id = o.variant ? `${o.kind}.${o.variant}` : o.kind;
    const crown = SPECIES_BY_MODEL.get(id)?.crown ?? 1;
    if (o.x < bounds.minX - 6 || o.x > bounds.maxX + 6 || o.z < bounds.minZ - 6 || o.z > bounds.maxZ + 6) continue;
    if (o.kind === "tree") {
      if (o.variant?.startsWith("pine") || o.variant?.startsWith("giantpine") || o.variant?.startsWith("tallthick")) stamp(needles, o.x, o.z, crown * scale * 1.6 + 0.9, 1.1, 0.95, 0.35);
      stamp(litter, o.x, o.z, crown * scale * 1.5 + 0.8, 1.4, 0.95, 0.3);
      stamp(shade, o.x, o.z, 0.9 * scale + 0.4, 1.2, 0.9, 0);
      stamp(shade, o.x, o.z, crown * scale * 1.7, 1.6, 0.3, 0.6);
    } else if (o.kind === "rock") {
      const r = (o.collider?.shape === "circle" ? o.collider.r : 1) * 1.25;
      stamp(shade, o.x, o.z, r, 0.7, 0.85, 0);
      stamp(litter, o.x, o.z, r * 1.2, 1, 0.5, 0.3);
    } else if (o.kind === "rockpath") {
      stamp(paved, o.x, o.z, (SPECIES_BY_MODEL.get(id)?.footprint ?? 1) * scale * 0.95, 0.45, 1, 0.12);
    } else if (o.kind === "bush" || o.kind === "fern") {
      stamp(shade, o.x, o.z, (SPECIES_BY_MODEL.get(id)?.footprint ?? 0.8) * scale * 0.9, 1, 0.45, 0);
    }
  }
  return { litter, shade, needles, paved };
}

/**
 * Waga pustyni (profil `pro_desert`, 0-1) w punkcie; null poza trybem Pro. Używana do atrybutu wierzchołków gruntu (fale piasku).
 */
export function desertWeightFn(forest: ForestWorld): ((x: number, z: number) => number) | null {
  const geo = forest.geometry;
  const ids = geo.weightProfiles.map((p) => p.id);
  const at = ids.indexOf("pro_desert");
  if (at < 0) return null;
  const w = new Float64Array(geo.weightCount);
  return (x, z) => {
    geo.profileWeights(x, z, w);
    return Math.min(1, w[at]);
  };
}

/**
 * Maska spękanej ziemi (kanał alfa tekstury gruntu, tylko tryb Pro): duże płaty w pustyni (szum o skali `crackPatchScale`)
 * oraz ścieżki w każdej strefie; bruk i brzegi wody bez pęknięć. Sam wzór pęknięć rysuje shader gruntu.
 */
function crackAlpha(x: number, z: number, seed: number, desert: number, pathAmt: number, paved: number): number {
  const sc = PRO_GROUND.crackPatchScale;
  const wx = x + (vnoise(x / 7, z / 7, seed + 31) - 0.5) * 6;
  const wz = z + (vnoise(x / 7 + 4.3, z / 7 - 2.1, seed + 32) - 0.5) * 6;
  const n = vnoise(wx / sc, wz / sc, seed + 21) * 0.78 + vnoise(wx / (sc * 0.3), wz / (sc * 0.3), seed + 22) * 0.22;
  const t = PRO_GROUND.crackPatchThreshold;
  const patch = smooth(t - 0.07, t + 0.07, n) * smooth(0.3, 0.75, desert);
  const mask = Math.max(patch, pathAmt * 0.9) * (1 - Math.min(1, paved * 0.9));
  return Math.round(Math.min(1, mask) * 255);
}

/** Paleta stref Pro: jesienne złoto i ściółka w A, piaszczysty grunt w C. */
function proGround(color: Rgb, autumn: number, desert: number, nMid: number, nSmall: number): [number, number, number] {
  let c: Rgb = color;
  if (autumn > 0.001) {
    const warm = lerp3(AUTUMN_GRASS, AUTUMN_LEAVES, smooth(0.35, 0.75, nSmall));
    c = lerp3(c, warm, Math.min(1, autumn * (0.55 + 0.25 * nMid)));
  }
  if (desert > 0.001) {
    const sand = lerp3(DESERT_DARK, DESERT_SAND, Math.min(1, nMid * 0.7 + nSmall * 0.4));
    c = lerp3(c, sand, Math.min(1, desert * 0.94));
  }
  return [c[0], c[1], c[2]];
}

export type GroundStyle = "v2a" | "natural";

export type GroundInputs = { forest: ForestWorld; bounds: Bounds; objects: readonly WorldObject[]; size: number; style?: GroundStyle };

export type GroundBuilder = {
  size: number;
  metersPerPixel: number;
  data: Uint8Array;
  /** Wypełnia kolejne wiersze; zwraca true, gdy tekstura jest gotowa (pozwala dzielić pracę między klatki). */
  step: (rows: number) => boolean;
  progress: () => number;
};

/**
 * Tekstura koloru gruntu okna (RGBA, sRGB): trawa w kilku odcieniach zależna od strefy (polana jaśniejsza i cieplejsza,
 * gęsty las ciemniejszy i mszysty), ściółka pod drzewami, ścieżka z ubitej ziemi z kamyczkami, wilgotne brzegi rzeki
 * i żwir, zbocza z gołą ziemią, kontakt (ciemny pierścień) pod skałami i krzewami oraz drobne źdźbła. Grubo próbkowane
 * pola (0,5 m) są interpolowane, a szczegół pochodzi z szumu, więc koszt jest liniowy względem liczby pikseli.
 */
export function createGroundBuilder(inputs: GroundInputs): GroundBuilder {
  const { forest, bounds, size } = inputs;
  const mpp = (bounds.maxX - bounds.minX) / size;
  const fieldBuilder = createFieldBuilder(forest, bounds);
  const fields = fieldBuilder.fields;
  const seed = (forest.seed ^ 0x51ed270b) | 0;
  let brushes: Brushes = { litter: new Uint8Array(0), shade: new Uint8Array(0), needles: new Uint8Array(0), paved: new Uint8Array(0) };
  let phase: 0 | 1 | 2 = 0;
  const data = new Uint8Array(size * size * 4);
  let row = 0;

  const fillRow = (j: number) => {
    const z = bounds.minZ + (j + 0.5) * mpp;
    const fz = (z - bounds.minZ) / FIELD_CELL;
    for (let i = 0; i < size; i++) {
      const x = bounds.minX + (i + 0.5) * mpp;
      const fx = (x - bounds.minX) / FIELD_CELL;
      const k = j * size + i;
      const trail = sampleField(fields.trail, fields.n, fx, fz);
      const water = sampleField(fields.water, fields.n, fx, fz);
      const slope = sampleField(fields.slope, fields.n, fx, fz);
      const clearing = sampleField(fields.clearing, fields.n, fx, fz);
      const dense = sampleField(fields.dense, fields.n, fx, fz);
      const sunny = sampleField(fields.sunny, fields.n, fx, fz);
      const riverside = sampleField(fields.riverside, fields.n, fx, fz);

      const nLarge = vnoise(x / 11, z / 11, seed);
      const nMid = vnoise(x / 3.1, z / 3.1, seed + 1);
      const nSmall = vnoise(x / 0.65, z / 0.65, seed + 2);
      const nFine = vnoise(x / 0.16, z / 0.16, seed + 3);
      const grain = lattice(i, j, seed + 4);

      let color = lerp3(GRASS_DARK, GRASS_LUSH, Math.min(1, nLarge * 0.55 + nMid * 0.55));
      color = lerp3(color, GRASS_SUN, Math.min(1, clearing * 0.55 + sunny * 0.3) * (0.35 + 0.65 * nMid));
      color = lerp3(color, MOSS, Math.min(1, dense * 0.5 * nMid + riverside * 0.35));
      const darken = 1 - 0.2 * dense;
      color = [color[0] * darken, color[1] * darken, color[2] * darken];

      const litterAmt = Math.min(1, brushes.litter[k] / 255 + dense * 0.28 * smooth(0.45, 0.75, nMid) + 0.05 * nSmall);
      const litterColor = lerp3(LITTER_A, LITTER_B, nSmall);
      color = lerp3(color, litterColor, litterAmt * (0.55 + 0.45 * nFine));

      const earthAmt = smooth(0.34, 0.62, slope) * (0.5 + 0.5 * nSmall);
      color = lerp3(color, EARTH, earthAmt);

      if (fields.pro) color = proGround(color, sampleField(fields.autumn, fields.n, fx, fz), sampleField(fields.desert, fields.n, fx, fz), nMid, nSmall);

      const wet = smooth(5.5, 0.3, water);
      color = lerp3(color, MUD, wet * 0.65 * (0.6 + 0.4 * nMid));
      const gravel = smooth(1.8, -0.1, water);
      color = lerp3(color, lerp3(GRAVEL, PEBBLE, nFine), gravel * (0.55 + 0.4 * nSmall));
      if (water < 0) color = lerp3(color, MUD, 0.5);

      const edge = 0.1 + (nSmall - 0.5) * 0.5 + (nFine - 0.5) * 0.25;
      const pathAmt = smooth(edge + 0.45, edge - 0.15, trail);
      if (pathAmt > 0) {
        let dirt = lerp3(DIRT_B, DIRT_A, Math.min(1, nMid * 0.6 + nSmall * 0.5));
        if (grain > 0.965 && trail < 0.2) dirt = lerp3(dirt, PEBBLE, 0.8);
        color = lerp3(color, dirt, pathAmt * 0.97);
      } else if (trail < 1.1) {
        const fringe = smooth(1.1, 0.4, trail) * 0.3;
        color = lerp3(color, GRASS_DARK, fringe);
      }

      if (fields.pro && brushes.paved[k] > 0) color = lerp3(color, lerp3(PAVE_A, PAVE_B, nSmall), (brushes.paved[k] / 255) * 0.9);

      const shade = 1 - 0.38 * (brushes.shade[k] / 255);
      const speck = (grain - 0.5) * 16 + (nFine - 0.5) * 18;
      const blade = pathAmt < 0.3 && grain > 0.985 ? 22 : grain < 0.01 ? -20 : 0;
      const o = k * 4;
      const alpha = fields.pro ? crackAlpha(x, z, seed, sampleField(fields.desert, fields.n, fx, fz), pathAmt, brushes.paved[k] / 255) : 255;
      data[o] = Math.max(0, Math.min(255, color[0] * shade + speck + blade));
      data[o + 1] = Math.max(0, Math.min(255, color[1] * shade + speck + blade));
      data[o + 2] = Math.max(0, Math.min(255, color[2] * shade + speck * 0.8 + blade * 0.6));
      data[o + 3] = alpha;
    }
  };

  const fillRowNatural = (j: number) => {
    const z = bounds.minZ + (j + 0.5) * mpp;
    const fz = (z - bounds.minZ) / FIELD_CELL;
    for (let i = 0; i < size; i++) {
      const x = bounds.minX + (i + 0.5) * mpp;
      const fx = (x - bounds.minX) / FIELD_CELL;
      const k = j * size + i;
      const trail = sampleField(fields.trail, fields.n, fx, fz);
      const water = sampleField(fields.water, fields.n, fx, fz);
      const slope = sampleField(fields.slope, fields.n, fx, fz);
      const clearing = sampleField(fields.clearing, fields.n, fx, fz);
      const dense = sampleField(fields.dense, fields.n, fx, fz);
      const sunny = sampleField(fields.sunny, fields.n, fx, fz);
      const riverside = sampleField(fields.riverside, fields.n, fx, fz);

      const wx = x + (vnoise(x / 6.5, z / 6.5, seed + 11) - 0.5) * 5;
      const wz = z + (vnoise(x / 6.5 + 9.1, z / 6.5 - 3.7, seed + 12) - 0.5) * 5;
      const nLarge = vnoise(wx / 14, wz / 14, seed);
      const nMid = vnoise(wx / 4.2, wz / 4.2, seed + 1);
      const nSmall = vnoise(x / 0.7, z / 0.7, seed + 2);
      const nFine = vnoise(x / 0.17, z / 0.17, seed + 3);
      const grain = lattice(i, j, seed + 4);
      const litterBrush = brushes.litter[k] / 255;
      const needleBrush = brushes.needles[k] / 255;

      const cover = smooth(
        0.22,
        0.66,
        0.58 + 0.85 * (nMid - 0.5) + 0.7 * (nLarge - 0.5) + 0.3 * clearing + 0.12 * sunny - 0.2 * dense - 0.7 * litterBrush - 0.3 * needleBrush,
      );

      let grass = lerp3(N_GRASS_DARK, N_GRASS_LUSH, Math.min(1, nLarge * 0.7 + nMid * 0.45));
      grass = lerp3(grass, N_GRASS_SUN, Math.min(1, clearing * 0.5 + sunny * 0.25) * (0.3 + 0.7 * nMid));
      grass = lerp3(grass, N_GRASS_DRY, 0.35 * smooth(0.55, 0.85, nSmall) * (1 - dense));
      grass = lerp3(grass, N_MOSS, Math.min(1, dense * 0.55 * smooth(0.35, 0.7, nMid) + riverside * 0.3));

      let litter = lerp3(N_LITTER_B, N_LITTER_A, Math.min(1, nSmall * 0.7 + nMid * 0.35));
      litter = lerp3(litter, N_NEEDLES, needleBrush * (0.55 + 0.45 * nFine));

      let color = lerp3(litter, grass, cover * (0.7 + 0.3 * nFine));

      const earthAmt = smooth(0.34, 0.62, slope) * (0.5 + 0.5 * nSmall);
      color = lerp3(color, N_EARTH, earthAmt);

      if (fields.pro) color = proGround(color, sampleField(fields.autumn, fields.n, fx, fz), sampleField(fields.desert, fields.n, fx, fz), nMid, nSmall);

      const wet = smooth(5.5, 0.3, water);
      color = lerp3(color, MUD, wet * 0.65 * (0.6 + 0.4 * nMid));
      const gravel = smooth(1.8, -0.1, water);
      color = lerp3(color, lerp3(GRAVEL, PEBBLE, nFine), gravel * (0.55 + 0.4 * nSmall));
      if (water < 0) color = lerp3(color, MUD, 0.5);

      const edge = 0.15 + (nSmall - 0.5) * 0.55 + (nFine - 0.5) * 0.3;
      const pathAmt = smooth(edge + 0.55, edge - 0.2, trail);
      const trod = smooth(1.9, 0.3, trail) * (1 - pathAmt) * 0.5;
      if (trod > 0) color = lerp3(color, N_TROD, trod * (0.6 + 0.4 * nMid));
      if (pathAmt > 0) {
        let dirt = lerp3(N_PATH_B, N_PATH_A, Math.min(1, nMid * 0.55 + nSmall * 0.55));
        if (grain > 0.96 && trail < 0.3) dirt = lerp3(dirt, PEBBLE, 0.75);
        color = lerp3(color, dirt, pathAmt * 0.96);
      }

      if (fields.pro && brushes.paved[k] > 0) color = lerp3(color, lerp3(PAVE_A, PAVE_B, nSmall), (brushes.paved[k] / 255) * 0.9);

      const shade = 1 - 0.34 * (brushes.shade[k] / 255) - 0.1 * dense;
      let fleck = 0;
      let flecked: Rgb | null = null;
      if (pathAmt < 0.5 && grain > 0.975) {
        flecked = FLECKS[Math.floor(lattice(i, j, seed + 5) * FLECKS.length) % FLECKS.length];
        fleck = 0.7;
      }
      const speck = (grain - 0.5) * 12 + (nFine - 0.5) * 14;
      const blade = pathAmt < 0.3 && grain > 0.985 && !flecked ? 18 : grain < 0.01 ? -16 : 0;
      const o = k * 4;
      let r = color[0] * shade + speck + blade;
      let g = color[1] * shade + speck + blade;
      let b = color[2] * shade + speck * 0.8 + blade * 0.6;
      if (flecked) {
        r = mixN(r, flecked[0] * shade, fleck);
        g = mixN(g, flecked[1] * shade, fleck);
        b = mixN(b, flecked[2] * shade, fleck);
      }
      data[o] = Math.max(0, Math.min(255, r));
      data[o + 1] = Math.max(0, Math.min(255, g));
      data[o + 2] = Math.max(0, Math.min(255, b));
      data[o + 3] = fields.pro ? crackAlpha(x, z, seed, sampleField(fields.desert, fields.n, fx, fz), pathAmt, brushes.paved[k] / 255) : 255;
    }
  };

  const fill = inputs.style === "natural" ? fillRowNatural : fillRow;

  return {
    size,
    metersPerPixel: mpp,
    data,
    step(rows) {
      if (phase === 0) {
        if (fieldBuilder.step(Math.max(1, Math.ceil(rows / 2)))) phase = 1;
        return false;
      }
      if (phase === 1) {
        brushes = paintBrushes(inputs.objects, bounds, size, mpp, seed);
        phase = 2;
        return false;
      }
      const end = Math.min(size, row + rows);
      while (row < end) fill(row++);
      return row >= size;
    },
    progress: () => (phase === 2 ? row / size : 0),
  };
}

/** Synchroniczna wersja (testy, małe rozmiary). */
export function buildGroundTexture(inputs: GroundInputs): GroundTexture {
  const b = createGroundBuilder(inputs);
  let done = false;
  while (!done) done = b.step(inputs.size);
  return { data: b.data, size: b.size, metersPerPixel: b.metersPerPixel };
}
